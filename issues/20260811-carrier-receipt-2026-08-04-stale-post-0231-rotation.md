# Retained 2026-08-04 carrier-exit/bundle-attribution receipts stale after LLP 0231 rotations; refresh runner asserts

**Filed:** 2026-08-11 (ship run llp0231-visibility-20260811, Lane E2 landing)

The local-store-carrier-receipt gate refuses the E2 landing: retained records
`tests/acceptance/fixtures/local-persistent-store/{carrier-exit,bundle-attribution}.2026-08-04.v1.json`
pin source digests rotated by the LLP 0231 codegen landings (the 2026-08-06
pair re-mints fine and was refreshed in both Lane B and Lane E2). Running the
prescribed regenerate (`node tests/acceptance/local-store-carrier-exit-v1.mjs`,
volta node 24) asserts `04af72c3… !== dc65d6bc…` before writing — the -04
refresh path appears to require an all-aboard artifacts state that no longer
regenerates identically (all-aboard codegen also needs
SNAPBACK_OUTBOUND_ACTIONS=1 — its "pre-existing" BUNDLE_UNSUPPORTED_FETCH red
is just the missing flag; fix its policy/env wiring while here).

Landed with the loud bypass per the stale-retained-receipt precedent (#6,
LLP 0224 Phase 1 class); all other core-tier gates PASS at the pushed
revision. Fix-forward: refresh or re-date the -04 retained pair per its
governing doc, and wire the outbound-actions flag into all-aboard's codegen
job so the sweep and the gate agree.
