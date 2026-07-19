# RFC 0062: Generated Per-App CLI and Code Mode

**Type:** RFC
**Status:** Review
**Systems:** Client integration, Developer experience, Tooling, API, Auth, Docs
**Author:** Charlie Cheever / Claude Fable 5
**Date:** 2026-07-17
**Revised:** 2026-07-19 (implementation checkpoint: the packaged client, local artifact loader, fenced agent journey, acceptance witness, and guide pages shipped as a deliberately narrower phase; served envelopes, generation binding, human custody, code mode, and the remaining 19-ticket program are explicitly deferred; status remains Review). 2026-07-17 (Draft → Review after round 10 of the /llp-super-refine loop; per-round provenance in §Revision history; amendment-phase residue in `issues/20260717-app-cli-review-residue.md`)
**Related:** LLP 0004 (codegen rules; owns the `{appId}:{exportedName}` id spelling), LLP 0012 (headless integration contract; manifest identity, adapter invariants, the shared diagnostic dialect, and the closed provision DTO this RFC must amend), LLP 0019 and LLP 0024 (one core, thin projections, one shared result envelope across CLI/HTTP/MCP; LLP 0024 also owns the host-ops plane and the generated app-data MCP catalog this RFC must reconcile with), LLP 0031 (route registry; app-data/system planes, `PublicNoStore`, and the D3 source-stripped public manifest this RFC's envelope reuses; dev-mode `AppAuth` client assertion), LLP 0037 (Rust types as schema source of truth; governs the envelope's nested projection), LLP 0042 (agent MCP surface; the `devUser` posture this RFC mirrors), LLP 0055 (agent principals, registration, pairing, scoped grants, rotation semantics, response attribution), LLP 0056 (scoped roles and memberships), LLP 0058 (shared invocation authority; owns the `AuthRequirement` vocabulary, the tuple pairs, and the invocation gate this CLI projects and never redefines), LLP 0060 (deployment posture; future first hosted-auth profile's `/_snapback/*` refusal; the capability-manifest registry the target-eligibility capability lands in), LLP 0061 (served guide; the server-advertised distribution and identity pattern), LLP 0010 (agent-facing diagnostics discipline; exact-tested-version vs. supported-range distinction), ibex LLPs 0013/0014 (compartments and generated policy; the supply-chain-integrity framing §3 cites), ibex LLP 0022 (REPL semantics; why `repl` is deferred), ibex LLP 0028 (Oxc-only transform; note: its current citation of this RFC predates §6's scoping — this RFC creates no phase-1 embedded-Ibex or computed-import requirement, and that ibex-side citation needs its own amendment) and ibex LLP 0029 (single-file executable packaging) in the ibex repo

## Summary

Every Snapback app should mechanically get a command-line tool for its
own API — primarily for agents. This RFC proposes that the tool is
**one generic engine plus the app's generated artifacts**, not
per-app generated program source: the engine loads the app's **API
envelope** (a source-stripped function-manifest projection, the
`operations/*.args.schema.json` schemas, and typing artifacts) as
**data**, synthesizes callable bindings from it, and projects it two
ways:

- **Subcommands** — `<app> call <function> --args-json '<json>'`,
  `<app> subscribe <liveQuery> --first-change`, `<app> introspect`,
  with human tables on a TTY, JSON/JSONL for machines, server
  diagnostics preserved, and a frozen exit-code taxonomy.
- **Code mode** — `<app> run script.ts` (or `run -` for a script on
  stdin): the script executes against an injected `api` object whose
  calls are **brokered to a credential-owning parent process** — the
  script host is never handed a bearer — so an agent composes loops,
  joins, and filters in one invocation and only the result enters its
  context. A new generated declaration artifact (`code-mode.d.ts`,
  §3) is the contract the script typechecks against.

Served artifacts are consumed as data, never as code: the engine does
not execute a served `api.mjs` (doing so would be remote code
execution by design; §1). Authority is entirely Snapback's existing
model — the CLI has **zero authority model of its own**, principal
selection defaults to anonymous and is never silently promoted (§4),
and on sessions targets every call is bound server-side to the
artifact generation it was validated against (§1). Anonymous callers
reach `public` and `optional-user` functions, exactly as the server's
invocation gate decides; dev-mode targets keep their client-asserted
dev identity behind a dev-only flag; humans log in to a session;
agents pair for a grant and act under scoped tokens (LLP 0055). The
server advertises the engine and is the version authority for the
app surface, following the served-guide identity pattern (LLP 0061).

The engine is TypeScript on the headless client's app-data core and
runs on Node on POSIX hosts in phase 1 (exact tested version and
supported range in §6). Hosted targets are out of phase 1 entirely
(§5). A later standalone-executable phase via Ibex is a direction,
not a commitment of this RFC: it requires ibex-side contract
revisions first (§6).

## Motivation

Agents are the primary consumers of a Snapback app's API, and today
their options are: write a bespoke script against the headless client
(per task, per app), or drive HTTP by hand. Both spend agent context
on plumbing. A mechanically-derived CLI fixes discovery ("`--help` is
generated from the manifest, including what each command requires to
be called") and cost (one invocation per intent). Code mode fixes the
deeper economics: without it, every intermediate result round-trips
through the model — list 500 rows to pick 3 — whereas a script keeps
the traffic in-process and returns only the answer, and §3's output
contract is designed so that holds on every **engine-owned** channel,
stderr included (script-authored `console` output passes through by
design, bounded). Live queries stop needing a predicate DSL: a script writes
`for await (const snap of api.activeGames({})) { … break; }` and the
exit condition is ordinary code.

The call substrate is real and verified: per-function
`authRequirement` and read/write-set summaries in the function
manifest, one JSON Schema per function's args in `operations/`,
stable function ids (`{appId}:{exportedName}` — LLP 0004's codegen
rule, pinned by LLP 0012), a complete headless client (today at
`demos/_kit/client.mjs`; phase 1 lifts the app-data subset the engine
needs into a real package dependency), and agent credentials, grants,
pairing, and scoped tokens (LLP 0055). What this RFC adds on top is
genuinely new machinery — the envelope and its ingestion, the
generation-binding and live-attribution wire seams, the code-mode
host, Node-side credential custody, the shared result-envelope
reconciliation — and it is specified as such rather than waved
through as composition.

Scope truths stated up front rather than buried. Per LLP 0055 the
agent path exists on **local** targets in phase 1; every hosted
service-principal invocation is refused in v1, and trusted-local is
an unmet prerequisite, not a present capability (§4). Hosted targets
are out of phase 1 wholesale — not because hosting is hostile to the
design, but because **no hosted target today ingests, identifies, or
serves envelopes**: the current hosted gateway's public metadata is
its capability manifest (`/inspect`, `/capability`), with unknown
paths falling through to asset serving — and LLP 0060 specifies (for
its *future* first hosted-auth profile; no such deployment exists
yet) a fixed 404 for every `/_snapback/*` route on the public app
origin. Hosted distribution is follow-up work
(§Future work), and when it lands, `/app-api` routing must take
precedence over any asset fallback. The full phase-1 matrix is
pinned in §4.

## Position among existing surfaces

- **This is the application plane, not the operator plane.** The
  `snapback` binary's host-ops surface (LLP 0024: `app.inspect`,
  `function.run`, admin token, secret-read leases) operates *on* a
  deployment. The app CLI operates *within* an app as an app
  principal. The planes stay disjoint: the app CLI never accepts the
  admin token — the engine's client façade is **app-data-only**: no
  admin methods and no ambient `SNAPBACK_ADMIN_TOKEN` pickup (the
  full headless client reads that env var by default, so the engine
  explicitly does not construct it that way) — and it does not use
  the `function.run` host op: host operations do not resolve scoped
  tokens into authority (LLP 0024, dated amendment), and must not.
  App calls go through the same generated app-data routes every other
  client arm uses.
- **One result envelope, shared — a named reconciliation, not a
  fork.** LLP 0024 pins the canonical JSON result envelope shared by
  CLI/HTTP/MCP and owns a generated app-data MCP catalog derived
  from the same function manifest (LLP 0019 is the research framing —
  "one result schema, three projections" — and 0024 is the pin). This RFC therefore does
  **not** introduce a second result semantics: its result document
  (§2) is the canonical envelope's app-data profile, and a **dated
  LLP 0024 amendment defining the shared app-data invocation/result
  core — projected by both this engine and the generated MCP catalog,
  with drift and parity gates — is a phase-1 prerequisite**, not
  future work. The same amendment pins the shared invocation *input*
  source — the public function projection plus the operations schemas
  keyed by stable function id, with the authoritative filename-to-id
  mapping — since older LLP text places validators in the manifest
  while today's generated schemas are keyed by exported name. (What
  stays future work is whether one *engine* serves both surfaces; the
  contract is shared either way.) LLP 0012
  additionally requires that projections share one diagnostic
  dialect and "must not add another"; the engine's diagnostics
  extend that dialect, and dev-mode client assertion — which the
  headless client carries — stays available (§4): the projection
  neither adds nor subtracts semantics.

## Design

### 1. Engine plus data, never program source — served or generated

