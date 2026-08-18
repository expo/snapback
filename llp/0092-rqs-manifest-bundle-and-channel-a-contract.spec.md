# LLP 0092: RQS manifest, bundle, and Channel A contract (rollout clusters 0C + 0D + 0E)

**Type:** Spec
**Status:** Draft
**Systems:** Sync, Realtime, API, Auth, Client integration, Deployment
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-24
**Revised:** 2026-08-16 (LLP 0270 wave 3 public-exact amendment: the
local/Ibex host and codegen now derive `rqsEligible` from the closed public
single-table proof without using app-authored `authorityIndependent` as an
admission input. The Cloudflare coordinator remains flag-gated pending its
port; protected admission and `publicInline`'s explicit disclosure assertion
are unchanged). 2026-08-10 (depth-one JavaScript route parameters derive from
the carried argument contract; HostPlan inference is unchanged — see the
2026-08-10 dated amendment). 2026-08-08 (§0E.6's step-3 top-level-only narrowing partially
lifted: `$param` references are admitted at object-reachable positions, typed
from the LLP 0131 argument contract, and literal members may be null, union,
array, or literal-node values — see "Dated amendment: structured route-group
arguments", `issues/20260808-route-group-argument-lowering.md`.)
2026-08-03 (`single_table_v1@1` producer boundary: the existing
derived `rqsEligible` fact also selects the class; the host emits/recomputes
its normalized node and capability record; authors still cannot assert
membership; semantic only.) 2026-07-24 (step-7 landing notes appended to the
step-2/step-3 dated amendment: Channel C consumption on the local arm —
todo-v2's authenticated register-mode boot with the client
`registeredSubscription` adoption seam, and graffiti's socket-less widget
read-mode surface; no contract changes, two recorded observations,
ENG-25458). 2026-07-24 (§0D.6 witness-bytes reservation replaced by the
caps LLP 0091's rung-2 amendment pinned, ENG-25457; the dated
step-2/step-3 amendment: the six reported step-2 divergences folded in and
the step-3 0C/0E landing notes — see "Dated amendment: step-2/step-3
implementation reconciliation", ENG-25454; and the dated step-4 amendment:
the Cloudflare arm — compiled routes manifest, HostPlan-subset eligibility,
read-mode-only bundle endpoint, gateway Channel A — see "Dated amendment:
step-4 Cloudflare arm", ENG-25455)
**Related:** LLP 0030, LLP 0031, LLP 0041, LLP 0051, LLP 0053, LLP 0076, LLP 0077, LLP 0090, LLP 0091, LLP 0270

## Summary

LLP 0090 (Accepted) defines resumable query snapshots and names six
prerequisite contract clusters in its Rollout sketch. LLP 0091 pinned 0A
(token & digest cryptography) and 0B (wire schemas). This spec pins the
remaining pre-implementation clusters:

- **0C — Manifest & admission:** the route→query manifest artifact, the
  `rqsEligible` served-manifest predicate and the codegen/served-manifest
  schema changes that carry it, `publicInline` as a codegen-compiled
  disclosure fact, the per-generation static dependency-summary artifact
  (rung-1 table-set certifier), and the authority-independent alias key for
  the client store. Decides 0090's **Q1** (manifest authoring surface).
- **0D — Bundle endpoint & connection ownership:** the finalized
  `POST /app/bundle` contract (schemas, modes, closed per-entry union),
  atomicity and the `SNAPBACK_BUNDLE_*` code registry, hard limits and
  resume resource-limit defaults, idempotency/replay-validity exactly as the
  LLP 0031 dated amendment pins it, attach-grace/reaping defaults, the
  local-arm pinned-read-transaction affordance, and the LLP 0031
  route-taxonomy entry.
- **0E — Channel A mechanics:** the HTML-safe serializer normative spec with
  **byte-pinned fixtures landed as files**
  (`tests/fixtures/rqs-serializer/`), the `packages/snapback-vite`
  `transformIndexHtml` seam ownership list, the response-mechanics contract,
  the degrade-to-unhydrated-shell failure posture, and the bounded anonymous
  evaluation budget. Decides 0090's **Q2** (args parameterization).

Everything here is contract; no behavior ships with this document.
Terminology, token/`resume`/`meta` shapes, the `SNAPBACK_RESUME_*` registry,
and the `generation`/`versionStream` definitions are LLP 0091's — this spec
**extends** that contract (new codes, new schema exports, one closed 0091
open question) and never forks it. Wire and artifact schema additions land
through LLP 0051's drift gates; the new route enters LLP 0031's enforced
registry with this cluster's implementation, under the dated
`DeclaredPublicApplicationData` / pending-registration-owner amendment 0090's
0F cluster already added there.

## 0C — Manifest & admission

### 0C.1 Route→query manifest artifact

**Q1 decision — authoring surface.** The route→query manifest is a
**schema-adjacent declaration compiled by codegen** into a generated
artifact, exactly like functions: apps author a `snapback/routes.mjs` beside
`schema.mjs`/`functions.mjs` using a kit `defineRoutes` helper, and codegen
compiles it to `snapback/generated/routes.manifest.json`, whose canonical
hash is the `routeManifestHash` component of `resumeConfig` in `generation`
(LLP 0091 §0A.6). The served instance admits and serves it beside the
functions manifest through the same ensure/deploy machinery (the admission
surface LLP 0076 extended).

Reasoning against the alternatives 0090 Q1 recorded:

- **Per-surface file** (e.g. under `surfaces/react/`): the manifest must be
  evaluable server-side without app JS, versioned into `generation`, and
  admitted against the served functions manifest. A surface-local file lives
  on the client side of that boundary — multiple surfaces per app would
  fragment authority, the server would need a collection step with no single
  canonical hash to bind into `generation`, and surface-local authoring
  invites drift between what a surface renders and what the server serves.
- **Derived by the packaged dev loop** (LLP 0041): inference from view code
  or observed traffic is not a *declarative statement* (0090 D1.4 requires
  assembling a bundle "without executing view code"), produces unstable
  hashes, and has no home on the deploy-time-compiled Cloudflare arm. The
  dev loop may later *suggest* entries; it never authors the artifact of
  record.

Compiling through codegen gives the manifest the same lifecycle as every
other trusted artifact: deterministic bytes, a canonical hash, drift gates,
and one admission point.

**Artifact schema** (exported as `routes.manifest.schema.json` in the
artifact-schema family, `crates/snapback/tests/artifact_schemas_v0.rs`):

```
routesManifest = { formatVersion: 1,
                   app: string,
                   routes: [ routeEntry ] }
routeEntry    = { route: string,            // pattern, e.g. "/board/:boardId"
                  queries: [ querySpec ],   // 1..32 (0D.2 query-count limit)
                  persist?: boolean,        // default true; LLP 0091 §0A.5 opt-out
                  registerGroupEligible?: true } // codegen-derived; LLP 0112
querySpec     = { function: string,         // exported function name
                  args: argsMapping }       // §0E.6 (Q2), mapping version "params-v1"
```

- **Route patterns** are exact strings: `/`-separated static segments plus
  `:name` parameters, each `:name` matching exactly one non-empty path
  segment. No wildcards, regexes, optional segments, or trailing-slash
  variants in v1; two entries whose patterns can match the same path are
  refused at admission. Matching against concrete URLs is the serving
  seam's job (§0E.3); the bundle endpoint takes the pattern string itself
  and never does URL matching.
- Entries are per-route, not per-query: one `routeEntry` names every query
  the route needs, which is the unit the bundle evaluates at one commit.
- `registerGroupEligible:true` is a codegen-derived client-adoption fact, not
  bundle invocation authority. Codegen emits it only when every child is a
  `LiveQuery` and every `$param` target is string-typed; served-manifest
  admission rechecks any asserted `true`. Absence preserves the broader read
  bundle route while omitting LLP 0112's generated register reference.
- `publicInline` is deliberately **not** a `routeEntry` field. Whether a
  route is Channel A-eligible is derived: every named query must carry the
  codegen-compiled `publicInline` fact (§0C.3). A route-manifest author can
  select queries for preload; they cannot widen disclosure.

**Admission** (ensure on the local arm, deploy on Cloudflare): every
`querySpec` is validated against the served functions manifest — the
function exists, is a query, and the args mapping is statically valid
against its arg schema (§0E.6). An entry naming an unknown or non-query
function, or an invalid mapping, refuses the manifest with a coded load
error; per 0090 D1.4, manifest presence authorizes *preload selection* only.

### 0C.2 The `rqsEligible` served-manifest predicate

`rqsEligible` is the single predicate 0090 defines (Authorization scope). On
the local/Ibex target, LLP 0270 D1/D2 amends its inputs for the public-exact
default:

> on local/Ibex, a query is `rqsEligible` iff it is a public LiveQuery and the
> owner/codegen proves the exact LLP 0053 closed-inputs,
> authority-independent single-table profile.

For the local/Ibex host this spec pins it as a **derived, never authored**
served-manifest fact:

- **Inputs.** The application-semantic `auth: 'public'` declaration plus the
  generated/served HostPlan and read summary. Codegen and the server each
  prove that the operation is a LiveQuery with no auth, membership,
  auth-scope, runtime-clock, runtime-id, config, media-projection, or opaque
  handler dependency. App-authored `authorityIndependent` is not an input to
  this public-exact admission. It remains a validated explicit assertion for
  existing non-retention consumers such as `publicInline`; it cannot cause a
  failed host proof to pass.
- **Closed-inputs proof.** The obligations are exactly those
  `validate_retainable_query` (`crates/snapback/src/manifest.rs`) enforces for the
  retainable class — HostPlan query runtime (no opaque JavaScript), a
  complete read summary (today: the `singleTable` summary whose table set
  equals the plan's), and declared-equals-observed authorization dependence
  (empty, for an authority-independent query). Channel B persistence places
  the query in LLP 0053's retainable class, so these are not new
  obligations; `rqsEligible` reuses the existing proof machinery.
- **Derivation rule.** At every codegen generation and local ensure, codegen and the
  server compute, per function: `rqsEligible = public LiveQuery ∧
  owner closed-inputs/public-exact proof holds`, evaluated **non-erroringly** — a query that
  fails the proof is simply not eligible (`rqsEligible: false`); derivation
  never turns an otherwise admissible manifest into a load error. (The
  existing rule that a *declared* `retainable: true` query failing the
  proof is a load error, `SNAPBACK_AUTH_UNDECLARABLE_RETENTION`, is
  unchanged — declaration is a promise, derivation is a measurement.)
  Authors do **not** need to declare `authorityIndependent: true` or
  `retainable: true` for RQS retention: the RQS/materialization store keys on
  the owner-derived class alone.

Target posture for the 2026-08-16 amendment:

| Target | No-declaration public-exact admission | Status |
|---|---|---|
| local/Ibex (`crates/snapback/src/manifest.rs`) | codegen and the served host independently derive the class; `authorityIndependent` is not an input | Implemented |
| Cloudflare (`cloudflare/src/rqs-host.mjs`) | still requires a validated `authorityIndependent: true` flag in addition to the closed HostPlan/read-summary proof | **Pending** — port the owner-derived proof and its adversarial acceptance before removing the flag |

Thus every unqualified no-declaration/default-retention claim in this dated
amendment is local/Ibex-scoped. The older Cloudflare amendment below remains
normative for that target until the pending row lands.

**Schema changes this carries:**

- Codegen (`packages/snapback-codegen`): the functions manifest gains the
  authored `publicInline` boolean (§0C.3); no authored `rqsEligible` field
  exists anywhere.
- Local served manifest (`crates/snapback/src/manifest.rs` `FunctionDefinition` family): accepts
  `publicInline` (serde-renamed like `authorityIndependent`), validates it
  per §0C.3, computes `rqsEligible`, and carries both on the served
  functions manifest **and its public projection** (`PublicFunctionManifest`
  — clients need both facts: `rqsEligible` drives the alias-key promotion
  check in §0C.5 and token expectations; `publicInline` is already
  disclosed by the behavior it authorizes). Both are facts about a public
  query's classification, not handler source, so the projection-trim rules
  are unaffected.
- Everything on the local/Ibex arm that 0090/0091 key on the predicate — token minting, bundle
  `resume` presence (§0D.1), Channel B persistence, D1.1 admission
  (`SNAPBACK_RESUME_NOT_ELIGIBLE`) — reads this one served-manifest fact.

> **Dated local/Ibex producer projection (2026-08-03, `single_table_v1@1` owner
> acceptance):** this same derived, non-erroring `rqsEligible` fact now also
> selects `single_table_v1@1`. For a selected function the host reconstructs,
> emits, and exact-recomputes the owner-normalized `SingleTablePlanV1` and
> `NodeCapabilityBindingV1`; a mismatch refuses node admission. Authors still
> cannot assert `rqsEligible`, the class id/version, the normalized record, or
> its capability binding. A function for which derivation returns false gains
> no node record, plan hash, proof, or QMK, and its existing API and legacy
> behavior remain unchanged. This producer boundary is semantic only: it
> changes no served-manifest schema, implementation, or capability claim.

### 0C.3 `publicInline` — a codegen-compiled disclosure fact

`publicInline: true` is authored on the function definition (an option to
`defineLiveQuery`/`defineQuery`, beside `authorityIndependent`) and compiled
by codegen into the functions manifest. It is **never route-manifest
authored** (0090 Q1 pinned this half already: only the authoring surface was
open, and that surface is the schema-adjacent function definition).

- **Codegen acceptance:** `publicInline: true` is accepted only on a query
  that also carries a *valid* `authorityIndependent: true` declaration
  (which entails `public` under the existing invariant). v1 has no consumer
  for a public-but-authority-dependent inline query, so the narrower rule
  is kept fail-closed; relaxing it later is a schema change with its own
  review, not a default.
- **Served-manifest validation** re-enforces the same rule; a manifest
  carrying `publicInline` without valid `authorityIndependent` is refused
  at load.
- **Semantics** (0090 Authorization scope; LLP 0031 dated amendment): a
  disclosure permission — this already-public query's rows may be embedded
  in tokenless HTML (Channel A) and served as read-mode public bundles
  under the `DeclaredPublicApplicationData` response-sensitivity class. It
  grants no invocation authority. Channel A / public-bundle admission
  re-checks the codegen-compiled served-manifest facts (auth requirement,
  `authorityIndependent`, closed-inputs, `publicInline`), never the route
  manifest author's word.

### 0C.4 Per-generation static dependency-summary artifact (rung-1 certifier)

The rung-1 table-set proof (0090 D1.3) requires a **complete certified
dependency summary** for the token's exact `generation`. Contract:

- **Name and identity:** the `rqs-dependency-summary`, a server-internal
  artifact derived once per `generation` at deploy (Cloudflare) or ensure
  (local) time and cacheable for the generation's lifetime. It is not a
  wire artifact and has no client-visible schema; its shape is pinned so
  both arms derive it identically.
- **Shape:** a map `queryArtifact → { tables: [string, ...] }`. An entry is
  present **only** when the function's read summary is complete (today:
  the `singleTable` HostPlan summary — the same completeness predicate as
  §0C.2); the table set is the summary's table set. Incomplete, opaque, or
  unrecognized summaries produce **no entry**.
- **Derivation source:** the codegen read-summary facts as validated into
  the served manifest (`read_set_summary`) — deploy/analysis-time static
  derivation, never per-execution capture (which would reintroduce
  per-client server state, 0090 D1.3).
- **Consumption rule:** at rung-1 admission, the table-set proof applies
  only when the artifact holds an entry for the token's `queryArtifact`
  *and* the token's `version` is at or above the journal's retained floor;
  a missing entry means the table-set proof is **unavailable** and the
  resume takes the global proof or rung 3 (fresh `LiveReplace`), refusing
  with `SNAPBACK_RESUME_JOURNAL_FLOOR` semantics only where the floor is
  the cause. Summary drift (an artifact disagreeing with the served
  manifest's generation) is impossible by construction — the artifact is
  keyed by and derived from the same generation — and any lookup surprise
  falls back to rung 3, never partial proof.

### 0C.5 Authority-independent alias key and checked promotion

The client store's canonical identity is
`[provider, query, authority, canonicalArgs]`
(`externalStoreIdentity`, `packages/snapback-client/external-store.mjs`).
Channel A preloads are minted under anonymous authority, but the consuming
session may be authenticated; without a rule the preload would land in an
anonymous-keyed store and the authenticated subscription would open an
empty parallel one (0090 D2).

- **Alias key:** preloaded and persisted state for an `rqsEligible` query
  is stored under the sentinel authority component
  `"rqs:authority-independent"` — i.e. identity
  `[provider, query, "rqs:authority-independent", canonicalArgs]`. The
  sentinel is a reserved literal; it can never be a real authority label,
  and non-`rqsEligible` state must never be stored under it.
- **Checked promotion rule:** when a subscription for query `Q` with args
  `A` opens under real authority `a`, the client checks, in order:
  1. the current served manifest marks `Q` `rqsEligible` (client-visible
     fact, §0C.2) — otherwise any alias entry for `(Q, A)` is discarded
     and a normal `[provider, Q, a, A]` store is used;
  2. an alias-key entry exists and its `meta` identity matches the current
     instance (`app`, `generation`, `versionStream` — LLP 0091 §0B.1
     fields) and its rows verify against `meta.contentDigest`;
  3. on success, the subscription **adopts the alias store as its store**
     — one store, one subscription, rows surfaced retained/pending,
     `resumeFromToken` from the alias entry's token. No caller-keyed
     duplicate store is created for `rqsEligible` queries; the alias key
     *is* their canonical identity.
  Any check failing discards the alias entry (fail closed to fresh
  subscribe). This is the acceptance fixture of 0090 rollout step 3: a
  logged-in browser consumes the anonymously minted preload without a
  duplicate store or subscription.
- Tokens remain authority-neutral (0090 D1.1); the alias key changes store
  identity only, never invocation authority — the subscribe is authorized
  under the caller's own credential exactly as before.

## 0D — Bundle endpoint & connection ownership

### 0D.1 Route and schemas (finalizing 0090 D1.2's provisional shape)

**Route:** `POST /app/bundle` (both arms; the Cloudflare gateway forwards it
to the coordinator DO like other app-data routes). Schemas export as
`app.bundle.input.schema.json` / `app.bundle.output.schema.json` through the
LLP 0051 gates.

```
request  = { route: string,              // exact manifest route pattern (§0C.1)
             params: { [name]: string }, // route params, all strings
             mode: "read" | "register",
             idempotencyKey?: string,    // register mode only, required there
             authInvalidationProtocol?: 1,
             authorizationNamespaces?:  // register mode, exact manifest order
               [ queryNamespace | null ] }

response = { commitVersion: u64,         // PORTABLE_STORAGE_VERSION_MAX cap
             generation: string,         // LLP 0091 §0A.6
             versionStream: string,      // LLP 0091 §0A.7
             entries: [ entry ],         // one per querySpec, manifest order
             connection?: { connectionId: string,   // register mode only
                            grant: string,
                            attachDeadline: u64,     // ms epoch, §0D.4
                            authorizationInvalidation?: object } }
```

**Per-entry closed union** (schema parity fixtures are a conformance
obligation; `resume` is LLP 0091 §0B.1's shape):

```
entry = { function: string,
          args: object,                  // fully substituted, validated args
          rows: [ ... ],
          resume: resume | null,         // present iff rqsEligible; null otherwise, BOTH modes
          subscriptionId?: string,       // register mode only
          authorization?: object }       // register mode, auth-scoped entries only:
                                         // LLP 0053 scope/invalidation projections
```

- `resume` presence keys on `rqsEligible` (§0C.2) and nothing else:
  read-mode entries for non-eligible queries return rows with
  `resume: null`; register-mode auth-scoped entries carry
  `subscriptionId` + `authorization` and `resume: null` (0090: no
  auth-scoped RQS resume state in v1).
- Every snapshot in a bundle is evaluated at `commitVersion` — the
  single-commit invariant — and every `resume.token` is minted at that
  same `(version, contentDigest)` under LLP 0091 §0A.
- **Modes:** `read` (default posture; anonymous callers allowed for
  `publicInline`-class routes) creates no server-side state. `register`
  additionally creates the live registrations at the same commit cut under
  the pending-registration owner of the LLP 0031 amendment; it is scoped
  to credentialed callers (§0D.3).

**Registered authorization-adoption amendment (2026-07-28, LLP 0112).**
`authInvalidationProtocol: 1` opts the registered connection into LLP 0053
authorization invalidation. The server refuses an unknown protocol value; a
nonempty `authorizationNamespaces` array requires protocol 1 and must have
exactly one position per manifest query. Each auth-scoped position supplies
the caller's never-reused namespace for that child subscription; an explicitly
`authorityIndependent` position is exactly `null`. `public`,
`publicInline`, and `AuthRequirement::Public` do not change that predicate: a
public query whose results can still vary with caller authority remains
auth-scoped. Sessions-mode register adoption requires protocol 1; the
protocol-free form is confined to the settled local-development dev authority
and returns no authorization projections. Read mode refuses both fields. The
protocol value and positional namespace array are part of the idempotency
replay-validity scope. This preserves the ordinary live-query invalidation
identity instead of inventing a bundle-local one.

When the negotiated connection has LLP 0053 authorization invalidation,
`connection.authorizationInvalidation` is the exact closed
`AuthorizationInvalidationConnection` descriptor an ordinary connection-open
response would carry. It is absent otherwise. Together with each auth-scoped
entry's `{scope,invalidation}` projection, this lets a registered client
install the authenticated expectation before publishing bundle rows; omitting
the connection descriptor on an auth-scoped registered response is a malformed
response, never permission to fresh-subscribe silently.

**HTTP status mapping** (codes are authoritative; statuses advisory):
400 malformed request / `SNAPBACK_BUNDLE_PARAMS_INVALID` /
`_MODE_INVALID`; 403 `SNAPBACK_BUNDLE_NOT_PUBLIC` /
`_REGISTER_REQUIRES_CREDENTIAL` / `_IDEMPOTENCY_SENDER_MISMATCH`;
404 `SNAPBACK_BUNDLE_ROUTE_UNKNOWN`; 409 `_IDEMPOTENCY_SCOPE_MISMATCH` /
`_IDEMPOTENCY_EXPIRED`; 413 the four `_LIMIT_*` codes; 429
`_RATE_LIMITED` / `_PENDING_CAPACITY`; 500 `_QUERY_FAILED`.

### 0D.2 Atomicity, limits, and the `SNAPBACK_BUNDLE_*` registry

**Atomicity.** A bundle succeeds entirely or fails entirely: any entry
evaluation failure, limit breach, or registration failure fails the whole
request with one coded error; a failed bundle mints nothing — no tokens, no
registrations, no connection grant, no pending owner (the LLP 0031
amendment's "strands no server state").

**Hard limits — pinned defaults** (server policy knobs, LLP 0010-style
coded refusals):

| Limit | Default | Code |
|---|---|---|
| Queries per bundle (= per route entry) | **32** | `SNAPBACK_BUNDLE_LIMIT_QUERIES` (admission also refuses the manifest entry at ensure) |
| Total rows per bundle | **5,000** | `SNAPBACK_BUNDLE_LIMIT_ROWS` |
| Total serialized row bytes | **4 MiB** | `SNAPBACK_BUNDLE_LIMIT_BYTES` |
| Evaluation wall time | **2,000 ms** | `SNAPBACK_BUNDLE_LIMIT_TIME` |
| Per-authority bundle request rate | **60/min** | `SNAPBACK_BUNDLE_RATE_LIMITED` |

The 32-query cap deliberately sits below the existing 64-per-connection
durable-subscription ceiling so a register-mode bundle can never arm more
demand than its socket may hold. Anonymous callers key the rate limit by
client address (see Open questions); they get no weaker limit class than
credentialed callers (LLP 0031 amendment).

**Registry** (stable, append-only, paralleling `SNAPBACK_RESUME_*`):

| Code | Cause |
|---|---|
| `SNAPBACK_BUNDLE_ROUTE_UNKNOWN` | named route pattern absent from the served route manifest |
| `SNAPBACK_BUNDLE_ENTRY_INVALID` | route entry invalid against the current generation (unknown function, mapping version unrecognized) |
| `SNAPBACK_BUNDLE_PARAMS_INVALID` | missing/extra params, percent-decode failure, schema-driven decode or arg-schema validation failure (§0E.6) |
| `SNAPBACK_BUNDLE_MODE_INVALID` | mode not `read`/`register`, or `idempotencyKey` present in read mode / absent in register mode |
| `SNAPBACK_BUNDLE_NOT_PUBLIC` | anonymous caller naming a route with any non-`publicInline` query |
| `SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL` | anonymous register-mode request; the refusal is explicit and the client retries in read mode — never a silent mode substitution (the client must not believe registrations exist) |
| `SNAPBACK_BUNDLE_QUERY_FAILED` | any entry evaluation failed (atomic failure) |
| `SNAPBACK_BUNDLE_LIMIT_QUERIES` / `_LIMIT_ROWS` / `_LIMIT_BYTES` / `_LIMIT_TIME` | hard limits above |
| `SNAPBACK_BUNDLE_RATE_LIMITED` | per-authority request rate |
| `SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH` | known key presented by a different sender-key identity (§0D.3) |
| `SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH` | known key presented with a different (generation, route entry, canonical args) scope |
| `SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED` | key's replay validity ended (attached or reaped); client starts a fresh boot attempt with a new key |
| `SNAPBACK_BUNDLE_PENDING_CAPACITY` | pending-registration registry at cap (§0D.4) |

Response bodies are excluded from logging per the
`DeclaredPublicApplicationData` rules; codes, identities, sizes, and timing
are loggable.

### 0D.3 Idempotency key and replay validity (per the LLP 0031 amendment)

Contract restated from LLP 0031's dated LLP 0090 amendment — that text is
authoritative; this section adds only wire parameters:

- **Key form:** client-minted **per boot attempt**, 22-character base64url
  (16 random bytes), the repo's id shape. Two concurrent same-user boots
  hold distinct keys and produce distinct registration sets.
- **Replay-validity tuple:** (authority, sender-key identity, credential
  incarnation, `generation`, manifest entry, canonical args,
  `authInvalidationProtocol`, positional `authorizationNamespaces`) — with the
  identity vocabulary being **LLP 0077's exact wire identities**:
  sender-key identity is the session family's **RFC 7638 JWK thumbprint**,
  credential incarnation is the issuance **`sender_replay_epoch`** (the
  `BoundGrantAuthorityV2` pair).
- **Retry while pending:** a retry with the same key and matching tuple
  **atomically supersedes** the pending set — fresh evaluation at a new
  commit cut, the same connection identity, and a **freshly rotated
  connection-grant secret**; re-returning a possibly-exposed secret
  verbatim is refused (the amendment's rotate-on-retry rule). The first
  execution and every retry each consume a proof nonce under LLP 0077.
- **Mismatches:** a different thumbprint presenting a known key refuses
  `SNAPBACK_BUNDLE_IDEMPOTENCY_SENDER_MISMATCH`; the same sender reusing a
  key outside its scope tuple refuses
  `SNAPBACK_BUNDLE_IDEMPOTENCY_SCOPE_MISMATCH`.
- **Validity end:** a key is replayable while its pending owner lives
  (until attach or reaping); afterwards
  `SNAPBACK_BUNDLE_IDEMPOTENCY_EXPIRED`.
- **Anonymous callers:** the tuple has no thumbprint/epoch for them, so
  register mode refuses to read mode
  (`SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL`).

### 0D.4 Attach grace, reaping, and pending-owner bounds

- **`attachDeadline`** = mint time + **30,000 ms** (default grace window; a
  server policy knob). Returned as an absolute server-clock ms timestamp.
- **Enforcement is exact at attach:** a socket presenting the grant after
  the deadline is refused regardless of reaper timing; the client falls
  back to an ordinary connection open + fresh subscribes.
- **Reaper cadence:** pending owners are swept at least every **10 s**;
  reaping disarms demand, releases subscription capacity, and invalidates
  the minted connection grant — a reaped boot leaves no armed demand and
  no usable grant (the amendment's acceptance obligation).
- **Bounds** (mirroring the bounded-grant posture): at most **256** pending
  owners per served instance and **8** per authority; over-cap refuses
  `SNAPBACK_BUNDLE_PENDING_CAPACITY`. Cloudflare persistence of pending
  owners lives in coordinator DO storage with the same bounds and reaping.

### 0D.5 Local-arm pinned-read-transaction affordance

0090 D1.2 requires the local arm to evaluate a bundle "inside one pinned
read transaction (or an equivalent storage-layer cut)". The mechanism
exists: **`with_pinned_read_snapshot`** (`crates/snapback/src/storage.rs`) wraps reads in a
transaction that pins one WAL read snapshot — the read lane already reads
query plans against a pinned snapshot head. Contract:

- **Read mode** evaluates every entry, reads `commitVersion`,
  `generation`, and `versionStream`, and computes every `contentDigest`
  inside **one** `with_pinned_read_snapshot` scope on the read lane. No
  new storage primitive is required; the cluster-0D work is holding the
  existing scope across N evaluations instead of one.
- **Register mode** runs on the write lane inside one immediate
  transaction (the existing serialized write connection): grant mint,
  pending-owner rows, registration rows, and the entry evaluations commit
  or roll back together — the atomic mint of the LLP 0031 amendment.
- **Cloudflare arm:** the coordinator DO's single-threaded execution and
  input gates provide the cut; both modes evaluate within one
  request-scoped storage view.

### 0D.6 Resume resource limits (extending LLP 0091 §0B.6 — same codes)

Defaults for the limits 0090 D1.1 names, refusing with the already-pinned
`SNAPBACK_RESUME_*` codes (no new namespace):

| Limit | Default | Code |
|---|---|---|
| Max token bytes | 1 KiB (pinned in LLP 0091) | `SNAPBACK_RESUME_TOKEN_OVERSIZE` |
| Max journal distance (head − token version) for rung-1 table-set / rung-2 | **10,000 commits** | `SNAPBACK_RESUME_BUDGET_EXCEEDED` |
| Replay/proof CPU-time budget per resume | **250 ms** | `SNAPBACK_RESUME_BUDGET_EXCEEDED` |
| Per-authority resume rate | **120/min** | `SNAPBACK_RESUME_RATE_LIMITED` |
| Max witness bytes | **1 MiB** serialized, and ≤ **4096** entries (pinned by LLP 0091's rung-2 amendment, ENG-25457) | `SNAPBACK_RESUME_WITNESS_OVERSIZE` |

Every limit answers with rung 3 or a coded refusal, never partial replay
(0090 D1.1). The rung-1 **global** proof (no commits at all) is exempt from
the journal-distance budget — it reads no journal.

This section also **closes LLP 0091's OQ3** (resume-keyring rotation knob
exposure, deferred to cluster 0D): **v1 exposes no operator config surface**
for rotation age or overlap; the §0A.1 defaults are fixed. The resume
keyring has no per-app security policy the way auth modes do, and a
misconfigured overlap window silently converts rotation into fleet-wide
refusal events. Revisit alongside a general admin-surface pass, not before.

### 0D.7 Route-taxonomy entry (LLP 0031)

| Axis | Value |
|---|---|
| Operation | `POST /app/bundle` (HTTP; no WebSocket twin) |
| Path class | app-data |
| Credential resolution | optional — session/agent credentials resolved when present; anonymous accepted (read mode, `publicInline`-class routes only). Scoped tokens legal (generated app-data route class) |
| Invocation authority | the caller's own, exactly as a subscription (LLP 0011); manifest entries authorize preload selection only |
| Effect | read mode: none. register mode: pending-registration-owner mint + connection-grant mint (the one sanctioned socketless-demand exception, per the dated amendment) |
| Response sensitivity | `DeclaredPublicApplicationData` for anonymous/public-entry responses; `ApplicationData` for credentialed responses; `connection.grant` is `[secret]` |
| Body logging | excluded (rows, bundles, tokens, grants); identities/codes/sizes/timing loggable |
| Cache-control | `no-store` (v1; 0090 Q6 owns any change) |
| Session overlay | compatible; registration handoff binds to the one-current-socket-session rule |

## 0E — Channel A mechanics

### 0E.1 HTML-safe serializer — normative spec

The Channel A boot payload is JSON embedded in a
`<script type="application/json" id="__snapback_boot">` element. Row data
is attacker-influencable, and a literal `</script>` inside any JSON string
terminates the element regardless of MIME type (0090 D2). The serializer:

1. Emits RFC 8259 JSON, **compact** (no insignificant whitespace), object
   keys in the order given by the document being serialized (the bundle
   assembler's order; fixtures preserve input-document order).
2. Applies, in **every string token — object keys and values alike** —
   these unconditional escapes, using lowercase hex digits:
   - U+003C (the less-than sign) → the six characters `\u003c`
   - U+003E (the greater-than sign) → the six characters `\u003e`
   - U+2028 (line separator) → the six characters `\u2028`
   - U+2029 (paragraph separator) → the six characters `\u2029`
3. Uses the standard short escapes for the characters RFC 8259 requires
   (`\"`, `\\`, `\b`, `\t`, `\n`, `\f`, `\r`; other C0 controls as
   lowercase `\u00xx`) and emits all other characters as raw UTF-8 —
   no additional escaping, so the fixture bytes are unique.
4. **No post-serialization transform may reintroduce the escaped code
   points.** The completed serialization — the exact bytes placed in the
   HTML document — MUST contain no `0x3C` byte, no `0x3E` byte, and no
   UTF-8 encoding of U+2028/U+2029 (`E2 80 A8` / `E2 80 A9`). This is a
   mechanically checkable whole-output property; conforming
   implementations assert it over the final bytes, after any templating,
   concatenation, or encoding step (this program's transport layers have
   twice silently decoded backslash-u escapes back into literals — the
   property check exists to catch exactly that class).

Escaping `<` neutralizes `</script>` (any case) and `<!--`; escaping `>`
neutralizes `-->`; the U+2028/U+2029 escapes keep the payload safe if it is
ever re-emitted into a JavaScript context. The client reads the element's
`textContent` and `JSON.parse`s it — the escapes decode transparently; no
other decoding step may run first.

**Embedded payload shape:** exactly the read-mode bundle response body
(§0D.1) plus the matched route pattern and the arm's attestation facts per
0090 D2 (`generation`, instance identity where the arm owns app identity).
No absolute backend origins ever appear in the payload (LLP 0030's
generated-app-facts rule); the client uses the relative base path.

### 0E.2 Byte-pinned serializer fixtures (landed with this spec)

The normative fixture corpus lives at **`tests/fixtures/rqs-serializer/`**:

- `cases.json` — the index: for each case, its name, the input file, the
  expected file, and what it exercises.
- `NNN-name.input.json` — the value to serialize (parsed as JSON; key
  order in the file is the serialization order).
- `NNN-name.expected.bytes` — the **exact** bytes a conforming serializer
  must produce. Byte-exact: no trailing newline, no re-formatting; the
  files were generated programmatically (not typed through an editor or
  transport that might decode escapes) and verified at generation time to
  contain no `0x3C`/`0x3E`/U+2028/U+2029 bytes.

Cases (per 0090 D2's acceptance list): `</script>` in values **and in
property names**, mixed-case variants (`</ScRiPt>`), the escaped-slash form
(a literal backslash before the slash — the `<` must still be escaped and
the backslash preserved), comment-opening/closing sequences `<!--` / `-->`,
nested objects and arrays with dangerous keys at depth, raw U+2028/U+2029
payloads, and a kitchen-sink composite. Implementations in every arm that
assembles Channel A HTML (the `snapback-vite` seam; the Cloudflare gateway
in rollout step 4) must reproduce every expected file byte-for-byte; the
conformance test homes are named in §Conformance.

### 0E.3 The `snapback-vite` transformIndexHtml seam — ownership list

Local Channel A integrates via a `transformIndexHtml` hook in the LLP 0030
managed Vite plugin (`packages/snapback-vite`) — the plugin today owns
lifecycle, proxy, and the virtual dev module; it gains the serving seam.
The hook owns, in order:

1. **Route matching after `basePath`/SPA-fallback normalization:** the
   matched URL is the original request path (pre-fallback — never the
   literal `/index.html` the fallback resolved to, which normalizes to
   `/`), with the configured Vite `base` stripped, query string and
   fragment excluded, and percent-decoding applied per segment before
   `:param` binding. Matching is against the route manifest's exact
   patterns (§0C.1); no match → untransformed shell, zero cost.
2. **Manifest lookup:** the generated `routes.manifest.json` for the app,
   loaded at bring-up like other generated artifacts (LLP 0041 boundary:
   codegen stays with the CLI). A route whose queries are not all
   `publicInline` in the served manifest is not evaluated — untransformed
   shell.
3. **Origin handling:** the seam calls the local backend itself (a
   read-mode `POST /app/bundle` over the plugin's loopback lane, under
   anonymous authority); no backend origin, admin token, or absolute URL
   reaches the HTML (LLP 0030's generated-app-facts rule).
4. **Pinned evaluation:** one bundle request per pageload; the pinned-cut
   guarantee is the endpoint's (§0D.5), not the seam's.
5. **Failure fallback:** §0E.5 — any failure serves the untransformed
   shell.
6. **Response headers:** §0E.4.

Step-3 reality note (0090): graffiti's web surface uses the Exact
`exactContractWeb` preset, not `snapback-vite`; adopting the plugin there
(or teaching the preset the hook) plus declaring `listCells`
`public` + `authorityIndependent` + `publicInline` is rollout-step-3 work,
not assumed here. `listCells` is an ordered query, so its digests are
`seq1` and its resumes take rung-1 global proofs or rung 3 — the correct,
expected v1 behavior for the step-3 target.

### 0E.4 Response mechanics

For a transformed `index.html` response:

- **`Cache-Control: no-store`** (v1 pinned; Q6 owns any caching future).
  Untransformed shells for unmanifested routes keep their existing caching
  — public-inline-only scope preserves shared-cache eligibility of the
  plain shell (0090 §Scalability).
- **Validators dropped:** any `ETag`/`Last-Modified` from the underlying
  static shell must be removed (or recomputed over the final bytes — with
  `no-store` there is nothing to validate, so dropping is the default);
  serving the static shell's validator on transformed bytes is forbidden.
- **`Content-Length` recomputed** over the final transformed bytes;
  **compression applied after** transformation, never before.
- **CSP:** the boot payload is a non-executable data block
  (`type="application/json"`); the seam injects no executable script and
  must not weaken or rewrite any CSP the response carries. (On the
  Cloudflare arm — rollout step 4 — the same contract applies when
  transforming `env.ASSETS.fetch` output, per 0090 D2.)
- **SPA fallback:** transformation composes with fallback serving — route
  matching uses the pre-fallback path (§0E.3 item 1); the fallback still
  serves the same single shell document when no manifest route matches.

### 0E.5 Failure posture and the bounded anonymous evaluation budget

**Degrade-to-unhydrated-shell, always:** bundle evaluation failure or
refusal (any `SNAPBACK_BUNDLE_*`), backend unready, manifest unavailable,
budget breach, serializer property-check failure — every failure path
serves the untransformed shell with today's boot waterfall. A pageload is
never failed, never blocked on retries, and never given partial data
(0090's "resume adds no new failure mode"). Each degrade increments an
observability counter keyed by the causing code (the underlying
`SNAPBACK_BUNDLE_*` code, or `SNAPBACK_INLINE_BUDGET_EXCEEDED` /
`SNAPBACK_INLINE_UNAVAILABLE` for seam-local causes); response bodies are
never logged (§0D.7).

**Bounded anonymous evaluation budget — pinned defaults** (per the LLP
0031 amendment's rate/budget posture; all are server/seam policy knobs):

| Budget | Default |
|---|---|
| Per-pageload evaluation wall time | **500 ms** (tighter than 0D's 2,000 ms endpoint cap; a pageload should degrade fast) |
| Embedded bundle bytes (serialized payload) | **256 KiB** |
| Anonymous per-client-address pageload-evaluation rate | **60/min**, degrade (not refuse) over the cap |

Over-budget pageloads serve the shell; the route stays reachable.

### 0E.6 Q2 decision — args parameterization (`params-v1`)

**Pinned: a minimal declarative mapping — named route params and literal
values only. No expressions, no defaults, no computed values.** The
`argsMapping` in a `querySpec` (§0C.1) is a JSON object mirroring the
function's args shape where each value is either:

- a **param reference** — an object whose **sole** key is `$param`:
  `{ "$param": "boardId" }`, naming a `:boardId` in the entry's route
  pattern; or
- a **JSON literal** (string, number, boolean, null, or arrays/objects
  composed of literals and references). To keep references unambiguous, an
  object literal containing a `$param` key alongside other keys — or a
  `$param` key with a non-string value — is refused at admission; a
  literal that needs `$param` as a data key has no v1 encoding
  (deliberate).

**Static admission checks** (ensure/deploy; failure refuses the manifest):
every referenced param appears in the route pattern; every pattern param
is referenced at least zero times (unused params are allowed — routes may
carry params for the view only); every required arg of the function is
covered; each reference's target arg-schema type is `string`, `number`
(integer or float), or `boolean` — any other referenced type refuses the
entry; literal portions validate against the arg schema statically.

**Per-request substitution** (bundle endpoint and Channel A seam):
route params arrive as percent-decoded segment strings; a reference
decodes by the target schema type — `string` as-is; `number` by strict
decimal parse, refused unless the value round-trips under the JCS number
rules (LLP 0091 §0A.2's canonicalization, so `argsHash` is well-defined);
`boolean` by exact `"true"`/`"false"`. The fully substituted args object
then passes the function's ordinary arg-schema validation — the same
validation any invocation gets — before evaluation. Any failure:
`SNAPBACK_BUNDLE_PARAMS_INVALID`. The D1.4 admission machinery is the
enforcement home; nothing about the mapping is ever evaluated client-side.

**Extension path:** the mapping grammar is versioned. This grammar is
`params-v1`, implied by `formatVersion: 1` of the manifest. Any richer
expressiveness (optional params, defaults, transforms) mints `params-v2`
as an explicit per-entry or per-manifest version with its own review —
an unrecognized version refuses the entry at admission (fail closed:
Channel A degrades to shell, bundles refuse `SNAPBACK_BUNDLE_ENTRY_INVALID`)
rather than guessing.

**Reasoning.** Everything beyond name-binding and literals is a DSL with an
authorization surface: an expression language evaluated server-side against
attacker-supplied URLs inside an anonymous, tokenless lane. Name + literal
covers the actual v1 targets (graffiti: `boardId` from the path; deep-link
screens: entity ids), keeps admission statically checkable against the arg
schema, and keeps `argsHash` canonicalization trivial. The versioned
grammar keeps the door open without leaving v1 holes.

## Dated amendment: step-2/step-3 implementation reconciliation (2026-07-24)

LLP 0090 rollout step 2 (ENG-25453, commit 1747a1e8) implemented cluster 0D
and reported six divergences from the text above; rollout step 3 (ENG-25454)
landed the deferred 0C pipeline plus the 0E seam and closed OQ-C. Per LLP
0004 the docs track the code; the implemented behavior is normative and the
sections above read as amended here.

**Step-2 divergences (cluster 0D):**

1. **§0D.5 read-mode cut is the serialized lane, not a pinned-read-snapshot
   scope.** The local arm evaluates read-mode bundles under the instance's
   exclusive borrow (`LocalSnapback::evaluate_bundle` holds `&mut self`, and
   every mutation path requires the same access), which is
   correctness-identical to the pinned-read-transaction phrasing: no commit
   can fall between entry evaluations. Moving read-mode evaluation onto the
   concurrent read lane inside `with_pinned_read_snapshot` is recorded
   follow-up work, not a v1 obligation.
2. **§0D.1 register-mode `authorization` shape is pinned.** The per-entry
   `authorization` object for auth-scoped register entries is
   `{ "scope": <LLP 0053 authorization-scope projection>, "invalidation":
   <authorization-invalidation projection> }` — the two projections the
   subscribe output already carries, under those exact keys.
3. **§0D.4 attach-past-deadline refuses with the existing connection code.**
   A socket presenting the grant after `attachDeadline` is reaped and
   refused with `SNAPBACK_CONNECTION_TOKEN_INVALID` — the connection-grant
   family's own code, since what expired is the grant's usability — not a
   new `SNAPBACK_BUNDLE_*` code. The client's fallback (ordinary connection
   open + fresh subscribes) is unchanged.
4. **§0D.3 a retry racing the pending first execution refuses
   transiently.** While a key's first execution is still evaluating (a
   reservation is installed but not yet committed), a concurrent retry with
   the same key answers `SNAPBACK_BUNDLE_PENDING_CAPACITY` rather than
   atomically superseding an in-flight mint; supersession applies only to a
   *committed* pending owner. The client retries after the first execution
   settles.
5. **§0D.1/§0D.2 NOT_PUBLIC posture, step-2 interim → step-3 satisfied.**
   Step 2 refused every anonymous read fail-closed (`publicInline` did not
   exist, so the publicInline-class route set was empty). With 0C landed,
   the gate reads the codegen-compiled served-manifest facts: an anonymous
   read of a route whose queries all carry `publicInline` succeeds; any
   non-`publicInline` query on the entry refuses
   `SNAPBACK_BUNDLE_NOT_PUBLIC` (acceptance in
   `crates/snapback/tests/rqs_routes_manifest_v0.rs`).
6. **OQ-A interim: one shared anonymous bucket on the local arm.** The
   endpoint's per-authority rate limiter keys anonymous callers into a
   single `"anonymous"` bucket (per-client-address keying stays OQ-A, an
   arm-level decision). The Channel A seam (§0E.5) applies its own
   per-client-address 60/min degrade budget, so the anonymous pageload lane
   does have an address-keyed bound.

**Step-3 landing notes (clusters 0C + 0E; ENG-25448/ENG-25450 executed under
ENG-25454):**

- **§0C.1 authoring + admission landed as specified**, with these pins: the
  kit helper is `defineRoutes([...])` + `routeParam(name)`
  (`packages/snapback-codegen/define.mjs`); the served instance admits the
  manifest through ensure (`routes` beside `schema`/`functions`/`seed` on
  the legacy dev-loop ensure input; sessions complete-pair provisioning of
  routes rides the step-4 Cloudflare/deploy work), refusing with
  `SNAPBACK_ROUTES_MANIFEST_INVALID`; a routes manifest that no longer
  validates after a later schema/functions ensure is dropped fail-closed
  with a warning diagnostic. While a route manifest is served, the step-2
  `devManifestEntry` dev/test form refuses by design
  (`SNAPBACK_BUNDLE_ENTRY_INVALID`).
- **§0C.2 `rqsEligible` was derived under the then-current flag-gated rule**;
  the 2026-08-16 no-declaration amendment above changes the local/Ibex
  derivation only. The fact (and
  `publicInline`) ride the *public* manifest projection
  (`PublicFunctionDefinition.rqsEligible`), and an authored `rqsEligible`
  field refuses at load via `deny_unknown_fields` — the "never authored"
  rule is mechanical. `publicInline` load validation refuses
  `SNAPBACK_PUBLIC_INLINE_INVALID` (codegen:
  `FUNCTION_PUBLIC_INLINE_INVALID`).
- **§0E.6 typed decode landed with two sharpenings.** (a) The server's
  per-arg types are **AST-derived**: a plan filter comparing a schema field
  against `Arg(name)` types that arg from the schema field type
  (`function_route_arg_types`, `crates/snapback/src/bundle.rs`) — there is no
  manifest-carried arg schema server-side; codegen validates the same rules
  against the authored args validators at compile time. (b) References are
  typable **only at top-level arg positions**: a `$param` nested inside an
  array/object literal has no schema-typed target and refuses at admission
  (`SNAPBACK_BUNDLE_PARAMS_INVALID` / codegen `ROUTES_ARGS_INVALID`) —
  stricter than the section's original "mirroring the args shape" wording,
  which is superseded. Number decode enforces the JCS round-trip rule;
  integer-typed fields additionally require an integral in-band value.
- **§0E.1 embedded payload shape, resolved wording:** the payload is the
  read-mode bundle response body plus the matched `route` pattern; the
  attestation facts (`generation`, `versionStream`) are already body fields
  on the local arm, so no separate attestation object exists.
- **§0E.3 seam landed as a composable plugin**
  (`packages/snapback-vite/channel-a.mjs`, exported as `snapbackChannelA`
  and from the package index): a `configureServer` middleware that owns the
  ownership list and produces the document through Vite's own
  `server.transformIndexHtml` pipeline, so it composes with other plugins'
  HTML transforms and sees the pre-fallback path. It transforms only
  `GET` requests whose `Accept` includes `text/html`. Seam-local degrade
  codes are `SNAPBACK_INLINE_BUDGET_EXCEEDED` /
  `SNAPBACK_INLINE_UNAVAILABLE` plus the runtime serializer property check
  `SNAPBACK_INLINE_SERIALIZER_UNSAFE`; degrade counters key by code via the
  plugin's `api.channelAState()`.
- **OQ-C resolved: graffiti adopts the `snapback-vite` seam** beside the
  untouched Exact `exactContractWeb` preset
  (`demos/graffiti/surfaces/contract/vite.config.ts`); the preset learned
  nothing. Acceptance is
  `demos/graffiti/tests/acceptance/channel-a-browser.mjs` (degrade before
  provisioning, no-store + payload bytes, first paint before any live
  WebSocket frame, single identity-carrying resume from the anonymous token,
  CurrentAsOf with no refetch, and the recorded §Scalability numbers).
- **`queryArtifact` stays interim content-derived.** This 0C pass did not
  add a manifest-carried per-function generated-artifact hash; LLP 0091's
  step-1 reconciliation item 3 remains the standing rule (the swap is now
  expected with the step-4 Cloudflare arm, where deploy-time artifact
  identity exists anyway).

**Step-7 landing notes (Channel C consumption; ENG-25458, 2026-07-24).**
Rollout step 7 landed the two D4 consumers on the local arm with no contract
changes: todo-v2's authenticated web boot (shell + one register-mode bundle;
the surface adopts each registration via the kit's new
`registeredSubscription` seam — `packages/snapback-client/index.mjs`,
`createRqsRegisteredRegistry` in `rqs-preload.mjs`, `rqsRegistered` on
`createSnapbackContractSurface` — and the socket attaches under the
bundle-adopted grant with nothing delivered at attach), and graffiti's
socket-less widget read-mode surface (`demos/graffiti/surfaces/widget/`,
plain `fetch`, public/`publicInline` entries only, anonymous register
refused to an explicit read retry). Wire-instrumented acceptance:
`demos/todo-v2/tests/acceptance/register-boot.mjs` and
`demos/graffiti/tests/acceptance/widget-read-mode.mjs`, both in the local
proof. Two observations, neither a divergence: (a) for *ordered* queries the
post-boot result-changing lane is replace-only (0090 D1.3), so D4's
"receives only deltas" reads as "receives only new state past the bundle's
commit cut" there — the acceptance pins version monotonicity plus
nothing-at-attach; (b) the endpoint serves `Cache-Control: no-store,
private`, strictly stronger than §0D.7's `no-store`. Register-mode adoption
under a negotiated auth-invalidation protocol falls back to an ordinary
fresh subscribe (the bundle `authorization` projection is not yet wired into
the client fence path) — the recorded follow-on for the sessions arm.

## Dated amendment: step-4 Cloudflare arm (2026-07-24, ENG-25455)

LLP 0090 rollout step 4 landed the Cloudflare arm (coordinator resume
admission + bundle endpoint, gateway Channel A; `cloudflare/src/rqs-host.mjs`,
`cloudflare/src/coordinator.js`, `cloudflare/src/gateway.js`; acceptance
`cloudflare/test/acceptance.rqs.mjs`). Per LLP 0004 the implemented behavior
is normative; the sections above read as amended for this arm:

1. **§0C.1 — the routes manifest is compiled into the Worker.** The app
   bundle exports `routesManifest` (the same artifact schema), deploy-time
   compiled like schema/functions on this arm. There is no ensure lane, so
   admission runs at first use: an invalid compiled manifest is **treated as
   absent, fail-closed** (bundle requests refuse
   `SNAPBACK_BUNDLE_ROUTE_UNKNOWN`, Channel A serves the plain shell, and a
   warning diagnostic is logged) — the deploy-time analog of the local
   `SNAPBACK_ROUTES_MANIFEST_INVALID` ensure refusal. Its canonical hash is
   the `routeManifestHash` component of `generation` (LLP 0091 §0A.6).
2. **§0C.2/§0C.3 — eligibility derives from compiled HostPlan facts plus the
   explicit authority-independent flag.** The
   Cloudflare deploy pipeline has no codegen lane; the app bundle's function
   entries carry the codegen-shaped facts (`authRequirement`,
   `authorityIndependent`, `publicInline`, `readSetSummary`,
   `runtime.HostPlan.Query`), and the coordinator **derives** `rqsEligible`
   under this arm's still-current conjunction — a validated
   `authorityIndependent: true` public LiveQuery with no uses/auth-scope plus
   the closed-inputs proof (HostPlan query, complete `singleTable` summary).
   Unlike the local/Ibex arm after the 2026-08-16 amendment, the flag remains
   an admission input here; removing it is the explicit pending row in §0C.2.
   The closed-inputs fact is honest because eligible queries are
   **evaluated natively by the coordinator** over a validated HostPlan
   subset (single table, `Eq` filters over Arg/Literal, field order clauses,
   optional limit) — no opaque JS runs for them; opaque-JS handlers can
   never be eligible, exactly as on the local arm. One sharpening:
   `publicInline` is honored on this arm **only when the query is also
   `rqsEligible`** (stricter than §0C.3's authorityIndependent-only
   requirement — fail-closed, never wider; v1 has no consumer of a
   public-inline non-eligible query on this arm).
3. **§0D — read mode landed; register mode deferred.** `POST /app/bundle`
   is forwarded by the gateway and evaluated under the coordinator's
   invocation mutex; eligible entries evaluate natively with no awaits, so
   the single-commit cut holds by construction (§0D.5's DO clause). This arm
   has **no credentialed bundle-caller class yet** (no LLP 0077 sender-key
   thumbprint/replay-epoch custody on the connection grant), so **every**
   register-mode request refuses
   `SNAPBACK_BUNDLE_REGISTER_REQUIRES_CREDENTIAL` and the pending-
   registration owner is not built here — explicitly deferred to the
   credential story for this arm, never half-landed. The anonymous rate
   limit is the step-2 interim single shared bucket (OQ-A unchanged); the
   query-count cap is enforced at manifest validation, rows/bytes/time at
   evaluation.
4. **§0E — the gateway is the second Channel A assembler.** The seam
   composes per-request: route match against the compiled manifest (shared
   `packages/snapback-vite/channel-a-core.mjs`, split from the Vite plugin
   so both arms run one matcher/gate/embedder — reuse, not a fork), compiled
   `publicInline` zero-cost skip, one coordinator bundle subrequest under
   the 500 ms budget (raced, not aborted — a late bundle is unused and the
   shell serves), the byte-pinned serializer
   (`packages/snapback-vite/rqs-serializer.mjs`, bundled into the Worker;
   the §0E.2 Cloudflare conformance home is
   `cloudflare/test/acceptance.rqs.mjs` over the same fixture files), embed,
   and §0E.4 response mechanics — `no-store`, static-shell validators
   dropped, `Content-Length` recomputed over the final identity bytes with
   compression left to the runtime after transformation, CSP headers carried
   through untouched. The anonymous per-client-address 60/min budget keys on
   `cf-connecting-ip` and is **per gateway isolate** (in-memory, degrade
   over the cap) — a best-effort seam budget; the coordinator holds the
   authoritative limits.
5. **What the local harness proved** (Miniflare regression surface only):
   inline/degrade/response mechanics, byte-exact serializer fixtures,
   rung-1/rung-3 admission with per-cause refusals over genuinely MAC'd
   tokens, token refresh on the live path, DO-storage keyring surviving both
   the /evict in-memory clear and a real dispose/recreate DO restart under
   persisted storage, and versionStream rotation across /reset refusing
   outstanding tokens. Not provable locally: real deploys (generation
   rotation across deploys is exercised via a testing-gated mint override),
   edge caching/compression, and real platform eviction economics.

## Dated amendment: structured route-group arguments (2026-08-08)

The step-3 amendment above narrowed §0E.6 to "references are typable **only at
top-level arg positions**" and gave one reason: "there is no manifest-carried
arg schema server-side". LLP 0131 later landed `argsContract` on every
function definition — a carried, declaration-authoritative, recursive
description of the function's arguments. The premise no longer holds for
nested positions, so the narrowing is **partially lifted** and §0E.6's
original "mirroring the args shape" wording is restored for objects. This is
not new expressiveness (no defaults, transforms, or optional params), so the
grammar stays `params-v1` and the manifest stays `formatVersion: 1`.

**What is admitted now.** A `{"$param": name}` node may sit at any position
reachable from the mapping root **through plain objects**, at any depth:

```js
{ function: 'listIssues', args: { context: {
  projectId: routeParam('projectId'),   // nested reference
  cursor: null,                          // null member
  sort: 'asc',                           // union-of-literals member
  tags: ['open', 'ready'],               // array-of-literals member
} } }
```

Literal members now validate against the declared argument validator across
the whole recursive vocabulary: `v.null()`, `v.literal(...)`, `v.union([...])`,
`v.array(...)`, and `v.vector(...)`, in addition to the scalars and objects
v1 already checked. `v.tuple(...)` is deliberately not covered: it is not in
LLP 0131's closed argument grammar, and admitting it there is a separate
decision.

**What still refuses** (`ROUTES_ARGS_INVALID` at compile time,
`SNAPBACK_BUNDLE_PARAMS_INVALID` / `SNAPBACK_ROUTES_MANIFEST_INVALID` at
admission):

- a bare reference at the mapping root — no named arg position;
- a reference anywhere inside an **array** literal — an index-addressed
  position has no stable declaration path, so array interiors stay
  literal-only (recorded remaining work, not an oversight);
- a reference whose path cannot be resolved through object nodes, or whose
  leaf is not a string/number/boolean argument position;
- a reference beside other keys, or with a non-string `$param` value.

**Typing authority is split by runtime and depth, deliberately.** HostPlan
depth-1 references keep the step-3 AST-derived typing
(`function_route_arg_types`, plan filters comparing a schema field against
`Arg(name)`) **byte-for-byte**, so no app that lowers today changes behavior.
Depth ≥ 2 references type from the carried argument contract
(`function_nested_route_arg_types`). The 2026-08-10 amendment below also uses
that contract for JavaScript depth-1 references.

The contract scalar-leaf rule is reproduced identically by codegen and both
server arms: `string`/`principal`/`assetRef`/`id` → string, `integer` →
integer, `finiteReal` → number, `boolean` → boolean, everything else → no
entry (fail closed). A function with no `argsContract` (pre-0131 manifest)
admits no contract-derived reference.

One consequence worth naming: object-reachable references are typable for
**JS-handler** queries too, because the argument contract exists regardless of
whether the handler is a declarative plan. Depth-1 JavaScript handling is
governed by the 2026-08-10 amendment below.

**Register/mixed group eligibility follows every reference.** `registerGroupEligible`
and `mixedGroupEligible` already required every `$param`-mapped arg to be
string-typed so the client can materialize the raw route segment without
decoding; that rule now applies to references at every depth, on both the
codegen predicate and the served admission check.

**Version skew is fail-closed.** A manifest carrying a nested reference,
served by a runtime or Worker predating this amendment, refuses at admission
(the reference has no top-level target) rather than substituting untyped.

**Two arm-parity defects found and fixed while landing this.** (a) The
Cloudflare arm's `number` decode called `jcs(parsed)` only for its throw and
never compared the canonical form against the presented segment, so it
accepted segments the local arm refuses (`"5.0"`, `"1e3"`); it now enforces
the round-trip equality §0E.6 specifies, restoring the "Predicate parity"
conformance clause below. (b) The Cloudflare arm admitted a **bare root**
`{"$param": …}` mapping (its per-key loop never inspected the mapping object
itself); it now refuses, matching the local arm.

## Dated amendment: depth-one JavaScript route parameters (2026-08-10)

For an `IbexModule` query, `function_route_arg_types` derives depth-one route
parameter types from the function's carried `argsContract`. This closes the
codegen/served-admission seam recorded in
`issues/20260731-0112-register-eligibility-js-param-seam.md`: codegen already
types the authored JavaScript argument validator and emits the corresponding
contract, so a generated string mapping is admitted and remains eligible for
LLP 0112 registration.

This does not change HostPlan inference, which remains schema/plan-derived.
It also does not permit an uncarried or opaque declaration: a pre-0131
JavaScript function without `argsContract`, a non-scalar leaf, or any unknown
contract node has no route decode type and refuses fail-closed. The local
regression uses codegen-produced schema, function, and route manifests and
passes them through real `ensureApp` admission.

## Open questions

- **OQ-A — anonymous rate-limit keying.** §0D.2/§0E.5 key anonymous limits
  by client address; behind proxies/CDNs that key is weak (shared NATs
  over-limit honest users; spoofed forwarding headers under-limit
  attackers). Which address signal each arm trusts (direct peer vs
  platform-provided client IP) is an implementation-time decision for
  cluster 0D's route-taxonomy landing, per arm. The defaults stand
  regardless.
- **OQ-B — local production serving.** The local Channel A contract covers
  the managed dev loop (`snapback-vite`). A production build of a local-arm
  app (static `vite build` output served elsewhere) has no serving seam and
  therefore no Channel A; whether one is wanted (a `snapback serve` static
  lane, or Cloudflare-only for production) is undecided and belongs to the
  0090 D5/Q6 conversation, not this cluster.
- **OQ-C — Exact preset adoption. RESOLVED (2026-07-24, rollout step 3):**
  graffiti adopts the `snapback-vite` seam as a composable plugin beside the
  untouched Exact preset — see the dated amendment above.

(LLP 0091's OQ3 is closed in §0D.6: no v1 operator knob for resume-keyring
rotation. 0090's Q4 — at-rest posture — and Q6/Q7 remain owned where 0090
left them.)

## Conformance

- **Serializer fixtures (normative, landed):**
  `tests/fixtures/rqs-serializer/` per §0E.2. Every Channel A HTML
  assembler must reproduce each `*.expected.bytes` byte-for-byte from its
  `*.input.json`, and must enforce the whole-output byte property (no
  `0x3C`/`0x3E`/U+2028/U+2029 in the completed serialization) at runtime
  on real payloads, not only in tests. Named test homes (obligations, to
  land with cluster implementation, LLP 0091's stub pattern):
  `packages/snapback-vite/rqs-serializer.test.mjs` and, for the
  Cloudflare-arm assembler, a `cloudflare/`-side test over the same fixture
files; a Rust-side `crates/snapback/tests/rqs_serializer_v0.rs` only if a Rust assembler
  ever exists.
- **Closed-union schema parity:** fixtures proving the per-entry union of
  §0D.1 (resume present iff `rqsEligible`; auth-scoped register entries
  carry `authorization` and `resume: null`) across the exported schemas
  and both arms' serializers.
- **Predicate parity:** the served-manifest `rqsEligible`/`publicInline`
  facts computed by the local arm and the Cloudflare deploy pipeline must
  agree for identical inputs (same functions manifest ⇒ same facts).
- **Existing-behavior preservation:** landing 0C's schema changes must not
  change any currently-admissible manifest's admissibility (new fields
  default absent/false; derivation is non-erroring per §0C.2).
- The acceptance fixtures 0090 already assigns to rollout steps 2 and 3
  (idempotency replays, reaping, anonymous refusal to read mode, alias-key
  promotion, degrade-to-shell, byte-checked serializer fixtures) verify
  this contract; they are listed there and not duplicated here.

## Ticket map

Step-0 execution tickets under parent ENG-25446 (LLP 0090 step 0):
**0C → ENG-25448**, **0D → ENG-25449**, **0E → ENG-25450**. Clusters 0A/0B
were LLP 0091's (ENG-25447); cluster 0F's corpus amendments are recorded in
LLP 0031 (dated 2026-07-24) with the LLP 0008/0034 companions tracked by the
same parent.
