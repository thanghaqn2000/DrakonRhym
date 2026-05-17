const defaults = {
  pitchValueCents: 0,
  pitchValueSemitones: 0,
  windowSizeMilliseconds: 120,
};

const semitonesInput = document.getElementById("semitones");
const centsInput = document.getElementById("cents");
const windowSizeInput = document.getElementById("windowSizeMilliseconds");
const resetButton = document.getElementById("reset");

const semitonesValue = document.getElementById("semitonesValue");
const centsValue = document.getElementById("centsValue");
const windowSizeValue = document.getElementById("windowSizeValue");

function render(settings) {
  semitonesInput.value = String(settings.pitchValueSemitones);
  centsInput.value = String(settings.pitchValueCents);
  windowSizeInput.value = String(settings.windowSizeMilliseconds);

  semitonesValue.textContent = `${settings.pitchValueSemitones} st`;
  centsValue.textContent = `${settings.pitchValueCents} ct`;
  windowSizeValue.textContent = `${settings.windowSizeMilliseconds} ms`;
}

async function updateSettings() {
  const payload = {
    pitchValueSemitones: Number(semitonesInput.value),
    pitchValueCents: Number(centsInput.value),
    windowSizeMilliseconds: Number(windowSizeInput.value),
  };

  render({ ...defaults, ...payload });
  await chrome.runtime.sendMessage({ action: "setSettings", settings: payload });
}

async function init() {
  const response = await chrome.runtime.sendMessage({ action: "getSettings" });
  const settings = { ...defaults, ...(response?.settings || {}) };
  render(settings);

  semitonesInput.addEventListener("input", updateSettings);
  centsInput.addEventListener("input", updateSettings);
  windowSizeInput.addEventListener("input", updateSettings);
  resetButton.addEventListener("click", async () => {
    render(defaults);
    await chrome.runtime.sendMessage({
      action: "setSettings",
      settings: defaults,
    });
  });
}

init();
