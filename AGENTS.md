# AGENTS.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

## Project Overview

Drakon Rhym is a Chrome browser extension (Manifest V3) that performs real-time audio pitch shifting on any web page. It intercepts web audio and video elements, patches the Web Audio API, and inserts an AudioWorklet-based pitch-shifting processor.

**No build system** — this is a vanilla JavaScript extension. Files are edited directly and loaded into Chrome via "Load unpacked" from the `drakon-rhym/` directory.

## Architecture

### Extension Structure (`drakon-rhym/`)

- `manifest.json` — Manifest V3 definition. Key permissions: `activeTab`, `storage`, `declarativeNetRequestWithHostAccess`. Defines two content scripts, a service worker, and a popup.
- `service-worker.js` — Background script. Persists settings in `chrome.storage.sync` and broadcasts them to all tabs via `chrome.runtime.sendMessage`.
- `popup-simple.html` / `popup-simple.js` — Extension popup UI. Sliders for semitones, cents, and window size. Sends `setSettings` / `getSettings` messages to the service worker.
- `pitchIsolatedContentScript.js` — Content script running in `world: ISOLATED`. Bridges `chrome.runtime` messages to the MAIN world via `CustomEvent` (`drakonPitchFromRuntime`), and relays messages from the MAIN world back to `chrome.runtime`.
- `pitchMainContentScript.js` — Content script running in `world: MAIN` (same JS context as the page). This is the core of the extension. It:
  - Patches `AudioContext.prototype.createMediaElementSource`, `window.Audio`, and `document.createElement` to intercept all media element creation.
  - Wires intercepted media sources through an `AudioWorkletNode` backed by `smartProcessor.bundle.js`.
  - Handles cross-origin media via `crossOrigin` attribute cycling (`anonymous` → `use-credentials` → `null`).
  - Uses a `MutationObserver` to find dynamically added `<audio>` and `<video>` elements.
- `smartProcessor.bundle.js` — Pre-built, minified AudioWorklet processor module. Includes inline base64-encoded WebAssembly. **Do not edit directly**; it is a compiled artifact. If changes to the audio processing algorithm are needed, the upstream source must be rebuilt and this file replaced.
- `rules.json` — Declarative Net Request rule that injects `Access-Control-Allow-Origin: *` on media responses to enable CORS for cross-origin audio processing.

### Communication Flow

```
Popup  ↔  Service Worker  ↔  pitchIsolatedContentScript  --CustomEvent-->  pitchMainContentScript
```

- The ISOLATED content script dispatches `drakonPitchFromRuntime` events to the MAIN script.
- The MAIN script dispatches `drakonPitchFromMain` events, which the ISOLATED script relays to `chrome.runtime.sendMessage`.

### Audio Patching Strategy

1. `createMediaElementSource` is monkey-patched so that when a page creates a source node, the extension inserts an `AudioWorkletNode` between the source and a gain node, then returns the gain node to the caller.
2. For elements not going through `createMediaElementSource` (e.g., plain `<video>` elements), the extension creates a shared `AudioContext`, calls `createMediaElementSource` itself, and connects it to `ctx.destination`.
3. The `AudioWorkletNode` is named `extensions-ee-pitch-changer-s` and is loaded from `smartProcessor.bundle.js`.

## Common Commands

There is no build system, test runner, or package manager for this project. The extension is developed manually.

**Load in Chrome:**
1. Open `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `drakon-rhym/` directory

**After editing any file:**
- Open `chrome://extensions` and click the refresh icon on the Drakon Rhym card to reload.

## Important Notes

- `smartProcessor.bundle.js` is a compiled artifact. If the pitch algorithm needs changes, the source must be rebuilt externally and this file replaced.
- The extension modifies CORS headers on media responses via declarative net request rules. Cross-origin audio/video that previously failed due to CORS should now be processable.
- Settings (semitones, cents, window size) are stored in `chrome.storage.sync` and apply across all tabs.
- The MAIN world content script uses a single shared `AudioContext` for media elements that are not processed through the page's own audio graph.
