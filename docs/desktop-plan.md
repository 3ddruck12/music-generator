# Plan: Music Generator als Tauri-Desktop-App

Stand: 2026-10-21 · Fork: `3ddruck12/music-generator` (Upstream: `rabbitfiremediacreation/music-generator`)

## Ziel

Eine native Desktop-App für Linux, Windows und macOS. Sie ersetzt die Dateien „Music Generator ON/OFF“ und den
Browser-Tab. Das bestehende Backend (FastAPI, `app/`), die Oberfläche (`static/`) und die Installer bleiben
**unverändert die Grundlage**. Die Tauri-App ist eine Hülle mit folgenden Aufgaben:

1. Projektordner finden oder einrichten,
2. `ace-server` (Synthese 8085, ggf. Sprachmodell 8086) und `uvicorn` (8765) starten und überwachen,
3. die Oberfläche in einem eigenen Fenster zeigen,
4. beim Beenden alles sauber stoppen,
5. Tray-Menü, Logs, Fehlermeldungen in denselben zwölf Sprachen wie die Web-Oberfläche anbieten.

Nicht-Ziele (vorerst): Backend nach Rust portieren, Python einbetten (PyInstaller), Modelle in das Installationspaket legen.

## Grundsatzentscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| Tauri-Version | Tauri 2 (stable) | aktuelle API, Capabilities-Modell, `on_download`, Tray, Single-Instance-Plugin |
| Windows-Installer | **nur WiX (`.msi`)**, kein NSIS | Entscheidung 2026-10-21. MSI ist für Verteilung/GPO/winget geeignet |
| Ort im Repo | neuer Ordner `desktop/` (`desktop/src-tauri`, `desktop/ui`) | Upstream-Merges bleiben konfliktarm |
| Frontend der Hülle | kleines statisches HTML/JS in `desktop/ui` (Start-/Fehler-/Einrichtungsseite), kein Framework | wenig Abhängigkeiten. Die eigentliche UI kommt von `http://127.0.0.1:8765` |
| Projektordner | Standard wie bisher: `~/MusicGenerator` bzw. `%USERPROFILE%\MusicGenerator`. Änderbar, gespeichert in der Konfiguration der Hülle | Installer, Updater (`git pull`) und `data/` funktionieren unverändert |
| Prozessstart | Rust startet die Prozesse direkt (Logik aus `ON.command` / `ON.ps1` / `arch_linux.sh --start` nachgebaut), nicht über die Shellskripte | kontrollierbare Kindprozesse, kein Terminalfenster, plattformgleiches Verhalten |
| Konfiguration | `data/engine.conf` und Ports aus `scripts/common.sh` werden von Rust gelesen (eine Quelle) | keine doppelte Pflege |
| Upstream-Änderungen | so wenige wie möglich, jede hinter `MG_DESKTOP=1` | Fork bleibt mergebar. Die Änderungen evtl. als PR an Upstream anbieten |

## Architektur

```
Tauri-Prozess (Rust)
├─ supervisor        startet/überwacht ace-server(s) + uvicorn, Health-Checks, Neustart, Logs in data/*.log
├─ config            liest scripts/common.sh (Ports), data/engine.conf (MODE, VAE_CHUNK, LM_DEVICE), Hüllen-Settings
├─ locate/setup      findet Projektordner; Einrichtungsassistent: git clone + Installer im Log-Fenster ausführen
├─ i18n              12 Sprachen (JSON), Sprache synchron zur Web-UI (localStorage "ui_lang")
├─ tray              Öffnen · Neu starten · Logs zeigen · Projektordner · Beenden
└─ windows
   ├─ "splash"       desktop/ui: Status „Starte Sprachmodell…“, Fehler mit Log-Auszug, Einrichtung
   └─ "main"         lädt http://127.0.0.1:8765, Download-Handler, Mikrofon-Freigabe, Sprach-Bridge
```

### Start-Ablauf (entspricht ON-Skripten)

1. Single-Instance: Eine zweite App-Instanz holt nur das Fenster nach vorn.
2. Projektordner prüfen: `engine/acestep.cpp/build/ace-server[.exe]` bzw. `build/Release/ace-server.exe`, vollständige
   Modelle (keine `*.part`, `vae-BF16.gguf`, `acestep-v15-*.gguf`, `acestep-5Hz-lm-*.gguf`), `.venv`.
   Fehlt etwas, startet der Einrichtungsassistent.
