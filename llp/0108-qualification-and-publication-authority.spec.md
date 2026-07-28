# LLP 0108: Qualification and publication authority

**Type:** Spec
**Status:** Review
**Systems:** Auth, Wire Protocol, Capability publication, Storage, Realtime, Migrations, Deployment, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** —
**Related:** LLP 0037, LLP 0053, LLP 0058, LLP 0094, LLP 0099, LLP 0104, LLP 0105

## Summary

This Spec is the qualification and publication addendum to Accepted LLP 0058.
It defines the narrow authority by which an acceptance runner may exercise a
hidden candidate function generation, the data-isolation and replay rules for
that exercise, and the self-expiring claim family by which a standing
supervisor may publish the resulting capabilities. It also reconciles two
pre-existing registry drifts without revising Accepted text in place:

- `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` is an HTTP **400** protocol
  repair refusal, matching LLP 0094 and the implemented server. A client may
  retry only after changing its invalidation-protocol offer.
- `bounded_children_v1` and `write_activity_v1` remain `proposed` until the
  complete qualification and publication receipt exists. The publication CAS
  advances each to `experimental`; ordinary artifacts must acknowledge it
  under LLP 0058's existing experimental-capability rule.

Where this Spec conflicts with LLP 0058 on those two addendum-owned points,
this later Spec controls. It does not reopen LLP 0058's accepted ordinary
invocation, authentication, or invalidation design.

## 1. Closed capability-registry assignment

The code-owned `TargetCapabilityId` registry remains the sole authority for
spelling, support, and maturity. The current assignment is:

| Capability | Maturity before qualifying publication | Admission predicate |
| --- | --- | --- |
| `bounded_children_v1` | `proposed` | always unsupported outside a qualification grant |
| `write_activity_v1` | `proposed` | always unsupported outside a qualification grant |
| `inline_handler_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `registered_bundle_boot_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `result_contract_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `versioned_seed_install_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `versioned_seed_reset_v1` | `experimental` | target supports it and the artifact acknowledges it |
| all other currently registered ids | `stable` | target-specific support predicate is true |

Adding an id or changing any maturity is a code-and-document change with an
exhaustive registry test. For the two proposed ids, the only authorized
transition in this revision is `proposed -> experimental`, atomically with the
final publication CAS in §5. A failed or expired provisional publication
leaves them proposed. Promotion to stable requires a later ratified design and
evidence; elapsed time or successful demos are insufficient.

## 2. Qualification data identity and isolation

Every qualification grant binds a `QualificationDataIdentityV1`:

```text
{
  sourceDatabaseId,
  sourceStreamIncarnation,
  sourceSchemaSha256,
  sourceDurableHead,
  sourceBackupManifestSha256,
  isolatedDatabaseId,
  isolatedRestoreSha256,
  candidateGenerationSha256,
  candidateFunctionGraphSha256,
  candidateImageSha256,
  candidateLedgerSha256,
  targetProfileId,
  targetInstanceId
}
```

Before any candidate invocation, the supervisor creates a content-addressed,
read-back-verified backup of the active database and restores it into a new,
encrypted, disposable database or volume. It verifies the restored durable
head, complete schema, stream incarnation, and backup manifest. The candidate
schema and indexes are installed only in that isolated destination. All
candidate queries, mutations, live subscriptions, hidden rows, outbox entries,
and mutation journals are likewise confined to it.

The isolated destination:

- has no ordinary application listener, discovery record, retained-client
  fanout, or production backup membership;
- accepts only the exact candidate graph, target, grant, and use protocol
  defined here;
- is never renamed, attached, or copied into the production database; and
- is destroyed after a successful or refused qualification. If immediate
  destruction cannot be proved, it is quarantined without a listener under a
  supervisor cleanup operation whose terminal receipt records every volume,
  database, object, secret, process, and route removed.

Qualification promotion copies no application row, schema object, outbox
entry, or stream state. Immediately before publication CAS, the supervisor
re-reads the production database identity, schema digest, durable head,
active-generation digest, candidate image, function graph, and package ledger.
Schema or generation drift invalidates the candidate and requires a new
isolated restore and complete qualification.

Post-CAS public observation may write a schema-valid, idempotent witness row
through the now-active ordinary mutation route. That row is ordinary
application data: it must either remain valid under normal application
semantics or be removed by a separately authorized normal mutation. Capability
withdrawal never rolls back the active graph or secretly restores production
data.

## 3. Qualification grant and use protocol

`QualificationGrantV1` is the supervisor-signed `sqg1` compact grant defined by
LLPs 0094 and 0104. Its compact serialization is at most 8,192 bytes.
`QualificationUseV1` is a second compact, JCS-canonical object at most 2,048
bytes:

