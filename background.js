// Relay everything we get from contentScript to ALL extension pages (including panel)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    console.log("[GA4 Inspector] background got:", msg.type, msg);
    chrome.runtime.sendMessage(msg);
  });
  