3. Laufen Ports bereits (z. B. per ON-Skript gestartet), werden die Prozesse übernommen und nicht doppelt gestartet. Die Prüfung „Code neuer als
   laufende Web-App“ wird übernommen.
4. Start von `ace-server` mit `--models … --max-batch 1 [--vae-chunk N]`. Bei `MODE=split` zusätzlich LM-Server mit
   `GGML_BACKEND=CPU` (+ `--device CPU`, wenn `--help` es kennt). Linux: `GGML_VK_VISIBLE_DEVICES`, ROCm-`LD_LIBRARY_PATH`.
   macOS: `pfade_reparieren` (rpath) – vorerst weiter über `scripts/common.sh` aufrufen.
5. `uv run uvicorn app.main:app --host 127.0.0.1 --port 8765` mit `MG_DESKTOP=1`. `uv` wird wie in den Skripten
   gesucht (`~/.local/bin`, `%USERPROFILE%\.local\bin`, PATH).
6. Warten auf die Ports (max. 30 s, wie Skripte), danach Hauptfenster auf 8765 und Splash schließen.
   Bei Timeout zeigt der Splash den Fehler mit den letzten 30 Log-Zeilen und den Knöpfen „Erneut versuchen“ und „Log öffnen“.
7. Windows: Kindprozesse mit `CREATE_NO_WINDOW` und in einem Job-Objekt, damit sie bei einem Absturz der Hülle mit beendet werden.
   Unix: eigene Prozessgruppe, beim Beenden SIGTERM, nach Frist SIGKILL.

### Beenden

- Fenster schließen → App beendet Server (Einstellung: „Im Tray weiterlaufen“ optional).
- Nur selbst gestartete Prozesse beenden. Übernommene Prozesse auf Nachfrage (wie OFF-Skript, das per Port beendet).

## Nötige Änderungen am Upstream-Code (minimal, hinter `MG_DESKTOP`)

1. **`/api/shutdown`** (`app/main.py`): Mit `MG_DESKTOP=1` wird kein OFF-Skript gestartet, sondern die Hülle benachrichtigt (Endpoint
   gibt `{"desktop": true}` zurück, die Hülle reagiert per Bridge-Event und beendet sich sauber).
2. **Updater-Neustart** (`app/updater.py::_restart`): Der eigene Neustart von uvicorn kollidiert mit dem Supervisor.
   Mit `MG_DESKTOP=1` den Prozess nur beenden, der Supervisor startet neu (Exit-Code/Marker-Datei `data/restart`).
3. **Fehlertext** „Läuft ace-server?“ / Hinweise „nach OFF und ON“ (`lm_dev_hint`): in der Desktop-App passt der Text
   „App neu starten“ → neuer i18n-Schlüssel nur für Desktop, Auswahl über `window.__MG_DESKTOP__`.
4. **macOS `symbole.sh`** im `lifespan`: in der Desktop-App unnötig, mit `MG_DESKTOP` überspringen.

Alles andere (Downloads, Mikrofon, Sprache) löst die Hülle, ohne Upstream anzufassen.

## Webview-Besonderheiten (Risiken, früh testen)

| Thema | Problem | Lösung |
|---|---|---|
| Downloads (`?download=1`, ZIP, `data:`-TXT) | Webviews laden nicht automatisch herunter | `WebviewWindowBuilder::on_download` → Speichern-Dialog (`tauri-plugin-dialog`), Ziel Downloads-Ordner |
| Mikrofon „Idee aufnehmen“ | WebKitGTK: Permission-Request muss erlaubt werden. macOS: `NSMicrophoneUsageDescription` in `Info.plist` + Entitlement. Windows/WebView2: Prompt | Linux: `connect_permission_request` über `with_webview` nur für `127.0.0.1:8765` erlauben. macOS Info.plist. Testen, ob `getUserMedia` auf `http://127.0.0.1` als „secure context“ gilt (localhost ja, 127.0.0.1 je nach Engine) → ggf. `http://localhost:8765` laden |
| Externe Links (Alphatester-Logo, GitHub) | würden im App-Fenster öffnen | Navigation außerhalb 127.0.0.1/localhost abfangen → `tauri-plugin-opener` im Systembrowser |
| Audio-Wiedergabe | WebKitGTK braucht GStreamer-Plugins (MP3/WAV) | Abhängigkeit im `.deb`/`.rpm` (`gstreamer1.0-plugins-good`, `-libav`), Hinweis bei AppImage |
| Tastenkürzel Alt+G/R/N/B, Leertaste | Kollision mit Menüs (Windows Alt) | kein natives Menü im Hauptfenster, nur Tray |
| Sprache | Web-UI speichert `ui_lang` im localStorage der Webview | Initialisierungsskript (`initialization_script`) hört auf `langchange` und meldet an die Hülle (IPC nur für Origin 127.0.0.1:8765 via Capability `remote.urls`) |

