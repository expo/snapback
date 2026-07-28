# LLP 0113: Qualification and publication authority

**Type:** Spec
**Status:** Review
**Systems:** Auth, Wire Protocol, Capability publication, Storage, Realtime, Migrations, Deployment, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-28
**Revised:** 2026-07-28 (unreviewed post-corrective-round reconciliation:
live-subscribe use transport, non-recursive sender-proof binding, total durable
replay, ten-minute device-bound grants, production-schema identity,
observation-principal provisional activation, static experimental maturity,
purpose-limited service intermediates, and publication-request authority).
2026-07-28 (publication evidence reconciliation: the final package-ledger
extension retains a closed, API-reopened GitHub matrix identity and two
artifact identities/digests; producers measure clean checkout provenance and
the publication authority consumes a fresh challenge-bound acquired head)
**Related:** LLP 0037, LLP 0053, LLP 0058, LLP 0094, LLP 0099, LLP 0110, LLP 0111

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
- `bounded_children_v1` and `write_activity_v1` have a static code-owned
  `experimental` maturity. That maturity is not a support fact: runtime support
  remains false until a target verifies the exact final claim family defined
  here, and ordinary artifacts must acknowledge both ids under LLP 0058's
  existing experimental-capability rule.

Where this Spec conflicts with LLP 0058 on those two addendum-owned points,
this later Spec controls. It does not reopen LLP 0058's accepted ordinary
invocation, authentication, or invalidation design.

## 1. Closed capability-registry assignment

The code-owned `TargetCapabilityId` registry remains the sole authority for
spelling, support, and maturity. The current assignment is:

