import { createClient, createAccount, generatePrivateKey } from 'genlayer-js-legacy';
import { studionet } from 'genlayer-js-legacy/chains';
import { TransactionStatus } from 'genlayer-js-legacy/types';
import contractSource from './contract-code.js';

const RPC = 'https://studio.genlayer.com/api';
const EXPLORER = 'https://explorer-studio.genlayer.com/address/';
const DEPOSIT_ATTO = 500000000000000000n;
const DEFAULT_BRIEF = 'Pieza de videodanza generativa sobre cuerpo y tecnologia. Tema: soberania de datos y danza contemporanea expandida. Formato: texto poetico para metadata NFT.';

const els = {
  contract: document.getElementById('state-contract'),
  seller: document.getElementById('state-seller'),
  buyer: document.getElementById('state-buyer'),
  count: document.getElementById('state-count'),
  order: document.getElementById('state-order'),
  status: document.getElementById('state-status'),
  verdict: document.getElementById('state-verdict'),
  log: document.getElementById('log'),
  brief: document.getElementById('brief'),
  delivery: document.getElementById('delivery'),
  reason: document.getElementById('reason'),
  contractLink: document.getElementById('contract-link'),
  network: document.getElementById('network'),
};

const actionButtons = Array.from(document.querySelectorAll('[data-action]'));
const state = { seller: null, buyer: null, sellerClient: null, buyerClient: null, contract: null, orderId: null, status: '', busy: false };

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stamp() {
  return new Date().toLocaleTimeString('es-MX', { hour12: false });
}

function log(message) {
  const current = els.log.textContent.trim();
  const next = `[${stamp()}] ${message}`;
  els.log.textContent = current && !current.startsWith('Listo.') ? `${current}\n${next}` : next;
  els.log.scrollTop = els.log.scrollHeight;
}

function short(address) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : 'Sin datos';
}

function applyAvailability() {
  const status = String(state.status || '').toUpperCase();
  const allowed = {
    start: !state.contract,
    deliver: status === 'CREATED',
    dispute: status === 'DELIVERED',
    resolve: status === 'DISPUTED',
  };
  for (const button of actionButtons) button.disabled = state.busy || !allowed[button.dataset.action];
}

function setBusy(value) {
  state.busy = value;
  applyAvailability();
}

function render() {
  els.seller.textContent = short(state.seller?.address);
  els.buyer.textContent = short(state.buyer?.address);
  els.contract.textContent = state.contract ? short(state.contract) : 'Sin desplegar';
  els.contractLink.href = state.contract ? `${EXPLORER}${state.contract}` : 'https://explorer-studio.genlayer.com';
  els.contractLink.textContent = state.contract ? 'Ver este contrato' : 'Explorer de Studio';
  els.count.textContent = state.contract ? '1' : '0';
  els.order.textContent = state.orderId || 'Sin orden';
  els.status.textContent = state.status || 'Sin datos';
  els.verdict.textContent = 'Sin datos';
  applyAvailability();
}

async function rpc(method, params) {
  const response = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message || 'Error del RPC');
  return payload.result;
}

async function fund(address, amountGen) {
  await rpc('sim_fundAccount', [address, amountGen]);
  for (let i = 0; i < 30; i++) {
    const balance = await rpc('eth_getBalance', [address, 'latest']);
    if (BigInt(balance) > 0n) return;
    await sleep(1000);
  }
  throw new Error('La cuenta efímera no recibió GEN de Studio');
}

async function waitTx(client, hash, label) {
  await sleep(2000);
  const receipt = await client.waitForTransactionReceipt({ hash, status: TransactionStatus.ACCEPTED, retries: 300 });
  const execution = receipt.consensus_data?.leader_receipt?.[0]?.execution_result;
  const result = execution || receipt.result_name;
  if (result && result !== 'SUCCESS') {
    const stderr = receipt.consensus_data?.leader_receipt?.[0]?.genvm_result?.stderr || '';
    throw new Error(`${label}: ${result} ${stderr}`.trim());
  }
  return receipt;
}

function contractAddress(receipt) {
  return receipt.data?.contract_address || receipt.contractAddress || receipt.tx_data_decoded?.contract_address || receipt.consensus_data?.leader_receipt?.[0]?.contract_address || receipt.to_address || null;
}

