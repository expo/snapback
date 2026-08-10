# LLP 0045: Notifications outbox

**Type:** RFC
**Status:** Draft
**Systems:** Notifications, Runtime, API, Security, Auth, Cron, Developer experience, Deployment, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-07
**Revised:** 2026-08-10 (LLP 0222 OQ3 ruling: connected-client freshness is not exactly-once live-vs-push arbitration; durable notification intent owns that lifecycle). 2026-07-13 (ENG-24596 final audit: retained this RFC's auth-mailbox handoff and durability-boundary ownership while delegating the exact process-local protocol to LLP 0057); 2026-07-13 (ENG-24596: reassigned auth challenge capture to LLP 0057's process-local mailbox and prohibited plaintext auth codes in durable notification intents); 2026-07-07 (cross-family review revisions, ratified by Charlie — see
`reviews/0045-notifications-outbox.claude.md`: runner pinned to 0028's cron
machinery, delivery grants grounded in 0036's `uses` model, auth-code handoff
with 0039 recorded; initial same day)
**Related:** LLP 0000, LLP 0004, LLP 0009, LLP 0010, LLP 0011, LLP 0027, LLP 0028, LLP 0029, LLP 0036, LLP 0038, LLP 0039, LLP 0057

## Summary

This RFC defines Snapback's first notifications subsystem as a durable outbox
over provider adapters. App code enqueues notification intents; Snapback records,
authorizes, deduplicates, retries, and delivers them through configured email,
SMS, and push providers.

The first slice is email-first with ordinary notification capture, then
provider delivery once secrets/config grants exist. This document owns that
notifications capture adapter, the durable intent lifecycle, and the auth-code
delivery handoff/durability boundary. [LLP 0057](./0057-auth-provider-protocol.spec.md)
is the implementing delegate for the exact item-3 bounded process-local mailbox
protocol. Its plaintext verification codes are never durable notification
intents. A future provider adapter may accept only an ephemeral/capture-class
payload handle at the delivery seam; migrating plaintext auth codes into this
durable outbox is forbidden.

## Motivation

Notifications are part of the "complete backend" promise and appear naturally in
the reference apps: party invites/reminders, transit alerts, messaging, task
assignment, auth email codes, and account lifecycle.

They are also dangerous to hand-roll. Without an outbox, apps will send provider
requests inside mutations/actions with weak idempotency, poor diagnostics, and
no retry story.

## Design

### Durable intent, side-effectful delivery

App code creates a notification intent:

- recipient principal or address;
- channel;
- template id or rendered payload;
- idempotency key;
- schedule/expiry;
- provider preference;
- authorization/audit context.

The mutation that creates the intent commits durable app state. Delivery is a
separate side effect owned by the delivery path below. This keeps the database
commit and provider delivery from pretending to be one transaction — exactly
[LLP 0028](./0028-cron-scheduled-execution.rfc.md)'s action contract ("an
action-level read followed by `ctx.runMutation` is not a transaction").

The outbox promises no cross-intent delivery ordering; apps must not depend on
enqueue order surviving to delivery order.

### The runner is 0028's machinery, not a new executor

There is no durable background-work subsystem in Snapback, and this RFC does
not assume one. The v1 delivery runner (ratified by Charlie, 2026-07-07, along
with the delivery-as-action grant model below and this document's ownership of
the capture mailbox) is a **cron sweep over the outbox**:
`WhileLive` demand activation, `NoOverlap`, at-least-once with claim, and
deterministic jitter — all existing 0028 semantics. Each sweep claims due
intents, attempts delivery, and records the result via the normal mutation
path. If a dedicated durable work queue is designed later it needs its own
LLP; this outbox becomes its first consumer.

Auth challenge capture is deliberately outside this sweep. This RFC owns that
handoff decision and its durable/non-durable boundary; LLP 0057 owns the exact
current process-local mechanics. Its challenge transaction publishes plaintext
only to the in-memory mailbox after commit, so no retry row, rendered code, or
recoverable durable payload crosses into the notifications runner.

Delivery executes as an **action carrying a `uses` grant** for the provider
credential, per [LLP 0036](./0036-app-secrets-and-config.rfc.md)'s D8 model —
the grant unit is the function, so delivery is a (possibly generated) action
declaring `uses: [<providerCredential>]`, not Snapback system code holding
credentials outside the grant model. This keeps notifications inside 0036's
redaction and never-pooled-VM rules with no new grant identity class.

