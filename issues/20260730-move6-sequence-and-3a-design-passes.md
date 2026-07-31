# Move 6 first slice: sequence-allocation primitive design + 3a snapshot-batch composition design

**Status:** Open
**Impact:** 3
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Severity:** P2
**Systems:** Relational queries, Application data API, Authoring, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-30
**Related:** LLP 0127, LLP 0115, LLP 0120, LLP 0080, LLP 0110, LLP 0113, LLP 0125
**Marker:** parity-moves, move-6

LLP 0127 move 6 ("Bounded profiles are the unit of everything") names its
first slice as "the sequence-allocation primitive with its mapped semantic
surface, plus the 3a composite design pass," and the closing enumerates
"move 6's sequence-primitive and 3a design passes" as startable today with
no author decision — their shipping order was a separate call, now made
(2026-07-30, 0127 decision 3: the sequence primitive ships first, then
3a; registry LLP 0115 v0.6 open question 8). Both are
design passes: 0115 §Sequencing 2 records that CV-8's piece 3 designs are
"authorable now." Per CV-8 and 0127's "what lands where," the designs land
in LLP 0080/0110's orbit: the aggregate/composite decision in LLP 0080's
frame (its OQ7), multi-parent/composite questions in LLP 0110, and the
sequence primitive as its own small owned design (0120 OQ2 — it should not
wait for the aggregate decision).

Work items. (1) The sequence-allocation primitive design — a named,
transactionally incremented monotonic counter with its semantic surface
mapped per LLP 0120: scope identity and incarnation, allocation-vs-commit
order, gap observability under abort/retry, idempotency interaction,
exhaustion, hot-key behavior (the serialization it introduces is a named
empirical expectation, not a result — 0120 option 5), and allocation
authority. It has two demonstrated demand sites (0120 finding 4 — Relay's
`moveCard` sequence counter is a live instance of 0110's own open question
4) and is also the contention primitive LLP 0125's burst work implicates
(0125 option 5). (2) The 3a snapshot-batch composition design (0120 option
3a) — composition of admitted bounded nodes giving Relay's `boardView` its
single-snapshot multi-child read as a composite of already-proved parts —
specifying per-node auth dedup, coordinated-resume cursors, composite
ceilings and composite identity, and sealing-entirely partial refusal.
Exit: both designs landed as reviewable design text with their semantic
surfaces fully mapped and empirical expectations named as expectations —
no implementation, no maturity or capability claims, and no widening of the
stable surface by inference (0115 CV-8's rule). Context the designs must
respect: on the 0113 route a new profile terminates at experimental until
CV-8 piece 2's stable-promotion design exists (0120 finding 9); per
decision 3 the 0113 qualification route is the default for new profiles,
and that stable-promotion design is written as part of move 6 (beyond
this ticket's two design passes).

Decision boundary. SHIPPING is still not this ticket, but 0127 decision 3
(0120 OQ1/OQ7) is DECIDED (2026-07-30), so the designs' order is no
longer open: the sequence-allocation primitive ships first, then 3a
snapshot-batch, with the contracted-aggregate profile decision deferred
until 3a usage evidence exists. Maturity route: LLP 0113's qualification
route is the default for new profiles — the missing stable-promotion
design is written as part of move 6 — and LLP 0080-style direct-to-stable
is reserved for surfaces with witnessed shipped implementations predating
the rule; move 6's surface stops being bypassable on the default route as
that stable-promotion design lands. The design passes proceed with the
decided shipping order as context. Also
excluded: the aggregate shapes' two required contracts — Split's result
semantics (0120 OQ8) and the noninterference shape for the first
protected-source aggregate (0120 OQ6, without which a protected-source
aggregate is an evidence regression); the anonymous-arm authority gap
(0120 OQ5); and the enforced examined-entry budgets tier (option 2a, LLP
0108's family) — all separate author decisions or separately owned work,
not design passes this ticket performs.