```text
{
  schemaVersion: 1,
  grantId,
  candidateGenerationSha256,
  operation,
  useIndex,
  useNonce,
  connectionId?,
  subscriptionId?,
  functionId?,
  requestBodySha256,
  issuedAt,
  expiresAt,
  keyId,
  signature
}
```

`operation` is exactly one of `connectionOpen`, `connectionReopen`, `query`,
`mutation`, or `liveSubscribe`. `useIndex` is an unsigned 16-bit integer.
`useNonce` is 16 random bytes in unpadded base64url. IDs, optionality, digest
grammar, and timestamps use the repository's existing strict generated
scalars. `connectionOpen` and `connectionReopen` omit `functionId`;
`liveSubscribe` requires both `connectionId` and `subscriptionId`; query and
mutation require `functionId`. No unknown member is accepted.

The use signature is made by an acceptance-device key already bound in the
grant over:

```text
"snapback-qualification-use-v1\0" || JCS(object without signature)
```

The sender-proof request digest also binds the byte-exact compact grant and use
carriers. A grant and use may therefore be replayed only as the identical
request described below, never transplanted between bodies, functions, routes,
targets, or candidate generations.

The grant contains independent maxima for connection opens, reopens, queries,
mutations, subscriptions, and server-emitted live frames. It also contains an
aggregate egress-byte ceiling and expiry no later than 30 minutes after issue.
The initial qualifying corpus fixes maxima at 2 opens, 2 reopens, 32 queries,
16 mutations, 8 subscriptions, 256 live frames, and 16 MiB aggregate egress.
A lower grant is valid; a higher grant is refused. Raising any maximum requires
a dated amendment and a fresh qualification corpus.

### 3.1 Gate and consumption order

The exact order is:

1. enforce transport size, route, paired-carrier, compact-version, and closed
   shape;
2. perform the route's ordinary sender proof and session/connection
   authentication. An ordinary-auth failure does not consume a use;
3. verify the grant and use signatures, audience, operation, binding, expiry,
   and ceilings;
4. durably reserve `(grantId, operation, useIndex)` together with the request
   digest before constructing qualification authority;
5. refine the ordinary immutable `PreparedAuthority` into the candidate-bound
   `PreparedInvocation`; and
6. evaluate, journal, bound, and return the candidate result.

After step 4, unknown function, authorization refusal, handler failure,
disconnect, timeout, concurrent loser, and result-contract failure all consume
the reserved use. None falls back to the active generation or a second auth
path. Connection open remains functionless and binds the qualification session
immutably into the returned connection token. A live subscribe still passes
the registered function gate.

The durable use journal has exactly `unused`, `reserved`, `terminal`, and
`expired` states. Reservation is a compare-and-swap. Exact replay of the same
carrier and request digest returns the retained terminal response without
reevaluation; a different request at the same key is a conflict. Terminal
responses are retained for at least 14 days, bounded by the ordinary response
ceiling and an aggregate 64 MiB per grant. Expired replay state is removed only
by a receipt-bearing GC operation.

Server-originated live frames have no new client carrier. Their replay key is
`(grantId, connectionId, subscriptionId, serverFrameIndex)`; a durable frame
reservation precedes evaluation/emission and consumes the live-frame and
aggregate-egress budgets.

### 3.2 Refusal registry and precedence

Ordinary authentication has precedence: an unauthenticated or unauthorized
caller receives the ordinary bounded auth refusal and learns nothing about a
candidate. After successful ordinary auth, qualification failures use the
standard error-envelope family:

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `SNAPBACK_QUALIFICATION_MALFORMED` | 400 | invalid size, shape, signature encoding, or duplicate carrier |
| `SNAPBACK_QUALIFICATION_UNSUPPORTED` | 400 | unknown compact or schema version |
| `SNAPBACK_QUALIFICATION_PAIR_REQUIRED` | 400 | exactly one of the paired carriers was supplied |
| `SNAPBACK_QUALIFICATION_ROUTE_FORBIDDEN` | 400 | a qualification carrier appeared on an unregistered route |
| `SNAPBACK_QUALIFICATION_REFUSED` | 403 | valid carrier lacks the exact target/function/operation authority |
| `SNAPBACK_QUALIFICATION_EXPIRED` | 403 | the grant or use is expired or not yet valid |
| `SNAPBACK_QUALIFICATION_REPLAY_MISMATCH` | 409 | a use key was replayed with different bytes or request digest |
| `SNAPBACK_QUALIFICATION_CANDIDATE_UNAVAILABLE` | 409 | the bound hidden generation is no longer installed |
| `SNAPBACK_QUALIFICATION_BUDGET_EXHAUSTED` | 429 | a per-operation, frame, or egress ceiling is exhausted |
| `SNAPBACK_QUALIFICATION_REPLAY_EXPIRED` | 410 | the retained exact-replay response was validly collected |
| `SNAPBACK_QUALIFICATION_STATE_UNAVAILABLE` | 503 | reservation state cannot be durably read or committed |

