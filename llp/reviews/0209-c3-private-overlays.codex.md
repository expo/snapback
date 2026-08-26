# LLP 0209 arc, lane C3 — codex review record (D2 private-overlay matrix)

**Change:** the complete principal-bound private-overlay matrix (landed on main as the series ending `57f99a710`, 2026-08-26; pre-rebase lane SHAs `7f0ba1454..38782b144`)
**Reviewer:** codex gpt-5.6-sol, xhigh, read-only, blind on full rounds
**Orchestrator:** Claude Fable 5 (session 01VKza4iiZ918TtDxobNDvvy), ticket `issues/closed/20260825-llp0209-d2-private-overlay-matrix.md`
**Provenance:** every review below was actually received from the named model; verbatim per round.

## Verdict ledger

| Round | Reviewed | Verdict |
| --- | --- | --- |
| r1 | C3 series | VERDICT: NOT READY (3 MATERIAL) |
| r2 | fix round 1 delta | VERDICT: NOT READY (1 MATERIAL) |
| r3 | fix round 2 delta (targeted) | VERDICT: READY |

## r1

### Findings

- MATERIAL — The cross-principal partition assertion is confounded by class-2 authority. The test compares the ordinary principal with the crew principal, whose class-2 visibility scopes already differ; the corpus even identifies crew/removed as the available same-class-2 pair. Therefore a partition hash that entirely omits the required class-3 partition-of-one input would still differ and pass. This leaves cross-principal memo/result sharing under a broken class-3 key green. [freeze-graph-g0-corpus.mjs:2117](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2117), [freeze-graph-g0-corpus.mjs:223](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:223), [freeze-graph-g0-corpus.mjs:2302](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/demos/zerobugs/control/scripts/freeze-graph-g0-corpus.mjs:2302)

- MATERIAL — The “other-principal authority-instance rotation” never reaches the authority-transition mechanism. `identityBinding` does not declare `authorityInstanceID`, and the principal-bound node consults only `principal → userID`; the test injects that extra field and patches it through an ordinary mutation. LLP 0209 explicitly forbids relabelling authority-instance transitions as data writes. Consequently a real principal-B logout/session/authority rotation that incorrectly wakes or fences principal A remains untested and green. [schema.mjs:79](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/zerobugs/schema.mjs:79), [private-overlay-queries.mjs:32](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/zerobugs/private-overlay-queries.mjs:32), [graph_corpus_v1.rs:2047](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:2047), [graph_corpus_v1.rs:10203](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10203), [LLP 0209:1863](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/llp/0209-live-graph-profile.spec.md:1863)

- MATERIAL — The active-transition “zero stale deliveries” assertion examines only `authorization_invalidation` snapshot frames. All other emitted kinds are filtered out before stale counting, and total frame kinds/count are never closed. An extra stale predecessor `live_replace` could therefore coexist with the correct fence and generation-1 restoration and pass. The test also does not arrange an in-flight predecessor data evaluation to exercise LLP 0200’s delivery-time gate. [graph_corpus_v1.rs:10489](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10489), [graph_corpus_v1.rs:10507](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10507), [graph_corpus_v1.rs:10520](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10520), [LLP 0200:207](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/llp/0200-live-evaluation-scheduling-and-settlement.spec.md:207)

- MINOR — The served own-update cases use a modified carrier: `maxWindowPages` is raised to two and the plan identity recomputed. The proof comparison then normalizes away materialization and partition hashes. The test does prove a real commit, wake, one replacement, exact successor bytes, and partition stability, but it does not prove the frozen carrier’s exact successor identity/proof tuple as claimed. [graph_corpus_v1.rs:10266](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10266), [graph_corpus_v1.rs:10351](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10351), [graph_corpus_v1.rs:6543](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:6543)

- REFUTED-RISK — The 16 data arms themselves are present and unique. Other-principal writes require graph-level and target-node `SKIP`, zero deliveries, and an unchanged served observation, so a normal over-broad matcher wake fails even when bytes remain correct. [private-overlay-matrix.v1.json:14837](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/private-overlay-matrix.v1.json:14837), [graph_corpus_v1.rs:10163](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10163), [graph_corpus_v1.rs:10195](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10195)

- REFUTED-RISK — Notification state is genuinely exercised. It has its own `issueNotifications` principal-bound node and `subscribed` projection; its served update commits through the notification mutation and exact-checks the `true → false` successor bytes. Its absent and cross-principal cases therefore catch notification-table, field, and capture-specific defects. Only the own-positive row is redundant with the viewState positive world. [private-overlay-queries.mjs:131](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/zerobugs/private-overlay-queries.mjs:131), [graph_corpus_v1.rs:10323](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10323)

