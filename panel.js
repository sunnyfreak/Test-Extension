// ====== GLOBAL STATE ======
let pages = []; // [{id, url, expanded, activeTab, gtmEvents, ga4Events, selectedGtmId, selectedGa4Id}]
let activePageId = null;
let globalEventCounter = 0;

// ====== POC: hard-coded dataLayer spec ======
const dlSpec = {
  homepage_category_bar: {
    params: {
      page_type: "string",
      cta_text: "string",
      link_path: "string",
      user_type_event: "string",
      User_ID_event: "string",
      PC1: "string",
      PC2: "string",
    },
  },

  about_us_click:{
    params: {
      page_type: "string",
      section_name: "string",
      cta_text: "string",
      sub_section_name: "string",
      selection_type: "string",
      link_path: "string",
      user_type_event: "string",
      User_ID_event: "string",
      PC1: "string",
      PC2: "string",
    },
  }
};



const pageContainer = document.getElementById("pageContainer");

// Optional status bar
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

// When tab navigates, start a new page section
if (chrome.devtools && chrome.devtools.network) {
  chrome.devtools.network.onNavigated.addListener((url) => {
    addNewPage(url);
  });
}

// ====== MESSAGE LISTENERS (GTM / dataLayer) ======

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

// ====== NETWORK LISTENER (GA4 hits → GA4 tab) ======

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

    // Only GA / analytics hosts we care about
    const isAnalyticsHost =
      host.includes("google-analytics.com") ||
      host.includes("analytics.google.com") ||
      host.includes("merchant-center-analytics.goog");

    if (!isAnalyticsHost) return;

    // Collect query params
    const params = {};
    urlObj.searchParams.forEach((value, key) => {
      params[key] = value;
    });

    // Merge POST body params if present
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

    // Detect GA4 by version or 'en' (event name)
    const version = params.v;
    const eventName = params.en;
    const isGA4 = version === "2" || !!eventName;

    if (!isGA4) {
      console.log("[GA4 Inspector] analytics hit ignored (not GA4): v=", version);
      return;
    }

    const name = eventName || "(no en)";

    console.log("[GA4 Inspector] GA4 hit detected:", name, params);

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
    activeTab: "gtm",
    gtmEvents: [],
    ga4Events: [],
    selectedGtmId: null,
    selectedGa4Id: null,
  };

  pages.unshift(page); // newest first
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

// ====== VALIDATION HELPERS (PoC) ======

function getJsType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value; // "string", "number", "boolean", "object", "undefined"
}

