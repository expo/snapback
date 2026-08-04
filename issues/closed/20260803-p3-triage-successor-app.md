# P3 — the Triage Graph successor app + budget freeze

**Status:** Resolved 2026-08-03 (program:
`20260803-local-first-continuation-program.md`; P1+P2 prerequisite satisfied)

The fresh provider-native Triage Graph implementation now lives under
`demos/triage-graph/`. It uses a generated two-node snapshot batch for the
online graph and a generated owner-scoped relational companion for LLP 0166
lease-authorized retained relaunch. The old Triage transforms were not copied;
`workload-manifest.2026-08-03.v1.json` records the OQ13 fresh-manifest refreeze.
Fleet remains excluded and blocked on LLP 0135 OQ5.

The Triage half of LLP 0157's Move-1 exit is retained at
`tests/acceptance/triage-graph-move1-v1.mjs`, with machine receipt, evidence,
and `--check`. The controlled source-binary run committed 249,000 baseline
events plus a 1,000-update burst, converged to 100 active matches, passed all
eight gates, persisted one durable registration and authorized lease, stopped
the owned backend, and rendered 100 rows from a fresh client as
authoritative-retained.

LLP 0155 OQ9's dated freeze is
`tests/acceptance/fixtures/triage-graph/budget-freeze.2026-08-03.v1.json`.
Custody freezes at 21 materializations/fragments, 120 stored result rows (100
authoritative-retained), 48,016 logical bytes, one 612-byte durable
registration, and one lease. Hydration freezes at one attempt, 100 installed
rows, 14,981 payload bytes, and a 1,000 ms ceiling (144.321 ms observed). These
measurements feed LLP 0166 OQ4's future measured revision; this lane does not
edit LLP 0166 or change a capability/status claim.

The build diary is `diaries/0054-triage-graph-successor.diary.md`. Follow-ups
are `issues/20260803-guide-gap-p2-materialization-retention.md` and
`issues/20260803-relational-query-projection-result-typing.md`.

## 2026-08-04 wave-drift note

The batched main-proof regeneration pass added Triage Graph to
`scripts/check-generated-artifacts`, where a clean regeneration now refuses
before writing with `TRUSTED_COMPOSITION_ACTIVATION_INVALID`: the committed
`trusted-composition-activation.json` no longer binds the generation derived
at main `640bae8db90b9fc6f4b9acef6dfbad9d9dad7b11` after the
relational-result-contract and later sessions-callback landings. This is an active Triage/P1–P3 authority artifact, not a
mechanical review-manifest refresh, so the drift pass has not reminted or
weakened it. Its owner must prepare the successor activation through the
existing trusted-composition machinery; until then the generated-artifact gate
and therefore local-proof remain honestly red.

## 2026-08-04 wave-drift resolution

After P3 closed, the batch drift pass used that exact machinery rather than
editing or weakening the trusted record. The coded Ibex bootstrap linked,
launched, and handler-VM-qualified the current clean source at `610b21105`.
Codegen then produced the unactivated current manifest pair; the built
`snapback composition-activation-prepare` command created a server-owned key
in a task-local database and prepared the successor for deployment
`triage-graph-p3-controlled-run`; ordinary codegen validated and published the
result. The task-local database and private keyring were deleted afterward;
only the public trusted activation and its review manifest are retained.

The successor activation hash is
`sha256:24a7913ae52d4face25a851fb39b8c4dd09ae9bb810d9878417863b1a753043d`.
Triage generation and the 22-demo provisioning inventory now pass. This
closes the dated handoff above without fabricating authority or bypassing the
P1/P3 preparation boundary.
