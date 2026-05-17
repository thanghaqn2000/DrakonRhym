const DEFAULT_SETTINGS = {
  pitchValueSemitones: 0,
  pitchValueCents: 0,
  windowSizeMilliseconds: 120,
};

const SETTINGS_KEY = "settings";

async function getSettings() {
  const data = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(settings) {
  const merged = { ...(await getSettings()), ...settings };
  await chrome.storage.sync.set({ [SETTINGS_KEY]: merged });
  return merged;
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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log("SW received:", message); 
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
