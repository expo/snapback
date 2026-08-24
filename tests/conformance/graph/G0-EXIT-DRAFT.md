# LLP 0209 v0.6 G0 exit note — orchestrator draft

**Draft date:** 2026-08-23  
**Contract:** LLP 0209 v0.5  
**Stage A evidence:** `50c1b610d` through converged record `77ed8394d`  
**Stage B1 evidence:** series ending `73232029d`  
**Stage B2 evidence:** series ending `4627f9d95`  
**Stage B3 evidence:** this uncommitted worktree; replace with the landed SHA
before folding this note into LLP 0209.

This draft does **not** claim G0 exit. It records the evidence available now
and the missing carriers without making a G2, G3, runtime, publication,
latency, or graph-executor claim. It does not change LLP 0209's status.

## Stage B checklist

| # | Status | Evidence and remaining gap | Verification |
| ---: | --- | --- | --- |
| 1 | COMPLETE | B1 closed plan/node vocabulary and fail-closed matcher; B2 codegen constructor | `cargo test -p snapback-types`; codegen graph suite |
| 2 | COMPLETE | Rust/JS vectors plus three host-admitted Zerobugs carriers | `identity_vectors`; `zerobugs_declarations_admit_with_host_identities` |
| 3 | PARTIAL | The crew-or-public `visibility` inputs derive class 2, principal-bound nodes derive class 3, five paired worlds exact-match across wholly hidden rows, and the executable `allowDeny` case freezes the legitimate crew/ordinary activation against the oracle. Class-2 scope identities are owner-resolved from frozen role, membership, and visibility facts and independently reconstructed by Rust. The hidden-root detail pair correctly has an empty child vector, but B1 still refuses that form; no graph evaluator or host-proven broadcast certificate exists at G0. | `paired_worlds`; `allow_deny_cases_are_oracle_frozen_and_structurally_executable`; `owner_resolved_class2_scope_identities_partition_equivalence`; `issues/20260823-graph-empty-child-demand-window-vector.md` |
| 4 | PARTIAL | Every paired-world result and the allowed activation result carries a proof tuple whose materialization and partition hashes are reconstructed by Rust. The hidden-root detail pair remains explicitly blocked on B1 accepting the empty-child interval vector, so this row does not claim universal instance admission. | `completeness_labels`; `paired_worlds` |
| 5 | COMPLETE | Closed `GraphCapturedReadV1` vocabulary and one top-level captured-read arm exist; execution consumption remains deferred by the staged contract | `dependency_shapes`; snapback-types graph-capture tests |
| 6 | PARTIAL | Three declarations, eight executable oracle cases, five exact-match paired worlds, one executable oracle-frozen `allowDeny`, three executable refusals, closed translation coverage, a real detail resume through `commentsPage`, authoritative miss and closed cost-refusal cases, graph-order labels, and the one live comments tie disposition are frozen. The large fixture spot check and graph evaluator remain unavailable. | corpus freezer; `oracle_field_maps_and_refusals_are_closed`; `paired_worlds`; `allow_deny_cases_are_oracle_frozen_and_structurally_executable` |
| 7 | PARTIAL | Normal-fixture typed exit observations are complete for all three graphs. Large/hot maxima and observations are unavailable, and every affected bound field is explicitly provisional with its validation command. | `bounds_are_fixture_derived`; `broadcast_inputs_complete` |
| 8 | NOT SATISFIED | Only `G0-BCAST-IDENTITY` is satisfied. Every admitted base is class 2 and every projection rolls up to class 3, so all three plans record `base-not-class-1`; no class-1 broadcast base or executed counterfeit-broadcast refusal exists. `allowDeny` is executable in the main corpus; four graph-evaluator case kinds remain non-executable structural records, and eight LLP 0268 §7 labels lack named carriers. | `g2_pending_broadcast_cases_are_structurally_frozen`; `broadcast_inputs_complete` |
| 9 | COMPLETE | Additive sibling arm/capability/constructor; relational corpus unchanged; no serving consumer | `no_runtime_consumer`; relational corpus suite |

The executable G0 corpus contains five exact-match `pairedWorld` cases, one
oracle-frozen `allowDeny` case, and three `refusal` cases. The eight oracle
comparison cases execute through the fixture oracle/freezer. The sidecar
contains only `audienceParity`, `scopeMismatch`, `authorityTransition`, and
`mixedCommit`; those four graph-evaluator records are structurally closed,
carry no `pending` arm, and are not executed.

## LLP 0268 §7 inputs