async function readOrder() {
  if (!state.contract || !state.orderId) return null;
  return state.buyerClient.readContract({ address: state.contract, functionName: 'get_order', args: [state.orderId] });
}

async function refresh() {
  const order = await readOrder();
  if (!order) return;
  state.status = String(order.status || '');
  els.status.textContent = state.status || 'Sin datos';
  els.verdict.textContent = order.verdict || 'Sin datos';
  els.verdict.title = order.verdict_reason || '';
  applyAvailability();
}

async function startSession() {
  const brief = (els.brief.value || DEFAULT_BRIEF).trim();
  log('Fondeando las cuentas efímeras en Studio…');
  await fund(state.seller.address, 1);
  await fund(state.buyer.address, 2);
  log('Desplegando el contrato desde el navegador…');
  const code = new TextEncoder().encode(contractSource);
  const deployHash = await state.sellerClient.deployContract({ code, args: [state.seller.address] });
  const receipt = await waitTx(state.sellerClient, deployHash, 'deploy');
  const address = contractAddress(receipt);
  if (!address) throw new Error('El deploy no devolvió la dirección del contrato');
  state.contract = address;
  els.contract.textContent = short(address);
  els.contractLink.href = `${EXPLORER}${address}`;
  els.contractLink.textContent = 'Ver este contrato';
  log(`Contrato desplegado: ${short(address)} · tx ${deployHash.slice(0, 10)}…`);

  const count = await state.buyerClient.readContract({ address, functionName: 'get_order_count', args: [] });
  state.orderId = `ord-${Number(count)}`;
  els.order.textContent = state.orderId;
  log(`Creando ${state.orderId} con 0.5 GEN de depósito…`);
  const hash = await state.buyerClient.writeContract({ address, functionName: 'create_order', args: [brief, 3600], value: DEPOSIT_ATTO });
  await waitTx(state.buyerClient, hash, 'create_order');
  await refresh();
  log(`Orden ${state.orderId} en ${state.status}. Sigue con la entrega.`);
}

async function deliver() {
  const url = (els.delivery.value || '').trim();
  if (!/^https?:\/\//.test(url)) throw new Error('La URL debe empezar con http:// o https://');
  log('El seller registra la entrega…');
  const hash = await state.sellerClient.writeContract({ address: state.contract, functionName: 'submit_delivery', args: [state.orderId, url, 'Entrega de la sesión demo'] });
  await waitTx(state.sellerClient, hash, 'submit_delivery');
  await refresh();
  log(`Entrega registrada. Estado: ${state.status}.`);
}

async function dispute() {
  const reason = (els.reason.value || 'La entrega no cumple el brief.').trim();
  log('El comprador abre la disputa…');
  const hash = await state.buyerClient.writeContract({ address: state.contract, functionName: 'dispute', args: [state.orderId, reason] });
  await waitTx(state.buyerClient, hash, 'dispute');
  await refresh();
  log(`Disputa abierta. Estado: ${state.status}.`);
}

async function resolve() {
  log('Corriendo el juicio con consenso (web + LLM). Puede tardar uno o dos minutos…');
  const hash = await state.buyerClient.writeContract({ address: state.contract, functionName: 'resolve_dispute', args: [state.orderId] });
  await waitTx(state.buyerClient, hash, 'resolve_dispute');
  await refresh();
  const title = els.verdict.title ? ` · ${els.verdict.title}` : '';
  log(`Veredicto: ${els.verdict.textContent}${title}`);
}

const handlers = { start: startSession, deliver, dispute, resolve };

for (const button of actionButtons) {
  button.addEventListener('click', async () => {
    if (state.busy) return;
    setBusy(true);
    try {
      await handlers[button.dataset.action]();
      log(`Listo · tx confirmada`);
    } catch (error) {
      log(`Error: ${error.message}`);
    } finally {
      setBusy(false);
    }
  });
}

document.getElementById('clear-log').addEventListener('click', () => {
  els.log.textContent = 'Listo.';
});

state.seller = createAccount(generatePrivateKey());
state.buyer = createAccount(generatePrivateKey());
state.sellerClient = createClient({ chain: studionet, account: state.seller });
state.buyerClient = createClient({ chain: studionet, account: state.buyer });
state.status = '';
render();
log('Sesión nueva. Las cuentas viven solo en esta pestaña; no hay llaves guardadas.');
