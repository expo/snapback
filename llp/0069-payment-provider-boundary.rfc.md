# LLP 0069: Payment provider boundary

**Type:** RFC
**Status:** Draft
**Systems:** Payments, Commerce, Actions, Storage, Auth, Secrets, Webhooks, Background work, Audit, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-20 (initial proposal for LLP 0063's commerce pressure test)
**Related:** LLP 0000, LLP 0004, LLP 0007, LLP 0009, LLP 0011, LLP 0012, LLP 0018, LLP 0028, LLP 0036, LLP 0043, LLP 0047, LLP 0063

## Summary

Snapback should provide a payment-integration boundary, not a payment
processor. Applications own products, carts, inventory, orders, tax inputs,
fulfillment, and refund policy in ordinary Snapback data. A configured provider
owns card or bank credentials, payment-method collection, regulated payment
data, authorization, capture, settlement, and disputes. Snapback coordinates
the two through durable payment attempts, idempotent provider commands, signed
webhook facts, reconciliation, and an auditable projection.

The first claim profile, `commerce-payments-v1`, supports authorize-and-capture,
separate capture, cancel, refund, and webhook reconciliation against one real
hosted provider plus a deterministic conformance provider. It never accepts raw
PAN, security codes, or bank credentials into Snapback handlers, storage,
retained clients, logs, backups, or test receipts.

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

- amounts use Snapback exact integer/decimal wire types, never binary floating
  point; each attempt fixes amount, currency, and exponent at creation;
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
- `PaymentLink`: many-to-many links between attempts, commands, and events with
  match confidence and reason;
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
conceptual generated surface is:

- `payments.createAttempt(orderId, amount, currency, captureMode)`;
- `payments.prepareClient(attemptId)` returning only provider-safe public
  configuration and an opaque client token or hosted URL;
- `payments.capture(attemptId, amount?)`;
- `payments.cancel(attemptId)`;
- `payments.refund(attemptId, amount, reason)`;
- `payments.status(attemptId)`; and
- `payments.reconcile(attemptId)` for an admin or durable worker.

`createAttempt` is a mutation and can share one Snapback transaction with
inventory reservation and order creation. Provider calls are actions carrying
explicit LLP 0036 `uses` grants. The mutation enqueues a durable command; the
action claims it, calls the provider with the fixed idempotency key, then
records raw response facts through a mutation. No API pretends those commits
form a distributed transaction.

The client state distinguishes `notStarted`, `requiresCustomerAction`,
`providerPending`, `authorized`, `capturePending`, `paid`, `failed`,
`cancelled`, `partiallyRefunded`, `refunded`, `disputed`, `ambiguous`, and
`manualReview`. Adapter-specific facts remain available behind a typed,
redacted extension object.

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

## Webhook ingress

Each deployed provider/profile gets a target-generated webhook route. The route:

1. reads the exact raw bytes under a size and time limit;
2. selects the configured provider account generation without accepting a
   caller-selected secret;
3. verifies signature, timestamp tolerance, environment, and replay identity
   before parsing application-visible fields;
4. transactionally inserts one immutable `PaymentEvent` keyed by provider event
   id and body hash; and
5. enqueues normalization/reconciliation work, then returns the provider's
   required acknowledgement promptly.

Duplicate delivery with identical bytes is success. Reuse of an event id with
different bytes is a security incident and fails closed. Invalid signatures
produce only bounded, redacted diagnostics and never reveal whether an order or
attempt exists.

Webhook arrival order is not state order. The projector uses provider object
identity, normalized occurrence time when trustworthy, provider sequence when
available, and explicit adapter transition rules. It retains impossible or
unknown transitions for investigation rather than dropping them.

## Projection and fulfillment

The projection is a pure function of immutable attempt, command, response, and
event facts plus a versioned adapter policy. The projection records the policy
version and input frontier that produced it. Reprojection after an adapter
upgrade appends an audit entry and must be deterministic.

`paid` requires the declared capture evidence. `authorized` is not `paid`.
Client completion pages poll or subscribe to the Snapback projection; URL query
parameters and provider-side JavaScript callbacks are hints, never authority.

Fulfillment is another durable command with its own idempotency key and admission
policy. The commerce demo's conservative policy requires a verified capture fact
and no amount/currency disagreement. Refunds never delete or reverse the original
capture fact; they add refund facts and change the projection.

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

Audit records include who requested an operation, the application decision,
provider/event identities, hashes of canonical redacted request and response
facts, projection transitions, retries, repairs, and credential generation.
They exclude secrets, client tokens, regulated payment data, full provider
payloads unless the target declares an approved encrypted retention class, and
free-form error objects that might contain provider secrets.

Admin inspection and repair use the existing gated operations lane. Repair
requires a current provider lookup, a typed action, a reason, and a dry-run
projection diff. There is no generic "set payment status" operation.

## Capability and adapter conformance

Each adapter reports support for authorize, automatic capture, separate capture,
partial capture, cancel, partial/full refund, asynchronous methods, disputes,
idempotent create, lookup by idempotency key, webhook signatures, event replay,
test clocks, and raw-payload retention. Generated code refuses an application
declaration whose required features the selected target lacks.

The deterministic conformance provider simulates success, rejection, customer
action, timeout before/after provider commit, duplicate response, duplicate and
out-of-order webhook, id reuse with changed bytes, amount/currency mismatch,
late capture, partial refund, dispute, credential rotation, and test/live
confusion. It is evidence for orchestration logic, not a hosted-payment claim.

`commerce-payments-v1` requires a real provider in its sandbox environment and
the conformance provider. Production-money movement is never required in CI.

## Recovery and deployment

Backups include Snapback attempts, commands, events, links, projections, and
audit facts, but not provider secrets. Restore into another target defaults to
read-only commerce mode until an operator proves the environment, provider
account generation, event endpoint, and reconciliation frontier. A restored
worker may not blindly replay every pending command.

Deploy and rollback preserve adapter-policy compatibility. A deployment that
cannot interpret an already admitted command refuses activation. Webhook routes
remain compatible for all provider events whose attempts are nonterminal or
inside the declared dispute/refund retention window.

## Acceptance

The commerce pressure test must retain executable evidence that:

- two clients contend for the final inventory unit; one reservation and one
  immutable payment attempt commit, with no provider call for the loser;
- a provider commit followed by transport timeout is looked up or retried with
  the same idempotency key and creates one charge/capture;
- duplicate and out-of-order webhooks, action retries, worker restart, and
  deploy/rollback converge to one deterministic projection;
- redirect/query-parameter spoofing cannot produce `paid` or fulfillment;
- signature, event-id/body substitution, amount/currency, account-generation,
  test/live, cross-user, cross-app, and cross-database attacks fail closed;
- separate capture, cancellation, partial and full refund, and dispute facts
  preserve immutable history;
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

## Open questions

1. Which provider and pinned API version should be the first hosted adapter?
2. Should the v1 raw-event retention class keep encrypted provider payloads or
   only the normalized fact set plus a body hash?
3. Is verified capture sufficient for automatic fulfillment, or should every
   hosted profile require a subsequent provider-balance reconciliation?
4. Which exact-decimal representation is the canonical generated application
   type before LLP 0004's broader decimal vocabulary lands?
