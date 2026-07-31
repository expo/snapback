# Move 2 first slice: same-file helper sharing, the full option-1a cut

**Status:** Resolved (2026-07-31)
**Impact:** 3
**Urgency:** 2
**Ease:** 2
**Confidence:** 3
**Severity:** P2
**Systems:** Authoring, Code generation, Runtime, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0127, LLP 0115, LLP 0118, LLP 0108, LLP 0035
**Marker:** parity-moves, move-2

LLP 0127 move 2 ("The closed graph grows; custody does not shrink") stages
helper reuse by what the evidence demands: both motivating duplication
instances are same-file (LLP 0118 finding 10), so the first mechanism is the
same-file lexical slice (0118 option 1a). The RFC's closing enumerated as
startable today only "move 2's capability-free-only cut" — this ticket as
first drafted — because the slice as 0127 specifies it admits
context-reader helpers and therefore waited on the helper-class cutline
(0127 open question 6). That decision is now MADE (2026-07-30, 0127
decision 6; registry LLP 0115 v0.6 open question 8): context-reader
helpers ARE admitted in the first mechanism, and declared reads/writes
REMAIN evidence (basis: 'declared'), not enforced ceilings — ceiling
enforcement is sequenced as its own later decision, decoupled from this
slice. This ticket's scope therefore widens from the capability-free-only
cut to the full 0118 option 1a same-file slice, covering both diary
instances. Owner:
the LLP 0108 follow-on (0118 option 1a; 0127 "what lands where"), with the
decision order 0118 established — graph scope first (same-file), then
emission (splice) — and the follow-on absorbing the warm-pool-era text still
phrased in retired DK-4 terms. This is also prerequisite ground for move 3:
local re-execution needs source/plan identity over exactly this closed,
content-addressed graph.

