# LLP 0069: Payment provider boundary

**Type:** RFC
**Status:** Draft
**Systems:** Payments, Commerce, Actions, Storage, Auth, Secrets, Webhooks, Background work, Audit, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review application: v1 now selects
Stripe test mode at API version `2026-06-24.dahlia`, makes checkout
order-centric with trusted price calculation, pins a minor-unit money type and
canonical provider request, defines reservation/ambiguity and capture/refund
ceilings, separates exact authenticated links from diagnostic candidates,
closes credential/event ordering and client-capability custody, and requires
encrypted raw-event retention plus fail-closed fulfillment. The RFC remains
Draft and still requires independent payments/security review, maintainer
ratification, and executable evidence). 2026-07-20 (initial proposal for LLP
0063's commerce pressure test)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0009, LLP 0011, LLP 0012, LLP 0018, LLP 0028, LLP 0036, LLP 0043, LLP 0047, LLP 0063, LLP 0070, LLP 0071, LLP 0072

## Summary

Snapback should provide a payment-integration boundary, not a payment
processor. Applications own products, carts, inventory, orders, tax inputs,
fulfillment, and refund policy in ordinary Snapback data. A configured provider
owns card or bank credentials, payment-method collection, regulated payment
data, authorization, capture, settlement, and disputes. Snapback coordinates
the two through durable payment attempts, idempotent provider commands, signed
webhook facts, reconciliation, and an auditable projection.

The first claim profile, `commerce-payments-v1`, supports authorize-and-capture,
separate capture, cancel, refund, and webhook reconciliation against Stripe in
test mode at the explicitly sent API version `2026-06-24.dahlia`, plus a
deterministic conformance provider. The version is pinned in the adapter,
request header, webhook endpoint, artifact, and receipt rather than inherited
from an account default. Stripe's official
[versioning contract](https://docs.stripe.com/api/versioning) is the dated
external authority for that selection. It never accepts raw PAN, security
codes, or bank credentials into Snapback handlers, storage, retained clients,
logs, backups, or test receipts.

This RFC does not claim PCI certification, finance-grade accounting, tax
calculation, marketplace payouts, subscriptions, fraud adjudication, or a
provider-independent promise stronger than the capabilities each adapter
reports.

## Boundaries and invariants

The commerce boundary has four authorities:

1. **Snapback transaction authority** owns inventory reservations, order state,
   immutable amount/currency intent, application idempotency, and the decision
   to request a provider operation.
2. **The payment provider** owns the externally settled state and emits opaque
   object ids plus signed events.
3. **The customer-facing provider SDK or hosted page** collects regulated
   payment credentials and returns an opaque payment-method or checkout token.
4. **A total application projection** maps immutable Snapback facts and
   provider facts into renderable order/payment state. It may expose
   disagreement, pending state, and manual-review state; it must not overwrite
   history to make two authorities appear atomic.

The following invariants are load-bearing:

- amounts use `snapback-money-minor-v1`, never binary floating point. Its
  canonical shape is `{currency, exponent, minorUnits}`: a source-declared
  uppercase three-ASCII-letter currency from a committed registry,
  registry-pinned unsigned 8-bit exponent, and nonnegative unsigned 64-bit
  minor units. Each attempt fixes all three at creation; v1 performs no
  currency conversion or rounding;
- an inventory reservation and its first payment intent commit atomically in
  Snapback before any provider call;
- no database transaction remains open during network I/O;
- every provider command has one durable, provider-scoped idempotency key;
- retries use the original key and canonical request digest;
- the same key with different canonical bytes fails closed;
- provider responses and webhooks are immutable observations; later facts append
  or supersede through an explicit relation rather than mutating history;
- a browser redirect or action response alone never proves payment success;
- fulfillment requires the application's admitted authoritative state and may
  additionally require reconciliation, depending on the declared policy; and
- operator repair is explicit, authenticated, reasoned, and auditable.

## Data model

The first generated commerce module owns system-shaped records that applications
may join but cannot forge:

- `PaymentAttempt`: app/database/order identity, operation, exact amount,
  currency, provider profile, provider account generation, canonical request
  digest, idempotency key, application principal, authority instance,
  creation/expiry timestamps, and current projection;
- `PaymentCommand`: attempt, command kind, monotonic sequence, claim lease,
  retry policy, provider request/response hashes, opaque provider object ids,
  and terminal command outcome;
- `PaymentEvent`: provider, account generation, provider event id, verified
  signature metadata, received timestamp, event type, opaque object ids,
  normalized amount/currency facts, encrypted-or-redacted raw-body retention
  class, and processing disposition;
- `ExactPaymentLink`: an authenticated proof binding provider account
  generation, environment, provider object, attempt metadata, adapter binding,
  and exact amount/currency. Only this proof may feed money or fulfillment
  state;
- `DiagnosticPaymentLink`: a many-to-many investigation candidate with reason
  and optional confidence. It may produce only `ambiguous` or `manualReview`;
- `Refund`: exact requested/accepted/settled amount and its own command/event
  identities; and
- `PaymentAuditEntry`: append-only decisions, state transitions, actor,
  request/receipt hashes, and redacted diagnostic codes.

Provider secrets and webhook signing secrets live under LLP 0036. Provider
account ids and non-secret environment/profile names are deployment config.
Secret values never enter these rows.

The application stores order lines and the price facts it used, not merely
foreign keys to mutable product rows. Changing a product after checkout begins
cannot alter an existing attempt's amount.

## Generated application surface

An application declares a provider profile and named commerce operations. The
public/client conceptual surface is:

- `payments.beginCheckout(orderId, paymentChoice)`;
- `payments.prepareClient(attemptId)` returning only provider-safe public
  configuration and an opaque client token or hosted URL;
- `payments.capture(attemptId, amount?)`;
- `payments.cancel(attemptId)`;
- `payments.refund(attemptId, amount, reason)`;
- `payments.status(attemptId)`; and
- `payments.reconcile(attemptId)` for an admin or durable worker.

`beginCheckout` accepts no amount, currency, tax, discount, or inventory
quantity from the client. In one Snapback transaction it reads immutable
server-authoritative order lines and their price versions, evaluates the
versioned pricing policy, validates one currency, reserves inventory, creates
the immutable attempt, and enqueues its first provider command. A separately
named `payments.createTrustedAttempt` exists only for generated host
composition with an explicit server authority; generated reachability proves
that an end-user mutation cannot call it.

Provider calls are actions carrying explicit LLP 0036 `uses` grants. The
action claims the command, calls the provider with the fixed idempotency key,
then records raw response facts through a mutation. No API pretends those
commits form a distributed transaction.

`prepareClient` returns a short-lived attempt-bound capability. Its audience,
provider account generation, environment, amount/currency, allowed operation,
origin/redirect binding when supported, issue/expiry time, and single-use or
reuse posture are retained as typed facts. Responses are private and
`no-store`; the capability is forbidden from SSR/prerender HTML, analytics,
logs, generic diagnostics, retained client storage, backups, and receipts.

The client state distinguishes `notStarted`, `requiresCustomerAction`,
`providerPending`, `authorized`, `capturePending`, `paid`, `failed`,
`cancelled`, `partiallyRefunded`, `refunded`, `disputed`, `ambiguous`, and
`manualReview`. Adapter-specific facts remain available behind a typed,
redacted extension object.

### Inventory reservation lifecycle

The reservation and payment attempt share one immutable identity and trusted
deadline. Reservation state is:

`active → consumed`

with `active → releaseEligible → released` and
`active → ambiguousHold → consumed|releaseEligible|manualReview`.

`consumed` and `released` are terminal. A reservation becomes
`releaseEligible` only when no provider request was admitted, or an exact
authenticated provider fact proves definitive rejection/cancellation with no
capture path remaining. Expiry alone cannot release a reservation after a
request may have reached the provider. A timeout or unknown provider outcome
moves it to `ambiguousHold`; bounded durable reconciliation retains the same
idempotency key and provider object lookup. Exhaustion moves to `manualReview`
without releasing stock.

Release and consumption are idempotent transaction effects keyed by the
attempt. A late exact capture after a valid release is a contract incident and
cannot silently oversell or fulfill; the order enters `manualReview` and the
inventory policy applies an explicit compensating decision. Report, login, and
checkout admission limits prevent anonymous clients from creating unbounded
holds. Fault vectors cover abandonment, definitive rejection, cancellation,
authorization expiry, worker crash, ambiguous provider commit, reconciliation,
and operator disposition at every transaction/network boundary.

## Commands, retries, and ambiguity

The durable-work subsystem proposed separately from this RFC executes payment
commands. A command claim has a bounded lease and at-least-once delivery. Before
calling the provider, the worker derives the idempotency key from the immutable
attempt and command sequence; it never derives a new key on retry.

Outcomes are classified as:

- **definitive response:** record the verified provider object and normalized
  facts;
- **definitive rejection:** append the provider failure without retrying a
  non-retryable code;
- **ambiguous transport failure:** keep the same command pending for provider
  lookup or idempotent retry; do not create another attempt; or
- **contract failure:** quarantine adapter/profile execution when response
  identity, amount, currency, environment, or account generation disagrees.

Retry policy is adapter-declared, bounded, jittered, and observable. Exhaustion
produces `manualReview`; it never guesses failure or success. A provider lookup
by idempotency key or object id is preferred before retry after an ambiguous
result.

The provider request identity is
`snapback-payment-request-canonical-json-v1`: a closed canonical object over
provider/profile/API version, provider account generation, environment,
operation kind and command sequence, `snapback-money-minor-v1`, capture mode,
opaque customer/payment-method reference classes, stable application metadata,
and every provider-affecting option. Keys sort by unsigned UTF-8 bytes; unsigned
integers use minimal decimal; optional omission differs from `null`; strings
reject unpaired surrogates; opaque bytes use unpadded base64url. SHA-256 covers
`snapback-payment-request-v1 || 0x00 || canonicalJson`. Volatile transport
headers, request ids, timestamps not chosen by the command, and provider
responses are excluded. Every retry and lookup recomputes and compares the
stored digest; changed-one-field and cross-language golden vectors must pass.

Capture and refund commands reserve their local monetary ceiling before
provider I/O. The sum of active or accepted capture commands cannot exceed the
attempt's authorized minor units; the sum of active or accepted refunds cannot
exceed settled capture minus already accepted refunds. Ambiguous commands keep
their reservation until exact reconciliation or manual disposition. Adapters
that lack partial capture, cancellation, or partial refund report those
features missing; generated source cannot request them under the base adapter
tuple.

## Webhook ingress

Each deployed provider/profile gets a target-generated webhook route. The route:

1. reads the exact raw bytes under a size and time limit;
2. tries the bounded deployment-selected set of eligible webhook signing-secret
   generations without accepting a caller-selected selector, requires exactly
   one successful verification, and records that generation;
3. verifies signature, timestamp tolerance, environment, and replay identity
   before parsing application-visible fields;
4. transactionally inserts one immutable `PaymentEvent` keyed by provider event
   id and body hash; and
5. enqueues normalization/reconciliation work in that same transaction, then
   returns the provider's required acknowledgement promptly.

Duplicate delivery with identical bytes is success. Reuse of an event id with
different bytes is a security incident and fails closed. Invalid signatures
produce only bounded, redacted diagnostics and never reveal whether an order or
attempt exists.

Webhook arrival order is not state order. The projector uses provider object
identity and a versioned adapter reduction table. For Stripe v1, a fresh
authenticated object lookup with the pinned API version dominates event
snapshots for current object state; event facts remain immutable audit inputs.
Provider object/version facts order when the API guarantees them, then
normalized provider creation time, event id bytes, and receipt sequence provide
a total tie-break. Timestamps alone never authorize a regressive transition.
The adapter table names which exact fact classes establish authorization,
capture, cancellation, refund, dispute, and impossibility. The same fact set in
every delivery permutation must produce byte-identical projection and audit
bytes.

Outbound retries use the attempt's pinned provider-account generation while
that generation remains admitted. Credential rotation retains a bounded
verification overlap for webhook secrets and a provider-specific outbound
compatibility map. Revocation or account migration never substitutes a current
secret silently: the command moves to reconciliation/manual review and must
reattest the provider object's account ownership before execution resumes.

## Projection and fulfillment

The projection is a pure function of immutable attempt, command, response, and
event facts plus a versioned adapter policy. The projection records the policy
version and input frontier that produced it. Reprojection after an adapter
upgrade appends an audit entry and must be deterministic.

Only an `ExactPaymentLink` may contribute a provider fact to `authorized`,
`paid`, `partiallyRefunded`, `refunded`, cancellation, dispute, or fulfillment.
A `DiagnosticPaymentLink`, confidence score, redirect, callback, or operator
note cannot cross that boundary. `paid` requires the declared capture evidence.
`authorized` is not `paid`.
Client completion pages poll or subscribe to the Snapback projection; URL query
parameters and provider-side JavaScript callbacks are hints, never authority.

Fulfillment is another durable command with its own idempotency key and admission
policy. The v1 policy requires a verified capture fact, an exact link, no
amount/currency/account/environment disagreement, and no ambiguous command or
diagnostic-only link. No operator action may mark an ambiguous attempt
fulfillable; a high-risk manual business process may compensate inventory or
refund outside the profile, but the Snapback projection remains
`manualReview`. Refunds never delete or reverse the original capture fact; they
add refund facts and change the projection.

V1 retains the exact authenticated provider response and webhook bytes
encrypted under a payment-event retention key, separate from ordinary
application data and inspection, through the maximum dispute/refund,
reprojection, and webhook-replay horizon. Rows retain body hashes and normalized
facts after cryptographic erasure. Access is a scoped audited operation; raw
bytes are excluded from ordinary logs, diagnostics, exports, backups lacking
the declared encrypted class, and test receipts. Future reprojection is
limited to retained raw bytes or facts captured by the original normalizer; a
later provider lookup appends a new observation rather than rewriting history.

## Authorization, isolation, and audit

Customers may create and read attempts only for orders they can access. They
cannot invoke capture, refund, reconcile, raw-event inspection, or manual repair
unless a generated application policy grants that operation. Provider webhooks
authenticate as provider ingress, not as an end user or admin.

All ids bind app, database, target profile, deployment environment, provider,
and provider-account generation. Test and live modes are distinct target facts;
cross-mode object ids are rejected. A reset changes the stream incarnation and
prevents old client authority or settlements from authorizing new commerce
work, while external provider objects remain visible to the explicit recovery
tool.

The recovery tool creates a successor-stream adoption record rather than
reactivating source-stream commands. It proves app/database/environment/account
ownership, performs a current provider lookup, appends new observations under
the successor stream, links source object ids for audit, and requires explicit
operator activation. Old idempotency, client, and worker authority remains
invalid.

Audit records include who requested an operation, the application decision,
provider/event identities, hashes of canonical redacted request and response
facts, projection transitions, retries, repairs, and credential generation.
They exclude secrets, client tokens, regulated payment data, full provider
payloads from the audit payload itself (the v1 encrypted raw-event store is
referenced only by digest and scoped handle), and free-form error objects that
might contain provider secrets.

Admin inspection and repair use the existing gated operations lane. Repair
requires a current provider lookup, a typed action, a reason, and a dry-run
projection diff. There is no generic "set payment status" operation.

## Capability and adapter conformance

Each adapter reports support for authorize, automatic capture, separate capture,
partial capture, cancel, partial/full refund, asynchronous methods, disputes,
idempotent create, lookup by idempotency key, webhook signatures, event replay,
test clocks, and raw-payload retention. Generated code refuses an application
declaration whose required features the selected target lacks.

The mandatory `commerce-payments-v1` floor is order-centric checkout, automatic
authorize-and-capture, cancellation before capture where the provider permits,
full refund, exact authenticated linking, idempotent create, object lookup,
signed webhooks, encrypted raw-event retention, deterministic projection, and
test mode. Separate capture, partial capture/refund, asynchronous methods,
disputes, replay, and test clocks are capability-conditioned extensions. A
provider is not failed for honestly lacking an extension, and a demo cannot
exercise or claim one its admitted tuple lacks.

The deterministic conformance provider simulates success, rejection, customer
action, timeout before/after provider commit, duplicate response, duplicate and
out-of-order webhook, id reuse with changed bytes, amount/currency mismatch,
late capture, partial refund, dispute, credential rotation, and test/live
confusion. It is evidence for orchestration logic, not a hosted-payment claim.

`commerce-payments-v1` requires the pinned Stripe test-mode adapter and the
conformance provider. Production-money movement is never required in CI.

## Recovery and deployment

Backups include Snapback attempts, commands, events, links, projections, and
audit facts, but not provider secrets. Restore into another target defaults to
read-only commerce mode until an operator proves the environment, provider
account generation, event endpoint, and reconciliation frontier. A restored
worker may not blindly replay every pending command. Before activation, the
successor restore epoch reconciles every nonterminal attempt with a current
provider lookup, revalidates the encrypted-event key generation and webhook
endpoint version, quarantines commands whose pinned credentials/artifacts are
not admitted, and appends successor-stream adoption facts.

Deploy and rollback preserve adapter-policy compatibility. A deployment that
cannot interpret an already admitted command refuses activation. Webhook routes
remain compatible for all provider events whose attempts are nonterminal or
inside the declared dispute/refund retention window.

## Acceptance

The commerce pressure test must retain executable evidence that:

- two clients contend for the final inventory unit; one reservation and one
  immutable payment attempt commit, with no provider call for the loser;
- client-supplied amount/currency fields are unreachable, authoritative order
  price/version facts produce the canonical minor-unit amount, and invalid
  exponent/overflow/rounding inputs fail closed;
- abandonment, definitive rejection, cancellation, reservation expiry,
  ambiguous commit, late success, and operator review follow the exact
  reservation lifecycle without silent stock release or fulfillment;
- a provider commit followed by transport timeout is looked up or retried with
  the same idempotency key and creates one charge/capture;
- duplicate and out-of-order webhooks, action retries, worker restart, and
  deploy/rollback converge to one deterministic projection;
- redirect/query-parameter spoofing cannot produce `paid` or fulfillment;
- signature, event-id/body substitution, amount/currency, account-generation,
  test/live, cross-user, cross-app, and cross-database attacks fail closed;
- the admitted mandatory floor and every declared optional separate-capture,
  partial-refund, or dispute capability preserve immutable history and local
  monetary ceilings;
- credential rotation selects the intended account generation without exposing
  either secret in logs, diagnostics, receipts, database, or backups;
- backup, destroy/replace, restore, read-only reconciliation, and explicit
  worker activation preserve order/payment integrity;
- the real provider sandbox and deterministic conformance provider pass the
  same required adapter suite; and
- the hosted storefront names every unsupported provider feature and never
  claims PCI certification or accounting completeness.

The retained receipt names provider and API version, sandbox/live mode, target
profile, app/database/deployment identities, repository revisions, schema and
artifact hashes, adapter-policy version, exact-money corpus hash, webhook
fixture hashes, and nonclaims.

## Non-goals and claim boundary

Snapback does not store cardholder credentials, promise exactly-once networks,
act as merchant of record, calculate tax, maintain a general ledger, settle
marketplace balances, or adjudicate fraud and disputes. The first profile does
not include recurring subscriptions or usage billing.

While this RFC is Draft, implementations are exploratory and no capability
manifest may report `commerce-payments-v1` as supported. LLP 0063 Step 6
requires maintainer acceptance, the separate durable-work and audit-control
prerequisites, one hosted adapter, and the executable witnesses above.

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes Stripe test mode with
API version `2026-06-24.dahlia`; one source-declared currency per order using
`snapback-money-minor-v1`; encrypted raw provider bytes through the declared
reprojection/dispute horizon; exact authenticated links as the sole
money-state authority; and no fulfillment while any provider outcome remains
ambiguous. These choices are not accepted merely because they are written
here. Independent payments/security review and maintainer ratification remain
prerequisites before implementation can satisfy LLP 0063.
