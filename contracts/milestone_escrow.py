# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }

import json
from datetime import datetime, timezone

from genlayer import *

ERROR_EXPECTED = "[EXPECTED]"
ERROR_EXTERNAL = "[EXTERNAL]"
ERROR_TRANSIENT = "[TRANSIENT]"
ERROR_LLM = "[LLM_ERROR]"

STATUS_CREATED = "CREATED"
STATUS_DELIVERED = "DELIVERED"
STATUS_DISPUTED = "DISPUTED"
STATUS_APPROVED = "APPROVED"
STATUS_REFUNDED = "REFUNDED"

MAX_PAGE_CHARS = 20000
MAX_SCORE_GAP = 30
MAX_MILESTONES = 10
MIN_AMOUNT = 1


@gl.evm.contract_interface
class _Recipient:
    class View:
        pass

    class Write:
        pass


def _now() -> int:
    """Transaction time. The stdlib clock is pinned to the tx timestamp (deterministic)."""
    return int(datetime.now(timezone.utc).timestamp())


def _parse_json_text(text: str) -> dict:
    """Clean an LLM JSON string: strip fences and trailing commas."""
    import re

    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1:
        raise gl.vm.UserError(f"{ERROR_LLM} No JSON object in response")
    cleaned = text[first:last + 1]
    cleaned = re.sub(r",(?!\s*?[\{\[\"\'\w])", "", cleaned)
    return json.loads(cleaned)


def _parse_verdict(raw) -> dict:
    """Extract the stable verdict fields from an LLM response, defensively."""
    if isinstance(raw, str):
        raw = _parse_json_text(raw)
    if not isinstance(raw, dict):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-dict response: {type(raw)}")

    decision = None
    for key in ("decision", "verdict", "outcome", "result"):
        if key in raw:
            decision = str(raw[key]).strip().lower()
            break
    if decision not in ("release", "refund"):
        raise gl.vm.UserError(f"{ERROR_LLM} Invalid decision: {decision} keys={list(raw.keys())}")

    raw_score = raw.get("score")
    if raw_score is None:
        for alt in ("rating", "points", "value"):
            if alt in raw:
                raw_score = raw[alt]
                break
    try:
        score = max(0, min(100, int(round(float(str(raw_score).strip())))))
    except (ValueError, TypeError):
        raise gl.vm.UserError(f"{ERROR_LLM} Non-numeric score: {raw_score}")

    return {"decision": decision, "score": score, "reason": str(raw.get("reason", ""))[:600]}


