**Reviewer family:** GPT (author-side pass; not independent)
**Provider / runtime:** OpenAI Codex API agent
**Date:** 2026-07-26
**Redacted:** no
**Method:** manual

# Review of LLP 0071: Application abuse, moderation, and audit

This is an author-side critical pass over the committed Draft at Snapback
`828f359a0aaed7c7891058d36534d012a89f8f8e`. Because the draft is attributed
to Charlie Cheever / Codex, this review does **not** count as the independent
cross-family review appropriate for a security, privacy, and moderation
protocol.

## Overall assessment

The proposal has the right boundaries. It separates admission, signals,
moderation, and audit; refuses caller-selected authority; keeps application
policy outside the framework; and describes a deliberately narrow
single-tenant claim. The acceptance section is unusually honest about
evasion, invalidation, isolation, privacy, and recovery.

The core protocols are not yet deterministic enough to implement
interchangeably. Request identity is defined as complete before
authentication even though authentication itself needs pre-authentication
limits. Composed token buckets and concurrency limits do not have one atomic
reservation protocol. Moderation decisions lack a canonical reduction and
race rule. Audit retention, pseudonymization, and backup restore can break or
resurrect the hash chain the RFC promises to verify. Those are acceptance
blockers rather than implementation details.

## Strengths

- `## Separation of concerns` avoids treating a log, counter, classifier, or
  report as proof that the other safety lanes exist.
- `## Trusted request identity` correctly rejects forwarding headers from an
  untrusted peer and caller-chosen role, user, and bucket identities.
- `## Admission rate limits` puts enforcement before handler and side-effect
  boundaries and gives auth, webhook, upload, search, chat, report, and admin
  paths independent capacity.
- `## Abuse signals and enforcement` treats signals as evidence, pins policy
  versions, and prevents an unknown score from silently deleting or banning.
- `## Moderation model` makes decisions append-only and visibility a
  transactionally updated projection with authorization-aware invalidation.
- `## Audit ledger` does not call a same-operator digest chain tamper-proof and
  rejects secret-bearing payload classes before serialization.
- `## Privacy, retention, and subject rights` limits exports and moderator
  access rather than making audit a universal observability bypass.
- `## Non-goals and claim boundary` correctly withholds the hosted gate while
  the RFC and target witness are incomplete.

## Concerns

### Critical — request identity is circular around authentication

The RFC describes one closed identity envelope containing an authenticated
principal, then requires limits before authentication-code issuance and
expensive signature work. At that point no authenticated principal or trusted
authority instance exists yet. Conversely, accepting identity hints before
verification makes attacker-controlled claims admission authority.

Specify a staged envelope:

1. an edge envelope built only from target/deployment, directly observed
   transport facts, route class, server request id, and trusted receipt time;
2. pre-authentication limits over that envelope;
3. a verified-authentication transition that either adds a principal and
   authority instance or records a coded anonymous/invalid outcome; and
4. post-authentication limits over the refined envelope.

The transition must be append-only or versioned so audit and diagnostics show
which facts were available to each decision. Authentication failure must not
copy unverified token claims into a durable key or log.

### Critical — composed limits need one atomic reservation protocol

The strictest composed result may include several token buckets plus a
concurrency ceiling. Independent compare/updates can consume one bucket,
reject on another, and leak allowance; concurrent evaluators can also observe
different policy versions. A process crash can strand a concurrency slot.

Define a generated admission transaction that:

- resolves one immutable effective-policy version;
- canonicalizes and bounds every trusted key;
- checks all component buckets and ceilings against one trusted-time sample;
- commits all token charges and a leased execution reservation together, or
  commits none;
- returns one opaque decision without revealing the rejecting dimension; and
- releases or expires the execution reservation through a fenced completion
  protocol.

Pin whether rejected requests consume any defensive budget and how retries,
stream disconnects, durable jobs, and restored databases release slots. Add
fault tests at every charge/reservation/handler boundary.

### Critical — moderation state has no canonical reduction

`ModerationDecision` is immutable and may supersede another decision, but the
RFC does not define how concurrent `hide`, `remove`, `restore`, `suspend`,
expiry, and appeal decisions reduce to one `ContentModerationState`. Two
moderators can branch from the same predecessor; a late expiry can undo a
newer decision; and `restore` is ambiguous when multiple restrictions apply.

Require decisions to name an expected projection revision and commit through
a CAS. Define either a single linear decision chain per moderated subject or
a deterministic lattice with precedence. Pin:

