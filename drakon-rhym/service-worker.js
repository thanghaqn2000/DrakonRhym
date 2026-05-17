const DEFAULT_SETTINGS = {
  pitchValueSemitones: 0,
  pitchValueCents: 0,
  windowSizeMilliseconds: 120,
};

const SETTINGS_KEY = "settings";

// chrome.storage.sync caps writes at 120/min. Slider drags can emit dozens
// of input events per second, so we cache settings in memory, broadcast to
// content scripts immediately, and debounce the persist.
const SAVE_DEBOUNCE_MS = 400;
const SAVE_MAX_WAIT_MS = 1500;

let cachedSettings = null;
let loadingPromise = null;
let saveTimer = null;
let firstPendingAt = 0;

async function getSettings() {
  if (cachedSettings) return cachedSettings;
  if (!loadingPromise) {
    loadingPromise = chrome.storage.sync
      .get(SETTINGS_KEY)
      .then((data) => {
        cachedSettings = { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
        return cachedSettings;
      })
      .catch((err) => {
        // Don't poison the promise — fall back to defaults so later
        // saveSettings calls still work; subsequent reads will hit the
        // cached defaults rather than retrying a broken storage layer.
        console.warn("[DrakonRhym] storage.sync.get failed:", err);
        cachedSettings = { ...DEFAULT_SETTINGS };
        return cachedSettings;
      });
  }
  return loadingPromise;
}

function flushSave() {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  firstPendingAt = 0;
  if (!cachedSettings) return;
  const snapshot = { ...cachedSettings };
  chrome.storage.sync.set({ [SETTINGS_KEY]: snapshot }).catch((err) => {
    console.warn("[DrakonRhym] storage.sync.set failed:", err);
  });
}

function scheduleSave() {
  if (!firstPendingAt) firstPendingAt = Date.now();
  const elapsed = Date.now() - firstPendingAt;
  const delay = Math.min(SAVE_DEBOUNCE_MS, Math.max(0, SAVE_MAX_WAIT_MS - elapsed));
  if (saveTimer) clearTimeout(saveTimer);
  if (delay === 0) {
    flushSave();
  } else {
    saveTimer = setTimeout(flushSave, delay);
  }
}

async function saveSettings(patch) {
  const current = await getSettings();
  Object.assign(current, patch);
  scheduleSave();
  return current;
}

function buildBaseUrl() {
  return chrome.runtime.getURL("");
}

async function sendToTab(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (_) {}
}

async function sendToFrame(tabId, frameId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message, { frameId });
  } catch (_) {}
}

async function broadcastSettings(settings) {
  const tabs = await chrome.tabs.query({});
  const baseUrl = buildBaseUrl();
  await Promise.all(
    tabs.map((tab) =>
      tab.id
        ? sendToTab(tab.id, {
            action: "settingsChanged",
            settings,
            baseUrl,
          })
        : Promise.resolve(),
    ),
  );
}

chrome.runtime.onInstalled.addListener(async () => {
  const current = await getSettings();
  await chrome.storage.sync.set({ [SETTINGS_KEY]: current });
});

// MV3 may suspend the service worker; flush any pending debounced write so
// the latest in-memory value reaches disk before the worker is torn down.
if (chrome.runtime.onSuspend) {
  chrome.runtime.onSuspend.addListener(flushSave);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.action) {
      case "getSettings": {
        sendResponse({ settings: await getSettings() });
        return;
      }
      case "setSettings": {
        const settings = await saveSettings(message.settings || {});
        await broadcastSettings(settings);
        sendResponse({ ok: true, settings });
        return;
      }
      case "pitchContentReady": {
        const tabId = sender.tab?.id;
        if (typeof tabId !== "number") {
          sendResponse({ ok: false });
          return;
        }
        const settings = await getSettings();
        const payload = {
          action: "settingsChanged",
          settings,
          baseUrl: buildBaseUrl(),
        };
        if (typeof sender.frameId === "number") {
          await sendToFrame(tabId, sender.frameId, payload);
        } else {
          await sendToTab(tabId, payload);
        }
        sendResponse({ ok: true });
        return;
      }
      default:
        sendResponse({ ok: false });
    }
  })();

  return true;
});