The deliverable is one engine (working name: npm package
`@snapback/app-cli`, package dir `packages/snapback-app-cli`, built on
the headless client's app-data core). An app's "CLI" is the engine
bound to a **target** and that target's **artifacts**:

- `--app <url>` names the target server. On sessions targets,
  artifacts come from its served envelope (§5); on dev targets they
  must be supplied explicitly via `--artifacts` (dev targets serve no
  envelope, and the engine does not guess a checkout location; §5).
- `--artifacts <dir>` uses a local `generated/` directory explicitly
  (the in-checkout development path). When artifacts are explicitly
  pinned this way, an identity mismatch is terminal — there is
  nothing to refetch — and the refusal stands. **The local loader
  verifies the same correspondence the server does**: codegen emits
  per-member digests (operation schemas and declaration members,
  keyed by stable id) into the generated manifest set, and the
  loader checks every member against them before help,
  introspection, typing, or any invocation — a swapped or stale
  local schema refuses exactly like a forged served one.
- **Binding is attested, not assumed.** Before any network operation
  the engine verifies the target's advertised app id and artifact
  identity against the loaded artifacts and fails closed
  (`SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH`) on wrong-app,
  same-named-function-different-app, and stale-bundle pairings. The
  attestation source is the discovery document on sessions targets
  and the public `/inspect` projection (which serves the active
  manifests' identity and the capability manifest) on dev targets —
  fetched with revalidation-fresh semantics (no-cache), because a
  stale intermediary-cached attestation would silently extend the
  accepted dev reload race.
- **On sessions targets, binding holds at call time, not just
  discovery time.** Every call and subscription carries the expected
  envelope identity, and the server checks it against the active
  generation atomically with function selection — part of the
  LLP 0012 amendment (§5), whose text also pins that **the check is
  opt-in by assertion: a request carrying no expected identity is
  unchecked**, so the browser kit, Contract, and existing headless
  callers are untouched — and a deploy racing a call cannot pair
  old-schema-validated args with a newer same-named function.
  Successful responses carry the server-derived active identity in
  `facts`. A mismatch is a typed refusal (exit 7); the engine
  refetches artifacts and the caller retries. A subscription pins its
  generation: a deploy that changes it ends the subscription with the
  same typed refusal, and the engine refetches and resubscribes
  (dedupe per §2 spans the gap); a deploy that removes the function
  surfaces the server's refusal (exit 4 on resubscribe). **On dev
  targets this guarantee deliberately does not exist**: dev servers
  hold no envelope identity, the v0-dev wire is unchanged (§6's
  sub-stage (a) needs no server changes precisely because of this),
  and the dev reload-races-a-call window — most common on exactly
  this target — is an accepted, named residual: attestation is
  discovery-time only, and §7's generation tests are scoped to
  sessions tuples. Exit 7's diagnostic detail distinguishes its three
  causes machine-readably — integrity (bytes ≠ requested hash: do not
  retry blindly), binding (wrong app/artifacts), and generation race
  (refetch and retry) — because they demand opposite agent reactions.

Invocation is `snapback-app --app <url> <command>` in v1; per-app
named shims (`todo`, `all-aboard`, …) are deferred until the engine
proves out (a shim is one line of config, and generating them is not
phase-1 work).

**Artifacts are data.** The engine consumes the envelope's manifest
projection and operations schemas — declarative JSON — and
synthesizes its command surface and code-mode bindings from them. It
never executes served program source: a served `api.mjs` will not be
loaded into the engine process, because "download JavaScript from the
target server and run it" is remote code execution with the invoking
user's OS authority, and no identity header self-attested by that same
server mitigates it. (`api.mjs` in a local checkout is unaffected — it
is the app author's own build output, and its entries are inert
descriptors anyway. Declaration files are types-only and never
executed anywhere.) Data still needs defensive parsing: the engine
bounds envelope size, function/schema counts, nesting depth, and
schema `$ref` resolution (in-envelope only — never network; JSON
Schema 2020-12, engine-pinned subset) before use — "not code" rules
out RCE, not denial of service. The same discipline applies to
**everything the parent ingests from the network**: per-class
decoded-byte limits on app-call responses, auth-lifecycle responses,
discovery documents, and live frames, enforced *before* full-text or
JSON materialization (dishonest `Content-Length`, chunked bodies,
decompression expansion, and WebSocket payloads included) — the
current client buffers whole responses before parsing, and a hostile
or merely oversized response must not exhaust the credential-bearing
parent before any advertised ceiling applies. An oversized response
is a transport-class refusal (exit 6, sub-cause
machine-distinguished), with orderly cleanup.

Because the surface is data, the CLI is *always* current with the
server it talks to. The envelope is **content-addressed and
immutable**: the engine fetches a small no-store discovery document
for the current envelope hash, then the immutable envelope by hash
(cacheable forever; §5). Integrity and freshness are therefore
distinct by construction: bytes whose SHA-256 differs from the
requested hash are an integrity failure (exit 7); a changed current
pointer is a normal deploy and the engine adopts it. The manifest's
`inputsHash` and `bundleHash` ride inside as semantic cross-checks,
not cache keys. The cache is keyed by (normalized target origin, app
id, envelope hash) with a last-known-good pointer per (origin, app
id), per-origin and global disk limits with oldest-unused eviction,
and atomic writes under a per-target advisory lock (two racing
invocations are safe: content-addressed blobs are write-once, and the
pointer update is take-lock-compare-swap). Offline, the last-known-
good envelope still serves `introspect` and `--help` (marked as
cached, with the identity shown); `call` and `subscribe` need the
network regardless.

Artifact loading honors LLP 0012's invariants as a conforming adapter
— required stable function ids, `schemaVersion` refusal outside the
admissible tuple set — plus atomic whole-envelope replacement, which
is a **new** invariant this RFC's LLP 0012 amendment adds (0012 today
pins atomic whole-*function-manifest* replacement; the envelope
generalizes it). The generated schema and functions manifests are the
**sole authority for the local artifact tuple**; other generated
files carry their own independent format versions and are never read
as tuple evidence.

### 2. Subcommand surface

Rendered mechanically from the manifest projection — `kind` is one of
`Query`, `Mutation`, `LiveQuery`, or `Action`, plus `authRequirement`
and `syncabilityClass`; a legacy entry with absent `authRequirement`
is normalized to the server's effective value, `optional-user`, never
surfaced as null — and nothing is hand-authored per app. The
`<function>` selector accepts the stable function id always and the
bare exported name when unique (LLP 0024's selector rule); ambiguity
and absence are distinct typed errors, and results always carry the
stable id.

- `call <function> --args-json '<json>'` (or `--args-json -` to read
  the JSON from stdin — agents mangle shell-quoted JSON constantly) —
  dispatches by manifest `kind` to the matching client method; args
  validated client-side against the function's operations schema
  before any network traffic, with schema-shaped errors; a default
  wall-clock timeout (60s, flag-overridable) so agents get bounded
  behavior without flags. `call` on a `LiveQuery` performs the
  one-shot query of the current snapshot; `subscribe` is the durable
  form. The flag spelling matches the operator CLI's `--args-json`
  (LLP 0024). (No `--arg k=v` shorthand in v1: key=value coercion
  against arbitrary JSON Schemas is a contract surface of its own.
  See §Future work.)
- `subscribe <liveQuery> [--args-json '<json>' | -]` — durable live
  query, with the same args surface, schema validation, and
  no-network-on-invalid-input behavior as `call` (parameterized live
  queries ship today; a subscribe surface without args would strand
  them). Modes: `--first-change` (the default — block until one
  change, print, exit 0) and `--watch` (stream JSONL until killed)
  are mutually exclusive; `--timeout <dur>` combines with either as
  a bound (exit `SNAPBACK_APP_CLI_TIMEOUT` when it expires first).
  The current snapshot always prints first. **"Change" is defined as: the RFC
  8785 (JCS) canonical serialization of the snapshot differs from the
  last snapshot printed** — one pinned canonicalization, so dedupe is
  identical on every host. A resync after reconnect is deduplicated
  by the same rule. **Token lifecycle is decided, not open — and
  renewal and rotation are different events, neither of them
  gapless.** Same-grant scoped-token **renewal** is a scheduled,
  bounded cut/resync: the parent mints the successor before expiry
  and immediately resubscribes under it, but the client's authority
  fence is single-carrier (replacing the credential quiesces and
  closes the old carrier's streams before the successor opens), and
  at LLP 0055's per-grant live-token cap the mint itself can evict
  the watch's token — so a brief observation gap is possible and
  named, the JCS content rule suppresses the duplicate resync
  snapshot, and dedupe applies from the new snapshot forward.
  Unplanned **cap eviction by a sibling invocation** is the same
  cut/resync with a distinct stderr diagnostic. Credential-family
  **rotation is terminal for a running watch** (LLP 0055: rotation
  is revocation-strength — older generations fail immediately, and
  the successor secret is returned only to the rotation caller; a
  running process holding an env-sourced credential has no channel
  to adopt it): the watch ends with a typed diagnostic naming
  rotation, and the operator restarts under the successor — a fresh
  invocation reads the updated credential source; v1 specifies no
  in-flight successor-adoption protocol. (A dual-carrier gapless
  handoff and live successor adoption are future work if the gaps
  ever matter.) When re-minting is
  impossible (grant expired, credential gone) the watch ends with the
  server's refusal preserved (exit 3). Transport drops resubscribe
  under a bounded, flag-overridable retry budget; budget exhausted is
  `SNAPBACK_APP_CLI_TRANSPORT_FAILED`. A deploy mid-watch follows
  §1's generation rule. Delivery is latest-wins: intermediate
  snapshots coalesce for slow consumers.
- `introspect [--json]` — the function inventory with kinds, arg
  schemas, `authRequirement`, and `syncabilityClass`; the
  machine-readable twin of `--help`. The JSON form is a new closed,
  versioned artifact (working `artifactKind: "appCliIntrospection"`,
  its own version field — the manifest's `schemaVersion` cannot
  version engine-added fields): `{ artifactKind,
  introspectionVersion, engineVersion, envelopeHash, schemaVersion,
  targetCapabilities, principalSource, functions: [...] }` — target
  capabilities and the selected principal's *source* (never its
  secret) included so an agent's first contact is one fetch. Function
  entries are projection-faithful under LLP 0012's `schemaVersion` —
  the source-stripped projection of §5, never the raw build manifest.
- `types --out <dir>` — materialize typing for editors and CI, with
  the file topology pinned: `api.d.ts` (the envelope's descriptor
  types, verbatim) and `code-mode.d.ts` (one merged file: the
  installed engine's ambient block plus the envelope's app-owned
  bindings; no imports between them). The acceptance suite
  typechecks against `code-mode.d.ts` exactly. `run` strips types
  and never typechecks (§3); typechecking is this command plus the
  author's tooling.
- `whoami`, `login`, `logout`, `pair` — principal lifecycle (§4). On
  local targets with a capture-only auth provider (the dev mailbox),
  `login` prints the challenge id and points at the operator-plane
  retrieval instructions — the app CLI never implies it can read the
  mailbox itself.
- `--help` at every level, generated from the manifest, and honest
  about auth *within what a client can honestly know*: each command
  lists its `authRequirement`. Exactly two refusals are
  client-decidable and pre-flagged: the selected principal is
  anonymous and the function is `authenticated` (`public` and
  `optional-user` — the default — accept anonymous callers; the
  server's gate refuses anonymous only for `authenticated`), and the
  selected principal class is absent from the target's advertised
  capabilities (§4, §5). **Both refuse locally, with zero network
  traffic, as exit 2** (`SNAPBACK_APP_CLI_USAGE`, the pre-flag reason
  in the diagnostic) — exit 3 is reserved for refusals that actually
  came from the server and carry its code. Everything else — grants,
  memberships,
  kind-referencing rules that fail closed over the sealed anonymous
  projection — is server-decided (LLP 0055/0056) and help says
  "determined by the server at call time"; predicting it client-side
  would duplicate auth semantics, exactly the second-semantics this
  surface must not grow.

**Result contract — one Rust-owned semantic core, one engine-owned
wrapper, stated exactly.** The shared app-data result is a **single
Rust-owned serialized core DTO** (the LLP 0024 amendment's shared
app-data core): HTTP, the headless client, this CLI, and the future
MCP catalog carry that core's fields byte-identically — that is what
§7's parity tests assert. `appCliCallResult` (working
`artifactKind`, own version field) is the engine's **presentation
wrapper around the core, not a second envelope**: it embeds the core
verbatim and adds only presentation fields (engine identity, and the
server-derived active envelope identity — absent, not null, on dev
targets, which hold none; the mapping table owns exact spellings);
the wrapper-to-core mapping is pinned in the 0024 amendment, and
parity distinguishes core parity (shared, byte-identical) from
wrapper identity (engine-owned). Every `call` prints one such
document: the
**application value** (a query's rows, a mutation's `result`, an
action's value), protocol facts preserved under `facts` (e.g.
`changed_count`, receipts, active identity), the **server-derived
attribution block** when the response carries one (LLP 0055 §Audit;
two named wire seams land with phase 1: the finite client seam
retains attribution on non-2xx responses — today it drops it — and
the live-subscription wire gains a server-derived attribution block
as immutable subscription metadata, carried across renew/resubscribe,
since the current live establishment output has none and wrappers
must never synthesize one), and `diagnostics[]` with **server
diagnostic codes preserved** (LLP 0012's shared dialect;
`SNAPBACK_AUTH_REQUIRED` is never rewritten to a CLI code). "Safe
fields" has a basis, not a vibe: **the existing public diagnostic
projection — `code`, `severity`, `subsystem` — is the default for
every projection this RFC emits** (result documents, broker errors,
stderr records alike), any additional semantic field is admitted only
through a versioned, code-indexed allowlist, and `message`/`details`
free text never passes (the diagnostic schema itself documents it may
carry source paths, handler text, or arguments; "preserved" means
codes-and-allowlisted-fields, not raw bytes). An action's `ok: false`
run result maps to exit 5 with its embedded diagnostic.

**Write effects have pinned outcome semantics.** Exit 6 or 9 on a
read is just a failed read; on a write it must say what is known. The
engine supplies a durable `clientMutationId` on every mutation
(generated before dispatch, persisted until settled), so a mutation
whose response was lost reports `outcome: "unknown"` with that id —
and the id has a consumer: `call <fn> --mutation-id <id>` replays
under the same id (the client already accepts a supplied
`clientMutationId`). **Replay is bound to what created the
uncertainty:** the persisted record carries target, app id, function,
argument digest, envelope generation, the selected principal
source/profile, and the server-derived durable authority descriptor
— server-side idempotency binds authority, so a replay under a
different profile, user, grant, or delegated authority would not
recover the settlement and might execute fresh under the new
authority — and `--mutation-id` re-attests all of them before
dispatch, refusing locally on any mismatch. Replay against a *newer
generation* requires an explicit `--accept-new-generation` flag (an
unsettled write must not silently run against changed code). Recovery
is an explicit operator action; the engine never auto-retries a write
on its own. Actions have no idempotence machinery: a lost
action reports `outcome: "unknown"` with its request identity and a
prohibition on automatic retry; a failure before dispatch reports
`outcome: "not-dispatched"`. (An authority-bound operation journal
with a `resolve <id>` verb is future work.)

The per-kind mapping table (query, mutation, action, one-shot live
query) — which owns the result document's field naming — is a frozen
phase-1 deliverable next to the exit-code table, and the
`SNAPBACK_APP_CLI_*` family is registered in LLP 0012's shared
diagnostic dialect (changing an emitted code is a compatibility event
there).

Output contract, including the defaults agents actually hit:
human-oriented tables/prose only when stdout is a TTY; **when stdout
is not a TTY the default is JSON for single results and JSONL for
streams** (`--json`/`--jsonl` force the same formats on a TTY);
diagnostics to stderr as structured records (LLP 0010 discipline —
agents branch on codes, not prose). Values follow **LLP 0010's
strict-value profile**: no silent coercion of `undefined`, non-finite
numbers, negative zero, BigInt, dates, maps, typed arrays, sparse
arrays, accessors, symbol or hidden properties, custom prototypes, or
`toJSON` hooks, and no cycles — anything outside the profile is a
typed serialization error, validated in the code-mode child **before
transfer** and re-validated in the parent (the wire representation
alone cannot distinguish these), and an output-size ceiling emits a
complete typed overflow document, **never truncated JSON**. (The result DTO reserves a versioned
tagged-value extension point so a later revision can negotiate exact
64-bit integers, decimals, or binary values — LLP 0004 anticipates
them — without breaking the frozen v1 profile.)

Exit codes are a frozen contract from phase 1:

| Exit | Code | Meaning |
|------|------|---------|
| 0 | — | success (including `--first-change` satisfied) |
| 2 | `SNAPBACK_APP_CLI_USAGE` | bad flags, ambiguous principal or selector, or args failed schema validation |
| 3 | `SNAPBACK_APP_CLI_AUTH_REFUSED` | server refused the principal (server code in diagnostics) |
| 4 | `SNAPBACK_APP_CLI_FUNCTION_NOT_FOUND` | no such function in the manifest projection (or removed by a deploy) |
| 5 | `SNAPBACK_APP_CLI_FUNCTION_ERROR` | the app's function threw or returned `ok: false` server-side |
| 6 | `SNAPBACK_APP_CLI_TRANSPORT_FAILED` | network failure, retry budget exhausted |
| 7 | `SNAPBACK_APP_CLI_ARTIFACT_IDENTITY_MISMATCH` | integrity, binding, or generation failure — sub-cause machine-distinguishable (§1) |
| 8 | `SNAPBACK_APP_CLI_VERSION_MISMATCH` | artifact tuple or protocol version outside the engine's admissible set (§5; direction in diagnostic detail) |
| 9 | `SNAPBACK_APP_CLI_TIMEOUT` | `call`/`subscribe --timeout` or `run --timeout` expired |
| 10 | `SNAPBACK_APP_CLI_SCRIPT_ERROR` | code-mode script threw a non-broker error or produced an out-of-profile result |
| 11 | `SNAPBACK_APP_CLI_RESOURCE_EXCEEDED` | code-mode call/output/subscription/heap ceiling hit (§3) |

Exit 1 is reserved for engine-internal failure outside this contract
(a crash is never dressed up as a taxonomy row), and signal deaths
(SIGINT/SIGTERM on a `--watch`) are outside the taxonomy too —
conventional `128+n`, not something agents should branch on.

### 3. Code mode

`<app> run <script.[ts|js]>` (or `run -` reading the script from
stdin) evaluates the script in a **script-host child process** with
an injected surface and nothing else. All credentials, the app-data
client, and `AgentAuthorityFence` live in the **parent**; the
injected `api`'s calls cross a closed IPC protocol to the parent,
which performs the network call. The broker message schema is a
versioned phase-1 deliverable, written as neutral call/result frames
with no code-mode-specific assumptions — deliberately, so the shared
app-data core of §Position (and the generated MCP catalog riding it)
can use the same substrate. The parent never transmits a bearer of
any kind — `sbac_`, `sbagt_`, or session — through the script host's
globals, environment, argv, or broker messages; §Boundary honesty
below states exactly how far that property goes.

- `api` — typed function references synthesized from the manifest
  projection, brokered as above; the object and its members are
  frozen and null-prototype. Exported names become properties; a
  name that collides with object/thenable machinery (`__proto__`,
  `constructor`, `then`, …), is not a valid identifier, or matches an
  engine-reserved name **loses its property alias only** — a typed
  diagnostic names the export and the function stays callable via the
  stable fallback `snapback.function("app:exportedName")`, so one
  hazardous name never disables an otherwise valid app (an own `then`
  on an awaited surface is a correctness trap, not a style problem —
  which is why the alias is suppressed, not the function). Engine
  metadata lives on a separate frozen `snapback` global (e.g.
  `snapback.envelopeHash`), not on `api`, so the generated property
  namespace stays the app's alone. `await api.foo(args)` resolves to
  the **application value** (the per-kind mapping table owns the
  exact field naming). A
  **brokered failure rejects with a closed, typed error** — the
  server's diagnostic code, safe semantic fields, and the exit class
  it maps to; never bearer material — which a script may catch and
  handle (a caught refusal is the script's business; the run's exit
  reflects the script's own outcome). Broker frames carry a per-call
  timeout (default 60s, per-call override), which is where the exit-9
  class arises inside a run. An **uncaught** broker rejection ends
  the run with the underlying class's exit code (2 for an in-run
  args-validation refusal — brokered calls validate in the parent
  before network, same as the subcommand — or 3/4/5/6/7/9), not
  generic 10. A `LiveQuery` reference called as a
  function returns an async-iterable subscription — first iteration
  yields the current snapshot, later iterations yield changed
  snapshots under §2's canonicalization, latest-wins, renewal, and
  generation rules, and exiting the loop disposes it. (The generated
  artifacts put live queries at the top level by `kind`; there is no
  `api.live.*` namespace.)
- **Typing is three physically distinct products.** The existing
  `api.d.ts` declares descriptor shapes (`FunctionReference` has no
  call signature), so it cannot be the code-mode contract. The
  products, each with one owner: **(1)** the envelope carries the
  **app-owned binding declarations** only — kind-specific callable
  signatures per exported function (`Query`/`Mutation`/`Action`
  return `Promise<unknown>` in v1; result types are explicitly
  `unknown` until codegen learns return shapes — that gap is named,
  not hidden; `LiveQuery` returns `AsyncIterable<unknown>`),
  generated by codegen and validated at admission against a
  versioned canonical declaration grammar (a closed structured IR
  the engine renders locally is the preferred successor; §Future
  work); **(2)** the **engine-owned ambient declarations** for the
  injected globals (`snapback`, `args`, `signal`, `console`, timers)
  ship with the installed engine, which also versions the
  hazardous-alias suppression set — so a newer envelope cannot
  declare a global an older engine does not inject, and an older
  envelope cannot under-declare a newer engine; **(3)** `types`
  (§2) merges the two into a named local output for editors and CI,
  and the acceptance suite typechecks this RFC's examples against
  exactly that merged output (§7). Nothing engine-owned ever rides
  the envelope.
- **Language profile and evaluator, pinned.** The input is a single
  self-contained ES module: top-level `await` supported; `import`
  refused in v1 (`SNAPBACK_APP_CLI_USAGE` — the injected surface is
  the whole surface); TypeScript in the **erasable-syntax-only**
  subset on every host (enum/namespace/parameter-property syntax is
  refused with a diagnostic rather than silently diverging between a
  type-stripping host and a full-lowering one; `import type` is
  erasable and therefore allowed — it erases to nothing; dynamic
  `import()` and `import.meta` are categorically refused with static
  `import`). The engine performs the erasure and module evaluation
  itself with no experimental Node flags — the transform choice and
  its version are pinned in the broker-schema deliverable and ride
  the engine's identity, since host-identical behavior ultimately
  rests on that pin — and runtime warnings never enter the framed
  output channels.
  The script's result is its **default export**, awaited; no default
  export means no stdout payload. The result must satisfy §2's strict
  JSON profile — anything else is `SNAPBACK_APP_CLI_SCRIPT_ERROR`.
- **Run lifecycle is a parent-owned state machine, signal-first.** A
  run ends when the awaited default export settles or a terminal
  condition fires. Teardown order: the parent **first fires `signal`
  and opens a bounded grace window** (default 2s) in which the script
  may run cleanup — new broker calls are refused during grace, but
  the child is not yet killed (a cleanup affordance fired *after*
  teardown would be a contradiction, so it is not). Grace-window
  cleanup is therefore **local-only** — `finally` blocks and final
  console records run, but a script holding an app-level lease
  cannot release it remotely; app-side leases must be TTL-bounded,
  and a reserved remote-cleanup call budget is deliberately not
  provided in v1 — then cancels
  outstanding broker calls, disposes open subscriptions and timers,
  flushes the framed stderr lane, serializes the result, and
  terminates the child (forced kill when grace expires); stray timers
  or abandoned iterators never keep a completed run alive.
  **Settlement is provisional**: a settled default export still
  passes strict-profile validation and the output-size admission, and
  failing them exits 10 or 11 respectively — settlement outranks
  other terminal conditions only once admitted. The admitted value is
  **snapshotted (structured-clone) before `signal` fires**, so
  grace-window cleanup mutating a settled object cannot alter the
  emitted result. The parent's
  monotonic clock is the observation authority for racing terminal
  conditions (admitted settlement, then `--timeout`, then resource
  ceilings, then uncaught broker class, then script error; ties break
  in that listed order), and frames arriving after the terminal
  decision are dropped with a diagnostic. The full transition table
  is part of the broker-schema deliverable.
- Injected alongside `api`: `console` (routed to the framed stderr
  lane as console events — the result stays the sole stdout payload;
  **console is script-authored output and passes values through by
  design**, framed and bounded by the aggregate ceiling — the
  engine's value-minimization guarantee covers its *own* channels,
  and a script that prints 500 rows chose to; the §Motivation
  economics claim is scoped accordingly), timers, `signal` — a concrete `AbortSignal` instance that fires on
  `--timeout` or parent teardown, so scripts can clean up — and
  `args`, a frozen array of the argv tail after `--`. Scripts see no
  `process.env`.
- **The audit lane is value-free and leak-resistant by default.** The
  parent records every brokered call and emits a framed, versioned
  stderr record per call carrying the call identity, function id,
  envelope identity, script provenance (content hash of the script
  text; file vs. stdin), a **closed field allowlist** — not generic
  pass-through — of the server response: the diagnostic's concrete
  safe fields — `code`, `severity`, `subsystem`, the fields the
  existing public diagnostic projection actually has, with `code`
  and `subsystem` bounded to a syntactic grammar (today both are
  arbitrary strings copied into the projection, so "safe" must be
  enforced, not presumed) — and with **forward skew pinned, not a
  third compatibility gate**: LLP 0012 lets server diagnostic codes
  grow additively without a tuple change, so a bounded,
  syntactically valid code the engine does not recognize is
  accepted, preserved, and marked unrecognized; code-specific extra
  fields are admitted only for known codes; an unknown code never
  causes exit 8 and is never rewritten — (never
  `message`/`details` free text, which the
  diagnostic schema itself documents may carry source paths, handler
  text, or arguments — the same reasoning as LLP 0031 D3's public
  diagnostic projection), individually named fact fields
  (`changed_count`, receipt id, active envelope identity), and the
  attribution block, whose actor/effective-user/grant contents are
  **named as accepted leakage**; everything else is omitted or
  keyed-committed. A **per-run summary record** closes the lane
  (calls used vs. budget, subscriptions peak, output bytes vs.
  ceiling, elisions), so agents learn the ceilings without hitting
  them. Plus a **coarsely bucketed size class** (not an
  exact byte count) and — for within-run equality evidence — a
  **domain-separated commitment keyed by a fresh per-run secret that
  exists only in the parent and is never emitted**. No unkeyed
  digest: a stable digest of a low-entropy value (booleans, enums,
  short ids) is dictionary-recoverable from captured stderr, which
  would re-import exactly the intermediate results code mode exists
  to keep out of context — and an error `message` echoing a query
  argument would do the same, which is what the allowlist prevents. Full-value recording is opt-in via the future
  `--transcript` (§Future work). All stderr events — audit, console,
  diagnostics — share one framing and one aggregate byte ceiling
  with **typed elision when exceeded (elision, not termination:
  overflow of the audit lane never kills the run)**.
- **No ambient `fetch`, filesystem, or environment.** Outbound HTTP is
  what actions are for (gated egress is a server-side authority
  decision); giving scripts ambient network would create a second,
  unaudited egress path.
- **Resource ceilings are finite by default, part of the frozen
  contract:** `--timeout` (wall clock; default 120s; exit 9),
  `--max-calls` (brokered-call budget; default 1000; exit 11), open
  subscriptions (default 16; exit 11), broker message size, a child
  **V8 heap ceiling** (exit 11, classified as this ceiling only when
  the installed heap limit is the witness; stated honestly: Node
  child processes offer no portable total-RSS limit, so external and
  native allocations are bounded only by the wall clock, and an
  unexplained OS kill is engine-internal exit 1, not a dressed-up
  taxonomy row), and the stdout result ceiling (typed overflow
  document; exit 11). Flags raise them to hard maxima, never
  to unbounded; retries, renewals, and resubscribes consume the
  budgets of the calls that caused them. On any of *these* ceilings
  the parent runs the teardown state machine above.

**Boundary honesty.** On the Node host the injected-globals surface
is a contract and a convenience, **not a security boundary, and no
hostile-code bound exists**: a script that escapes the Node vm can do
anything the invoking OS user can — including reading user-readable
custody files and env vars where the long-lived credentials live, and
using ambient OS networking. The parent/child broker is precisely a
**non-transmission property**: no bearer is ever handed to the child
through any legitimate channel, which defeats accidental disclosure
(env dumps, `args` echoes, result payloads) — it is not containment
for an escaped script. Running scripts you do not trust with your OS
user's authority is out of scope on the Node host, and the RFC says
so rather than gesturing at a vm; containment, if wanted later, is
OS-level (separate user, container) or an embedded-VM host whose
injected surface is a frozen, auditable policy — the direction ibex
LLPs 0013/0014 point, whose own threat-model framing is supply-chain
integrity (see §6). The brokered ABI is what makes a stronger host a
drop-in: enforcement strengthens, script semantics do not change, and
the host-portable acceptance suite (§7) keeps that claim checkable.

### 4. Auth: the existing model, projected — with explicit selection

The CLI adds no principals, no grants, no roles — and it never
guesses. **The default principal is anonymous, always.** Selecting
authority is explicit: `--principal dev|session|agent`, or
`--principal auto` as a deliberate opt-in that probes a defined
source inventory (probe order, not precedence: an explicit
credential/profile flag, the profile store for this target,
documented env vars) and **refuses when more than one source is
live** (`SNAPBACK_APP_CLI_USAGE`) — conflict-refusal, consistent with
the ambiguity rule everywhere else on this surface — and
**invalid-never-fallback**: a malformed or stale source is a typed
error, not a silent step down to anonymous. There is no promotion an
agent didn't ask for — a persisted session or an env-supplied
credential changes an `optional-user` call's behavior, so its use is
never implicit. `whoami` and `introspect` report the selected
principal's *source*; no secret is ever echoed.

- **Anonymous** — the server's invocation gate accepts anonymous
  callers for `public` and `optional-user` (the default) functions
  and refuses them only for `authenticated` ones
  (`SNAPBACK_AUTH_REQUIRED`). The CLI mirrors exactly that and no
  more. An `optional-user` function whose rules reference the auth
  projection can still refuse at call time — the sealed anonymous
  projection carries no `kind`, so kind-referencing rules fail closed
  (LLP 0055) — and the CLI surfaces that as the ordinary server
  refusal it is, not something it predicted.
- **Dev (client-asserted, dev-mode only)** — dev-mode targets
  resolve a request-supplied user id to `DevImpersonation`
  (LLP 0031's `AppAuth` lane; the headless client's `userId`
  parameter). The CLI exposes it as `--principal dev --dev-user
  <id>`, mirroring LLP 0042's `devUser` posture: local-dev-only,
  audit-visible, and refused by the server under sessions mode — the
  engine does not gate it client-side beyond the capability pre-flag.
  Without this lane, `authenticated` functions would be unreachable
  on the tool's primary development target; with it, the CLI projects
  the headless client's dev surface instead of silently subtracting
  it.
- **Human session** — `login` drives the headless client's session
  flow (`authRequestCode`/`authExchange` in sessions mode); the server
  resolves all authority from the session bearer; no caller-selected
  identity exists. Role gates are LLP 0056 memberships, evaluated
  server-side like any other client arm. Because the CLI is
  process-per-command, phase 1 includes a **Node session custody
  store** for `AuthCoordinator` (which today has memory and IndexedDB
  storage only): transactional, file-backed, keyed by (target origin,
  app id, profile name — `--profile <name>` lets an agent hold two
  identities against one target to test role behavior), with the same
  **exact POSIX file-safety contract the existing filesystem
  custody already enforces** (owned 0700 directories; owned,
  single-link, bounded 0600 files; symlink and unsafe-ancestor
  refusal; fsync ordering and crash recovery; advisory locking —
  referenced as one contract, not an abbreviated list; the
  *bearer-persistence policy* is per-store: agent custody refuses
  bearer fields, session custody's whole job is persisting one) as
  agent custody,
  holding the session across invocations until `logout`. Concurrent
  invocations under one session profile inherit the coordinator's
  existing supersession protocol (`CREDENTIAL_SUPERSEDED` → custody
  reload → one retry → family alarm), **serialized under the store's
  advisory lock** so a raced refresh cannot trip the family alarm;
  §7 exercises two concurrent invocations spanning a refresh.
- **Agent** — the intended main path, **restricted in phase 1 to
  loopback origins as a client-enforced necessary condition**: a
  capability fact served by the target forwards through a reverse
  proxy exactly like every other byte, so it cannot prove *how the
  client reached the server* — and LLP 0055 pins that a
  reverse-proxied local process is not trusted-local. Until the
  deployment-bound trusted-local attestation lands (an 0055/0060
  prerequisite, owned there), the engine simply refuses to present
  agent credentials to a non-loopback origin; conservative,
  reversible, and honest. Provisioning precondition stated:
  **registration is not this CLI's job.** LLP 0055 creates an agent
  and issues its credential through registration, separately from
  pairing; phase 1 assumes an already-registered, credentialed
  agent. `pair` is **grant onboarding**, and it carries **both
  halves the pairing wire actually requires**: the non-secret
  pairing-request id (an ordinary `--request <id>` flag) and the
  secret pairing code — supplied via hidden prompt, stdin, or a
  securely admitted file, **never a literal argv flag** (shell
  history and process listings are disclosure channels; the code
  alone cannot construct the closed pair DTO, which is why both are
  specified — this matches the *implemented* `AgentPairRequest`
  wire; LLP 0055's prose describes a code-first flow, and the dated
  0055 amendment reconciles that prose to the implemented protocol,
  a named discrepancy rather than a silent one). It submits them
  with the requested scopes, polls, and persists the resulting
  grant id;
  on success it prints the exact next command (`--principal agent
  …`), because the most predictable stumble after pairing is calling
  without it. The user mints the code and hands both values to the
  agent (LLP 0055's inversion of device flow); `pair` takes them as
  input, it does not display a code. Standing state lives in a **credential profile file**
  — a closed phase-1 DTO binding profile version, normalized target
  origin, app id, grant id, the server-derived durable actor and
  authority tuple (persisted so restart re-attests without guessing;
  a delegated grant's effective user is not its actor, and the
  engine never conflates them), and the credential **by reference
  only** — a file path (whose target passes the same secure
  admission: real 0600-owned non-symlink file) or a documented env
  var, never inline, so the profile itself is not a secret-bearing
  document and the secret store's contract stays in one place —
  with invalid-never-fallback.
  The long-lived credential (`sbac_`) is presented **only to
  LLP 0055's closed agent-lifecycle routes** (pair, token mint, and
  the supported rotate/revoke-self operations — secret-classified
  request bodies), never on app-data requests. Non-redirection is
  **client-enforced, not assumed**: every engine request that carries
  a credential (lifecycle bodies and bearer-headed app-data alike)
  is issued with redirects treated as terminal errors — the platform
  default follows redirects, and a 307/308 would replay a secret
  body to whatever URL a proxy, misconfiguration, or hostile target
  names — and the engine pins the normalized target origin and
  scheme (HTTPS, or **HTTP only to loopback**, where loopback is a
  mechanism, not a vibe: v1 admits only literal `127.0.0.1` and
  `[::1]` origins — no hostnames, `localhost` included, because a
  name that *resolves* elsewhere or an environment-configured proxy
  would carry the first request off-host before any redirect rule
  applies — over a direct transport with proxy env vars explicitly
  ignored, judged on the connected peer address, userinfo refused; in
  phase 1 the credentialed loopback targets are local sessions
  servers) before any credential leaves the parent. **The accepted
  trust decision, stated rather than implied: v1 trusts any loopback
  listener on the configured port.** Locality checks prove where the
  listener is, not who it is — another OS user could bind the port
  while the real server restarts and receive a lifecycle request's
  credential body. That residual is accepted for phase 1 as the same
  posture every localhost dev tool takes, it is reconciled with
  LLP 0055's custody guarantees in the dated 0055 amendment (custody
  protects the file at rest; the wire trusts loopback), and
  authenticated local server identity (a Unix-domain socket with
  verified peer credentials, or a pinned server key with a signed
  challenge) is named future hardening, not assumed away.
  **Bootstrap and restart are pinned:** mint a scoped token under
  the profile's grant, complete the authority-descriptor handshake
  so the fence holds the server-derived actor/authority facts —
  never a client guess — then make app calls through the fence's
  validated path; `AgentAuthorityFence` handles scoped-token
  custody, not `sbac_` storage (its filesystem store deliberately
  refuses bearer fields), so **the scoped token is minted per
  invocation — short-TTL** (roughly the invocation budget plus
  slack, via the mint route's TTL parameter; watches mint longer and
  renew): a finished command's token expires promptly, **and the
  dated 0055 amendment adds an exact-token release primitive the
  engine calls at invocation end**, so a finished command's token
  leaves the bounded per-grant family immediately rather than
  lingering until TTL — without release, nine completed short-TTL
  commands whose tokens haven't yet expired would still crowd the
  family and the next mint would evict the oldest live token, the
  watch first (oldest-first eviction makes a long-lived watch the
  structural first victim). Admission accounting therefore counts
  **unexpired tokens, not processes**, against the advertised cap,
  with reserved watch/renewal headroom — and it is **crash-safe by
  lease expiry**: ledger entries are non-secret leases whose TTL
  matches the token's, so a process killed after mint and before
  release leaves a lease that expires exactly when its token does,
  and accounting self-heals within one short TTL; release is
  idempotent and authorized by the invocation's own token, and a
  lost release response is retried once then left to TTL. `pair`
  **immediately releases the first scoped token the pairing flow
  returns** (it persists only the grant id; token-id format
  compatibility for pairing-prefixed ids is the 0055 amendment's to
  pin). Tokens are never persisted, which makes LLP 0055's mint
  throttle a sizing obligation for CLI workloads (the dated 0055
  amendment carries a concrete floor sized so a realistic sequential
  burst of hundreds of calls under one grant does not self-throttle
  **and states why the raised floor stays abuse-safe** — minting
  requires a live credential plus grant, accounted per credential —
  or pulls the token broker forward instead; a §7 test exercises the
  burst) and makes the per-grant live-token cap a real
  interaction: a burst of sibling invocations under one grant can
  evict a concurrent watch's token (the renewal machinery self-heals
  it; §7 tests exactly this). **Above the cap, admission is bounded,
  not emergent — and its scope is stated honestly:** concurrent
  invocations gate on a cross-process admission bound in the custody
  root, keyed by (normalized target, app, grant) — the server's cap
  is per grant, so keying by profile would let two profiles bypass
  each other — with capacity read from the advertised capability
  fact (never a hardcoded copy of 0055's constant, which would drift
  silently); an invocation that cannot admit within a bounded,
  flag-overridable wait refuses with a typed diagnostic instead of
  silently revoking a sibling's token mid-flight (an ordinary auth
  refusal is a bad answer for a mutation whose outcome may already
  be unknown). The gate coordinates **participating invocations on
  one host sharing that custody root** — a second host or a non-CLI
  minter under the same grant is outside it and can still evict;
  that residual is named, bounded by the cut/resync and
  write-outcome contracts, and properly fixed by the future
  profile-local token broker (§Future work). App calls ride the scoped token
  (`sbagt_`); every bearer exists only in the engine's parent
  process (§3). Delegated invocations inherit LLP 0055's
  host-enforced non-widening. `--grant <id>` overrides the profile's
  grant; ambiguity refuses rather than guesses.