## Sprachen (i18n)

- Dieselben 12 Sprachen wie `static/i18n.js`: de, en, es, fr, it, pt, tr, pl, ru, uk, ja, zh.
- Hüllen-Texte in `desktop/locales/<lang>.json` (Tray, Splash, Fehler, Einrichtung, Speichern-Dialog, Beenden-Rückfrage).
- Startsprache: gespeicherte Wahl der Hülle → Systemsprache (`sys-locale`) → Englisch. Gleiche Fallback-Regel wie
  `i18n.js` (fehlender Schlüssel → en → de).
- Wechselt man die Sprache in der Web-UI, folgt die Hülle (Tray-Menü wird neu aufgebaut).
- Übersetzungen: Deutsch und Englisch schreiben wir selbst, den Rest per Entwurf und Hinweis „Korrekturen willkommen“ (wie Upstream).
- Bundle-Metadaten (Beschreibung im Installer) mindestens de/en.
- WiX-Installer-Sprache: `bundle.windows.wix.language` mit `de-DE`, `en-US` und weiteren. Tauri baut **ein MSI je
  Sprache**. Für Sprachen ohne mitgelieferte Tauri-Texte eigene `.wxl`-Dateien unter `desktop/src-tauri/wix/`
  anlegen (`localePath`). Vorschlag: zuerst de-DE + en-US, die übrigen 10 Sprachen in Phase 6.

## Einrichtungsassistent (erste Ausführung)

1. „Projektordner auswählen“ (vorhandene Installation) **oder** „Neu einrichten“.
2. Neu einrichten: `git clone` des Forks (bzw. Upstream, konfigurierbar) nach `~/MusicGenerator`, danach den
   plattformspezifischen Installer **unverändert** ausführen und seine Ausgabe live im Splash anzeigen:
   - macOS: `Mac-Install.command --yes --no-start`
   - Windows: `Windows-Install.ps1` (passende Parameter für „ohne Rückfrage“ und „nicht starten“ klären)
   - Arch: `arch_linux.sh --install-only` (braucht `sudo` für pacman → im Terminal starten, nicht in der App)
   - andere Linux-Distros: Anleitung anzeigen + Link (wie README). **Offener Punkt**, siehe unten.
3. Fehlt `git` oder `uv`, verweisen wir auf die Installer-Logik. Die Hülle installiert nichts selbst.

## Projektstruktur (neu)

```
desktop/
├─ package.json            nur @tauri-apps/cli (Version gepinnt)
├─ ui/                     index.html, splash.js, splash.css (Start/Fehler/Einrichtung)
├─ locales/                de.json … zh.json
└─ src-tauri/
   ├─ Cargo.toml, tauri.conf.json, build.rs
   ├─ capabilities/        default.json (lokale UI), remote.json (nur 127.0.0.1:8765 → lang-Event, shutdown)
   ├─ icons/               aus static/favicon.svg / alphatester.png erzeugt (`tauri icon`)
   └─ src/
      ├─ main.rs, lib.rs
      ├─ paths.rs          Projektordner, Engine-/Modell-/uv-Suche je OS
      ├─ config.rs         common.sh + engine.conf parsen
      ├─ supervisor.rs     Prozesse, Ports, Health, Neustart, Logs
      ├─ setup.rs          Clone + Installer mit Live-Ausgabe
      ├─ i18n.rs
      ├─ tray.rs
      └─ webview.rs        Downloads, Mikrofon, externe Links, Init-Skript
tests/                     (Python, neu) pytest-Smoke-Tests für das Backend
.github/workflows/
├─ ci.yml
└─ release.yml
```

## Tests

**Rust (`cargo test`, alle drei OS):**
- `config`: Parser für `common.sh` (Ports, MODEL_FILES) und `engine.conf` (MODE/LM_DEVICE-Regel: `cpu` erzwingt `split`).
- `paths`: Engine-Suche je OS (`build/ace-server`, `build/Release/ace-server.exe`), Modell-Vollständigkeit mit Temp-Ordnern.
- `supervisor`: Kommandozeile aus Konfiguration (VAE_CHUNK, split/single, `--device CPU`). Start/Stopp mit
  **Fake-ace-server** (kleines Testprogramm, das einen Port öffnet und `/health` beantwortet), Port-Timeout, Prozessübernahme.
