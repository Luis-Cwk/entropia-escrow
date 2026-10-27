# Three ways to adjudicate subjective work

Blockchains can move value. They cannot judge meaning. As agents begin to sell creative work, the bottleneck stops being payment and becomes adjudication: who decides whether a poem, a video, or a metadata package actually fulfilled the brief.

There are three common answers. Each one works, and each one breaks in a different place.

## 1. Platform review

A marketplace hires reviewers, gives them a queue, and lets them decide disputes. This is how most freelance platforms and art commissions work today.

**What it gets right:** context. A human reviewer can read the brief, look at the work, and use taste. For ambiguous creative work, taste is not a bug.

**Where it breaks:** the reviewer is a single point of failure. Queues take weeks. The fee to arbitrate can cost more than the commission. The reasoning is private, so the losing side cannot check it. And the platform has an incentive to keep large sellers happy.

Platform review is fast to start and expensive to trust.

## 2. Optimistic arbitration

Protocols like UMA and Kleros turn disputes into economic games. Someone asserts an answer with a bond. If nobody challenges within a window, the answer stands. If someone does, the dispute escalates to a jury or a token-weighted vote.

**What it gets right:** undisputed cases are cheap and fast. The threat of a bond makes careless assertions expensive. For objective facts, such as whether a transaction happened or a price crossed a threshold, this design is strong.

**Where it breaks:** it assumes a challenger with capital and enough context to notice the problem. For subjective work, the jury may have no domain knowledge. "Does this poem meet the brief" is not a factual question that a token vote resolves well. And escalation can be slower and more expensive than the original commission.

Optimistic arbitration is a truth machine for facts, not a taste machine for meaning.

## 3. Validator consensus with LLM judgment

GenLayer takes a third path. An Intelligent Contract fetches the deliverable, asks a model to evaluate it against the brief, and requires independent validators to agree on the decision. The contract stores the verdict and settles the money.

A practical example is an escrow for creative commissions:

1. The buyer deposits GEN and writes the brief.
2. The seller submits a public URL.
3. If the buyer disputes, the leader downloads the page, extracts quotes, marks each requirement as MET or NOT MET, and returns a decision with a score.
4. Validators repeat the same task. They must match the decision and stay within a score band.
5. The contract releases the deposit or refunds it, and keeps the reason onchain.

**What it gets right:** it can read subjective material. It forces evidence before opinion: quote first, then decide. It has no human queue, and the reasoning is part of the record. A delivery that meets the brief can be released even if the buyer disputes, which removes the "whoever complains wins" bias.

**Where it breaks:** nondeterminism. Two validators can read the same page and score it differently, so the rubric and the score band become the real contract. Web fetches fail: a 404, a paywall, or a redirect can look like a bad delivery. Prompt design is fragile. And the cost of consensus is paid on every dispute, not only on the hard ones.

Validator judgment is the first mechanism that can actually read the work. It is also the one that needs the most careful design.

## Comparison

| | Platform review | Optimistic arbitration | Validator + LLM |
|---|---|---|---|
| Cost per dispute | High, human time | Low if undisputed, high if escalated | Medium, model plus consensus |
| Speed | Days to weeks | Hours to days | Minutes |
| Handles subjective work | Yes, with taste | Poorly | Yes, with a rubric |
| Evidence trail | Private | Economic | Quoted and stored |
| Main failure mode | Opacity and queue | Missing challenger | Nondeterminism and fetch errors |

## What the case study showed

A small escrow built on GenLayer ran two cases in Studio. A poem that matched the brief was released. A generic page that did not match was refunded. The verdict cited fragments of each delivery and marked every requirement. The contract passed eight direct tests and the whole flow ran without gas.

The limits were just as clear. There was one seller, no partial refunds, and no appeal. The escrow was all or nothing. The rubric worked because the brief was narrow. A vague brief would have produced a vague verdict, no matter how many validators agreed.

## Design rules that follow

1. **Narrow the claim.** Ask "does this meet these three requirements", not "is this good".
2. **Require citations before verdicts.** A quote is checkable. An opinion is not.
3. **Use score bands, not exact equality.** Validators should agree on the decision and stay close on the score.
4. **Classify fetch errors.** A 404 is evidence about the delivery. A 500 is a reason to retry, not to refund.
5. **Keep a human for high stakes.** Validator consensus is a strong first pass, not a replacement for appeal on large amounts.
6. **Store the reason.** A boolean settles the money. The reason settles the next dispute.

Adjudication is a spectrum, not a single primitive. The right question is not "which model is decentralized" but "what is the cheapest mechanism that can actually read the evidence".

For objective facts, optimistic arbitration is enough. For taste, a human is still the best reader. For the growing middle, where agents sell work that is subjective but checkable against a brief, validator consensus with cited evidence is the first design that fits.

---

Petra (Luis Betancourt) builds agents and adjudication systems. Entropia Escrow is an open-source GenLayer escrow for creative commissions: https://github.com/Luis-Cwk/entropia-escrow
