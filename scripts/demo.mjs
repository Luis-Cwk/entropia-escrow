/**
 * Demo end-to-end del escrow de composiciones en Studio.
 *
 * Usa genlayer-js 1.1.8 (legacy) porque el SDK 2.0.0-rc.2 todavía no habla
 * con el RPC de Studio (`sim_getFeeConfig`). Para Bradbury Phase 2 usa
 * scripts/demo-bradbury.ps1 + scripts/create-order.mjs.
 *
 * Uso:
 *   node scripts/demo.mjs
 *   CONTRACT_ADDRESS=0x... node scripts/demo.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createClient, createAccount, generatePrivateKey } from "genlayer-js-legacy";
import { studionet } from "genlayer-js-legacy/chains";
import { TransactionStatus } from "genlayer-js-legacy/types";

const NETWORKS = {
  studionet,
};

const network = process.env.GENLAYER_NETWORK || "studionet";
if (network !== "studionet") {
  throw new Error("demo.mjs es solo Studio; para Bradbury Phase 2 usa scripts/demo-bradbury.ps1");
}
const chain = NETWORKS[network];

const KEYS_PATH = ".secrets/demo-keys.json";
const CONTRACT_PATH = "contracts/composition_escrow.py";
const DEPOSIT_ATTO = 500000000000000000n; // 0.5 GEN

const DELIVERY_GOOD = "https://paste.rs/lx5bV";
const DELIVERY_BAD = "https://example.com/";
const BRIEF = "Pieza de videodanza generativa sobre cuerpo y tecnologia. Tema: soberania de datos y danza contemporanea expandida. Formato: texto poetico para metadata NFT.";
const DISPUTE_GOOD = "El texto entregado no menciona danza ni cuerpo como pedia el brief.";
const DISPUTE_BAD = "La entrega es una pagina generica que no tiene relacion con el brief.";

function loadKeys() {
  if (existsSync(KEYS_PATH)) return JSON.parse(readFileSync(KEYS_PATH, "utf8"));
  mkdirSync(".secrets", { recursive: true });
  const keys = { seller: generatePrivateKey(), buyer: generatePrivateKey() };
  writeFileSync(KEYS_PATH, JSON.stringify(keys, null, 2));
  return keys;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry(label, fn, attempts = 3) {
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      const message = String(error?.message || error);
      const transient = message.includes("is not valid JSON") || message.includes("429") || message.includes("RPC error");
      if (i === attempts || !transient) throw error;
      console.log(`  ${label}: error transitorio (${message.slice(0, 80)}), reintento ${i}/${attempts - 1} en 10s...`);
      await sleep(10000);
    }
  }
}

async function waitSuccess(client, hash, label) {
  await sleep(3000); // studionet limita 60 req/min
  const receipt = await withRetry(label, () =>
    client.waitForTransactionReceipt({
      hash,
      status: TransactionStatus.ACCEPTED,
      retries: 300,
    }),
  );
  const executionResult = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  const result = executionResult || receipt.result_name;
  console.log(`  ${label}: ${hash} -> ${result || receipt.status_name}`);
  if (result && result !== "SUCCESS") {
    const stderr = receipt.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || "";
    throw new Error(`${label} fallo: ${result}\n${stderr}`);
  }
  return receipt;
}

function extractContractAddress(receipt) {
  return (
    receipt.data?.contract_address ||
    receipt.contractAddress ||
    receipt.tx_data_decoded?.contract_address ||
    receipt.consensus_data?.leader_receipt?.[0]?.contract_address ||
    receipt.to_address ||
    receipt.recipient ||
    null
  );
}

async function main() {
  const keys = loadKeys();
  const sellerAccount = createAccount(keys.seller);
  const buyerAccount = createAccount(keys.buyer);
  const seller = createClient({ chain, account: sellerAccount });
  const buyer = createClient({ chain, account: buyerAccount });

  console.log(`Red: ${network}`);
  console.log(`Seller (agente): ${sellerAccount.address}`);
  console.log(`Buyer (cliente): ${buyerAccount.address}`);
  console.log("");

  let contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    console.log("Desplegando CompositionEscrow...");
    const code = new Uint8Array(readFileSync(CONTRACT_PATH));
    const deployHash = await seller.deployContract({ code, args: [sellerAccount.address] });
    const receipt = await waitSuccess(seller, deployHash, "deploy");
    contractAddress = extractContractAddress(receipt);
    if (!contractAddress) throw new Error("No se obtuvo contract_address del deploy");
    console.log(`Contrato: ${contractAddress}`);
  } else {
    console.log(`Contrato existente: ${contractAddress}`);
  }
  console.log("");

  async function runCase(label, deliveryUrl, disputeReason, expected) {
    console.log(`--- Caso: ${label} (esperado: ${expected}) ---`);
    const orderId = `ord-${await buyer.readContract({
      address: contractAddress, functionName: "get_order_count", args: [],
    })}`;
    console.log(`Pedido ${orderId}: depositando 0.5 GEN...`);
    const createHash = await buyer.writeContract({
      address: contractAddress,
      functionName: "create_order",
      args: [BRIEF, 3600],
      value: DEPOSIT_ATTO,
    });
    await waitSuccess(buyer, createHash, "create_order");

    const deliverHash = await seller.writeContract({
      address: contractAddress,
      functionName: "submit_delivery",
      args: [orderId, deliveryUrl, "Entrega generada por entropiav2"],
    });
    await waitSuccess(seller, deliverHash, "submit_delivery");

    const disputeHash = await buyer.writeContract({
      address: contractAddress,
      functionName: "dispute",
      args: [orderId, disputeReason],
    });
    await waitSuccess(buyer, disputeHash, "dispute");

    console.log("  resolve_dispute: corriendo consenso (web + LLM)...");
    const resolveHash = await buyer.writeContract({
      address: contractAddress,
      functionName: "resolve_dispute",
      args: [orderId],
    });
    await waitSuccess(buyer, resolveHash, "resolve_dispute");

    const order = await buyer.readContract({
      address: contractAddress, functionName: "get_order", args: [orderId],
    });
    console.log(`  Veredicto: ${order.verdict} (estado ${order.status})`);
    console.log(`  Razon: ${order.verdict_reason}`);
    console.log(`  Acerto lo esperado: ${order.verdict === expected ? "SI" : "NO"}`);
    console.log("");
    return order.verdict === expected;
  }

  const ok1 = await runCase("entrega acorde al brief", DELIVERY_GOOD, DISPUTE_GOOD, "release");
  const ok2 = await runCase("entrega ajena al brief", DELIVERY_BAD, DISPUTE_BAD, "refund");

  console.log(`Resumen: ${["release", "refund"].filter((_, i) => [ok1, ok2][i]).length}/2 veredictos como se esperaba`);
  console.log(`Contrato: ${contractAddress}`);
}

main().catch((error) => {
  console.error("Error:", error.message || error);
  process.exit(1);
});
