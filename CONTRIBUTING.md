# Contributing

## Most useful: tell us what works on your keyboard

The app is written for the **AULA F99 Pro** (wired `258A:010C`, 2.4G receiver `3554:FA09`). Other AULA models may share the protocol. If you try one, open an issue with:

1. The model and its vendor and product id (`chrome://device-log` lists them after you plug it in).
2. Which pages worked and which did not, and the error text shown.
3. Your browser and operating system.

## Code

- No build step and no dependencies: plain HTML, CSS and ES modules.
- `node tools/serve.mjs` serves the app at <http://localhost:5173>; add `?demo` for the simulated keyboard.
- `npm test` must pass. It drives the real transport and session code against `js/hid/demo.js`.
- A change to how bytes are sent or parsed needs a matching note in `docs/PROTOCOL.md`, marked as tested on hardware or not.
- Every write to the keyboard must be read back and checked. Do not report success the keyboard has not confirmed.
