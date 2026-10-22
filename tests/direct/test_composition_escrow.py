import json


BRIEF = "Pieza de videodanza generativa sobre cuerpo y orbita, tono poetico"
URL = "https://example.com/pieza.json"
NOTE = "Composicion con seed orbital, texto listo para metadata NFT"
DISPUTE = "El texto no menciona danza contemporanea como pedia el brief"
DEPOSIT = 10**18


def _addr(account) -> str:
    """Direct fixtures return bytes when the SDK Address type is not importable."""
    if isinstance(account, (bytes, bytearray)):
        return "0x" + bytes(account).hex()
    return str(account)


def _deploy(direct_deploy, seller):
    return direct_deploy("contracts/composition_escrow.py", _addr(seller))


def _create_and_deliver(direct_vm, contract, buyer, seller):
    direct_vm.sender = buyer
    direct_vm.value = DEPOSIT
    order_id = contract.create_order(BRIEF, 3600)
    direct_vm.sender = seller
    contract.submit_delivery(order_id, URL, NOTE)
    return order_id


def test_create_order_requires_deposit(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_alice
    with direct_vm.expect_revert("Deposit required"):
        contract.create_order(BRIEF, 3600)


def test_happy_path_release_on_accept(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create_and_deliver(direct_vm, contract, direct_alice, direct_bob)

    order = contract.get_order(order_id)
    assert order["status"] == "DELIVERED"
    assert order["amount_atto"] == str(DEPOSIT)
    assert order["buyer"].lower() == _addr(direct_alice).lower()

    direct_vm.sender = direct_alice
    contract.accept(order_id)

    order = contract.get_order(order_id)
    assert order["status"] == "RELEASED"
    assert order["verdict"] == "release"
    assert contract.get_order_count() == 1


def test_only_seller_can_deliver(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = DEPOSIT
    contract.create_order(BRIEF, 3600)

    with direct_vm.expect_revert("Only the seller agent"):
        contract.submit_delivery("ord-0", URL, NOTE)


def test_seller_cannot_buy_own_service(direct_vm, direct_deploy, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_bob
    direct_vm.value = DEPOSIT
    with direct_vm.expect_revert("Seller cannot buy"):
        contract.create_order(BRIEF, 3600)


def test_timeout_refunds_buyer(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    direct_vm.sender = direct_alice
    direct_vm.value = DEPOSIT
    contract.create_order(BRIEF, 3600)

    direct_vm.warp("2030-01-01T00:00:00Z")
    contract.claim_timeout("ord-0")

    order = contract.get_order("ord-0")
    assert order["status"] == "REFUNDED"
    assert order["verdict"] == "refund"


def test_dispute_release(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create_and_deliver(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.mock_web(r".*example\.com/pieza\.json.*", {"status": 200, "body": "pieza de danza y orbita"})
    direct_vm.mock_llm(
        r".*independent adjudicator.*",
        json.dumps({"decision": "release", "score": 88, "reason": "La pieza cumple el brief"}),
    )

    direct_vm.sender = direct_alice
    contract.dispute(order_id, DISPUTE)
    assert contract.get_order(order_id)["status"] == "DISPUTED"

    decision = contract.resolve_dispute(order_id)
    assert decision == "release"
    assert contract.get_order(order_id)["status"] == "RELEASED"


def test_dispute_refund(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create_and_deliver(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.mock_web(r".*example\.com/pieza\.json.*", {"status": 200, "body": "texto generico sin danza"})
    direct_vm.mock_llm(
        r".*independent adjudicator.*",
        json.dumps({"decision": "refund", "score": 20, "reason": "No aborda la danza contemporanea pedida"}),
    )

    direct_vm.sender = direct_alice
    contract.dispute(order_id, DISPUTE)
    decision = contract.resolve_dispute(order_id)

    assert decision == "refund"
    order = contract.get_order(order_id)
    assert order["status"] == "REFUNDED"
    assert order["verdict_reason"].startswith("No aborda")


def test_unparsable_llm_raises(direct_vm, direct_deploy, direct_alice, direct_bob):
    contract = _deploy(direct_deploy, direct_bob)
    order_id = _create_and_deliver(direct_vm, contract, direct_alice, direct_bob)

    direct_vm.mock_web(r".*example\.com/pieza\.json.*", {"status": 200, "body": "contenido"})
    direct_vm.mock_llm(r".*independent adjudicator.*", "no soy json")

    direct_vm.sender = direct_alice
    contract.dispute(order_id, DISPUTE)
    with direct_vm.expect_revert("[LLM_ERROR]"):
        contract.resolve_dispute(order_id)
