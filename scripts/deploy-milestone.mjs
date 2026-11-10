/**
 * Deploy de MilestoneEscrow en Studio (gasless).
 * Usa genlayer-js 1.1.8 legacy por la misma razon que demo.mjs.
 *
 * Uso: node scripts/deploy-milestone.mjs
 * Imprime la tx del deploy y la direccion del contrato nuevo.
 */
import { readFileSync } from "fs";
import { createClient, createAccount } from "genlayer-js-legacy";
import { studionet } from "genlayer-js-legacy/chains";
import { TransactionStatus } from "genlayer-js-legacy/types";

const keys = JSON.parse(readFileSync(".secrets/demo-keys.json", "utf8"));
const sellerAccount = createAccount(keys.seller);
const client = createClient({ chain: studionet, account: sellerAccount });
const code = new Uint8Array(readFileSync("contracts/milestone_escrow.py"));

const hash = await client.deployContract({ code, args: [sellerAccount.address] });
console.log("deploy tx:", hash);

await new Promise((resolve) => setTimeout(resolve, 3000));
const receipt = await client.waitForTransactionReceipt({
  hash,
  status: TransactionStatus.ACCEPTED,
  retries: 300,
});

const address =
  receipt.data?.contract_address ||
  receipt.contractAddress ||
  receipt.consensus_data?.leader_receipt?.[0]?.contract_address ||
  receipt.to_address ||
  null;
const result =
  receipt.consensus_data?.leader_receipt?.[0]?.execution_result || receipt.result_name;

console.log("result:", result);
console.log("contract:", address);
if (!address) throw new Error("No se obtuvo contract_address del deploy");
