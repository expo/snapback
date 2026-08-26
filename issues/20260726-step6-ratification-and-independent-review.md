# Step 6 RFC ratification and independent review

**Status:** Open
**Impact:** 4
**Urgency:** 3
**Ease:** 3
**Confidence:** 4
**Score reviewed:** 2026-07-26
**Score rationale:** The ticket evidence for “Step 6 RFC ratification and independent review” shows the issue materially affects a supported product or engineering path; it belongs in the current program but is not an immediate blocker, while the fix requires a few coordinated implementation and test surfaces, with specific cited code, progress, or acceptance criteria.

LLP 0063 Step 6 remains blocked on accepted semantics and executable
hosted witnesses. `STEP6.CHAT`, `STEP6.DOCUMENTS`, and `STEP6.COMMERCE` remain
pending.


## Triage (2026-08-26 leftover sweep)

Still open. LLP 0073 is Implemented; LLP 0100 is Accepted. **LLP 0070 is Review** after dual-family READY artifacts (`llp/reviews/0070-*.{fable,codex}.md`) — remaining work there is author ratification, not another independent loop. LLP 0068/0069/0071/0072 are still Draft with only author-side GPT reviews. STEP6.CHAT / DOCUMENTS / COMMERCE remain pending.

## Context

On 2026-07-26, GPT/Codex author-side critical passes were retained for Draft
LLPs 0068–0073 under `llp/reviews/`. Every artifact says explicitly that it is
not independent. LLP 0073 applied its findings the same day; LLP 0068–0072 now
apply their findings as proposed v1 choices while retaining Draft status.

This ticket prevents the author-side reconciliation from being mistaken for
the LLP 0005 independent review/ratification boundary.

## Proposed decision packet

- LLP 0068: canonical Snapback operation model with generated editor adapters;
  document-wide v1 authorization; operation-scoped atom ids; lease-bounded
  offline admission; deterministic winning placements/cycle breaking; Exact
  Native iOS and Android reducer gates.
- LLP 0069: Stripe test mode at API `2026-06-24.dahlia`; order-centric trusted
  pricing; `snapback-money-minor-v1`; encrypted raw-event retention; exact
  authenticated links only; no fulfillment while ambiguous.
- LLP 0070: generated host-plan actions first; immutable job plus append-only
  attempts; successor jobs for replay; external queue admission/pause/restore
  authority; 30-day generic idempotency tombstone floor; independent
  single-process SQLite and Postgres tuples, SQLite first.
- LLP 0071: independently evidenced admission/signals/moderation/audit profiles;
  staged request identity; atomic composed admission; keyed network-prefix
  digests; 7/30/90-day non-financial retention defaults; linear per-scope
  moderation chains; same-operator remote audit/privacy checkpoint floor.
- LLP 0072: Fly Machine plus Tigris first complete adapter; immutable Tigris
  control records whose head is changed in Fly Machine metadata only under the
  provider lease/current-version guard; mandatory artifact signing and remote
  evidence derivation; maintenance-mode backup; restore identity translation;
  proposed fixture downtime ceilings of 5/15/30 minutes for activation,
  backup, and restore verification.
- LLP 0073: portable generated term/position index; Unicode 17.0.0 analyzer;
  authorization-epoch cursors; synchronous chat indexing; the remaining
  scorer, resource, and sensitive-field choices in its Draft still require
  disposition during independent review.
- LLP 0100: total, non-oracular principal-addressed membership removal plus a
  membership-scoped opaque keyset profile. This proposal is narrower than the
  Team Chat product claim and preserves private rosters, transition policy,
  authorization invalidation, owner-only LLP 0065 semantics, and red claims.

## Required independent reviews

1. LLP 0068: non-GPT distributed-systems/CRDT review plus adversarial
   re-review.
2. LLP 0069: non-GPT payments/security review, jointly checking LLP 0070/0071.
3. LLP 0070: non-GPT storage/fault-injection review.
4. LLP 0071: non-GPT security and privacy/retention review.
5. LLP 0072: non-GPT deployment/distributed-systems/security review.
6. LLP 0073: non-GPT search/security review.
7. LLP 0100: non-GPT authorization/privacy and query/cursor review, including
   adversarial concurrency and revocation schedules.

Reviews must be actually received and retained with provider/runtime,
date, method, source revision, and redaction provenance. This Codex authoring
session cannot count itself as the independent reviewer.

## Resolution

For each RFC:

1. obtain and retain the independent review;
2. reconcile every critical/major finding in the Draft;
3. run the LLP corpus validator and reference check;
4. record the maintainer's dated ratification of the final proposed choices;
5. change status only in the ratification landing; and
6. keep the associated Step 6 claim red until its target-specific executable
   witness also passes.

The Fly/Tigris control-head proposal has an additional live prerequisite:
prove that Machine metadata mutation is actually fenced by the Machine lease
and `current_version`, that replacement preserves the head, and that no
automation credential can bypass the guard. Failure requires a new
single-writer authority design; a local lock is not an acceptable substitution.

## Progress note (2026-07-30 triage)

LLP 0073 has since completed a full dual-family independent review loop
(llp/reviews/0073-*.{fable,codex,super-refine}.md) with reconciled findings
and moved to Status: Implemented (Revised 2026-07-30), partially discharging
required-review item 6. LLP 0068–0072 still carry only the non-independent
GPT author-side passes; LLP 0100 has one Fable round. Remaining
agent-executable legs: independent cross-family review loops for 0068–0072
and a second-family round for 0100. Final ratification (steps 4–5) stays
author-only.

## Progress note (2026-08-01 ballot)

Charlie's 2026-08-01 ballot discharged two more legs and parked the rest:

- **LLP 0100 — DISCHARGED** (ballot item 2, verbatim "ruling: accept"):
  after the converged dual-family loop (Fable READY round 2, Codex READY
  round 3, zero unresolved concerns), the author issued the explicit
  composed-parent ruling LLP 0100's own §Status names, accepting it ahead
  of LLP 0056. Status: Accepted (dated 2026-08-01 entry). Required-review
  item 7 and Resolution steps 1–5 are satisfied for 0100; step 6 (the
  Step 6 claim stays red until its executable witness passes) still holds.
- **LLP 0110 + LLP 0113 — accepted by author direction** (ballot item 4,
  verbatim "accept 0110+0113"): loop states verified (0110: terminal
  delta-round non-convergence, Fable READY / Codex NOT READY, all MATERIAL
  findings dispositioned and applied; 0113: corrective round dual NOT
  READY, all 28 ledger items dispositioned and applied) — stale-but-clean
  loops the author's direction accepts as grounds. Both flips cover Spec
  text only; every capability/support fact stays false pending executable
  receipts. (Neither doc was in this ticket's original packet; recorded
  here because their acceptance narrows the Step 6 adjacent surface.)
- **LLP 0068–0072 — STAY PARKED as Drafts** per ballot item 4's scope
  (accepting exactly 0110+0113 and nothing else): they still carry only
  the non-independent GPT author-side passes, and their independent
  cross-family review loops (required-review items 1–5) plus the
  Fly/Tigris live lease-fencing prerequisite remain the open remainder of
  this ticket.

Remaining after this ballot: independent loops + ratification for
0068–0072 (and their executable Step 6 witnesses; `STEP6.CHAT`,
`STEP6.DOCUMENTS`, `STEP6.COMMERCE` stay pending).
