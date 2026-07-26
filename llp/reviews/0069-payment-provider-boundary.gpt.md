**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0069: Payment provider boundary

This is an author-side critical pass over the committed Draft at Snapback
`e87a630907a86494b56f7280ee2da0322ca295de`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as an independent
cross-family review or as payment/security approval.

## Overall assessment

The authority split is sound: Snapback owns order and inventory intent, the
provider owns externally settled facts, hosted/provider UI owns regulated
credential collection, and the application projection must show disagreement
rather than fabricate a distributed transaction. Immutable observations,
stable idempotency keys, signed webhook ingress, ambiguous-outcome handling,
and explicit operator repair are the right foundation.

The Draft is not safe to implement yet. Its conceptual generated API accepts
client-supplied amount and currency, the inventory reservation has no complete
expiry/release state machine, and uncertain `PaymentLink` matches are not
forbidden from affecting money or fulfillment state. Credential-generation
rotation, canonical request bytes, webhook key selection, and projection
ordering also need normative rules rather than adapter discretion.

## Strengths

- `## Boundaries and invariants` explicitly refuses a fictitious distributed
  transaction and distinguishes application intent from provider settlement.
- `## Commands, retries, and ambiguity` keeps one idempotency key across
  ambiguous retries and routes exhaustion to `manualReview`.
- `## Webhook ingress` verifies exact raw bytes before application parsing,
  handles duplicate delivery, and treats event-id/body substitution as a
  security incident.
- `## Projection and fulfillment` correctly separates authorization from
  capture and rejects browser redirects/callbacks as payment authority.
- `## Authorization, isolation, and audit` binds environment and provider
  account generation, excludes secret-bearing error objects, and provides no
  generic status override.
- `## Recovery and deployment` defaults restored commerce state to read-only
  rather than blindly replaying commands.

## Concerns

### Critical — the generated attempt API trusts caller-supplied price facts

`payments.createAttempt(orderId, amount, currency, captureMode)` appears in the
generated application surface, while the RFC says customers may create
attempts for orders they can access. A customer who can select `amount` or
`currency` can attempt to pay less than the authoritative order total.
Persisting that forged value immutably does not make it trusted.

The public/client mutation must accept only an order/cart identity and an
allowed payment/capture choice. Inside the same Snapback transaction it must:

1. read immutable server-authoritative order lines, price/version facts,
   discounts, tax/shipping inputs if in profile, and inventory;
2. compute the exact payable amount and currency under a versioned pricing
   policy;
3. create the reservation and local payment attempt; and
4. return only the resulting attempt identity.

If an amount-taking primitive is retained for privileged server composition,
name it separately, make its authority requirement explicit in generated
facts, and prove an untrusted caller cannot reach it.

### Critical — inventory reservations can remain locked indefinitely

The RFC requires reservation plus attempt to commit before provider I/O, but it
does not specify the authoritative expiry/release lifecycle for abandoned
customer action, definitive rejection, command exhaustion, authorization
expiry, cancellation, or a provider that remains ambiguous for days. Releasing
too early can oversell after a late capture; never releasing creates a trivial
inventory-denial attack.

Define:

- reservation states and trusted-time deadlines;
- which provider facts permit release;
- how an ambiguous attempt extends, quarantines, or manually resolves a
  reservation;
- the late-success path after local expiry;
- exactly-once/idempotent release and re-reservation effects; and
- acceptance cases for crash/restart at every boundary.

This state machine depends on accepted durable-work semantics and must be
reviewed with them.

### Critical — uncertain links must never authorize money-state transitions

`PaymentLink` allows many-to-many links with "match confidence and reason."
That is useful for investigation, but the projection section does not forbid a
probabilistic or heuristic link from producing `authorized`, `paid`,
`refunded`, or fulfillment.

Normatively separate:

- an exact authenticated link (provider account generation, environment,
  object id, immutable attempt metadata, amount/currency, and adapter-owned
  binding all agree), which may enter the authoritative projection; and
- a diagnostic candidate link, which can only produce `ambiguous` or
  `manualReview`.

No confidence score or operator convenience heuristic should move money state.

### Major — canonical provider request identity is underspecified

Stable idempotency requires more than a request digest label. Pin a versioned
canonical request envelope covering provider/profile/account generation,
environment, operation kind, amount/currency/exponent, capture mode, customer
and payment-method references, metadata, command sequence, and every
provider-affecting option. Define encoding, field omission/null rules, Unicode
normalization, integer representation, and domain separation.

The worker must compare the stored digest before every retry and lookup.
Provider-generated volatile fields and transport headers must be outside the
canonical input. Cross-language golden bytes and changed-one-field rejection
vectors are required.

### Major — credential generation lifecycle is incomplete

Attempts pin `provider account generation`, but the RFC does not define:

- whether outbound retries use the pinned credential generation or the current
  one;
- how long retired webhook verification secrets remain available;
- how an endpoint selects among eligible signing-secret generations without
  trusting a caller-controlled selector;
- what happens when a pinned outbound secret is revoked; or
- how provider object ownership is re-attested after account migration.

Webhook verification should try a bounded, deployment-selected set of eligible
generations and record the unique successful generation; zero or multiple
matches fail closed. Outbound credential rotation needs a provider-specific
compatibility rule and a manual-review path, not silent substitution.