| Label | Status | Evidence or specific missing carrier |
| --- | --- | --- |
| `G0-BCAST-CLASS` | NOT SATISFIED | `issueListV2` and `listIssueByID` derive n0–n4 as class 2 and n5–n6 as class 3; `issueDetail` derives n0–n5/n7 as class 2 and n6/n8/n9 as class 3. All three broadcast admissions therefore say `base-not-class-1`; no class-1 base or executed counterfeit-broadcast refusal is frozen. |
| `G0-BCAST-SEPARATION` | NOT SATISFIED | Missing host-proven separation certificate and evaluator |
| `G0-BCAST-SCOPE` | NOT SATISFIED | Owner-normalized scope identities and same/different equivalence assertions are frozen and Rust-reconstructed; executed P/Q mismatch evidence remains missing |
| `G0-BCAST-SCOPE-BINDING` | NOT SATISFIED | Missing executed resource-to-scope equality proof |
| `G0-BCAST-AUDIENCE` | NOT SATISFIED | Missing executed establishment/strict-evaluator parity |
| `G0-BCAST-INVALIDATION` | NOT SATISFIED | Missing executed authority-transition and mixed-commit fence evidence |
| `G0-BCAST-IDENTITY` | SATISFIED | Full plan, instance, materialization, partition, authorization-version, and evaluation-cut preimages with Rust reconstruction |
| `G0-BCAST-CORPUS` | NOT SATISFIED | Four graph-evaluator case kinds are structurally pending and non-executable at G0; `allowDeny` is executable in `corpus.v1.json` |
| `G0-BCAST-BOUNDS` | NOT SATISFIED | Missing large/hot typed observations and non-provisional maxima with pending author ratification (v0.6) |

The machine-readable source is `corpus.v1.json.broadcastInputs`. Per LLP 0268
§0, G0 exit must be extended and re-recorded before LLP 0268 B1; the eight
unsatisfied labels cannot be carried forward as an implicit claim.

## Bounds and provisional ratification

No aggregate or average substitutes for a maximum. The freezer derives normal
maxima from rows, large totals from the receipt, label fanout from the
generator's closed uniform `1..3` rule, comment fanout from the documented
floored-exponential rule (which has no finite per-issue ceiling), and the hot
working set from the manifest-defined `W = 1,000` interval.

| Query / field | Declared value | Basis | Ratification |
| --- | ---: | --- | --- |
| `issueListV2.maxRootRowsPerPage` | 1,024 | hot filtered interval maximum 1,000 with portable-boundary headroom | PROVISIONAL — hot validation required |
| `issueListV2.maxWindowPages` | 1 | `ceil(max(normal filtered project 516, hot W 1,000) / 1,024)`; never the million-row whole-table receipt | PROVISIONAL — large selected-project interval required |
| list/point label `maxChildrenPerParent` | 16 | max(normal 5, generator closed maximum 3), with declared headroom | derived — provisional, pending author ratification (v0.6) |
| selected-label `maxItems` / expansion | 16 | authored collection ceiling | derived — provisional, pending author ratification (v0.6) |
| `issueListV2.maxResultRows` | 1,024 | one admitted hot page | PROVISIONAL — hot validation required |
| `issueListV2.maxResultBytes` | 33,554,432 | normal mapped result 436,163 bytes with exact declared ratio | PROVISIONAL — large validation required |
| detail comment `maxChildrenPerParent` | 1,024 | control refusal boundary; normal maximum 21; large receipt ceiling 2,527,886; seed-42 per-issue maximum unavailable | PROVISIONAL — large validation required |
| detail comments `maxWindowPages` | 1 | `ceil(normal maxCommentsPerIssue 21 / maxChildrenPerParent 1,024)` | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| detail comments lineage | pages 1; scanned rows 1,025; index ranges 1; result rows 1; result bytes 8,388,608 | one declared comments page at the normal maximum | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| detail `windowRollup` | pages 2; root rows 1; scanned rows 2,092; result rows 2; result bytes 16,777,216; index ranges 27 | root lineage plus one planned comments lineage, per §2.6 | PROVISIONAL — seed-42 per-issue maximum requires zb5 |
| `issueDetail.maxResultRows` | 1 | point root | derived — provisional, pending author ratification (v0.6) |
| `issueDetail.maxResultBytes` | 8,388,608 | normal mapped result 20,261 bytes with exact declared ratio | PROVISIONAL — large validation required |
| `listIssueByID.maxResultRows` | 1 | point root | derived — provisional, pending author ratification (v0.6) |
| `listIssueByID.maxResultBytes` | 1,048,576 | normal mapped result 6,479 bytes with exact declared ratio | PROVISIONAL — large validation required |
| all graphs `maxMaintainedWritesPerMutation` | 0 | G0 owns no graph-maintained writes | derived — provisional, pending author ratification (v0.6) |

Every provisional field in `bound-derivation.v1.json`, including analytical
physical and operational fields omitted from this compact table, carries the
applicable command:

```sh
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v11 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-hot.mjs
```

Normal facts are 14 users, 516 issues, 924 comments, 30 labels, and 603
issue-label edges, with per-issue maxima of 21 comments and 5 labels. The
large receipt records 100 users, 100 projects, 1,000,000 issues, 2,527,886
comments, 4,810 labels, and 2,000,370 issue-label edges; the preserved CSV
shards needed for the exact seed-42 per-issue maximum are absent.