- decision ordering and tie-breaking;
- whether restore revokes one named decision or all eligible restrictions;
- composition across content, account, room, and distribution restrictions;
- effective-interval activation and expiry;
- appeal outcomes and superseding authority;
- policy-version migration; and
- the exact projection reducer with golden vectors.

Rejected stale decisions should remain auditable attempts but must not enter
the authoritative decision chain.

### Critical — deletion and pseudonymization conflict with the audit chain

Each audit digest covers its canonical payload and the previous event digest.
Deleting an expired event or mutating actor/subject fields for
pseudonymization invalidates every later digest. Keeping the old digest while
changing the payload proves only that retained bytes no longer match it.

Choose an executable retention design. One viable shape is:

- bounded append-only segments with canonical encoding and explicit partition
  identity;
- sealed segment roots linked by continuity records;
- sensitive fields encrypted under per-subject or per-retention-class data
  keys while non-sensitive tombstone facts remain stable;
- cryptographic erasure or a typed redaction event instead of rewriting
  chained bytes; and
- a deletion manifest that proves which sealed segments or keys were retired
  under which policy without pretending the deleted payload is verifiable.

The capability report must say whether verification covers retained event
bytes, segment continuity, deletion manifests, or an external checkpoint.

### Critical — backup and restore can resurrect expired sensitive data

The acceptance section requires retention and pseudonymization to survive
backup, destroy/replace, and restore, but the design says only that expiry is
a durable job. Restoring an older snapshot can reintroduce expired reports,
network facts, private evidence, revoked holds, and erased key material.

Define a non-rollbackable privacy/retention authority or restore reconciliation
protocol. Before a restored target serves traffic it must:

- enter a new restore/stream epoch and remain paused;
- reconcile deletion manifests, legal holds, encryption-key generations, and
  policy versions from authority not rolled back with the snapshot;
- reapply required erasure/pseudonymization;
- open a new audit segment linked to the restore event; and
- prove stale clients, workers, exports, and backups cannot republish retired
  facts.

A restore receipt that merely matches the old fixture is insufficient for the
privacy claim.

### Major — high-cardinality defense needs an allocation order

Generated dimensions can still contain attacker-selected document, channel,
order, report, or login identifiers. Persisting a durable bucket before
proving that the resource exists lets random keys exhaust storage; checking
resource existence first may itself be the expensive operation the limiter is
supposed to protect.

Require a low-cardinality outer bucket (network epoch, verified principal, or
deployment-scoped anonymous class) before allocating a resource bucket. Pin
per-policy key quotas, missing-resource negative caching, eviction/tombstone
rules, and overflow behavior. At capacity, fail closed for ordinary traffic
while preserving separately bounded auth-recovery and operator lanes.

### Major — token-bucket time and numeric semantics are not portable

“Server-time token bucket” does not pin trusted-time source, rollback
handling, precision, saturation, rounding, refill after long downtime, or
numeric overflow. SQLite, Postgres, and a provider limiter can therefore grant
different allowance.

Specify integer units, maximum elapsed refill interval, monotonic clamp,
rollback behavior, comparison order, retry-after rounding, and golden vectors.
Restore must advance a rate-limit epoch or reconcile timestamps before
admission. Wall-clock changes must never mint extra capacity.

### Major — network-prefix derivation needs a deployment contract

A “configured, validated trusted-proxy chain” is too open-ended for security
conformance. Pin trusted hop identities/CIDRs, accepted header grammar,
right-to-left hop removal, IPv4/IPv6 normalization and prefix lengths,
multi-header rejection, direct-peer fallback, and configuration rollout.

Rotating anonymous digests also need overlap semantics: a client must not gain
two full buckets at every epoch boundary, while epochs must not become stable
cross-period tracking identifiers. The receipt should name derivation version
and epoch duration, not raw prefixes or salts.

### Major — automated enforcement idempotency and retraction are incomplete

The RFC records policy version and signal ids but not one stable enforcement
identity. Duplicate/reordered signals or a classifier retry can produce
multiple restrictions. A provider correction or evidence deletion can leave a
decision whose declared inputs no longer exist.

Define a canonical enforcement key over policy, subject/resource, input-set
digest, and generation. Applying it must be idempotent in the moderation
transaction. Signal correction/retraction should append facts and trigger a
new policy evaluation; it must not rewrite history. Provider confidence,
model/rule identity, and provenance need typed bounded fields when they affect
anything beyond `observe`.

### Major — downstream fail-closed frontiers are not specified

Search, notifications, assets, and caches must acknowledge a new moderation
policy version, but no common frontier identifies which subject/resource and
version a serving path must compare. A global policy version can unnecessarily
black out the product; a resource-only version can miss account or room
restrictions.

