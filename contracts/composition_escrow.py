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
STATUS_RELEASED = "RELEASED"
STATUS_REFUNDED = "REFUNDED"

MAX_PAGE_CHARS = 20000
MAX_SCORE_GAP = 30


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


class CompositionEscrow(gl.Contract):
    """Escrow for compositions sold by an ERC-8004 creative agent.

    Happy path: buyer deposits GEN, seller delivers, buyer accepts.
    Adjudicated path: buyer disputes and the escrow asks GenLayer validators
    (LLM consensus over the delivered artifact) to release or refund.
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

    def _adjudicate(self, brief: str, delivery_url: str, delivery_note: str, dispute_reason: str) -> dict:
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

            prompt = f"""You are an independent adjudicator settling an onchain escrow between a buyer and a creative AI agent. Judge the page content, not the buyer's opinion.

BRIEF (what the buyer ordered):
{brief}

DELIVERABLE URL: {delivery_url}
DELIVERABLE NOTE FROM SELLER:
{delivery_note}

BUYER DISPUTE REASON:
{dispute_reason}

Fetched page content:
{page}

Work in two steps and put both in "reason":
1) Extract 2-4 short quotes from the page that are relevant to the brief.
2) Mark each core requirement of the brief as MET or NOT MET, citing the quote.

Decision rules:
- "release": every core requirement of the brief is MET. A delivery that meets the brief must be released even if the buyer complains.
- "refund": at least one core requirement is NOT MET, or the page has no relevant content at all.
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
    def create_order(self, brief: str, ttl_seconds: int) -> str:
        value = gl.message.value
        if value == u256(0):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Deposit required")
        if len(brief) < 10 or len(brief) > 800:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Brief must be 10-800 chars")
        if int(ttl_seconds) < 60:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} TTL must be at least 60 seconds")

        buyer = str(gl.message.sender_address)
        if buyer == str(self.seller):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Seller cannot buy its own service")

        now = int(_now())
        order_id = f"ord-{int(self.order_counter)}"
        self.order_counter = self.order_counter + u256(1)
        self.order_ids.append(order_id)

        order = {
            "id": order_id,
            "buyer": buyer,
            "seller": str(self.seller),
            "brief": brief,
            "amount_atto": str(int(value)),
            "status": STATUS_CREATED,
            "created_at": now,
            "deadline": now + int(ttl_seconds),
            "delivery_url": "",
            "delivery_note": "",
            "delivered_at": 0,
            "dispute_reason": "",
            "verdict": "",
            "verdict_reason": "",
            "resolved_at": 0,
        }
        self._save(order_id, order)
        return order_id

    @gl.public.write
    def submit_delivery(self, order_id: str, delivery_url: str, delivery_note: str) -> None:
        if gl.message.sender_address != self.seller:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the seller agent can deliver")
        order = self._load(order_id)
        if order["status"] != STATUS_CREATED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Order is not open for delivery")
        if not delivery_url.startswith("http"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Delivery URL must be http(s)")

        order["status"] = STATUS_DELIVERED
        order["delivery_url"] = delivery_url
        order["delivery_note"] = delivery_note[:600]
        order["delivered_at"] = int(_now())
        self._save(order_id, order)

    @gl.public.write
    def accept(self, order_id: str) -> None:
        order = self._load(order_id)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can accept")
        if order["status"] != STATUS_DELIVERED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Order is not awaiting review")

        order["status"] = STATUS_RELEASED
        order["verdict"] = "release"
        order["verdict_reason"] = "Accepted by buyer"
        order["resolved_at"] = int(_now())
        self._save(order_id, order)
        self._pay(order["seller"], order["amount_atto"])

    @gl.public.write
    def claim_timeout(self, order_id: str) -> None:
        order = self._load(order_id)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can claim the timeout")
        if order["status"] != STATUS_CREATED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Order already delivered or closed")
        if int(_now()) <= int(order["deadline"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Deadline not reached")

        order["status"] = STATUS_REFUNDED
        order["verdict"] = "refund"
        order["verdict_reason"] = "Deadline missed by seller"
        order["resolved_at"] = int(_now())
        self._save(order_id, order)
        self._pay(order["buyer"], order["amount_atto"])

    @gl.public.write
    def dispute(self, order_id: str, reason: str) -> None:
        order = self._load(order_id)
        if gl.message.sender_address != Address(order["buyer"]):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only the buyer can dispute")
        if order["status"] != STATUS_DELIVERED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only a delivered order can be disputed")
        if len(reason) < 10:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Dispute reason too short")

        order["status"] = STATUS_DISPUTED
        order["dispute_reason"] = reason[:800]
        self._save(order_id, order)

    @gl.public.write
    def resolve_dispute(self, order_id: str) -> str:
        order = self._load(order_id)
        if order["status"] != STATUS_DISPUTED:
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Order is not disputed")

        verdict = self._adjudicate(
            order["brief"],
            order["delivery_url"],
            order["delivery_note"],
            order["dispute_reason"],
        )

        if verdict["decision"] == "release":
            order["status"] = STATUS_RELEASED
        else:
            order["status"] = STATUS_REFUNDED
        order["verdict"] = verdict["decision"]
        order["verdict_reason"] = verdict["reason"]
        order["resolved_at"] = int(_now())
        self._save(order_id, order)

        if verdict["decision"] == "release":
            self._pay(order["seller"], order["amount_atto"])
        else:
            self._pay(order["buyer"], order["amount_atto"])
        return verdict["decision"]