class MilestoneEscrow(gl.Contract):
    """Escrow for commissioned work paid in tranches.

    The buyer deposits once and splits the total into milestones with explicit
    requirements. The seller delivers each milestone as a public URL. Payment
    per milestone can end three ways:

    - The buyer approves it and the tranche is released.
    - The buyer disputes it and GenLayer validators (LLM consensus over the
      delivered page) release or refund that tranche.
    - The seller misses the deadline and the buyer claims the refund.

    Partial completion is the point: approved tranches are paid even if later
    milestones fail.
    """

    owner: Address
    seller: Address
    orders: TreeMap[str, str]
    order_ids: DynArray[str]
    order_counter: u256

    def __init__(self, seller_address: str):
        self.owner = gl.message.sender_address
        self.seller = Address(seller_address)
        self.order_counter = u256(0)

    def _load(self, order_id: str) -> dict:
        try:
            raw = self.orders[order_id]
        except KeyError:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Unknown order: {order_id}")
        return json.loads(raw)

    def _save(self, order_id: str, order: dict) -> None:
        self.orders[order_id] = json.dumps(order, sort_keys=True)

    def _pay(self, to: str, amount_atto: str) -> None:
        _Recipient(Address(to)).emit_transfer(value=u256(int(amount_atto)))

    def _milestone(self, order: dict, index: int) -> dict:
        if index < 0 or index >= len(order["milestones"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid milestone index: {index}")
        return order["milestones"][index]

    def _pay_milestone(self, order: dict, ms: dict) -> None:
        order["total_paid_atto"] = str(int(order["total_paid_atto"]) + int(ms["amount_atto"]))
        self._pay(order["seller"], ms["amount_atto"])

    def _handle_leader_error(self, leaders_res, leader_fn) -> bool:
        leader_msg = leaders_res.message if hasattr(leaders_res, "message") else ""
        try:
            leader_fn()
            return False  # leader errored, validator succeeded
        except gl.vm.UserError as e:
            validator_msg = e.message if hasattr(e, "message") else str(e)
            if validator_msg.startswith(ERROR_EXPECTED) or validator_msg.startswith(ERROR_EXTERNAL):
                return validator_msg == leader_msg
            if validator_msg.startswith(ERROR_TRANSIENT) and leader_msg.startswith(ERROR_TRANSIENT):
                return True
            return False
        except Exception:
            return False

    def _adjudicate(self, requirement: str, delivery_url: str, delivery_note: str, dispute_reason: str) -> dict:
        def leader_fn() -> dict:
            if not delivery_url.startswith("http"):
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Invalid delivery URL")
            try:
                response = gl.nondet.web.request(delivery_url, method="GET")
            except Exception as e:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Delivery fetch failed: {type(e).__name__}")
            status = int(response.status)
            if 400 <= status < 500:
                raise gl.vm.UserError(f"{ERROR_EXTERNAL} Delivery source returned {status}")
            if status >= 500:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Delivery source returned {status}")
            page = (response.body or b"").decode("utf-8", errors="replace")
            if not page:
                raise gl.vm.UserError(f"{ERROR_TRANSIENT} Empty delivery page")
            page = page[:MAX_PAGE_CHARS]

            prompt = f"""You are an independent adjudicator settling one milestone of an onchain escrow between a buyer and a creative AI agent. Judge the page content, not the buyer's opinion.

MILESTONE REQUIREMENT (what the buyer is paying for at this step):
{requirement}

DELIVERABLE URL: {delivery_url}
DELIVERABLE NOTE FROM SELLER:
{delivery_note}

BUYER DISPUTE REASON:
{dispute_reason}

Fetched page content:
{page}

Work in two steps and put both in "reason":
1) Extract 2-4 short quotes from the page that are relevant to the requirement.
2) Mark each part of the requirement as MET or NOT MET, citing the quote.

Decision rules:
- "release": every part of the requirement is MET. A delivery that meets the requirement must be released even if the buyer complains.
- "refund": at least one part is NOT MET, or the page has no relevant content at all.
The dispute reason counts only if it points to a genuine gap you can verify in the page.
Respond only with JSON: {{"decision": "release" or "refund", "score": 0-100, "reason": "quotes and MET/NOT MET list"}}"""

            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            return _parse_verdict(raw)

        def validator_fn(leaders_res) -> bool:
            if not isinstance(leaders_res, gl.vm.Return):
                return self._handle_leader_error(leaders_res, leader_fn)

            candidate = leader_fn()
            leader = leaders_res.calldata
            if not isinstance(leader, dict):
                return False
            if leader.get("decision") != candidate["decision"]:
                return False
            try:
                return abs(int(leader.get("score", -999)) - candidate["score"]) <= MAX_SCORE_GAP
            except (TypeError, ValueError):
                return False

        return gl.vm.run_nondet_unsafe(leader_fn, validator_fn)

    # --- public API ---

    @gl.public.view
    def get_order(self, order_id: str) -> dict:
        return self._load(order_id)

    @gl.public.view
    def get_orders(self) -> str:
        return json.dumps([json.loads(self.orders[oid]) for oid in self.order_ids], sort_keys=True)

    @gl.public.view
    def get_order_count(self) -> int:
        return int(self.order_counter)

    @gl.public.view
    def get_seller(self) -> str:
        return str(self.seller)

    @gl.public.write.payable
    def create_order(self, descriptions: list[str], amounts_atto: list[int], ttl_seconds: int) -> str:
        """Create an order with one milestone per description. Deposit must equal the sum."""
        value = int(gl.message.value)
        if len(descriptions) != len(amounts_atto):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone counts differ: {len(descriptions)} vs {len(amounts_atto)}")
        if len(descriptions) == 0 or len(descriptions) > MAX_MILESTONES:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestones must be 1-{MAX_MILESTONES}")
        if int(ttl_seconds) < 60:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} TTL must be at least 60 seconds")

        milestones = []
        total = 0
        for i, (desc, amount) in enumerate(zip(descriptions, amounts_atto)):
            if len(desc) < 10 or len(desc) > 500:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone {i} description must be 10-500 chars")
            if int(amount) < MIN_AMOUNT:
                raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone {i} amount too small")
            total += int(amount)
            milestones.append({
                "index": i,
                "description": desc,
                "amount_atto": str(int(amount)),
                "status": STATUS_CREATED,
                "delivery_url": "",
                "delivery_note": "",
                "delivered_at": 0,
                "dispute_reason": "",
                "verdict": "",
                "verdict_reason": "",
                "resolved_at": 0,
            })
        if total != value:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Deposit {value} != milestones total {total}")

        buyer = str(gl.message.sender_address)
        if buyer == str(self.seller):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Seller cannot buy its own service")

        now = int(_now())
        order_id = f"ms-{int(self.order_counter)}"
        self.order_counter = self.order_counter + u256(1)
        self.order_ids.append(order_id)

        order = {
            "id": order_id,
            "buyer": buyer,
            "seller": str(self.seller),
            "milestones": milestones,
            "total_atto": str(value),
            "total_paid_atto": "0",
            "created_at": now,
            "deadline": now + int(ttl_seconds),
        }
        self._save(order_id, order)
        return order_id

    @gl.public.write
    def submit_delivery(self, order_id: str, milestone_index: int, delivery_url: str, delivery_note: str) -> None:
        if gl.message.sender_address != self.seller:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the seller agent can deliver")
        order = self._load(order_id)
        ms = self._milestone(order, milestone_index)
        if ms["status"] != STATUS_CREATED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not open for delivery")
        if not delivery_url.startswith("http"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Delivery URL must be http(s)")

        ms["status"] = STATUS_DELIVERED
        ms["delivery_url"] = delivery_url
        ms["delivery_note"] = delivery_note[:600]
        ms["delivered_at"] = int(_now())
        self._save(order_id, order)

    @gl.public.write
    def approve_milestone(self, order_id: str, milestone_index: int) -> None:
        order = self._load(order_id)
        ms = self._milestone(order, milestone_index)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can approve")
        if ms["status"] != STATUS_DELIVERED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not awaiting review")

        ms["status"] = STATUS_APPROVED
        ms["verdict"] = "release"
        ms["verdict_reason"] = "Approved by buyer"
        ms["resolved_at"] = int(_now())
        self._pay_milestone(order, ms)
        self._save(order_id, order)

    @gl.public.write
    def claim_timeout(self, order_id: str, milestone_index: int) -> None:
        """Refund a milestone whose deadline passed without delivery."""
        order = self._load(order_id)
        ms = self._milestone(order, milestone_index)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can claim the timeout")
        if ms["status"] == STATUS_DELIVERED or ms["status"] == STATUS_DISPUTED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone delivered: review or dispute instead")
        if ms["status"] != STATUS_CREATED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone already resolved")
        if int(_now()) <= int(order["deadline"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Deadline not reached")

        ms["status"] = STATUS_REFUNDED
        ms["verdict"] = "refund"
        ms["verdict_reason"] = "Deadline missed by seller"
        ms["resolved_at"] = int(_now())
        self._save(order_id, order)
        self._pay(order["buyer"], ms["amount_atto"])

    @gl.public.write
    def dispute_milestone(self, order_id: str, milestone_index: int, reason: str) -> None:
        order = self._load(order_id)
        ms = self._milestone(order, milestone_index)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can dispute")
        if ms["status"] != STATUS_DELIVERED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only a delivered milestone can be disputed")
        if len(reason) < 10:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute reason too short")

        ms["status"] = STATUS_DISPUTED
        ms["dispute_reason"] = reason[:800]
        self._save(order_id, order)

    @gl.public.write
    def resolve_dispute(self, order_id: str, milestone_index: int) -> str:
        order = self._load(order_id)
        ms = self._milestone(order, milestone_index)
        if ms["status"] != STATUS_DISPUTED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Milestone is not disputed")

        verdict = self._adjudicate(
            ms["description"],
            ms["delivery_url"],
            ms["delivery_note"],
            ms["dispute_reason"],
        )

        if verdict["decision"] == "release":
            ms["status"] = STATUS_APPROVED
            self._pay_milestone(order, ms)
        else:
            ms["status"] = STATUS_REFUNDED
            self._pay(order["buyer"], ms["amount_atto"])
        ms["verdict"] = verdict["decision"]
        ms["verdict_reason"] = verdict["reason"]
        ms["resolved_at"] = int(_now())
        self._save(order_id, order)
        return verdict["decision"]
