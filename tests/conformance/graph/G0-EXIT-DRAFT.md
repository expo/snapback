# LLP 0209 v0.6 G0 exit note — orchestrator draft

**Draft date:** 2026-08-23  
**Contract:** LLP 0209 v0.5  
**Stage A evidence:** `50c1b610d` through converged record `77ed8394d`  
**Stage B1 evidence:** series ending `73232029d`  
**Stage B2 evidence:** series ending `4627f9d95`  
**Stage B3 evidence:** this uncommitted worktree; the orchestrator replaces this
line with the landed SHA before folding the note into LLP 0209.

This is only the §9 content to fold into the author-owned LLP. It makes no G2,
G3, runtime, publication, latency, or observed graph-executor claim, and this
file does not change LLP 0209's status.

## Stage B checklist

| # | State | Landed evidence pointer | Stable verification |
| ---: | --- | --- | --- |
| 1 | Complete | B1 `GraphQueryPlanV1`/seven node arms, `HandlerPlan::GraphQuery`, schema output, and fail-closed matcher (`73232029d`); B2 `defineGraphQuery` (`4627f9d95`) | `cargo test -p snapback-types graph_query_v1`; codegen graph suite |
| 2 | Complete | `tests/conformance/graph/identity-vectors.v1.json`, `keyset-vectors.v1.json`; B3 carriers in `corpus.v1.json` | `identity_vectors`; `zerobugs_declarations_admit_with_host_identities` |
| 3 | Complete at G0 | Compiler authority proofs in every B3 carrier; six `policy-extension-v1` pairs; class-3 partition-of-one declarations | codegen `authority` filter; `paired_worlds` |
| 4 | Complete | Closed proofs on every paired-world normalized node plus graph composition citations/hashes in `corpus.v1.json` | `completeness_labels` |
| 5 | Complete, execution deferred by contract | B1 `CapturedReadKind::GraphNode` and `GraphCapturedReadV1` vocabulary; no matcher consumption | `dependency_shapes`; snapback-types/sync graph-capture tests |
| 6 | Complete with recorded fixture deferral | Three declarations in `tests/conformance/graph/zerobugs/`; exact normal oracle envelopes/digests, leaf-closed field maps, mapped rows/order/labels, a 50-row resume witness, three executable admission refusals, and the tied backward case | `zerobugs_declarations_admit_with_host_identities`; `oracle_field_maps_and_refusals_are_closed`; freeze script. Large identity/label spot check is deferred to the zb5 gate rerun because `demos/zerobugs/fixtures-local/large-seed42-v1/` is absent. |
| 7 | Complete declarations; large/hot observation cells deferred | `bound-derivation.v1.json` carries every numeric field with a derivation and `[G2 measures]` physical posture. `corpus.v1.json.g0ExitObservations` records normal serialized-oracle/dependency carrier sizes; large/hot rows name the zb5 rerun. | `bounds_are_fixture_derived`; freeze script |
| 8 | Complete | `corpus.v1.json.broadcastInputs` carries all nine LLP 0268 labels and all seven §3.4 case kinds; evaluator-dependent records are explicitly `pending: "G2"` | `broadcast_inputs_complete` |
| 9 | Complete | Additive sibling arm/capability/constructor, relational corpus unchanged, support false on every target, fail-closed matcher and forged-invoke refusal | `no_runtime_consumer`; relational corpus test |

Large/hot rerun command, frozen verbatim:

```sh
ZBUGS_LARGE_FIXTURE_ROOT=demos/zerobugs/fixtures-local/large-seed42-v1 ZBUGS_ATTEMPT=v4 volta run --node 24.18.0 node demos/zerobugs/control/tests/acceptance/gates/zb5-large.mjs
```

## LLP 0268 §7 inputs

| Label | Artifact |
| --- | --- |
| `G0-BCAST-CLASS` | Per-node authority certificates in `corpus.v1.json.queries[*].carrier`; paired worlds; admission refusals |
| `G0-BCAST-SEPARATION` | Host-produced query-shaped broadcast records; `allowDeny`/refusal records |
| `G0-BCAST-SCOPE` | Scope carrier plus full member/presented invocation records in `scopeMismatch` |
| `G0-BCAST-SCOPE-BINDING` | `scopeMismatch` P/Q invocation pair and admission-refusal records |
| `G0-BCAST-AUDIENCE` | `audienceParity` and `allowDeny` frozen invocation/result records |
| `G0-BCAST-INVALIDATION` | `authorityTransition` and `mixedCommit` commit/event/delivery records |
| `G0-BCAST-IDENTITY` | Plan, instance, materialization, partition, authorization-version, and evaluation-cut fields in carriers/cases; Rust reconstruction tests |
| `G0-BCAST-CORPUS` | Seven closed case kinds in `tests/conformance/graph/corpus.v1.json` |
| `G0-BCAST-BOUNDS` | `bound-derivation.v1.json` plus normal/deferred large/hot `g0ExitObservations` |

