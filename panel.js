let eventCounter = 0;
const tbody = document.querySelector("#eventsTable tbody");

// Listen for messages from background.js
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[GA4 Inspector] panel got:", msg.type, msg);
  addEventRow(msg);
});

function addEventRow(msg) {
  eventCounter++;

  const tr = document.createElement("tr");

  const tdIndex = document.createElement("td");
  tdIndex.textContent = eventCounter;

  const tdType = document.createElement("td");
  tdType.textContent = msg.type;

  const tdName = document.createElement("td");
  tdName.className = "event-name";

  const tdPayload = document.createElement("td");

  if (msg.type === "dataLayerPush") {
    const args = msg.payload?.args || [];
    const first = Array.isArray(args) ? args[0] : args;
    const eventName = first && first.event ? first.event : "(no event)";
    tdName.textContent = eventName;
    tdPayload.textContent = JSON.stringify(first, null, 2);
  } else if (msg.type === "dataLayerInit") {
    tdName.textContent = "[dataLayer init]";
    tdPayload.textContent = JSON.stringify(msg.payload?.data || [], null, 2);
  } else {
    tdName.textContent = "(other)";
    tdPayload.textContent = JSON.stringify(msg.payload || {}, null, 2);
  }

  tr.appendChild(tdIndex);
  tr.appendChild(tdType);
  tr.appendChild(tdName);
  tr.appendChild(tdPayload);

  tbody.appendChild(tr);
}