### Channels

The first channel is email:

- local capture adapter for ordinary notification intents in dev and tests;
- an ephemeral provider handoff that may deliver an LLP 0057 auth-code payload
  without storing the plaintext in an outbox row;
- SMTP or provider-API adapter later;
- provider credentials through LLP 0036 config/secrets;
- stable delivery diagnostics.

SMS and push share the same outbox shape but can remain capability gaps until
provider adapters and device-token/app registration models are designed.

### Templates

Templates may be source-authored and generated into a manifest. The first slice
may also allow explicit rendered text/html payloads for tests and simple apps.

Templates should declare:

- channel;
- required variables;
- preview data;
- sensitive fields to redact from diagnostics.

### Idempotency and retry

Every notification intent has an idempotency key scoped to app and provider.
The runner records attempts, provider message ids, retry schedule, terminal
failure, cancellation, and expiry.

Provider errors are classified as:

- retryable;
- permanent recipient failure;
- configuration failure;
- rate limited;
- unknown.

### Authorization

Enqueuing a notification is an app operation and must run under normal
authorization. Admin/provider credentials only authorize delivery to the
provider; they do not authorize app code to contact arbitrary recipients.

## Non-goals

- Marketing automation.
- Full push notification device-token lifecycle in the first slice.
- Inbound email/SMS handling.
- Provider marketplace.
- Guaranteed exactly-once delivery across provider retries.
- Cross-intent delivery ordering guarantees.
- Notification UI components.

## Acceptance

- A local app can enqueue an email notification and read it from a local capture
  mailbox in tests.
- Auth verification-code plaintext is absent from durable notification intents,
  retry state, diagnostics, and provider message records; only LLP 0057's
  process-local mailbox or a future ephemeral provider handle may carry it.
- Duplicate idempotency keys do not send duplicate messages.
- A failed provider attempt records a structured diagnostic and retry state.
- Delivery runs as an action whose `uses` grant controls which provider
  credentials it may read; an intent whose delivery action lacks the grant
  fails with a configuration diagnostic, not silent credential access.
- The outbox sweep respects `NoOverlap` — two concurrent sweeps cannot
  double-deliver a claimed intent.
- The All Aboard "leave now" reminder can be represented as an intent even if
  SMS/push delivery remains a gap.

### Dated amendment — external identity brokers are a separate session-entry seam (2026-07-26)

A trusted server-side identity broker may authenticate a native user through
its own front door and invoke LLP 0024/0057's `auth.mintSession`, then return
the genuine Snapback session bearer to that user. This is a supported
**dev/test/demo** bridge when the broker is co-deployed with the local target:
it must hold AdminWrite and the process-bound impersonation capability, neither
of which may enter a client bundle. Protocol clients adopt the bearer under LLP
0096's exact `auth/rr` / `auth/live` offers.

This seam does not deliver an email code and does not move plaintext into the
durable outbox, so it neither implements nor weakens this RFC. In particular,
it is not a production-delivery claim: `auth.mintSession` remains
non-production, the SMTP/provider adapter above remains unbuilt, and a hosted
arm without sessions routes remains unable to authenticate native users.

## Open Questions

- Should a permanent recipient failure persist as a suppression fact that
  blocks future intents to that address (bounce/complaint hygiene protects
  provider standing), and where does that fact live?
- What is the first push provider and how are device tokens modeled?
- Does scheduled (future) delivery need anything beyond the sweep's due-time
  claim, or is the cron sweep sufficient until volume proves otherwise?

### Dated amendment — connectivity is not delivery arbitration (2026-08-10)

LLP 0222's `ctx.realtime.hasFreshClient` predicate is advisory routing input
only. It MUST NOT arbitrate exactly-once behavior between live delivery and
push, cancel a durable notification intent, or prove that a user observed an
event. A client may disconnect immediately after a fresh witness, reconnect on
another device, or receive both lanes.

Any live-vs-push suppression that needs exactly-once product behavior belongs
to this RFC's durable notification-intent lifecycle: the intent, claim,
attempt, cancellation, idempotency, and terminal settlement records are the
authority. The connected-client predicate may inform an attempt policy, but a
`true` or `false` result is never that lifecycle's durable settlement fact.

## Status

Draft. This RFC splits notifications from assets and gives provider delivery a
durable outbox shape.
