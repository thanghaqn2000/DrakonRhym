const MIN = -6;
const MAX = 6;
const STEP = 0.1;

const slider = document.getElementById("pitch");
const toneValue = document.getElementById("toneValue");
const resetBtn = document.getElementById("reset");
const exportBtn = document.getElementById("exportMp3");
const avatar = document.getElementById("avatar");

avatar.src = "icons/avatar.png";

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

async function init() {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const settings = response?.settings || {};
  render(clamp(fromSettings(settings)));

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
    alert("Tính năng Xuất MP3 đang phát triển.");
  });
}

init();
