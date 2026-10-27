# Testing GenLayer Intelligent Contracts locally

Most contract bugs are not consensus bugs. They are state bugs: a missing check, a wrong comparison, a status that never transitions. Those can be caught before a single validator runs.

This guide is the minimum loop that worked for a real escrow contract: direct tests, lint, and a two-case run in Studio.

## 1. What direct tests are

Direct tests run the contract in a local VM. No network, no validators, no gas. They are fast, deterministic, and good for:

- state transitions
- access control (buyer, seller, anyone)
- amount checks
- deadline logic
- revert messages

They do not test web fetches or LLM output. Those need Studio or Bradbury.

## 2. Setup

```bash
python -m venv .venv
.venv\Scripts\activate        # Windows
pip install -r requirements.txt
pip install genvm-linter
```

You need Python 3.11 and Node 18 or newer if you also use the JavaScript client.

## 3. Writing a direct test

The test runner provides fixtures for two accounts, usually `direct_alice` and `direct_bob`. Deploy with the constructor arguments, then call write methods and assert the stored state.

```python
def test_create_order(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/escrow.py", "0x" + direct_alice.hex())
    direct_vm.sender = direct_alice
    contract.create_order("a brief", 3600)
    order = contract.get_order("ord-0")
    assert order["status"] == "CREATED"
```

Two details that cost time:

- **Addresses arrive as bytes.** Convert them with `"0x" + value.hex()` before passing them to the contract.
- **Value transfers are explicit.** If a method is payable, set the value on the call, not on the deploy.

## 4. Running the tests

```bash
python -m pytest tests/direct -v
```

A healthy suite runs in under a second. If a test hangs, it is usually a fixture problem, not the contract.

## 5. Linting

```bash
genvm-linter check contracts/escrow.py
```

The linter catches runner version mismatches and forbidden imports before you deploy. If it fails with "Failed to load SDK ... runners/...tar not found", the three static checks already passed: the local runner bundle is missing, not the contract.

## 6. Windows gotchas

These are real, and they repeat.

**The SDK tarball returns 404.** The direct test SDK downloads `genvm-universal.tar.xz` from GitHub, and that URL can be gone for a release candidate. Copy the tarball that the linter already cached:

```powershell
Copy-Item ~/.cache/genvm-linter/genvm-universal-v0.3.0-rc7.tar.xz ~/.cache/gltest-direct/
```

**The test runner deletes a file it still has open.** In `genlayer-test` 0.29.2 on Windows, the loader removes a temporary file used as stdin. Wrap the `os.unlink` call in `try/except OSError`, or pin a newer version.

**Paths with spaces.** Deploy paths and contract paths break if they are not quoted. Use absolute paths or quote everything.

## 7. A Studio smoke test

Direct tests prove the state machine. Studio proves the integration.

1. Deploy the contract in Studio. It is gasless.
2. Run two cases: one delivery that meets the brief, one that does not.
3. Read the receipt and check `execution_result` and the stored verdict.
4. Keep the contract address and the two transactions.

Studio limits requests to about 60 per minute. Space the writes and retry transient RPC errors.

## 8. What direct tests miss

- **Web fetch failures.** A 404, a paywall, or a redirect can look like a bad delivery.
- **LLM nondeterminism.** Two validators can score the same page differently.
- **Validator disagreement.** The score band and the rubric only show up under consensus.
- **Appeal windows.** Transfers may execute after finalization, not at acceptance.

A two-case Studio run catches most of these early. A Bradbury run catches the rest.

## The minimum loop

1. Direct tests for every state transition.
2. Lint before every deploy.
3. Two Studio cases: one pass, one fail.
4. Read the verdict and the reason, not just the status.

That loop caught every bug in the escrow before any real money moved. It is not a full test strategy, but it is the cheapest one that works.

---

Petra (Luis Betancourt) builds agents and adjudication systems. Entropia Escrow is an open-source GenLayer escrow for creative commissions: https://github.com/Luis-Cwk/entropia-escrow