- `i18n`: alle 12 `locales/*.json` haben dieselben Schlüssel, keine leeren Werte, Platzhalter `{name}` identisch.

**Python (`pytest`, neu, `uv run pytest`):**
- FastAPI-`TestClient` mit Temp-`data/`: `/api/settings`, `/api/songs`, Ordner anlegen/umbenennen/löschen, `/api/shutdown`
  im Desktop-Modus, Fehlerpfad „Modellserver nicht erreichbar“.
- i18n-Vollständigkeit von `static/i18n.js` (Schlüsselmengen je Sprache vergleichen, Node-Skript oder Parser).
- `app/messages.py`: alle Sprachen haben alle Schlüssel.

**End-to-End (später, Linux-Runner):** App mit Fake-ace-server starten, per `tauri-driver`/WebDriver prüfen, dass die UI
lädt und „Generieren“ den Fake-Server erreicht. Optional in Phase 3.

**Lint:** `cargo fmt --check`, `cargo clippy -D warnings`, `ruff` (Python), `shellcheck` (Skripte, wie Upstream).

## GitHub Actions

### `ci.yml` – bei Push/PR
| Job | Runner | Schritte |
|---|---|---|
| lint | ubuntu-latest | fmt, clippy, ruff, shellcheck, i18n-Checks |
| test-python | ubuntu/windows/macos | `astral-sh/setup-uv`, `uv sync`, `uv run pytest` |
| test-rust | ubuntu-22.04 / windows-latest / macos-14 | WebKitGTK-Pakete (Linux), `Swatinem/rust-cache`, `cargo test` |
| build-check | dieselbe Matrix | `tauri build --debug --no-bundle` (kompiliert, ohne Pakete) |

### `release.yml` – bei Tag `desktop-v*`
- `tauri-apps/tauri-action` in einer Matrix:
  - `ubuntu-22.04` → `.AppImage`, `.deb`, `.rpm` (22.04 wegen glibc-Kompatibilität)
  - `windows-latest` → `.msi` (WiX, `bundle.targets` unter Windows nur `msi`). Das WiX-Toolset v3 lädt das Tauri-Bundle
    selbst nach. In der CI das Verzeichnis zwischenspeichern. Die MSI-Version muss rein numerisch sein (`major.minor.patch`,
    kein `-beta`), daher Tags `desktop-v0.1.0` statt `desktop-v0.1.0-beta`. Eine feste `upgradeCode` in
    `tauri.conf.json` eintragen, damit Updates die alte Version ersetzen.
  - WiX-Feinheiten: Startmenü-Verknüpfung und Desktop-Verknüpfung (optional per Fragment), Installation pro Benutzer
    oder systemweit klären (Standard Tauri: systemweit unter `Program Files`). Projektordner/Modelle liegen
    unabhängig davon im Benutzerordner und werden bei Deinstallation **nicht** gelöscht
  - `macos-14` (arm64) → `.dmg` (`aarch64-apple-darwin`). Intel-Mac entfällt, weil die Engine dort ohnehin selbst kompiliert und Upstream Apple Silicon voraussetzt
- Erstellt Release-Entwurf mit Artefakten + `SHA256SUMS.txt`.
- Optional: `tauri-plugin-updater` mit `latest.json` (braucht Signatur-Schlüssel als Secret `TAURI_SIGNING_PRIVATE_KEY`).

### Secrets / Konten (offen)
- macOS Signierung + Notarisierung: Apple-Developer-Konto (99 $/Jahr). Ohne Konto ist die App unsigniert und
  Gatekeeper fragt nach („Rechtsklick → Öffnen“ bzw. `xattr -d com.apple.quarantine`).
- Windows Code-Signing: optional, ohne Zertifikat erscheint die SmartScreen-Warnung.
- Tauri-Updater-Schlüssel: kostenlos, per `tauri signer generate`.

## Phasen

1. **Gerüst (Linux lokal)**: `desktop/` anlegen, Fenster lädt 8765, Supervisor startet/stoppt Server aus vorhandener
   Installation, Splash mit Fehlern, Tray. Python-Änderungen hinter `MG_DESKTOP`.
