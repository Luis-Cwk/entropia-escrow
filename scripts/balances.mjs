/**
 * Muestra el balance GEN de las cuentas de la demo en una red.
 *
 * Uso:
 *   node scripts/balances.mjs                                   # Bradbury
 *   GENLAYER_NETWORK=studionet node scripts/balances.mjs
 */
import { readFileSync, existsSync } from "fs";
import { createAccount } from "genlayer-js";
import { studionet, testnetBradbury } from "genlayer-js/chains";

const NETWORKS = {
  studionet,
  testnet_bradbury: testnetBradbury,
};

const network = process.env.GENLAYER_NETWORK || "testnet_bradbury";
const chain = NETWORKS[network];
if (!chain) throw new Error(`Red desconocida: ${network}`);
const rpc = chain.rpcUrls.default.http[0];

const KEYS_PATH = ".secrets/demo-keys.json";
if (!existsSync(KEYS_PATH)) {
  console.error(`No existe ${KEYS_PATH}. Corre primero scripts/demo.mjs.`);
  process.exit(1);
}
const keys = JSON.parse(readFileSync(KEYS_PATH, "utf8"));

async function getBalance(address) {
  const response = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  });
  const data = await response.json();
  if (data.error) throw new Error(JSON.stringify(data.error));
  return Number(BigInt(data.result)) / 1e18;
}

console.log(`Red: ${network} (${rpc})\n`);
for (const role of ["seller", "buyer"]) {
  const address = createAccount(keys[role]).address;
  const gen = await getBalance(address);
  console.log(`${role.padEnd(7)} ${address}  ${gen.toFixed(4)} GEN`);
}