### Major — provider event ordering is not deterministic enough

The projector may use normalized occurrence time "when trustworthy," provider
sequence "when available," and transition rules. Those phrases leave ordering
to runtime judgment. Provider clocks can tie or move backward, deliveries are
out of order, and many webhooks are snapshots of current object state rather
than state transitions.

Each adapter policy must define a total, versioned reduction:

- event/object version or sequence precedence where the provider guarantees
  one;
- lookup/current-object facts versus event facts;
- deterministic tie breaking;
- impossible/regressive transition handling; and
- which fact classes can establish capture, refund, dispute, and cancellation.

The same fact set in every permutation must yield byte-identical projection
and audit output.

### Major — exact-money representation and currency authority are open

The RFC requires integer/decimal wire types while acknowledging in open
question 4 that the canonical generated type does not exist. Currency exponent
and rounding affect provider bytes, refunds, partial captures, equality, and
the request digest. Acceptance cannot precede a versioned money type and
currency-data authority with rounding/overflow rules and golden vectors.

Prefer an integer minor-unit representation for the first adapter if its
provider API is minor-unit based; bind the currency registry/version and reject
fractional values that are not representable for that currency. Do not let a
provider adapter silently round.

### Major — `prepareClient` returns a sensitive capability without custody rules

An opaque client token or hosted URL may authorize customer actions even
though it is not raw card data. Specify audience, attempt, amount, environment,
expiry, single/reuse posture, origin/redirect binding where supported, and
redaction. It must not enter logs, SSR/prerender output, analytics, retained
client storage, backups, or generic diagnostics. Cached responses must be
private/no-store.

### Major — refund and capture concurrency need local reservation rules

The surface permits capture and refund amounts but does not define atomic local
ceilings under concurrent commands: cumulative captures cannot exceed the
authorized/provider-supported remainder; cumulative accepted refunds cannot
exceed settled capture minus already accepted refunds. The command reservation
must happen transactionally before provider I/O and survive ambiguous results.
Partial capture/cancel provider differences belong in explicit adapter
capabilities and state-machine vectors.

### Moderate — webhook durability and acknowledgement behavior need pinning

The route should acknowledge only after the immutable event and durable work
reference are committed. Storage failure must return the provider-specific
retry response. Duplicate signed bytes should return the same admissible
acknowledgement even if normalization is still pending or previously failed.
Rate/size/time limits, clock-skew authority, replay retention, and overload
behavior need target-profile facts so attackers cannot turn signature
verification into unbounded work.

### Moderate — immutable facts and future reprojection are in tension

The RFC permits retaining only normalized facts plus a body hash, yet promises
deterministic reprojection after adapter-policy upgrades. A newer policy cannot
extract a fact the old normalizer discarded. Either:

- freeze normalized event schemas so all future projection inputs are retained;
- keep encrypted raw payloads under an explicit retention/access policy; or
- state that reprojection is limited to the facts captured by the original
  normalizer and that a provider lookup may append new observations.

### Moderate — reset/recovery identity needs a foreign-object adoption rule

A Snapback stream reset invalidates old commands while external provider
objects continue to exist. The recovery tool needs a typed, audited procedure
that proves app/database/environment/account ownership, imports current
provider facts as new observations, and links them to the successor stream
without making old client authority valid again.

### Moderate — provider capability gaps must be command-specific

A single "same required adapter suite" cannot require unsupported features
from a provider that honestly lacks partial capture, lookup by idempotency key,
test clocks, or event replay. Define a mandatory floor for
`commerce-payments-v1`, then capability-conditioned suites for optional
features. The hosted demo may only exercise and claim the selected admitted
profile.

## Suggestions

1. Split a normative `PaymentAttempt`/command/fact/projection state-machine
   Spec from the adapter RFC. Make the deterministic provider implement that
   Spec before a real adapter.
2. Make the generated client API order-centric:
   `beginCheckout(orderId, paymentChoice)`; compute all money facts in the
   trusted mutation.
3. Treat exact authenticated linking as a typed proof object, not a confidence
   score.
4. Build a crash matrix for every local-commit/provider-call/response-record
   boundary and every webhook insert/enqueue/ack boundary.
5. Require secret-scanning assertions over logs, receipts, database exports,
   backups, browser storage, and generated HTML—not only source review.

## Open questions for the author

1. Which real sandbox provider and API version are authoritative for v1?
   This decision changes idempotency, capture/refund, lookup, event, and
   credential-rotation semantics and must close before acceptance.
2. Is the v1 product intentionally one currency per order/attempt, with no
   currency conversion anywhere in Snapback?
3. What is the admitted late-capture behavior after inventory reservation
   expiry?
4. Does any operator action permit fulfillment while provider state remains
   ambiguous? If so, what separate high-risk authority and receipt govern it?

## Recommended next step

Revise and remain `Draft`. Close the trusted-price API, reservation lifecycle,
exact-link proof, canonical request, money type, credential generation,
projection ordering, and first-provider decisions. Review the resulting
state-machine Spec together with LLP 0070/0071, then obtain independent
payments/security review from a non-GPT family before the author considers
`Accepted`.
