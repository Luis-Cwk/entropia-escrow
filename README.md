# Entropia Escrow

**Consensus adjudication for agent commissions on GenLayer.**

Entropia Escrow is a standalone GenLayer project for agent-to-agent creative commissions. A buyer deposits GEN, the seller delivers a URL, and if either side disputes the delivery, GenLayer validators fetch the work, compare it against the brief with an LLM rubric, and settle the escrow with a release or a refund. There is no platform operator deciding the outcome and no single oracle.

This repository contains the Intelligent Contract, the client tools, the direct tests, and the runnable Studio and Bradbury demos. It is intentionally separate from the VideoDanza NFT product so the escrow can be reviewed as its own primitive and application flow.

## Why GenLayer

A normal smart contract can move GEN, but it cannot read a delivery page or judge whether a poem, a video, or a metadata file matches a brief. Entropia Escrow isolates that subjective decision in `resolve_dispute`:

1. The contract fetches the delivered URL inside a non-deterministic block.
2. An LLM quotes evidence from the page and marks each brief requirement as `MET` or `NOT MET`.
3. A custom validator reruns the same task and requires the same decision, with a bounded score difference, using `run_nondet_unsafe`.
4. Deterministic rules handle deposits, roles, deadlines, and payouts.
5. A release or refund is written back to the order state.

The result is an escrow that can handle real creative work without trusting a centralized reviewer.

## Verified status

### Studio demo (chain 61999)

- Contract: [`0x6f482A969e605e824a73fC0Fd9225490e90Dc307`](https://explorer-studio.genlayer.com/address/0x6f482A969e605e824a73fC0Fd9225490e90Dc307)
- Two end-to-end cases passed:
  - A delivery that matches the brief produced `RELEASED` with verdict `release` and quoted evidence.
  - `https://example.com/` produced `REFUNDED` with verdict `refund` and the missing requirements listed.
- Direct contract tests: **8 passed**.

### Bradbury Phase 2 (chain 4221, Arbitrum Orbit)

Phase 2 is live. It reset the old Bradbury network, so the previous contract, state, and balances are historical and do not carry over.

- GenLayer RPC: `https://rpc.testnet-chain.genlayer.com/`
- Chain RPC (wallet): `https://rpc-genlayer-chain-testnet-cfn8m3xc6l.t.conduit.xyz/`
- Explorer: `https://explorer-genlayer-chain-testnet-cfn8m3xc6l.t.conduit.xyz`
- Faucet: `https://testnet-faucet.genlayer.foundation/` (100 GEN per week; GitHub account older than 3 months and 0.01 ETH on mainnet)
- Genesis block: `0x17d89764d4f4f963158fc4c5e8f2cb670c2837740b35f37081c12860c3df97e4`

The escrow deployment for Phase 2 is pending testnet GEN from the faucet. The old contract `0xF0870e9775DEEc42389c7C30B865eC6c236e5F32` and its transactions belong to the retired Bradbury Phase 1 and must not be used for new reviews.

## Repository layout

```text
contracts/composition_escrow.py   Intelligent Contract (Python)
tools/                            Client-side request/response helpers and web probe
scripts/demo.mjs                  Studio end-to-end demo (legacy genlayer-js for Studio)
scripts/create-order.mjs          Bradbury order creation with fee estimation
scripts/demo-bradbury.ps1         Bradbury flow: JS create_order plus CLI writes
scripts/balances.mjs              GEN balances on Studio or Bradbury Phase 2
tests/direct/                     Direct tests (8, no network required)
config/                           RPC environment helpers
docs/                             GitHub Pages site
```

## Contract API

| Method | Who | What it does |
|---|---|---|
| `create_order(brief, ttl_seconds)` payable | buyer | Deposits GEN and creates an order. Rejects zero deposits and self-purchases. |
| `submit_delivery(order_id, delivery_url, delivery_note)` | seller | Records the delivered URL. |
| `accept(order_id)` | buyer | Releases the deposit without a dispute. |
| `claim_timeout(order_id)` | buyer | Refunds the buyer after the deadline with no delivery. |
| `dispute(order_id, reason)` | buyer | Opens a dispute. |
| `resolve_dispute(order_id)` | anyone | Runs the web + LLM consensus verdict and pays `release` or `refund`. |
| `get_order`, `get_orders`, `get_order_count`, `get_seller` | view | Read order state. |

## Run the tests

```powershell
.venv\Scripts\python.exe -m pytest tests\direct -v
```

Expected: `8 passed`.

## Run the Studio demo

The Studio demo uses `genlayer-js` 1.1.8 (the legacy alias) because the current Studio RPC does not expose `sim_getFeeConfig`. The Bradbury Phase 2 flow uses the newer SDK.

```powershell
npm install
node scripts/demo.mjs
```

Expected: two cases, `2/2` verdicts as expected. The script deploys a fresh contract if `CONTRACT_ADDRESS` is not set.

## Bradbury Phase 2

The Bradbury flow uses `genlayer-js` 2.0.0-rc.2 for fee estimation and the GenLayer CLI for non-payable writes, because the CLI attaches protocol fees correctly.

```powershell
$env:GL_PASSWORD = "..."
$env:CONTRACT_ADDRESS = "0x..."   # new Phase 2 deployment
.\scripts\demo-bradbury.ps1
```

Useful checks:

```powershell
node scripts/balances.mjs
node scripts/create-order.mjs
```

The CLI still carries the old Bradbury RPC in its built-in network definition, so `demo-bradbury.ps1` passes the new RPC explicitly with `--rpc https://rpc.testnet-chain.genlayer.com/`.

## Design notes

- **Leader**: fetches the deliverable with `gl.nondet.web.request`, classifies 4xx as `[EXTERNAL]` and 5xx as `[TRANSIENT]`, trims the page to 20k characters, and asks the LLM for a JSON `{decision, score, reason}` with an evidence-first rubric.
- **Validator**: repeats the task and requires an exact `decision` match with a score gap of at most 30. If the leader fails, it compares error prefixes and forces rotation on LLM errors.
- **Deterministic rules** handle deposits, deadlines, roles, and payouts. Only the judgment is subjective.

## Known shortcuts

- `shortcut: no dispute window or custom appeal; the buyer can dispute any delivery and anyone can trigger the judgment. Add deadlines when real value is at stake.`
- `shortcut: one seller and no partial refunds; the escrow is all-or-nothing.`
- `shortcut: deposits and payouts use native GEN, not USDC like the x402 flow.`
- `shortcut: no on-chain re-judgment; the protocol appeal exists but is not exposed by this contract.`
- `shortcut: the web probe uses strict equality and only works for static text.`

## Windows gotchas

- The direct SDK downloads `genvm-universal.tar.xz` from GitHub and that URL returns 404 for `v0.3.0-rc7`. The linter cache tarball can be copied to `~/.cache/gltest-direct/`.
- `genlayer-test` 0.29.2 has a Windows bug in `gltest/direct/loader.py` that deletes a temporary file still open as stdin. The local patch wraps `os.unlink` in `try/except OSError`.
- The direct fixtures can return `bytes` instead of `Address`; convert with `0x + hex`.
- studionet limits 60 requests per minute; the demo spaces writes and retries transient RPC errors.

## Project links

- Website: https://luis-cwk.github.io/entropia-escrow/
- Repository: https://github.com/Luis-Cwk/entropia-escrow
- Studio contract: https://explorer-studio.genlayer.com/address/0x6f482A969e605e824a73fC0Fd9225490e90Dc307

## License

MIT. See `LICENSE`.