## Exit observations

All fields of `GraphG0ExitObservationV1` are present for the normal fixture.
Each group-state measurement is the serialized mapped result plus its proof
tuple, and dependency bytes are the serialized typed captured-dependency
vector.

| Query | Result bytes | Captured-dependency bytes | Group-state bytes |
| --- | ---: | ---: | ---: |
| `issueListV2` | 436,163 | 1,459,700 | 436,471 |
| `issueDetail` | 20,261 | 5,341 | 20,569 |
| `listIssueByID` | 6,479 | 3,752 | 6,787 |

Large and hot observations are **NOT SATISFIED** for each of the three queries.
They remain outside the typed observation array and appear only in
`g0ExitObservationGaps`, with the commands above. `GraphG0ExitObservationV1`
has no deferred/unavailable arm; that missing arm is a Spec gap for the v0.6
note. No incomplete pseudo-observation is emitted.

## Oracle dispositions

- All mapped `labels` arrays are ordered by graph `labelID` before freezing.
  The exact through-target `label.name` ordering remains an admission refusal
  for all three full oracle shapes.
- `issueListV2` declares `modified DESC, sourceIssueID DESC`. The 69 equal-
  `modified` groups are resolved by the explicit secondary field; only the
  residual physical `_id` layer is eligible for `direction-tie-break`, and the
  frozen fixture has zero residual groups.
- `issueDetail` comments declare `created DESC`. Its executable continuation
  case emits the singular `oracleDivergence: "direction-tie-break"` and uses
  `exact-after-id-tiebreak-normalization`: row sets exact-match, and physical
  `_id` normalization applies only within the one tied `createdAt` group.
- The detail oracle suite resumes its frozen non-null cursor through the
  control's `commentsPage` seam and exact-compares the non-empty mapped next
  page (`g0_window_0050`, digest
  `sha256:766a764b9762f427c38d04926229681841d0b09dba80e46c026dee86dfcbd19b`).
  It also includes the null-cursor/empty cost-bound refusal and an
  authoritative miss. Every
  `(status, reason, when)` translation row is linked to an executable case or
  explicitly marked unexercised in the corpus.

Normal raw-oracle and mapped-result measurements:

| Query | Raw bytes / digest | Mapped bytes / digest |
| --- | --- | --- |
| `issueListV2` | 517,010 / `sha256:ebbb09fcf00829c123668cb17f6ef4b85c463140a72aa284796bf9ef27920d57` | 436,163 / `sha256:91cae199e894962f4a8b65c27f96e6ccdb267978eedd9c599ac02c5c27073e5a` |
| `issueDetail` | 26,549 / `sha256:7bb0b07afc67af3b26612714f3a60a7127129efc58941a242331c643f81671ee` | 20,261 / `sha256:3c9376a566186db13c096228213bf38cf41634c68b0b8f500547078b8b14637a` |
| `listIssueByID` | 6,806 / `sha256:6e4f672f309fb6d8d8c98e8317a6aee3908c08dc1d0ce8471b9a23766abe910f` | 6,479 / `sha256:401b1a6821acac378d285223eeff07b74a0ecfeb7938556f42b6c7d3726adee8` |

## Frozen artifact digests

| Artifact | Content digest |
| --- | --- |
| `corpus.v1.json` | `sha256:bd28f10b51057cfec697c31eb0104ee9e30d9999a4e571d495fd1e77d25932d3` |
| `bound-derivation.v1.json` | `sha256:3e2f942c7d627da65eb8af0b7545e7e164c1d0a312aca5d5d9817f9b71a59430` |
| `paired-world-fixtures.v1.json` | `sha256:afcb09c4d2599a0fff1efb3123f6b9692e31ab43c99ae236314caeb6a9cb9d25` |
| `broadcast-cases.g2-pending.v1.json` | `sha256:98b9de2ef61745507b6faf72af5d4b89e709c643a00df3ea210a6ee3b312ce4d` |

## Remaining gaps

- Eight LLP 0268 §7 broadcast inputs are not satisfied; their exact missing
  carriers are listed above.
- The hidden/missing-root detail pair has the correct empty comments interval
  vector but remains blocked on B1's empty-child acceptance ticket.
- Large/hot maxima and typed exit observations require the recorded zb5 runs.
- `GraphG0ExitObservationV1` needs a deferred/unavailable arm or an explicit
  owner ruling in the v0.6 note.
- LLP 0267's physical-window wording and hard retained group-state/frame/
  handoff bounds remain owner work; normal measurements here are observations,
  not those hard bounds.
- The exact label-name-ordered through shape remains unrepresentable in v1 and
  is refused rather than approximated.

## Exit command block

The orchestrator appends the final verbatim results after all requested checks
run. Until the missing carriers above are supplied, those green checks validate
this partial record; they do not convert it into a G0 exit claim.
