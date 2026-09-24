# Cal18 modeling follow-up, September 23, 2026

Implementation: Astra max, accepted [modeling plan](../../../llp/3000.011.000.001-modeling-after-clique-030.plan.md).
Base: main `51c50468c`, commissioned integration `b37fb5f12`. These are targeted
checks on disposable stores, not a new Clique benchmark or package publication.

## What was already true

The published 0.3.0 CLI and current source already chose `byId` for a generic or
correctly typed row ID, and `byPost` for a posts-typed prefix into replies.
`replies[id = k]` and `replies[k] by byId` both express point intent and refuse
a posts-typed key. `why` already displayed the operation's result and selected
index/source site. The missing local explanation was the bound key and why
that index won. No language or authorization change was needed.

- [Published paired control](./published-lookup-control.json): copied binary
  SHA256 `2f4d9487faf33e89450f67811ac650093b9633c94a7083738a0004b6a2e79046`.
- [Current-source control](./lookup-control.log.gz): paired IR, return types and
  old site output, engine absence/null cases, wrong-table and ambiguity cases.
- [Initial fixture correction](./lookup-control-fixture-error.log.gz): `lookup.q`
  namespaced operations; a test assumed bare names and unwrapped `None`.
  Corrected fixture filename to `schema.q`; this was not a product defect.
- [First candidate](./modeling-round1.log.gz): 4 guidance, 53 guide, 3 lookup pass.
- [Recipe trial](./recipes-round1.log.gz): 2 attribution pass; 54 guide pass,
  1 fixture failure comparing whole replay outcomes. A successful repeated
  write has the same committed sequence but need not repeat the result row.
  The assertion now checks the sequence and unchanged projections.
- [Second candidate](./modeling-round2.log.gz): 2 attribution, 55 guide,
  4 lookup pass, including reviewed existence/scalar diagnostic edge cases.

Commands used the run-owned Black M5 checkout and private APFS-cloned target,
`CARGO_BUILD_JOBS=4 cargo test -p snapback4-lang --test ... --no-fail-fast -- --nocapture`.
The CLI [development build](./candidate-build.log.gz) succeeded. Root independently
ran the existing docs-budget check: README 300/300 and self-contained first
account screen pass. Broad checks and final commit review belong to the ship
receipt, not this intermediate evidence.

## Scope delivered

Binder-owned reasons accompany existing operation-site facts in `why` and JSON.
No second lookup analyzer or new diagnostic category exists. Tests retain
generic-ID and typed-reference behavior, named/explicit corrections, missing
and nullable targets, ambiguous compatible indexes and generated row/null/page
types. Implicit maintained group selection is labeled as such; explicitly
authored `by` remains distinct. Point and prefix `exists` keep their old lookup
semantics and are described as existence results.

The compiled maintains example and independent contribution oracle cover
originals, replies, deeper replies, likes, absent targets, null captures,
authored backfill and delete/recreate. The recipe chooses immediate-target
credit captured when the source row is created. Deleting a target does not
reattribute surviving contributions, and recreating its ID does not recapture
old values. Existing `doctor` was sufficient; legitimate optional nulls remain
reported as data, not universal warnings. Existing M6 presence-guard guidance
and tests already cover the control dependency; no automatic hoist was added.

The compiled feeds example writes posts/reposts, declared Following and Global
events in one transaction. Tests cover duplicate write identity, fresh-write
repost idempotence, original removal versus independent reposts, and rollback
of all representations if the Global cap refuses. Maintained score serves
display and Trending; removed posts are filtered. Its synced posts deliberately
produce one existing `N_MAINTAINED_COLUMN_STREAM` note. Tests assert the precise
note and impacted table; adjacent prose states the publication/streaming cost.
All-page rolling-rank tests cover tie order, zero scores, 25 lanes, exact window
edges, score changes and deletion against an independent sort/filter oracle.

## Fresh-builder comparison

Two fresh Astra-max sessions received the same small posts/replies lookup task,
same effort and isolated scratch directories without implementation/LLP access.
Exact prompts, attempts, source and output are retained in
[control](./pilot-control/prompt.txt) and [candidate](./pilot-candidate/prompt.txt).
The candidate binary was frozen at SHA256
`829008c674eee56b92563b7b4f918b4b67a1a785cc59b40a0d0ef057570df73b`, before the
subsequent maintained/existence explanation review fixes; those cases were not
part of the pilot. The control used the published 0.3.0 binary, while the
candidate was a development build on 0.3.1 source, so latency is not a matched
release performance comparison.

| Observation | Published control | Candidate |
| --- | ---: | ---: |
| Checks | 1 | 1 |
| Failed checks | 0 | 0 |
| Source correction cycles | 0 | 0 |
| Help invocations | 1 | 1 |
| Guide invocations | 9 | 9 |
| Elapsed wall time | 119 s | 136 s |

Control repeated two guide reads after truncated output; candidate guessed two
nonexistent guide card names. Both explained row/page intent successfully.
Candidate `why` directly displayed `postId = k` and `single exact positional
type match`. The observations show no correction, reading or time reduction.
The task did not measure runtime, attribution authoring, Global composition,
native lifecycle or a holistic release score. Those limits are part of the
result, not missing successful trials.
