# Changelog

## 1.0.0-web

Rewritten as a web application using WebHID. Runs in Chrome, Edge and Opera with nothing to install.

- New JavaScript device layer (`js/hid/`) ported from the Python core: wired and 2.4G links, verified writes, snapshots.
- New interface: Lighting, Colours, Keys, Macros, Device, Preferences.
- User preferences: theme, accent colour, density, sidebar, keyboard size, start page, behaviour toggles.
- Lighting presets, colour palette and colour profiles saved in the browser.
- Press-to-assign for keys; macro recording in the browser.
- Restore points, backup files (also reads backups from the desktop app), factory reset.
- Simulated keyboard for the demo and the tests.

Removed with the desktop app: app-driven knob actions and on-screen display, tray icon, start at login.

Audio-reactive lighting was ported and then removed. On a real F99 Pro, streaming the per-key colour table many times a second froze key input and the lights only changed once the stream stopped.

## 0.3.0

Last release of the Windows desktop app by xx12ek. See the upstream repository for its history.
