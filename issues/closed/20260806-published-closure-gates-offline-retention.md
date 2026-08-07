# Published closure fences out the offline-retention contract the guide teaches

**Status:** Closed — published in 0.1.11 (2026-08-06)
**Impact:** 5
**Urgency:** 4
**Ease:** 3
**Confidence:** 5
**Systems:** Packaging, Local persistent store, Guide, Agent experience
**Date:** 2026-08-06
**Governing:** LLP 0041, LLP 0166
**Related:** Diary 0065; `demos/rematch-bakeoff/snapback/build-log.md`;
`guide/sync/offline-and-retention.md`

## Problem

An external consumer on `@expo/snapback-*@0.1.10` declaring
`authorityIndependent: true` is refused: the capability requires
`single_table_v1`, which the published runtime rejects as an
experimental/GAP surface ("public packages remain structured GAPs"). The
guide teaches platform-retained offline as the paved path, and it is
Snapback's largest competitive differentiator (Diary 0058 scored offline
94 vs 62) — but no npm consumer can reach it. The rematch bakeoff's cold
agent shipped an app-level cache instead, structurally identical to the
Convex arm's workaround, collapsing the offline scoring edge to 66 vs 62
(Diary 0065).

## Ask (author ruling)

Either (a) promote `single_table_v1`/the retention contract into the
published closure at the next release — LLP 0166's activation state and
the agent-safe acceptance tail govern readiness; or (b) fence the guide's
offline pages for the published-consumer audience (the `since:`/
`unreleased:` machinery from `guide/conventions.md` — but note this is a
capability gate, not a version vintage, so it may need a new fence
flavor). Option (a) is what the benchmark needs; option (b) is the honest
interim. Until one lands, every external bakeoff will re-pay this
discovery and re-forfeit the dimension.

## Ruling and resolution — 2026-08-06

Charlie ruled **"Route 2"**: ship (a) by a dated author amendment rather
than by first building the full signed-attestation lane. Landed on main
the same day:

- **Interim fence (immediate honesty):** banners on
  `guide/sync/offline-and-retention.md`, `guide/realtime/live-queries.md`,
  and `guide/realtime/snapshot-bundles.md` telling published-package
  consumers the declaration is refused on 0.1.10 and ships at 0.1.11.
- **Amendment:** LLP 0110 "Single-table public-package advertisement
  amendment — 2026-08-06" (normative) and LLP 0166 "Public-package
  advertisement amendment — 2026-08-06". For `single_table_v1` only,
  public-package advertisement = clean-release public-package build
  identity + the byte-identical embedded contributor carrier chain + a
  `snapback.packaged-store-qualification.v1` receipt binding the store
  acceptance run to that exact staged closure and binary. Signed
  `PackageCapabilityAttestationV1` stays the end state (owner Charlie,
  review 2026-09-30). All other packaged capability gates unchanged.
- **Mechanism + proof:** predicate/receipt verification in
  `src/manifest.rs`, mint subcommand in `src/cli.rs`, loader seam in
  `@expo/snapback-cli`, harness `scripts/packaged-store-qualification.mjs`;
  proven end to end on linux-x64 (suite 3/3, receipt-backed advertisement,
  no-receipt refusal) —
  `tests/acceptance/receipts/packaged-store-qualification.proof.2026-08-06.v1.json`.

**Stays open until:** the 0.1.11 release stages its real closure, re-runs
the harness per platform, ships each minted
`packaged-store-qualification.receipt.json` inside the runtime packages,
publishes, updates `guide/published-closure.json`, and sweeps the three
banner fences above plus the capability-index row's 0.1.10 caveat. Close
this ticket in that landing.


## Closed — 2026-08-06

Route 2 shipped and PUBLISHED: single_table_v1 admitted from npm 0.1.11 (receipt-backed cold-install verification in LLP 0041 §0.1.11).
