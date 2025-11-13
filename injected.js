console.log("[GA4 Inspector] injected.js running in PAGE", window.location.href);

(function () {
  window.dataLayer = window.dataLayer || [];

  // Send initial snapshot
  try {
    window.postMessage(
      {
        source: "ga4-inspector",
        type: "dataLayerInit",
        payload: { data: window.dataLayer }
      },
      "*"
    );
  } catch (e) {
    console.warn("[GA4 Inspector] failed to send init", e);
  }

  // Hook dataLayer.push
  const originalPush = window.dataLayer.push;

  window.dataLayer.push = function () {
    const args = Array.from(arguments);

    try {
      window.postMessage(
        {
          source: "ga4-inspector",
          type: "dataLayerPush",
          payload: { args }
        },
        "*"
      );
    } catch (e) {
      console.warn("[GA4 Inspector] failed to postMessage", e);
    }

    return originalPush.apply(this, args);
  };
})();
