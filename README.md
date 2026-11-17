# TV Dashboard (TizenBrew-Modul)

Startbildschirm für Samsung-TVs mit [TizenBrew](https://github.com/reisxd/TizenBrew):

- Innen- und Außentemperatur live aus Home Assistant (WebSocket-API)
- Außen: Trend der letzten 3 Stunden sowie Tages-Min/Max aus dem HA-Verlauf
- Ein Knopf startet YouTube mit TizenTube

Getestet für einen Samsung GQ65Q60T (Tizen 5.5). Der Code ist ES2017 ohne Build-Schritt.

## Installation

1. TizenBrew öffnen → **Modul-Manager** → Modul hinzufügen über **GitHub**
2. Nur `ChrisGITter/tizenbrew-dashboard` eingeben (das `gh/` setzt TizenBrew selbst davor)
3. Das Modul **TV Dashboard** starten. Beim ersten Start öffnen sich die Einstellungen.
4. Das Home-Assistant-Token eintragen. Am einfachsten geht das über die Tastatur in der SmartThings-App am Handy.
5. Optional: Im Modul-Manager das Modul als **Autostart** festlegen.

## Bedienung

| Taste            | Funktion                     |
|------------------|------------------------------|
| Pfeile / OK      | Navigation                   |
| 🔴 Rot           | YouTube (TizenTube) starten  |
| 🔵 Blau          | Einstellungen                |
| Zurück           | zurück zu TizenBrew          |

## Sicherheit

Das Token steht **nicht** im Repository. Es wird nur im `localStorage` des TVs gespeichert.

## Entwicklung

```
python3 -m http.server 8099
# Browser: http://localhost:8099/app/index.html?token=<TOKEN>
```
