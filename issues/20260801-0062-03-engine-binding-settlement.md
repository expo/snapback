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