2. **Webview-Funktionen**: Downloads, Mikrofon, externe Links, Sprach-Bridge, 12 Locales.
3. **CI**: `ci.yml` mit Lint + Tests auf drei OS, Fake-ace-server, pytest-Grundgerüst.
4. **Windows/macOS-Pfade**: WiX-Konfiguration (`upgradeCode`, Sprachen, Verknüpfungen), Job-Objekt, `CREATE_NO_WINDOW`, rpath-Reparatur, Info.plist/Mikrofon. Test über CI-Artefakte
   (bzw. Tester mit echter Hardware, wie `docs/windows-test-briefing.md`).
5. **Einrichtungsassistent**: Clone + Installer mit Live-Log.
6. **Release**: `release.yml`, Icons, Paketmetadaten, optional Auto-Update, README-Abschnitt „Desktop-App“.

## Entscheidungen (2026-10-21)

1. **Linux außer Arch**: ja. CI baut eine fertige Vulkan-Engine (Release-Asset) für Ubuntu/Fedora usw.
2. **Signierung**: keine. macOS: Gatekeeper-Hinweis in README, Windows: SmartScreen-Hinweis.
3. **Windows-Installer**: nur WiX (`.msi`), systemweit (perMachine, Standard von Tauri).
4. **Upstream**: Wenn der Fork funktioniert, die `MG_DESKTOP`-Änderungen (`app/desktop.py` + zwei Haken) als PR an
   `rabbitfiremediacreation/music-generator` schicken.
5. **Bundle-ID**: `io.github.ddruck12.musicgenerator`. `3ddruck12` geht nicht, weil der Name unter Linux ein D-Bus-Name
   ist und ein Teil dort nicht mit einer Ziffer beginnen darf.

## Phase 5: Einrichtung in der App (Weg 2, entschieden 2026-10-21)

- **Ordner**: Programmcode wird mit der App ausgeliefert (Ressourcen `project/`, schreibgeschützt). Daten liegen im
  Datenordner, Standard `~/MusicGenerator` (wie die Skripte; vorhandene Installationen werden genutzt, änderbar im Dialog):
  `engine/`, `data/`, `.venv`. Das Backend bekommt `MG_HOME`, uv bekommt `UV_PROJECT_ENVIRONMENT`. Beim Entwickeln sind
  beide Ordner das Repository.
- **Ablauf** (`installer.rs`, Daten aus `scripts/common.sh`): fertige Engine laden (Windows/Mac: Releases des Originals,
  Linux: eigene Vulkan-Version, `ENGINE_LINUX_*` in `common.sh`) → Modelle mit Fortsetzen + SHA-256 → `uv sync` →
  Grafiktest mit `scripts/metal_selftest.py` (Ergebnis wird wiederverwendet wie in den Skripten) → `data/engine.conf`.
- **Empfehlung** wie in den Installern: Sprachmodell nach RAM, begrenzt durch VRAM; `VAE_CHUNK` nach RAM (Mac) bzw. VRAM.
- **Updates**: In der installierten App ist der Git-Updater aus (Meldung „Updates kommen mit der Desktop-App“).
- **uv** wird als Sidecar mit der App ausgeliefert (CI lädt uv je Plattform), sonst aus dem PATH.

## Noch offen

- **Updates**: Soll der Code-Updater (`git pull`) auf den Fork zeigen? Soll die Hülle zusätzlich über den Tauri-Updater
  aktualisiert werden?

## Stand Phase 1 (erledigt)

- `app/desktop.py`: Beenden/Neustart im Desktop-Modus über `data/desktop-exit`. Haken in `/api/shutdown` und `updater._restart`
- Supervisor: Start in derselben Reihenfolge wie die ON-Skripte, laufende Server werden übernommen, Absturzerkennung mit Log-Auszug,
  Beenden der eigenen Prozessgruppen. Unter Linux `PR_SET_PDEATHSIG`. SIGTERM/SIGINT/SIGHUP beenden die App geordnet
- Fenster, Startseite mit Fehleranzeige, Tray, Single-Instance, externe Links im Systembrowser
- Sprache in 12 Sprachen, folgt der Web-App (Berechtigung `allow-set-lang` nur für `localhost:8765`)
- Linux: Mikrofon nur für die eigene Web-App freigegeben
- Tests: 16 Rust-Tests, darunter ein Durchlauf mit Ersatz-ace-server (`desktop/tests/fake-ace-server.py`) und echter Web-App
- Bekannte Lücken: Port 8765 ist in `capabilities/remote.json` fest eingetragen. Unter Windows fehlt das Job-Objekt (Phase 4).
  Downloads im Fenster folgen in Phase 2
