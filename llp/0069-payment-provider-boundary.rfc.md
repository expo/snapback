# LLP 0069: Payment provider boundary

**Type:** RFC
**Status:** Draft
**Systems:** Payments, Commerce, Actions, Storage, Auth, Secrets, Webhooks, Background work, Audit, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review reconciliation: trusted order-centric checkout, exact-money profile, bounded reservation lifecycle, exact provider binding, canonical request bytes, credential generations, deterministic projection, client-capability custody, and a pinned first Stripe sandbox adapter; remains Draft pending independent payments/security review and executable witnesses). 2026-07-20 (initial proposal for LLP 0063's commerce pressure test)
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
separate capture, cancel, refund, and webhook reconciliation against Stripe
PaymentIntents in test mode at API version `2026-02-25.clover`, plus a
deterministic conformance provider. The request header and webhook endpoint
both pin that exact API version; a later version is a new adapter-policy
revision and must rerun conformance. The profile never accepts raw PAN,
security codes, or bank credentials into Snapback handlers, storage, retained
clients, logs, backups, or test receipts.

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

## Exact money and price authority

`MoneyV1` is a closed generated value with:

- `minorUnits`, an unsigned 64-bit integer serialized as a canonical decimal
  string with no sign or leading zero except `"0"`;
- `currency`, exactly three uppercase ASCII letters; and
- `exponent`, an unsigned 8-bit integer.

All arithmetic uses checked integer operations with a 128-bit intermediate and
must fit the stored unsigned 64-bit result. Snapback never rounds a
non-representable input; it refuses it. One order and every attempt, capture,
refund, and provider fact linked to it have one currency and exponent.
Snapback performs no currency conversion.

Each adapter policy carries a content-addressed currency-registry artifact
mapping admitted codes to exponents. A profile refuses a registry disagreement
before provider I/O. The first Stripe adapter is intentionally narrower:
`USD`, exponent `2`, only. Its golden corpus covers zero, maximum admitted
amount, overflow, negative and fractional input, wrong exponent, changed
currency, and cross-language canonical bytes. Expanding the currency set
requires a dated registry artifact and new adapter-policy revision; an adapter
may never silently round to provider units.

The payable `MoneyV1` is computed inside trusted Snapback mutation authority
from immutable order lines, their pinned price-policy version, admitted
discounts, and any tax/shipping facts the application profile supports. It is
not accepted from a customer client. The transaction persists the exact inputs
and result with the reservation and attempt, so later catalog changes cannot
alter it.

## Data model

The first generated commerce module owns system-shaped records that applications
may join but cannot forge:

- `InventoryReservation`: order and inventory identities, exact quantity,
  state, trusted-time deadlines, transition generation, and unique effect ids;
- `PaymentAttempt`: app/database/order identity, operation, exact `MoneyV1`,
  price-policy and price-input digest, provider profile, provider account
  generation, application principal, authority instance, creation/expiry
  timestamps, and current projection;
- `PaymentCommand`: attempt, command kind, monotonic sequence, claim lease,
  retry policy, canonical request bytes and digest, provider-scoped idempotency
  key, provider response hashes, opaque provider object ids, and terminal
  command outcome;
- `PaymentEvent`: provider, account generation, provider event id, verified
  signature metadata, received timestamp, event type, opaque object ids,
  normalized amount/currency facts, encrypted-or-redacted raw-body retention
  class, and processing disposition;
- `PaymentBindingProof`: an exact authenticated link between attempts,
  commands, provider objects, and events, including environment, account
  generation, immutable provider metadata, amount/currency agreement, and the
  adapter rule that established it;
- `PaymentLinkCandidate`: a non-authoritative diagnostic candidate with its
  evidence and disagreement reason;
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

- `payments.beginCheckout(orderId, paymentChoice)`;
- `payments.prepareClient(attemptId)` returning only provider-safe public
  configuration and an opaque client token or hosted URL;
- `payments.capture(attemptId, amount?)`;
- `payments.cancel(attemptId)`;
- `payments.refund(attemptId, amount, reason)`;
- `payments.status(attemptId)`; and
- `payments.reconcile(attemptId)` for an admin or durable worker.

`beginCheckout` accepts only an order identity and an application-generated
choice enum whose values may select an admitted payment method and capture
posture, never price or currency. In one transaction it reads the immutable
order and pricing facts, computes `MoneyV1` under the pinned policy, validates
inventory, creates the reservation and attempt, and enqueues the first durable
command. A separately named `createAttemptFromTrustedMoney` primitive may be
generated for server composition only when its declaration carries a
non-delegable server grant; it is absent from client bindings, rejected by
client credentials, and has explicit negative reachability witnesses.

Provider calls are actions carrying explicit LLP 0036 `uses` grants. The
action claims a command, calls the provider with the fixed idempotency key,
then records raw response facts through a mutation. No API pretends those
commits form a distributed transaction.

The client state distinguishes `notStarted`, `requiresCustomerAction`,
`providerPending`, `authorized`, `capturePending`, `paid`, `failed`,
`cancelled`, `partiallyRefunded`, `refunded`, `disputed`, `ambiguous`, and
`manualReview`. Adapter-specific facts remain available behind a typed,
redacted extension object.

`prepareClient` returns a sensitive bearer capability even though it is not
regulated card data. The returned envelope binds provider, environment,
account generation, attempt, exact money, allowed action, audience/origin and
redirect URI where supported, issuance and expiry, and single-use/reuse
posture. Responses are authenticated, `Cache-Control: private, no-store`, and
never enter SSR/prerender output, analytics, logs, generic diagnostics,
retained client storage, exports, backups, or receipts. The generated type is
redacted by default and cannot implement ordinary string/debug formatting.

## Inventory reservation lifecycle

The reservation state machine is `held → ambiguousHold → consumed|released`;
`held` may also move directly to `consumed` or `released`. Every transition is
a compare-and-swap over the transition generation and appends one unique
effect id, so duplicate work, webhook delivery, restart, or replay cannot
consume or release inventory twice.

- `beginCheckout` creates `held` with a trusted-server
  `customerActionDeadline`.
- A definitive provider rejection, verified cancellation, expired
  authorization, or abandonment before any ambiguous provider call releases
  the reservation.
- A verified capture consumes it. An authorization without capture keeps it
  held only through the declared authorization/fulfillment policy.
- An ambiguous call moves it to `ambiguousHold` and starts the target's
  preregistered `maximumAmbiguousHold`. Lookup and same-key retry continue
  under LLP 0070 during that interval.
- Definitive no-capture evidence before that deadline releases it; verified
  capture consumes it.
- When the maximum ambiguous hold expires without definitive evidence, one
  transaction releases the inventory and marks the attempt
  `manualReviewReleased`. The old attempt can never reclaim inventory.
  A later verified capture becomes `latePaidUnfulfilled`; automatic
  fulfillment is forbidden. The first Stripe profile always enqueues a full
  same-attempt refund command; failed or ambiguous refund is manual review, not
  fulfillment.

After release, create/capture retry is permanently disabled; reconciliation
may only look up provider state and, if a late capture exists, drive the refund
or manual-remedy lane.

Thus neither an abandoned checkout nor an indefinitely ambiguous provider can
lock inventory forever, and a late success cannot oversell by silently
fulfilling released stock. Application abuse controls bound simultaneous
reservations per principal and low-cardinality outer bucket under LLP 0071.
The first Stripe profile freezes a 30-minute customer-action deadline and a
24-hour maximum ambiguous hold; changing either creates a new target-profile
revision and reruns the crash/abuse corpus.

The conformance crash matrix stops before and after every reservation commit,
provider call, response/fact commit, timeout transition, release, late capture,
and refund enqueue, then proves one local effect and a conservative render
state after restart.

## Commands, retries, and ambiguity

The durable-work subsystem proposed separately from this RFC executes payment
commands. A command claim has a bounded lease and at-least-once delivery. Before
calling the provider, the worker derives the idempotency key from the immutable
attempt and command sequence; it never derives a new key on retry.

Every provider-affecting command persists a closed
`CanonicalProviderRequestV1` envelope containing provider, adapter-policy
version, environment, account generation, application/database/stream,
attempt, command kind and sequence, `MoneyV1`, capture posture,
customer/payment-method opaque references, sorted admitted metadata, and every
provider-affecting option. Fields have one schema-defined present/absent
posture; `null`, omission, empty string, and empty collection are never
interchangeable. Text fields required to be human text are NFC; provider
opaque identifiers remain byte-exact UTF-8. Integers use the canonical decimal
strings defined above.

The envelope is RFC 8785 JCS UTF-8. Its digest is SHA-256 over
`"snapback-provider-request-v1" || 0x00 || uint64be(length) || bytes`.
Transport headers, request timestamps, retry count, SDK telemetry, and
provider-generated volatile values are outside the envelope. Before every
call, retry, or lookup, the worker reconstructs the bytes and compares the
stored digest; disagreement quarantines the command before network I/O. The
idempotency key is a base64url encoding of a separately domain-separated
SHA-256 over the immutable target/provider/account/attempt/command identity.
Golden vectors run across Rust, TypeScript, and the real adapter and include
null/omission, Unicode, maximum money, map ordering, changed-one-field, and
same-key/different-bytes rejection.

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

Capture and refund commands reserve their local monetary ceiling in the same
transaction that creates the command. The sum of settled and outstanding
capture reservations may not exceed the provider-admitted authorization or
attempt total. The sum of settled and outstanding refund reservations may not
exceed settled capture less prior settled refunds. Ambiguous commands retain
their reservation. Definitive rejection releases it idempotently; verified
settlement consumes it. Concurrent commands therefore cannot pass the local
ceiling independently. Providers that do not support partial capture,
multi-capture, partial refund, or cancel-after-partial-capture refuse the
corresponding declaration and command before provider I/O.

## Credential-generation lifecycle

An attempt and every command pin the outbound provider-account generation.
Retries use that generation; they never silently substitute the current
credential. Rotation policy declares an overlap interval for still-valid
outbound generations and webhook verification generations. If a pinned
outbound credential is revoked or no longer authorized, the command enters
`manualReview` and requires an exact provider lookup under a separately
authorized migration rule before any substitution.

Webhook ingress tries a bounded deployment-selected set of eligible signing
secret generations, never a caller selector. It records the unique successful
generation; zero or multiple successful generations fail closed. Retired
verification material remains only through the maximum provider retry and
retention interval, then external key destruction appends the LLP 0071
deletion manifest. Provider-account migration requires a fresh authenticated
lookup proving environment, old/new account ownership, object id, immutable
attempt metadata, and exact money before it can append a successor
`PaymentBindingProof`.

## Webhook ingress

Each deployed provider/profile gets a target-generated webhook route. The route:

1. reads the exact raw bytes under a size and time limit;
2. selects the configured provider account generation without accepting a
   caller-selected secret;
3. verifies signature, timestamp tolerance, environment, and replay identity
   before parsing application-visible fields;
4. transactionally inserts one immutable `PaymentEvent` keyed by provider event
   id and body hash plus its LLP 0070 durable normalization/reconciliation
   intent; and
5. only after that transaction commits, returns the provider's required
   acknowledgement promptly.

Duplicate delivery with identical bytes is success. Reuse of an event id with
different bytes is a security incident and fails closed. Invalid signatures
produce only bounded, redacted diagnostics and never reveal whether an order or
attempt exists.

Storage or durable-intent failure returns the adapter's retryable response; it
never acknowledges an uncommitted event. An identical committed duplicate
returns the same admissible acknowledgement even while normalization is
pending, retried, or quarantined. Each target freezes request-byte, parse-time,
signature-clock-skew, eligible-key-count, replay-retention, rate, and overload
bounds. LLP 0071's low-cardinality outer ingress bucket runs before
provider-expensive verification, and overload preserves provider retry
semantics without unbounded queues.

The v1 retention class encrypts the exact signed provider body under an
external generation key through the declared refund/dispute/reprojection
window. Normalized facts, the original normalizer/schema version, and the body
hash remain afterward; key erasure appends an auditable deletion manifest.
Reprojection may use only facts retained by the original schema unless an
authorized current-provider lookup appends a new observation. Raw bodies never
enter ordinary application queries, exports, logs, backups without their
separately encrypted retention class, or test receipts.

Webhook arrival order and provider wall-clock time are never state order.
Each adapter policy maps verified responses, signed events, and authenticated
lookups into closed immutable fact classes, names which class can establish
authorization, capture, cancellation, refund, and dispute, and supplies a
total audit ordering by fact-class rank, provider object id, provider sequence
where guaranteed, event id, and body hash. Occurrence time is audit metadata
only. Lookup/current-object facts and event facts are distinct classes.
Impossible, regressive, and unknown facts remain retained but cannot be
promoted by runtime judgment.

## Projection and fulfillment

The projection is a pure function of immutable attempt, command, response, and
event facts plus a versioned adapter policy. The projection records the policy
version and input frontier that produced it. Reprojection after an adapter
upgrade appends an audit entry and must be deterministic. Every permutation of
the same fact set must produce byte-identical projection and audit output.

Only a `PaymentBindingProof` may feed authoritative money state. It requires
unique agreement on provider/account generation, environment, provider object,
attempt metadata, exact money, and adapter-owned binding data. A
`PaymentLinkCandidate`, confidence score, fuzzy match, amount disagreement, or
multiple plausible match can produce only `ambiguous` or `manualReview`; no
operator convenience action may convert one into authorization, payment,
refund, or fulfillment.

The reducer computes orthogonal monotonic facts—authorized amount, unique
settled capture total, unique settled refund total, cancellation, dispute,
contract disagreement, reservation disposition, and outstanding command
classes—rather than replaying delivery order. Capture/refund totals use provider
object identities and the local command reservations, reject double counting
and overflow, and cannot exceed the admitted ceilings. The render-state
priority is:

1. contract disagreement or unresolvable binding → `manualReview`;
2. capture after released inventory → `latePaidUnfulfilled`;
3. verified dispute → `disputed`;
4. refund total equal to capture total → `refunded`;
5. nonzero refund below capture → `partiallyRefunded`;
6. nonzero verified capture → `paid`;
7. outstanding capture → `capturePending`;
8. verified authorization → `authorized`;
9. admitted customer action or provider work → its pending state; then
10. definitive cancellation or failure.

For the pinned Stripe policy, a capture fact requires an exact binding plus an
authenticated current PaymentIntent observation or a verified
`payment_intent.succeeded` event whose `amount_received` matches admitted
money. A refund fact requires a uniquely bound successful Refund object.
Cancellation and dispute have their own closed fact classes and never erase a
capture. The adapter corpus permutes events, ties timestamps, moves clocks
backward, introduces late snapshots and unknown event types, and proves the
same output.

`paid` requires the declared capture evidence. `authorized` is not `paid`.
Client completion pages poll or subscribe to the Snapback projection; URL query
parameters and provider-side JavaScript callbacks are hints, never authority.

Fulfillment is another durable command with its own idempotency key and admission
policy. The commerce demo's conservative policy requires a verified capture fact
with exact inventory still consumed and no amount/currency or binding
disagreement. Provider-balance reconciliation is not required for the v1
Stripe test-mode claim. No operator action may fulfill an ambiguous or
`latePaidUnfulfilled` attempt. Refunds never delete or reverse the original
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

The mandatory `commerce-payments-v1` floor is automatic capture, separate
authorization/capture, cancel before capture, full and partial refund,
disputes, stable idempotent create/retry, lookup by returned object identity,
signed webhooks, test/sandbox mode, exact money, encrypted raw-event retention,
and reconciliation. Partial or multiple capture, asynchronous payment methods,
provider event replay, and test clocks are optional capability cells with
independent suites. A real adapter and demo run the mandatory floor plus only
the optional cells their immutable manifest declares; "same suite" means the
conformance provider runs that exact admitted cell set, not unsupported
features.

The deterministic conformance provider simulates success, rejection, customer
action, timeout before/after provider commit, duplicate response, duplicate and
out-of-order webhook, id reuse with changed bytes, amount/currency mismatch,
late capture, partial refund, dispute, credential rotation, and test/live
confusion. It is evidence for orchestration logic, not a hosted-payment claim.

`commerce-payments-v1` requires a real provider in its sandbox environment and
the conformance provider. Production-money movement is never required in CI.

## Recovery and deployment

Backups include Snapback attempts, commands, events, binding proofs,
diagnostic candidates, projections, and audit facts, but not provider secrets.
Restore into another target defaults to read-only commerce mode until an
operator proves the environment, provider account generation, event endpoint,
and reconciliation frontier. A restored worker may not blindly replay every
pending command.

A stream reset or restore allocates a new LLP 0072 activation epoch. The typed
`adoptForeignProviderObject` operation requires an operation-scoped grant,
fresh authenticated provider lookup, dry-run diff, and proof of the
application/database/environment/account, object id, immutable attempt
metadata, and exact money. Success appends a new observation and successor
`PaymentBindingProof`; it does not reactivate old client authority, settlements,
idempotency keys, or commands. Any mismatch produces only a
`PaymentLinkCandidate` and manual review.

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
- an untrusted client cannot select amount/currency or reach the privileged
  money-taking primitive, and changed price-policy facts abort atomically;
- concurrent capture/refund requests reserve one local monetary ceiling and
  cannot over-capture or over-refund across crash/restart;
- abandonment, definitive rejection, ambiguity expiry, release, late capture,
  and automatic refund execute the frozen reservation lifecycle without
  indefinite inventory lock or late fulfillment;
- duplicate and out-of-order webhooks, action retries, worker restart, and
  deploy/rollback converge to one deterministic projection for every fact
  permutation;
- a diagnostic/candidate link, timestamp tie, regressive event, or ambiguous
  provider object can never produce authoritative money state;
- redirect/query-parameter spoofing cannot produce `paid` or fulfillment;
- signature, event-id/body substitution, amount/currency, account-generation,
  test/live, cross-user, cross-app, and cross-database attacks fail closed;
- separate capture, cancellation, partial and full refund, and dispute facts
  preserve immutable history;
- credential rotation selects the intended account generation without exposing
  either secret in logs, diagnostics, receipts, database, or backups;
- canonical request vectors agree across languages, and same-key changed bytes
  fail before provider I/O;
- webhook storage failure receives a retryable response, while an identical
  committed duplicate receives the same acknowledgement without duplicate
  work;
- client capability tokens are absent from logs, SSR/prerender output,
  analytics, retained storage, exports, backups, diagnostics, and receipts;
- backup, destroy/replace, restore, read-only reconciliation, and explicit
  worker activation preserve order/payment integrity, and foreign-object
  adoption cannot revive old authority;
- the real provider sandbox and deterministic conformance provider pass the
  same required adapter suite; and
- the hosted storefront names every unsupported provider feature and never
  claims PCI certification or accounting completeness.

The retained receipt names provider and API version, sandbox/live mode, target
profile, app/database/deployment identities, repository revisions, schema and
artifact hashes, adapter-policy and currency-registry versions, canonical
request and exact-money corpus hashes, reservation deadlines, webhook fixture
hashes, encrypted-retention class, capability cells, and nonclaims.

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

1. What exact encrypted raw-event retention duration should the first target
   choose within Stripe's dispute/refund window?
2. Should a later profile admit additional currencies under one adapter
   manifest or define one immutable currency set per target profile?
3. Which optional Stripe cells beyond the mandatory floor should the reference
   storefront exercise?

These questions affect target retention and optional capability scope, not the
v1 authority, money, idempotency, reservation, binding, or projection
semantics. This RFC remains Draft until LLP 0070/0071 are accepted, the
deterministic provider implements the state machine, and independent non-GPT
payments/security review validates the revision.