The machine-readable map is `corpus.v1.json.broadcastInputs`; the
`broadcast_inputs_complete` test exact-matches all nine labels.

## Author ratification record

### Identity and captured-read choices

| Decision | Ratification artifact |
| --- | --- |
| `snapback:graph-plan:v1:` | B1/B2 Rust↔JS plan vectors; B3 host-recomputed Zerobugs carrier hashes |
| `snapback:graph-instance:v1:` | `identity-vectors.v1.json`; B3 paired invocation reconstruction |
| `snapback:graph-materialization:v1:` | contextual wrapper vectors and B3 paired invocation reconstruction |
| `snapback:graph-partition-function:v1:` | B1 one-axis-rotation vectors |
| `snapback:graph-authority-partition:v1:` | B1 authority-partition vectors; B3 partition-of-one invocation records |
| `snapback:graph-broadcast-scope:v1:` | B1 broadcast-scope vectors; B3 scope case records |
| One top-level captured-read arm | `CapturedReadKind::GraphNode`, carrying the closed `GraphCapturedReadV1` union; `dependency_shapes` proves the pairing and B3 adds no consumer |

### Logical headroom and concrete declarations

The author ratifies the value and its factor/method together. Exact
per-field records live in `bound-derivation.v1.json`; this is the compact table.

| Query / logical field | Fixture/oracle maximum | H or discrete rule | Declared value |
| --- | ---: | --- | ---: |
| `issueListV2.maxRootRowsPerPage` | hot request 1,000 | 1.024 portable boundary | 1,024 |
| list/point label `maxChildrenPerParent` | normal max 5; documented large generator max 3 | 3.2 over max 5 | 16 |
| selected-label `maxItems` / expansion | corpus contract max 16 | 1 | 16 |
| `issueListV2.maxResultRows` | one admitted hot page | discrete page boundary | 1,024 |
| `issueListV2.maxResultBytes` / page bytes | normal oracle 517,010 bytes | exact rational `33,554,432 / 517,010` | 33,554,432 |
| detail comment `maxChildrenPerParent` | normal max 21; documented mean-3 seed-42 exponential distribution | `1,024 / 21` (48.761904…); exact CSV max deferred to zb5 | 1,024 |
| `issueDetail.maxResultRows` | point root 1 | 1 | 1 |
| `issueDetail.maxResultBytes` / page bytes | normal oracle 26,549 bytes | exact rational `8,388,608 / 26,549` | 8,388,608 |
| `listIssueByID.maxResultRows` | point root 1 | 1 | 1 |
| `listIssueByID.maxResultBytes` / page bytes | normal oracle 6,806 bytes | exact rational `1,048,576 / 6,806` | 1,048,576 |
| all graphs `maxMaintainedWritesPerMutation` | G0 has no graph writes | exact, no headroom | 0 |

Fixture facts are maxima, not means: normal has 14 users / 516 issues / 924
comments / 30 labels / 603 label edges, with per-parent maxima 21 comments and
5 labels. The freezer recomputes those from the base normal rows after removing
the compiled `policy-extension-v1` rows' stable `zbav1_` source-id namespace.
The large receipt has 100 users / 100 projects / 1,000,000 issues /
2,527,886 comments / 4,810 labels / 2,000,370 label edges. Its means are
context only; the absent per-issue CSV maximum is not fabricated.

### Logical/physical split and physical declarations

Logical declarations are derived from fixture facts and exact opaque-oracle
serialization. Physical declarations are the closed normalized-plan function
and stay marked **[G2 measures]**; G0 records no graph-executor
`StructuralWorkV1` observation and LLP 0267 observed-value consumption begins
at G2.

| Query | `maxScannedRows` | `maxIndexRanges` | `windowRollup` pages / root rows / scanned / result rows / result bytes / ranges |
| --- | ---: | ---: | --- |
| `issueListV2` | 54,273 | 36,865 | 977 / 1,000,448 / 53,024,721 / 1,000,448 / 32,782,680,064 / 36,017,105 |
| `issueDetail` | 1,067 (`43 + 1,024`) | 26 | 22 / 1 / 22,592 / 22 / 184,549,376 / 47 |
| `listIssueByID` | 54 | 37 | 1 / 1 / 54 / 1 / 1,048,576 / 37 |

Every node's examined-entry, relationship, child, argument, and lineage value
plus derivation is in `bound-derivation.v1.json.queries.*.derivationTable` and
is exact-matched to the declarations by `bounds_are_fixture_derived`.

## Oracle dispositions and digests

- `issueListV2`: the fixed-order non-search list shape admits. The full search
  shape refuses `SNAPBACK_GRAPH_SEARCH_UNADMITTED` pending D6/OQ-4.
- `issueDetail`: the fixed-id structural graph admits. The exact oracle rows
  require a result-bearing through edge ordered by target `label.name`; v1 has
  no such node and the full shape refuses `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED`.