function compareEventWithSpec(eventObj) {
  if (!eventObj || !eventObj.name) {
    return {
      hasSpec: false,
      message: "No event name on this push.",
    };
  }

  const spec = dlSpec[eventObj.name];
  if (!spec) {
    return {
      hasSpec: false,
      message: "No spec defined for this event in dlSpec.",
    };
  }

  const expectedParams = spec.params || {};
  const expectedKeys = Object.keys(expectedParams);

  // Actual params: take top-level keys except "event" and "gtm"
  const actualPayload = eventObj.payload || {};
  const actualKeys = Object.keys(actualPayload).filter(
    (k) => k !== "event" && !k.startsWith("gtm.")
  );

  const missing = [];
  const extra = [];
  const typeMismatches = [];

  // Check expected vs actual
  expectedKeys.forEach((key) => {
    if (!actualKeys.includes(key)) {
      missing.push(key);
    } else {
      const expectedType = expectedParams[key];
      const actualType = getJsType(actualPayload[key]);
      if (expectedType && expectedType !== actualType) {
        typeMismatches.push({
          key,
          expectedType,
          actualType,
        });
      }
    }
  });

  // Find extra keys not in spec
  actualKeys.forEach((key) => {
    if (!expectedKeys.includes(key)) {
      extra.push(key);
    }
  });

  return {
    hasSpec: true,
    eventName: eventObj.name,
    expectedCount: expectedKeys.length,
    actualCount: actualKeys.length,
    missing,
    extra,
    typeMismatches,
  };
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

      // Tabs
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

      // Counts line
      const counts = document.createElement("div");
      counts.style.fontSize = "10px";
      counts.style.color = "#aaa";
      counts.style.margin = "4px 0";
      counts.textContent =
        `GTM events: ${page.gtmEvents.length} | ` +
        `GA4 events (network hits): ${page.ga4Events.length}`;
      body.appendChild(counts);

      // Which events to show?
      const eventsToShow =
        page.activeTab === "gtm" ? page.gtmEvents : page.ga4Events;

      if (!eventsToShow.length) {
        const empty = document.createElement("div");
        empty.className = "no-events";
        empty.textContent =
          page.activeTab === "gtm"
            ? "No GTM (dataLayer) events captured yet."
            : "No GA4 hits captured yet. Keep the panel open and reload.";
        body.appendChild(empty);
      } else {
        // ----- Master-detail layout -----
        const layout = document.createElement("div");
        layout.className = "events-layout";

        // figure out selected event for this tab
        let selectedId =
          page.activeTab === "gtm" ? page.selectedGtmId : page.selectedGa4Id;

        if (!selectedId && eventsToShow.length) {
          selectedId = eventsToShow[0].id;
        }
        let selectedEvent =
          eventsToShow.find((ev) => ev.id === selectedId) ||
          eventsToShow[0];

        if (page.activeTab === "gtm") {
          page.selectedGtmId = selectedEvent ? selectedEvent.id : null;
        } else {
          page.selectedGa4Id = selectedEvent ? selectedEvent.id : null;
        }

        // LEFT: events list
        const listDiv = document.createElement("div");
        listDiv.className = "events-list";

        eventsToShow.forEach((ev) => {
          const row = document.createElement("div");
          row.className = "event-row";
          if (selectedEvent && ev.id === selectedEvent.id) {
            row.classList.add("active");
          }

          const idx = document.createElement("span");
          idx.className = "event-index";
          idx.textContent = `#${ev.id}`;

          const title = document.createElement("span");
          title.className = "event-title";
          title.textContent = ev.name || "(no name)";

          row.appendChild(idx);
          row.appendChild(title);

          row.addEventListener("click", () => {
            if (page.activeTab === "gtm") {
              page.selectedGtmId = ev.id;
            } else {
              page.selectedGa4Id = ev.id;
            }
            render();
          });

          listDiv.appendChild(row);
        });

        // RIGHT: details pane
const details = document.createElement("div");
details.className = "events-details";

if (selectedEvent) {
  const header = document.createElement("div");
  header.className = "details-header";

  const left = document.createElement("div");
  left.innerHTML =
    `<span class="details-event-name">${selectedEvent.name ||
      "(no name)"}</span>`;

  const right = document.createElement("div");
  right.textContent =
    page.activeTab === "gtm"
      ? "Source: GTM / dataLayer"
      : "Source: GA4 network hit";

  header.appendChild(left);
  header.appendChild(right);
  details.appendChild(header);

  // --- PoC validation summary for GTM events ---
  if (page.activeTab === "gtm") {
    const v = compareEventWithSpec(selectedEvent);

    const summary = document.createElement("div");
    summary.style.fontSize = "10px";
    summary.style.margin = "4px 0 6px";
    summary.style.padding = "4px 6px";
    summary.style.borderRadius = "4px";
    summary.style.background = v.hasSpec ? "#101829" : "#291010";

    if (!v.hasSpec) {
      summary.textContent = `Validation: ${v.message}`;
    } else {
      const lines = [];

      lines.push(
        `Spec found for "${v.eventName}" · Expected params: ${v.expectedCount} · Actual: ${v.actualCount}`
      );

      if (v.missing.length) {
        lines.push(`Missing: ${v.missing.join(", ")}`);
      }
      if (v.extra.length) {
        lines.push(`Extra: ${v.extra.join(", ")}`);
      }
      if (v.typeMismatches.length) {
        const t = v.typeMismatches
          .map(
            (m) => `${m.key} (expected ${m.expectedType}, got ${m.actualType})`
          )
          .join("; ");
        lines.push(`Type mismatches: ${t}`);
      }

      if (!v.missing.length && !v.extra.length && !v.typeMismatches.length) {
        lines.push("✅ All parameters match the spec.");
      }

      summary.textContent = "Validation: " + lines.join(" · ");
    }

    details.appendChild(summary);
  }

  // Payload JSON
  const pre = document.createElement("pre");
  pre.className = "payload-pre";
  pre.textContent = JSON.stringify(selectedEvent.payload, null, 2);

  details.appendChild(pre);
} else {
  const emptyDetail = document.createElement("div");
  emptyDetail.className = "no-events";
  emptyDetail.textContent = "No event selected.";
  details.appendChild(emptyDetail);
}


        layout.appendChild(listDiv);
        layout.appendChild(details);
        body.appendChild(layout);
      }

      section.appendChild(body);
    }

    pageContainer.appendChild(section);
  });
}
