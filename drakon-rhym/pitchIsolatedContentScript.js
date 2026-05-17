(() => {
  chrome.runtime.onMessage.addListener((message) => {
         console.log("Content script received:", message); 
    window.dispatchEvent(
      new CustomEvent("drakonPitchFromRuntime", { detail: message }),
    );
  });

  window.addEventListener("drakonPitchFromMain", (event) => {
    try {
      chrome.runtime
        .sendMessage(event.detail)
        .then(() => {}, () => {});
    } catch (_) {}
  });

  try {
    chrome.runtime
      .sendMessage({ action: "pitchContentReady" })
      .then(() => {}, () => {});
  } catch (_) {}
})();
