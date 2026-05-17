(() => {
  if (window.__drakonPitchInjected) return;
  window.__drakonPitchInjected = true;

  const DEFAULTS = {
    pitchValueSemitones: 0,
    pitchValueCents: 0,
    windowSizeMilliseconds: 120,
  };

  const state = {
    baseUrl: "",
    settings: { ...DEFAULTS },
    active: new Set(),
    pending: [],
    sharedCtx: null,
    pendingMedia: new Set(),
    attachedMedia: new WeakSet(),
  };

  const mediaToGain = new WeakMap();

  function pitchFactor() {
    const total =
      (state.settings.pitchValueSemitones || 0) * 100 +
      (state.settings.pitchValueCents || 0);
    const f = Math.pow(2, total / 1200);
    return Math.min(10, Math.max(0.1, f));
  }

  function windowSeconds() {
    const ms = Number(state.settings.windowSizeMilliseconds) || 120;
    return Math.min(1, Math.max(0.01, ms / 1000));
  }

  function updateNode(pn) {
    try {
      const f = pn.parameters.get("f");
      const w = pn.parameters.get("w");
      if (f) f.value = pitchFactor();
      if (w) w.value = windowSeconds();
    } catch (_) {}
  }

  function ensureModule(ctx) {
    if (!ctx.__drakonPitchModule) {
      ctx.__drakonPitchModule = ctx.audioWorklet
        .addModule(state.baseUrl + "smartProcessor.bundle.js")
        .catch((err) => {
          delete ctx.__drakonPitchModule;
          throw err;
        });
    }
    return ctx.__drakonPitchModule;
  }

  async function wire(ctx, source, gain) {
    if (!state.baseUrl) {
      state.pending.push({ ctx, source, gain });
      return;
    }
    try {
      await ensureModule(ctx);
      const node = new AudioWorkletNode(ctx, "extensions-ee-pitch-changer-s", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      updateNode(node);
      try {
        source.disconnect(gain);
      } catch (_) {}
      source.connect(node);
      node.connect(gain);
      state.active.add(node);
    } catch (err) {
      console.warn("[DrakonRhym] worklet wiring failed, passthrough:", err);
    }
  }

  function drainPending() {
    const queue = state.pending.splice(0);
    for (const p of queue) wire(p.ctx, p.source, p.gain);
  }

  function patchCreator(proto) {
    if (!proto || proto.__drakonPitchPatched) return;
    const original = proto.createMediaElementSource;
    if (typeof original !== "function") return;
    proto.createMediaElementSource = function (mediaElement) {
      const cached = mediaToGain.get(mediaElement);
      if (cached) return cached;
      const source = original.call(this, mediaElement);
      const gain = this.createGain();
      try {
        source.connect(gain);
      } catch (_) {}
      wire(this, source, gain);
      mediaToGain.set(mediaElement, gain);
      return gain;
    };
    proto.__drakonPitchPatched = true;
  }

  patchCreator(window.AudioContext && window.AudioContext.prototype);
  patchCreator(
    window.webkitAudioContext && window.webkitAudioContext.prototype,
  );
  patchCreator(
    window.OfflineAudioContext && window.OfflineAudioContext.prototype,
  );

  function patchCrossOrigin(media) {
    if (!media || media.__drakonPitchCorsPatched) return;
    media.__drakonPitchCorsPatched = true;
    if (media.crossOrigin) return;
    media.crossOrigin = "anonymous";
    let retryRequired = false;
    media.addEventListener("loadstart", () => {
      if (!media.currentSrc) return;
      try {
        const origin = new URL(media.currentSrc, location.href).origin;
        if (origin !== location.origin) retryRequired = true;
      } catch (_) {}
    });
    media.addEventListener("abort", (event) => {
      if (!retryRequired) return;
      retryRequired = false;
      let next;
      switch (media.crossOrigin) {
        case "anonymous":
          next = "use-credentials";
          break;
        case "use-credentials":
          next = null;
          break;
        default:
          return;
      }
      event.stopImmediatePropagation();
      media.crossOrigin = next;
      try {
        media.load();
      } catch (_) {}
    });
    const clearRetry = () => {
      retryRequired = false;
    };
    media.addEventListener("loadedmetadata", clearRetry);
    media.addEventListener("loadeddata", clearRetry);
  }

  function getSharedContext() {
    if (!state.sharedCtx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return null;
      try {
        state.sharedCtx = new Ctor();
      } catch (_) {
        state.sharedCtx = null;
      }
    }
    return state.sharedCtx;
  }

  function attachMedia(media) {
    if (!media || state.attachedMedia.has(media)) return;
    if (!state.baseUrl) {
      state.pendingMedia.add(media);
      patchCrossOrigin(media);
      return;
    }
    state.pendingMedia.delete(media);
    state.attachedMedia.add(media);
    patchCrossOrigin(media);
    const ctx = getSharedContext();
    if (!ctx) return;
    try {
      const gain = ctx.createMediaElementSource(media);
      gain.connect(ctx.destination);
    } catch (err) {
      state.attachedMedia.delete(media);
      console.warn("[DrakonRhym] attachMedia failed:", err);
      return;
    }
    media.addEventListener("playing", () => {
      if (state.sharedCtx && state.sharedCtx.state === "suspended") {
        state.sharedCtx.resume().catch(() => {});
      }
    });
  }

  function drainPendingMedia() {
    const list = Array.from(state.pendingMedia);
    state.pendingMedia.clear();
    list.forEach(attachMedia);
  }

  function scanMedia(root) {
    if (!root || !root.getElementsByTagName) return;
    Array.from(root.getElementsByTagName("audio")).forEach(attachMedia);
    Array.from(root.getElementsByTagName("video")).forEach(attachMedia);
  }

  if (window.Audio) {
    const NativeAudio = window.Audio;
    function WrappedAudio(src) {
      const el = new NativeAudio();
      patchCrossOrigin(el);
      if (src) el.src = src;
      attachMedia(el);
      return el;
    }
    WrappedAudio.prototype = NativeAudio.prototype;
    window.Audio = WrappedAudio;
  }

  const originalCreateElement = document.createElement;
  document.createElement = function (tagName, options) {
    const el = originalCreateElement.call(this, tagName, options);
    if (typeof tagName === "string") {
      const lower = tagName.toLowerCase();
      if (lower === "audio" || lower === "video") {
        attachMedia(el);
      }
    }
    return el;
  };

  function startObserver() {
    try {
      const observer = new MutationObserver((records) => {
        for (const rec of records) {
          rec.addedNodes.forEach((node) => {
            if (node instanceof HTMLMediaElement) {
              attachMedia(node);
            } else if (node && node.getElementsByTagName) {
              scanMedia(node);
            }
          });
        }
      });
      observer.observe(document.documentElement || document, {
        subtree: true,
        childList: true,
      });
    } catch (_) {}
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      startObserver();
      scanMedia(document);
    });
  } else {
    startObserver();
    scanMedia(document);
  }

  window.addEventListener("drakonPitchFromRuntime", (event) => {
    const msg = event.detail || {};
    if (typeof msg.baseUrl === "string" && msg.baseUrl) {
      state.baseUrl = msg.baseUrl;
    }
    if (msg.settings && typeof msg.settings === "object") {
      state.settings = { ...DEFAULTS, ...msg.settings };
    }
    if (state.baseUrl) {
      if (state.pending.length) drainPending();
      if (state.pendingMedia.size) drainPendingMedia();
      scanMedia(document);
    }
    state.active.forEach(updateNode);
  });

  window.dispatchEvent(
    new CustomEvent("drakonPitchFromMain", {
      detail: { action: "pitchContentReady" },
    }),
  );
})();
