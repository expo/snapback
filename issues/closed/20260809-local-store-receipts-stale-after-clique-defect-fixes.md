# Local-store retained receipts pin pre-fix client/react sources; remint blocked on the S0 activation ceremony

- **Date:** 2026-08-09
- **Source:** clique-defects landing (llp-ship run `clique-defects-20260809`)
- **Systems:** drift gates, local persistent store, acceptance receipts
- **Related:** `issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`
  (the blocking precondition), LLP 0166 (carrier evidence), LLP 0200 landing
  record (the same cascade walked on 2026-08-09)

## What happened

The clique-defects landing changes `packages/snapback-client/index.mjs` (typed
search witness) and `packages/snapback-react/index.mjs` (content-keyed hooks,
queued-settlement rejection class). The retained local-persistent-store
receipts pin those sources by sha256, so the `local-store-carrier-receipt`
pre-push gate correctly reports them stale:

- `tests/acceptance/fixtures/local-persistent-store/carrier-exit.2026-08-04.v1.json`
- `tests/acceptance/fixtures/local-persistent-store/bundle-attribution.2026-08-04.v1.json`
- transitively, the retained triage-graph and fleet-observatory Move-1
  receipts, whose `source.files` also pin `packages/snapback-client/index.mjs`

## Why the remint is blocked

The documented remedy (re-mint triage → fleet → carrier-exit, then
`scripts/finalize-local-persistent-store-publication`) requires regenerating
`demos/triage-graph/snapback` and `demos/fleet-observatory-move1/snapback`
codegen, which fails with `TRUSTED_COMPOSITION_ACTIVATION_INVALID`: their
signed activations still bind the pre-S0 generation. Re-minting those
activations is a signed ceremony owned by the demo owners (see the related
ticket) — not something this landing should fake.

## What this landing did

Followed the S0 precedent: pushed with the documented loud bypass
(`SNAPBACK_DRIFT_GATES_BYPASS=1`), with this ticket as the record. The
`client-bundle-metrology` gate was NOT bypassed-in-spirit — its declared
rollover (`queued-settlement-truthfulness.2026-08-09.v1`) was properly minted
and committed in this landing. The `com.snapback.drift-backstop` schedule will
keep reporting the receipt staleness and dedupes against this open ticket.

## What to do (after the activation ceremonies re-mint)

In a checkout at or after this landing, with the ibex runtime bootstrapped and
`bun install --frozen-lockfile` run:

1. `node packages/snapback-codegen/index.mjs demos/triage-graph/snapback`
   (and fleet-observatory-move1) — requires the re-minted activations.
2. `node tests/acceptance/triage-graph-move1-v1.mjs`, then
   `node tests/acceptance/fleet-observatory-move1-v1.mjs`, then
   `node tests/acceptance/local-store-carrier-exit-v1.mjs` (full runs; volta
   node 24.18.0; `DYLD_FRAMEWORK_PATH=vendor/ibex/ios/Frameworks`;
   `cargo build --bin snapback` first so the binary identity stamps the tree).
3. `scripts/finalize-local-persistent-store-publication`, then verify
   `node --test tests/agent_safe_publication_checker_v1.mjs`.
4. Commit all re-minted records together and close this ticket.

## Resolution — 2026-08-10

The blocking activation ceremony ran (see the signed-composition ticket):
triage-graph and fleet-observatory activations re-minted through their full
acceptance runs on the post-S0 toolchain, then the documented remedy chain
completed exactly as specified: carrier-exit 17 PASS / 0 gap, finalize
published, publication checker 110/0. All re-minted receipts, activations,
and the refreshed publication carrier/anchor land together with this closure.

## Later remint log (merged from a leftover open copy, 2026-08-15 sweep)

The 2026-08-10 remint above closed the original clique-defects receipt
staleness. A headerless leftover stayed in `issues/` and recorded later
loud-bypass precedents after subsequent client-surface landings re-staled
the same receipts. Those notes are preserved here. Live remint work is
now tracked on:

- `issues/20260812-drift-gate-bypass-local-store-publication-unrepairable.md`
- `issues/20260811-record-inventory-local-store-publication.md`
- `issues/20260811-record-inventory-local-store-carrier-receipt.md`

## Precedent #3 — 2026-08-10 (remediation carrier + connected-client landing)

The consolidated LLP 0146 OQ6 + LLP 0222 landing changes
`packages/snapback-client/index.mjs` (remediation-set decoder,
connected-client typings), so the retained local-persistent-store receipts
are stale again in exactly the class this ticket records. The remint remains
blocked on the same signed-activation ceremony
(`issues/20260809-signed-composition-activations-need-remint-after-s0-toolchain-rotation.md`).
Following the S0 and clique-defects precedents: pushed with the documented
loud bypass, with this note as the record. Every other gate obligation was
run manually in the landing worktree first (module-ownership PASS with both
new modules assigned and one reviewed frozen edge; guide/check-inventories/
ref-check/diary-identity/contract-meta PASS; deployment-identity
regenerated; full targeted Rust + JS suites and clippy all-targets green).
The scheduled backstop continues to dedupe against this open ticket.

## Precedent #4 — 2026-08-10 (acceptance + reconciliation landing)

The 0225/0226 acceptances and the 0214/0227 reconciliation regenerate
`packages/snapback-client/diagnostic-codes.d.mts` (diagnostics registry
grew from concurrent fleet landings), staling the retained receipts in the
same blocked class. Same posture as precedents #1–#3: guide/ref-check/
inventory checks green manually; module-ownership's one live red is
tracked (`issues/20260810-main-module-ownership-red-rehearsal-edges.md`);
pushed with the documented loud bypass; the backstop dedupes here.

## Precedent #5 — 2026-08-10 (LLP 0218 P4 propagation + diagnostic landing)

The LLP 0218 P4 landing changes `packages/snapback-client/index.mjs` (the
§4.4 relinquishment diagnostic emission stub — the LLP 0219 attachment
seam), staling the retained local-persistent-store receipts in exactly
this ticket's blocked class; the remint remains blocked on the same
signed-activation ceremony. Same posture as precedents #1–#4: every other
gate obligation ran green in the landing worktree first (client-bundle
metrology with a frozen P4 rollover ledger, guide manifest +
check-guide, check-inventories, ref-check, full react/expo/contract
suites and the client outbox suites); pushed with the documented loud
bypass; the scheduled backstop continues to dedupe against this open
ticket. (Earlier same-day LLP 0218 landings — 9f62b14e2, e6d0fe270,
5b3122704 — passed this gate baseline-proven; P4 is the first the gate
attributes.)

**Precedent #6 — 2026-08-10, LLP 0224 Phase 1 landing (`2addc0631`),
pushed by the remediation-wave coordinator.** Same blocked class: the
delta touches `packages/snapback-client/diagnostic-codes.d.mts`,
staling the retained local-persistent-store receipts while the remint
stays blocked on the signed-activation ceremony ticket. Same posture
as precedents #1–#5: every other gate obligation was run green
manually in the landing worktree first (full Rust battery incl.
operational_readiness_v1 14/14 and wait_cli_v1; application-ready
process scenarios 7/7; check-guide; check-inventories 249;
module-ownership PASS with the new module assigned and no baseline
change; ref-check clean), then the documented loud bypass. The
backstop dedupes here.
