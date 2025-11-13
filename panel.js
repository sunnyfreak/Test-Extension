// ====== GLOBAL STATE ======
let pages = []; // [{id, url, expanded, activeTab, gtmEvents, ga4Events}]
let activePageId = null;
let globalEventCounter = 0;

const pageContainer = document.getElementById("pageContainer");

// small helper: status bar if present
const statusBar = document.getElementById("statusBar");
const devtoolsAvailable = !!chrome.devtools;
const networkAvailable = devtoolsAvailable && !!chrome.devtools.network;

if (statusBar) {
  statusBar.textContent =
    "DevTools: " +
    (devtoolsAvailable ? "OK" : "NOT AVAILABLE") +
    " | Network API: " +
    (networkAvailable ? "OK" : "NOT AVAILABLE");
}

console.log(
  "[GA4 Inspector] panel loaded. devtools?",
  devtoolsAvailable,
  "network?",
  networkAvailable
);

// ====== INITIAL PAGE CREATION ======

// Create initial page for current URL
chrome.devtools.inspectedWindow.eval("location.href", (href, exceptionInfo) => {
  const url = href || "unknown";
  addNewPage(url);
});

// On navigation, create a new page section & collapse previous
if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onNavigated.addListener((url) => {
    addNewPage(url);
  });
}

// ====== MESSAGE LISTENERS (GTM) ======

// GTM events from background (dataLayer)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "dataLayerPush") {
    const args = msg.payload?.args || [];
    const first = Array.isArray(args) ? args[0] : args;
    const name = first && first.event ? first.event : "(no event)";

    pushEventToCurrentPage("gtm", {
      rawType: "dataLayerPush",
      name,
      payload: first,
    });
  } else if (msg.type === "dataLayerInit") {
    pushEventToCurrentPage("gtm", {
      rawType: "dataLayerInit",
      name: "[dataLayer init]",
      payload: msg.payload?.data || [],
    });
  }
});

// ====== MESSAGE LISTENER (NETWORK → GA4 TAB) ======

// TEMP: push EVERY network request into GA4 tab to confirm UI pipeline
// GA4 / GA measurement hits → GA4 tab
if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onRequestFinished.addListener((request) => {
    const reqUrl = request.request?.url || "";
    if (!reqUrl) return;

    console.log("[GA4 Inspector] network request:", reqUrl);

    let urlObj;
    try {
      urlObj = new URL(reqUrl);
    } catch (e) {
      console.warn("[GA4 Inspector] bad URL:", reqUrl);
      return;
    }

    const host = urlObj.hostname || "";
    const path = urlObj.pathname || "";

    // 1) Only GA / analytics hosts
    const isAnalyticsHost =
      host.includes("google-analytics.com") ||
      host.includes("analytics.google.com") ||
      host.includes("merchant-center-analytics.goog");

    if (!isAnalyticsHost) return;

    // 2) Collect query params
    const params = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // 3) Merge POST body params if present
    if (request.request.postData && request.request.postData.text) {
      const bodyText = request.request.postData.text;
      try {
        const bodyParams = new URLSearchParams(bodyText);
        bodyParams.forEach((value, key) => {
          if (!(key in params)) {
            params[key] = value;
          }
        });
      } catch (e) {
        console.warn("[GA4 Inspector] cannot parse POST body as URLSearchParams");
      }
    }

    // 4) Detect GA4 vs ignore
    // GA4 web hits: v=2, have 'en' (event name)
    const version = params.v;
    const eventName = params.en;
    const isGA4 = version === "2" || !!eventName;

    if (!isGA4) {
      // You *could* later add a separate UA/other tab here
      console.log("[GA4 Inspector] analytics hit ignored (not GA4): v=", version);
      return;
    }

    const name = eventName || "(no en)";

    console.log("[GA4 Inspector] GA4 hit detected:", name, params);

    // 5) Push into GA4 events for current page
    pushEventToCurrentPage("ga4", {
      rawType: "ga4-hit",
      name,
      payload: {
        ...params,
        _host: host,
        _path: path,
      },
    });
  });
} else {
  console.warn("[GA4 Inspector] chrome.devtools.network not available in panel");
}


// ====== STATE HELPERS ======

function addNewPage(url) {
  // Collapse previous active page
  if (activePageId !== null) {
    const prev = pages.find((p) => p.id === activePageId);
    if (prev) prev.expanded = false;
  }

  const id = Date.now() + Math.random();

  const page = {
    id,
    url,
    expanded: true,
    activeTab: "gtm", // default tab
    gtmEvents: [],
    ga4Events: [],
  };

  pages.unshift(page); // newest page at top
  activePageId = id;

  console.log("[GA4 Inspector] addNewPage", url, "id:", id);
  render();
}

