(() => {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.action === "ping") {
      sendResponse({ pong: true });
      return false;
    }
    window.dispatchEvent(
      new CustomEvent("drakonPitchFromRuntime", { detail: message }),
    );
  });

  window.addEventListener("drakonPitchFromMain", (event) => {
    try {
      chrome.runtime.sendMessage(event.detail).then(() => {}, () => {});
    } catch (_) {}
  });

  try {
    chrome.runtime.sendMessage({ action: "pitchContentReady" }).then(() => {}, () => {});
  } catch (_) {}
})();