- `listIssueByID`: the fixed-id structural graph admits; the same exact
  label-name-ordered through shape refuses
  `SNAPBACK_GRAPH_NODE_KIND_UNSUPPORTED`.

Normal oracle digests:

| Query | Exact bytes | SHA-256 |
| --- | ---: | --- |
| `issueListV2` | 517,010 | `sha256:ebbb09fcf00829c123668cb17f6ef4b85c463140a72aa284796bf9ef27920d57` |
| `issueDetail` | 26,549 | `sha256:7bb0b07afc67af3b26612714f3a60a7127129efc58941a242331c643f81671ee` |
| `listIssueByID` | 6,806 | `sha256:6e4f672f309fb6d8d8c98e8317a6aee3908c08dc1d0ce8471b9a23766abe910f` |

The whole-corpus content digest is
`sha256:baf1636b6c0ead8956176a8510830c98f24b768000e3b02a326ab48cd12819f9`;
the bound-derivation content digest is
`sha256:62da3f6e7f1521d8755fac0c37af1c70b0927fe8d517ffbc97b562a2ba10d98a`.
Both are host-recomputed by `graph_corpus_v1`; per-case raw and mapped-target
digests remain in `corpus.v1.json.oracleCases`.

The backward tied case carries only
`oracleDivergence: "direction-tie-break"`: it exact-compares the row set,
resolves `sourceIssueID` to physical `issue._id` through `issueListRead`, and
sorts only equal-`modified` groups by ascending physical id. Follow-up owner
ticket: `issues/20260823-zerobugs-control-descending-tiebreak-deviation.md`.

## Drift-list state

- LLP 0267 `maxIndexRanges = 512` remains incompatible with the admitted list
  shape's analytical 36,865 consultations; owner amendment still required.
- LLP 0267 singular stable-window wording still needs one ledger per
  demand-paged node.
- LLP 0267 summed-window wording still needs six fields per lineage plus the
  checked graph rollup.
- LLP 0267 G0 observation wording still needs the ruled logical-declaration /
  analytical-physical split and G2 start for observed physical values.
- LLP 0267/0268 still need owner-declared hard retained group-state/frame/
  handoff bounds; this G0 carrier records observations, not those hard bounds.
- LLP 0268's pre-LLP-0276 metadata paths remain stale and owner-scoped.
- The Zerobugs descending tie-break deviation is now tracked by the B3 ticket
  above; it remains owned by the control, not G0.
- B3's two JS/Rust carrier-admission parity gaps are tracked in
  `issues/20260823-graph-codegen-rust-admission-parity-gaps.md`.
- The zero-parent demand-child vector gap is tracked in
  `issues/20260823-graph-empty-child-demand-window-vector.md`; B3 does not mint
  a fictitious interval to avoid it.

## Spec gaps found while implementing B3

1. V1 has a through edge only inside `exists-semi-join`. It cannot return
   through-target rows ordered by a target field, so all three exact oracle
   label arrays (ordered by `label.name`) require an explicit refusal. The Spec
   anticipated row-shape refusals but did not name this concrete node gap.
2. The codegen result-contract ceiling is 1,024 array items. That makes the
   oracle's 1,024-comment collection ceiling the largest admissible detail
   declaration and prevents using the receipt's total comments as a
   per-parent fallback. The absent deterministic seed-42 CSV maximum therefore
   remains a required zb5 exact check.
3. `GraphG0ExitObservationV1` has no deferred/unavailable arm, while the B3
   commission explicitly permits the large fixture spot check to defer when
   the local fixture is absent. The corpus preserves normal exact observations
   and marks large/hot cells with `pending: "zb5-gate-rerun"`; the owner note
   should either ratify that extension or fill the exact rows during the rerun.
4. The exact demand-window vector cannot currently represent an admitted
   demand-paged child with zero evaluated parents: the Rust validator requires
   every node entry's interval list to be non-empty. A missing/invisible root
   makes the correct child interval vector empty. B3 uses the point/list graph
   for hidden-world execution and records the gap in a filesystem ticket.
5. `GraphOracleFieldMapV1` requires every per-node completeness row to name an
   oracle cursor path, but the control exposes no label cursor beside
   `labelsCompleteness`. The list maps name their envelope cursor and the
   detail map names `value.commentsCursor`; every affected translation uses
   `when.cursor: "any"`, so the value cannot alter its disposition. This is a
   type-level closure gap: the owner should add a literal/not-applicable cursor
   discriminator instead of requiring a semantically unrelated dotted path.

## Exit command block

The orchestrator pastes the final verbatim green outputs below after landing
the SHA and, where available, rerunning zb5:

```sh
cargo test -p snapback-types graph_query_v1
volta run --node 24.18.0 node --test packages/snapback-codegen/graph-query.test.mjs
cargo test -p snapback --test graph_corpus_v1
cargo test -p snapback --test relational_corpus_v0
volta run --node 24.18.0 node scripts/check-inventories.mjs
./ref-check --verbose
```