| Capability | Static maturity | Runtime support predicate |
| --- | --- | --- |
| `bounded_children_v1` | `experimental` | exact final `relationActivity` family is verified, unexpired, and acknowledged; during provisional observation, only the bound observation principal is admitted |
| `write_activity_v1` | `experimental` | exact final `relationActivity` family is verified, unexpired, and acknowledged; during provisional observation, only the bound observation principal is admitted |
| `inline_handler_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `registered_bundle_boot_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `result_contract_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `versioned_seed_install_v1` | `experimental` | target supports it and the artifact acknowledges it |
| `versioned_seed_reset_v1` | `experimental` | target supports it and the artifact acknowledges it |
| all other currently registered ids | `stable` | target-specific support predicate is true |

Adding an id or changing any maturity is a code-and-document change with an
exhaustive registry test. The implementation at the start of this revision
still reports these two ids as `proposed` and hard-codes support false; that is
an implementation gap, not the target contract. The code change that
implements this Spec makes the maturity constants `experimental` before any
qualification run while leaving the runtime predicate false. Publication CAS
changes only the verified runtime-support fact, never the maturity constant.
A failed, withdrawn, or expired claim therefore leaves the ids statically
experimental but unsupported. Promotion to stable requires a later ratified
design and evidence; elapsed time or successful demos are insufficient.

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
head, complete schema, stream incarnation, and backup manifest. The qualifying
candidate's physical schema digest must equal the active production schema
digest byte for byte. The first qualifying publication admits no
candidate-only DDL, index, table, column, or backfill.

For a later candidate that needs a physical-schema change, that change rides
the ordinary approved migration and activation machinery first. Only after
the production migration is terminal and independently verified may the
supervisor take the qualification backup. The restored schema must then equal
the migrated production schema. “Candidate schema is isolated” means that a
restore never mutates production; it does not authorize transferring DDL from
the disposable database during promotion. All candidate queries, mutations,
live subscriptions, hidden rows, outbox entries, and mutation journals are
confined to the disposable destination.

The isolated destination:

- has no ordinary application listener, discovery record, retained-client
  fanout, or production backup membership;
- accepts only the exact production-schema-identical candidate graph, target,
  grant, and use protocol defined here;
- is never renamed, attached, or copied into the production database; and
- is destroyed after a successful or refused qualification. If immediate
  destruction cannot be proved, it is quarantined without a listener under a
  supervisor cleanup operation whose terminal receipt records every volume,
  database, object, secret, process, and route removed.

Qualification promotion copies no application row, schema object, outbox
entry, or stream state. Immediately before provisional activation CAS, the
supervisor re-reads the production database identity, schema digest, durable
head, active-generation digest, candidate image, function graph, and package
ledger. The production schema must still equal the schema in
`QualificationDataIdentityV1`. Schema or generation drift invalidates the
candidate and requires a new isolated restore and complete qualification; it
can never be repaired by copying from the disposable destination.

Post-CAS public observation may write a schema-valid, idempotent witness row
through the now-active ordinary mutation route. That row is ordinary
application data: it must either remain valid under normal application
semantics or be removed by a separately authorized normal mutation. Capability
withdrawal never rolls back the active graph or secretly restores production
data.

## 3. Qualification grant and use protocol

`QualificationGrantV1` is a closed JCS object carried as
`sqg1.<key-id>.<payload-b64url>.<signature-b64url>`, at most 8,192 bytes:

```text
{
  schemaVersion: 1,
  grantId,
  audience: "snapback-qualification",
  issuerInstallationId,
  supervisorHead,
  targetProfileId,
  targetInstanceId,
  sourceDataIdentitySha256,
  candidateGenerationSha256,
  candidateFunctionGraphSha256,
  candidateImageSha256,
  candidateLedgerSha256,
  predecessorActiveGenerationSha256,
  acceptanceSubjectId,
  acceptanceSessionId,
  acceptanceDeviceKeyId,
  acceptanceDevicePublicKeySha256,
  acceptanceDeviceRevocationGeneration,
  publicOrigin,
  allowedFunctionIds,
  maxConnectionOpens,
  maxConnectionReopens,
  maxQueries,
  maxMutations,
  maxSubscriptions,
  maxLiveFrames,
  maxEgressBytes,
  activationNonce,
  issuedAt,
  notBefore,
  expiresAt,
  keyId,
  signature
}
```

The grant is signed by a currently valid `qualification-grant` service
intermediate from §4.1 over:

```text
"snapback-qualification-grant-v1\0" || JCS(object without signature)
```

`keyId` must equal both the compact prefix and the service-intermediate id.
`activationNonce` is 32 random bytes in unpadded base64url.
`acceptanceDevicePublicKeySha256` is the SHA-256 of the canonical Ed25519
public-key bytes named by `acceptanceDeviceKeyId`; the revocation generation is
the exact supervisor device-registry generation at grant issuance. Function ids
are a sorted, duplicate-free, nonempty closed list. Timestamps are
UTC RFC 3339 with exactly millisecond precision. The grant interval satisfies
`issuedAt <= notBefore <= expiresAt <= issuedAt + 10 minutes`; it cannot be
extended or renewed. The initial corpus fixes the maxima at 2 opens, 2
reopens, 32 queries, 16 mutations, 8 subscriptions, 256 live frames, and
16 MiB aggregate egress. A lower grant is valid; a higher grant is refused.
Raising a maximum or the ten-minute lifetime requires a dated amendment and a
fresh qualification corpus.

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
scalars. No unknown member is accepted. The closed field matrix is:

| Operation | Grant carrier | `connectionId` | `subscriptionId` | `functionId` | Use carrier |
| --- | --- | --- | --- | --- | --- |
| `connectionOpen` | required beside use | forbidden | forbidden | forbidden | closed `qualificationUse` open-body member |
| `connectionReopen` | required beside use | required | forbidden | forbidden | closed `qualificationUse` open-body member |
| `query` | required beside use | forbidden | forbidden | required | `Snapback-Qualification-Use` HTTP header |
| `mutation` | required beside use | forbidden | forbidden | required | `Snapback-Qualification-Use` HTTP header |
| `liveSubscribe` | **forbidden**; inherited from the connection grant | required | **forbidden**; the server assigns it after reservation | required | `Snapback-Qualification-Use` HTTP header or the closed socket subscribe frame's `qualificationUse` member |

For `liveSubscribe`, the connection token is already immutably bound to the
byte-exact qualification grant. The client therefore presents a signed use
only. A use on an ordinary connection, a grant carrier on live subscribe, a
missing use on a qualification-bound connection, or a use whose
`connectionId` differs from the bound connection refuses before function
lookup. After durable use reservation the server allocates
`subscriptionId`; the terminal journal record binds that id to the use key.
No client predicts or signs a subscription id. Server-originated frames use
the separate frame key below and carry neither grant nor use.

The use signature is made by an acceptance-device key already bound in the
grant over:

```text
"snapback-qualification-use-v1\0" || JCS(object without signature)
```

`requestBodySha256` is non-recursive. For a JSON HTTP body it is SHA-256 over
JCS of the successfully decoded body after removing the top-level
`qualificationGrant` and `qualificationUse` members. For a socket subscribe it
is SHA-256 over JCS of the frame after removing only `qualificationUse`.
Header-carried requests have no carrier members to remove. An empty body uses
SHA-256 of the empty byte string. A body that is not valid for its ordinary
route never reaches qualification diagnostics.

The route's existing sender proof separately commits, in this exact order, to
the ASCII method, canonical route template, exact registered `functionId` or
the empty string, `requestBodySha256`, SHA-256 of the byte-exact compact grant
or the inherited connection-bound grant digest, and SHA-256 of the byte-exact
compact use. The domain prefix is
`"snapback-qualification-sender-binding-v1\0"`. The carrier-stripped body
digest is never substituted for these carrier, method, route, or function
bindings. A grant and use can therefore be replayed only as the identical
request described below, never transplanted between bodies, functions, routes,
targets, or candidate generations.

At grant issuance the device key must be active and its current revocation
generation must equal the recorded generation. For a new reservation those
facts are checked again. A later device revocation blocks a new reservation
with `SNAPBACK_QUALIFICATION_REFUSED`; it may not cancel a committed isolated
mutation. During reconciliation, an unstarted reserved attempt becomes a
terminal refusal, while a durably committed attempt is settled to its retained
terminal response. Exact replay after grant expiry remains available as
described below, but exact replay after device revocation returns the ordinary
device-revoked refusal and does not disclose retained response bytes.

### 3.1 Gate and consumption order

Qualification has one authoritative diagnostic and state order:

| Order | Check or transition | Failure/result |
| ---: | --- | --- |
| 0 | enforce only the route's generic transport byte/time ceiling, without decoding or naming qualification | ordinary generic transport refusal |
| 1 | perform ordinary route classification, sender proof, session/connection authentication, and ordinary authorization | ordinary refusal; no qualification code and no use consumption |
| 2 | decode the route-specific carrier shape; verify closed grant/use syntax and signatures, immutable audience/target/device/operation/sender bindings | the applicable authenticated qualification 400/403 refusal |
| 3 | read `(grantId, operation, useIndex)` from the durable journal and compare the full carrier and sender-binding digests | mismatch → 409; `terminal` → retained response; `expired` → 410; `reserved` → reconciliation below |
| 4 | for an absent (`unused`) key only, check current grant/use time, device revocation, candidate availability, and every counter/egress ceiling | 403, 409, or 429; no reservation |
| 5 | CAS `unused -> reserved`, atomically reserving the operation counter and a stable attempt id | loser re-enters at order 3 |
| 6 | refine the immutable ordinary `PreparedAuthority` into the candidate-bound `PreparedInvocation`, execute under the stable attempt id, and atomically settle `reserved -> terminal` | terminal success or bounded terminal refusal |

Thus qualification-specific parse details are never emitted before ordinary
authentication. Implementations may inspect a bounded prefix before order 1
only to enforce generic transport limits; they retain the result and diagnose
it after order 1. For a journal key already `terminal`, byte-exact replay
returns the retained response even after grant/use expiry and without
reevaluation. Current expiry applies only to a new reservation. After
receipt-bearing collection changes that exact key to `expired`, the same replay
returns 410. A different carrier or sender binding at any existing key always
returns 409 before expiry or candidate checks.

After reservation, unknown function, authorization refusal, handler failure,
disconnect, timeout, concurrent retry, and result-contract failure all consume
the use and settle a bounded terminal response. None falls back to the active
generation or a second auth path. Connection open remains functionless and
binds the qualification session immutably into the returned connection token.
A live subscribe still passes the registered function gate before its
server-assigned subscription id is committed.

The durable use journal has exactly `unused` (row absent), `reserved`,
`terminal`, and `expired` states. A `reserved` row contains the full request
and carrier digests, stable attempt id, operation-specific effect-fence id,
source durable head/read snapshot, lease owner, lease deadline, and reserved
counter/egress amounts. Execution effects and their operation-specific outcome
record share a transaction or an idempotency fence with that attempt id:

- connection open/reopen commits the connection lineage and outcome together;
- mutation commits the isolated mutation journal, outbox, and outcome together;
- query resumes from the retained read snapshot and stores its bounded response
  before releasing that snapshot;
- live subscribe commits the allocated subscription id, initial snapshot, and
  outcome together; and
- a live frame commits its frame index, retained bytes, and budget debit
  together.

After a crash, a worker may take over only by CAS after the lease deadline. It
then inspects the effect fence. `notStarted` resumes the same attempt;
`committed` reconstructs and stores the exact terminal response; `refused` or
`aborted` stores the corresponding terminal refusal. `ambiguous` never
re-executes: it stores `SNAPBACK_QUALIFICATION_STATE_UNAVAILABLE`, quarantines
the candidate, and requires a fresh candidate/grant after cleanup. A live
lease returns the same bounded state-unavailable response and invites exact
retry. There is no transition that leaves a use permanently reserved.

Terminal responses are retained for at least 14 days, bounded by the ordinary
response ceiling and an aggregate 64 MiB per grant. A receipt-bearing GC
changes `terminal -> expired`, erases response bytes, and retains the key,
carrier/sender-binding digests, terminal-response digest, and GC receipt for
another 30 days so exact replay deterministically returns 410. Final deletion
is allowed only after the ten-minute grant is expired and that tombstone
window has elapsed; any later presentation is an expired new request and
cannot execute.

The disposable database is not the replay authority. Before its cleanup, every
terminal journal record and bounded response is atomically exported to
`SupervisorQualificationReplayStoreV1`, an external supervisor store encrypted
at rest with an installation-scoped replay key and authenticated per-record
associated data `(installationId, targetInstanceId, grantId, operation,
useIndex, carrierDigest, senderBindingDigest)`. Only the qualification
reconciler may write; only the ordinarily authenticated exact replay path may
read; list, scan, and ordinary app access are forbidden. The store enforces
the same 64 MiB per-grant quota, 14-day response retention, 30-day tombstone
retention, receipt-bearing GC, key rotation, backup exclusion, and
destroy-or-quarantine cleanup. Encrypted replay records are the one explicit
cleanup exception to destruction of the isolated destination.

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
| `SNAPBACK_QUALIFICATION_PAIR_REQUIRED` | 400 | required carrier shape is incomplete: one member of a required pair, or no use on a qualification-bound live subscribe |
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
supervisor issues a closed `CapabilityClaimFamilyV1`:

```text
{
  schemaVersion: 1,
  familyId,
  familyKind,
  familyEpoch,
  state: "provisional" | "final" | "withdrawn",
  claimIds,
  candidateGenerationSha256,
  activeGenerationSha256,
  candidateFunctionGraphSha256,
  candidateImageSha256,
  candidateLedgerSha256,
  publicationLedgerSha256?,
  targetProfileId,
  targetInstanceId,
  qualificationReceiptSha256,
  provisionalObservationPrincipalSha256?,
  publicObservationReceiptSha256?,
  publicationRequestId,
  publicationRequestSha256,
  issuedAt,
  notBefore,
  expiresAt,
  supervisorHead,
  keyId,
  signature
}
```

`familyKind` and `claimIds` form one closed union:

| `familyKind` | Exact sorted `claimIds` |
| --- | --- |
| `relationActivity` | `bounded_children_v1`, `write_activity_v1` |
| `hostedEphemeral` | `ephemeralHostedAdapter` |
| `migration` | `container-vm-migration-executor.v1` |

No other family or claim spelling is accepted. `provisional` requires
`provisionalObservationPrincipalSha256` and forbids
`publicObservationReceiptSha256` and `publicationLedgerSha256`; `final`
forbids the observation-principal digest and requires the public-observation
receipt and publication ledger; `withdrawn` forbids both observation fields
and is a deny fact only. Provisional and final claims require every candidate,
graph, image, ledger, target, request, and receipt member. A withdrawn claim
retains those members to identify exactly what it cuts.

The claim is signed by a current `capability-publication` service intermediate
over:

```text
"snapback-capability-claim-family-v1\0" ||
JCS(object without signature)
```

`familyEpoch` is a positive JS-safe integer allocated monotonically per
`(targetInstanceId, familyKind)`. `supervisorHead` and
`publicationRequestSha256` are exact CAS expectations, not advisory
attribution. Timestamps use the grammar in §3. A provisional carrier expires
no later than 120 seconds after issue. A final carrier is a renewable lease
that expires no later than ten minutes after issue; the supervisor normally
renews at five minutes by a new family-head CAS. `withdrawn` is retained as a
monotone deny head. Inability to renew or withdraw therefore still has a
target-enforced cut: the target self-withholds at the last final `expiresAt`.

Targets never persist a carrier as self-authorizing state and refuse a
provisional or final carrier after reboot until the supervisor revalidates the
current family epoch, head, time, target binding, candidate, ledger, signer,
and service-intermediate revocation generation. Time uncertainty or inability
to read the authoritative family head withholds the capability. Finalization
is a supervisor compare-and-swap from the exact provisional epoch before
expiry; it cannot mint a new candidate, request, principal, or receipt.

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
provisional claim at its 120-second `expiresAt`, and a final claim at its
ten-minute `expiresAt`. Local self-expiry is therefore the target-enforced
safety cut. Withdrawal or expiry withholds only the named capability family.
It does not roll back the active function graph, production data, or unrelated
stable capabilities.

### 4.1 Purpose-limited service intermediates

The installation's offline root never signs online grants, claims, deadlines,
admissions, or responses directly. It certifies closed
`SupervisorServiceIntermediateV1` objects:

```text
{
  schemaVersion: 1,
  installationId,
  intermediateKeyId,
  publicKeyEd25519,
  purpose,
  serial,
  revocationGeneration,
  issuedAt,
  notBefore,
  expiresAt,
  rootKeyId,
  signature
}
```

`purpose` is exactly one of `operator-enrollment`, `qualification-grant`,
`capability-publication`, `migration-deadline`, `hosted-admission`, or
`supervisor-response`. One key has one purpose. `serial` and
`revocationGeneration` are positive JS-safe integers; public keys are the
canonical 32 Ed25519 bytes in unpadded base64url. The interval is at most seven
days and cannot be extended. The root signature is:

```text
"snapback-supervisor-service-intermediate-v1\0" ||
JCS(object without signature)
```

The verifier requires the pinned installation/root id, current or explicitly
overlapping root key, exact purpose, current serial/revocation generation,
valid time, and a non-revoked intermediate. Rotation is a new certificate and
key. A maximum 24-hour overlap admits both exact serials while issuance uses
only the successor; after overlap the predecessor refuses. Revocation advances
the purpose's external monotone generation and immediately prevents new
objects. Existing claim leases still self-expire at their own short
`expiresAt`; targets recheck the intermediate generation at every family-epoch
boundary. LLP 0111 owns the two-of-three issuance/renewal/unsealing ceremony,
encrypted online key custody, zeroization, rotation journal, and recovery
commands. This Spec owns the certificate and verification contract.

Every service-signed object is closed, includes `schemaVersion`, `keyId`,
`issuedAt`, `notBefore`, `expiresAt`, its immutable installation/target/
audience bindings, and a distinct domain prefix:

| Object | Required purpose | Signature domain |
| --- | --- | --- |
| `QualificationGrantV1` | `qualification-grant` | `snapback-qualification-grant-v1\0` |
| `CapabilityClaimFamilyV1` | `capability-publication` | `snapback-capability-claim-family-v1\0` |
| `MigrationDeadlineV1` | `migration-deadline` | `snapback-migration-deadline-v1\0` |
| `HostedAdmissionV1` | `hosted-admission` | `snapback-hosted-admission-v1\0` |
| `SupervisorResponseV1` | `supervisor-response` | `snapback-supervisor-response-v1\0` |

A verifier never accepts one purpose or domain in another row. Service
intermediates attest an already-authorized supervisor transition; they cannot
create operator authority, approve a request, alter a retained request body,
or bypass the publication-request gate.

### 4.2 Publication request authority

Publication transitions consume the closed `SupervisorRequestV1` variants and
scopes owned by LLP 0111:

| Transition | Request variant | Required scope and retained authority |
| --- | --- | --- |
| plan and confirmation | `capability.publication.plan` then `.confirm` | `capability.publish`; exact confirmed deploy approval, target head, candidate, all three family payloads, receipt vector, observation principal/window, and idempotency id |
| provisional activation | `capability.publication.provision` | `capability.publish`; consumes the exact retained confirmation and expected target/external heads |
| finalization | `capability.publication.finalize` | `capability.publish`; exact provisional families/request plus retained public-observation receipt |
| withdrawal or failed-observation cut | `capability.publication.withdraw` | `capability.withdraw`; exact family/head/reason, except target self-expiry requires no request |
| final-lease renewal without payload change | `capability.publication.renew` | `capability.publish`; exact final family/head and unchanged request/candidate/receipt digests |
| reconciliation | `capability.publication.reconcile` | `capability.publish` or `capability.withdraw`, matching the operation being reconciled |

The supervisor journal must retain canonical request and response bytes, not
only their digests. A lost response exact-replays through LLP 0111's encrypted
supervisor replay store. A service intermediate may sign a carrier only after
the journal proves the matching request committed. `deploy.apply` is retained
as a bound prerequisite but grants no capability-publication scope, and
`release.upload` never authorizes any publication transition.

## 5. Provisional activation, observation, finalization, and ledgers

The release image embeds the digest of the immutable **candidate** package
ledger. It cannot embed a post-promotion ledger that does not yet exist. After
the exact candidate bytes are promoted, the supervisor supplies a canonical
publication-ledger extension whose `previousLedgerSha256` equals the embedded
candidate-ledger digest and whose nine package rows bind name, version,
candidate tarball SHA-256, registry integrity, registry tarball SHA-256, and
dist-tag observation.
Each final platform row also retains the exact GitHub repository, workflow
path/ref/head, run id and attempt, release operation id, dispatch/run/collection
times, and a distinct artifact id with matching API archive digest, downloaded
archive SHA-256, and extracted receipt SHA-256. The receipt producer measures
the checked-out source HEAD and dirty state rather than copying those claims
from the ledger. Qualification accepts only clean GitHub-hosted rows whose
checkout equals the candidate revision and whose two artifacts belong to the
same API-reopened workflow-dispatch run. Immediately before the publication
ledger extension is closed, the publisher reopens the exact nine-package
registry vector and a fresh challenge-bound signed acquired authority head;
both observations are retained in the extension.

The provisional activation CAS requires:

1. the exact isolated qualification receipt and all cleanup receipts;
2. a still-current source database/schema/generation proof;
3. the exact candidate image, function graph, target, and embedded candidate
   ledger;
4. both platform cold-install receipts and public-registry byte equality for
   all nine packages;
5. the hosted TLS, ephemeral, migration, operator, and cleanup receipts named
   by LLP 0111; and
6. the exact retained publication plan/confirmation/provision request chain
   plus its bound confirmed `deploy.apply` prerequisite from §4.2; and
7. a newly signed provisional epoch whose target has revalidated it and whose
   120-second expiry leaves enough time for activation and observation.

In one target-head CAS, the target activates the already-qualified candidate
graph and installs all required provisional claim families. Runtime support
remains false for every ordinary principal. The CAS also installs one closed
`ProvisionalObservationPrincipalV1`, signed by the
`capability-publication` intermediate and bound to the publication request,
target, family epochs, public origin, exact acceptance subject/session/device,
maximum eight invocations, maximum one schema-valid witness mutation, issue
time, and the same or earlier 120-second expiry. It refines ordinary
authentication only for those exact invocations. It is neither discoverable
nor accepted on any other origin, route, graph, family, device, or ordinary
generated client.

The observation runner reaches the public origin using ordinary sender proof
and authentication plus that principal. The target reports the two ids as
statically experimental and returns runtime support only to that principal.
It executes the exact production-schema-identical corpus and records a
`PublicObservationReceiptV1` in the encrypted supervisor replay store. A
witness mutation is ordinary schema-valid idempotent data under §2. The runner
cannot install schema, broaden support, or create another principal.

The finalization CAS must occur before every provisional/principal expiry. It
matches the active graph, exact provisional family epochs, request, target,
ledger, support observations, and retained receipt. In one target and external
supervisor transaction it replaces provisional families with final families,
removes the observation principal, and makes the runtime-support predicate
true for ordinary callers whose artifact acknowledges the static experimental
ids. It does not change a maturity constant. Any missing or mismatched input
leaves ordinary runtime support false.

Crash and refusal outcomes are closed:

| Point | Required recovery |
| --- | --- |
| before provisional CAS | no target change; candidate remains hidden |
| CAS outcome ambiguous | read the exact target/supervisor heads; retry only the same idempotency id |
| provisional active, observation absent/refused/lost | exact-replay a committed receipt if present; otherwise wait for or issue the authorized withdrawal; target self-withholds at expiry |
| observation committed, final CAS absent/ambiguous | recover the receipt, read both heads, and finalize only the exact same request before expiry; otherwise self-withhold |
| final CAS committed | ordinary support follows only the verified, unexpired final family; renewal/withdrawal uses §4.2 |
| any family expires or signer/head becomes unverifiable | withhold that family immediately; keep graph and production data unchanged |

The static maturity is therefore never used as a substitute for runtime
support, and provisional support is never visible to an ordinary principal.

## 6. Acceptance

Acceptance requires committed, rerunnable evidence for:

- data isolation, including candidate DDL/writes/live output never appearing in
  production before ordinary migration plus cleanup after success, refusal,
  crash, and timeout;
- first-release production-schema identity and the later-release rule that an
  ordinary production migration completes before the qualification backup;
- every gate-order and use-journal transition, exact replay, mismatched replay,
  retained-snapshot/effect-fence crash reconciliation, replay-store encryption,
  retention/GC/410, concurrency, budget, and diagnostic row;
- ordinary-auth precedence and route closure over HTTP and socket entry points;
- all grant/use optionality, live-subscribe use-only transport, device
  revocation, sender-proof transplantation, and ten-minute lifetime negatives;
- provisional expiry across target reboot, supervisor partition, clock
  uncertainty, failed withdrawal CAS, observation-principal misuse, every
  provisional/final CAS crash point, final-lease expiry, and every in-flight
  recheck point;
- service-intermediate wrong-purpose/domain/root/serial/generation/time
  negatives and publication request/scope substitution;
- candidate-ledger embedding and final-ledger lineage across all nine packages;
- checkout-measured producer provenance plus wrong repository/workflow/ref/
  head/run-attempt/operation/artifact-id/artifact-digest and stale-dispatch
  negatives for the two final GitHub-hosted package receipts;
- comparator receipts binding the exact executing CLI and client package-file
  closures, with verification refusing any later byte or inventory drift;
- failed provisional CAS leaving the active graph, database, claims, and
  runtime-support observations unchanged;
- provisional activation exposing support only to the exact observation
  principal; and
- successful finalization making ordinary runtime support true only after all
  required receipts are current while static maturity remains experimental.

The implementation must place non-obvious gates and CAS boundaries under
`@ref LLP 0113` annotations. `./ref-check --verbose`, the generated wire-schema
gates, capability-registry equality tests, crash injection, and the complete
LLP 0110/0105 acceptance corpus gate landing.

## Status

**Review.** This Spec records the corrective design authorized on 2026-07-28
and entered the authorized super-refine loop on the same date. The revision
above applies terminal review dispositions after that round and is explicitly
**unreviewed post-round**.
It does not make either capability publishable and does not advance the status
of any related LLP. Review artifacts may recommend revision but cannot
ratify it.
