# Mint the familiar-profile-admission client-bundle rollover (blocked on pre-existing baseline staleness)

**Opened:** 2026-08-13 (LLP 0253 Phase C landing)

The LLP 0252/0253 familiar-profile landing adds the public
`@expo/snapback-client/reference-kinds` subpath (client profile admission)
and the `@expo/snapback-react/familiar` entrypoint. The client-bundle
metrology therefore needs first-run receipts for
`public-subpath-reference-kinds` / `resolved-public-subpath-reference-kinds`
(derived expectation in `assertResolvedNarrowSubpathAbsence`), declared as
the pending (unfrozen) rollover ledger
`baseline.familiar-profile-admission.v1.json`
(spec in `scripts/client-bundle-metrology.mjs`, profiles fixture committed
empty).

**Blocked:** `--write-rollover-baseline` refuses because the ratchet is
red **at origin/main itself** (verified 2026-08-13: `--check` at detached
`origin/main` fails with e.g. `app-data-operation-live` 450,925 → 458,151
min bytes) — pre-existing unmetered growth from the LLP 0245–0249 wave,
whose measurement rerun is already owed
(`issues/shelved/20260812-0247-0248-measurement-reruns.md`). This landing's own
residual on that bundle is ~+694 min bytes (branch measures 458,845;
commands-subpath inputs proven byte-identical base-vs-branch).

**To close:** when the 0245–0249 measurement rerun pays the baseline debt,
mint this rollover in the same pass
(`volta run --node 24.18.0 node scripts/client-bundle-metrology.mjs
--write-rollover-baseline`), fill the ledger's `byteDeltas` with the
measured first-run numbers, and commit the minted baseline + profiles
fixture.
