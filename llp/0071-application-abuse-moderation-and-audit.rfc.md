# LLP 0071: Application abuse, moderation, and audit

**Type:** RFC
**Status:** Draft
**Systems:** Abuse controls, Rate limits, Moderation, Audit, Auth, Runtime, Storage, Realtime, Admin, Privacy, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-20
**Revised:** 2026-08-08 (LLP 0204 commissioned the external-anonymous and
per-integration admission-key design, including the bounded declared-id ledger;
design only, with no implementation or capability claim — see the dated
amendment). 2026-07-26 (author-side review application: v1 now stages
pre/post-auth identity, atomically reserves composed limits, pins token-bucket,
network, high-cardinality, and response semantics, defines linear
per-subject moderation reduction and visibility frontiers, routes external
effects through durable work, segments audit with deletion manifests and
external restore/checkpoint authority, and splits the four lanes into
independently evidenced profiles. The RFC remains Draft and still requires
independent security/privacy review and executable evidence). 2026-07-20
(initial proposal for LLP 0063's hosted security foundation)
**Related:** LLP 0004, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0018, LLP 0031, LLP 0036, LLP 0047, LLP 0053, LLP 0055, LLP 0056, LLP 0060, LLP 0063, LLP 0070, LLP 0150, LLP 0204

## Summary

Snapback should provide one generated application-security layer for admission
rate limits, abuse signals, moderation workflows, and append-only audit facts.
The layer supplies primitives and enforceable boundaries; applications still
define community rules, moderator roles, appeal policy, and domain-specific
decisions.

The conjunction profile, `application-safety-single-tenant-v1`, targets one
trusted hosted application deployment and requires all four independently
evidenced component profiles:

- `application-admission-single-tenant-v1`: server-enforced request and
  operation limits keyed only from trusted identity facts;
- `application-signals-single-tenant-v1`: bounded abuse signals and versioned
  automated enforcement inputs;
- `application-moderation-single-tenant-v1`: durable reports, cases,
  decisions, appeals, content-state transitions, and authorization-aware
  invalidation; and
- `application-audit-privacy-single-tenant-v1`: a segmented redacted audit
  ledger, bounded retention, legal-hold/export/deletion seams, and restore
  reconciliation.

Chat and collaborative documents consume all four. Commerce consumes admission
and audit/privacy plus its payment-specific risk facts; it does not claim a
generic content-moderation lane merely because the platform implements one.
LLP 0063's platform-level safety claim remains red until the conjunction is
proved somewhere in the admitted hosted profile.

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

Identity is staged; authentication cannot be an input to the limit that
protects authentication itself.

The immutable **edge envelope** contains only app, database, deployment, target
profile, stream/restore epoch, directly observed peer/proxy facts,
route/function/operation class, connection id when already server-issued,
server request id, and one trusted receipt-time sample. Pre-authentication
limits use only this envelope.

A verified authentication transition appends either:

- principal, opaque authority instance, verified agent/scoped grant, and the
  authentication artifact/generation; or
- one coded anonymous/invalid outcome with no unverified token claims.

Post-authentication policies consume that refined envelope. The transition is
versioned and retained with each decision so audit identifies exactly which
facts existed. Caller-supplied user ids, role names, forwarding headers from an
untrusted peer, token claims before verification, and arbitrary bucket keys are
never admission authority.

Anonymous identity is deployment-scoped and combines a keyed digest of the
normalized network prefix with a rotating server epoch; it is intentionally
imperfect and must not be presented as person identity. Raw prefixes are never
stored in v1.

### Network derivation profile

The target descriptor pins trusted proxy identities/CIDRs, exact accepted
forwarding-header grammar, maximum hops, and rollout generation. The edge
walks the chain right-to-left, removes only attested trusted hops, rejects
multiple/conflicting headers, normalizes IPv4 and IPv4-mapped IPv6 to a `/24`
bucket and native IPv6 to `/56`, and otherwise uses the directly observed peer.
Keyed prefix digests rotate every 24 hours. Adjacent epochs overlap for charging
only: during the 10-minute overlap, the stricter remaining allowance from old
and new epoch applies, preventing a double budget; only the new digest is
returned for later decisions. Receipts retain derivation version and epoch,
never prefix or key.

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

The first algorithm is a database-durable token bucket plus leased concurrency
reservation. One generated admission transaction resolves one immutable
effective-policy version, canonicalizes every trusted key, reads one trusted
time sample, checks every composed bucket and ceiling, and either charges all
buckets plus creates one execution reservation or changes none. Rejected
requests consume only a separately declared low-cardinality defensive bucket;
they never partially charge ordinary component buckets. Completion, timeout,
stream disconnect, durable-job handoff, and crash expiry release the reservation
through a version/fence compare. Process-local limits are `Advisory` and cannot
satisfy hosted v1.

Token values are unsigned 64-bit microtokens. Capacity/refill declarations use
integer microtokens and microtokens per second. Elapsed trusted milliseconds
are clamped to `[0, 86_400_000]`; clock rollback yields zero refill and records
a degraded clock fact. Refill uses checked
`floor(elapsedMs * ratePerSecond / 1000)`, saturates at capacity, charges in
declared policy order inside the atomic transaction, and rounds public
`retryAfter` up to the next whole second. Restore advances a rate-limit epoch
outside the backup and reconciles timestamps before admission. Golden vectors
cover rollback, long downtime, saturation, overflow, simultaneous reservations,
and restore.

Limit configuration has hard platform ceilings. Application source may request
stricter values but cannot raise operator safety ceilings. Emergency operator
overrides are versioned, time-bounded, reasoned, audited, and visible in
capability reports.

Rate-limit responses do not disclose whether a protected resource exists or
which identity dimension triggered the limit. High-cardinality key admission is
bounded; unknown caller strings cannot create unlimited durable buckets.

A low-cardinality deployment/network or verified-principal outer bucket must
admit before any document/channel/order key is resolved or allocated. Each
policy pins a bucket quota, negative-cache TTL for missing resources, tombstone
window, and eviction order. At capacity, ordinary traffic fails closed while
separately bounded authentication-recovery and operator lanes remain available.
Public responses expose only `allowed` and a policy-coarsened retry bucket
(`soon`, `minute`, `later`); exact component remaining values, keys, and times
are scoped audited inspection facts.

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

Automated enforcement uses one canonical key over policy/version, target,
subject/resource, sorted input-signal digest, and enforcement generation.
Applying the same key is idempotent in the moderation transaction. A provider
correction or evidence retraction appends a new signal fact and schedules a new
evaluation; it never rewrites the old signal or silently retracts a decision.
Rule/model/provider identity and bounded confidence/provenance are mandatory
whenever an outcome is stronger than `observe`.

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

Each moderated subject/scope has one linear decision chain and monotonic
projection revision. A decision names the exact expected revision and commits
by CAS; a stale attempt is retained as an auditable rejected attempt but never
enters the chain. `restore` names the exact active decision it revokes; it
cannot clear unrelated restrictions. Expiry appends a generated expiry
decision under the same CAS rule. Appeals append a reviewed decision with
explicit authority and predecessor rather than mutating history.

Serving composes active chains from principal, room, resource, and content
scope with the fixed v1 precedence
`ban > suspend > remove > hide > lock > limitDistribution > label > noAction`.
An application may narrow visibility further but cannot reverse a stronger
scope. Equal-precedence decisions order by effective start, then canonical
decision-id bytes; end intervals never undo a later chain entry. Policy
migration appends an explicit migration decision. Golden vectors cover
concurrent hide/remove/restore, expiry, appeal, account-plus-room composition,
and stale moderator authority.

A moderation mutation appends its decision and updates the projected content or
principal state in one Snapback transaction. Generated read/write sets include
the policy and resource authorization facts. Realtime delivery publishes the
visibility change under LLP 0053 obligations. Search index, notification, asset,
and cache consumers receive durable follow-up jobs; until they acknowledge the
new policy version, public serving paths fail closed or recheck the authoritative
moderation projection.

Every authoritative chain update advances a generated visibility tuple
`(scopeKind, scopeId, projectionRevision, policyDigest, restoreEpoch)`.
Derived consumers retain the exact tuple they materialized and compare it
before release. Global policy changes emit bounded per-scope obligations or a
named rebuild fence. Externally delivered notifications and caches that cannot
be recalled report a typed non-recallable outcome; invalidation never claims to
undo prior delivery.

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

Each event carries deployment and stream/restore identity, server time,
request/job id, actor authority, generated type/version, redacted canonical
payload, partition/segment/sequence, previous event digest, and its own digest.
Canonical bytes use a closed UTF-8 JSON profile with sorted UTF-8 keys,
minimal integer notation, explicit absent-versus-null, and
`SHA256("snapback-audit-event-v1" || 0x00 || canonicalJson)`.

Partitions are generated bounded identities, never caller strings. Each is an
ordered sequence of bounded append-only segments. The database transaction
atomically allocates the next sequence and compares the prior digest. Rotation
seals a segment root and appends a continuity record to the next segment.
Completed roots and deletion manifests are copied under a monotonic sequence to
the external LLP 0072 control authority and a separately permissioned remote
object prefix; forked or skipped sequence fails verification. This is canonical
operation history and restore authority, but not independent tamper-proof
evidence because the same operator may control both credentials. A separately
administered checkpoint is reported only as a stronger opt-up capability.

Audit is mandatory—and intake failure blocks—for authority/session/grant
changes, secret/config metadata changes, money or fulfillment operations,
moderation decisions and evidence access, deploy/rollback/backup/restore/reset/
migration, privileged inspection/export, bulk/destructive actions, and audit
policy/hold/deletion changes. Required audit for a privileged database mutation
commits in the same transaction. Lower-severity deny/saturation samples may use
a bounded loss-reporting buffer with sequence/loss counters; they cannot satisfy
a mandatory event.

External effects execute only through LLP 0070 durable work: intent, mandatory
audit, and job enqueue commit together; provider idempotency and the fenced
outcome link the result. A boundary that cannot provide that contract reports
`ambiguous` and requires reconciliation. An intake event never proves the
effect completed. At capacity the system fails closed for privileged actions
and preserves a separately bounded operator-recovery partition.

Audit queries require explicit event-type and application scopes. Values with
secret, credential, raw payment, private message, document body, or unrestricted
provider payload classes are rejected before serialization. Diagnostic strings
are coded and bounded. Hashing a secret does not make it safe to retain.

## Privacy, retention, and subject rights

Every signal, report, case, decision, and audit type declares a retention class:
short operational, application policy, security, financial, or legal hold.
The v1 defaults are 7 days for short operational, 30 days for application
policy, and 90 days for security facts; source may choose a shorter compatible
window. Financial retention is delegated to the admitted commerce policy and
has no invented universal default. Legal hold is never a default. Targets
publish the effective windows and deletion behavior.

Segments keep stable non-sensitive tombstone facts while eligible sensitive
fields are encrypted under per-subject or per-retention-class data keys.
Expiry uses durable jobs to destroy keys or whole eligible segments, appends a
typed redaction/deletion event, and publishes a deletion manifest to the
external checkpoint authority. Chained bytes are never rewritten and an old
digest is never presented as verification of changed payload. Capability
reports distinguish retained-byte verification, segment continuity, deletion
manifest verification, and external checkpoint custody.

Application export projects only data the requesting subject is entitled to
receive; it does not expose other reporters, moderators' private notes, network
prefixes, security signals, or unrelated audit actors. Deletion requests
pseudonymize eligible actor/subject fields through key erasure or a new
redaction projection while preserving required stable tombstones. Legal hold is
an explicit privileged record with issuer scope, reason class, subject/resource
ceiling, start/review/expiry, renewal generation, release decision, and
export/notification policy. Expiry schedules reconciliation; it cannot silently
become permanent.

Privacy/retention authority lives outside the application backup and carries
deletion manifests, legal-hold generations, data-key generations, sealed audit
roots, and rate-limit/restore epochs. A restored target remains paused under a
new restore/stream epoch, reconciles that authority, reapplies required
erasure/pseudonymization and policy versions, opens a new audit segment linked
to the restore event, and proves stale clients, workers, exports, caches, and
backup-derived projections cannot republish retired facts before serving.

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
reason, expiry, and rollback/restore semantics. The dry-run binds
target/stream/restore epoch, schema/policy digest, one source and moderation
snapshot frontier, canonical selector bytes, ordered identity-set hash, and
actor authority generation. Apply revalidates actor authority and CASes each
subject at its reviewed revision; conflicts are reported without widening or
silently replacing the selection. There is no arbitrary SQL or "set user
banned" bypass behind the product API.

Report admission has per-reporter, per-subject, and cluster/dedup ceilings.
Report volume alone cannot cross a destructive automated-enforcement threshold.
Cases record moderator assignment, recusal/conflict state, and authority
generation; revocation removes claim authority before the next decision.
Applications may require dual control for declared destructive/bulk kinds, and
that rule becomes part of the generated CAS guard.

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
- `RemotelyCheckpointedSameOperator` for roots retained outside the application
  deployment under the same operator; and
- `IndependentlyCheckpointed` only when a separately administered authority
  attests roots and retention.

`application-safety-single-tenant-v1` requires all four component profiles,
durable enforcement on the admitted single-tenant target, and
`RemotelyCheckpointedSameOperator` audit/privacy custody. It makes no shared
multi-process or independent-tamper-evidence claim.

## Acceptance

The implementation must retain executable evidence that:

- authenticated, anonymous, realtime, webhook, auth-code, asset, search,
  document, chat, report, and admin policies enforce their declared ceilings
  before expensive or side-effectful work;
- pre-authentication and post-authentication envelopes never consume unverified
  claims, composed buckets and concurrency reserve all-or-none, and every
  completion/crash releases only its fenced reservation;
- spoofed forwarding headers, caller-selected bucket keys, authority changes,
  restart, clock rollback, high-cardinality input, and concurrent requests
  cannot bypass or multiply allowance;
- platform ceilings cannot be raised by app source and emergency overrides
  expire and remain visible;
- duplicate reports/signals are idempotent, automated policy is versioned, and
  an unknown score cannot silently ban or remove;
- concurrent moderation, stale CAS, exact restore, expiry, appeal, and
  cross-scope composition produce the golden linear-chain projection;
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
  reconcile the external manifests/keys/holds before serving and preserve the
  declared policy plus a pinned audit/case corpus; and
- the chat, document, and commerce pressure tests each exercise their relevant
  abuse and audit paths, not merely the generic unit corpus.

The retained receipt names target profile and identity, repository/artifact and
policy digests, trusted-proxy configuration class, effective ceilings,
concurrency/fault corpus, moderation fixtures, audit-chain roots, retention
windows, secret scan, and every nonclaim.

## Dated amendment: LLP 0204 external-anonymous admission (2026-08-08)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md), D1,
D7, and the OQ8 ruling.

**Status:** design amendment only. This section extends this Draft RFC's
admission contract; it does not claim an enforced admission profile, a durable
declared-id ledger, or any external-surface capability.

### External admission keys

Every LLP 0204 external call enters the staging model in
[§Trusted request identity](#trusted-request-identity) and is charged before
handler invocation under [§Admission rate limits](#admission-rate-limits).
The generated key families are:

- **granted integration:** server-resolved integration registration id, actor
  principal, effective principal, installation grant, and deployment/operation
  class;
- **external anonymous:** deployment/operation class plus the normalized,
  rotating network-evidence digest from
  [§Network derivation profile](#network-derivation-profile); and
- **declared:** deployment/operation class plus the normalized declared client
  id, backed by the corresponding ledger row.

The per-integration dimension is admitted only after credential, integration,
and installation resolution. A caller-supplied integration name/id is not a
trusted key, exactly as [§Trusted request identity](#trusted-request-identity)
rejects arbitrary bucket keys and unverified token claims. Integration and
principal budgets compose with the deployment/network floor and app ceiling;
none replaces them. All applicable buckets and concurrency reservations are
checked and charged atomically under the existing all-or-none transaction in
[§Admission rate limits](#admission-rate-limits).

The LLP 0031
[2026-08-08 `ExternalAnonymousApplicationData` response contract](./0031-server-route-taxonomy.spec.md#externalanonymousapplicationdata-contract)
is the response-side sibling of this admission class. External-surface
activation must refuse unless both the admission and response contracts are
installed; response classification alone never admits work.

### Declared tier

The declared tier is identification without authentication. Its client id is
one string with these closed requirements:

- at least 16 characters after the profile's pinned normalization;
- it contains a syntactically valid e-mail address under the profile's pinned
  parser; and
- the e-mail address is the contact carried by the id itself. There is no
  separate `contact` field and no inference that the caller controls the
  address.

Caller-chosen ids remain free-form within those requirements; they are
prefix-namespaced like LLP 0148 ids only when server-suggested.

A valid declared id conveys zero function authority: it reaches exactly LLP
0204 D1's external anonymous set. It receives a stable cooperative budget and
owner-visible attribution, but fresh ids start at a modest ceiling and age up
only through the declared policy's bounded schedule. Age, contact spelling,
and repeated use never become authentication facts, principal identity, or a
way to exceed the network floor.

The declared tier never reaches `ask`: compute requires a granted principal or
caller-key billing, per the LLP 0204 OQ8 ruling. Declared-tier refusals name the
caller's lane and the LLP 0150 escalation path, and the embedded contact channel
enables warn-before-block.

Declared budgets **compose with, and never replace, the external-anonymous
network-evidence floor**. The runtime reserves the low-cardinality network
bucket before resolving or allocating a declared-id bucket, then applies the
strictest composed result. Minting many syntactically valid ids therefore
cannot multiply the network allowance. This is the direct specialization of
the existing rule in [§Admission rate limits](#admission-rate-limits) that a
low-cardinality network/verified-principal outer bucket admits before a
high-cardinality caller string is resolved.

The rotating network-evidence digest is not part of the declared-bucket key:
the network floor is already charged separately by the reserve-network-first
rule. That separation makes the declared budget stable across the 24-hour
network-evidence digest rotation.

### Bounded pre-auth ledger

A declared-id usage row is pre-authentication state, never an account. The
ledger obeys the high-cardinality storage discipline already required by
[§Admission rate limits](#admission-rate-limits):

1. **Low-cardinality creation gate.** A network-evidence creation bucket must
   admit before the first row for an id can be allocated. Rejected requests do
   not create or refresh a row.
2. **Idle TTL.** Every row has a bounded idle deadline. Expiry evicts the row
   and resets its age-up state; later reuse starts fresh.
3. **Global per-app cap.** The total live declared-row count is capped
   independently of request-rate budgets. At the cap, a previously unseen id
   is refused from the declared tier before allocation; it cannot evict live
   rows merely by choosing another string. The ordinary anonymous lane remains
   subject to its own floor.
4. **Bounded shape.** The row retains only normalized id, first/last-seen
   times, age-policy generation, bounded counters, coded operator status, and
   network-evidence generation references. It retains no raw network prefix and
   no unbounded caller metadata.

Operator blessing or suspension changes cooperative treatment only. It does
not authenticate the string, remove the network floor, or prevent another
caller from presenting the same id.

### Upgrade creates a fresh identity

Moving from declared use to an integration never “claims” the string. The
upgrade ceremony issues a fresh authenticated, key-bound integration identity
under LLP 0055/0150. It does not transfer the declared row's budgets, age,
operator status, or authority. The old row may be attached to the new
integration only as explicitly **untrusted attribution** — useful for an owner
view or abuse investigation, never as proof of continuity or control absent
the demonstrated contact/operator proof LLP 0204 D7 names. Every subsequent
authorized call keys on the fresh server-issued integration and installation
facts, not on possession of the declared id.

This preserves the target document's existing boundary: unknown caller strings
cannot create unlimited durable buckets and cannot become trusted identity
facts merely because they have history
([§Trusted request identity](#trusted-request-identity),
[§Admission rate limits](#admission-rate-limits)).

## Non-goals and claim boundary

This RFC does not supply community policy, legal advice, machine-learning
moderation, perfect Sybil resistance, DDoS protection upstream of the target,
globally shared counters, independently tamper-proof logs, or multi-tenant
platform-operator access.

While this RFC is Draft, local counters, application tables, or ad hoc admin
routes cannot satisfy LLP 0063's production abuse-control gate. Maintainer
acceptance and a target-specific executable witness are both required.

## Decisions still requiring ratification

The 2026-07-26 author-side review application proposes the mandatory-event set
above; rotating keyed network-prefix digests with no raw-prefix retention; v1
7/30/90-day non-financial defaults; one linear decision chain per subject/scope
with fixed cross-scope composition; external effects only through LLP 0070; and
remote same-operator audit/privacy checkpoints as the base hosted floor without
an independent-tamper claim. It also proposes independent component profiles,
with the conjunction remaining the platform-level safety claim. These choices
are not accepted merely because they are written here. Independent
security/privacy review and maintainer ratification remain prerequisites before
implementation can satisfy LLP 0063.