- REFUTED-RISK — Bounds are arithmetically consistent: list is `2+1+2+2 = 7` examined and `1+1+2+2 = 6` consultations; detail is `2+2+2 = 6` and `1+2+2 = 5`. Rollups match, maintained writes remain zero, and codegen classifies both graphs query-shaped. Existing frozen and sealed artifacts are absent from the diff; the new artifact’s independently recomputed digest matches its recorded digest. [private-overlay-queries.mjs:74](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/zerobugs/private-overlay-queries.mjs:74), [private-overlay-queries.mjs:163](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/zerobugs/private-overlay-queries.mjs:163), [private-overlay-matrix.v1.json:14854](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/tests/conformance/graph/private-overlay-matrix.v1.json:14854)

(j) The least-constrained arm is the other-principal authority-transition portion: it is only an ordinary write to an unconsumed fixture field. A real principal-B authority rotation that unnecessarily wakes/fences principal A stays green. Independently, omitting class 3 from partition identity also stays green because the chosen principals differ in class 2.

(k) Yes. The notification update, absence, projection, and matcher paths exercise notification-specific table and boolean-field behavior; they are not merely renamed viewState fixtures.

The canonical freezer could not be rerun in this read-only sandbox because it requires `mkdtemp`; `git diff --check` passed and the new artifact digest was independently recomputed successfully.

VERDICT: NOT READY (3 MATERIAL)
## r2 — fix round 1 delta

One material finding remains.

1. MATERIAL — F1 does not traverse the §2.4 authority-transition channel. The helpers create genuine resolver-produced session authorities, but B is switched by setting `supersedes` and performing another ordinary subscription ([rotation test](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10646), [helper](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:13983)). Generic supersession preserves the predecessor until the successor snapshot succeeds, then removes it; it does not apply an authority fence ([supersession path](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:23300), [retirement](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:23710)). Most decisively, the test asserts the global `fences_applied` counter is unchanged ([assertion](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10707), [global counter definition](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:1591)). Thus B itself receives no fence or delivery-time gate, contrary to LLP 0209’s requirement that authority-instance transitions use §2.4 fencing before restoration ([contract](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/llp/0209-live-graph-profile.spec.md:1863), [real fence machinery](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:33267)).

Closure audit:

- F2: closed. B’s engine observations have byte-equal class 2 and equal complete preimages after removing class 3, while class 3 and engine-issued partition hashes differ ([assertions](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10661)). The serving engine constructs class 3 from resolved authority and issues the partition identity itself ([engine construction](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback-engine/src/local/engine.rs:42182)); no normalization masks the comparison.
- F3: closed. The test pins a predecessor evaluation, applies the actual coalescer fence, releases it, and observes one delivery-gate discard ([gate test](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10871)). Its census is closed over every collected frame: exactly two `authorization_invalidation` frames, subsequently partitioned into exactly one fence and one successor snapshot with ordering checked ([census](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10929)).
- F4: closed. UPDATE, DELETE, and INSERT are real sequential commits from present B rows; each preserves the evaluation counter, emits zero deliveries, and leaves A’s observation unchanged ([served coverage](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10214)). Rust consumes every frozen `deltaEligibility` disposition ([assertion](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:9974)), while own updates still produce `live_replace` with exact row bytes and explicitly normalized proof comparisons ([own-update evidence](/Users/ccheever/projects/snapback-worktrees/sbs-0209-g3/c3-overlays/crates/snapback/tests/graph_corpus_v1.rs:10393)).

Read-only `ref-check`, `git diff --check`, and structural JSON checks passed. I did not chase the known compile failure; the freezer additionally requires temporary-file writes unavailable in this read-only sandbox.

VERDICT: NOT READY (1 MATERIAL)
## r3 — fix round 2 delta

No MATERIAL findings.

The delta:

- Routes B through the real §2.4 fence/restoration machinery.
- Retains B’s subscription and resets its predecessor window-ledger lineage.
- Closes B’s per-subscription fence/wake/delivery and frame-order assertions.
- Proves A’s fence/wake/delivery/frame/byte isolation and unchanged observation.
- Preserves prior F2/F3/F4 closures; generated churn is diagnostic line drift.
- Passes the targeted amended test. Four private-overlay tests passed; one additional test was blocked only by the read-only sandbox denying temporary SQLite creation.

VERDICT: READY