No diagnostic exposes candidate inventory, remaining budget, signature bytes,
or the existence of another hidden generation.

## 4. Provisional claim family

Qualification can authorize only a supervisor-generated publication
candidate. It cannot make an ordinary target claim true by itself. The
supervisor issues a signed family of claim carriers with:

```text
{
  familyId,
  familyEpoch,
  state: "provisional" | "final",
  candidateGenerationSha256,
  candidateLedgerSha256,
  publicationLedgerSha256?,
  targetProfileId,
  targetInstanceId,
  qualificationReceiptSha256,
  issuedAt,
  provisionalExpiresAt?,
  supervisorHead,
  signature
}
```

A provisional carrier expires no later than 120 seconds after issue. Targets
never persist it as self-authorizing state and refuse it after reboot until the
supervisor revalidates the current family epoch, head, time, target binding,
candidate, and ledger. Time uncertainty or inability to read the authoritative
family head withholds the capability. Finalization is a supervisor
compare-and-swap from that exact provisional epoch before expiry.

Every target caches only a verified family epoch and rechecks it:

- for query and mutation, at admission, mutation commit, and final HTTP send;
- for live, at subscribe, every rerun, and every final frame;
- for ephemeral state, at every publish, subscribe, delete, acknowledgement,
  snapshot, change, resync, drain, and frame;
- for migration, at admission, every durable batch, and immediately before
  publication.

An epoch change aborts a pre-publication operation. It closes affected live and
ephemeral sockets with the registered resync/refusal outcome. A migration that
has already reached `published-held` remains fenced and reconciles through its
separately authorized rollback or release; it never silently continues or
auto-unpublishes.

If the supervisor's withdrawal CAS fails, the target still stops honoring the
provisional claim at `provisionalExpiresAt`. Local self-expiry is therefore the
target-enforced safety cut. Withdrawal or expiry withholds only the named
capability family. It does not roll back the active function graph, production
data, or unrelated stable capabilities.

## 5. Publication CAS and ledgers

The release image embeds the digest of the immutable **candidate** package
ledger. It cannot embed a post-promotion ledger that does not yet exist. After
the exact candidate bytes are promoted, the supervisor supplies a canonical
publication-ledger extension whose `previousLedgerSha256` equals the embedded
candidate-ledger digest and whose nine package rows bind name, version,
candidate tarball SHA-256, registry integrity, registry tarball SHA-256, and
dist-tag observation.

The final CAS requires:

1. the exact isolated qualification receipt and all cleanup receipts;
2. a still-current source database/schema/generation proof;
3. the exact candidate image, function graph, target, and embedded candidate
   ledger;
4. both platform cold-install receipts and public-registry byte equality for
   all nine packages;
5. the hosted TLS, ephemeral, migration, operator, and cleanup receipts named
   by LLP 0105; and
6. a live provisional epoch whose target has revalidated it and whose expiry
   leaves enough time for the atomic transition.

The CAS appends the final claim, advances the two capability maturities from
`proposed` to `experimental`, and records the resulting capability-manifest
digest in one external supervisor transaction. Any missing or mismatched input
leaves the old family epoch and both maturities unchanged.

## 6. Acceptance

Acceptance requires committed, rerunnable evidence for:

- data isolation, including candidate DDL/writes/live output never appearing in
  production and cleanup after success, refusal, crash, and timeout;
- every gate-order and use-journal transition, exact replay, mismatched replay,
  retention/GC, concurrency, budget, and diagnostic row;
- ordinary-auth precedence and route closure over HTTP and socket entry points;
- provisional expiry across target reboot, supervisor partition, clock
  uncertainty, failed withdrawal CAS, and every in-flight recheck point;
- candidate-ledger embedding and final-ledger lineage across all nine packages;
- failed publication CAS leaving the active graph, database, claims, maturity,
  and registry observations unchanged; and
- successful publication making the two capabilities experimental only after
  all required receipts are current.

The implementation must place non-obvious gates and CAS boundaries under
`@ref LLP 0108` annotations. `./ref-check --verbose`, the generated wire-schema
gates, capability-registry equality tests, crash injection, and the complete
LLP 0104/0105 acceptance corpus gate landing.

## Status

**Review.** This Spec records the corrective design authorized on 2026-07-28
and entered the authorized super-refine loop on the same date.
It does not make either capability publishable and does not advance the status
of any related LLP. Review artifacts may recommend revision but cannot
ratify it.
