import json


BRIEF1 = "Entregar poema corto en ingles sobre orbitas"
BRIEF2 = "Entregar metadata JSON lista para mint"
URL1 = "https://example.com/poema.json"
URL2 = "https://example.com/metadata.json"
NOTE = "Entrega parcial conforme"
DISPUTE = "El poema no habla de orbitas como pedi en la descripcion"
MS1 = 6 * 10**18
MS2 = 4 * 10**18
TOTAL = MS1 + MS2
CONTRACT = "contracts/milestone_escrow.py"


def _addr(account) -> str:
    """Direct fixtures return bytes when the SDK Address type is not importable."""
    if isinstance(account, (bytes, bytearray)):
        return "0x" + bytes(account).hex()
    return str(account)


def _deploy(direct_deploy, seller):
    return direct_deploy(CONTRACT, _addr(seller))


def _create(direct_vm, contract, buyer):
    direct_vm.sender = buyer
    direct_vm.value = TOTAL
    return contract.create_order([BRIEF1, BRIEF2], [MS1, MS2], 3600)


def _deliver(direct_vm, contract, seller, order_id, index, url):
    direct_vm.sender = seller
    contract.submit_delivery(order_id, index, url, NOTE)


def _mock_release(direct_vm, body="poema sobre orbitas y cuerpo"):
    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": body})
    direct_vm.mock_llm(
        r".*adjudicator.*",
        json.dumps({"decision": "release", "score": 88, "reason": "La entrega cumple el hito"}),
    )


def _mock_refund(direct_vm, body="texto generico"):
    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": body})
    direct_vm.mock_llm(
        r".*adjudicator.*",
        json.dumps({"decision": "refund", "score": 15, "reason": "No cumple la descripcion"}),
    )


def test_create_requires_matching_deposit(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = TOTAL - 1
    with direct_vm.expect_revert("!= milestones total"):
        contract.create_order([BRIEF1, BRIEF2], [MS1, MS2], 3600)


def test_create_validates_counts_and_amounts(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = MS1
    with direct_vm.expect_revert("counts differ"):
        contract.create_order([BRIEF1, BRIEF2], [MS1], 3600)
    with direct_vm.expect_revert("Milestones must be"):
        contract.create_order([], [], 3600)


def test_happy_path_partial_release(direct_vm, direct_deploy, direct_alice, direct_bob):
    """Milestone 1 approved and paid, milestone 2 refunded: partial payment works."""
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 0, URL1)

    order = contract.get_order(order_id)
    assert order["milestones"][0]["status"] == "DELIVERED"
    assert order["total_paid_atto"] == "0"

    direct_vm.sender = direct_alice
    contract.approve_milestone(order_id, 0)

    order = contract.get_order(order_id)
    assert order["milestones"][0]["status"] == "APPROVED"
    assert order["total_paid_atto"] == str(MS1)
    assert order["total_paid_atto"] != order["total_atto"]

    _mock_refund(direct_vm)
    _deliver(direct_vm, contract, direct_bob, order_id, 1, URL2)
    direct_vm.sender = direct_alice
    contract.dispute_milestone(order_id, 1, DISPUTE)
    assert contract.resolve_dispute(order_id, 1) == "refund"

    order = contract.get_order(order_id)
    assert order["milestones"][1]["status"] == "REFUNDED"
    assert order["total_paid_atto"] == str(MS1)


def test_only_seller_can_deliver(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Only the seller agent"):
        contract.submit_delivery(order_id, 0, URL1, NOTE)


def test_only_buyer_can_approve(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 0, URL1)

    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("Only the buyer can approve"):
        contract.approve_milestone(order_id, 0)


def test_dispute_release_pays_milestone(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 0, URL1)

    direct_vm.sender = direct_alice
    contract.dispute_milestone(order_id, 0, DISPUTE)
    ms = contract.get_order(order_id)["milestones"][0]
    assert ms["status"] == "DISPUTED"

    _mock_release(direct_vm)
    assert contract.resolve_dispute(order_id, 0) == "release"
    order = contract.get_order(order_id)
    assert order["milestones"][0]["status"] == "APPROVED"
    assert order["total_paid_atto"] == str(MS1)
    assert "cumple el hito" in order["milestones"][0]["verdict_reason"]


def test_dispute_refund_returns_milestone(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 1, URL2)

    direct_vm.sender = direct_alice
    contract.dispute_milestone(order_id, 1, DISPUTE)

    _mock_refund(direct_vm)
    assert contract.resolve_dispute(order_id, 1) == "refund"
    order = contract.get_order(order_id)
    assert order["milestones"][1]["status"] == "REFUNDED"
    assert order["total_paid_atto"] == "0"


def test_timeout_refunds_undelivered_milestone(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)

    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Deadline not reached"):
        contract.claim_timeout(order_id, 0)

    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.claim_timeout(order_id, 0)

    order = contract.get_order(order_id)
    assert order["milestones"][0]["status"] == "REFUNDED"
    assert order["milestones"][1]["status"] == "CREATED"


def test_timeout_rejected_if_delivered(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 0, URL1)

    direct_vm.warp("2030-01-01T00:00:00Z")
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("review or dispute instead"):
        contract.claim_timeout(order_id, 0)


def test_unparsable_llm_raises(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create(direct_vm, contract, direct_alice)
    _deliver(direct_vm, contract, direct_bob, order_id, 0, URL1)

    direct_vm.mock_web(r".*example\.com.*", {"status": 200, "body": "contenido"})
    direct_vm.mock_llm(r".*adjudicator.*", "no soy json")

    direct_vm.sender = direct_alice
    contract.dispute_milestone(order_id, 0, DISPUTE)
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.resolve_dispute(order_id, 0)


def test_seller_cannot_buy_own_service(direct_vm, direct_deploy, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_bob
    direct_vm.value = MS1
    with direct_vm.expect_revert("Seller cannot buy"):
        contract.create_order([BRIEF1], [MS1], 3600)