Define a generated visibility authority tuple and monotonic frontier for each
affected scope. Every derived consumer must retain the frontier it materialized
and compare it with authoritative state before release. Notifications already
sent and externally cached assets need explicit revocation/non-recallable
outcomes rather than a claim that invalidation can undo delivery.

### Major — mandatory audit and external effects need outbox linkage

“Audit intake succeeds before the action” records intent but does not prove
whether an external effect happened. A crash after audit but before the effect,
or after the effect but before its outcome record, creates ambiguity.

Route external effects through LLP 0070 durable work with a stable operation
id, transactional intent/audit enqueue, provider idempotency, and a fenced
outcome record. Direct effects that cannot offer this must declare an
`ambiguous` disposition and manual reconciliation. The audit ledger must not
turn a recorded attempt into evidence of a completed effect.

### Major — audit ordering and partition lifecycle are incomplete

Concurrent appenders need an atomic sequence/CAS rule for the previous digest.
Partitions need a canonical key, genesis record, encoding, rotation/sealing,
retention, and restore behavior. Otherwise adapters can produce incomparable
chains or forks while all claiming conformance.

Pin canonical bytes, hash and framing, sequence allocation, allowed partition
keys, segment sealing, root custody, and fork detection. Include golden vectors
and concurrency/fault injection. A reserved recovery lane also needs an
independently bounded partition or quota so ordinary audit volume cannot fill
the storage it relies on.

### Major — bulk moderation selectors need snapshot authority

An exact result count/hash and “same-version apply” do not define which
snapshot, query plan, authorization set, or moderation projection was hashed.
Rows can change after dry-run, and the operator’s scope can be revoked.

Bind dry-run to a target/stream/restore epoch, schema and policy digest,
snapshot/version frontier, canonical ordered identity set, selector bytes, and
actor authority generation. Apply must revalidate actor authority and CAS each
row against the reviewed revision, reporting partial conflicts without
silently widening the selection.

### Moderate — reporter abuse and moderator conflicts need explicit policy

Duplicate-report idempotency alone does not prevent coordinated reporting from
creating unlimited cases or influencing automated enforcement. Report
admission needs per-reporter and per-subject bounds, cluster/dedup rules, and a
guarantee that report volume alone cannot cross a destructive threshold.

Moderator assignment also needs conflict/recusal state, dual control for
especially destructive or bulk actions if the application declares it, and
clear behavior when a moderator’s authority is revoked during an open case.

### Moderate — response metadata may leak the composed key

Even without naming the triggered dimension, exact `remaining` and
`retryAfter` values can let a caller distinguish resource existence or another
principal’s shared bucket. Define public versus privileged decision views.
Public responses should expose only policy-safe coarsened retry information;
full component state belongs in scoped, audited inspection.

### Moderate — legal hold needs a durable authority and expiry workflow

A “time-reviewed” hold is not an executable lifecycle. Define issuer scope,
reason class, subject/resource ceiling, start/review/expiry times, renewal,
release, notification/export behavior, and precedence over ordinary retention.
Expired holds should trigger reconciliation, not silently keep data forever.

## Suggestions

1. Split the implementation contract into four independently claimed profiles:
   admission, signals/enforcement, moderation, and audit/privacy; keep
   `application-safety-single-tenant-v1` as their conjunction.
2. Add normative state/transaction tables for identity refinement, admission
   reservation, moderation reduction, audit append/seal, retention, and
   restore reconciliation.
3. Build one deterministic reference model for token buckets and moderation
   reduction, then run every storage adapter against shared golden vectors and
   fault schedules.
4. Make the pressure-test apps contribute adversarial fixtures to the common
   suite rather than each inventing private safety semantics.
5. Keep same-operator chain integrity and externally anchored integrity as
   separate capability claims exactly as the RFC currently intends.

## Open questions for the author

1. Which durable authority survives a target restore and owns deletion
   manifests, legal holds, audit segment roots, and rate-limit epochs?
2. Is moderation projection a single linear chain per subject or a
   deterministic composition of independently scoped restrictions?
3. Which external effects, if any, may execute without LLP 0070 durable-work
   intent/outcome linkage?
4. Does the Step 6 minimum require all four lanes, or may a vertical admit
   narrower lane profiles while the platform-level safety claim remains red?

## Recommended next step

Revise and remain `Draft`. First close staged identity, atomic admission,
moderation reduction, audit retention/chain integrity, and restore privacy.
Then obtain an independent non-GPT security review and a privacy/retention
review before the author considers `Accepted`.
