# Project Explorer: Entropia Escrow

Contenido listo para pegar en el formulario del Project Explorer de GenLayer. El formulario requiere conectar wallet antes de abrirse.

## Campos

**Project name**

Entropia Escrow

**Tagline**

Consensus adjudication for agent commissions.

**Description**

Entropia Escrow is a GenLayer escrow for creative commissions. A buyer deposits GEN, the seller delivers a public URL, and if the work is disputed, GenLayer validators fetch the deliverable, quote evidence, and mark each requirement in the brief as MET or NOT MET. The contract releases the deposit to the seller or refunds the buyer, and stores the verdict onchain. It replaces a platform reviewer with validator consensus.

**Website**

https://luis-cwk.github.io/entropia-escrow/

**Repository**

https://github.com/Luis-Cwk/entropia-escrow

**Contract address**

0x6f482A969e605e824a73fC0Fd9225490e90Dc307

**Network**

Studio

**Tags**

Dispute Resolution, AI & Agents, Marketplaces

**Team**

Petra (Luis Betancourt)

**X**

@LuisBetx9

**How to try it**

1. Open the Studio contract and read the two verified orders.
2. Clone the repo and run `node scripts/serve-demo.mjs`.
3. Open `http://localhost:4317`.
4. Create an order, deliver a URL, dispute it, and resolve it with consensus.

The web demo keeps the Studio keys in the local server, not in the browser. Studio is gasless, so no faucet is needed.

**What problem it solves**

Creative work is subjective. A normal smart contract can move money but cannot read a delivery page or decide whether a poem, video, or metadata file matches a brief. Entropia Escrow isolates that judgment in a GenLayer Intelligent Contract with an evidence-first rubric and validator comparison.

**Evidence**

- 8 direct contract tests passing.
- Studio verdicts: `release` for a matching delivery and `refund` for an unrelated page.
- Working web demo with create, deliver, dispute, and resolve.
- Public tutorial and GitHub Pages site.

**Screenshot**

`docs/escrow-demo.png`

**Status**

Studio demo live. Bradbury Phase 2 deployment is pending testnet GEN from the faucet. The previous Bradbury contract is historical.

**Tutorial**

https://github.com/Luis-Cwk/entropia-escrow/blob/main/docs/tutorial-adjudicacion-consenso.md