function getActivePage() {
  if (activePageId == null) return null;
  return pages.find((p) => p.id === activePageId) || null;
}

function pushEventToCurrentPage(source, eventData) {
  const page = getActivePage();

  console.log(
    "[GA4 Inspector] pushEventToCurrentPage called",
    "source:",
    source,
    "hasPage:",
    !!page,
    "activePageId:",
    activePageId
  );

  if (!page) {
    console.warn(
      "[GA4 Inspector] No active page when pushing event:",
      source,
      eventData
    );
    return;
  }

  const event = {
    id: ++globalEventCounter,
    source, // 'gtm' | 'ga4'
    ...eventData,
  };

  if (source === "gtm") {
    page.gtmEvents.push(event);
  } else if (source === "ga4") {
    page.ga4Events.push(event);
  } else {
    console.warn("[GA4 Inspector] Unknown source type:", source);
  }

  render();
}

// ====== RENDERING ======

function render() {
  if (!pageContainer) return;

  pageContainer.innerHTML = "";

  pages.forEach((page) => {
    const section = document.createElement("div");
    section.className = "page-section";

    // ---- Header ----
    const header = document.createElement("div");
    header.className = "page-header";

    const chevron = document.createElement("span");
    chevron.className = "chevron";
    chevron.textContent = page.expanded ? "▼" : "▶";

    const urlSpan = document.createElement("span");
    urlSpan.className = "page-url";
    urlSpan.textContent = page.url;

    header.appendChild(chevron);
    header.appendChild(urlSpan);

    header.addEventListener("click", () => {
      page.expanded = !page.expanded;
      render();
    });

    section.appendChild(header);

    // ---- Body ----
    if (page.expanded) {
      const body = document.createElement("div");
      body.className = "page-body";

      // Tabs row
      const tabs = document.createElement("div");
      tabs.className = "tabs";

      const gtmBtn = document.createElement("button");
      gtmBtn.className =
        "tab-btn" + (page.activeTab === "gtm" ? " active" : "");
      gtmBtn.textContent = `GTM (${page.gtmEvents.length})`;
      gtmBtn.addEventListener("click", () => {
        page.activeTab = "gtm";
        render();
      });

      const ga4Btn = document.createElement("button");
      ga4Btn.className =
        "tab-btn" + (page.activeTab === "ga4" ? " active" : "");
      ga4Btn.textContent = `GA4 (${page.ga4Events.length})`;
      ga4Btn.addEventListener("click", () => {
        page.activeTab = "ga4";
        render();
      });

      tabs.appendChild(gtmBtn);
      tabs.appendChild(ga4Btn);
      body.appendChild(tabs);

      // Small counts line for extra clarity
      const counts = document.createElement("div");
      counts.style.fontSize = "10px";
      counts.style.color = "#aaa";
      counts.style.margin = "4px 0";
      counts.textContent =
        `GTM events: ${page.gtmEvents.length} | ` +
        `GA4 events (network hits): ${page.ga4Events.length}`;
      body.appendChild(counts);

      // Table
      const table = document.createElement("table");

      const thead = document.createElement("thead");
      thead.innerHTML = `
        <tr>
          <th>#</th>
          <th>Type</th>
          <th>Event / URL</th>
          <th>Payload</th>
        </tr>
      `;
      table.appendChild(thead);

      const tbody = document.createElement("tbody");

      const eventsToShow =
        page.activeTab === "gtm" ? page.gtmEvents : page.ga4Events;

      if (!eventsToShow.length) {
        const tr = document.createElement("tr");
        const td = document.createElement("td");
        td.colSpan = 4;
        td.className = "no-events";
        td.textContent =
          page.activeTab === "gtm"
            ? "No GTM (dataLayer) events captured yet."
            : "No network events captured yet. Make sure the panel is open, then reload the page.";
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        eventsToShow.forEach((ev) => {
          const tr = document.createElement("tr");

          const tdIndex = document.createElement("td");
          tdIndex.textContent = String(ev.id);

          const tdType = document.createElement("td");
          tdType.textContent = ev.rawType || ev.source;

          const tdName = document.createElement("td");
          tdName.className = "event-name";
          tdName.textContent = ev.name;

          const tdPayload = document.createElement("td");
          tdPayload.textContent = JSON.stringify(ev.payload, null, 2);

          tr.appendChild(tdIndex);
          tr.appendChild(tdType);
          tr.appendChild(tdName);
          tr.appendChild(tdPayload);

          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      body.appendChild(table);

      section.appendChild(body);
    }

    pageContainer.appendChild(section);
  });
}
