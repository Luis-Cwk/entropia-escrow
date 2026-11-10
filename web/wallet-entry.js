import { createClient, createAccount, generatePrivateKey } from "genlayer-js-legacy";
import { studionet, testnetBradbury } from "genlayer-js-legacy/chains";
import { TransactionStatus } from "genlayer-js-legacy/types";

const CONTRACT = window.ENTROPIA_CONTRACT;
const STORAGE_KEY = "entropia-buyer-key";
const CHAINS = { studionet, testnetBradbury };
const CHAIN = CHAINS[window.ENTROPIA_CHAIN || "studionet"] || studionet;

function loadKey() {
  let key = localStorage.getItem(STORAGE_KEY);
  if (!key) {
    key = generatePrivateKey();
    localStorage.setItem(STORAGE_KEY, key);
  }
  return key;
}

const account = createAccount(loadKey());
const client = createClient({ chain: CHAIN, account });

async function wait(hash) {
  await new Promise((r) => setTimeout(r, 3000));
  const receipt = await client.waitForTransactionReceipt({
    hash,
    status: TransactionStatus.ACCEPTED,
    retries: 300,
  });
  const result =
    receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.result_name;
  if (result && result !== "SUCCESS") {
    throw new Error(`La transaccion fallo: ${result}`);
  }
  return hash;
}

window.GenLayerWallet = {
  address: account.address,
  chain: window.ENTROPIA_CHAIN || "studionet",
  exportKey() {
    return localStorage.getItem(STORAGE_KEY);
  },
  importKey(raw) {
    const value = String(raw || "").trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error("La llave debe ser 0x y 64 caracteres hex");
    localStorage.setItem(STORAGE_KEY, value);
  },
  async createOrder(brief, amountAtto) {
    const hash = await client.writeContract({
      address: CONTRACT,
      functionName: "create_order",
      args: [[brief], [String(amountAtto)], 3600],
      value: BigInt(amountAtto),
    });
    return wait(hash);
  },
  async approve(orderId) {
    const hash = await client.writeContract({
      address: CONTRACT,
      functionName: "approve_milestone",
      args: [orderId, 0],
    });
    return wait(hash);
  },
  async dispute(orderId, reason) {
    const hash = await client.writeContract({
      address: CONTRACT,
      functionName: "dispute_milestone",
      args: [orderId, 0, reason],
    });
    return wait(hash);
  },
};