Work items. (1) Same-file sharing of top-level helpers in the authored
functions file — capability-free helpers and, per decision 6,
context-reader helpers (Relay Board's indexed-read shape, not just Streak
Lab's calendar helper) — statically validated under the existing
self-containment rules, with each helper's declared reads/writes recorded
as evidence (basis: 'declared'), never enforced as ceilings.
(2) Resolve-and-splice emission into each
operation's runtime module — splice dominates the superseded group-bundle
under the shipped fresh-per-invocation lifecycle on both identity and runtime
axes (0118 finding 7); duplicated helper storage lands in generated
artifacts, the tier where LLP 0115 constraint 4 tolerates volume. (3) The v2
implementation hash: a list of named helper-content hashes — no paths, no
graph encoding — with exact per-operation invalidation. (4) The 2026-07-28
adversarial fixtures (alias/destructuring/computed-access refusals) re-proved
extended cross-helper at file scope. (5) The respecified benchmark:
per-invocation evaluation latency and memory against LLP 0035's ~3.9 ms
fresh-invocation baseline (0118 OQ1). Invariants unchanged (0115 CV-7):
closed content-addressed graph, no `Function.prototype.toString()` capture,
no runtime inference, no ambient checkout access. Exit for this ticket: the
full option-1a mechanism (context-readers included) landed with the v2
hash, adversarial re-proof at file scope, and benchmark receipts — moving
toward, not claiming, CV-7's exit ("Streak Lab's calendar helper written
once and used by both its query
and mutation, with the module graph still closed and content-addressed, and
the 0108 refusal properties preserved under its adversarial fixtures
extended to cross-module cases").

Progress (2026-07-31, wave-1 code lane C1). The full option-1a slice is
implemented on the wave1 worktree branch, pending landing. What landed
there: (1) same-file sharing of statically reachable top-level sibling
function declarations for inline handlers — lazy admission (helpers used
only at definition time stay untouched), symbol-resolved before the
globals allowlist so authored lexical scope wins, context-reader helpers
admitted per 0127 decision 6 with declared reads/writes remaining
evidence (`packages/snapback-codegen/inline-handlers.mjs`); (2) splice
emission — each operation's runtime module carries exactly its own
reachable-helper subset as hoisted function declarations after the v1
registration line, sorted-name deterministic, zero-helper emission
byte-identical to v1 (`renderInlineOperationModule`); (3) the v2
implementation-identity format (`snapback.function-implementation.v2`)
whose inline handler carries named helper-content edges
({name, contentHash} over the export-stripped canonical helper AST, no
paths, no graph encoding) with exact per-operation invalidation; v1
hashes unchanged for all helper-free operations; (4) the 2026-07-28
adversarial refusals re-proved cross-helper (11 fixtures:
alias/computed/destructured/assignment-destructured constructor,
prototype reflection, argument laundering, eval, dynamic import, class,
ambient this — all refusing at the helper with
`SNAPBACK_INLINE_HELPER_SYNTAX_FORBIDDEN`), plus the top-level-const
laundering channel held closed; (5) capability rescan over the complete
spliced bytes with refusals mapped to the helper's authored source span;
(6) precise inadmissibility diagnostics: `SNAPBACK_INLINE_HELPER_CYCLE`
(mutual recursion; self-recursion stays admitted),
`SNAPBACK_INLINE_HELPER_FREE_IDENTIFIER` (TDZ/laundering hints naming
the top-level const/let/var/class/import kind),
`SNAPBACK_INLINE_HELPER_INADMISSIBLE` (duplicate/bodyless declarations).
Both diary shapes are proven de-duplicated in
`packages/snapback-codegen/inline-helper-sharing.test.mjs` (Streak Lab's
civilFromDay/dayNumber written once, used by query + mutation; Relay
Board's boardCards context-reader shared by boardView/boardSummary/
watchBoard). Still open on this ticket: work item (5), the respecified
benchmark receipts (per-invocation evaluation latency/memory against
LLP 0035's ~3.9 ms baseline), and absorbing the mechanism into LLP
0108's normative text at landing time. Landing closes this ticket.

Decision boundary. This ticket is the start of move 2, NOT CV-7's exit.
0127 decision 6 is DECIDED (2026-07-30): the context-reader-admitting
slice — which both diary instances need (0118 places that need inside the
first slice: Relay Board's indexed-read helpers are not capability-free,
and the capability-free cut covers only the Streak Lab instance, which the
pinned stdlib independently dissolves) — is IN scope per the paragraphs
above, resolving the cutline half of 0118 OQ7. The enforcement-posture
half is also decided: declared reads/writes remain evidence (basis:
'declared'), not enforced ceilings, and ceiling enforcement is explicitly
OUT of scope here, sequenced as its own later decision, decoupled from the
helper slice. Also excluded: multi-file bounded imports (option 1 proper;
gated on measured pressure, 0118 OQ6), hermetic package closures (proposed
deferred, 0118 OQ8), and the independently landable complements (pinned
civil-date/money stdlib, exact-duplicate drift diagnostic), which are not
gated by any decision but are not this ticket's scope.

## 2026-07-31 — LANDED on main; ticket narrows to the benchmark

Lane C1 landed at `4d72c407`: the full option-1a same-file slice as
the Progress section describes (context-readers admitted, splice
emission, v2 named-helper-content hash, 11 cross-helper adversarial
fixtures, spliced-bytes capability rescan, both diary shapes proven
de-duplicated in `inline-helper-sharing.test.mjs`). The design frame
also hardened upstream: LLP 0131 (Accepted 2026-07-31 under SD-4)
pins the v2 implementation-hash recompute obligation and the
generation-time registry conformance gate this mechanism now sits
under. Still open here, unchanged: work item (5), the respecified
benchmark receipts (per-invocation evaluation latency/memory against
LLP 0035's ~3.9 ms fresh-invocation baseline, 0118 OQ1), and
absorbing the mechanism into LLP 0108's normative text. This ticket
closes when those two land.

## 2026-07-31 — Work item (5): benchmark receipts; 0108 absorption

Method. The respecified benchmark landed as the `helper_splice` section
of the LLP 0035 harness (`src/bench.rs`, printed by the `snapback-bench`
bin, asserted at smoke scale inside `m1_bench_smoke`), using the
baseline's own method: in-process `LocalSnapback`, the real Hermes VM
through the embedded bridge, `Instant` timing, four warm-up invocations,
and pooling disabled inside the measurement so `vm_cost_us`'s
fresh-per-invocation definition holds. Three per-operation runtime
modules are registered in the exact splice-emitted byte shape — the
three-helper module was verified byte-identical to
`renderInlineOperationModule` output for equivalent authored source —
all computing the same civil-date record (the Streak Lab shape):
(a) `helperFree`, logic inline, zero-helper v1 emission;
(b) `helperOne`, the same logic through one spliced helper;
(c) `helperThree`, a three-helper chain (helper-calls-helper). 400
individually clocked fresh invocations per variant per run give
p50/p95/mean; a cross-variant equality gate refuses if the three
factorings disagree on the computed date, so an error path cannot be
mistaken for speed. Memory: resident set (`ps -o rss`, the LLP 0035
idle-cost probe) sampled around each timed loop, plus module byte
counts — the artifact-tier duplication cost.

Numbers (two full-scale release runs, `snapback-bench --json`,
iterations=400, one Apple Silicon dev machine, Darwin 25.5.0,
2026-07-31; order-of-magnitude honesty per LLP 0035 §Method):

| Variant (module bytes) | run 1 p50/p95/mean µs | run 2 p50/p95/mean µs |
| --- | --- | --- |
| helper-free (653 B)    | 7 155 / 7 447 / 7 173 | 7 457 / 8 170 / 7 565 |
| one helper (692 B)     | 7 193 / 7 596 / 7 241 | 7 690 / 8 701 / 7 830 |
| three helpers (942 B)  | 7 316 / 7 777 / 7 355 | 7 662 / 8 238 / 7 661 |

RSS delta across each 400-invocation loop: 16–32 KiB in every cell
(page granularity — no per-invocation retention; each invocation drops
its VM). Same-run fresh baseline (`vm_cost_us`, LLP 0035's metric):
10 010 µs run 1, 7 468 µs run 2. Machine caveat: today's fresh
invocation on this machine/build sits at ~7.2–10 ms, not the ~3.9 ms of
LLP 0035's dated 2026-07-01/02 tables — the runtime has grown since
(protected-profile machinery among it) and absolute digits are
machine-dependent; the OQ1 quantity is the within-run delta between
variants, which is robust to that.

Reading. Splice duplication costs nothing material per invocation. One
spliced helper adds +38 µs p50 (run 1) / +233 µs (run 2) over the
identical inline factoring — 0.5–3.1% of the fresh-invocation floor —
and the three-helper chain lands inside that band (run 2 ranks it
*faster* than one helper), so the deltas are at or below run-to-run
noise: exactly what LLP 0118 finding 7 projected for evaluation bounded
by the operation's own closure. The real duplication cost is generated-
artifact bytes (+39 B and +289 B per consuming operation here), the
tier LLP 0115 constraint 4 tolerates. `m1_bench_smoke` pins the
property in CI (5× relative bound on spliced-vs-free p50, module-size
monotonicity, cross-variant equality gate).

Absorption. LLP 0108 now carries the landed mechanism as normative text
(§Same-file helper sharing — 2026-07-31): same-file lexical graph
scope, admission rules with the four helper refusal codes,
resolve-and-splice emission, the v2 named-helper-content identity, and
the exclusion boundary. The superseded warm-pool-era phrasing is
marked, never deleted: §Bounded static bundling carries a
superseded-blueprint banner, §A's sibling-helper exclusion carries the
dated narrowing note, and the Diary 0039 "requires the group-bundle
model" consequence carries a dated correction. LLP 0118 OQ1 carries the
dated answer with these numbers.

## Resolution (2026-07-31)

All work items are closed. (1)–(4) landed at `4d72c407` (the full
same-file option-1a slice: context-readers admitted, splice emission,
v2 named-helper-content hash, cross-helper adversarial re-proof,
spliced-bytes capability rescan). (5) landed with this entry: the
respecified benchmark ran twice on the real fresh-per-invocation
runtime path against LLP 0035's baseline metric, receipts above, and
the `helper_splice` harness section keeps the property measured and
CI-pinned. The LLP 0108 absorption the landing owed is done and LLP
0118 OQ1 is answered with data. Per this ticket's own closing text
("This ticket closes when those two land"): Resolved. Ready to move to
`issues/closed/`.
