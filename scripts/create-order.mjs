/**
 * Crea una orden en el escrow desde la cuenta buyer (genlayer-js 2.0.0-rc.2).
 * Estima y adjunta las fees del protocolo ademas del deposito.
 * Imprime JSON: {"orderId": "...", "hash": "0x..."}
 *
 * Uso: CONTRACT_ADDRESS=0x... node scripts/create-order.mjs
 */
import { readFileSync } from "fs";
import { createClient, createAccount } from "genlayer-js";
import { testnetBradbury as chain } from "genlayer-js/chains";

const keys = JSON.parse(readFileSync(".secrets/demo-keys.json", "utf8"));
const address = process.env.CONTRACT_ADDRESS;
if (!address) throw new Error("Falta CONTRACT_ADDRESS");

const client = createClient({ chain, account: createAccount(keys.buyer) });
const count = await client.readContract({ address, functionName: "get_order_count", args: [] });
const orderId = `ord-${count}`;

const brief = process.env.BRIEF ||
  "Pieza de videodanza generativa sobre cuerpo y tecnologia. Tema: soberania de datos y danza contemporanea expandida. Formato: texto poetico para metadata NFT.";

const args = [brief, 3600];
const value = 500000000000000000n;
const estimate = await client.estimateTransactionFeesForWrite({
  address,
  functionName: "create_order",
  args,
  value,
});
const hash = await client.writeContract({
  address,
  functionName: "create_order",
  args,
  value,
  fees: {
    distribution: estimate.distribution,
    messageAllocations: estimate.messageAllocations,
    feeValue: estimate.feeValue,
  },
});

console.log(JSON.stringify({ orderId, hash }));
