/*
 * TV Dashboard – TizenBrew App-Modul
 * Zielplattform: Samsung Tizen 5.5 (Chromium ~69) → bewusst ES2017, kein Optional Chaining, kein Build-Schritt.
 */
(function () {
  'use strict';

  // ------------------------------------------------------------------ Konfiguration
  var STORAGE_KEY = 'tvdash.config.v1';
  var DEFAULTS = {
    haUrl: 'http://10.16.21.22:8123',
    token: '',
    indoor: 'climate.wohnen_essen_wohnen_essen',
    outdoor: 'sensor.zentral_aussentemperatur'
  };
  var TIZENTUBE = 'npm/@foxreis/tizentube';
  var TIZENBREW_WS = 'ws://127.0.0.1:8081';

  function loadConfig() {
    var cfg = {};
    try { cfg = JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch (e) { cfg = {}; }
    // Für die Entwicklung im Browser: ?token=…&haUrl=… überschreibt (wird gespeichert)
    var params = new URLSearchParams(location.search);
    ['haUrl', 'token', 'indoor', 'outdoor'].forEach(function (k) {
      if (params.get(k)) cfg[k] = params.get(k);
    });
    return Object.assign({}, DEFAULTS, cfg);
  }
  function saveConfig(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }

  var config = loadConfig();
  if (location.search.indexOf('token=') !== -1) saveConfig(config);

  // ------------------------------------------------------------------ Helfer
  function $(id) { return document.getElementById(id); }
  function fmt(n, digits) {
    if (n === null || n === undefined || isNaN(n)) return '–';
    return Number(n).toFixed(digits === undefined ? 1 : digits).replace('.', ',');
  }
  function pad(n) { return n < 10 ? '0' + n : '' + n; }
  function hhmm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

  var toastTimer = null;
  function toast(msg, ms) {
    var el = $('toast');
    el.textContent = msg;
    el.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.add('hidden'); }, ms || 4000);
  }

  // ------------------------------------------------------------------ Uhr
  var DAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
  var MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  function tickClock() {
    var d = new Date();
    $('clock').textContent = hhmm(d);
    $('date').textContent = DAYS[d.getDay()] + ', ' + d.getDate() + '. ' + MONTHS[d.getMonth()];
  }
  tickClock();
  setInterval(tickClock, 1000);

  // ------------------------------------------------------------------ Anzeige
  var states = {};
  var outdoorStats = null; // { min, max, trend }

  function render() {
    var inS = states[config.indoor];
    var outS = states[config.outdoor];

    // Innen: climate.* → current_temperature, sensor.* → state
    if (inS) {
      var a = inS.attributes || {};
      var isClimate = config.indoor.indexOf('climate.') === 0;
      var t = isClimate ? a.current_temperature : parseFloat(inS.state);
      $('in-temp').textContent = fmt(t);
      $('in-name').textContent = a.friendly_name ? '· ' + a.friendly_name : '';

      var parts = [];
      if (isClimate) {
        if (a.hvac_action === 'heating') parts.push('<span class="heat">● heizt</span>');
        else if (a.hvac_action === 'cooling') parts.push('<span class="cool">● kühlt</span>');
        else if (inS.state === 'off') parts.push('Regelung aus');
        if (a.temperature !== undefined && a.temperature !== null && inS.state !== 'off') {
          parts.push('Soll ' + fmt(a.temperature) + ' °C');
        }
        if (a.current_humidity !== undefined) parts.push(fmt(a.current_humidity, 0) + ' % rF');
      }
      $('in-detail').innerHTML = parts.join(' &nbsp;·&nbsp; ');
    }

    if (outS) {
      $('out-temp').textContent = fmt(parseFloat(outS.state));
      var p = [];
      if (outdoorStats) {
        if (outdoorStats.trend !== null) {
          var tr = outdoorStats.trend;
          var arrow = tr > 0.3 ? '↑' : (tr < -0.3 ? '↓' : '→');
          p.push(arrow + ' ' + (tr > 0 ? '+' : '') + fmt(tr) + ' °C in 3 h');
        }
        p.push('heute ' + fmt(outdoorStats.min) + ' / ' + fmt(outdoorStats.max) + ' °C');
      }
      $('out-detail').innerHTML = p.join(' &nbsp;·&nbsp; ');
    }
  }

  function setConn(kind, text) {
    $('conn-dot').className = 'dot' + (kind ? ' ' + kind : '');
    $('conn-text').textContent = text;
  }

  // ------------------------------------------------------------------ Home Assistant WebSocket
  // WebSocket statt REST: kein CORS-Problem, Live-Updates.
  var ha = { ws: null, id: 1, pending: {}, retry: 0, pingTimer: null, histTimer: null, reconnectTimer: null };

  function haSend(msg, cb) {
    msg.id = ha.id++;
    if (cb) ha.pending[msg.id] = cb;
    ha.ws.send(JSON.stringify(msg));
  }

  function haConnect() {
    clearTimeout(ha.reconnectTimer);
    if (ha.ws) { try { ha.ws.onclose = null; ha.ws.close(); } catch (e) { /* egal */ } }
    if (!config.token) { setConn('err', 'Kein Token – bitte Einstellungen öffnen'); return; }

    var url = config.haUrl.replace(/\/+$/, '').replace(/^http/, 'ws') + '/api/websocket';
    setConn('', 'Verbinde mit Home Assistant …');
    var ws;
    try { ws = new WebSocket(url); } catch (e) { setConn('err', 'Ungültige Adresse'); return; }
    ha.ws = ws;
    ha.pending = {};

    ws.onmessage = function (ev) {
      var msg = JSON.parse(ev.data);
      if (msg.type === 'auth_required') {
        ws.send(JSON.stringify({ type: 'auth', access_token: config.token }));
      } else if (msg.type === 'auth_invalid') {
        setConn('err', 'Token ungültig – bitte Einstellungen prüfen');
        ws.onclose = null;
        ws.close();
      } else if (msg.type === 'auth_ok') {
        ha.retry = 0;
        setConn('ok', 'Home Assistant verbunden');
        onHaReady();
      } else if (msg.type === 'result' || msg.type === 'event' || msg.type === 'pong') {
        var cb = ha.pending[msg.id];
        if (cb) {
          cb(msg);
          if (msg.type !== 'event' && !cb.keep) delete ha.pending[msg.id];
        }
      }
    };
    ws.onclose = function () {
      clearInterval(ha.pingTimer);
      clearInterval(ha.histTimer);
      var delay = Math.min(30000, 2000 * Math.pow(2, ha.retry++));
      setConn('err', 'Verbindung getrennt – neuer Versuch in ' + Math.round(delay / 1000) + ' s');
      ha.reconnectTimer = setTimeout(haConnect, delay);
    };
  }

  function onHaReady() {
    var ids = [config.indoor, config.outdoor];

    haSend({ type: 'get_states' }, function (msg) {
      if (!msg.success) return;
      msg.result.forEach(function (s) { if (ids.indexOf(s.entity_id) !== -1) states[s.entity_id] = s; });
      ids.forEach(function (id) { if (!states[id]) toast('Entity nicht gefunden: ' + id, 8000); });
      render();
    });

    var onTrigger = function (msg) {
      if (msg.type !== 'event') return;
      var to = msg.event && msg.event.variables && msg.event.variables.trigger && msg.event.variables.trigger.to_state;
      if (to) { states[to.entity_id] = to; render(); }
    };
    onTrigger.keep = true;
    haSend({ type: 'subscribe_trigger', trigger: { platform: 'state', entity_id: ids } }, onTrigger);

    loadOutdoorHistory();
    ha.histTimer = setInterval(loadOutdoorHistory, 10 * 60 * 1000);

    // Keepalive – erkennt "tote" Verbindungen (z. B. nach Standby)
    ha.pingTimer = setInterval(function () {
      var answered = false;
      haSend({ type: 'ping' }, function () { answered = true; });
      setTimeout(function () { if (!answered && ha.ws) ha.ws.close(); }, 10000);
    }, 30000);
  }

  // Min/Max seit Mitternacht + Trend der letzten 3 Stunden (aus dem HA-Verlauf)
  function loadOutdoorHistory() {
    var midnight = new Date(); midnight.setHours(0, 0, 0, 0);
    var since = new Date(Math.min(midnight.getTime(), Date.now() - 3 * 3600 * 1000));
    haSend({
      type: 'history/history_during_period',
      start_time: since.toISOString(),
      entity_ids: [config.outdoor],
      minimal_response: true,
      no_attributes: true,
      significant_changes_only: false
    }, function (msg) {
      if (!msg.success || !msg.result) return;
      var rows = msg.result[config.outdoor] || [];
      var pts = [];
      rows.forEach(function (r) {
        var v = parseFloat(r.s !== undefined ? r.s : r.state);
        var t = r.lu !== undefined ? r.lu * 1000 : Date.parse(r.last_updated || r.last_changed);
        if (!isNaN(v) && !isNaN(t)) pts.push({ t: t, v: v });
      });
      if (!pts.length) return;

      var today = pts.filter(function (p) { return p.t >= midnight.getTime(); });
      if (!today.length) today = [pts[pts.length - 1]];
      var vals = today.map(function (p) { return p.v; });

      // Wert vor 3 h = letzter Messpunkt vor (jetzt - 3 h)
      var cutoff = Date.now() - 3 * 3600 * 1000;
      var before = null;
      for (var i = 0; i < pts.length; i++) { if (pts[i].t <= cutoff) before = pts[i]; else break; }
      var now = pts[pts.length - 1].v;

      outdoorStats = {
        min: Math.min.apply(null, vals),
        max: Math.max.apply(null, vals),
        trend: before ? Math.round((now - before.v) * 10) / 10 : null
      };
      render();
    });
  }

  // ------------------------------------------------------------------ TizenTube über TizenBrew starten
  // Nachbau dessen, was die TizenBrew-UI beim Klick auf ein Modul macht
  // (tizenbrew-ui/src/components/Modules.jsx): GetModules (4) → LaunchModule (5) → location.href = appPath
  function launchTizenTube() {
    toast('Starte YouTube …', 6000);
    var ws;
    var done = false;
    try { ws = new WebSocket(TIZENBREW_WS); } catch (e) { toast('TizenBrew-Dienst nicht erreichbar'); return; }

    var timeout = setTimeout(function () {
      if (!done) { toast('TizenBrew-Dienst antwortet nicht'); try { ws.close(); } catch (e) { /* egal */ } }
    }, 8000);

    ws.onopen = function () { ws.send(JSON.stringify({ type: 4, payload: false })); };
    ws.onerror = function () { clearTimeout(timeout); toast('TizenBrew-Dienst nicht erreichbar'); };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      if (msg.type !== 4) return;

      // Modul-Cache noch leer → einmal neu laden lassen
      if (!msg.payload || !msg.payload.length) {
        setTimeout(function () { ws.send(JSON.stringify({ type: 4, payload: true })); }, 500);
        return;
      }

      var mdl = null;
      msg.payload.forEach(function (m) {
        if (!mdl && (m.fullName === TIZENTUBE || /tizentube/i.test(m.fullName || ''))) mdl = m;
      });
      if (!mdl) { done = true; clearTimeout(timeout); toast('TizenTube ist in TizenBrew nicht installiert', 6000); return; }

      done = true;
      clearTimeout(timeout);
      if (window.tizen && tizen.tvinputdevice) {
        (mdl.keys || []).forEach(function (k) { try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* egal */ } });
      }
      ws.send(JSON.stringify({ type: 5, payload: mdl }));
      setTimeout(function () { location.href = mdl.appPath; }, 150);
    };
  }

  // ------------------------------------------------------------------ Fokus-Navigation (Fernbedienung)
  var focused = null;

  function visibleFocusables() {
    var screen = $('setup').classList.contains('hidden') ? $('dashboard') : $('setup');
    return Array.prototype.slice.call(screen.querySelectorAll('.focusable'));
  }

  function setFocus(el) {
    if (!el) return;
    if (focused) focused.classList.remove('focused');
    focused = el;
    el.classList.add('focused');
  }

  function center(el) {
    var r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  function move(dir) {
    var items = visibleFocusables();
    if (!focused || items.indexOf(focused) === -1) { setFocus(items[0]); return; }
    var c = center(focused);
    var best = null, bestScore = Infinity;
    items.forEach(function (el) {
      if (el === focused) return;
      var p = center(el);
      var dx = p.x - c.x, dy = p.y - c.y;
      var primary, secondary;
      if (dir === 'left')  { primary = -dx; secondary = Math.abs(dy); }
      if (dir === 'right') { primary = dx;  secondary = Math.abs(dy); }
      if (dir === 'up')    { primary = -dy; secondary = Math.abs(dx); }
      if (dir === 'down')  { primary = dy;  secondary = Math.abs(dx); }
      if (primary <= 5) return;
      var score = primary + secondary * 2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) setFocus(best);
  }

  // ------------------------------------------------------------------ Setup
  function openSetup() {
    $('cfg-url').value = config.haUrl;
    $('cfg-token').value = config.token;
    $('cfg-in').value = config.indoor;
    $('cfg-out').value = config.outdoor;
    $('setup-msg').textContent = '';
    $('dashboard').classList.add('hidden');
    $('setup').classList.remove('hidden');
    setFocus(config.token ? $('cfg-url') : $('cfg-token'));
  }

  function closeSetup() {
    if (document.activeElement) document.activeElement.blur();
    $('setup').classList.add('hidden');
    $('dashboard').classList.remove('hidden');
    setFocus($('btn-youtube'));
  }

  function saveSetup() {
    config = {
      haUrl: $('cfg-url').value.trim() || DEFAULTS.haUrl,
      token: $('cfg-token').value.replace(/\s+/g, ''),
      indoor: $('cfg-in').value.trim() || DEFAULTS.indoor,
      outdoor: $('cfg-out').value.trim() || DEFAULTS.outdoor
    };
    saveConfig(config);
    states = {};
    outdoorStats = null;
    $('in-temp').textContent = '–';
    $('out-temp').textContent = '–';
    $('in-detail').textContent = '';
    $('out-detail').textContent = '';
    closeSetup();
    haConnect();
  }

  function activate(el) {
    if (!el) return;
    if (el.tagName === 'INPUT') { el.focus(); return; } // öffnet die Bildschirmtastatur
    var action = el.getAttribute('data-action');
    if (action === 'youtube') launchTizenTube();
    else if (action === 'setup') openSetup();
    else if (action === 'save') saveSetup();
    else if (action === 'cancel') closeSetup();
  }

  // ------------------------------------------------------------------ Tasten
  var KEY = {
    LEFT: 37, UP: 38, RIGHT: 39, DOWN: 40, ENTER: 13, BACK: 10009, ESC: 27,
    RED: 403, GREEN: 404, YELLOW: 405, BLUE: 406,
    IME_DONE: 65376, IME_CANCEL: 65385
  };

  if (window.tizen && tizen.tvinputdevice) {
    ['ColorF0Red', 'ColorF1Green', 'ColorF2Yellow', 'ColorF3Blue'].forEach(function (k) {
      try { tizen.tvinputdevice.registerKey(k); } catch (e) { /* egal */ }
    });
  }

  document.addEventListener('keydown', function (e) {
    var inInput = document.activeElement && document.activeElement.tagName === 'INPUT';

    // Während die Bildschirmtastatur offen ist, nur deren Ende behandeln
    if (inInput) {
      if (e.keyCode === KEY.IME_DONE || e.keyCode === KEY.IME_CANCEL || e.keyCode === KEY.BACK ||
          e.keyCode === KEY.ENTER || e.keyCode === KEY.ESC) {
        document.activeElement.blur();
        e.preventDefault();
      }
      return;
    }

    switch (e.keyCode) {
      case KEY.LEFT: move('left'); break;
      case KEY.RIGHT: move('right'); break;
      case KEY.UP: move('up'); break;
      case KEY.DOWN: move('down'); break;
      case KEY.ENTER: activate(focused); break;
      case KEY.RED: launchTizenTube(); break;
      case KEY.BLUE: openSetup(); break;
      case KEY.BACK:
      case KEY.ESC:
        if (!$('setup').classList.contains('hidden')) closeSetup();
        else if (history.length > 1) history.back();
        else if (window.tizen) tizen.application.getCurrentApplication().exit();
        break;
      default: return;
    }
    e.preventDefault();
  });

  // Maus/Pointer (Magic Remote bzw. Browser beim Entwickeln)
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('.focusable') : null;
    if (el) { setFocus(el); activate(el); }
  });

  // Nach Standby/Rückkehr aus YouTube sofort neu verbinden
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && (!ha.ws || ha.ws.readyState > 1)) haConnect();
  });

  // ------------------------------------------------------------------ Start
  setFocus($('btn-youtube'));
  if (!config.token) openSetup();
  haConnect();
})();
