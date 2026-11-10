/**
 * Smoke test del MilestoneEscrow desplegado en Studio.
 *
 * Caso 1: orden con TTL de 60s, entrega tardia rechazada y refund del comprador.
 * Caso 2: entrega con URL 404, disputa y liquidacion terminal en refund.
 *
 * Uso: CONTRACT_ADDRESS=0x... node scripts/smoke-milestone.mjs
 */
import { readFileSync } from "fs";
import { createClient, createAccount } from "genlayer-js-legacy";
import { studionet } from "genlayer-js-legacy/chains";
import { TransactionStatus } from "genlayer-js-legacy/types";

const address = process.env.CONTRACT_ADDRESS;
if (!address) throw new Error("Falta CONTRACT_ADDRESS");

const keys = JSON.parse(readFileSync(".secrets/demo-keys.json", "utf8"));
const sellerAccount = createAccount(keys.seller);
const buyerAccount = createAccount(keys.buyer);
const seller = createClient({ chain: studionet, account: sellerAccount });
const buyer = createClient({ chain: studionet, account: buyerAccount });

const BRIEF = "Entregar poema corto en ingles sobre orbitas y cuerpo";
const DEPOSIT = 500000000000000000n; // 0.5 GEN
const MISSING_URL = "https://example.com/does-not-exist-xyz";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function wait(hash, label) {
  await sleep(3000);
  const receipt = await buyer.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 300,
  });
  const leader = receipt.consensus_data?.leader_receipt?.[0];
  const result = leader?.execution_result || receipt.result_name;
  console.log(`${label}: ${hash} -> ${result}`);
  if (result && result !== "SUCCESS") {
    const stderr = (leader?.genvm_result?.stderr || "").trim();
    if (stderr) console.log(`  stderr: ${stderr.slice(0, 300)}`);
  }
  return { receipt, result };
}

async function newOrder(ttl) {
  const hash = await buyer.writeContract({
    address,
    functionName: "create_order",
    args: [[BRIEF], [String(DEPOSIT)], ttl],
    value: DEPOSIT,
  });
  await wait(hash, "create_order");
  const count = await buyer.readContract({
    address,
    functionName: "get_order_count",
    args: [],
  });
  const orderId = `ms-${Number(count) - 1}`;
  console.log("order:", orderId);
  return orderId;
}

async function readMilestone(orderId, index) {
  const order = await buyer.readContract({
    address,
    functionName: "get_order",
    args: [orderId],
  });
  return order.milestones[index];
}

console.log("--- Caso 1: entrega tardia ---");
const lateOrder = await newOrder(60);
console.log("esperando 65s para pasar el deadline...");
await sleep(65000);
const lateHash = await seller.writeContract({
  address,
  functionName: "submit_delivery",
  args: [lateOrder, 0, "https://example.com/poema.json", "entrega tardia"],
});
const late = await wait(lateHash, "submit_delivery (tardia)");
const refundHash = await buyer.writeContract({
  address,
  functionName: "claim_timeout",
  args: [lateOrder, 0],
});
await wait(refundHash, "claim_timeout");
const lateMs = await readMilestone(lateOrder, 0);
console.log("estado:", lateMs.status, "| rechazo tardio:", late.result !== "SUCCESS" ? "SI" : "NO");

console.log("\n--- Caso 2: entrega 404 ---");
const missingOrder = await newOrder(3600);
const deliverHash = await seller.writeContract({
  address,
  functionName: "submit_delivery",
  args: [missingOrder, 0, MISSING_URL, "entrega con enlace roto"],
});
await wait(deliverHash, "submit_delivery");
const disputeHash = await buyer.writeContract({
  address,
  functionName: "dispute_milestone",
  args: [missingOrder, 0, "El enlace entregado devuelve 404 y no hay contenido que evaluar"],
});
await wait(disputeHash, "dispute_milestone");
const resolveHash = await buyer.writeContract({
  address,
  functionName: "resolve_dispute",
  args: [missingOrder, 0],
});
const resolved = await wait(resolveHash, "resolve_dispute");
const missingMs = await readMilestone(missingOrder, 0);
console.log("estado:", missingMs.status);
console.log("verdict:", missingMs.verdict);
console.log("verdict_reason:", missingMs.verdict_reason);
console.log("liquidacion terminal en 404:", resolved.result === "SUCCESS" && missingMs.status === "REFUNDED" ? "SI" : "NO");
