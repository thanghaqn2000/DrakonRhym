# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Drakon Rhym is a Chrome Manifest V3 extension that performs real-time pitch shifting on any `<audio>` / `<video>` element on the web. It patches the Web Audio API and routes media through an AudioWorklet-based processor.

**No build system, no package manager, no tests.** This is vanilla JavaScript loaded directly into Chrome via "Load unpacked" pointing at the `drakon-rhym/` directory.

## Loading & Reloading

1. Open `chrome://extensions`, enable Developer mode, click "Load unpacked", select `drakon-rhym/`.
2. After editing any file, click the refresh icon on the Drakon Rhym card. Content scripts only re-inject on next page navigation, so also reload the target page.

## Architecture

### Process boundaries

The extension straddles three JS contexts and you must keep them straight when editing:

- **Service worker** (`service-worker.js`) — owns settings persistence in `chrome.storage.sync` and broadcasts `settingsChanged` to all tabs. Handles `getSettings`, `setSettings`, `pitchContentReady` messages.
- **Popup** (`popup-simple.{html,js}`) — talks only to the service worker via `chrome.runtime.sendMessage`.
- **Content scripts**, injected at `document_start` into every frame:
  - `pitchIsolatedContentScript.js` runs in `world: ISOLATED`. It has `chrome.runtime` but cannot touch the page's JS objects.
  - `pitchMainContentScript.js` runs in `world: MAIN`. It shares the page's JS heap (and can monkey-patch `AudioContext`, `Audio`, `document.createElement`) but cannot call `chrome.runtime` directly.

### Message flow

```
Popup ⇄ Service Worker ⇄ ISOLATED script ⇄ MAIN script
                          (chrome.runtime)   (CustomEvent)
```

The ISOLATED ↔ MAIN bridge uses two `CustomEvent` names:
- `drakonPitchFromRuntime` — ISOLATED → MAIN (settings, baseUrl).
- `drakonPitchFromMain` — MAIN → ISOLATED (e.g., `pitchContentReady`).

`baseUrl` (the `chrome-extension://…/` URL prefix) must arrive from the service worker before the MAIN script can load `smartProcessor.bundle.js` into an `AudioWorklet`. Until it does, intercepted nodes and discovered media elements queue in `state.pending` / `state.pendingMedia` and are drained on the next `settingsChanged` message.

### Audio interception (the core of `pitchMainContentScript.js`)

Two paths cover both ways pages produce sound:

1. **Pages that use the Web Audio API.** `AudioContext.prototype.createMediaElementSource` is monkey-patched: it calls the original, inserts an `AudioWorkletNode` named `extensions-ee-pitch-changer-s` between the source and a fresh gain node, and returns the gain node. The page sees a normal `AudioNode` and connects it onward as usual. `webkitAudioContext` and `OfflineAudioContext` prototypes are patched the same way. `mediaToGain` caches the wrapper so repeated calls with the same element don't double-wire.
2. **Plain `<audio>` / `<video>` elements** (no `createMediaElementSource` on the page side). `window.Audio`, `document.createElement`, and a `MutationObserver` on `document.documentElement` route every media element through `attachMedia`, which uses a single shared `AudioContext` and calls `createMediaElementSource` itself — which then re-enters path (1) through the patched prototype.

The worklet exposes two AudioParams: `f` (pitch factor, `2^((semitones*100 + cents)/1200)`, clamped to `[0.1, 10]`) and `w` (window seconds, ms/1000 clamped to `[0.01, 1]`). `updateNode` is called on every active node on each `settingsChanged`.

### Cross-origin media

Cross-origin audio fails `createMediaElementSource` without CORS. Two mechanisms work together:

- `rules.json` is a `declarativeNetRequest` rule that injects `Access-Control-Allow-Origin: *` onto every GET media response that doesn't already carry that header.
- `patchCrossOrigin` sets `crossOrigin="anonymous"` on each media element, then on an `abort` event cycles through `anonymous` → `use-credentials` → `null` and calls `media.load()` again. This handles servers that reject one credential mode but accept another.

### Key invariants when editing

- `window.__drakonPitchInjected` guards against double-injection (e.g., the script being re-injected via `web_accessible_resources` inside iframes). Don't remove this guard.
- The MAIN script must run at `document_start` and patch prototypes synchronously, before any page script gets to call `createMediaElementSource`. Adding `await` before the patch calls will break this.
- `smartProcessor.bundle.js` is a **pre-built artifact** (~70KB minified, contains inline base64 WebAssembly). Do not edit it by hand. If the pitch algorithm itself needs to change, rebuild it from its upstream source and replace the file.
- `manifest.json` lists `smartProcessor.bundle.js` and `pitchMainContentScript.js` under `web_accessible_resources` because the worklet must be loadable as a `chrome-extension://` URL from page context — keep them there.
- `pitchIsolatedContentScript.js` line 3 has a `console.log` of every inbound message; leave a note or remove before considering anything "production".

## Related Files

- `AGENTS.md` — sibling guidance file targeting WARP. Keep both files roughly in sync when architectural details change.
- `drakon-rhym/_locales/` — i18n message catalogs for the popup (auto-loaded by Chrome from `default_locale: "en"` in the manifest).
