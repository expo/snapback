# Move 2 first slice: same-file helper sharing, the full option-1a cut

**Status:** Open
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
