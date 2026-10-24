const els = {
  contract: document.getElementById("state-contract"),
  seller: document.getElementById("state-seller"),
  count: document.getElementById("state-count"),
  order: document.getElementById("state-order"),
  status: document.getElementById("state-status"),
  verdict: document.getElementById("state-verdict"),
  log: document.getElementById("log"),
  brief: document.getElementById("brief"),
  delivery: document.getElementById("delivery"),
  reason: document.getElementById("reason"),
  contractLink: document.getElementById("contract-link"),
  network: document.getElementById("network")
};

const actionButtons = Array.from(document.querySelectorAll("[data-action]"));
let orderId = localStorage.getItem("entropia-studio-order") || "";
let latestStatus = "";
let busy = false;

function stamp() {
  return new Date().toLocaleTimeString("es-MX", { hour12: false });
}

function log(message) {
  const current = els.log.textContent.trim();
  const next = `[${stamp()}] ${message}`;
  els.log.textContent = current && !current.startsWith("Listo.")
    ? `${current}\n${next}`
    : next;
  els.log.scrollTop = els.log.scrollHeight;
}

function applyAvailability() {
  const status = latestStatus.toUpperCase();
  const allowed = {
    create: true,
    deliver: status === "FUNDED" || status === "OPEN",
    dispute: status === "DELIVERED",
    resolve: status === "DISPUTED"
  };
  for (const button of actionButtons) {
    button.disabled = busy || !allowed[button.dataset.action];
  }
}

function setBusy(value) {
  busy = value;
  applyAvailability();
}

async function request(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Error HTTP ${response.status}`);
  return payload;
}

function currentOrder(state) {
  if (!state.orders?.length) return null;
  return state.orders.find((order) => order.orderId === orderId) || state.orders[state.orders.length - 1];
}

function renderState(state) {
  els.contract.textContent = state.contract;
  els.seller.textContent = state.seller;
  els.count.textContent = String(state.orderCount);
  els.contractLink.href = `https://explorer-studio.genlayer.com/address/${state.contract}`;
  els.network.textContent = "Studio · gasless";

  const order = currentOrder(state);
  if (!order) {
    latestStatus = "";
    els.order.textContent = "Sin orden";
    els.status.textContent = "Sin datos";
    els.verdict.textContent = "Sin datos";
    applyAvailability();
    return;
  }

  orderId = order.orderId;
  latestStatus = String(order.status || "");
  localStorage.setItem("entropia-studio-order", orderId);
  els.order.textContent = order.orderId;
  els.status.textContent = order.status || "Sin datos";
  els.verdict.textContent = order.verdict || "Sin datos";
  if (order.verdict_reason) els.verdict.title = order.verdict_reason;
  applyAvailability();
}

async function refresh() {
  const state = await request("/api/state");
  renderState(state);
  return state;
}

async function run(action) {
  if (busy) return;
  setBusy(true);
  const labels = {
    create: "Creando la orden y depositando 0.5 GEN en Studio…",
    deliver: "Registrando la entrega del seller…",
    dispute: "Abriendo la disputa del comprador…",
    resolve: "Ejecutando el juicio con consenso (web + LLM)…"
  };
  log(labels[action] || action);

  try {
    let path = `/api/${action}`;
    let payload = { orderId };

    if (action === "create") {
      payload = { brief: els.brief.value.trim() };
    } else if (action === "deliver") {
      payload = { orderId, deliveryUrl: els.delivery.value.trim() };
    } else if (action === "dispute") {
      payload = { orderId, reason: els.reason.value.trim() };
    }

    const result = await request(path, {
      method: "POST",
      body: JSON.stringify(payload)
    });

    if (result.orderId) {
      orderId = result.orderId;
      localStorage.setItem("entropia-studio-order", orderId);
    }
    log(`Listo · ${result.orderId || "state"} · tx ${result.hash || "sin hash"}`);
    if (result.order?.verdict) log(`Veredicto: ${result.order.verdict}`);
    await refresh();
  } catch (error) {
    log(`Error: ${error.message}`);
  } finally {
    setBusy(false);
  }
}

for (const button of actionButtons) {
  button.addEventListener("click", () => run(button.dataset.action));
}

document.getElementById("clear-log").addEventListener("click", () => {
  els.log.textContent = "Listo.";
});

setBusy(true);
refresh()
  .then(() => setBusy(false))
  .catch((error) => {
    log(`No se pudo leer el contrato: ${error.message}`);
    setBusy(false);
  });
