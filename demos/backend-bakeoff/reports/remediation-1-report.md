# LLP 0102 first Snapback remediation report

**Starting calibration commit:** `ed31c1dd428298dc7ab4734ee2e3c2354112ba1a`
**Calibration synthesis commit:** `d4d8fc21e1a57dbe30ee406718266f1db0c18638`
**Frozen remediated Snapback commit:** `5f31cb6174daaefa04a1e05242acbbc22c725040`
**Frozen reruns:** Todo and realtime group chat
**Stop-class defects:** 0

## Result

All four accepted calibration remediations are verified against their own
focused tests and the unchanged Todo/Chat acceptance scenarios:

| Arm | Calibration | Remediation rerun |
| --- | --- | --- |
| Todo / Snapback | 10 PASS / 3 GAP / 1 FAIL | **11 PASS / 3 GAP / 0 FAIL** |
| Chat / Snapback | 13 PASS / 1 GAP / 1 FAIL | **14 PASS / 1 GAP / 0 FAIL** |

The recurring protected-live revocation defect is gone. The frozen product
GAPs are unchanged: protected cold offline history, queued offline writes and
their reconnect settlement in Todo, plus protected cold offline history in
Chat.

This report does not rewrite the calibration score or elapsed-time record. The
original report remains the ranking of the starting commit; the deep round
will score the new frozen commit on three new apps.

## Accepted and verified

### SB-001 — protected live revocation

Declaration-bound resource- and app-scoped `requireRole` queries now accept a
strictly newer authorization epoch only within the same issuer, scope, version
stream, and authorization incarnation. Lower epochs and other incarnations
remain stale.

The real-server proof covers delete and downgrade for both resource and app
membership: blank before the causing mutation returns, terminal delete, exact
ACK, fresh denial, no later protected delivery, and continued operation of an
authority-independent live query. Frozen `TODO-12` and `CHAT-13` both pass.

### SB-002 — idempotent live disposal

The high-level handle owns a read-only subscription generation. Repeated
dispose shares one task; exact server-confirmed absence, logout, whole-session
revocation, and query-specific terminal deletion return the typed
`SNAPBACK_LIVE_SUBSCRIPTION_ALREADY_RETIRED` outcome. The public low-level
unsubscribe and ownership/session mismatches remain strict.

The coordinator's combined real-server gate found one edge after the
branch-local tests: disposal after query-specific terminal deletion attempted
a second retirement under the stale query fence. That integration defect was
fixed before the rerun.

### SB-003 — ephemeral readiness and generated typing

Default `subscribeEphemeral` now owns stream demand and proves readiness before
subscribing. Its overlay owns that demand until disposal; explicit poll mode
retains manual-drain behavior. Code generation preserves the declared
ephemeral scope/value shape.

The Chat provider and acceptance runner contain no manual
`liveStreamManager(...).waitUntilReady()` call. Typing and presence pass on
fresh connection labels, and generated rows no longer degrade to `unknown`.

### SB-004 — effect-free reservation retry

The normal JavaScript and Swift mutation clients retry only the exact closed
409 diagnostic carrying `retryable: true`, `retryStrategy: "short-jitter"`,
and `effectCommitted: false`. Retry is bounded, observable, cancellable, and
pinned to one authority/carrier generation. Ambiguous, contradictory,
committed, wrong-status, and exhausted outcomes remain visible.

Todo edit/reorder and Chat concurrent send now use direct client mutations with
no application retry loop. Retained diagnostics prove the retry: Todo records
one scheduled retry before each ordinary data conflict; Chat records attempts
`[1, 2]` and two exactly-once committed messages.

Independent review caught and corrected two high-impact designs before freeze:

- an external bearer replacement could have replayed predecessor arguments
  under the successor bearer;
- Swift `action` retry could have replayed external I/O performed before a
  nested mutation refusal.

The final client fails stale on a carrier-generation change, and Swift
automatic replay is mutation-only.

## Deferred and refused

The ledger preserves four investigation items for the deep round:

- SB-005 protected retained history and a normal-client outbox;
- SB-006 prepared Ibex/Hermes first build;
- SB-007 authority/cache provenance diagnostics;
- SB-008 deterministic ordered append and stable cursor paving.

SB-009 remains a deliberate non-goal: Snapback should improve its native typed
ephemeral path rather than imitate competitor durable-TTL workarounds.

## Evidence isolation and failed attempts

Remediation receipts are separate from calibration capsules:

- `reports/remediation-1/evidence/todo/`
- `reports/remediation-1/evidence/chat/`

Both runners used unique `/private/tmp/llp0102-remediation1-*-runtime` roots,
dynamic ports, and exact target cleanup. The roots, persona carriers, and
built persona carriers are absent after each run.

The first Todo rerun completed the repaired product scenarios and cleanup but
failed its old aggregate assertion of 10 PASS / 1 FAIL. Its partial receipts
are preserved under
`reports/remediation-1/failed-attempts/todo-static-count-assertion/`. Only the
expected aggregate changed to 11 PASS / 0 FAIL; the frozen scenario set did
not change.

## Central proof

- Snapback client suite: pass.
- Snapback codegen suite: pass.
- Snapback contract suite: pass.
- Swift client: 40 tests pass.
- Four-shape real-server revocation acceptance: pass.
- Todo and Chat production builds: pass.
- Package test inventory: 91 declared test files.
- `./ref-check --verbose`: 2,210 references, zero errors, zero unchecked.
- Guide check: pass with the same 23 freshness warnings.
- Cleanup proofs: present and exact for both reruns.
- Ledger verifier: pass after serialized integration.

The accepted fixes refine Snapback's existing authority, settlement, live, and
ephemeral architecture. They do not require a fundamental approach change.
The deep round should now test whether those repaired foundations translate
into competitive authoring and product outcomes outside the calibration apps.
