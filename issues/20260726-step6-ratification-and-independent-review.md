# Step 6 RFC ratification and independent review

**Status:** Open

LLP 0063 Step 6 remains blocked on accepted semantics and executable
hosted witnesses. `STEP6.CHAT`, `STEP6.DOCUMENTS`, and `STEP6.COMMERCE` remain
pending.

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

## Required independent reviews

1. LLP 0068: non-GPT distributed-systems/CRDT review plus adversarial
   re-review.
2. LLP 0069: non-GPT payments/security review, jointly checking LLP 0070/0071.
3. LLP 0070: non-GPT storage/fault-injection review.
4. LLP 0071: non-GPT security and privacy/retention review.
5. LLP 0072: non-GPT deployment/distributed-systems/security review.
6. LLP 0073: non-GPT search/security review.

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
