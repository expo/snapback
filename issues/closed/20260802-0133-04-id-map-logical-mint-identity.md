# 0133-04: Receipt id-map paired by logical mint identity, unmapped-never-guessed

**Status:** Closed
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Runtime, Storage, Wire Protocol
**Depends on:** 0133-03
**Related:** LLP 0133 §Divergence on settle (class 1), §Receipts; LLP 0051 D5
(versioned recorded-answer format); `PlanIdSource` (shipped positional answers)

## Task

Construct the lane-L settlement receipt's **id-map**: speculative mint →
authoritative mint, paired by **(mint site, occurrence)** — never raw call
index, never count-based guessing.

- For the shipped HostPlan form the mint site is plan-step identity plus the
  within-step mint slot (`Insert`/`InsertEach` row id, or an
  expression-evaluated `ctx.runtime.id()` answer position — the shipped
  `PlanIdSource` already anchors every answer at exactly one site). The
  recorded-claim format carries each minted id's (site, occurrence) and is
  versioned per LLP 0051 D5 so the future IR evaluator's identities slot in.
- The settlement run records its own mint sequence first-hand; both runs
  execute the identical artifact (the elements-1/5 dependency), so sites are
  server-comparable.
- **Every mismatch leaves ids unmapped, never re-paired:** a site the
  settlement run never reached, unpaired occurrences of a count-divergent
  site, and every mint of a claim set that recorded no sites. Unmapped ids
  carry explicit markers in the receipt.
- Ids never declare bounded skew; id continuity is only ever the id-map.

## Exit

Sketch 3's server half, including the adversarial equal-count variant:
divergent branches that each mint exactly one id at different sites produce
an unmapped speculative mint — no cross-site pairing. Divergence variant:
per-site count mismatch leaves the excess occurrences unmapped. The stated
residue (within-site positional occurrence pairing under fan-out divergence)
is documented at the map-construction site with an `@ref` to OQ2's
graduation path.

## Resolution

Closed 2026-08-02 by `9cad757e` (`feat(settlement): map logical mint
identities`). HostPlan settlement now observes authoritative mints at stable
structural sites, numbers repeated executions within a site, and constructs
the private lane-L `idMap` only from unique exact `(site, occurrence)`
matches. Missing, duplicate, cross-site, and excess claims remain explicitly
`unmapped`; lane Q omits the map, and subscriber fan-out strips it. The
implementation deliberately retains OQ2's documented within-site occurrence
residue and does not add typed-id declarations or dataflow analysis.

Proof:

- `local::tests::llp0133_sketch_3_id_map_never_cross_pairs_sites_or_excess_occurrences`
- `local::tests::llp0133_sketches_2_and_7_apply_lane_policy_without_privilege`
  (exact duplicate returns the retained authoritative map)
- `synthetic_lane_l_wire_submission_rederives_before_commit`
- `cargo test --test artifact_schemas_v0 -- --nocapture` (30 passed)
- `bun run --cwd packages/snapback-client test` (green)
- `PATH="/usr/bin:$PATH" scripts/check-generated-artifacts` (green)
- `./ref-check --verbose` (green: 157 LLP docs, 4,071 refs, 0 errors)

The complete Rust library run proved 1,639 passing tests and inherited the
same three deterministic live-query failures recorded by tickets 02 and 03:
`rqs_mutation_after_answer_and_register_loses_no_ops`,
`rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
`standard_pattern_live_is_conservative_and_recorded`.
