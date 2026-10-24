import { createServer } from "http";
import { readFileSync, existsSync } from "fs";
import { extname, join, normalize, resolve } from "path";
import { fileURLToPath } from "url";
import { createClient, createAccount } from "genlayer-js-legacy";
import { studionet } from "genlayer-js-legacy/chains";
import { TransactionStatus } from "genlayer-js-legacy/types";

const ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_ROOT = join(ROOT, "web");
const KEYS_PATH = join(ROOT, ".secrets", "demo-keys.json");
const PORT = Number(process.env.PORT || 4317);
const CONTRACT_ADDRESS =
  process.env.CONTRACT_ADDRESS || "0x6f482A969e605e824a73fC0Fd9225490e90Dc307";
const DEPOSIT_ATTO = 500000000000000000n;
const DEFAULT_BRIEF =
  "Pieza de videodanza generativa sobre cuerpo y tecnologia. Tema: soberania de datos y danza contemporanea expandida. Formato: texto poetico para metadata NFT.";

if (!existsSync(KEYS_PATH)) {
  console.error(`Falta ${KEYS_PATH}. Corre primero scripts/demo.mjs para generar las llaves de Studio.`);
  process.exit(1);
}

const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8"));
const sellerAccount = createAccount(keys.seller);
const buyerAccount = createAccount(keys.buyer);
const seller = createClient({ chain: studionet, account: sellerAccount });
const buyer = createClient({ chain: studionet, account: buyerAccount });

let writeQueue = Promise.resolve();

function withLock(fn) {
  const run = writeQueue.then(fn, fn);
  writeQueue = run.catch(() => {});
  return run;
}

const sleep = (ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms));

function toJson(value) {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(toJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, toJson(item)]));
  }
  return value;
}

async function waitAccepted(client, hash, label) {
  await sleep(3000);
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 300
  });
  const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  const result = execution || receipt.result_name;
  if (result && result !== "SUCCESS") {
    const stderr = receipt.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
    throw new Error(`${label} fallo: ${result}\n${stderr}`);
  }
  return receipt;
}

async function readOrder(orderId) {
  const order = await seller.readContract({
    address: CONTRACT_ADDRESS,
    functionName: "get_order",
    args: [orderId]
  });
  return toJson(order);
}

async function readState() {
  const [sellerAddress, count] = await Promise.all([
    seller.readContract({ address: CONTRACT_ADDRESS, functionName: "get_seller", args: [] }),
    seller.readContract({ address: CONTRACT_ADDRESS, functionName: "get_order_count", args: [] })
  ]);
  const total = Number(count);
  const ids = [];
  for (let i = Math.max(0, total - 3); i < total; i++) ids.push(`ord-${i}`);
  const orders = [];
  for (const orderId of ids) {
    try {
      orders.push({ orderId, ...(await readOrder(orderId)) });
    } catch {
      // Una orden historica puede no ser legible; no romper el estado.
    }
  }
  return {
    contract: CONTRACT_ADDRESS,
    seller: sellerAddress,
    buyer: buyerAccount.address,
    orderCount: total,
    orders
  };
}

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function text(res, status, body, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "content-type": contentType });
  res.end(body);
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error("El cuerpo del request es demasiado grande.");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function handleAction(action, payload) {
  if (action === "state") return readState();

  if (action === "create") {
    const brief = String(payload.brief || DEFAULT_BRIEF).trim();
    if (!brief) throw new Error("El brief no puede estar vacio.");
    const count = await buyer.readContract({
      address: CONTRACT_ADDRESS,
      functionName: "get_order_count",
      args: []
    });
    const orderId = `ord-${count}`;
    const hash = await buyer.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "create_order",
      args: [brief, 3600],
      value: DEPOSIT_ATTO
    });
    await waitAccepted(buyer, hash, "create_order");
    return { orderId, hash, order: await readOrder(orderId) };
  }

  const orderId = String(payload.orderId || "").trim();
  if (!orderId) throw new Error("Falta orderId. Crea una orden primero.");
  const current = await readOrder(orderId);
  const status = String(current.status || "").toUpperCase();

  if (action === "deliver" && !["FUNDED", "OPEN"].includes(status)) {
    throw new Error(`La orden ${orderId} está en ${status || "sin estado"}, no se puede entregar.`);
  }
  if (action === "dispute" && status !== "DELIVERED") {
    throw new Error(`La orden ${orderId} está en ${status || "sin estado"}, no se puede disputar.`);
  }
  if (action === "resolve" && status !== "DISPUTED") {
    throw new Error(`La orden ${orderId} está en ${status || "sin estado"}, no se puede resolver.`);
  }

  if (action === "deliver") {
    const url = String(payload.deliveryUrl || "https://example.com/").trim();
    if (!/^https?:\/\//.test(url)) throw new Error("La URL debe empezar con http:// o https://");
    const hash = await seller.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "submit_delivery",
      args: [orderId, url, "Entrega generada por entropiav2"]
    });
    await waitAccepted(seller, hash, "submit_delivery");
    return { orderId, hash, order: await readOrder(orderId) };
  }

  if (action === "dispute") {
    const reason = String(payload.reason || "La entrega no cumple el brief.").trim();
    const hash = await buyer.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "dispute",
      args: [orderId, reason]
    });
    await waitAccepted(buyer, hash, "dispute");
    return { orderId, hash, order: await readOrder(orderId) };
  }

  if (action === "resolve") {
    const hash = await buyer.writeContract({
      address: CONTRACT_ADDRESS,
      functionName: "resolve_dispute",
      args: [orderId]
    });
    await waitAccepted(buyer, hash, "resolve_dispute");
    return { orderId, hash, order: await readOrder(orderId) };
  }

  throw new Error(`Accion desconocida: ${action}`);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2"
};

function serveStatic(res, pathname) {
  const relative = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = normalize(join(WEB_ROOT, relative));
  if (!filePath.startsWith(WEB_ROOT)) {
    text(res, 403, "Forbidden");
    return;
  }
  if (!existsSync(filePath)) {
    text(res, 404, "Not found");
    return;
  }
  const ext = extname(filePath);
  text(res, 200, readFileSync(filePath), MIME[ext] || "application/octet-stream");
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    const action = url.pathname.slice("/api/".length);
    try {
      const payload = req.method === "POST" ? await bodyJson(req) : {};
      const result = await withLock(() => handleAction(action, payload));
      json(res, 200, result);
    } catch (error) {
      json(res, 400, { error: error.message || String(error) });
    }
    return;
  }
  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Escrow Studio demo en http://localhost:${PORT}`);
  console.log(`Contrato: ${CONTRACT_ADDRESS}`);
  console.log(`Seller: ${sellerAccount.address}`);
  console.log(`Buyer: ${buyerAccount.address}`);
  console.log("Studio es gasless. No se usan fondos reales.");
});
