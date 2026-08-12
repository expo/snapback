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

## Resolution (2026-08-12, LLP 0231 remainders run)

**Re-dated, not refreshed.** The all-aboard half of this ticket's diagnosis was
already stale: both all-aboard roots carry `outboundActions: true` in
`scripts/generated-artifact-policy.mjs` (since `e6412b9b24`, 2026-08-04), and
the sweep runner already translates that into `SNAPBACK_OUTBOUND_ACTIONS=1`.
There was nothing to wire; both roots regenerate cleanly through the
registry-owned policy.

The real blocker was the retained -04 pair. Recomputing every source digest the
-04 carrier names found **10 of 24 mismatched** — including
`materialization-store.mjs`, `rqs-store.mjs`, and the carrier runner itself — so
the all-aboard environment was never the whole cause. The runner also now
hard-codes `RUN_DATE = '2026-08-06'` and cannot honestly write a current-source
witness under an -04 label.

The -04 pair is therefore retired from this gate's active custody and the
already-governed **-06 pair** is retained and re-minted against current sources
(LLP 0166 names -06 as the current 17/0/0 exit; LLP 0175 requires a registered
gate to name its actual committed record; LLP 0189 D-4 requires coverage to move
to a real replacement rather than vanish). The -04 files are left in place
untouched because the independent `local-store-publication` chain still names
them — see `issues/20260811-record-inventory-local-store-publication.md`.

Gate verified at 17 PASS / 0 GAP / 0 SKIPPED with no bypass. Landed with the
re-mint commit.
