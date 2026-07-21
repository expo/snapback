# LLP 0071: Application abuse, moderation, and audit

**Type:** RFC
**Status:** Draft
**Systems:** Abuse controls, Rate limits, Moderation, Audit, Auth, Runtime, Storage, Realtime, Admin, Privacy, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-20 (initial proposal for LLP 0063's hosted security foundation)
**Related:** LLP 0004, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0018, LLP 0031, LLP 0036, LLP 0047, LLP 0053, LLP 0055, LLP 0056, LLP 0060, LLP 0063, LLP 0070

## Summary

Snapback should provide one generated application-security layer for admission
rate limits, abuse signals, moderation workflows, and append-only audit facts.
The layer supplies primitives and enforceable boundaries; applications still
define community rules, moderator roles, appeal policy, and domain-specific
decisions.

The first profile, `application-safety-single-tenant-v1`, targets one trusted
hosted application deployment. It requires:

- server-enforced request and operation limits keyed only from trusted identity
  facts;
- durable reports, cases, decisions, appeals, and content-state transitions;
- authorization-aware invalidation when moderation changes visibility;
- an append-only, redacted audit ledger for security and privileged operations;
- bounded retention, legal-hold/export seams, and deletion policy; and
- executable evasion, isolation, privacy, and recovery tests.

This RFC does not promise automated content classification, universal spam
detection, legal compliance in every jurisdiction, immutable external
timestamping, or multi-tenant platform-operator moderation.

## Separation of concerns

The subsystem has four related but distinct lanes:

1. **Admission limits** make an allow, delay, or reject decision before costly
   application work or side effects begin.
2. **Abuse signals** record bounded observations such as repeated failures,
   reports, blocks, or provider risk facts. Signals are evidence, not automatic
   guilt.
3. **Moderation workflow** records cases and explicit human or application
   decisions that change application-visible state.
4. **Audit** records security-relevant facts and privileged actions. It is not
   the product's entire event history and is never a covert analytics stream.

An application may consume one lane only if its capability manifest says so.
Having an audit table does not imply rate limiting; having a request counter
does not imply complete moderation.

## Trusted request identity

Every admitted request derives a closed identity envelope at the server edge:

- app, database, deployment, target profile, and stream incarnation;
- authenticated principal and opaque authority instance when present;
- agent principal and scoped grant when present;
- connection id for realtime operations;
- route/function/operation class;
- source network prefix only from the directly observed peer or a configured,
  validated trusted-proxy chain; and
- a server-generated request id and trusted receipt time.

Caller-supplied user ids, role names, forwarding headers from an untrusted peer,
and arbitrary bucket keys are never admission authority. Anonymous identity is
deployment-scoped and combines a privacy-preserving network prefix digest with
a rotating server epoch; it is intentionally imperfect and must not be
presented as person identity.

## Admission rate limits

Applications declare named policies at generated boundaries:

- protected route or function classes;
- trusted key dimensions such as principal, authority instance, network prefix,
  document/channel/order, or a generated composite;
- token-bucket capacity and refill rate;
- maximum concurrent executions where relevant;
- policy precedence and the strictest composed result;
- response behavior and retry metadata;
- separate authenticated and anonymous ceilings; and
- audit sampling and retention class.

The runtime validates keys against the declared closed shape and enforces the
decision before handler invocation, database query, secret access, upload
allocation, job enqueue, email-code issuance, or expensive signature work when
the protocol permits. Authentication endpoints, webhook ingress, asset upload,
search, document operations, chat sends, reports, and admin operations each
have independent policies so saturation in one class cannot consume every
control path.

The first algorithm is a server-time token bucket with an atomic compare/update.
It returns `allowed`, `remaining`, `retryAfter`, policy id/version, and a
redacted decision id. Target profiles declare whether state is process-local,
database-durable, or shared. Only durable state qualifies for the hosted v1
profile; process-local limits are `Advisory` and reset on restart.

Limit configuration has hard platform ceilings. Application source may request
stricter values but cannot raise operator safety ceilings. Emergency operator
overrides are versioned, time-bounded, reasoned, audited, and visible in
capability reports.

Rate-limit responses do not disclose whether a protected resource exists or
which identity dimension triggered the limit. High-cardinality key admission is
bounded; unknown caller strings cannot create unlimited durable buckets.

## Abuse signals and enforcement

Generated application code may submit a bounded typed signal with subject,
resource, category, severity, evidence references, and deduplication key.
Allowed categories are source-declared; free-form payloads are size-bounded and
separately redacted. System signals may be emitted by authentication, webhook,
asset, payment, job, and runtime boundaries.

Signals may feed policy, but automated enforcement must be declared as one of:

- `observe`: retain/aggregate only;
- `challenge`: require a named, capability-reported verification step;
- `throttle`: activate a stricter named admission policy;
- `restrict`: apply a generated resource/account restriction mutation; or
- `case`: open or append to a moderation case.

Every non-observe transition records the exact policy version and input signal
ids. A score alone cannot delete content, ban a principal, or change ownership.
Unknown classifier/provider outputs default to observe or manual review.

Blocks and mutes are ordinary authorization inputs with generated semantics:
who stops seeing or notifying whom, whether shared rooms remain visible, and
whether moderators retain inspection access. They participate in LLP 0053
invalidation; a block or restriction cannot wait for a client reconnect before
preventing newly forbidden delivery.

## Moderation model

The durable model includes:

- `Report`: reporter, subject/resource, category, bounded statement, evidence
  references, dedup identity, status, and privacy class;
- `ModerationCase`: application-scoped case id, linked reports/signals/content,
  assigned moderator set, priority, state, and retention/hold flags;
- `ModerationDecision`: immutable decision kind, actor, policy version, reason
  code, bounded note, effective interval, affected resource/principal, and
  supersedes relation;
- `Appeal`: appellant authority, eligible decision, bounded statement, status,
  reviewer, and result; and
- `ContentModerationState`: the current deterministic projection used by reads,
  writes, live queries, assets, search, and notifications.

The first decision vocabulary is `noAction`, `label`, `limitDistribution`,
`hide`, `remove`, `lock`, `suspendPrincipal`, `banPrincipal`, `restore`, and
`escalate`. Applications declare which decisions apply to which resource types
and which scoped role/grant may make each one. "Moderator" is not a magic global
bypass.

A moderation mutation appends its decision and updates the projected content or
principal state in one Snapback transaction. Generated read/write sets include
the policy and resource authorization facts. Realtime delivery publishes the
visibility change under LLP 0053 obligations. Search index, notification, asset,
and cache consumers receive durable follow-up jobs; until they acknowledge the
new policy version, public serving paths fail closed or recheck the authoritative
moderation projection.

Deleting or editing the underlying content never deletes the case or decision
history. Evidence snapshots are references plus hashes by default; retaining
content copies requires an explicit sensitive retention class and access policy.

## Audit ledger

The audit ledger accepts only generated event types with schemas, redaction
rules, severity, actor/subject/resource identities, and retention classes. Core
events include:

- authentication and authority transitions;
- authorization/grant changes and denied privileged attempts;
- config/secret metadata changes without values;
- deploy, rollback, backup, restore, reset, migration, and admin access;
- rate-policy changes and material automated enforcement;
- reports, case access, moderation decisions, appeals, and evidence export;
- asset, notification, job, document, and payment privileged operations; and
- destructive or bulk recovery actions.

Each event carries deployment and stream identity, server time, request/job id,
actor authority, generated type/version, redacted canonical payload, previous
event digest within its partition, and its own digest. The chain detects
accidental loss or modification inside a retained partition; it is not called
tamper-proof because the same operator may control storage and signing keys.
Targets may add an external append-only sink or checkpoint signature and report
that as a stronger independent capability.

Audit writes required for a privileged database mutation commit in the same
transaction. For pre-database edge rejects and external effects, a bounded
durable audit intake must succeed before the action proceeds when policy marks
the event mandatory. At capacity the system fails closed for privileged actions
and preserves a reserved operator-recovery lane.

Audit queries require explicit event-type and application scopes. Values with
secret, credential, raw payment, private message, document body, or unrestricted
provider payload classes are rejected before serialization. Diagnostic strings
are coded and bounded. Hashing a secret does not make it safe to retain.

## Privacy, retention, and subject rights

Every signal, report, case, decision, and audit type declares a retention class:
short operational, application policy, security, financial, or legal hold.
Targets publish concrete windows and deletion behavior. Expiry uses durable
jobs and leaves only the minimum tombstone needed for idempotency and chain
continuity.

Application export projects only data the requesting subject is entitled to
receive; it does not expose other reporters, moderators' private notes, network
prefixes, security signals, or unrelated audit actors. Deletion requests
pseudonymize eligible actor/subject fields while preserving legal or security
records according to declared policy. Legal hold is an explicit privileged,
reasoned, time-reviewed state—not an undeletable default.

Reporters learn a bounded case status, not moderator identity, internal signals,
or actions against another person's account. Moderators see the minimum evidence
needed for their assigned scope.

## Admin and incident operations

The admin surface provides capability and policy status, current saturation,
bounded bucket inspection, cases and assignments, decision/appeal workflows,
audit search/export, chain verification, emergency restrictions, and retention
jobs. Every privileged read is itself audited at a practical aggregation level.

Bulk moderation and emergency controls use dry-run selectors, exact target and
profile preflight, result count/hash, same-version apply, bounded batch size,
reason, expiry, and rollback/restore semantics. There is no arbitrary SQL or
"set user banned" bypass behind the product API.

An incident mode can lower admission ceilings, disable named integration
classes, revoke scoped grants, or require manual moderation. It cannot disable
audit, authorization, backup safeguards, or target identity checks.

## Portability and capability classes

The subsystem depends on transactional counters, generated policy evaluation,
application rows, durable jobs, and ordinary authorization invalidation. The
first SQLite and single-process Postgres profiles use durable database buckets.
A hosted platform adapter may use a provider limiter only if atomicity, clock,
key isolation, failure posture, inspection, and reset behavior match the
declared policy.

Each lane reports independently:

- `Missing`;
- `Advisory` (non-durable or application-only enforcement);
- `EnforcedSingleProcess`;
- `EnforcedShared`; and
- `ExternallyCheckpointed` for an audit chain independently anchored outside
  the application deployment.

`application-safety-single-tenant-v1` requires durable enforced admission,
moderation, and audit on the admitted single-tenant target. It makes no shared
multi-process or independent-tamper-evidence claim.

## Acceptance

The implementation must retain executable evidence that:

- authenticated, anonymous, realtime, webhook, auth-code, asset, search,
  document, chat, report, and admin policies enforce their declared ceilings
  before expensive or side-effectful work;
- spoofed forwarding headers, caller-selected bucket keys, authority changes,
  restart, clock rollback, high-cardinality input, and concurrent requests
  cannot bypass or multiply allowance;
- platform ceilings cannot be raised by app source and emergency overrides
  expire and remain visible;
- duplicate reports/signals are idempotent, automated policy is versioned, and
  an unknown score cannot silently ban or remove;
- hide/remove/suspend/restore decisions invalidate active unauthorized delivery,
  search, notifications, asset access, and retained clients fail closed until
  their policy frontier catches up;
- scoped moderators cannot act outside assigned resource/action scope, and
  cross-app/database/deployment/stream access never reveals case existence;
- appeal, superseding decision, expiry, content edit/delete, and evidence
  orphaning preserve deterministic history;
- required audit and privileged mutations commit together, edge audit capacity
  failures block the privileged action, and stale/bulk selectors cannot apply;
- secret, credential, payment, private-content, raw-provider, and network facts
  obey their redaction and access rules across rows, logs, diagnostics, exports,
  backups, and receipts;
- chain verification detects deletion, reorder, and mutation of a retained
  event while honestly reporting that same-operator replacement remains outside
  the base profile;
- retention, pseudonymization, legal hold, backup, destroy/replace, and restore
  preserve the declared policy and a pinned audit/case corpus; and
- the chat, document, and commerce pressure tests each exercise their relevant
  abuse and audit paths, not merely the generic unit corpus.

The retained receipt names target profile and identity, repository/artifact and
policy digests, trusted-proxy configuration class, effective ceilings,
concurrency/fault corpus, moderation fixtures, audit-chain roots, retention
windows, secret scan, and every nonclaim.

## Non-goals and claim boundary

This RFC does not supply community policy, legal advice, machine-learning
moderation, perfect Sybil resistance, DDoS protection upstream of the target,
globally shared counters, independently tamper-proof logs, or multi-tenant
platform-operator access.

While this RFC is Draft, local counters, application tables, or ad hoc admin
routes cannot satisfy LLP 0063's production abuse-control gate. Maintainer
acceptance and a target-specific executable witness are both required.

## Open questions

1. Which audit events are mandatory enough that intake failure must block the
   initiating operation, and which may use a bounded loss-reporting buffer?
2. Should network-prefix buckets persist raw prefixes encrypted, keyed digests,
   or only rotating aggregates on the first hosted target?
3. Which retention defaults are safe enough to ship without implying one
   jurisdiction's policy is universal?
4. Must the first hosted profile anchor audit checkpoints outside the deployment,
   or is honest same-operator limitation sufficient for Step 6?
