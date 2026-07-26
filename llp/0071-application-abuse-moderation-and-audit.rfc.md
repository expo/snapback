# LLP 0071: Application abuse, moderation, and audit

**Type:** RFC
**Status:** Draft
**Systems:** Abuse controls, Rate limits, Moderation, Audit, Auth, Runtime, Storage, Realtime, Admin, Privacy, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-07-26 (author-side review reconciliation: staged request
identity, atomic composed admission reservations, portable integer token-bucket
semantics, bounded key allocation and proxy derivation, idempotent automated
enforcement, a deterministic scoped moderation reducer, downstream visibility
frontiers, segmented audit integrity with durable-work effect linkage,
non-rollbackable privacy restore reconciliation, legal-hold lifecycle, and
snapshot-bound bulk operations are specified. The RFC remains Draft pending
independent security/privacy review and implementation). 2026-07-20 (initial
proposal for LLP 0063's hosted security foundation)
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

Request identity refines through two closed, versioned envelopes. The edge
envelope exists before authentication and contains only:

- app, database, deployment, target profile, and stream/restore incarnation;
- directly observed transport and validated trusted-proxy facts;
- connection id where one already exists;
- route/function/operation class; and
- a server-generated request id and trusted receipt time.

Pre-authentication admission uses only that envelope. A verified authentication
transition then appends exactly one coded outcome: an authenticated principal
and opaque authority instance, an agent principal and scoped grant, anonymous,
or invalid. The refined envelope used by post-authentication admission contains:

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

Every decision records the envelope version and which stage it consumed.
Authentication failure never copies unverified token claims into a durable key,
diagnostic, signal, or audit event.

Trusted-proxy derivation is versioned. Configuration pins trusted hop
identities/CIDRs, an accepted single-header grammar, right-to-left trusted-hop
removal, multi-header rejection, direct-peer fallback, IPv4-mapped-IPv6
normalization, and target-specific IPv4/IPv6 prefix lengths. Configuration
rollout is generation-fenced and audited. Anonymous digests use HMAC-SHA256
with an operator-custodied epoch key and overlap adjacent epochs by charging
the stricter of old/new buckets for one refill window, so rotation neither
mints a second full allowance nor creates a stable cross-period identifier.

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

One generated admission transaction resolves an immutable effective-policy
version, canonicalizes and bounds every trusted key, samples trusted time once,
and checks every component bucket plus concurrency ceiling. It either commits
all token charges and one leased execution reservation or commits none.
Rejected requests consume only a separately declared outer defensive bucket;
they never partially charge the requested operation's component buckets. The
reservation carries target/restore epoch, request, policy generation, and a
strictly increasing fence. Completion releases it under that fence; crash,
disconnect, stream abandonment, and durable-job transfer expire or hand it off
under the same generated protocol.

The first bucket algorithm is `snapback-token-bucket-v1`: integer microtokens,
integer milliseconds, capacity/refill numerator and denominator, floor after
one checked 128-bit multiply/divide, saturation at capacity, and a maximum
credited elapsed interval declared by the operator ceiling. Trusted time is
clamped to `max(lastObservedMs, nowMs)`; rollback adds no tokens, overflow
fails closed, and `retryAfterMs` rounds up. Restore advances an external
rate-limit epoch and starts buckets no fuller than their restored balance.
Golden JS/Rust/SQLite/Postgres vectors cover rollback, long downtime,
saturation, rounding, and numeric limits.

The public decision view returns only `allowed`, a policy-safe coarsened
`retryAfter`, policy id/version, and opaque decision id. Exact component
`remaining` values and rejecting dimensions are restricted to scoped audited
inspection. Target profiles declare whether state is process-local,
database-durable, or shared. Only durable state qualifies for the hosted v1
profile; process-local limits are `Advisory` and reset on restart.

Limit configuration has hard platform ceilings. Application source may request
stricter values but cannot raise operator safety ceilings. Emergency operator
overrides are versioned, time-bounded, reasoned, audited, and visible in
capability reports.

Rate-limit responses do not disclose whether a protected resource exists or
which identity dimension triggered the limit. High-cardinality key admission is
bounded. A low-cardinality outer bucket over network epoch, verified principal,
or deployment-scoped anonymous class must admit before any resource-key bucket
is allocated. Each policy pins per-outer-key and global resource-bucket quotas,
missing-resource negative-cache bounds, eviction tombstones, and overflow
behavior. Unknown caller strings cannot create unlimited durable buckets.
Ordinary traffic fails closed at capacity while independently bounded
authentication-recovery and operator lanes remain available.

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

Automated enforcement uses a canonical identity over policy id/version,
subject/resource, sorted input-signal digest set, and evaluation generation.
Applying the same identity is idempotent inside the moderation transaction.
Signal correction, provider retraction, or evidence deletion appends a typed
fact and schedules a new evaluation; it never rewrites old evidence or
decisions. Any provider confidence that affects more than `observe` carries a
bounded typed model/rule identity, version, provenance, and calibrated
confidence class.

Report admission has per-reporter, per-subject/resource, and deployment bounds,
plus declared clustering/deduplication. Report volume alone cannot cross a
destructive enforcement threshold. Assignment records moderator conflicts and
recusal; applications may require dual control for named destructive or bulk
decisions. Revoking moderator authority immediately invalidates assignment and
blocks settlement, while leaving an auditable attempted action.

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

Every decision names an expected moderation-projection revision and commits by
CAS. Rejected stale attempts are audited but never enter the authoritative
decision set. The reducer composes active decisions independently over four
axes:

- visibility: `public < limited < hidden < removed`;
- mutation: `writable < locked`;
- principal admission: `active < suspended < banned`; and
- labels: a canonical sorted set of active label decision ids.

Account, room, resource, and distribution scopes each keep a monotonic
revision. A materialized content state takes the strongest applicable value on
each axis; ties are ordered by scope specificity, effective server time,
decision id, then policy version. `restore` names the exact decision ids it
revokes and cannot clear an unrelated restriction. Effective-interval
activation/expiry, appeal outcomes, superseding authority, and policy migration
append decisions and CAS the same reducer. Golden vectors cover concurrent
branches, late expiry, overlapping account/room/content restrictions, partial
restore, appeal, and policy migration.

A moderation mutation appends its decision and updates the projected content or
principal state in one Snapback transaction. Generated read/write sets include
the policy and resource authorization facts. Realtime delivery publishes the
visibility change under LLP 0053 obligations. Search index, notification, asset,
and cache consumers receive durable follow-up jobs; until they acknowledge the
new policy version, public serving paths fail closed or recheck the authoritative
moderation projection.

The generated visibility authority is
`(app, database, target/restore epoch, principalAuthorityGeneration,
accountRevision, roomRevision?, resourceRevision?, policyDigest)`. Each
derived consumer records the exact tuple it materialized and compares every
relevant monotonic frontier before release. A stale global/account frontier
does not unnecessarily invalidate unrelated resources, while an account or
room restriction cannot be missed by checking only a resource revision.
Already sent notifications and externally cached assets are reported as
non-recallable outcomes; revocation blocks future release and requests, but the
platform never claims to undo bytes already delivered outside its authority.

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

Audit partitions use the closed key
`(app, database, targetIncarnation, restoreEpoch, retentionClass, partitionDay)`.
Each bounded segment begins with a genesis/continuity record, then allocates a
strictly increasing sequence and previous digest by CAS in the same transaction
that appends the event. Canonical bytes use RFC 8785 JSON over a closed schema,
length-framed with domain `snapback-audit-event-v1`, and SHA-256. Rotation seals
the segment with event count, first/last sequence, root digest, previous sealed
root, schema/policy digest, and custody generation. Concurrency and crash tests
must prove there is one chain or an explicit detected fork, never two silently
valid heads.

Each event carries deployment and stream identity, server time, request/job id,
actor authority, generated type/version, redacted canonical payload, previous
event digest within its segment, and its own digest. The chain detects
accidental loss or modification of retained bytes and continuity records; it is
not called tamper-proof because the same operator may control storage and
signing keys. Targets may add an external append-only sink or checkpoint
signature and report that as a stronger independent capability. A separately
bounded recovery partition and reserved quota prevent ordinary audit traffic
from consuming the lane needed to report or repair saturation.

Audit writes required for a privileged database mutation commit in the same
transaction. For pre-database edge rejects and external effects, a bounded
durable audit intake must succeed before the action proceeds when policy marks
the event mandatory. At capacity the system fails closed for privileged actions
and preserves a reserved operator-recovery lane.

Mandatory external effects route through LLP 0070 durable work: one stable
operation id transactionally commits domain intent, mandatory audit enqueue,
and the job; provider idempotency and a fenced outcome record distinguish
attempt from completion. A direct effect without that protocol must declare an
`ambiguous` disposition and manual reconciliation. Audit intent is never
evidence that an external effect completed.

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

Chained audit bytes are never rewritten in place. Sensitive payload members are
encrypted under per-subject or per-retention-class data keys; stable
non-sensitive tombstone facts remain in the canonical event. Pseudonymization
or erasure appends a typed event, retires the relevant key generation, and
updates a deletion manifest. Sealed-segment roots and deletion manifests retain
continuity without pretending that cryptographically erased payload bytes
remain verifiable. Capability reports distinguish retained-byte verification,
segment continuity, deletion-manifest verification, and externally anchored
roots.

A control authority outside the restorable application snapshot owns monotonic
privacy generation, deletion manifests, legal holds, encryption-key status,
audit segment roots, and rate-limit/restore epochs. A restored target remains
paused in a new target/restore epoch until it imports that authority, reconciles
policy versions and holds, reapplies required erasure/pseudonymization, proves
retired keys cannot decrypt restored bytes, and opens a new audit segment
linked to the restore record. Stale clients, workers, exports, and backup
readers are fenced by the new generations.

Application export projects only data the requesting subject is entitled to
receive; it does not expose other reporters, moderators' private notes, network
prefixes, security signals, or unrelated audit actors. Deletion requests
pseudonymize eligible actor/subject fields while preserving legal or security
records according to declared policy. Legal hold is an explicit privileged,
reasoned, time-reviewed state—not an undeletable default.

A legal hold records issuer authority/scope, reason class, bounded
subject/resource ceiling, start/review/expiry, renewal generation, release
authority, and affected retention classes. It takes precedence over ordinary
expiry only for those classes. Review, renewal, release, and expiry are audited;
expiry schedules reconciliation and cannot silently preserve data forever.

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

The dry run binds target/stream/restore epoch, schema and policy digest,
snapshot/version frontier, canonical selector bytes and query-plan identity,
the ordered affected identity/revision set, and actor authority generation.
Apply revalidates actor authority, reproduces the reviewed selector, and CASes
each row against its reviewed revision. Partial conflicts are returned
explicitly and never widen the selection; a new dry run is required to include
changed or newly matching rows.

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

Four lane profiles qualify independently:
`application-admission-single-tenant-v1`,
`application-signals-single-tenant-v1`,
`application-moderation-single-tenant-v1`, and
`application-audit-privacy-single-tenant-v1`. A vertical may name only the
lanes it actually exercises, but its omitted lanes remain explicit nonclaims.
`application-safety-single-tenant-v1` requires durable enforced admission,
signals/enforcement, moderation, and audit/privacy on the admitted
single-tenant target. LLP 0063 Step 6's platform foundation requires that
conjunction even if one vertical can admit a narrower lane profile. It makes no
shared multi-process or independent-tamper-evidence claim.

## Acceptance

The implementation must retain executable evidence that:

- authenticated, anonymous, realtime, webhook, auth-code, asset, search,
  document, chat, report, and admin policies enforce their declared ceilings
  before expensive or side-effectful work;
- pre-auth decisions consume only the edge envelope, unverified credential
  claims never become durable identity, and the refined envelope is append-only
  and stage-auditable;
- spoofed forwarding headers, caller-selected bucket keys, authority changes,
  restart, clock rollback, high-cardinality input, and concurrent requests
  cannot bypass or multiply allowance;
- composed buckets and concurrency reservations commit all-or-none and release
  by fence across completion, crash, disconnect, stream abandonment, and job
  transfer;
- JS/Rust/SQLite/Postgres token-bucket vectors agree on rollback, saturation,
  refill, rounding, and overflow, while outer-key quotas bound resource-bucket
  allocation;
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
- concurrent scoped moderation decisions, expiry, appeal, and partial restore
  match the reducer golden vectors and stale CAS attempts never enter the
  authoritative set;
- required audit and privileged mutations commit together, edge audit capacity
  failures block the privileged action, and stale/bulk selectors cannot apply;
- external effects join LLP 0070 intent/idempotency/outcome receipts or remain
  explicit `ambiguous` nonclaims;
- secret, credential, payment, private-content, raw-provider, and network facts
  obey their redaction and access rules across rows, logs, diagnostics, exports,
  backups, and receipts;
- chain verification detects deletion, reorder, and mutation of a retained
  event while honestly reporting that same-operator replacement remains outside
  the base profile;
- retention, pseudonymization, legal hold, backup, destroy/replace, and restore
  preserve the declared policy and a pinned audit/case corpus, and an older
  backup cannot resurrect retired keys or sensitive facts; and
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
2. Which retention defaults are safe enough to ship without implying one
   jurisdiction's policy is universal?

The first profile stores only rotating keyed network-prefix digests, never raw
prefixes. Step 6 requires the honest same-operator retained-byte/segment
integrity profile; external checkpoint anchoring remains an independently
reported stronger capability.
