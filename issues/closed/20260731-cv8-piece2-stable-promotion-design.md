# CV-8 piece 2: author the stable-promotion design LLP 0113 requires

**Status:** Resolved
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Severity:** P2
**Systems:** Relational queries, Application data API, Packaging, Documentation
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-31
**Related:** LLP 0115, LLP 0113, LLP 0080, LLP 0110, LLP 0120, LLP 0127
**Marker:** parity-moves, move-6

LLP 0113's qualification/publication path terminates at experimental
maturity by design: maturity is a static code-owned constant, publication
CAS never touches it, and 0113 states "promotion to stable requires a
later ratified design and evidence." That later ratified design does not
exist. LLP 0115 CV-8 piece 2 owns authoring it; 0127 decision 3
(2026-07-30, registry LLP 0115 open question 8) made it mandatory — the
0113 qualification route is the default for new profiles, with the
missing stable-promotion design "written as part of move 6," and
0080-style direct-to-stable reserved for surfaces with witnessed shipped
implementations predating the rule — and 0115 §Sequencing 2 records it
authorable now. The move 6 ticket
(issues/20260730-move6-sequence-and-3a-design-passes.md) honestly
excludes it as "beyond this ticket's two design passes," which left a
mandatory, startable, gating deliverable with no tracker while the six
move tickets present themselves as the startable workstream set (round-1
lockstep review, Codex material finding 4). This ticket is that tracker;
LLP 0115 CV-8's v0.7 note points here.

Scope. Author the ratified code-and-document maturity-promotion design
LLP 0113 requires: what evidence and review promote a qualified
experimental profile to stable, how the static code-owned maturity
constant changes (a code change with its own evidence bar, never a
publication-time mutation), what the acknowledgment-gate consequences of
promotion are, and how demotion/rollback is recorded. The design lands in
the LLP 0113/0080 orbit (a dated 0113 amendment or a small owned design
beside it — the landing shape is an author call at review time), not in
LLP 0115, which holds only program state (its governing constraint 3).

Gating context. On the default route a new profile terminates at
experimental until this design exists (LLP 0120 finding 9); move 6's
surface stops being bypassable on the default route as the design lands
(the move 6 ticket's decision-boundary text). It does not block the two
move-6 design passes, which proceed in parallel.

Exit. The stable-promotion design exists as reviewable text in the
0113/0080 orbit, specifying the code-and-document maturity change and its
evidence bar; LLP 0115 CV-8 piece 2 can cite it as landed. No maturity is
claimed or promoted by this ticket itself.

## Resolution (2026-07-31)

RESOLVED. The stable-promotion design landed as LLP 0134 ("Capability
maturity promotion to stable", Spec) — the landing-shape author call
resolved as its own owned design beside LLP 0113 in the 0113/0080
orbit, exactly one of the two shapes this ticket allowed. It
specifies the E1–E8 evidence bar, the static code-owned maturity
constant's change mechanics (a code change with its own evidence bar,
digest-bound via the staged-tree manifest, never a publication-time
mutation), the acknowledgment-gate consequences of promotion, and
demotion/rollback records with the objective-trigger fast path as the
Spec's own standing delegation. The dual-family loop converged (Fable
READY round 3, Codex READY round 5, zero unresolved MATERIAL) and the
Spec was ACCEPTED under LLP 0130 SD-4 (commit `60ce07ac`). No
maturity was claimed or promoted by this ticket, per its exit; LLP
0115 CV-8 piece 2 now cites LLP 0134 as landed.
