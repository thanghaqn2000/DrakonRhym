const MIN = -6;
const MAX = 6;
const STEP = 0.1;
const SUPPORTED_LANGS = ["en", "vi", "ja"];
const LANG_STORAGE_KEY = "uiLang";

const slider = document.getElementById("pitch");
const toneValue = document.getElementById("toneValue");
const resetBtn = document.getElementById("reset");
const exportBtn = document.getElementById("exportMp3");
const langBtn = document.getElementById("langToggle");
const langMenu = document.getElementById("langMenu");
const refreshBanner = document.getElementById("refreshBanner");
const refreshBtn = document.getElementById("refreshTab");
const mainContent = document.getElementById("mainContent");
const avatar = document.getElementById("avatar");

avatar.src = "icons/avatar.png";

const localeCache = {};
let currentMessages = {};

function clamp(v) {
  const rounded = Math.round(v / STEP) * STEP;
  return Math.max(MIN, Math.min(MAX, Number(rounded.toFixed(1))));
}

function toSettings(value) {
  const v = Number(value) || 0;
  const sign = v < 0 ? -1 : 1;
  const abs = Math.abs(v);
  const semitones = Math.trunc(abs) * sign;
  const cents = Math.round((abs - Math.trunc(abs)) * 100) * sign;
  return { pitchValueSemitones: semitones, pitchValueCents: cents };
}

function fromSettings(settings) {
  const semis = Number(settings.pitchValueSemitones) || 0;
  const cents = Number(settings.pitchValueCents) || 0;
  return semis + cents / 100;
}

function render(value) {
  slider.value = String(value);
  toneValue.textContent = value.toFixed(1);
  const pct = ((value - MIN) / (MAX - MIN)) * 100;
  const center = 50;
  slider.style.setProperty("--fill-start", `${Math.min(center, pct)}%`);
  slider.style.setProperty("--fill-end", `${Math.max(center, pct)}%`);
}

async function push(value) {
  render(value);
  try {
    await chrome.runtime.sendMessage({
      action: "setSettings",
      settings: toSettings(value),
    });
  } catch (_) {}
}

function t(key, fallback) {
  return currentMessages[key]?.message ?? fallback ?? key;
}

async function loadLocale(code) {
  if (localeCache[code]) return localeCache[code];
  const url = chrome.runtime.getURL(`_locales/${code}/messages.json`);
  const res = await fetch(url);
  const data = await res.json();
  localeCache[code] = data;
  return data;
}

function applyTexts() {
  document.querySelectorAll("[data-i18n]").forEach((el) => {
    el.textContent = t(el.dataset.i18n, el.textContent);
  });
  document.querySelectorAll("[data-i18n-title]").forEach((el) => {
    el.title = t(el.dataset.i18nTitle, el.title);
  });
}

function markActiveLang(code) {
  langMenu.querySelectorAll(".lang-item").forEach((item) => {
    item.classList.toggle("active", item.dataset.lang === code);
  });
}

async function setLanguage(code) {
  const lang = SUPPORTED_LANGS.includes(code) ? code : "vi";
  currentMessages = await loadLocale(lang);
  applyTexts();
  markActiveLang(lang);
  try {
    await chrome.storage.sync.set({ [LANG_STORAGE_KEY]: lang });
  } catch (_) {}
}

function detectDefaultLang() {
  const ui = (chrome.i18n?.getUILanguage?.() || navigator.language || "en").toLowerCase();
  if (ui.startsWith("vi")) return "vi";
  if (ui.startsWith("ja")) return "ja";
  return "en";
}

function openMenu() {
  langMenu.hidden = false;
  langBtn.setAttribute("aria-expanded", "true");
}

function closeMenu() {
  langMenu.hidden = true;
  langBtn.setAttribute("aria-expanded", "false");
}

async function initLanguage() {
  let stored;
  try {
    const data = await chrome.storage.sync.get(LANG_STORAGE_KEY);
    stored = data?.[LANG_STORAGE_KEY];
  } catch (_) {}
  const initial = SUPPORTED_LANGS.includes(stored) ? stored : detectDefaultLang();
  await setLanguage(initial);
}

async function pingTab(tabId) {
  // Content scripts run at document_start but the isolated listener is
  // registered synchronously; a single retry covers the small window
  // where the popup opens mid-navigation before the script has run.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await chrome.tabs.sendMessage(
        tabId,
        { action: "ping" },
        { frameId: 0 },
      );
      if (res?.pong) return true;
    } catch (_) {}
    if (attempt === 0) await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

function setOverlay(visible, tabId) {
  refreshBanner.hidden = !visible;
  mainContent.inert = visible;
  if (visible) {
    refreshBtn.onclick = () => {
      chrome.tabs.reload(tabId);
      window.close();
    };
    refreshBtn.focus();
  }
}

async function checkActiveTabReady() {
  let tab;
  try {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  } catch (_) {
    return;
  }
  if (!tab?.id || !tab.url || !/^https?:/i.test(tab.url)) {
    setOverlay(false);
    return;
  }
  const ready = await pingTab(tab.id);
  setOverlay(!ready, tab.id);
}

async function init() {
  await initLanguage();
  await checkActiveTabReady();

  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const settings = response?.settings || {};
  const initialValue = clamp(fromSettings(settings));
  if (initialValue !== fromSettings(settings)) {
    push(initialValue);
  } else {
    render(initialValue);
  }

  slider.addEventListener("input", () => {
    push(clamp(Number(slider.value)));
  });

  document.querySelectorAll(".quick-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const delta = Number(btn.dataset.delta) || 0;
      push(clamp(Number(slider.value) + delta));
    });
  });

  resetBtn.addEventListener("click", () => push(0));

  exportBtn.addEventListener("click", () => {
    alert(t("uiExportComingSoon", "Export MP3 feature is coming soon."));
  });

  langBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (langMenu.hidden) openMenu();
    else closeMenu();
  });

  langMenu.addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest(".lang-item");
    if (!item) return;
    setLanguage(item.dataset.lang);
    closeMenu();
  });

  document.addEventListener("click", () => closeMenu());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
  });
}

init();
