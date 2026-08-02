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
