# LLP 0130: Program standing decisions and delegation boundaries

**Type:** Decision
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Packaging, Search, Relational queries, Scheduled work, Client integration, Sync, Testing, Documentation
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-31
**Revised:** 2026-08-13 (dated ER-3 scope extension for the LLP 0252/0253
familiar-profile experiment; all standing decisions remain canonical-surface
law)
**Related:** LLP 0005, LLP 0108, LLP 0113, LLP 0115, LLP 0119, LLP 0120, LLP 0126, LLP 0127, LLP 0129

## Context

The coordinated execution of the parity program (LLP 0115, Accepted),
the local-first program (LLP 0129, Accepted), and the product-breadth
lane (LLP 0074's umbrella) reaches author-adjudication gates mid-flight:
severity policies, evidence-dependent design choices, rerun composition,
and the Review → Accepted transitions of the Specs and designs the
programs commission. Reaching those gates while the author is away
stalls the affected lane.

On 2026-07-31 the author reviewed the full gate menu and pre-adjudicated
it ("this all sounds reasonable to me i think. approve"). The rules
below are therefore the author's own decisions, made in advance as
conditional rules with defaults and escalation boundaries. They do not
transfer any authority to alter evidence boundaries, and LLP 0005's
honesty rules stay in force: an acceptance made under a standing rule is
recorded as such, never presented as a fresh manual adjudication.

## Standing decisions

**SD-1 — CV-6 strictness (fires when 0115's A+E slices land).** Enact
the recorded provisional lean: omitted result contracts become a refusal
behind a per-app strictness toggle, default-on for newly created apps,
default-off for existing apps. If the successor rerun's
severity-causality measurement later contradicts the lean, escalate;
the toggle default is cheap to flip, so acting before the measurement
is accepted as low-regret.

**SD-2 — the aggregate profile (fires when 3a has usage evidence).**
Decided by criteria rather than by choice: if the snapshot-batch
composition (3a) plus the sequence-allocation primitive express the
demonstrated shapes — Relay Board's `boardView` and `boardSummary`,
Split Ledger's ledger derivation — within their ceilings with
acceptance green, then no third profile is authored; 3a plus the
primitive are endorsed as the paved answer and CV-8 piece 3 closes. If
a demonstrated shape remains inexpressible, the contracted-aggregate
profile is authored scoped to the inexpressible shapes, with
exact-or-refuse as the default result-semantics variant per LLP 0120's
§Result semantics. Maintained-exact aggregates are authored only on
measured contention evidence. Evidence landing outside these branches
escalates.

**SD-3 — rerun composition (0115 OQ4; fires before the successor
rerun).** Decided outright: the seven contracts run unchanged for
diary-to-diary comparability; the React-surface measurement already
mandated by 0115 §Sequencing 5 is included; the local-first offline
dimension (LLP 0129 §Measurement) folds into the same rerun; an eighth
contract targeting structured inputs plus one-off scheduling is added
only if moves 1 and 3 have landed by rerun time.

**SD-4 — standing acceptance rule for commissioned documents.** A
document commissioned by the accepted programs (including the CV-4a
Spec, the vector-search Spec, the settlement Spec, and the
stable-promotion design) that converges **dual-family READY with zero
unresolved MATERIAL concerns, within its decided scope, weakening no
evidence boundary** is accepted under the author's standing
authorization. The acceptance is recorded in the document's review
journal citing this rule ("accepted under LLP 0130 SD-4") with the
three conditions explicitly checked. A document failing any condition
escalates. This rule authorizes Review → Accepted only; it never
authorizes Implemented, Superseded, or any status of a document outside
the programs' commissions.

**SD-5 — LLP 0129 phase gates.** Phases advance automatically when
their gates pass (Phase 0's diary-grade offline acceptance; Phase 1's
determinism conformance corpus; the ladder gates of Phases 2a/2b).
Gate failure or scope change escalates; gate success does not.

**SD-6 — scope-migration timing (decision 9's execution).** The
@expo/snapback-* scope migration executes as its own serialized landing
once slices 5-qual and 5-types are complete, and in any case before any
starter publication. No other landing rides the migration commit.

## Escalation reservations

These wake the author regardless of any standing rule:

**ER-1 — option-C admission.** The client-mutator lane's trigger
(LLP 0129 OQ4: the IR rung proves insufficient for browser-side write
expressiveness after measurement) may be *detected* by the program, but
admitting option C is the author's call alone.

**ER-2 — evidence-boundary weakening.** No standing rule can authorize
a change that weakens an evidence boundary (LLP 0115 governing
constraint 1; LLP 0129's inherited constraints). Any proposal that
would do so escalates, whatever its review verdicts.

**ER-3 — the reactive watch-item trigger.** If the successor rerun,
measured through the React surface, still scores the live-query
boundary itself as a loss (LLP 0115 §Watch items), the 1a
pre-registration's acceptance is the author's call, not a standing
acceptance.

## Dated amendment — 2026-08-13: ER-3 1a/1b scope extension

The standing decisions and escalation reservations above continue to govern
the canonical surface. ER-3 still reserves acceptance of the existing **1a**
preregistration to the author. LLP 0252 and LLP 0253 separately authorize a
scoped, measured **1b** familiar-profile family as an Experimental exception,
with one engine, explicit profile admission, component attribution, and a
bounded stop rule. That 1b experiment may run without first accepting 1a; it
does not accept 1a by implication, convert ER-3 into a standing acceptance, or
authorize promotion beyond LLP 0252's recorded disposition process.

## Consequences

The coordinated waves proceed unattended through SD-1 through SD-6;
the author is paged only on the three reservations, on any SD's
evidence landing outside its branches, and on gate failures. Board
rows update in the same commit as the landing that changes them (the
lockstep round-1 lesson). The author may revoke or amend any SD at any
time by dated revision to this document; an SD lapses automatically if
the plan it serves is Superseded or Withdrawn.
