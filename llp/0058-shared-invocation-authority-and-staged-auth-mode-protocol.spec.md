# LLP 0058: Shared invocation authority and staged auth-mode protocol

**Type:** Spec
**Status:** Accepted
**Systems:** Auth, Runtime, Storage, API, Live Queries, Ephemeral state, Security, Client integration, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-07-13
**Revised:** 2026-08-21 (cold-startup mismatch remediation now distinguishes
data-preserving live evolution from destructive whole-store dev reset. The
fresh route uses `snapback reset --dev-fresh` and explicitly rejects the
database-as-one-file model per LLP 0192.)
**Revised:** 2026-08-12 (Dev browser-origin hardening: body-selected users are
admitted only from the bound origin or an explicit exact loopback allowlist;
no-Origin trusted-local callers are unchanged). 2026-08-12 (target registry
amendment: positive `offline_mutation_replay` support now names the registered
atomic settlement ledger required by LLP 0043; Cloudflare/default facts remain
false). 2026-08-10 (LLP 0224 Phase 1 companion: the operational-readiness
predicate binds read-only to the settled mode-state invariant and the
positive `sessionActivationReady` derivation; no new authority, no
override; see §Dated amendment: operational-readiness predicate binding).
2026-08-10 (LLP 0204 commissioned the sealed
`CapabilityLinkPossessor` resolved-authority addition for granted-operation
capability links; design only, with no implementation or capability claim —
see the dated amendment.) 2026-08-09 (managed-development cold-successor amendment: an
ordinary settled-sessions start remains exact-pair pinned, while the explicit
pre-bind `--activate-startup-successor` opt-in may activate a different complete,
valid, seedless sessions pair through the same guarded same-mode durable cut;
the managed `snapback dev` loop uses the opt-in automatically only after a
structured mismatch proves both old and candidate identities, and emits the
from/to activation). 2026-08-03 (LLP 0109 acceptance: dated versioned-seed staging
amendment — the specified `StartupArtifactsV2` stage/consume composition is
recorded, and the accepted first landing defers the carrier, refusing
cross-mode install before any stage). 2026-08-01, later same day (LLP 0062 §4 companion: the
`app-cli.target` eligibility descriptor lands as a structured capability-manifest
block — principal classes, envelope service, generation-assertion admission,
per-grant token cap — echoed by sessions discovery, with absence as the honest
capability-absent report; local declares, remote/conformance/hosted withhold).
Prior: 2026-08-01 (same-mode provisioning note: the committed-carrier
check proves "no foreign root in flight" — the transition's own private
projection root may stay counted while after-Local publication owners drain,
and the strict all-roots-dropped gate holds at successor publication; fixes
the A3 sweep's live-subscriber watch-reload wedge,
issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md);
2026-07-27 (LLP 0108 amendment: `inline_handler_v1` and
`result_contract_v1` join the closed registry at experimental maturity and
require generated-artifact acknowledgement); 2026-07-25 (acknowledgement-source split, defect resolution of
issues/20260725-0093-p3-invalidation-ack-descriptor-coupling.md, author
decision Charlie Cheever 2026-07-25: the former `StandaloneAcknowledgement`
invocation source conflated two planes. It is split into
`MutationSettlementAcknowledgement` (`/client-mutations/acknowledge`), which
deliberately remains on the queued-replay/authority-descriptor plane, and
`InvalidationAcknowledgement` (`/live/authorization-invalidation/acknowledge`
and `/manual-retry`), which is owned by the authorization-invalidation
program (LLP 0059 item 6) and does NOT require authority-descriptor
readiness or the descriptor protocol offer. The gate-coverage table row is
split accordingly). 2026-07-24 (capability-maturity amendment, author decision
Charlie Cheever 2026-07-24 against
issues/20260723-llp0076-capability-honesty.md: the closed target-capability
registry gains a code-owned maturity dimension — `proposed` /
`experimental` / `stable` — reported through the additive
`capabilityMaturity` manifest map and enforced at admission. An
`experimental` entry is NOT this Spec's plain positive compatibility
assertion: requirements on it are refused `SNAPBACK_CAPABILITY_UNSUPPORTED`
unless the requiring artifact lists the id in the additive
`acknowledgedExperimentalCapabilities` function-manifest field, which
codegen emits from the same closed table it derives requirements from.
`bounded_response_stream_v1` is `experimental` until LLP 0076 reaches
Accepted, satisfying LLP 0074's no-positive-claim rule for Draft-backed
capabilities; every other id is `stable`. See §Capability maturity).
2026-07-24 (the LLP 0077 route-scoped reorder is implemented: hosted sender
admission and its shared-throttle/proof cut complete first, then the
forbidden-authority-field body check runs before ordinary `SessionAuth`
projection; a served refresh test proves a valid proof plus forbidden body
field is rejected without consuming the retained successor nonce).
2026-07-25 update: LLP 0076 was Accepted and the id flipped to `stable`;
`relational_query_v1`/`migration_keyset_scan_v1` are the current
experimental set).
2026-07-23 (route-scoped ordering amendment for Draft LLP 0077:
on sender-constrained hosted browser routes, sender-proof admission runs
before the request body is polled, so this Spec's forbidden-authority-field
body check runs immediately after sender admission rather than before bearer
consideration. The forbidden-field check keeps its precedence over the bearer
and still precedes credential resolution and any application handler; the
rationale is that an unproven sender must never cause body ingestion. This
narrow reorder applies only to routes carrying `hosted_sender`; all other
routes retain the forbidden-field-first order). 2026-07-22 (LLP 0076 adds
the ninth closed target-capability id,
`bounded_response_stream_v1`, with a conjunctive registered-implementation and
process-live outbound-action predicate). 2026-07-17 (authority-independent authoring validation now treats
membership predicates and `authScopeField` as authority dependencies before
artifacts are written). 2026-07-17 (post-commit carrier closure: an independently owned
transition task receives a fail-closed carrier from Local projection, performs
terminal lifecycle and runtime-mode publication off the committing Local
scope, then explicitly opens the successor). 2026-07-15 (author ratification: Charlie Cheever explicitly
ratified this Spec after ENG-25001 closed the review findings and the FINAL4
Codex and Fable reviews both returned READY; Status advanced to Accepted
without advancing frozen LLP 0039); 2026-07-15 (FINAL3 closure: reconciles sessions-to-dev with LLP
0055's transactional five-class agent-authority purge, ReadyV1 compatibility,
crash outcomes, and rollback evidence; pins session-generation safe-integer
boundary evidence; status remains Draft); 2026-07-15 (final cross-family review follow-up: reconciled the
composed commit-witness types, exact cache control, descriptor-schema closure,
and readiness-negation evidence wording; status remains Draft). 2026-07-15 (final evidence/schema reconciliation: made
`deploymentIdentity` mode/version/hash exact in the Rust schema, shipped kit,
and shared corpus; aligned served capability negotiation refusals to LLP
0012's 503 registration; made the poison harness observe the reserved port
concurrently; and added dated, harness-bound evidence provenance plus an
explicit ratification/release freshness gate; status remains Draft).
2026-07-15 (reconciled the current authority and handshake shapes:
LLP 0055's dated amendment owns `ServicePrincipal` plus `kind`/`actor`, while
the wire handshake keeps a distinct three-field `AuthSessionAuthority`; added
LLP 0059's required nullable `deploymentIdentity`; status remains Draft).
2026-07-15 (committed the pinned-predecessor rollback harness and
receipt plus a direct corrupt database/WAL byte regression; corrected the LLP
0012 registration account; status remains Draft). 2026-07-15 (ENG-25001 defect reconciliation: closed raw-loader,
prepared-generation, seed provenance, composed-gate, session DTO, handshake
freshness/exactness, startup recovery, and carrier-boundary findings; clarified
the executable-authority trusted-producer premise and safe post-consume/pre-bind
startup interval; status remains Draft). 2026-07-14 (round-2 dual-family revision, /llp-super-refine:
**separated committed executable coverage from one-time recorded evidence** in
Acceptance/Status — the "actual-predecessor runs" and "byte-for-byte database/WAL
comparison" are recorded ENG-24597 evidence, not a rerunnable committed harness,
and the text no longer overstates the committed tests; **defined
`AuthorizationCommitWitness`** ownership (this Spec owns the same-mode activation
witness; mapped to LLP 0053's `CompositeWitness` vocabulary); **registered the
kit-produced `SNAPBACK_AUTH_HANDSHAKE_INVALID` and `SNAPBACK_REQUEST_BODY_TIMEOUT`**
as LLP 0012 obligations; **labeled the §Activation-readiness JSON as the item-4
boundary exhibit** (later items flip their facts); named the 20 s ingest
deadline's collateral class; and recorded, as named defect obligations, the
GPT-family spec-vs-code findings (exact connection-grant live ownership,
settled-dev raw-loader tuple enforcement, prepared-generation compilation before
consume, readiness-before-prerequisites, the composed gate boundary, HTTP session
DTO closure, cross-process handshake-cache invalidation, handshake UUIDv7/version
exactness, truly-empty seed classification, content-verified deployment
identities, and operator-recovery diagnostics). Full triage in §Review triage.)
2026-07-14 (admitted-body ingestion: managed-route request buffering gains a 20000 ms monotonic ingest deadline strictly below the quiescence deadline plus epoch-close cancellation, ENG-24988). 2026-07-14 (ENG-24996 review gate: archived the GPT-family review artifact at `reviews/0058-shared-invocation-authority-and-staged-auth-mode-protocol.codex.md` and applied its editorial corrections — carrier hard-link rule, contract-data v1 exception, and Related links; material findings remain for author triage). 2026-07-14 (ENG-24987: kit-side offer/echo closure — handshake validation compares each `clientProtocols` echo with the exact per-request offer tuple and rejects unsolicited echoes with `SNAPBACK_AUTH_HANDSHAKE_INVALID`; Contract cross-checks echoed axes against the transport's published offer). 2026-07-14 (ENG-24991: the generated `auth.session.output` schema is now exact with the executable kit validator — every member including nullable ones is required, `protocolVersion` is `const: 1`, protocol echoes/minima are exactly v1-or-null, `transports` is exactly `["bearer"]`, authority identifiers couple to `isAuthenticated`, lease capability facts pin their protocol constants, and a shared accept/reject corpus is proven against both the schema and the shipped kit; the example DTO gained the item-6/7/8 members it had omitted). 2026-07-14 (final auth audit reconciliation: same-mode sessions deployment is an admission-barrier activation, its exact durable authorization witness is projected before reopen, and both legacy function-load ingresses resolve through complete-pair provisioning). 2026-07-14 (implementation-vs-review reconciliation: ENG-24597/item 4 and its executable matrices have landed, later items now consume the staged extension points, and this Spec remains Draft pending author ratification and scaled review). 2026-07-13 (aligned the executable-carrier rule with the implementation's conservative no-extended-ACL boundary); 2026-07-13 (initial implementing protocol for ENG-24597 / LLP 0039 landing item 4)
**Related:** LLP 0000, LLP 0007, LLP 0009, LLP 0011, LLP 0012, LLP 0013, LLP 0017, LLP 0024, LLP 0030, LLP 0031, LLP 0034, LLP 0037, LLP 0039, LLP 0041, LLP 0043, LLP 0051, LLP 0053, LLP 0055, LLP 0057, LLP 0059, LLP 0060, LLP 0074, LLP 0076, LLP 0108, LLP 0150, LLP 0174, LLP 0176, LLP 0204

## Summary

This Spec makes landing item 4 of
[LLP 0039](./0039-auth-vertical-slice.rfc.md) executable. It pins one shared
invocation-authority gate, the durable staged `auth.mode` state machine, the
paired-v1 artifact protocol, cold-start bundle provenance, the bootstrap
handshake, and the session-mode closure of legacy body authority and ephemeral
identity fields.

LLP 0039 remains **Draft / FROZEN**. This document does not amend, repair, or
reinterpret it. Where 0039 pins an outcome, 0039 wins. This document chooses the
storage keys, record shapes, wire types, transition ordering, and failure traces
that 0039 deliberately left to an implementing Spec in
`LLP 0039#protocol-obligations-deferred-to-implementation`.

The existing corpus already covers the topic at design altitude: LLP 0011 owns
the parent auth model, LLP 0031 owns route policy, LLP 0039 owns the program and
landing order, and LLP 0057 owns provider/session state. A new document is still
required because none of those documents may safely be extended with item 4's
exact crash protocol: 0039 is frozen, 0031 is the route registry rather than the
mode authority, and 0057 explicitly exposes this work as a later-item seam.

The item has five load-bearing claims:

1. Every entry path constructs the same immutable `PreparedAuthority`; handler
   paths refine it to `PreparedInvocation`. No handler consumes a client
   `AuthInput` directly, and non-handler surfaces never invent a function.
2. The only admissible artifact/auth tuples are exactly `snapback.v0` + `dev`
   and `snapback.v1` + `sessions`, checked as pairs before hashes or effects.
3. A mode transition is durable and restart-gated. While it is pending or
   quarantined, ordinary app data is unavailable; the server never executes a
   session bundle under dev authority or a dev bundle under session authority.
4. The first successful sessions activation permanently relocates the manifest
   and poisons the legacy key, so a pre-auth binary fails parsing instead of
   silently reopening under body authority.
5. At the item-4 landing boundary, item 4 did **not** make sessions enableable.
   The production readiness bit stayed false until item 5 installed connection
   binding, revocation projection, and the client `AuthCoordinator`. Item 5 has
   since landed; this statement preserves the item boundary rather than claiming
   this Spec owns later activation.

## Scope and ownership

This Spec owns:

- the closed `AuthMode` and `AuthRequirement` manifest types;
- exact v1 artifact identity namespaces and the exact supported-pair
  capability;
- the four durable metadata keys and their version-1 records;
- stage, consume, quarantine, unstage, and downgrade ordering;
- a single pre-bind `--startup-artifacts` carrier for a complete artifact pair;
- the item-4 baselines for `WireAuthorityFields`, `ResolvedAppAuthority`,
  `HandlerAuthProjection`, `PreparedAuthority`, and `PreparedInvocation`, as
  subsequently amended by LLP 0055's service-principal authority/projection;
- the shared invocation gate and its complete entry-path inventory;
- session-mode body/owner-field rejection and the replacement live-owner
  predicate;
- conservative pre-item-6 admission for `authorityIndependent` live queries;
- `GET /auth/session`, its protocol headers, response DTO, and kit ordering;
- item 4's activation/readiness fences and its diagnostics; and
- executable acceptance matrices and crash traces.

This Spec consumes without re-owning:

- LLP 0031's effective route/operation policy and response controls;
- LLP 0057's provider resolver, session-family outcomes, auth catalog,
  keyring, collision check, and `ImpersonationCapability`;
- LLP 0053's authorization-invalidation declarations, dispositions,
  obligations, and retained lease, subsequently implemented by items 6/8;
- LLP 0055's subsequently implemented `ServicePrincipal` resolved authority
  and sealed `kind`/`actor` handler projections, which supersede item 4's
  narrower authority enumeration; and
- LLP 0059's subsequently implemented item-5 connection-bound authority,
  revocation projection, client coordinator, and required handshake deployment
  identity.

This Spec does not implement or specify hosted coordinator security. A hosted
sessions handler's must-understand invocation marker, handler-first deployment
interleavings, TLS/trusted-proxy posture, and multi-replica invalidation belong
to [LLP 0060](./0060-hosted-auth-security.rfc.md). Item 4 remains a local
Rust-target protocol.

## Normative vocabulary and constants

`MUST`, `MUST NOT`, `SHOULD`, and `MAY` are normative. JSON field names are
camelCase unless an existing legacy field is quoted in snake_case. Closed DTOs
reject duplicate keys and unknown fields.

| Name | Exact v1 value |
| --- | --- |
| Mode-state format | `1` |
| Startup-artifact carrier format | `1` |
| Bootstrap auth protocol | `1` |
| Legacy manifest key | `schema_manifest` |
| Active capability-aware manifest key | `schema_manifest_capability_aware` |
| Staged manifest key | `schema_manifest_staged_auth_mode` |
| Mode-state key | `auth_mode_state_v1` |
| Permanent legacy poison value bytes | `"SNAPBACK_SESSIONS_MANIFEST_RELOCATED: session-aware binary required"` |
| Startup carrier flag | `--startup-artifacts <path>` |
| Explicit unstage flag | `--clear-desired-auth-mode` |
| Downgrade consume flag | `--allow-auth-downgrade` |
| Dangerous dev-bind override | `--allow-insecure-dev-auth` |
| Startup carrier maximum | 32 MiB |
| Auth client protocol header | `x-snapback-auth-client-protocol` |
| Invalidation protocol header | `x-snapback-auth-invalidation-protocol` |
| Authority descriptor protocol header | `x-snapback-authority-descriptor-protocol` |
| Authorized lease protocol header | `x-snapback-authorized-lease-protocol` |
| Mode quiescence deadline | `30000` monotonic milliseconds |
| Admitted body ingest deadline | `20000` monotonic milliseconds |

The poison value above is the complete JSON string encoding, including its two
double-quote bytes and with **no trailing newline**. It is deliberately valid
JSON whose top-level type is a string, not an object, so the pre-auth
`SchemaManifest` parser fails.

## Manifest and artifact contract

### Closed auth mode

The schema manifest gains this closed object:

```ts
type AuthManifest = {
  mode: "dev" | "sessions"
}
```

The schema field is `auth?: AuthManifest`. Absence means `dev`. `auth` denies
unknown fields, and an unknown `mode` is a manifest-load error. `auth.mode` is a
must-understand field and is the narrow exception to LLP 0012's otherwise
additive unknown-field posture.

The Rust authority is a closed `AuthMode::{Dev, Sessions}` enum. No internal
`Option<String>` or best-effort parse may reach deployment or invocation code.

### Closed function requirement

The function manifest replaces the current unconstrained string with:

```ts
type AuthRequirement = "public" | "optional-user" | "authenticated"
```

Absence on a legacy function means `optional-user`. The typed authoring spelling
`auth: "authenticated"` emits `authRequirement: "authenticated"`. An unknown
value fails function-manifest load.

The requirement controls only whether a resolved user is required:

- `public` does not skip credential parsing. A presented invalid credential is
  still an error.
- `optional-user` admits anonymous or user-bearing authority after validating
  any presented credential.
- `authenticated` fails `SNAPBACK_AUTH_REQUIRED` before handler execution when
  the resolved authority has no user.

A cron target declared `authenticated` is invalid at manifest load because
`system` carries no user. A nested mutation applies its own requirement to the
inherited authority; `public` never strips an already-resolved user.

### Authority-independent live declaration

`FunctionDefinition` gains `authorityIndependent: boolean`, default `false`.
It is valid only for `Query` or `LiveQuery`. It does not mean public, retained,
or replayable; it means only that one live result is invariant under caller
authority.

At the item-4 boundary, before LLP 0053 item 6 installed the complete
protected-query profile and oracle, item 4 accepted `true` only for a HostPlan
whose closed IR:

- contains no auth expression, membership predicate, or `authScopeField`;
- has `authRequirement: "public"`;
- contains no opaque Ibex code, action, config/provider read, runtime clock/id,
  or nested call; and
- produces the same full re-query result for anonymous and two distinct
  authenticated fixtures in dev/test acceptance.

No declaration is inferred from a missing auth expression, a public route, an
empty read set, or a currently anonymous caller. At that boundary an opaque
Ibex live query was auth-scoped because item 4 could not validate it; current
protected-query admission is owned by LLP 0053. A false declaration is a
manifest-load error in dev/test when the fixture disagrees and a capability
refusal elsewhere.

### The two admissible tuples

The admissible set is closed:

| Schema version | Function version | Effective auth mode | Result |
| --- | --- | --- | --- |
| `snapback.v0` | `snapback.v0` | `dev` | accept |
| `snapback.v1` | `snapback.v1` | `sessions` | accept |
| any other combination | any other combination | any | reject |

This rejects v0-sessions, **v1-dev**, mixed versions, an unknown version, and an
unknown mode. `supportedArtifactVersions` and `supportedAuthModes` remain useful
dimension reports, but they are not a Cartesian-product authorization.

The capability manifest therefore adds the authoritative pair list:

```json
{
  "supportedArtifactVersions": ["snapback.v0", "snapback.v1"],
  "supportedAuthModes": ["dev", "sessions"],
  "supportedArtifactAuthPairs": [
    { "schemaVersion": "snapback.v0", "authMode": "dev" },
    { "schemaVersion": "snapback.v1", "authMode": "sessions" }
  ],
  "supportedCapabilities": [
    "auth.sessions.v1",
    "cron",
    "cron_action_run_mutation",
    "host_plan_runtime",
    "ibex_ctx_db_host_bridge",
    "live_subscriptions",
    "mutation_read_set_validation",
    "permission_epoch_resync"
  ],
  "authProtocols": {
    "provider": 1,
    "invocation": 1,
    "stagedMode": 1,
    "bootstrap": 1
  }
}
```

A v1 sessions schema manifest additionally contains
`requiredCapabilities: ["auth.sessions.v1"]`. The array may contain other
known capabilities, but it must contain that exact element and every element
must be supported before any effect. A v0 dev manifest must not claim
`auth.sessions.v1`.

`supportedCapabilities` is emitted from the same closed Rust target-capability
registry as the rest of `CapabilityManifest`; it is not accepted as authority
from a posted schema or function artifact. `auth.sessions.v1` is a closed
`TargetCapabilityId` meaning that the target can parse the paired-v1 artifact
and staged-mode protocols. It does **not** mean that the current process is
ready to activate sessions. A required capability is supported only when its id
parses as a known `TargetCapabilityId` **and** that id is positively present in
the server-declared `supportedCapabilities` set. An unknown required id always
fails `SNAPBACK_CAPABILITY_UNSUPPORTED`, even if a foreign artifact claims that
the target supports it. A target that omits the additive field has an empty
support set. Missing `capabilityGaps` is never positive evidence of support.
Top-level schema requirements and function/cron requirements are unioned and
resolved through this same authority before any effect.

The version-1 `TargetCapabilityId` set is closed to the code-owned ids and
positive predicates in this table, as extended by named LLP amendments. The
local target derives every id from code-owned facts, never from candidate
artifacts:

| Capability id | Positive local authority |
| --- | --- |
| `auth.sessions.v1` | the paired-v1 parser, shared invocation gate, and staged-mode implementation are registered |
| `bounded_response_stream_v1` | outbound actions are enabled for this exact runtime instance and the LLP 0076 bounded stream implementation is registered |
| `host_plan_runtime` | `RuntimeCapabilities.host_plan_runtime == true` |
| `ibex_ctx_db_host_bridge` | `RuntimeCapabilities.ibex_ctx_db_host_bridge == Available` |
| `live_subscriptions` | `CapabilityManifest.liveSubscriptions == true` |
| `offline_mutation_replay` | the atomic client-mutation settlement ledger is registered for this target/runtime instance |
| `mutation_read_set_validation` | `mutationIsolationMode == "handler-captured-read-set-validation"` and its commit validator is registered |
| `cron` | `CapabilityManifest.cron == true` |
| `cron_action_run_mutation` | `cron == true` and `supportedQueryForms` contains `cron-action-run-mutation` |
| `permission_epoch_resync` | the local permission-epoch capture, bump, resync, and live-rerun implementation is registered |
| `inline_handler_v1` | the LLP 0108 direct-expression extractor, closed admission profile, and isolated evaluator registration are installed |
| `result_contract_v1` | the LLP 0108 Rust manifest contract, effective hashing, and pre-publication/pre-commit result validator are installed |

The registry emits only ids whose positive predicate is true for that exact
target/runtime instance. Existing codegen-emitted function requirements and
cron requirements therefore remain valid under v1 instead of being mistaken
for unknown auth capabilities. LLP 0076 is the dated ninth-id amendment: it
adds the manifest/schema enum member and the conjunctive process-live predicate
above. Adding any further id requires another manifest/schema revision and a
named positive predicate; string similarity, a missing gap, or a successful
unrelated runtime probe cannot extend the enum.

#### Target-capability registry amendment — offline mutation replay (2026-08-12)

The closed registry adds `offline_mutation_replay`. Its only positive support
predicate is registration of the server-side atomic client-mutation settlement
ledger: the ledger must retain a result under the caller's replay-stable id in
the same transaction as application effects and return that settlement on a
duplicate delivery. The local SQLite, remote-service, and conformance profiles
derive that positive fact from the same registered local runtime. The
Cloudflare/default fact remains false and the Cloudflare manifest continues to
list the id as a gap. A target accepting `clientMutationId` without the ledger
does not satisfy the predicate.

The capability is `experimental` while its governing LLP 0043 remains Draft.
The JS client consumes the served `/inspect` manifest as an execution-safety
fact: positive presence admits durable enqueue and drain; absence, an older
manifest, an unavailable inspection, or a merely absent gap does not.

### Capability maturity

*(Amendment 2026-07-24, author decision Charlie Cheever against
`issues/20260723-llp0076-capability-honesty.md`; the honesty rule is LLP
0074's: no plain positive capability claim for a capability whose governing
authority is Draft and whose conformance is incomplete.)*

The registry gains a second code-owned dimension beside the support
predicate: each `TargetCapabilityId` carries a **maturity** from the closed
vocabulary `proposed` / `experimental` / `stable`
(`TargetCapabilityId::maturity` in `crates/snapback/src/manifest.rs`). Maturity is a fact
about the id's governing contract, not about a runtime instance, so it
lives on the registry itself; candidate artifacts can neither assert nor
upgrade it, exactly like support.

- **`proposed`** — the contract exists in a proposal document but no
  implementation is registered. A proposed id is never emitted in
  `supportedCapabilities` at all (its positive predicate cannot hold).
- **`experimental`** — the implementation is registered and the id's
  instance predicate holds, but the governing authority is not Accepted.
  The emitted entry asserts *current-contract* compatibility only: the
  contract may still change incompatibly, and conformance may be
  incomplete. **An experimental entry is not this Spec's plain positive
  compatibility assertion.**
- **`stable`** — the original reading of this Spec: positive presence in
  `supportedCapabilities` is the plain compatibility assertion.

Reporting: the capability manifest gains the additive `capabilityMaturity`
object mapping each **emitted** non-stable id to its maturity. Stable ids
are omitted, so an all-stable manifest serializes without the field; a
manifest that omits the field predates this amendment and its entries are
read under the pre-amendment semantics its producing server actually
asserted. The map is derived from the same closed Rust registry as
`supportedCapabilities` and is never accepted as authority from a posted
artifact.

Admission: resolving a required capability now checks maturity after the
existing known-id and positive-presence checks. A requirement on a
non-stable id is refused `SNAPBACK_CAPABILITY_UNSUPPORTED` (with the
maturity named in the diagnostic details) **unless** the requiring artifact
lists the id in the additive `acknowledgedExperimentalCapabilities` field
of its function manifest, which covers the generated schema/function pair
as one unit. Codegen emits the acknowledgment automatically from the same
closed capability table it derives requirements from, so a generated
artifact knowingly binds to the experimental contract its toolchain
targeted. The acknowledgment can only ever narrow this one refusal:
acknowledging a stable id is a harmless no-op (promotion to stable never
breaks an artifact), an unknown acknowledged string is inert, and no
acknowledgment can make an unsupported or unknown capability admissible.
On the deploy-time-compiled Cloudflare target the same rule runs at its
loader seam — function resolution — against the served manifest's
`capabilityMaturity` and the bundle's exported acknowledgment list.

Current assignment (2026-07-25): `bounded_response_stream_v1` is **stable**
— LLP 0076 was Accepted 2026-07-25 and the flip landed as the acceptance
act, requiring no artifact changes because existing acknowledgments became
no-ops exactly as this Spec promised. `relational_query_v1` and
`migration_keyset_scan_v1`, `inline_handler_v1`, and
`result_contract_v1` are **experimental** until their coupled suites pass
and their governing LLPs advance. Every other registry id is `stable`.

Only the schema and function artifact manifests — plus the generated
contract-data manifest, which is bound to the exact paired schema/function
identity and moves with it — move to `snapback.v1` for sessions. The capability
manifest, runtime-state DTO, diagnostic schemas, wire DTO schemas, and every
other artifact retain their existing version spelling (`snapback.v0` where
applicable); the fields in this Spec are additive under LLP 0012. No
implementation may infer a corpus-wide version bump from the paired-v1 rule.

### Disjoint v1 identity strings

V1 identity strings use serialized namespaces that no v0 producer emits:

```text
snapback.v1:sessions:schema:sha256:<64 lowercase hex>
snapback.v1:sessions:function:sha256:<64 lowercase hex>
snapback.v1:sessions:inputs:sha256:<64 lowercase hex>
```

The three hexadecimal payloads are SHA-256 over LLP 0012's existing
length-framed encoding. The domain and leading framed sequence are exactly:

```text
schemaHash domain:  "snapback-codegen/schema-content-hash/snapback.v1/sessions"
schemaHash items:   "schemaManifest", "snapback.v1", "sessions", appId, ...canonical schema-content items

bundleHash domain:  "snapback-codegen/bundle-content-hash/snapback.v1/sessions"
bundleHash items:   "functionManifest", "snapback.v1", "sessions", appId, ...canonical function-content items

inputsHash domain:  "snapback-codegen/inputs-hash/snapback.v1/sessions"
inputsHash items:   "schemaFunctionPair", "snapback.v1", "sessions", appId, ...canonical shared-input items
```

The first framed items are, in order, artifact kind, `snapback.v1`, `sessions`,
and `appId`; each uses the pre-existing LLP 0012 length framing. `...` means the
following existing canonical content or shared-input items, not a pre-hashed
display string or self-containing JSON. The digest spelling is exactly 64
lowercase hexadecimal SHA-256 digits.

The schema manifest uses the `schema:sha256:` form for `schemaHash`; the
function manifest uses `function:sha256:` for `bundleHash`; both halves carry
the identical pair-level `inputs:sha256:` value. V0 preserves its existing
identity encoding and must never emit a `snapback.v1:` prefix. Auth-aware
receivers validate the full prefix and lowercase-hex shape. The actual
unmodified pre-auth predecessor sees strings unequal to their v0 counterparts,
cannot return early from its hash-match shortcut, and then rejects the v1
artifact header with `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`.

### Complete candidate-pair preflight

Every provisioning ingress calls one preflight before a hash-match shortcut or
effect. It resolves, in order:

1. explicit ensure intent and its branch authorization;
2. requested mode, active mode, desired mode, and mode-state availability;
3. a complete schema/function pair;
4. each artifact kind, version, non-empty identity field, and auth mode;
5. equal `schemaVersion`, `appId`, and `inputsHash` across the pair;
6. the exact supported artifact/auth pair;
7. every `requiredCapabilities` entry and static target-support fact (the
   separate item-5 activation-readiness check is consume-time);
8. mode-specific manifest rules, including cron, live, and ephemeral rules;
9. the LLP 0057 collision/catalog check when sessions is requested; and
10. only then identity equality, DDL, mode-state writes, function replacement,
    or seed.

For a one-half update, the missing half may come only from the complete,
already-loaded, previously preflighted sibling held in process memory for the
**same** active deployment identity. The durable `activeDeployment` identity
record is not a manifest body and cannot supply that sibling. Consequently,
after restart a one-half request must provide both halves unless the startup
carrier or another pre-bind load established the complete attested sibling in
this boot. A first sessions request cannot pair a posted v1 half with an active
v0 half, so it requires both v1 halves. A staged correction likewise supplies
both halves unless its unchanged full sibling is loaded and exactly matches
`requestedDeployment`.

The direct `POST /_snapback/api/functions/load` route and multiplexed
`host_ops.functions.load` operation are provisioning ingresses for this rule,
not privileged raw-loader exceptions. In settled sessions mode they interpret
their posted function manifest as a one-half update, resolve the schema only
from that boot's complete preflighted sibling, and enter the same activation
barrier described below. A v0, mixed, sibling-less, or otherwise invalid pair
fails before function replacement or any mode/auth-state effect. Their legacy
raw-load behavior remains available only in settled dev mode. The direct route
holds ordinary managed admission across that dev load and its response, and the
raw local seam rechecks the exact durable settled/available dev posture under
the write lane. Thus a concurrent stage cannot pass a runtime-state check and
then race a raw function swap into pending/quarantined state. An in-process
host-op carrier has no transition owner and therefore refuses sessions mode;
the server-coordinated path is its sole sessions implementation.

Public `attest` accepts only the closed identity pair from LLP 0012 and performs
steps 2–8 plus equality. It never accepts a full manifest, seed, or stage field
and never mutates. Privileged `provision` performs all ten steps. Hash equality
does not change either branch's authority.

## Durable staged-mode protocol

### The four keys

All four values live in `_snapback_meta` and are updated only inside the global
SQLite write lane.

`schema_manifest` is the legacy reader seam. Before the first sessions
activation it contains the parseable active v0 schema manifest. After the first
sessions activation it contains the permanent poison string and is never
deleted, restored, or made parseable again.

`schema_manifest_capability_aware` contains the active schema manifest consumed
by auth-aware binaries. On first auth-aware open of a legacy database, the
binary transactionally copies the validated v0 manifest here and creates an
initial mode record while leaving `schema_manifest` parseable. Before sessions
has ever activated, each dev schema update writes both manifest keys. After
sessions has activated, only the capability-aware key changes.

`schema_manifest_staged_auth_mode` contains the full staged schema manifest and
its pinned pair identity. It exists only while a requested transition is
pending or quarantined.

`auth_mode_state_v1` contains the single mode-state authority below.

### Exact deployment identity

```json
{
  "schemaVersion": "snapback.v1",
  "authMode": "sessions",
  "appId": "example",
  "schemaHash": "snapback.v1:sessions:schema:sha256:...",
  "bundleHash": "snapback.v1:sessions:function:sha256:...",
  "inputsHash": "snapback.v1:sessions:inputs:sha256:..."
}
```

The record is closed; all six strings are non-empty. `activeDeployment` may be
`null` only for an adopted, settled legacy v0-dev database that never recorded a
complete pair. A sessions deployment and every `requestedDeployment` are always
non-null and complete.

These identities are authenticated producer assertions, not receiver-computed
content-address proofs. The local CLI accepts them only from the owner-only,
single-link executable carrier below; network provisioning accepts them only
after the privileged AdminWrite boundary. The receiver validates the closed
namespace, complete-pair equality, mode, and cross-half inputs identity, but it
does not independently reproduce a build system's canonical source hashing.
Their security role is generation coherence and crash/restart pinning; executable
authority comes from the authenticated carrier. A future receiver-computed hash
format would be a protocol revision, not an implicit strengthening of v1.

### Exact mode-state record

```json
{
  "formatVersion": 1,
  "transitionGeneration": 0,
  "active": "dev",
  "desired": "dev",
  "modeState": "settled",
  "appDataAvailability": "available",
  "sessionsEverActivated": false,
  "activeDeployment": null,
  "requestedDeployment": null,
  "quarantine": null
}
```

Closed values are:

- `modeState`: `settled | pendingRestart | quarantined`;
- `appDataAvailability`: `available | refusedPending`;
- `active` and `desired`: `dev | sessions`; and
- `quarantine`, when present:

```json
{
  "transitionGeneration": 7,
  "code": "SNAPBACK_AUTH_TABLE_COLLISION"
}
```

`transitionGeneration` is a nonnegative JavaScript-safe integer
(`0..=9007199254740991`). It increments exactly
once for each successful stage, re-stage, explicit unstage, quarantine, or
consume commit. Overflow fails closed as corrupt state rather than wrapping.
The quarantine record carries only a stable code and generation; secret or
path-bearing diagnostic text remains on the operator plane.

The record invariants are:

| State | Required invariants |
| --- | --- |
| `settled` | `active == desired`; availability is `available`; `requestedDeployment` and `quarantine` are null; staged key absent |
| `pendingRestart` | `active != desired`; availability is `refusedPending`; requested deployment non-null; quarantine null; staged key present at the same generation |
| `quarantined` | `active != desired`; availability is `refusedPending`; requested deployment and quarantine non-null; staged key present at the same generation |

`sessionsEverActivated` is monotonic. Once true it can never become false. If it
is true, the legacy key must be exactly the poison value even while active mode
is later `dev`. A record/key mismatch is
`SNAPBACK_AUTH_MODE_STATE_CORRUPT`; the server binds no app-data listener.

### Exact staged record

```json
{
  "formatVersion": 1,
  "transitionGeneration": 7,
  "requestedDeployment": {
    "schemaVersion": "snapback.v1",
    "authMode": "sessions",
    "appId": "example",
    "schemaHash": "snapback.v1:sessions:schema:sha256:...",
    "bundleHash": "snapback.v1:sessions:function:sha256:...",
    "inputsHash": "snapback.v1:sessions:inputs:sha256:..."
  },
  "schemaManifest": {}
}
```

`schemaManifest` is the full closed manifest, not an identity-only projection.
It must equal the requested deployment's schema identity and desired mode. The
function body is deliberately absent: executable code is never persisted as a
side effect of a dev-mode browser provision.

### Adoption of a legacy database

An auth-aware binary opening a database with no mode-state key:

1. reads and validates the legacy `schema_manifest` as v0;
2. treats its effective mode as `dev`;
3. writes the same bytes to `schema_manifest_capability_aware` and creates the
   settled generation-0 record in one transaction; and
4. leaves the legacy key unchanged.

An absent legacy manifest yields a settled dev record with null deployment and
no capability-aware manifest until first provisioning. A string-valued legacy
manifest is recognized only as the exact poison; poison with a missing or
malformed mode record is corrupt state, never a fresh database.

### Corrupt-state boundary

The exact fresh/absent and legacy-adoption shapes above are the only pre-record
exceptions, and classifying them is read-only. Once any mode-state or poison
evidence exists, reading and cross-validating the four keys is a prerequisite
to every transition decision, not a transition failure that may be recorded. A parse,
format-version, closed-value, generation, key-presence, deployment-identity,
poison, or monotonicity invariant failure returns
`SNAPBACK_AUTH_MODE_STATE_CORRUPT`, binds no app-data listener, and performs
**no durable write at all**. In particular, startup does not quarantine,
rewrite a staged record, increment a generation, adopt, unstage, repair, or
guess which key is authoritative. Committed tests compare all four meta values
logically before and after every corrupt-state refusal. A dedicated
**byte-for-byte database/WAL comparison** holds a representative corrupt record
in an uncheckpointed WAL and proves refused open neither changes the database
image nor appends, checkpoints, deletes, or rewrites that WAL. This byte test is
representative of the common read-only refusal path; it does not claim a
byte-level fixture for every member of the logical corrupt-state matrix.

Quarantine is eligible only after all four keys form a valid pending snapshot.
It records a transition-specific refusal discovered after that point, such as a
missing/mismatched startup carrier, catalog collision, keyring/provider
failure, downgrade authorization failure, or activation-readiness failure. Its
single transaction increments mode and staged-record generations together.

### Stage ordering

Only `AdminWrite` or pre-bind startup authority may stage a mode change. A
Public request cannot stage even while active mode is dev.

Staging first performs the complete read-only candidate-pair preflight. It then
uses a mode-admission barrier: close new app-data, cron, live-rerun, and
nested-entry admission for the current durable generation and process-local
`admissionEpoch`; reversibly suspend existing live boundaries; and wait for all
finite invocations holding that epoch to leave. The v1 deadline is exactly
`30000` milliseconds measured by a monotonic clock and is not configurable.

At the deadline, staging atomically retires the old `admissionEpoch`, signals
cooperative cancellation (including the runtime engine interrupt), and returns
`SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT`. Every transaction sink, response
publisher, live callback, and nested-entry seam checks that epoch; retired work
may finish computation but cannot commit or publish any effect. The server then
reopens the same unchanged durable mode generation under a new monotonically
increasing `admissionEpoch` and resumes each suspended live boundary only by
preparing fresh authority under that epoch. It never kills a thread or reuses a
prepared snapshot from the retired epoch. Timeout writes no durable state.

If the state-sensitive preflight repeated under the global write lane fails,
the same cancellation/publication rules apply and staging reopens the unchanged
durable generation with no write. Retirement of the durable generation becomes
irreversible only after the pending-state transaction commits.

For dev to sessions, the stage transaction:

1. applies any already-preflighted additive app-schema DDL allowed by the
   ordinary schema rules;
2. runs the optional seed only after all DDL in that same transaction;
3. stores the staged record with generation `N + 1`;
4. stores mode state `{ active: dev, desired: sessions,
   modeState: pendingRestart, appDataAvailability: refusedPending }`; and
5. commits before reporting success.

A seed failure rolls back the DDL, staged record, and mode state together.

It does **not** replace the running dev function generation with the v1 session
bundle and does not activate the provider. On commit, the in-memory posture is
published before the stage response. All later ordinary app-data requests fail
`SNAPBACK_AUTH_MODE_PENDING`; a request admitted under the old generation
cannot publish a response or commit a nested effect after the barrier.

For sessions to dev, the same privileged flow stages a complete v0-dev pair.
Network `AdminWrite` may stage the downgrade, but only the pre-bind CLI flag
`--allow-auth-downgrade` may consume it.

During `pendingRestart` or `quarantined`:

- health, server identity, `GET /auth/session`, and operator diagnostics serve;
- ordinary app data, cron, live/ephemeral operations, and Public `attest` fail
  `SNAPBACK_AUTH_MODE_PENDING`;
- privileged `provision` is the sole schema correction/re-stage branch and
  still runs complete preflight before hashes or effects; and
- no generic admin, host-op, or handler-local bypass exists.

### Admitted body ingestion

The quiescence deadline is only meaningful when every finite admission root
has a client-independent bound. Request-body ingestion is the one segment of
an admitted HTTP invocation whose duration a remote client controls directly,
so the managed-route gate wraps the request body at admission time:

- Ingestion carries a monotonic deadline of exactly `20000` milliseconds,
  strictly below the quiescence deadline, measured from root admission. A
  body that has not finished arriving by the deadline is refused with
  `SNAPBACK_REQUEST_BODY_TIMEOUT` (408) and the admission root is released.
- Closing or retiring the admitted epoch cancels in-flight body buffering
  immediately: the request is refused with `SNAPBACK_AUTH_MODE_PENDING`, the
  refusal is delivered as an ordinary HTTP response on the still-open
  connection, and the admission root is released without waiting for the
  client to disconnect or finish sending.

Together these bound a transition's drain wait by work the process itself
performs: a public client holding an unterminated chunked body can neither
force `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT` nor repeat that starvation
against the reopened epoch. The policy-gate size bound and its
`SNAPBACK_VALUE_TOO_LARGE` refusal are unchanged; a body refused for size is
still reported as too large, never as a deadline failure.

### Cold startup artifact carrier

The sole carrier is one operator-selected file:

```json
{
  "formatVersion": 1,
  "schema": {},
  "functions": {},
  "seed": null
}
```

`schema` and `functions` are full manifests. `seed` is optional and may be
non-null only for pre-bind provisioning of a truly empty database; it is
rejected for a staged transition over an existing app. There are no separate
schema/function path flags, so the two halves cannot be selected from different
generations.

The CLI opens the path once without following a final symlink, requires a
regular file owned by the effective user, not writable by group or other, and
having exactly one hard link, rejects every extended access ACL (a deliberately
conservative executable-authority rule), rejects a changing inode/size, reads
at most 32 MiB, and parses from those exact bytes. The
file contains no credential, but it contains executable authority, so an
untrusted writable carrier is refused. All artifact validation and handler
preparation completes before any durable transition commit.

A settled sessions startup requires `--startup-artifacts` on **every** process
start. Missing, unreadable, or mismatched artifacts fail pre-bind with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED` or
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`; no diagnostic-only HTTP listener is
silently substituted. This is not a wedge: the operator can rerun with the
pinned pair, and the CLI emits the exact expected deployment identity without
secret material.

The mismatch diagnostic carries both supported authoring repairs. The
data-preserving branch restores the exact pinned carrier and advances the
successor through the running managed server. The destructive development
branch may first preserve the complete durable-state set with
`snapback store export`, then runs `snapback reset --dev-fresh --db <db>`.
It must say that the managed store is not one file and that deleting only the
SQLite database leaves custody keyrings/config/assets behind; remediation may
not instruct an author to move or delete the database file in isolation (LLP
0192 D-1/D-2).

The explicit pre-bind `--activate-startup-successor` flag is the sole cold
same-mode exception to exact identity equality. It requires the startup carrier,
a settled sessions predecessor, a seedless candidate, positive sessions
readiness, and a complete candidate pair that passes every ordinary preflight
and preparation predicate. Preflight runs once before and once under the closed
transition guard. The guarded same-mode transaction atomically advances the
schema manifest, complete active deployment identity, auth-scope bases, and
authorization witness before the prepared function generation publishes. A
cold process has no admitted predecessor requests, connections, or live
boundaries to project; startup constructs those process-local authorities only
from the committed successor before listener bind. The activation prints a
structured `snapback.startup-successor-activation.v1` line containing only the
old and new deployment identities.

Ordinary `snapback start` never implies that flag. Managed `snapback dev` may
retry automatically with it only after the first native start returned a
structured `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` containing both the
preflighted observed identity and the pinned expected identity. A malformed,
incomplete, incoherent, capability-unsupported, unloadable, or storage-invalid
candidate therefore remains fail-closed: it either never authorizes the retry
or fails the guarded transaction without a success event. The managed event
`startup-successor-activated` names the database plus both identities. This is
successor activation, not subset/superset admission: every candidate function,
including a comment-only byte change or an added callable surface, remains part
of the newly activated complete pair.

### Consume ordering: dev to sessions

Before binding any listener, startup:

1. reads and cross-validates all four durable keys;
2. reads the single startup carrier and performs the full pair preflight;
3. requires its identity to equal `requestedDeployment` byte-for-byte;
4. prepares/compiles the function generation without making it callable;
5. reruns LLP 0057's catalog collision, catalog readiness, and keyring checks;
6. requires the complete `sessionActivationReady` predicate below;
7. in one SQLite transaction, activates the auth catalog, writes the staged
   schema to `schema_manifest_capability_aware`, writes the permanent poison to
   `schema_manifest`, deletes the staged key, and writes settled sessions state
   with `sessionsEverActivated: true` and generation `N + 1`;
8. publishes the already-prepared function generation through an infallible
   in-process pointer swap; and
9. only then binds the listener and admits app data.

Every fallible artifact/provider operation precedes step 7. Process-local
coordinator, invalidation, connection-registry, and worker construction that
depends on the newly activated catalog occurs after step 8 but before step 9.
This is a defined safe durable intermediate interval: admission is closed and no
listener is bound; failure exits, and restart revalidates the pinned carrier and
rebuilds those prerequisites before bind. A crash after step 7
but before bind observes a complete settled sessions record on restart and again
requires the same startup carrier. No intermediate durable state has a relocated
manifest without poison or poison without sessions-ever-activated state.

Only after step 1 has produced a valid pending snapshot may a failure in steps
2–6 commit a `quarantined` record at generation `N + 1`. That one transaction
preserves `active: dev`, preserves the staged schema/requested deployment while
rewriting the staged record to the same generation `N + 1`, and keeps app data
refused. A step-1 invariant failure follows §Corrupt-state boundary and writes
nothing. A quarantined startup may then serve only the diagnostic surfaces
listed above. It never resumes dev app data merely because the sessions
transition failed.

### Fresh sessions provisioning

A fresh database may consume a v1-sessions startup carrier in one pre-bind run,
but it still performs the actual staged protocol as two durable transactions:

1. after complete pair/capability and static catalog preflight, the **stage
   transaction** applies additive app-schema DDL, then runs the optional seed,
   then writes the complete staged key and pending mode state; and
2. after rereading and validating that pending snapshot, the **consume
   transaction** activates the auth catalog, writes the capability-aware active
   manifest, writes the permanent legacy poison, deletes the staged key, and
   writes settled sessions state.

Seed failure rolls back the first transaction in full, including DDL. No
listener is bound between the commits. A crash after the stage commit and
before consume leaves an ordinary valid pending snapshot; restart with the same
carrier resumes at consume and never restages or seeds twice. Thus a fresh
pre-bind run has no listener-visible pending interval, but it has no
direct-activate exception to the durable protocol either.

### Explicit unstage and re-stage

`--clear-desired-auth-mode` is pre-bind, local-operator-only, and mutually
exclusive with `--allow-auth-downgrade`. It changes `desired` back to `active`,
deletes the staged key, clears quarantine/requested deployment, increments the
generation, and restores `available` in one transaction. It never deletes auth
tables, changes the active manifest, or removes poison.

A privileged provisioning correction during pending/quarantine performs a full
preflight, replaces the staged record, clears quarantine, increments the
generation, and returns to `pendingRestart`. A malformed or unauthorized
correction changes nothing.

### Same-mode provisioning

A provision whose requested mode equals a settled active mode does not enter
`pendingRestart`, but it still uses the complete pair preflight. V0-dev keeps
the existing hot-apply behavior; before sessions has ever activated it writes
the active manifest to both manifest keys and updates `activeDeployment` in the
same transaction as schema effects; afterward it leaves poison in the legacy
key while still atomically updating the capability-aware manifest and
`activeDeployment`. V1-sessions prepares the full function generation before
its transaction, updates the capability-aware manifest and `activeDeployment`
atomically with schema effects, and only then swaps the prepared generation.
The next process start requires a startup carrier matching that new active
deployment. A same-mode request never makes the legacy key parseable and never
bypasses branch authorization because its hashes happen to match.

V1-sessions same-mode provisioning is nevertheless an authorization
**activation** and uses the mode-admission barrier even though durable mode
remains settled. After complete read-only preflight, the transition owner closes
new admission and waits for every predecessor finite invocation and retained
HTTP response body to drain. Under the write lane it repeats preflight, commits
the schema/deployment and authorization event in one SQLite transaction,
receives that transaction's exact `AuthorizationCommitWitness` plus minimum
commit-version floor, publishes the prepared function generation, and projects
all live invalidation obligations and successor snapshots from that exact pair
while the predecessor remains closed. The transition owns one private
projection admission for those local reruns/publications; it is never exposed
as ordinary request admission and is dropped before reopen. Only after every
required projection succeeds does the controller retire the predecessor and
open a fresh increasing `admissionEpoch` for the still-settled sessions mode.

The Local commit/private-projection phase returns a committed carrier that
still owns the closed `ModeTransitionGuard`; it does not reopen admission.
An independently owned task then performs connection terminal lifecycle and
the clone-shared runtime mode-state publication outside the committing Local
scope, and finally consumes the carrier to publish the successor epoch. The
request owns only a join waiter. Cancellation or unwind after the durable cut
drops the carrier fail-closed and can neither reopen before terminal
propagation nor strand a known commit merely because the client disconnected.

**The composed authorization commit witness is owned here** (this Spec owns
same-mode activation): the completing transaction returns the concrete
`AuthorizationCommitWitness` (committed authorization version and
incarnation) together with the containing `NetworkDeploymentCommit.state`
that carries the active deployment identity. That exact pair is the concrete
same-mode instance of LLP 0053's `CompositeWitness` vocabulary and LLP 0059's
"durable witness floor"; this Spec does not claim those fields occupy one Rust
struct. The **minimum commit-version floor** is the version at
or above which every projected obligation and successor snapshot must be
witnessed; a projection carrying a witness below the floor is rejected. The
record shape is pinned here so the name is not used normatively while defined
only in code.

Projection is conservative over the complete retained-live registry, not only
queries that already own an authorization scope. An
`authorityIndependent` predecessor subscription is terminally resynced with
`clearRetained` and removed before reopen, because the successor may remove the
function or make it authority-dependent and the old subscription has no scope
to which an obligation can be attached. A data-only seed whose exact storage
witness says `event: false` does not fabricate an authorization epoch, but it
still reruns retained queries under the private projection admission so their
snapshots include the committed rows. Preprojection errors are propagated to
the transition; the ordinary post-commit mutation fanout's diagnostic-only
fallback is forbidden at this activation boundary.

Unscoped predecessor frames already queued for one of those connections are
also unfenced. Before removing the subscription, activation converts any
nonempty durable backlog through the existing sticky-overflow transition: all
old lanes are cleared, pending room resync epochs are preserved, and one
connection-wide `outbox_overflow`/`clearRetained` sentinel remains. Therefore
an old `live_replace` or `live_delta` cannot transfer ahead of the activation
resync after the successor cut.

A confirmed rollback reopens the unchanged deployment under a fresh admission
epoch. An ambiguous durable outcome, function/publication failure after a known
commit, invalidation projection failure, or mode-state publication failure
leaves admission closed with `SNAPBACK_AUTH_MODE_PENDING` (while preserving the
primary typed failure where one exists); it must never reopen the predecessor
or guess which policy is active. An identity-equal no-op still crosses the
sessions barrier so its result cannot become a bypass around quiescence, though
it has no authorization witness to project.

The transition guard enters both durable-commit closures in fail-closed
posture. Only an explicit typed `RolledBack` result may re-arm predecessor
reopen; an unwind or otherwise unclassified exit is treated like an ambiguous
post-commit failure and leaves admission closed.

**Projection-root retention at the committed-carrier cut (2026-08-01).** The
private projection admission is a counted root whose clones the publication
effect guards retain through the after-Local owner batch, and that batch
flushes only after the commit closure's Local scope exits. The
committed-carrier validation therefore proves "no foreign root is in flight"
— the transition's own projection root may still be counted while its
retained publication owners drain — and the strict all-roots-dropped gate
moves to successor publication, which runs after the batch has flushed.
Treating the retained projection root as a foreign admitted root at the
carrier cut misclassified every same-mode evolution with at least one
attached live subscription as an ambiguous post-commit failure: the reload
reported `SNAPBACK_AUTH_MODE_PENDING`, admission never reopened, and the
operator had to restore the predecessor sources to boot (the A3 sweep's
headline defect,
`issues/closed/20260801-0137-a3-live-subscriber-wedges-watch-reload.md`).
"Dropped before reopen" is unchanged: a successor epoch still cannot accept
work while any clone of the projection root is alive.

### Sessions-to-dev downgrade

Consume of a staged v0-dev downgrade fails
`SNAPBACK_AUTH_MODE_DOWNGRADE` unless `--allow-auth-downgrade` is present. With
the flag, startup:

1. preflights and prepares the exact requested v0-dev carrier;
2. revokes every durable session through LLP 0057's revoke-all transaction;
3. for a `ReadyV2` catalog, transactionally deletes every durable agent
   credential, scoped token, grant, invitation, and pairing request while
   retaining agent principals and `_auth_scope_bases`; a recognized legacy
   `ReadyV1` catalog has none of those tables and skips this step;
4. clears only process-local capture-mailbox entries and connection grants
   available at pre-bind;
5. writes the v0 manifest to the capability-aware key, leaves the legacy poison
   untouched, deletes the staged key, and settles active/desired at dev with
   `sessionsEverActivated: true`; and
6. emits an operator audit fact before binding.

It deletes no user, identity, catalog, app, session, or scope-basis row. Revoked
sessions and deleted agent authority do not resurrect when sessions is later
re-enabled; agents require fresh credentials and fresh consent. A pre-auth
binary remains unable to open the database because the legacy key stays
poisoned forever.

Without the flag, startup quarantines the transition at the next generation,
rewrites the staged record to that generation, preserves `active: sessions` and
`desired: dev`, and serves only the pending-state diagnostic surfaces. It does
not silently resume sessions app data and does not revoke or delete anything.

### Crash and publication traces

| Pause/failure boundary | Only allowed durable observation |
| --- | --- |
| Before stage transaction | old settled state; no staged key |
| After stage transaction | complete staged record plus pending state; app data refused |
| Quiescence deadline | unchanged durable state; old epoch retired/cancelled; same mode reopened under a fresh epoch |
| Fresh sessions after stage, before consume | complete valid pending snapshot; restart resumes consume with the same carrier |
| Before consume commit | old active mode plus pending/quarantined requested deployment |
| After consume commit | complete new active manifest, settled state, and (once sessions ever activated) exact poison |
| Before/after unstage commit | complete pending/quarantined state or complete old-mode settled state |
| Before/after downgrade commit | complete sessions pending state with sessions and all five agent-authority classes unchanged, or complete dev settled state with all sessions revoked, all five agent-authority classes absent, principals/scope tombstones retained, and poison retained |

SQLite transaction atomicity supplies the durable cut. The in-memory mode
generation and function pointer publish only from a committed record and before
listener admission. There is no repair path that guesses which side of an
ambiguous commit won: startup rereads the four keys and accepts only a complete
invariant-satisfying state.

## Shared invocation authority

### Five internal type layers

The five names below count **type layers**, not authority variants. The names are
normative. The existing room-permission `AuthContext` in `crates/snapback/src/ephemeral.rs` is
not reused. LLP 0055's dated amendment is authoritative for the current sealed
resolved-authority variants and handler projection where it extends the item-4
baseline below.

#### `WireAuthorityFields`

`WireAuthorityFields` is an ingress-only, untrusted presence map. Each known
legacy authority location is one of `Absent`, `PresentNull`, or
`PresentValue`; serde defaults may not erase this distinction. It covers:

- `HandlerInput.auth` and its `principal`, `session_id`, and `user_id` members;
- `CtxAnswerLedger.auth_fingerprint`;
- live subscribe/resume/unsubscribe owner auth;
- ephemeral `auth`, `principal`, `session_id`, `user_id`, and `custom_key` at
  their actual operation-specific locations; and
- any alias registered by the LLP 0031 route/operation registry.

It is never passed to a handler, persisted as resolved authority, or used as a
session credential.

#### `ResolvedAppAuthority`

The current sealed variant set is exactly:

```text
Anonymous
Session { ... }
DevImpersonation { ... }
ServicePrincipal { ... }
AdminBypass { ... }
System
```

Item 4 introduced all variants except `ServicePrincipal`. LLP 0055 later added
that sixth variant with the server-only actor, credential, grant, token,
effective-user, scope, generation, and expiry facts required for autonomous and
delegated agents. The Rust enum remains the source of truth for those internal
payload fields; this Spec owns the shared-gate rules, not a second frozen copy of
LLP 0055's service-principal record.

This value is server-only. A session comes only from LLP 0057 credential
resolution. Dev impersonation comes from a registered dev body-authority
resolver. The LLP 0031 direct runner may select that body user after its
ordinary `AdminRead` or `AdminWrite` check and does **not** require
`ImpersonationCapability`. The distinct host operation
`function.run --as-user/--as-role` may construct the same resolved variant only
after its separately registered `ImpersonationCapability` check. The audit fact
distinguishes `directRunnerBodyUser` from `hostOperationImpersonation`.
`AdminBypass` grants an operator access path but no app identity. `System`
carries no user.

Item 4 retains `authorityInstanceId` internally because LLP 0057 already stores
it, but does not expose an authority descriptor or use the id as authentication;
item 7 owns that wire/store contract.

#### `HandlerAuthProjection`

The current handler-visible projection, after LLP 0055's dated sealed-value
amendment, is exactly:

```ts
type HandlerAuthProjection = {
  userId: string | null
  sessionId: string | null
  isAuthenticated: boolean
  provider?: string
  roles?: readonly string[]
  kind?: "human" | "agent"
  actor?: {
    userId: string
    kind: "agent"
    grantId: string
  }
}
```

Own-key rules are exact:

- anonymous, `AdminBypass`, and `System` project exactly `userId`, `sessionId`,
  and `isAuthenticated`, with values `null`, `null`, and `false`;
- a real human session additionally projects `provider`, `roles: []`, and
  `kind: "human"`;
- dev impersonation additionally projects `roles` and `kind: "human"`, omits
  `provider`, and has a null `sessionId`;
- an autonomous `ServicePrincipal` projects its agent `userId`, null
  `sessionId`, `provider: "agent-credential"`, `roles: []`, and
  `kind: "agent"`, with no `actor` block;
- a delegated `ServicePrincipal` projects the effective human `userId`, null
  `sessionId`, `provider: "agent-credential"`, `roles: []`,
  `kind: "human"`, and the sealed agent `{userId, kind, grantId}` actor block;
  and
- `isAuthenticated` is true if and only if the resolved authority carries a
  user.

The projection is allocated with `Object.create(null)`, and every listed key is
an own, non-accessor data property. The object, roles array, and every nested
value are deep-frozen before application code evaluates. Therefore
`Object.getPrototypeOf(ctx.auth) === null`; `Object.prototype` pollution cannot
add visible authority. The projection has no getter, proxy, raw token,
generation, authority-instance id, credential/token secret, admin reason, or
room permission set. LLP 0055 owns the service-principal non-widening semantics
and the related rule-language `actorKind`/`isDelegated` projections; those rule
inputs are not extra own keys on this handler DTO.

#### `PreparedAuthority`

`PreparedAuthority` is immutable and contains the output of the composed
production boundary:

```text
durable transitionGeneration and process-local admissionEpoch
active AuthMode and ServerProfile
registered route/operation identity and effective policy
ResolvedAppAuthority
HandlerAuthProjection
authority audit fact
operation-level availability/protocol decision
```

The route/operation registry and middleware first select the effective policy,
allowed carrier, protocol offers, and source classification;
`InvocationGate::prepare_admitted_authority` then owns the immutable
mode/admission/wire/source/projection result. `PreparedConnectionAct` separately
owns the exact connection-grant/effect fence for connection-bound HTTP and
WebSocket acts. This composition, rather than either type in isolation, is the
normative shared gate. Functionless operations—including
ephemeral publish/delete/subscribe, live owner acts, standalone
acknowledgements, and connection operations—consume this type plus their own
closed operation inputs. They never invent a function id or construct a
`PreparedInvocation`.

#### `PreparedInvocation`

`PreparedInvocation` is immutable and contains:

```text
PreparedAuthority
function id/kind and closed AuthRequirement
invocation id
function-specific availability decision
```

It is the only authority-bearing input accepted by the query, mutation, action,
live-rerun, and nested-invocation runtime seams. The wire sidecar and credential
bytes have been consumed before this type exists.

### Gate algorithm

The composed route middleware plus `InvocationGate` performs this order:

1. require an invariant-valid, `available`, settled durable mode generation and
   capture the current process-local `admissionEpoch`;
2. resolve the effective LLP 0031 route/operation policy;
3. inspect `WireAuthorityFields`; under sessions reject any forbidden presence
   with `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` before considering a valid bearer;
4. resolve `ResolvedAppAuthority` from the policy-selected carrier, or inherit
   it for a nested call;
5. validate every presented credential, even when the later target function is
   `public`;
6. enforce operation-level live, retained, replay, and protocol fences that do
   not depend on a function definition;
7. construct/deep-freeze the null-prototype handler projection; and
8. return `PreparedAuthority` or fail before operation/runtime evaluation.

A handler entry then calls
`InvocationGate::prepare_function(preparedAuthority, functionIdentity)`, which:

1. loads the closed function definition and `AuthRequirement`;
2. enforces that requirement against the already-resolved authority;
3. enforces function-specific capability and surface rules, including the
   `authorityIndependent` exception; and
4. returns `PreparedInvocation` or fails before handler evaluation.

The closed route, operation, and `InvocationSource` registries determine whether a source stops after
authority preparation or must refine to a function invocation. There is no
nullable function slot and no catch-all variant: adding a source requires an
explicit authority-only or function-backed case. Exhaustive registry tests must
prove every HTTP route, WebSocket frame operation, local/nested entry, and system
exception has exactly one classification. The bootstrap handshake is the sole
diagnostic discovery exception and cannot authorize later work.

Both durable generation and process-local `admissionEpoch` are checked again
atomically at write commit and response/live publication. A stage or timed-out
barrier that retires an epoch therefore prevents late success, callback, or
nested work from crossing the boundary.

Credential precedence under sessions remains LLP 0039/0057's: a current bearer,
otherwise anonymous; malformed/unknown is `SNAPBACK_AUTH_REQUIRED`;
expired/revoked is `SNAPBACK_AUTH_SESSION_EXPIRED`; ordinary superseded use
beyond grace is `SNAPBACK_AUTH_CREDENTIAL_SUPERSEDED`. A legacy body field is
always `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`, even beside a valid bearer.

### Complete gate coverage

The following are not separate authority implementations. Each calls
`prepare_authority`; each handler-backed entry additionally consumes the
`PreparedInvocation` produced by `prepare_function`, while an authority-only
entry consumes `PreparedAuthority` directly:

| Entry | Authority source / rule |
| --- | --- |
| HTTP query | optional session in sessions; dev body authority in dev |
| HTTP mutation and mutation-settlement acknowledgement (`/client-mutations/acknowledge`) | same; queued replay additionally fenced — settlement is deliberately bound to the authority-descriptor plane |
| invalidation acknowledgement and manual retry (`/live/authorization-invalidation/*`) | connection-bound authority seam; owned by the authorization-invalidation program (LLP 0059 item 6) and carries no queued-replay/descriptor fence |
| HTTP action | same; gate errors remain inside the HTTP-200 `FunctionRunResult` envelope after transport admission |
| local query/mutation/action API used by server and tests | explicit registered admission, never a default `AuthInput` |
| direct admin runner | sessions always gets anonymous projection plus `adminBypass` audit; dev may select its LLP 0031 body user after ordinary `AdminRead` (query) or `AdminWrite` (mutation/action), with no `ImpersonationCapability`; existing secret-read/write gates remain |
| host-op `function.run --as-user/--as-role` | `DevImpersonation`, only after `AdminWrite` plus `ImpersonationCapability` |
| cron | `System`; authenticated target rejected at manifest load |
| action to `ctx.runMutation` | inherits the outer prepared authority, then enforces the target mutation requirement |
| live initial query and every rerun | owner-derived prepared authority; auth-scoped admission fence below |
| HTTP and WebSocket ephemeral operations | connection-bound authority seam; item 5 supplies the actual binding |
| WebSocket subscribe/resume/unsubscribe | connection-bound authority seam and exact live-owner predicate |

No code path may synthesize `HandlerInput { auth: default(), ... }` and call a
handler as a substitute for the gate. Exhaustive call-site tests fail when a new
invocation entry lacks a registered `InvocationSource` case.

### Dev mode

Dev mode preserves the legacy body authority only through registered `AppAuth`
operations. The gate centralizes its resolution and still enforces
`AuthRequirement`, so authenticated functions fail in development when the body
does not select a user.

For an HTTP request that carries a browser `Origin`, a body-selected user is
admitted only when that exact origin is the bound listener origin or appears in
the process's explicit loopback Dev-origin allowlist. A foreign localhost port
is not trusted merely because it is loopback. Non-browser/test callers that
send no `Origin` retain the trusted-local body-authority path. Managed Expo
registers its selected Metro origin before starting the backend; ordinary Vite
development uses the same-origin Snapback relay, while an intentionally direct
cross-origin dev server must set `SNAPBACK_DEV_AUTH_ORIGINS` explicitly.
Sessions mode continues to reject every body authority field before this
Dev-only rule can apply.

On every server profile, dev app-data binds loopback only. The CLI-only
`--allow-insecure-dev-auth` override is accepted only on non-production
profiles, emits an operator warning/audit fact, and is never persisted in the
database or accepted over HTTP. `prod` + dev serves health/identity/handshake and
refuses all app data even on loopback. A Vite or reverse proxy can deliberately
re-expose loopback dev auth; this Spec does not mislabel that opt-in as safe.

### Session mode body closure

Session-mode DTOs are closed variants, not legacy structs with fields ignored:

- query/mutation/action and acknowledgements reject `auth` and
  `ctx_ledger.auth_fingerprint` when present, including explicit null;
- live subscribe/resume/unsubscribe reject every owner-auth field;
- ephemeral publish/delete reject `auth`, `principal`, `session_id`, `user_id`,
  and `custom_key` at their sibling locations, including explicit null;
- ephemeral subscribe/unsubscribe reject `auth`, and their closed DTOs reject
  injected sibling identity fields as unknown; and
- HTTP and WebSocket twins deserialize through the same operation-owned schema.

`KeyMode::Custom` is a sessions manifest-load error. `Connection`, `Session`,
and `User` derive only from the bound authority. A missing required dimension
(for example anonymous + `User`) fails explicitly; it never becomes a shared
synthetic key. Collections with `RequireRoomPermission` refuse registration with
`SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` at the item-4 boundary. Item 6 now owns
protected-room admission; `KeyMode::Custom` remains refused until separately
designed.

### Live owner and replacement predicate

A sessions live subscription stores:

```text
LiveOwnerV1 {
  resolvedAuthorityKey,
  connectionGrantId
}
```

`resolvedAuthorityKey` is `Anonymous` or
`Session { userId, sessionId, generation }`. It contains no bearer. Item 5
supplies the generation-valid bound grant from which this key is derived.

Resume, unsubscribe, and explicit supersession all require **both**:

```text
stored.connectionGrantId == caller.connectionGrantId
AND
stored.resolvedAuthorityKey == caller.boundResolvedAuthorityKey
```

There is no `is_some()` short circuit. Anonymous ownership is connection-grant
ownership, not equality of two absent user fields. Supersession additionally
requires the ordinary query/function/argument identity match. The comparison
and the destructive replace/unsubscribe act occur under the same owner lock.
Connection B therefore cannot resume, unsubscribe, or supersede connection A's
subscription for either anonymous or authenticated authorities.

### Live and replay admission before later items

This is the historical landing matrix that allowed each later item to unlock
only its own axis. The shared gate enforced it rather than relying on kit
manners; items 5–8 have since consumed the named fences:

- before item 5 readiness, sessions cannot activate at all;
- after item 5 but before item 6, every auth-scoped durable subscribe/resume and
  protected ephemeral registration fails
  `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` before query execution or
  materialization; only item-4-proved `authorityIndependent` live may proceed;
- before item 7, any session-mode request carrying `clientMutationId` fails
  `SNAPBACK_AUTH_POLICY_UNAVAILABLE` with safe detail
  `{ "capability": "queuedReplay" }` before execution or settlement lookup;
  it does not misuse `SNAPBACK_AUTH_STALE_RESULT`, whose descriptor semantics
  do not exist until item 7; and
- before item 8, session-mode retained/offline read admission fails before any
  retained bytes are read or rendered.

Item 7 changes no live admission. Item 6 changes no retained admission.

## Bootstrap handshake

### Request and protocol offer

`GET /auth/session` is Public app data with optional session resolution. It is
the one `/auth/*` route that serves in dev and during
`SNAPBACK_AUTH_MODE_PENDING`. It accepts
no body and no query parameters. Its optional protocol offer is carried only in
the four decimal-integer headers named in §Normative vocabulary. Missing means
`null`; an unknown version is reported as unsupported, not rounded down.

After discovery, the kit repeats `x-snapback-auth-client-protocol: 1` on every
session-mode online app-data/provider request and connection open. It repeats
the surface-specific headers on subscribe/resume, queued replay, and retained
admission respectively. The shared gate validates those headers on the request
that creates or acts on the surface; a prior handshake is not a transferable
bearer and server correctness does not depend on remembering that a stateless
HTTP caller once completed one.

In settled sessions mode, a presented bearer is validated normally. In active
dev mode there is no session-bearer resolver, so the caller projection is
anonymous; presenting `Authorization` fails rather than becoming dev body
authority. During a sessions-to-dev pending transition, active sessions
resolution remains available for the handshake only. During dev-to-sessions
pending, the handshake remains anonymous until activation.

### Exact response DTO

```json
{
  "protocolVersion": 1,
  "serverStartupNonce": "opaque-public-process-id",
  "authorizationStreamIncarnation": "01890f3c-9d5b-7000-8000-000000000001",
  "transitionGeneration": 7,
  "activeMode": "sessions",
  "desiredMode": "sessions",
  "modeState": "settled",
  "appDataAvailability": "available",
  "quarantineCode": null,
  "clientProtocols": {
    "authClient": 1,
    "authInvalidation": null,
    "authorityDescriptor": null,
    "authorizedLease": null
  },
  "availability": {
    "onlineRequestResponse": {
      "available": true,
      "reason": null
    },
    "authScopedLive": {
      "available": false,
      "minimumAuthInvalidationProtocol": 1,
      "reason": "SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE"
    },
    "retainedReads": {
      "available": false,
      "minimumAuthInvalidationProtocol": 1,
      "minimumAuthorizedLeaseProtocol": 1,
      "reason": "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    },
    "queuedReplay": {
      "available": false,
      "minimumAuthorityDescriptorProtocol": 1,
      "reason": "SNAPBACK_AUTH_POLICY_UNAVAILABLE"
    }
  },
  "provider": {
    "key": "email-code",
    "available": true
  },
  "transports": ["bearer"],
  "authority": {
    "userId": null,
    "sessionId": null,
    "isAuthenticated": false
  },
  "authorityDescriptor": {
    "descriptorVersion": 1,
    "authorityInstanceId": "01890f3c-9d5b-7000-8000-000000000002",
    "sessionGeneration": 0
  },
  "deploymentIdentity": {
    "schemaVersion": "snapback.v1",
    "authMode": "sessions",
    "appId": "example-app",
    "schemaHash": "snapback.v1:sessions:schema:sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "bundleHash": "snapback.v1:sessions:function:sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    "inputsHash": "snapback.v1:sessions:inputs:sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  },
  "authorizedLease": null
}
```

This is the **current composed** response after the later item amendments, not
only the historical item-4 body. The Rust/schemars type is the sole current
closed shape for protocol version 1; LLP 0059 owns the required
`deploymentIdentity: DeploymentIdentity | null` amendment. Sessions mode
requires the six-field identity above to be non-null; a legacy dev database may
return null. The response is `Cache-Control: no-store, private`; it never enters
receipts, logs, or runtime snapshots.
`quarantineCode` is the stable safe code or null. `clientProtocols` echoes only
exactly supported offered versions; unsupported/malformed offers are null and
make the affected availability false.

**Exactness (amended 2026-07-14, ENG-24991).** The generated schema is exact
with the executable kit validator, not merely a superset of it. Every member
above — including the nullable ones (`quarantineCode`, `deploymentIdentity`,
`authorizedLease`, `authority.userId`/`sessionId`, and every availability
`reason`/protocol minimum) — is **required**: null is expressed by value, never
by omission.
`protocolVersion` is `const: 1` (a different integer is a different protocol);
protocol echoes and minima admit exactly `1` or `null`; `transports` is exactly
`["bearer"]`; an authenticated authority carries non-empty `userId`/`sessionId`
while an anonymous one carries nulls; and the `authorizedLease` capability
facts pin LLP 0053's protocol constants (`defaultMs`/`hardMaxMs` 86400000, the
clamp order, renewal/time-basis/rollback strings) with only `configuredMs`
variable. A shared corpus
(`tests/conformance/auth-session-parity.corpus.json`) is executed against both
the committed schema (`crates/snapback/tests/artifact_schemas_v0.rs`) and the shipped kit
validator (`demos/_kit/tests/auth-session-schema-parity.mjs`) and must produce
identical structural accept/reject verdicts. The one contextual exception is
`deploymentIdentity.appId`: the reusable schema requires a non-empty string,
while the configured kit also requires equality with its coordinator app id;
the corpus names those two verdicts explicitly. The dedicated auth-session
schema pins `descriptorVersion: 1` and canonical UUIDv7 authority-instance
grammar, and the corpus exercises those negative classes. Mutation input uses
the generic Rust `AuthorityDescriptor` plus runtime validation; its generated
shared type remains intentionally broader (`u32` at the type layer), so this
amendment does not claim a schema-level tightening for that separate consumer.

`deploymentIdentity` is itself exact: `dev` pairs only with `snapback.v0`,
`sessions` pairs only with `snapback.v1`, and no other schema version is
admitted. `appId` is non-empty and must equal the coordinator's expected app
when that boundary supplies one. Sessions hashes use their exact distinct
`schema`/`function`/`inputs` namespaces followed by exactly 64 lowercase
hexadecimal SHA-256 digits. A dev identity remains compatible with its legacy
non-empty v0 hash spellings but may not use the reserved `snapback.v1:` prefix.
The shared corpus includes positive v0 and v1 identities and per-field,
namespace, digest-shape, cross-mode/version, and cross-app negatives.

The same corpus pins both wire-visible generation boundaries:
`transitionGeneration` and `authorityDescriptor.sessionGeneration` each accept
`9_007_199_254_740_991` and reject `9_007_199_254_740_992`. Descriptor zero is
the anonymous/no-session sentinel; a durable authenticated session generation
is positive, and an attempted increment from the maximum fails closed.

The kit enforces the same closure from its side of the wire. Handshake
validation receives the exact offer tuple that request carried — captured once
per request and used for both the emitted headers and the echo comparison —
and accepts a `clientProtocols` member only when it is null or equals an
explicitly offered, locally supported version (v1). Any other non-null echo,
including an echo of an axis the request never offered, rejects the entire
response with `SNAPBACK_AUTH_HANDSHAKE_INVALID`; a "helpful" or hostile server
cannot grant a protocol the client did not negotiate. Contract consumes those
echoed axes for queued replay, authority descriptors, and retained reads only
through that validated projection, and when the transport publishes its offer
tuple (`client.authProtocols`) Contract additionally cross-checks each echo
against it, so an unsolicited echo can never enable a capability even behind a
nonconforming client projection.

Availability is computed, never caller asserted:

- all four app-data capabilities are false with reason
  `SNAPBACK_AUTH_MODE_PENDING` while state is not settled/available;
- settled dev reports the existing dev behavior and no protocol minima for its
  non-session surfaces;
- settled sessions requires item 5 plus auth-client protocol 1 for online work;
- auth-scoped live additionally requires item 6 and invalidation protocol 1;
- queued replay additionally requires item 7 and descriptor protocol 1; and
- retained reads additionally require item 8, invalidation protocol 1, and
  authorized-lease protocol 1.

There is no separate disposition header, version, DTO field, or protocol.
Per LLP 0053, `authInvalidationProtocol: 1` covers invalidation dispositions,
the composite witness, tombstones, query-instance identity, and acknowledgement
semantics as one must-understand protocol. Once item 6 is installed, a missing,
malformed, or older invalidation offer fails its protected surface with LLP
0053's `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`; before item 6, the
server reports `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` instead.
When served, `SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED` is HTTP 503 per
LLP 0012: recovery requires a capable client, not different request data.

`provider.available` additionally requires settled sessions and LLP 0057
provider readiness. Provider unavailability never leaks keyring details.
`authority` is deliberately **not** `HandlerAuthProjection`: the handshake uses
the separate closed `AuthSessionAuthority` with exactly three required own
fields, `{userId, sessionId, isAuthenticated}`. It never exposes handler-only
`provider`, `roles`, `kind`, or `actor`. The current `authorityDescriptor`,
`deploymentIdentity`, and `authorizedLease` members are the subsequently landed
item-7, LLP-0059, and item-8 amendments already represented in the generated
schema; their presence here does not retroactively assign their ownership to
item 4.

### Kit ordering

The kit caches a successful handshake only for the returned
`serverStartupNonce`, transition generation, and connection attempt. It must
complete a fresh handshake before:

- the first online app-data operation;
- request-code/exchange or any auth-bearing request;
- `POST /connection/open`;
- first subscribe and every resubscribe/reconnect; and
- promoting retained bytes or queued work into an online surface.

Health may precede the handshake. Offline cold boot may render only according
to the last durably stored mode/authorization metadata, marked stale, and does
not count as handshake completion. A changed mode, startup nonce, or authority
invalidates the cached result. Item 5's now-installed `AuthCoordinator` owns the
actual clear barrier; at the item-4 boundary, the activation-readiness bit kept
sessions unavailable until that barrier existed.

The kit never treats capability-manifest support as current app mode and never
uses a successful handshake from one process after reconnecting to another.

## `auth.mintSession` activation

Item 4 removes item 3's placeholder refusal only when all of these are true:

- active and desired mode are both `sessions` and state is settled/available;
- server profile is `dev`, `test`, or `demo` (not `prod`);
- ordinary `AdminWrite` succeeds;
- the independent LLP 0057 `ImpersonationCapability` succeeds; and
- the provider is ready.

The operation takes only the closed email args from LLP 0057, runs the normal
find-or-create identity and session-mint transaction, returns
`CredentialSecret` under `Cache-Control: no-store`, and records
`issuedBy: admin`. It accepts no app-data body authority. Rescue remains
dev/test-only; item 4 must not broaden it to demo.

## Activation-readiness and later-item fences

The capability/runtime authority carries these exact facts. **This exhibit is
the item-4 boundary snapshot**: at item 4, the first seven facts are true and
the later-item facts (`connectionBinding`, `twoPhaseRevocation`, `authCoordinator`,
`sessionActivationReady`) are false. Later items **flip their own facts to true**
as they land (item 5 has, per §Summary), so a live runtime composes more true
facts than shown here — read the JSON as the boundary exhibit, not current
reality, exactly as §Live and replay admission brackets boundary-vs-current
behavior.

```json
{
  "authProgramReadiness": {
    "routeRegistryEnforced": true,
    "existingSurfaceClosure": true,
    "adminSecretReadEnforced": true,
    "secretReadProcessPrerequisites": true,
    "providerCore": true,
    "sharedInvocationGate": true,
    "stagedMode": true,
    "connectionBinding": false,
    "twoPhaseRevocation": false,
    "authCoordinator": false,
    "authorizationInvalidation": false,
    "authorityDescriptor": false,
    "authorizedLease": false,
    "sessionActivationReady": false
  }
}
```

`sessionActivationReady` is derived as:

```text
routeRegistryEnforced
AND existingSurfaceClosure
AND adminSecretReadEnforced
AND secretReadProcessPrerequisites
AND providerCore
AND sharedInvocationGate
AND stagedMode
AND connectionBinding
AND twoPhaseRevocation
AND authCoordinator
```

Items 1–3 supply the first, second/third, and fifth build facts respectively;
item 4 supplies `sharedInvocationGate` and `stagedMode`; item 5 supplies the
three remaining build facts. Each is a positive server-owned fact from its
implementing registry/module, never absence of a diagnostic. A sessions stage
may be validated and stored, but consume quarantines before catalog/poison
activation with `SNAPBACK_AUTH_POLICY_UNAVAILABLE` and safe blocker names until
every build fact and the process fact is true. These readiness facts assert that
the implementations and construction paths are registered and available; they
do not falsely assert that catalog-dependent process objects already exist.
Those objects are constructed in the admission-closed, listener-free durable
intermediate interval defined in §Consume ordering, and bind is the final proof
that all of them exist together. No test-only environment variable
or HTTP input may override the production readiness authority; embedded unit
fixtures may construct the closed readiness type directly without making that
constructor public.

`secretReadProcessPrerequisites` is instance-specific and true only when the
serve process was launched with `--ready-file P`, the master admin credential
has been initialized, and the process has prepared LLP 0017's owner-only
`P.secret-read-root` plus the mint verifier needed by
`snapback secret-read-mint --ready-file P`. The trusted ready descriptor, root,
and one-shot proof verification must all bind to this process's
`serverStartupNonce`; a URL or console credential alone is insufficient. A
serve process without a ready file deliberately has no mint bridge and cannot
activate sessions.

Before consume, startup validates that it can create and atomically publish the
owner-only sidecar/descriptor state. After listener bind, app-data admission
remains closed until the root sidecar and trusted ready descriptor have both
been published for that same startup nonce. Publication failure opens no app
data. For a valid pending transition, a process-prerequisite failure is an
eligible readiness quarantine. For an already settled sessions database,
restarting without these prerequisites returns
`SNAPBACK_AUTH_POLICY_UNAVAILABLE`, performs no durable write, binds no app-data
listener, and does not manufacture a quarantined sibling state merely because
`active == desired`.

The complete admission matrix is:

| Installed items | Sessions admission |
| --- | --- |
| 1–4 | cannot activate; pending consume quarantines before effects |
| 1–5 | online finite request/response and proved `authorityIndependent` live only; auth-scoped live, retained reads, and queued replay refused |
| +6 | auth-scoped live unlocks only with auth-invalidation protocol 1 (including its dispositions); retained remains refused |
| +7 | queued replay unlocks only with descriptor protocol 1; no live/retained change |
| +8 | retained reads unlock only with auth-invalidation protocol 1 and authorized-lease protocol 1 |

ENG-24607 makes hosted-target readiness a target-owned five-axis descriptor.
The local target reports the four deployment axes unavailable/process-local
and bearer v1 as XSS-exposed, so its derived hosted-auth fact remains false. A
local `prod` profile or operator flag is not evidence that a reverse-proxied
deployment satisfies any axis.

## Diagnostics and failure semantics

LLP 0012 remains the owning diagnostic registry and now registers item 4's
shared code/status classes, including the predecessor's existing schema-parse
failure. This Spec pins their producer semantics and safe-detail boundary.

| Code | Locus and meaning |
| --- | --- |
| `SNAPBACK_AUTH_MODE_PENDING` | 503 for ordinary app data/Public attest while pending or quarantined |
| `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT` | stage-time; exact 30000 ms monotonic barrier expired, retired work was cancelled, and durable state is unchanged |
| `SNAPBACK_REQUEST_BODY_TIMEOUT` | 408; an admitted request body did not finish arriving within the 20000 ms ingest deadline |
| `SNAPBACK_AUTH_MODE_DOWNGRADE` | pre-bind refusal when a sessions-to-dev consume lacks the explicit flag |
| `SNAPBACK_AUTH_MODE_STATE_CORRUPT` | startup; four-key or record invariant failed; no quarantine or durable write |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_REQUIRED` | pre-bind; settled/pending sessions needs the single carrier |
| `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` | pre-bind; carrier pair differs from the pinned deployment |
| `SNAPBACK_AUTH_TRANSPORT_INSECURE` | startup; sessions plaintext non-loopback, or dev non-loopback without its non-prod override |
| `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` | 400; any forbidden legacy field is present under sessions |
| `SNAPBACK_AUTH_POLICY_UNAVAILABLE` | 503 capability/readiness fence, including pre-item-7 queued replay |
| `SNAPBACK_AUTH_INVALIDATION_UNAVAILABLE` | 503 pre-item-6 auth-scoped live/protected-room refusal |
| `SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION` | actual pre-auth predecessor rejects the v1 header |
| `SNAPBACK_SCHEMA_PARSE_FAILED` | pre-bind predecessor refuses the deliberately poisoned stored legacy manifest; no HTTP response |
| `SNAPBACK_CAPABILITY_UNSUPPORTED` | 503 when served; requested pair/required capability unsupported by knowing target |
| `SNAPBACK_AUTH_HANDSHAKE_INVALID` | **kit-produced**; a `clientProtocols` echo did not match the exact per-request offer tuple, or a required handshake field (descriptor version, incarnation UUIDv7) was malformed before custody change |

`SNAPBACK_REQUEST_BODY_TIMEOUT` and the **kit-produced**
`SNAPBACK_AUTH_HANDSHAKE_INVALID` are registered in LLP 0012. The former is a
reviewed server-produced HTTP 408; the latter is client-produced and therefore
has no server HTTP status. Client-produced codes are marked kit-produced in the
registry so their producer is unambiguous.

Existing LLP 0057 credential diagnostics retain their meanings and precedence.
Mode/artifact failures include only expected/observed versions, modes, identity
hash strings, capability names, and transition generation. They never include
artifact source, function body, seed values, path-bearing parse text, token,
code, address, key material, or impersonation carrier.

An unavailable queued-replay capability is not a stale-authority judgment.
`SNAPBACK_AUTH_STALE_RESULT` begins only with item 7's installed descriptor
contract.

## Acceptance

### Artifact and predecessor matrix

The auth-aware receiver acceptance table is exhaustive:

| Candidate | Expected |
| --- | --- |
| paired v0-dev | accept |
| paired v1-sessions | accept preflight; activation still item-5-fenced |
| v0-sessions | reject before hashes/effects |
| v1-dev | reject before hashes/effects |
| mixed v0/v1 pair | reject before hashes/effects |
| unknown version/mode | reject before hashes/effects |
| first sessions request missing either half | reject before hashes/effects |
| mismatched appId/inputsHash | reject before hashes/effects |
| malformed v1 namespace | reject before hashes/effects |
| unsupported pair or required capability | reject before hashes/effects |
| unknown required capability, even when candidate claims support | reject `SNAPBACK_CAPABILITY_UNSUPPORTED` before effects |
| unauthorized provision | reject before hashes/effects |

Every negative repeats with candidate identity strings equal to the currently
loaded strings where structurally possible, proving no equality shortcut bypass.
For each refusal the database/WAL, logical schema/version, functions, mode keys,
and seed are unchanged relative to the immediate snapshot.

**Predecessor evidence — committed and rerunnable.** Run
`scripts/verify-auth-mode-predecessor`; the named verification script invokes
the committed harness, which pins
the unmodified predecessor `1d6cafb6d35b159d19de257db03d69ef1fd218e8`
(verified as the exact parent of pinned child
`8da7b46bd5d665317f52c09437ce28a72a559709`, the first staged-mode commit) and
its Ibex gitlink
`f8d26ce889208fd5ee3b8d2a64b13787c37e5879`, builds its locked dependency
graph, and exercises its real HTTP and SQLite boundaries. It submits the v1
sessions pair against both a fresh database and an identical-content
v0-provisioned database, requires exact
`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`, and directly compares the database and
WAL byte snapshots around each refusal. A third case installs the exact poison
in a predecessor-created database, requires pre-bind
`SNAPBACK_SCHEMA_PARSE_FAILED`, no readiness/listener publication, and unchanged
database/WAL bytes. A connection sentinel probes the exact reserved port for
the entire asynchronous poisoned startup and records `listenerBound:false`
only when no TCP connection was accepted; missing readiness is not used as a
proxy for that fact. The machine-readable expected outcomes are committed in
[the predecessor receipt](../tests/acceptance/auth-mode-predecessor-v1.receipt.json)
and the harness compares every normal run against that receipt. Its ignored
build/source cache is accepted only when both pinned Git objects and the
provenance marker still match. Receipt format 2 also records the UTC verification
date, canonical runner command, exact harness SHA-256, Node version, platform,
and architecture. An ordinary run validates outcomes and harness provenance
without rewriting the receipt; the byte comparisons themselves execute at
runtime.

This historical build is intentionally excluded from the fast per-PR/local
proof. Its required manual cadence is monthly, before LLP 0058 ratification or
an auth-mode release, and after any change to the staged-mode predecessor cut,
poison/open behavior, predecessor harness, bootstrap path, or pinned Ibex
runtime. Ratification and release gates run
`scripts/verify-auth-mode-predecessor --require-current-evidence`, which fails
when the committed dated evidence is older than 31 days or names another
harness revision. Only an intentional successful
`scripts/verify-auth-mode-predecessor --update-receipt` refreshes that dated
record, so normal verification never makes the worktree spuriously dirty. A
scheduled GitHub lane is deferred while Actions billing is blocked
and the current credential-scrubbed workflows have no configured authenticated
path to fetch a missing private historical Ibex object; when both constraints
clear, this same named script is the command the scheduled lane must run.

Golden vectors pin all three exact `snapback.v1:sessions:*:sha256:` spellings,
the three LLP 0012 domains, the three constant framed items followed by `appId`,
the shared pair-level `inputsHash`, and 64 lowercase digest digits. A v0 control
proves its bytes and identity spellings are unchanged and contain no
`snapback.v1:` prefix. Capability tests obtain positive support only from the
closed server `TargetCapabilityId` registry, treat an older/missing
`supportedCapabilities` field as empty, and prove neither candidate assertions
nor absent `capabilityGaps` can authorize an unknown id. Schema/function
artifacts alone use v1; golden schemas prove capability, runtime, diagnostics,
and wire artifacts retain their existing versions with additive fields.

A same-mode v0 update proves both manifest keys and `activeDeployment` change
in one transaction. One-half updates succeed only while the complete attested
sibling remains loaded in that process; after restart, the durable deployment
identity alone cannot stand in for it and both manifest halves are required.
The sessions matrix additionally pauses a predecessor finite-query response
body, proves activation cannot commit until that body reaches its final sink,
then proves the exact durable authorization witness/floor is installed in the
live obligation store before the successor epoch admits work. A retained
authorized lease from the predecessor fails revalidation after the same cut.
Both direct and host-op `functions.load` carriers reject a raw v0 payload and
activate a valid one-half v1 payload only through the complete-pair barrier;
pending/quarantined and in-process sessions carriers cannot fall through to
the raw loader. Deterministic live cases exhaust projection sequencing and
prove admission stays closed, terminally resync both changed-to-protected and
removed authority-independent subscriptions, and prove an ordinary data-only
seed refreshes an auth-scoped snapshot without advancing authorization. The
authority-independent case leaves a predecessor `live_replace` queued and
proves activation replaces it with a clear-retained sentinel rather than
letting it transfer after reopen.

### Stage, consume, poison, and downgrade

Tests cover:

- stage-time and consume-time collision checks;
- generation closure with a paused query, mutation, action, nested mutation,
  cron invocation, live callback, and response publication;
- the exact 30000 ms monotonic quiescence deadline: the old admission epoch is
  retired, engine/cooperative cancellation is signalled, every late commit,
  response, callback, and nested effect is suppressed, a fresh epoch reopens
  the unchanged mode, and the result is
  `SNAPBACK_AUTH_MODE_QUIESCENCE_TIMEOUT` with no durable write;
- every crash boundary in §Crash and publication traces;
- every four-key corruption class returning
  `SNAPBACK_AUTH_MODE_STATE_CORRUPT` with logically unchanged keys and no
  quarantine, plus a representative corrupt-record regression that holds an
  uncheckpointed WAL open and compares the complete database and WAL bytes
  before and after refused open, contrasted with a valid pending snapshot whose
  transition-specific failure atomically rewrites both generations into
  quarantine;
- quarantine preserving old active mode while refusing app data;
- privileged re-stage and CLI unstage, with every unauthorized variant inert;
- fresh pre-bind sessions provisioning with DDL-before-seed ordering, seed
  rollback of DDL/state, separate stage and consume commits, and a crash after
  stage that restarts into consume without rerunning seed;
- settled sessions startup with correct, missing, swapped, mutable, oversized,
  and mismatched carrier files;
- ordinary mismatch refusal followed by explicit cold activation of a complete
  comment-only function successor against unchanged application rows, plus
  incomplete/incoherent and storage-invalid successor refusals that leave the
  predecessor deployment and rows intact;
- capability-aware reopen from the active key after activation;
- the exact legacy poison remaining after activation and downgrade;
- a pinned pre-auth binary failing database open with
  `SNAPBACK_SCHEMA_PARSE_FAILED`, binding no listener, and mutating nothing;
- the negative control where a missing legacy key demonstrates relocation alone
  would not satisfy the rollback backstop; and
- downgrade refusing without the flag, then revoking every session,
  transactionally deleting all five v2 agent-authority classes while preserving
  identity/app rows, agent principals, and scope-basis tombstones, and never
  resurrecting old credentials or consent on re-enable;
- failure injection immediately after session revocation and the five-class
  agent purge but before mode-state writes restores the pending/quarantined
  predecessor, every session generation, and every deleted authority row; and
- the same flagged downgrade succeeds on an exact ReadyV1 catalog by skipping
  v2-only tables while retaining the shared session-revocation semantics.

### Shared gate matrix

For every entry in §Complete gate coverage, tests prove:

- anonymous and authenticated projections use `Object.create(null)`, satisfy
  `Object.getPrototypeOf(ctx.auth) === null`, expose only own non-accessor data
  keys, and deep-freeze the projection and roles;
- a real session has `roles: []`; admin bypass/system remain anonymous;
- `authenticated` fails before handler evaluation in both dev and sessions;
- `public` with an invalid bearer still fails credential resolution;
- nested mutation authority is inherited and cannot be replaced by nested body
  input;
- action gate errors use the normal action envelope and commit nothing;
- a sessions direct-runner admin bypass never becomes user identity; the dev
  direct-runner body user succeeds with its normal AdminRead/AdminWrite and no
  impersonation capability, while host-op `--as-user/--as-role` fails without
  the distinct `ImpersonationCapability`;
- function-backed sources refine `PreparedAuthority` to
  `PreparedInvocation`, while every functionless ephemeral/connection/owner
  operation consumes `PreparedAuthority` and cannot supply a fake function;
- cron authenticated targets fail manifest load; and
- an unregistered/new invocation source cannot compile or fails the exhaustive
  registry drift test.

An instrumented handler records if evaluation begins; every pre-gate failure
asserts the marker remains absent and no commit/version/live output occurs.

### Body and ephemeral closure

The registry-derived HTTP and WebSocket sweep inserts each forbidden field at
every supported nesting location as both a value and explicit null. Sessions
reject every case with `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` or closed-DTO shape error;
a valid bearer does not change the result. Identity-looking keys inside ordinary
application args remain ordinary data and are not false positives.

`KeyMode::Custom` and protected permission collections fail sessions manifest
load/admission at their specified fences. `Connection`, `Session`, and `User`
derive from bound authority only; missing dimensions fail. Cross-user overwrite
and delete are negative for every permitted mode on both transports.

### Live owner negatives

Authenticated connection B and anonymous connection B each fail to resume,
unsubscribe, or supersede connection A's subscription even when they know its
subscription id and query args. A same-authority but different grant also fails.
The exact same owner/grant may resume or supersede; the owner comparison and act
are atomic. No absent-field short circuit appears in the implementation.

The historical pre-item-6 case proves an auth-scoped initial subscribe and
resume fail before initial query execution and consume no subscription
capacity. A proved `authorityIndependent` HostPlan positive control succeeds
once item 5 is present. A false/opaque declaration fails rather than broadening
the exception; current protected admission additionally follows LLP 0053.

### Handshake and later-item fences

Handshake tests cover dev, sessions, pending, quarantined, anonymous, valid
session, malformed/expired bearer, provider unavailable, every absent/unknown/
supported protocol header, and process restart. The response matches its
generated schema, uses no-store, and contains no credential/provider secret.

A network sentinel proves the kit performs the handshake before every listed
online boundary. A stale handshake from another startup nonce or generation is
not reused. Offline cold boot remains possible and marked stale, but no retained
or queued byte crosses to online use without current availability.

Readiness tests prove item 4 alone cannot activate sessions. With item 5 facts,
finite online requests work while auth-scoped live, queued replay, and retained
reads remain refused. Adding item 6 changes only live; adding item 7 changes only
queued replay; adding item 8 changes only retained reads. Missing or unknown
client protocol versions fail closed at the same server gate the handshake
reports.

The readiness fact inventory is closed and derived structurally, so omitting
any required item-1 route-registry, item-2 surface-closure/secret-read,
item-3 provider-core, item-4, or item-5 fact blocks consume. A representative
independent-negation test plus exact inventory/derivation equality prevents a
new fact from being admitted without joining that gate; this is not a claim of
one handwritten negative fixture for every fact. Process tests cover missing `--ready-file`, missing
master credential, unsafe/unpublishable `P.secret-read-root`, nonce mismatch,
and successful root/descriptor publication before app-data admission. A
settled-sessions restart without the bridge refuses nonmutatingly and does not
invent quarantine. Handshake fixtures contain no auth-disposition offer or
response field; item 6 uses only auth-invalidation protocol 1 for its
dispositions and rejects an old/missing client offer with
`SNAPBACK_AUTH_INVALIDATION_CLIENT_UNSUPPORTED`.

### Bind and operator effects

Dev non-loopback refuses without the explicit CLI-only non-prod override; `prod`
dev refuses app data on loopback too. Sessions plaintext non-loopback always
refuses with no override. Tests name the Vite/reverse-proxy residual rather than
asserting the process can detect it.

`auth.mintSession` succeeds only for settled sessions in dev/test/demo with both
AdminWrite and the exact process `ImpersonationCapability`. Admin alone, console
credential, secret-read lease/root, session bearer, wrong/restarted
impersonation carrier, dev auth mode, pending mode, provider failure, and prod
all fail without minting. Rescue remains dev/test-only.

## Implementation hand-off

Expected seams are:

- `crates/snapback/src/auth/mode.rs` for durable records, transition preflight, and startup
  consume;
- `crates/snapback/src/auth/invocation.rs` for the five type layers, current six-variant
  resolved authority, sealed handler projections, and shared gate;
- `crates/snapback/src/manifest.rs`, codegen, and committed schemas for closed manifest fields;
- `crates/snapback/src/storage.rs` for four-key atomic reads/writes and poison;
- `crates/snapback/src/server.rs`, `crates/snapback/src/live_wire.rs`, and `crates/snapback/src/ephemeral.rs` for registered
  ingress and owner replacement;
- `crates/snapback/src/cli.rs` for the three pre-bind flags and carrier validation; and
- `demos/_kit/client.mjs` plus generated DTO schemas for handshake ordering.

Internal Rust module names may vary. Durable keys, wire spellings, identity
namespaces, transition ordering, poison bytes, readiness derivation, and
acceptance outcomes may not vary without revising this Draft and its fixtures.

## Open questions

No open question grants implementation latitude for item 4. The explicit
extension points listed when this Spec was authored were subsequently consumed:

- item 7 added the authority descriptor and extended the handshake response;
- item 6 replaced item 4's narrow HostPlan-only authority-independence proof
  with LLP 0053's complete protected-query profile;
- item 8 added the retained lease/store protocols; and
- ENG-24607 assigned hosted deployment security and client-page XSS posture to
  LLP 0060 while deliberately leaving actual hosted capability future.

Cookies, opaque-Ibex authority-independence proofs, persisted trusted function
artifacts, and a general must-understand mechanism remain out of scope. None is
a fallback when the pinned v1 mechanism refuses.

## Dated amendment: the `app-cli.target` eligibility descriptor (2026-08-01)

[LLP 0062](./0062-generated-app-cli-and-code-mode.rfc.md) §4 requires a target
to state, as a served fact, which app-CLI principal classes it admits. This
Spec owns `supportedCapabilities`, so the descriptor lands here.

**It is a structured descriptor, not a ninth entry in the closed
`TargetCapabilityId` string set.** §4 needs a target to say *which* principal
classes it supports, whether it serves envelopes, whether it accepts
generation assertions, and the per-grant token cap the engine's cross-process
admission bound must read rather than hardcode — LLP 0055's constant would
drift silently against a copy. A boolean in the closed string set can carry
none of that, so the descriptor follows LLP 0060's structured-descriptor
pattern: an optional `appCliTarget` block on the capability manifest, carried
on every tuple by `/inspect` and echoed by sessions discovery
(`/app-api/current`'s `appCliDescriptor`) so the engine reads it
credential-free, before any principal is selected.

The v1 shape, `deny_unknown_fields` and Rust-owned under LLP 0037:

- `capabilityId` — `"app-cli.target"`;
- `principalClasses` — the closed vocabulary `anonymous | dev | session |
  agent`, listing only classes the target actually admits;
- `servesEnvelopes` — whether `/app-api/*` composition is available;
- `acceptsGenerationAssertions` — whether caller-asserted `expectedGeneration`
  is checked (this Spec's own admission, projected);
- `perGrantTokenCap` — optional; present only where an agent lane exists.

**Absence is capability-absent, and that is the load-bearing half.** §4's rule
that the engine "never infers any of this from a URL" has teeth only because
the fact exists to read: today a local dev server and a hosted gateway can
advertise the same admissible tuple, so distinguishing them by URL, profile
id, or correlated capabilities would be exactly the forbidden inference. A
target that declares no descriptor admits `anonymous` only — the engine still
calls anonymously and lets this Spec's invocation gate answer — and every
credentialed lane refuses client-side with
`SNAPBACK_APP_CLI_PRINCIPAL_UNSUPPORTED` rather than presenting a credential
to a target that never claimed to accept one.

Facts state what the target *supports*; they never prove transport locality
(which is why LLP 0062 §4's agent lane keeps its loopback condition
engine-enforced) and they stay distinct from the target's *current* auth
posture, which LLP 0012 already separates from static support: the local
target's descriptor lists `dev` and `session` together because it supports
both tuples, while the active tuple says which applies right now.

As declared 2026-08-01: the local target carries the descriptor
(`anonymous`, `dev`, `session`; envelopes and generation assertions both
true; no `perGrantTokenCap` until the agent lane lands). The
remote-service, workerd-conformance, and Cloudflare targets withhold it —
§4's matrix admits remote service only "once it advertises `app-cli.target`"
and puts hosted out of phase 1 — so each is honestly capability-absent rather
than inheriting a claim from the local declaration.

## Dated amendment: versioned seed staging (2026-08-03, LLP 0109 acceptance)

Accepted LLP 0109 (author acceptance 2026-08-03, decision sitting #2
extension, `issues/20260803-author-decision-sitting-2.md`) — its §3.1.1
specifies the closed pre-bind `StartupArtifactsV2` carrier whose
discriminated `seedInstall` branch composes this Spec's two transactions:
the **stage** transaction validates the complete pair and seed artifact and
atomically installs application rows, maintained projections, seed
identity/receipt, and pending deployment metadata without activating the
catalog binding; the **consume** transaction revalidates the staged
digest/stream/receipt, activates the catalog/provider binding, and
publishes the prepared function/routes generation. A crash after stage
restarts from the durable staged receipt and never reseeds; a failed or
quarantined consume leaves admission closed and the staged successor
reconcilable. Identity and the establishing receipt written at stage imply
no catalog admission until consume succeeds.

The accepted first landing (LLP 0109 §15.2) **defers that carrier**: no
`StartupArtifactsV2` ships, cross-mode versioned install refuses
`SNAPBACK_SEED_CROSS_MODE_UNSUPPORTED` before any stage or write, and
tooling supplies the existing `StartupArtifacts` carrier with its legacy
`seed` member absent, invoking the named `app.seed.*` operations only after
sessions activation has completed under this Spec's admission fence.
Sessions membership seed follows LLP 0109 §8's ordering — a recoverable
catalog-eligible principal precedes membership fixture validation, while
catalog activation stays behind this Spec's stage/consume fence (the
membership fixture lane landed 2026-08-01, LLP 0109 §18). This amendment
records the specified composition and the deferral; it claims no
`StartupArtifactsV2` implementation.

## Dated amendment: LLP 0204 granted capability links (2026-08-10)

**Commissioned by:** [LLP 0204](./0204-app-external-surfaces.rfc.md), D9.4,
the OQ9 ruling, and the 2026-08-10 author sitting's full granted-operation
extension; authority semantics are owned by LLP 0055's matching
[dated amendment](./0055-agent-principals-and-scoped-grants.rfc.md#dated-amendment-llp-0204-granted-capability-links-2026-08-10).

**Status:** commissioned design only. This section amends the closed type and
gate contract; it does not claim that any target constructs or admits this
variant.

### Sealed resolved-authority addition

[§`ResolvedAppAuthority`](#resolvedappauthority) is amended from six variants
to exactly seven:

```text
Anonymous
Session { ... }
DevImpersonation { ... }
ServicePrincipal { ... }
CapabilityLinkPossessor { ... }
AdminBypass { ... }
System
```

`CapabilityLinkPossessor` is a named service-principal authority class, not an
alias for `ServicePrincipal`, `Anonymous`, or `Session`. Its closed payload is:

```text
CapabilityLinkPossessor {
  linkId,
  linkGrantId,
  minterAuthorityRef,
  effectiveUserId,
  functionId,
  functionKind,
  scopeBasis,
  useOrdinal,
  deadline,
}
```

`minterAuthorityRef` is the sealed union defined by LLP 0055: either the exact
parent delegated-grant lineage or the exact direct-session mint lineage. The
payload contains no agent `actorUserId`, credential id, credential generation,
token id, session bearer, URL token, or bearer hash. `useOrdinal` and `deadline`
are server-derived invocation facts; the request cannot select either.

This explicit addition opens the otherwise closed set for exactly this carrier.
There is no catch-all bearer variant, structural duck-typing into
`ServicePrincipal`, or extension point by which a future secret class inherits
it. The Rust enum and its exhaustive source registry remain the source of truth.

### Construction and shared-gate order

Only the registered granted-link **POST invoke** operation may construct the
variant. The matching `CapabilityLinkBearer` resolver runs after route-level
request-secret capture/redaction and before function preparation. It must, in
one admission decision:

1. classify and hash-resolve the bearer without placing raw URL bytes in any
   authority or diagnostic object;
2. resolve the exact link and immutable link grant;
3. revalidate expiry, direct revocation, optional use bound, exposed function,
   kind and scope basis, argument-template binding, effective principal,
   minter authority and parent grant where present, integration status where
   present, and the local/trusted-local target gate;
4. atomically reserve the next use ordinal, or create the approval-pending
   result without executing, under the mutation rule; and
5. construct `PreparedAuthority`, then call `prepare_function` for the single
   bound function.

The inert **GET landing** operation resolves no app authority and remains
`InvocationAuthority::None`; mint and revoke resolve their ordinary session or
service minter rather than a possessor. No bare finite route, `/api/v1` route,
MCP tool, connection act, WebSocket operation, host operation, nested body,
cron source, local test entry, or anonymous fallback may construct this
variant.

The variant enforces the same effective-principal non-widening rule as a
delegated `ServicePrincipal`: every host-mediated read, write, trusted check,
and effect must pass both the possessor projection and the direct effective-
principal projection, with the stricter answer winning. The link grant's exact
scope is an additional intersection. Nested calls inherit the immutable
prepared authority and cannot replace its link/link-grant facts; the ordinary
entry-point and permission-backing effect rules continue to apply.

### Sealed handler and authorization projections

The handler-visible projection for this variant is exactly:

```ts
{
  userId: <effectiveUserId>,
  sessionId: null,
  isAuthenticated: true,
  provider: "capability-link",
  roles: [],
  kind: <effective principal's durable kind>,
  actor: {
    kind: "capability-link",
    linkId: <linkId>,
    grantId: <linkGrantId>
  }
}
```

This amends `HandlerAuthProjection.actor` into a sealed two-member union: the
existing agent actor `{ userId, kind: "agent", grantId }`, or the exact
capability-link actor above. The link actor deliberately has no `userId`; a URL
possessor is not a principal, and copying the minter's id here would falsely
attribute the call. The projection remains a deep-frozen null-prototype object
with exact own keys. It contains neither `minterAuthorityRef` nor bearer
material.

For declarative authorization, `auth.userId` and `auth.kind` are the effective
principal's facts, `auth.isDelegated` is `true`, and `auth.actorKind` is the
closed value `"capability-link"`. The direct baseline contains no actor, as for
ordinary delegated authority. Consequently the existing `isDirectHuman`
conjunction remains fail-closed: a link acting for a human has an actor and is
not a direct human session.

The server-derived attribution block names `actorKind: "capability-link"`,
`linkId`, `linkGrantId`, effective principal, and minter/parent lineage as
separate fields. It must not synthesize an agent actor id or report the minter
as the caller. Less-authorized projections may redact lineage, but may not
change the actor class.

### Mutation and plane fences

For a mutation or action, `prepare_function` can return only an approval-
pending result or a single-use prepared invocation. Approval execution
reconstructs this same variant from the frozen link snapshot after current
lineage revalidation; it never substitutes the approving session as execution
authority. Every `authorityCreating` and app-policy check remains conjunctive.

The hosted refusal is part of authority preparation, before link-use
reservation or handler evaluation. The variant is local/trusted-local only
until an explicit LLP 0055 hosted-plane amendment lands; target/profile names,
anonymous-link support, or absence of a capability gap cannot open it.

### Exhaustiveness obligations

An implementing spec must extend the enum match, handler-projection exactness
corpus, source registry, body-authority sweep, response attribution schema,
direct-projection non-widening fixtures, nested-call inheritance fixtures,
pending-effect reconstruction, and hosted admission matrix. Negatives must
prove that the same raw token on GET, a bare finite route, a wrong token class,
an expired/revoked/used link, a dead parent grant, a rotated token carrier with
a still-live parent grant, a terminally re-credentialed parent, a foreign
effective principal, and every hosted target either resolve exactly as LLP 0055
requires or fail before a handler marker is reached.

## Dated amendment: operational-readiness predicate binding (2026-08-10, LLP 0224 Phase 1)

LLP 0224's operational predicate binds to this Spec's existing settlement
facts as a read-only consumer. The application-level readiness fact
(`OperationalReadinessV1`, `crates/snapback/src/operational_readiness.rs`) is `ready` only
when the exact mode-state record is settled — `active == desired`,
`modeState == settled`, `appDataAvailability == available`,
`requestedDeployment == null`, `quarantine == null` — and, when the active
mode is `sessions`, the complete positive `sessionActivationReady`
derivation of §Activation-readiness and later-item fences holds. **The
predicate adds no authority and no override**: each conjunct is read from
the same server-owned registries this Spec names, never re-derived, and no
readiness input can move a mode-state key or bypass an activation fence.
This Spec already forces sessions activation, coordinators, and workers
before listener bind; the operational predicate additionally covers the
later package-level provisioning (`loadGenerated`) that produced the LLP
0224 pilot race — post-bind obligations settle before the
application-ready receipt may publish, while the host ready file's
pre-bind semantics are untouched.

## Status

**Accepted.** ENG-24597/item 4 is implemented. Executable pair matrices,
crash injection, route/operation parity, cross-transport authority negatives,
the pinned unmodified-predecessor harness/receipt, and the corrupt database/WAL
byte regression are its **committed, rerunnable** implementation evidence. LLP
0059/item 5 has
subsequently closed the activation fence for an explicitly staged local sessions
deployment.

Implementation completion alone did not make this foundational,
security-sensitive Spec Accepted. ENG-25001 closed the material review
findings, the blind FINAL4 Codex and Fable reviews both returned READY, and
Charlie Cheever explicitly ratified the resulting Spec on 2026-07-15. That
author decision advances this document only; it does not advance frozen LLP
0039.

The ENG-24996 review gate obtained a cross-family GPT (Codex) review of this
document on 2026-07-14 (round 1, verdict: NOT READY). A second dual-family round
(fresh Codex ultra + fresh Fable Max, blind, via /llp-super-refine) reviewed the
committed revision at `b11a6fa` the same day; both artifacts are archived with
provenance in
`reviews/0058-shared-invocation-authority-and-staged-auth-mode-protocol.{codex,fable}.md`.

### Review triage

Both families rate the design and implementation fidelity highly; the concerns
are spec-vs-code fidelity, over-claimed evidence, and hygiene. Dispositions:

**Resolved in text (round 2, executable evidence closed 2026-07-15):** the
Acceptance/Status over-claim was first corrected by separating committed tests
from the one-time ENG-24597 record; the subsequently committed pinned-predecessor
harness/receipt and corrupt database/WAL byte regression now make both claims
rerunnable;
`AuthorizationCommitWitness` defined and mapped to LLP 0053's `CompositeWitness`;
`SNAPBACK_AUTH_HANDSHAKE_INVALID` and `SNAPBACK_REQUEST_BODY_TIMEOUT` registration
account corrected to match LLP 0012's client-produced/HTTP 408 entries; the
§Activation-readiness JSON labeled the item-4 boundary exhibit; the 20 s
ingest-deadline collateral class named.

**Named defect obligations (ENG-25001 disposition):** all current code-fidelity
findings are closed. Live resume/unsubscribe/supersede retain and compare the
exact connection effect fence; raw loaders reject any non-v0-dev half before
effects; sessions preflight evaluates every module and export in a fresh VM and
retains the prepared generation; adopted applications are never fresh seed
targets. The composed registry/middleware, `PreparedAuthority`, and
`PreparedConnectionAct` boundary is normative above and is covered by exhaustive
route/operation registries. HTTP and WebSocket session ephemeral operations now
decode the same closed DTOs. Every online kit operation forces a current-process
handshake; its schema and executable validator require canonical lowercase
UUIDv7 identifiers and descriptor version 1. Ordinary HTTP ignores the
WebSocket-only offer carrier. Startup errors carry safe expected/observed
deployment identities and committed downgrade revocation facts are audited
before bind. The readiness dependency is resolved by the explicit
admission-closed, listener-free durable intermediate interval, and the deployment
identity security claim is the authenticated trusted-producer premise above.

The evidence-hygiene finding is closed by the committed harness and regression:
the receipt records the pinned outcomes, while each run performs the direct byte
comparisons. The split-document suggestion is left to the author. Closing these
findings did not itself ratify or advance the Spec; the explicit author
ratification recorded above did.

**FINAL3 disposition (2026-07-15):** the blind GPT review's material finding is
closed by making the five-class agent-authority purge normative in downgrade,
crash, and Acceptance text and by fault-injecting the post-purge/pre-state-write
rollback. Fable's READY review minors are closed by gating that purge to
`ReadyV2`, proving ReadyV1 downgrade, and adding shared-corpus
`sessionGeneration` max-safe/above-max-safe cases. Its LLP 0060-owned hosted
schema observation remains outside this Spec. The verbatim artifacts and
provenance remain in this document's Codex/Fable review ledgers.

The reviews advised and the author ratified after their material findings were
closed. This document is Accepted; LLP 0039 remains frozen.
