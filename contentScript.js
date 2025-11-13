console.log("[GA4 Inspector] contentScript running");

// Inject injected.js into the PAGE context
(function inject() {
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("injected.js");
  script.onload = function () {
    console.log("[GA4 Inspector] injected.js tag loaded & removed");
    this.remove();
  };
  (document.head || document.documentElement).appendChild(script);
})();

// Listen for messages from injected.js
window.addEventListener("message", (event) => {
  if (event.source !== window) return;

  const data = event.data;
  if (!data || data.source !== "ga4-inspector") return;

  console.log("[GA4 Inspector] contentScript got:", data.type, data);

  // Forward to background
  chrome.runtime.sendMessage({
    type: data.type,
    payload: data.payload
  });
});
