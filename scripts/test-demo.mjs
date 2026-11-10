/**
 * Prueba end-to-end del servidor de la demo (serve-demo.mjs).
 * Lo levanta en un puerto aparte, recorre los cinco pasos por HTTP y lo apaga.
 *
 * Uso: node scripts/test-demo.mjs
 */
import { spawn } from "child_process";

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const child = spawn(process.execPath, ["scripts/serve-demo.mjs"], {
  env: { ...process.env, PORT: String(PORT) },
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d.toString()));
child.stderr.on("data", (d) => (serverLog += d.toString()));

async function api(path, payload) {
  const res = await fetch(`${BASE}/api/${path}`, {
    method: payload ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`${path}: ${data.error}`);
  return data;
}

function ms(order) {
  return (order?.milestones || [])[0] || {};
}

async function waitReady() {
  for (let i = 0; i < 60; i++) {
    try {
      await api("health");
      return;
    } catch {
      await sleep(500);
    }
  }
  throw new Error(`El servidor no respondio.\n${serverLog.slice(-800)}`);
}

try {
  await waitReady();
  const state = await api("state");
  console.log(`servidor ok · contrato ${state.contract} · seller ${state.seller}`);

  console.log("\n--- Flujo feliz: crear, entregar, aprobar ---");
  const a = await api("create", { brief: "Poema corto en ingles sobre orbitas y cuerpo" });
  console.log(`create: ${a.orderId} · ${a.hash}`);
  const d = await api("deliver", { orderId: a.orderId, deliveryUrl: "https://example.com/" });
  console.log(`deliver: ${ms(d.order).status} · ${d.hash}`);
  const ap = await api("approve", { orderId: a.orderId });
  console.log(`approve: ${ms(ap.order).status} · verdict ${ms(ap.order).verdict} · ${ap.hash}`);

  console.log("\n--- Flujo de disputa: crear, entregar 404, disputar, resolver ---");
  const b = await api("create", { brief: "Poema corto en ingles sobre orbitas y cuerpo" });
  console.log(`create: ${b.orderId} · ${b.hash}`);
  const d2 = await api("deliver", {
    orderId: b.orderId,
    deliveryUrl: "https://example.com/does-not-exist-xyz",
  });
  console.log(`deliver: ${ms(d2.order).status} · ${d2.hash}`);
  const dis = await api("dispute", {
    orderId: b.orderId,
    reason: "El enlace entregado devuelve 404 y no hay contenido que evaluar",
  });
  console.log(`dispute: ${ms(dis.order).status} · ${dis.hash}`);
  const r = await api("resolve", { orderId: b.orderId });
  console.log(`resolve: ${ms(r.order).status} · verdict ${ms(r.order).verdict}`);
  console.log(`reason: ${ms(r.order).verdict_reason}`);
  console.log(`tx: ${r.hash}`);

  const final = await api("state");
  console.log(`\nestado final: ${final.orderCount} ordenes`);
  for (const o of final.orders) {
    const m = ms(o);
    console.log(`  ${o.orderId} · ${m.status} · ${m.verdict || "sin veredicto"}`);
  }

  const okA = ms(ap.order).status === "APPROVED";
  const okB = ms(r.order).status === "REFUNDED" && /404/.test(ms(r.order).verdict_reason || "");
  console.log(`\nresultado: aprobacion ${okA ? "SI" : "NO"} · disputa 404 ${okB ? "SI" : "NO"}`);
  if (!okA || !okB) process.exitCode = 1;
} catch (e) {
  console.error("FALLO:", e.message);
  if (serverLog) console.error(serverLog.slice(-1200));
  process.exitCode = 1;
} finally {
  child.kill();
  await sleep(500);
}