- **Target matrix, stated as capability facts.** Phase 1:

  | Target | Anonymous | Dev-asserted | Human session | Agent |
  |--------|-----------|--------------|---------------|-------|
  | local dev (`snapback.v0`/`dev`) | yes | yes (`--dev-user`; the target's own lane, not a CLI invention) | n/a (no sessions in dev mode) | n/a |
  | local sessions (`snapback.v1`/`sessions`) | yes | no (server refuses dev assertion) | yes | yes (loopback origins only; §Agent) |
  | remote service (`remote-service-sqlite-ibex` profile — a managed HTTPS service, neither loopback-local nor the future hosted-auth profile) | yes, once it advertises `app-cli.target` (until then the engine treats it as capability-absent) | no | no (non-loopback; no phase-1 credentialed lane) | no (loopback condition) |
  | hosted | **out of phase 1** (no hosted target ingests or serves envelopes today; LLP 0060's future first hosted-auth profile pins `/_snapback/*` to 404 on the public origin; hosted distribution is follow-up work) | — | — | — |

  **Trusted-local is deliberately absent:** it is an unmet LLP 0055
  landing prerequisite to be bound to an LLP 0060 target-authored
  capability that does not exist yet — the deployment classes today
  are local and hosted, and the local fence cannot distinguish a
  publicly reverse-proxied process. When that capability lands (in
  those LLPs, not here), trusted-local behaves as the local sessions
  row. The engine never infers any of this from a URL — and that
  rule has teeth only if the fact exists to read: eligibility rides a
  **named, target-owned capability** (working id `app-cli.target`:
  which principal classes the target supports, whether it serves
  envelopes, whether it accepts generation assertions, the per-grant
  token cap) — a **structured descriptor**, not a ninth entry in the
  closed `TargetCapabilityId` string set, landing as a dated
  amendment to LLP 0058 (which owns `supportedCapabilities`)
  following LLP 0060's structured-descriptor pattern — carried by
  the `/inspect` capability manifest on every tuple and echoed by
  sessions discovery. Capability facts state what the *target*
  supports; they never prove transport locality, which is why the
  agent lane's loopback condition is engine-enforced (§Agent) — kept distinct from the target's *current*
  auth posture, which LLP 0012 separates from static support. Today
  a local dev server and the Cloudflare gateway advertise the same
  admissible tuple, and distinguishing them by URL, profile id, or
  correlated capabilities would be exactly the forbidden inference;
  the named capability is what makes the refusal honest.
  `--help`/`introspect` present refusals as target capabilities, not
  bugs. Operator credentials
  (admin token, leases) are rejected on this surface by construction
  (§Position).

### 5. Distribution: the server advertises, the server is the version authority

Two things are versioned; they move at different speeds and are kept
separate. The wire artifacts are **closed DTOs with their own
`artifactKind` and version fields and exact JSON Schemas**, committed
as phase-1 deliverables with drift gates — with **ownership
partitioned per LLP 0037's principle and durably recorded in the
LLP 0024 amendment** (0037's enumerated scope predates engine-owned
wire DTOs, so the partition is registered, not just asserted): Rust
owns every DTO the server parses or emits (the discovery document,
the envelope admission projection, the generation-assertion wire),
generating their schemas; the engine owns the genuinely client-only
DTOs (introspection output, parent/child broker frames, and the
call-result document's **presentation wrapper only** — the result's
semantic core is Rust-owned; §2 pins the split) — and if the generated MCP catalog is
ever server-delivered, the shared core's schema flips to Rust
ownership under this same rule, which the amendment states in
advance. Unknown-field rejection applies to the strict wrapper
layers — and, crucially, **to the served public payload too, where
the additive-ignore rule would be a disclosure hole**: because the
server serves the envelope byte-exact, "ignore unknown nested
fields" plus "serve what was received" would publish any unknown
source-bearing member a provisioner smuggled in. So admission
requires the nested function projection to be **exactly equal — no
unknown fields — to the server-derived `PublicFunctionManifest`
projection of the manifest being activated**. This is deliberately
stricter than LLP 0012's general additive-field rule, and the
amendment reconciles the two explicitly: additive evolution of the
*public* surface happens through the Rust projection types (add the
field there, classify it, and both sides move together), never
through passthrough. **The nested projection has one source of
truth:** the Rust-owned public projection types (LLP 0031 D3's
exhaustive destructure; LLP 0037's Rust-first rule), CI-validated so
codegen cannot silently diverge. *Engine-side* consumption of the
nested payload still follows additive-ignore (an older engine reads
a newer projection safely); it is the server's publication path that
is exact-match.

**App artifacts (move constantly, are data).** These routes live on
the **app-data plane, beside `/inspect`** — not under `/_snapback/*`,
whose reserved prefix LLP 0031's proxy invariant lets deployments
refuse wholesale and LLP 0060's future first hosted-auth profile
pins to 404.
Public app-facing artifacts belong on the plane proxies pass
through, which also keeps the eventual hosted path from needing a
different namespace. The registration is a dated LLP 0031 amendment
(reserved root names on the app-data plane, GET-only, public,
read-only), a named phase-1 deliverable. Working spellings:

- Discovery and envelope fetches use a **bare, credential-free,
  non-redirecting path**: no admin, session, agent, connection, or
  cookie carrier ever attaches to these public requests (the shared
  client's ordinary auth handshake must not leak onto them via the
  lift; §7 tests it).
- `GET /app-api/current` — a small discovery document (sessions
  targets only), registered **`PublicNoStore`** (LLP 0031's class
  for exactly this: a fixed typed public response that must never be
  cached or body-logged): app id, current envelope SHA-256, the
  artifact tuple, the target-capability field of §4, and the
  engine-version range it expects (advisory only; below). An app
  provisioned before the envelope amendment landed has an active
  generation with **no envelope**: `current` says so with a stable
  typed marker (not a 404, not exit 8 — the tuple is admissible),
  and the engine's behavior is pinned to what the binding rule
  permits: local `--artifacts` serve **`--help`, `introspect`, and
  `types` only**, and any network operation is a typed
  redeploy-required refusal — an envelope-less generation has no
  identity to assert, and asserting nothing would ride the
  deliberately unchecked compatibility path, silently violating the
  every-sessions-call guarantee. The refusal carries the pinned
  redeploy hint. Dev targets serve no discovery document and no
  envelope — the engine uses the existing public `/inspect`
  projection for capabilities and binding attestation, and local
  `generated/` artifacts for the surface (§1).
- `GET /app-api/envelope/<sha256>` (exact grammar: 64 lowercase hex
  characters; malformed is a typed 400, `no-store`; registered GET
  routes answer HEAD/OPTIONS per the registry's standing behavior,
  documented rather than denied) — the **immutable,
  content-addressed envelope**, registered `PublicProjection`: the
  source-stripped function-manifest projection, the operations
  schemas keyed by stable function id, `api.d.ts`, and
  `code-mode.d.ts`, in one response. **The identity is the SHA-256
  of the uncompressed RFC 8785 (JCS)-canonicalized envelope
  document, and the envelope is served with identity content-coding
  only** (no transport compression for this route — it keeps one
  coherent integrity story), carrying `Content-Digest:
  sha-256=:<base64>:` over the transmitted body per RFC 9530 and a
  correctly quoted strong `ETag` (RFC 9110), plus
  `x-snapback-server-build-commit`. Cache directives are pinned in
  both directions: a verified 200 is `Cache-Control: public,
  max-age=31536000, immutable`; the evicted-hash 404 and the
  envelope-less marker are **`no-store`** — a rollback can make a
  previously evicted hash current again, and a heuristically cached
  negative response would hide a valid envelope behind it. The
  server retains the current and previous generations' envelopes
  (the deploy race window); a request for an older hash is that
  typed no-store 404, which the engine treats as a normal
  refetch-via-discovery.

Disclosure posture, stated precisely:

- **Source-stripped, and public.** The build manifest embeds full
  handler source (`runtime.IbexModule.source`, HostPlan bodies,
  `sourceSpan`); serving it verbatim would hand any caller the app's
  implementation. LLP 0031 D3 already decided this:
  `PublicFunctionManifest` is an exhaustive typed **allowlist
  projection** — handler source, HostPlan bodies, `sourceSpan`,
  diagnostic free text, and every other unclassified field are
  excluded by construction, not by an enumerated strip list — and the
  ungated public `GET /inspect` already serves the complete
  source-stripped inventory — every function, `authRequirement`
  included, and full table shapes — to anonymous callers. The
  envelope adopts that same posture: **one public projection,
  principal-independent** (no per-principal variants, so no
  `Vary`/shared-cache leakage and no scoped-token-on-artifact-route
  question). Two disclosures are *new* and accepted deliberately: the
  per-function **operations schemas** (argument shapes;
  `PublicFunctionDefinition` carries no args validator today) and the
  **declaration files** (typed shape of the data model). Both are
  shape, not source — but "same class as `/inspect`" is an argument,
  not a guarantee, so the declarations and schemas served publicly
  must be **generated from typed public projections**: no filesystem
  paths, no source fragments, no source-derived comments or
  free-form text (the fixed codegen banner is permitted and named,
  so the sentinel tests have a precise target), and §7's sentinels
  cover every envelope member field-by-field, not just the manifest.
  An app-level knob to restrict the advertised surface is an open
  question and would have to govern `/inspect` too — redacting one
  but not the other protects nothing.
- **Ingestion is specified per tuple, not assumed.** Codegen grows
  the envelope as a build output (listed in `artifacts.json` once
  phase 1 lands). On the **v1-sessions tuple**, the provision intent
  — a closed DTO under LLP 0012 — is extended to carry it **as opaque
  canonical bytes** (the server stores and serves the envelope
  byte-exact, never reserializes it, computes the SHA-256 over the
  received bytes itself — a codegen-declared hash is never trusted —
  and bounds the accepted envelope size at ingestion). **Canonicity
  is verified, not assumed:** admission parses the received bytes
  (bounded; duplicate keys and non-I-JSON forms rejected),
  JCS-reserializes, and requires byte equality with what was
  received — equivalent-but-noncanonical JSON is refused, so one
  logical envelope cannot carry two identities. **Activation proves
  correspondence, not just simultaneity:** the server parses a
  bounded, Rust-owned admission projection of the envelope and
  cross-checks its app id, tuple, `inputsHash`/`bundleHash`, complete
  stable-id function set (kind and effective `authRequirement`
  included), and operation-schema key/digest set against the
  schema/function pair being activated — a provisioner cannot pair
  manifest A with envelope B, and a swapped or missing operation
  schema is refused before activation. **Schema correspondence has
  an independent trust root, not a self-referential one**: the
  provision-side function artifact (independently activated) gains a
  codegen-emitted **per-member digest map keyed by stable id,
  covering the operation schemas *and* the declaration members** —
  envelope-local digests prove internal consistency, not that
  schema A (or declaration A) belongs to function A, so admission
  recomputes every received member's digest and compares it against
  that independently carried map, atomically with activation;
  grammar validation bounds *structure*, the digest map binds
  *semantics*. The
  declaration and schema members are additionally validated at
  admission against the closed permitted structure of §Disclosure —
  the server checks the structure it will serve. All of this is a
  compatibility event, landing with a **dated LLP 0012 amendment**
  that also carries the call-time generation-binding check of §1;
  activation is atomic with the function-manifest swap it describes
  (same transaction; rollback and restart keep the pair consistent).
  **Half-updates are covered, not assumed away**: LLP 0012 permits
  schema-only and function-only provisioning against the attested
  sibling, so every effectful v1-sessions update atomically
  activates either a newly correspondence-checked envelope for the
  *completed* candidate pair, or an explicit envelope-absent
  generation (the §current typed marker; the introspection-only rule
  applies) — a stale envelope describing a replaced half never
  survives as current, and an older provisioner that omits the
  envelope field lands in the envelope-absent state by that same
  rule. On the **v0-dev tuple**, the
  legacy untagged ensure form is *not* extended: dev targets are
  in-checkout by definition, the engine uses the local `generated/`
  directory, and the call-time binding guarantee does not apply
  there (§1). Acceptance witnesses that served bytes match the
  build's generated artifacts (§7).

**The engine (moves rarely, is a program).** The discovery document
does **not** name an install command: the package name
`@snapback/app-cli` is pinned engine-side and in documentation, never
taken from a server response — a server that can hand an agent an
arbitrary `npx <string>` to run is the same download-and-execute
trust hole §1 closes for `api.mjs`, and a degraded-mode diagnostic
therefore prints the *pinned* name with the server's expected version
range. Standalone binaries, when they exist, are a redirect to a
pinned release host with published checksums (scale-to-zero targets
should not serve platform binaries).

**Compatibility has exactly two hard gates, both engine-evaluated:**
the artifact tuple (LLP 0012's closed admissible set — `(snapback.v0,
dev)`, `(snapback.v1, sessions)`; the engine supports every tuple
admissible at its release, and a future tuple is by definition an
LLP 0012 amendment that also revisits this list) and the engine-owned
DTO protocol versions. Either outside the engine's set is
`SNAPBACK_APP_CLI_VERSION_MISMATCH` (exit 8), direction in the
diagnostic detail, with `--help`/`introspect` degrading to identity +
mismatch + pinned install spelling rather than refusing cold. The
server-authored engine-version range is **advisory only** — it powers
the degraded-mode hint and never causes exit 8, because a
package-semver range cannot decide compatibility of a newer engine
against older data, and engine-newer-than-server is the common skew.
v1 has no self-update.

Exact apps surface this by printing the pinned install line — no
additional machinery.

### 6. Packaging phases

1. **Node engine (normative, phase 1)** — `packages/snapback-app-cli`,
   run via npx or a checkout; parent/broker architecture from §3;
   erasable-only TS via the engine's own transform. Platform floor
   pinned per LLP 0010's distinction: the exact tested authority is
   the repo-pinned Node version (today 24.18.0 via `.node-version`),
   the supported range is that major (24.x); **the whole engine is
   POSIX-only in v1** (not just its credential paths — one honest
   refusal beats a half-working surface), with the custody stores
   proving 0600/advisory-lock semantics and a structured diagnostic
   before any credential is read on unsupported platforms. Phase 1
   lands in three internal sub-stages, each independently useful:
   **(a)** local-artifacts subcommands against dev targets — needs
   no server changes, which is coherent for two named reasons: the
   call-time binding guarantee is scoped to sessions tuples (§1),
   and **stage (a) presents no credentials** (anonymous and dev
   assertion only — dev assertion is harmless to present to a wrong
   target, which refuses it), so the eligibility descriptor is not
   load-bearing there; the descriptor and its `/inspect` emission
   land in (b) **before any credentialed lane ships**. The
   LLP 0024 shared-core amendment is a *document* and precedes
   stage (a)'s frozen result contract (its server-side parity gates
   land with (b)) — the frozen surface never ships in a pre-shared
   form. **(b)** the served envelope, sessions and agent principals,
   and the LLP 0012 / 0024 / 0031 / 0055 / 0058 amendments —
   internally ordered, each step independently landable: envelope
   serve/ingest first, then generation binding, then the shared
   result core's parity gates, then the attribution seams; **(c)**
   code mode. Sub-stages land under ordinary CI with their own tests
   — §7 gates the *phase*, with each family naming which sub-stage
   exercises it: (a) owns the dev-scoped subcommand goldens, dev
   auth cells, binding attestation, and output contracts; (b) adds
   the server-side families (ingestion witness, generation races,
   attribution parity, envelope-less behavior); (c) adds the
   code-mode suite. **Stage (a) is independently releasable**,
   version-marked as a phase-1-incomplete engine (its `--version`
   and docs say so); the frozen contracts it ships are already
   final. Also in phase 1: lifting the
   app-data client core out of `demos/_kit/` — **the kit then
   re-exports the lifted package** (one source; a hand-synced copy
   is exactly the drift LLP 0012 documents from Valet, and a CI
   equality gate holds during the transition) — the Node session
   custody store and credential profile DTO (§4), and the finite
   result seams (§2).
2. **Standalone executable (non-normative direction)** — packaging
   the engine via ibex LLP 0029 conflicts today with that contract as
   written: 0029 admits **exactly one embedded entry** — no REPL, no
   eval, no file-execution ingress — and erases TypeScript at compile
   time, while this engine must accept arbitrary external scripts;
   its embedded policy is also a total authority ceiling at odds with
   a runtime-selected target URL. Ibex LLPs 0013/0014 frame their
   boundary as supply-chain integrity, not a hostile-code sandbox. So
   phase 2 proceeds only after the relevant ibex LLPs are revised
   (script ingress — plausibly ibex 0022's `Quarantine` principal
   with an explicitly passed broker capability rather than ambient
   authority — separate engine/worker policies, runtime transform
   inclusion per 0028, target attenuation), under its own review —
   this RFC does not commit those contracts, creates no phase-1
   embedded-Ibex or computed-import requirement, and phase 1 depends
   on none of it. Ibex 0028's current citation of this RFC predates
   that scoping (and ibex 0029's own text says its v1 "prototypes
   the Snapback CLI" — the same stale coupling); **filing the
   correcting ibex-side amendments — to both 0028 and 0029 — is a
   landing obligation of this RFC** so the two corpora cannot
   sequence work against a dependency that no longer exists. The §3 brokered ABI and the §7 host-portable suite
   are what make the eventual move checkable.

### 7. Acceptance

Phase 1 is done when the following hold, all CI-run:

- **Subcommand goldens.** A fixture app exercises every subcommand
  and every row of the exit-code table, TTY and non-TTY, including
  `--first-change` / `--timeout` / reconnect-dedupe / latest-wins
  coalescing; a **parameterized live query with required args**
  subscribed end-to-end (not only the no-arg case); mid-watch
  scheduled renewal (cut/resync — the chosen observable semantics
  asserted, not merely eventual reconnection) *and* credential
  rotation (terminal for the watch: typed diagnostic naming
  rotation, clean restart under the successor recovers);
  kill-after-mint lease expiry, failed-release retry-then-TTL,
  stale-lease self-healing, and pairing-token immediate release;
  two concurrent invocations under one session profile spanning a
  refresh (supersession serialized, no family alarm); swapped or
  stale *local* artifact members refused by the loader's digest
  check; schema-only, function-only, rollback, restart, and
  legacy-provisioner envelope transitions; sibling-invocation
  token-cap eviction healing a
  concurrent watch; a sequential burst of hundreds of calls under
  one grant not self-throttling; **above-cap concurrent query,
  mutation, action, and watch invocations admitted in bounded order
  or refused typed, never silently revoking a sibling mid-flight**;
  oversized/dishonestly-framed HTTP and WebSocket responses refused
  under the parent ingress limits with bounded memory; and
  deploy-during-watch generation behavior — all against a live
  memory server. Write-outcome rows: mutation response lost after
  commit (`outcome: "unknown"`, then explicit `--mutation-id`
  same-id replay recovering settlement; a differing argument digest
  refused), failure before dispatch, timeout with the effect still
  in flight, and commit-then-deploy obstructing replay.
- **Auth matrix.** Every `authRequirement` × principal class
  combination from §4's matrix — the anonymous × `LiveQuery` cell
  named explicitly, since live admission has its own gates —
  including dev assertion working in dev mode and refused by a
  sessions-mode server, presented-but-invalid credentials
  (invalid-never-fallback observed), out-of-grant functions,
  principal-ambiguity refusal, `pair` end-to-end from a provisioned
  credential (including restart-from-profile re-attestation and a
  forged actor/effective-user substitution refused), **a public
  reverse proxy fronting an otherwise-identical local sessions
  server never receiving agent credentials** (the loopback necessary
  condition), `--mutation-id` replay refused with zero dispatch
  across profile, user, grant, delegated-authority, and generation
  changes (the new-generation case admitted only under the explicit
  override), and the two client-decidable pre-flags (and only those
  two) firing.
- **Binding and generation (scoped per §1).** Wrong-app,
  same-named-function, and stale-bundle pairings of target and
  artifacts each fail closed on every tuple, including two apps with
  identical function names and the terminal `--artifacts` case; on
  sessions tuples, a deploy between discovery and dispatch is
  refused by the server's generation check and succeeds after
  refetch, and exit 7's three sub-causes are machine-distinguished;
  a stale intermediary-cached `/inspect` response cannot validate
  stale dev artifacts (revalidation-fresh attestation asserted).
- **Adapter conformance.** The LLP 0012 invariants the engine claims
  (stable ids, tuple refusal, atomic envelope replacement, integrity
  refusal) each have a test that forges the violating input, plus
  bounds tests for §1's defensive parsing limits and the
  three-way unknown-field scoping of §5 (wrapper-strict; server
  publication exact-match against the Rust projection; engine-side
  consumption additive-ignore).
  Activation-correspondence forgeries are refused: manifest A paired
  with envelope B, a swapped operation schema (with all
  envelope-local hashes recomputed after the substitution — internal
  consistency must not pass for safe derivation), a missing schema,
  a changed kind or `authRequirement`, and an
  equivalent-but-noncanonical JSON envelope each fail before
  activation.
  The envelope-less sessions generation is exercised: introspection
  works from `--artifacts`, every network operation returns the
  typed redeploy-required refusal, and the capability-eligibility
  matrix (local dev and local sessions advertise `app-cli.target`;
  the hosted gateway's identical tuple refuses) is asserted without
  URL inference.
- **Disclosure sentinels.** Field-by-field comparison of every
  envelope member against its typed public projection (validated
  against the Rust-generated schema per §5's single-source rule),
  plus planted source/path/comment sentinels proving none can reach
  the served envelope, `introspect` output, or the on-disk cache —
  LLP 0031 D3's discipline extended to declarations and operations
  schemas, with the permitted codegen banner named exactly.
- **Served-artifact witness.** Memory-server acceptance verifies the
  served envelope byte-matches the build's generated artifacts and
  its content address (JCS preimage → SHA-256 → `ETag` and
  `Content-Digest` recomputed from received bytes; conditional
  requests honored; identity encoding verified; cache directives
  asserted in both directions, including rollback to a previously
  evicted hash through an intermediary cache; no credential of any
  class attached to discovery or envelope fetches). A **JCS
  conformance fixture family** runs the same corpus — including the
  number edge cases where RFC 8785 meets ECMAScript formatting
  (the 1e21 boundary, negative zero, long fractions) — through both
  the Rust and engine implementations, since admission's
  reserialize-and-compare makes cross-language byte equality a
  contract, not an aspiration.
- **Result-contract parity.** The same invocation through HTTP,
  headless client, and CLI — and the generated MCP catalog **once
  that catalog ships; its absence does not block phase-1
  completion** (the shared core is the phase-1 prerequisite; the
  catalog is not) — yields the same application value under the
  same canonical envelope profile, the same server diagnostic codes
  and safe fields, and the same attribution block (LLP 0055 §Audit)
  — for every function kind including live subscriptions (via the
  named wire seams), the principal classes of §4, and error paths.
- **Credential non-transmission, stated per class and channel.** With
  planted admin, session, and agent secrets: no bearer of any kind in
  the script host's argv, environment, globals, IPC frames, console,
  or result output; admin tokens and long-lived `sbac_` never in any
  app-data request; anonymous and dev requests carry no bearer;
  session and agent app-data requests carry exactly the selected
  principal's short-lived carrier (session bearer or `sbagt_`),
  inserted only by the parent; `sbac_` appears only in the bodies of
  LLP 0055's closed, non-redirecting agent-lifecycle routes (pair,
  mint, rotate, revoke-self) and nowhere else; **connection
  capability tokens** (the header/subprotocol bearers of the live
  wire) are in the same planted-secret taxonomy as every other
  carrier; pairing codes never appear in argv, environment, logs, or
  audit output; **redirect sentinels** prove that same- and
  cross-origin 301/302/303/307/308 responses on credentialed
  requests — the loopback-sessions case named explicitly, since that
  is the target class phase-1 credentials actually visit — are
  terminal errors and no second hop ever receives a secret body or
  bearer header; and the engine's client façade never reads
  `SNAPBACK_ADMIN_TOKEN`.
- **Code-mode contract suite.** Host-portable scripts (same inputs,
  same expected outputs) covering the §3 language profile — top-level
  await, refused imports, refused non-erasable syntax, the
  export-name split exercised both ways (valid-but-hazardous names
  alias-suppressed yet callable via `snapback.function(id)`;
  authoring-invalid/reserved names refused at codegen and by
  forged-envelope admission), default-export results,
  strict-profile serialization failures, overflow documents, caught
  and uncaught broker failures of every exit class — plus typecheck
  fixtures compiling this RFC's examples against the generated
  `code-mode.d.ts`, every resource ceiling (heap-ceiling kills
  classified only under the installed-limit witness), the
  signal-first grace window (cleanup observed running; broker calls
  refused during grace; forced kill at expiry), provisional
  settlement (a settled value failing strict-profile or size
  admission exits 10/11), late frames after a terminal decision
  dropped with a diagnostic, orphan timers/abandoned iterators not
  outliving settlement, racing terminal conditions resolving in the
  pinned order, iterator disposal, a low-entropy planted-value test
  proving captured stderr cannot recover or correlate intermediate
  values beyond the accepted leakage, **planted sensitive values in
  diagnostic messages/details and non-allowlisted fact fields never
  reaching the audit lane** (on success, refusal, and caught-error
  paths), and a proof that a large intermediate value (the 500-row
  case) appears in **neither stdout nor stderr**.

## 2026-07-19 implementation checkpoint and rescope

The first landed outcome is intentionally narrower than this reviewed RFC:

- the framework-neutral client and agent fence are versioned in
  `packages/snapback-client` rather than owned by `demos/_kit`;
- `packages/snapback-app-cli` loads the local artifact index and function
  manifest as inert JSON, exposes introspection plus programmatic call/live and
  pairing operations, and never imports generated program source;
- its acceptance test proves one packaged discover → pair → scoped-principal
  fence → mutate → subscribe → verify journey and proves the bearer does not
  enter the returned result;
- `guide/clients/app-cli.md` and `guide/auth/agent-principals.md` make the
  reachable local surface discoverable.

This is the rescoped phase-1 checkpoint recorded by
`issues/20260717-app-cli-phase1-program.md`. It does **not** advance this RFC to
Active and it does not imply served envelopes, generation binding, human
session custody, frozen multi-projection result/exit semantics, code mode,
per-app shims, or hosted support. The existing ticket index remains the
dependency program for that advanced phase. A future implementation must land
the named amendments and satisfy the original contracts before the author can
advance this RFC under LLP 0005.

## Future work (explicitly out of v1)

- **Hosted distribution** — the namespace is already hosted-safe
  (app-data plane); what remains is deploy-time envelope generation
  and embedding for the gateway (with `/app-api` routed ahead of
  asset fallback), hosted identity semantics, and a hosted
  acceptance witness. Out of phase 1; the hosted row of §4 stays
  "not yet" until this lands.
- **`repl` and one-shot `-e '<expr>'`** — interactive code mode needs
  session semantics (persistent bindings, ibex LLP 0022's
  discipline) and a filesystem story; a one-shot `-e` form carries
  none of those obligations and is probably the first thing agents
  ask for after `run` (which already accepts stdin scripts via
  `run -`).
- **`subscribe --count <n>`** — exit after n changes; same machinery
  as `--first-change`, and it postpones predicate-DSL requests.
- **`call --output <file>`** — write an over-ceiling result to a file
  and print a summary plus path; the subcommand-surface version of
  code mode's context economics.
- **An authority-bound operation journal** (`resolve <id>`): persist
  request id and digest before dispatch so crashes and lost
  responses become explicit reconciliation instead of retry
  folklore (extends §2's write-outcome contract).
- **Agent-principal dry-run** — LLP 0019 F3's propose-check-commit
  loop has no agent path in v1 (`dryRun` is always false for agents
  per LLP 0055 §Audit; `function.explain` is host-ops); named here so
  the corpus's dry-run thread stays connected.
- **`introspect --changed-since <envelopeHash>`** — the content
  address makes "what changed since I last looked" a cheap diff.
- **`doctor` and `explain-auth <function>`** — read-only diagnosis:
  engine compatibility, target tuple, artifact identity, custody
  permissions, fence bootstrap, route availability; and per-function
  manifest facts plus the server's actual refusal from an attempted
  call — never a client-side prediction.
- **Call transcripts and replay** — a `--transcript <file>` recording
  full call/subscribe result documents replayably (the value-free
  audit lane's opt-in complement; records in JCS canonical form so
  replays diff byte-stably across hosts, values kept separate and
  explicitly user-authorized), and a `run --replay` mode executing a
  script against recorded frames — hermetic acceptance fixtures from
  agent exploration (LLP 0010's direction).
- **A lock file** (`app-cli.lock.json`: app id, artifact identity,
  target binding, engine version) plus a `--frozen` mode for
  reproducible agent and CI runs.
- **A profile-local token broker** — many concurrent
  process-per-command invocations under one grant contend with the
  per-grant live-token cap; a shared broker would mint once and
  lease, instead of mint-per-invocation.
- **Runtime reflection in code mode** (`api.$meta` or a `snapback`
  namespace member: function list, kinds, arg schemas) so
  app-generic scripts don't shell out to `introspect`.
- **A non-Node script host** — the broker frames are
  transport-neutral by design; a Python (or other-language) script
  host against the same credential-owning parent is the other thing
  that neutrality buys, and naming it keeps Node-isms out of the
  frame schema by intent.
- **`subscribe --diff`** — a JCS-canonical patch stream for large
  snapshots; the dedupe rule already does the hard part.
- **A machine-readable engine contract** (`contract --json`: exit
  table, per-kind mapping, strict-value profile, default ceilings) —
  LLP 0010's discipline applied to the engine itself, and a free
  drift gate for §7.
- **MCP projection of app functions** — the shared app-data core
  (§Position) is the contract; what remains is whether one engine
  serves both surfaces, riding §3's transport-neutral broker frames.
- **Server-side code mode** — submitting a script to run *in* the
  server's runtime adjacent to the data. Sharing a VM and a dialect
  does not make this incremental: authenticated code ingress,
  resource limits, provenance, and isolation are each unsolved there,
  and it needs its own RFC — it is ad-hoc function deployment.
- **Authoring affordances** — optional per-function CLI hints in
  `define*` (command aliases, and `--arg k=v` shorthand with
  schema-driven coercion rules if mechanical JSON-only args prove
  insufficient in practice).
- **Typed results** — codegen learning return shapes so
  `code-mode.d.ts` can improve on `Promise<unknown>`.
- **Grant discovery** — `pair` covers grant onboarding, so v1 needs
  no credential-authenticated grant listing; if one is ever wanted it
  needs LLP 0055 review.

## Guide and capability-index obligations

Per LLP 0061 §2 (capability index) this RFC lands in the same commit
as a `capabilities.md` GAP row (working id `clients.app-cli`, naming
this RFC as authority, with owner and review date), and per §5's
landing rule, phase 1 lands with a guide page under `clients/` with
CI-run snippets, plus route-map rows for the new `/app-api` routes.

## Revision history

All revisions 2026-07-17, one per /llp-super-refine round; full
review artifacts under `llp/reviews/0062-*.{fable,codex}.md`.

- **r1** — anonymous model corrected to the three-valued
  `authRequirement`; one public source-stripped envelope; envelope
  ingestion/identity specified; `code-mode.d.ts` introduced;
  parent-brokered calls; result/attribution contract; target matrix.
- **r2** — hosted out of phase 1; dev-asserted identity exposed;
  explicit principal/grant selection; attested target binding;
  content-addressed envelope; closed DTOs; watch renewal decided;
  client façade de-privileged; RFC 8785; Node/POSIX floor.
- **r3** — call-time generation binding; app-data-plane routes; dev
  discovery via `/inspect`; anonymous-default selection;
  trusted-local demoted; `pair` + credential profile; value-free
  audit lane; script error contract; finite ceilings; live
  attribution seam.
- **r4** — binding scoped to sessions tuples; result reconciled with
  LLP 0024's canonical envelope; `sbac_` on lifecycle routes only;
  fence bootstrap pinned; rotation split from renewal; leak-resistant
  audit (keyed commitments); lifecycle state machine; RFC 9530/9110
  headers; `PublicNoStore`.
- **r5** — pairing carries both wire halves; renewal weakened to
  cut/resync; write outcomes (`clientMutationId`,
  `outcome: "unknown"`); client-enforced no-redirect; V8-heap-only
  ceiling; signal-first grace; audit field allowlist; strict-value
  profile; cache directives.
- **r6** — `subscribe --args-json`; named target capability;
  activation correspondence; envelope-less sessions
  introspection-only; parent ingress limits; `--mutation-id`
  recovery; bounded admission; alias-only hazardous names; LLP 0058
  recognized.
- **r7** — loopback-only agent lane; implemented pairing DTO pinned;
  reference-only profiles; short-TTL tokens; JCS
  reserialize-and-compare; engine-shipped ambient declarations;
  replay bound to authority/generation; `PublicDiagnostic` basis;
  0037 partition recorded.
- **r8** — public projection exact-match (additive-ignore +
  byte-exact serving was a disclosure hole); per-member digest trust
  root; three declaration products; token release + lease
  accounting; literal-loopback grammar; stage (a) credential-free;
  remote-service matrix row; pre-flags local exit 2; JCS
  conformance fixtures.
- **r9** — result core/wrapper ownership split pinned (Rust core,
  engine wrapper); digests extended to declarations and the local
  loader; half-provisioning envelope transitions; **accepted
  loopback-listener trust decision (author call)**; rotation
  terminal for watches; crash-safe lease reconciliation; diagnostic
  forward-skew rules; ibex 0028+0029 filed-amendment obligation
  (author call: filed, not landed); session-lane concurrency pinned;
  `types` topology.
- **r10 (loop exit)** — Claude-family reviewer READY for the sixth
  consecutive revision (both recorded author decisions judged
  "represented honestly"); GPT/Codex-family reviewer NOT READY with
  a new stratum (notably: the mutation-settlement lifecycle must
  adopt LLP 0043's acknowledgement protocol; the stage-(a)
  capability-absent bootstrap; declaration integrity;
  session-refresh concurrency; HEAD/`Content-Digest` mechanics).
  Per the author's recorded exit decision, the document moved
  **Draft → Review** with that residue carried as amendment-phase
  work (`issues/20260717-app-cli-review-residue.md`), per LLP 0005's
  reviews-advise-author-decides rule.

## Open questions

- Naming: the engine's bin name (`snapback-app` is the working
  spelling) and the final `/app-api` route spellings (the plane is
  decided; the spelling is not).
- Whether an app should be able to restrict the advertised surface —
  which, to protect anything, must govern `/inspect` and the envelope
  together — and whether that knob is app config or a deploy setting.
- Shared-core ownership is decided in principle: the dated LLP 0024
  amendment is the permanent home (with the already-stated rule that
  server delivery of the MCP catalog flips its schema to Rust
  ownership); the decision is recorded there **before sub-stage (b)
  begins**, so the largest cross-cutting deliverable has a settled
  home. A dedicated LLP remains possible later via ordinary
  supersession if 0024 grows unwieldy.
- Result typing beyond `unknown`: does codegen grow return shapes,
  and in which artifact?
- Renewal scheduling under clock skew is decided in principle — the
  dated LLP 0055 amendment has the mint response carry a
  server-relative TTL the parent counts down locally (absolute
  expiries under client clock skew are a known bug class) — with the
  exact field spelling left to the amendment.
- Whether the engine should default `--app` from a checkout's
  `artifacts.json` in dev loops, or stay explicit-URL-only
  permanently (explicit-only is the working posture).
- Profile inspection: is `whoami --all` (list profiles/sessions per
  target) phase 1 or part of `doctor`?
- Ephemeral-state rooms in code mode (`api.ephemeral.*` — the
  generated surface and client routes exist): follow-up, not v1; note
  LLP 0055 v1 already refuses service-principal ephemeral operations,
  so the agent path there is decided until 0055 moves.
