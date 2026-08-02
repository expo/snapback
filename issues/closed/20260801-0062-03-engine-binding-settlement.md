# 0062-03: engine consumption of generation binding + settlement

**Status:** OPEN. **Authority:** LLP 0062 §1 (call-time binding), §2
(finite seams); the RESOLVED asks 20260801-llp0012-call-time-
generation-binding.md and 20260801-llp0043-settlement-acknowledgement-
lifecycle.md (both in issues/closed/ — the server/client protocol
halves landed 2026-08-01).

Small consumption slice: verify the app-cli call families ride the
packaged client's artifact-pair assertion (they should — the engine
constructs SnapbackAppDataClient); surface the typed generation-resync
and removed-function refusals as frozen CLI outcomes; wire the
settlement/ACK store into the CLI mutation path (persist intent before
dispatch; never-ACK-unknown; recovery-after-removal golden per the
resolved ask's server re-attestation).

Done when: goldens cover deploy-mid-call refusal → refetch → success,
deploy-mid-watch resync, removed-function terminal recovery with zero
dispatch, and a kill-between-dispatch-and-ACK replay.

**Progress (2026-08-01, binding half DONE):** the engine now extracts the
complete five-key artifact identity from the loaded index and asserts it
as `expectedGeneration` on every call family — mutation, query, and live
establishment — falling back to the server's legacy unchecked path only
for pre-identity indexes. Wire-asserted by the package journey test
(all three families checked against the captured bodies). Remaining in
this ticket: the settlement/ACK store wiring into the CLI mutation path
and the four goldens (deploy-mid-call refetch, deploy-mid-watch resync,
removed-function recovery, kill-between-dispatch-and-ACK replay), which
want a real-server harness rather than the journey fake.

**Note 2026-08-01:** the settlement/ACK remainder's four goldens ride the
real-server harness that `20260801-0062-09-codegen-members-and-live-journey.md`
builds; execute them together.

**Note 2026-08-01 (0062-09 landed):** the real-server harness exists now —
`tests/acceptance/app-cli-served-journey.mjs` boots a sessions binary, drives
provision/discovery/fetch/verify/cache, and rotates the generation. The four
settlement goldens (deploy-mid-call refetch, deploy-mid-watch resync,
removed-function terminal recovery, kill-between-dispatch-and-ACK replay)
extend that suite rather than needing their own harness.

## Resolution — 2026-08-01

The four goldens landed on the journey harness as
`tests/acceptance/app-cli-settlement-goldens.mjs` (14 checks, green against a
real sessions binary; registered in `scripts/verify-local-proof` beside the
journey so a regression fails the proof rather than a fake-backed suite).

- **deploy-mid-call refetch** — a rotation between discovery and dispatch
  refuses `SNAPBACK_ARTIFACT_IDENTITY_MISMATCH` with `subcause: "generation"`
  and BOTH generations echoed; the golden pins the frozen exit
  (`ARTIFACT_IDENTITY_MISMATCH`, 7), then refetches, follows the rotation, and
  retries successfully.
- **settlement recovery + the ACK cut** — the durable file store arm is
  asserted (`rqsStoreInfo.durable === true`, the LLP 0043 process-per-invocation
  rule), settlements are recoverable before publication, explicit consumption
  admits ACK, and server ACK proof retires the recovery state.
- **unknown outcome is never ACKed** — a lost write raises instead of claiming
  success, classifies as `unknown` → exit 6 (transport), and mints no ACK
  obligation.
- **result-core byte parity over live HTTP** — the gate the 0062-04 landing
  deferred to a real served call: the core is byte-identical across
  constructions from the same wire outcome, and the wrapper embeds it verbatim
  with the served envelope identity.

**Defect found and fixed by the goldens:** the app-data façade — the client
LLP 0062 *requires* the engine to construct — exposed `acknowledgeMutations`
but neither `settledMutations` (stage-3 recovery) nor
`markMutationSettlementsConsumed` (the explicit consumption cut), so a caller
on that plane could acknowledge settlements it could never observe: LLP 0043's
lifecycle was unreachable on the CLI's own plane. The façade now projects the
lifecycle whole (plus `replayQueuedMutations`, `outboxStatus`, and the
`rqsStoreInfo` durability fact LLP 0043 requires callers to report). Every
member operates on the caller's own outbox under its own authority — app-data
plane by construction, no admin reach.

Deferred, unchanged: the deploy-mid-*watch* resync and removed-function
terminal recovery remain covered by the server-side activation tests the
`llp0012-call-time-generation-binding` resolution names; this ticket's engine
half is complete.
