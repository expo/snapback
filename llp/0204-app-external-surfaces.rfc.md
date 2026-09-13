# LLP 0204: App external surfaces

**Type:** RFC
**Status:** Implemented
**Systems:** API, Auth, Client integration, Agent tooling, MCP, Codegen,
Hosted platform, Developer experience, Docs
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-08
**Revised:** 2026-08-23 (OAuth proposal creation now shares ordinary pairing's
ten-slot unresolved-consent budget; the child-FK wedge and table rebuild remain
deferred). 2026-08-23 (author ruling: Ask provider authorization is per
provider turn; a durable turn handoff that wins before retirement may finish,
while later turns refuse).
2026-08-10 (author sitting: the commissioned remainders were
ruled. (1) Untrusted-code execution: commission an investigation into what
confident launch requires on BOTH the Ibex restricted worker and
workerd/v8 before any promotion. (2) Capability links: commission the FULL
granted-operation extension — the named LLP 0055/0058/0031 amendments plus
the LLP 0150 bearer-exception entry, reads and writes. (3) External
automations: build the full bundle now — the LLP 0070 webhook/egress
slice, watchAnchor grant issuance, and integration-owned watches.
(4) Hosted gates: full program start (LLP 0039 deployment-security
contract + LLP 0019 F8 audit log; the approval-gated-only audit scope may
be the first landing). All four run in parallel; a qualified npm publish
follows the 0.1.16 receipt-regression fix.)
2026-08-10 (External-automations bundle completes D9.3: reusable signed
outbound webhook delivery with DNS-pinned SSRF defense and LLP 0070
retry/dead-letter evidence; atomic exact-scope watchAnchor grants with 365-day
lifetime/renewal ceiling; integration-owned capturedGrant watches; webhook
reactions; instant grant-revocation coupling; and fresh-session renewal.)
2026-08-10 (Status → Implemented: every S0–S5 sequencing
deliverable has landed on local targets with per-section dated
implementation notes; commissioned remainders stay explicitly named —
hosted gates run as the separate LLP 0039 + LLP 0019 F8 sibling program,
granted-operation capability links, integration-owned watches, webhook
reactions (closed by the external-automations bundle below), the untrusted-code execution profile behind /api/v1/run, and
connection-grant streaming (OQ6 v2) each await their named amendments or
evidence.)
2026-08-10 (S5 Landing C implements D9.5 approval-gated effects
and closes the OQ9 multi-use mutating-link dependency: exact pending intents,
one typed result across four ingress paths, session approval/denial, binding
revalidation, original-caller execution, step-up for authority creation, and
minter-only link approval.)
2026-08-09 (S5 Landing B implements D9.3 durable watches for
user-owned standing rules: session-only management, credential-free
`revalidatePrincipal` evaluation, exposed-live-query predicates, function
reactions, durable invalidation-driven jobs, edge/debounce/budget controls,
and bounded firing inspection. Integration-owned `capturedGrant` watches and
webhooks remain commissioned.)
2026-08-09 (S5 Landing A implements D9.4 capability links for
the external anonymous set: hashed request-secret storage, pinned/caller arg
templates, 7-day default and 30-day maximum expiry, inert GET, composed
network/link admission, atomic uses, principal-validity lineage, exact-minter
revocation, and value-free `link` attribution. Granted links and the D9.5
approval ceremony remain commissioned.)
2026-08-09 (S4 Landing C implements read-only `ask` v1 over
exposed queries: manifest-declared provider/billing and complete budgets,
durable conservative reserve/actual-settle accounting, caller-scoped provider
custody, result-schema repair, HMAC-minimized provenance receipts, private
transcript settlement, and synchronous MCP parity. S4 Landing B registered
`/api/v1/run`; S4 Landing A implemented the bounded private streaming-action
primitive. SSE token chunks, shared viewing, and history queries remain
deferred).
2026-08-08 (v0.7 — **Accepted** by author direction after
the OQ8 refinement: the declared-tier contact requirement is satisfied
by an e-mail address embedded in the client-id string itself, no
separate field. Super-refine dual-READY verdicts bind v0.5 = 310745d3d;
v0.6–v0.7 are ruling/status propagations, unreviewed. See Revision
history.)
**Related:** LLP 0004 (application data API — deferred "REST auto-generation,
public endpoint routing"), LLP 0009 (code execution security —
comprehensive preemption as the untrusted-code prerequisite), LLP 0019
(durable audit log, F8), LLP 0024 (agent operating surface — generated
app-data MCP catalog), LLP 0031 (server route taxonomy — reserved-prefix
invariant), LLP 0036 (secret handles), LLP 0039 (hosted deployment security — origin allowlisting,
service-principal gate), LLP 0042 (agent MCP surface), LLP 0047 (hosted
execution limits), LLP 0055 (agent principals and scoped grants), LLP 0058 /
LLP 0172 (explicit function authorization), LLP 0062 (generated per-app CLI
and code mode — public app-api envelope, surface-restriction OQ), LLP 0070
(durable background work — webhook sketch), LLP 0071 (application admission),
LLP 0077 (proof-of-possession credentials), LLP 0090 (public application
data — anonymous rate/budget posture), LLP 0093–0096 (client protocol),
LLP 0104 (metering and commercial contract), LLP 0149 (agent application
consumption — "not a fourth dialect"), LLP 0150 (agent token acquisition —
approval-link ceremony), LLP 0151–0153 (first-party identity integrations —
the inverse OAuth direction), LLP 0182 (§8 production application surfaces),
LLP 0194 (generated API reference — registry→projections pattern), LLP 0201
(social-messenger benchmark — M6 custom-client API), LLP 0202 (agentic
surface audit — the 2026-08-08 nine-surface findings), LLP 0203
(agent-native surface principles — enforcement posture this RFC's
projections must satisfy).

## Summary

Every Snapback app should come with four external surfaces, automatically,
the way it already comes with live queries and an admin console:

1. **A third-party API** — the app's exposed functions, callable by outside
   developers with scoped, user-consented credentials.
2. **An MCP server** — the same exposed functions projected as tools, so any
   MCP-speaking agent can use the app on a user's behalf.
3. **A downloadable CLI** — the LLP 0062 generated CLI, extended with a
   login ceremony and a distribution story, so a human or script can drive
   the app from a terminal.
4. **A near-data AI interface** — a hosted endpoint that accepts a natural-
   language task, runs an AI agent server-side next to the data with the
   caller's authority and a hard budget, and returns a result with receipts.

The unifying design is **one authority, many projections** (the LLP 0194
pattern, and LLP 0149's "not a fourth API dialect" finding, applied to the
app's own surface). All four surfaces are projections of the same three
facts, none of which is new machinery:

- **What is callable**: the function manifest, filtered by a new per-function
  **exposure declaration** — the keystone of this RFC, and the resolution of
  LLP 0062's open "surface restriction knob" question.
- **Who is calling**: an **integration record** (new, thin) plus LLP 0055
  principals and scoped grants — the RBAC and user system the app already
  has. External callers get no parallel permission system; a third-party
  token is a delegated grant, full stop. Below the granted lane, admission
  is a ladder: anonymous callers get the LLP 0090 bounded floor, and a
  **declared tier** lets auth-free callers self-identify (a self-chosen
  client id, no secret, no ceremony) in exchange for cooperative budgets
  and attribution — identification without authentication (D7).
- **How authority is obtained**: LLP 0150's approval-link ceremony as the
  native consent path, with a standards-compliant **OAuth 2.1 facade**
  generated in front of it for ecosystem interop (MCP clients in particular).

Cross-cutting all four surfaces is **code mode**: instead of N round trips,
a caller may submit a bounded TypeScript program written against the app's
generated typed client (`code-mode.d.ts`, already served in the LLP 0062
envelope); the server executes it under the caller's grant — on targets
carrying the evidenced untrusted-code profile (D6) — with every embedded
call still individually authorized.
Code mode is the shared execution substrate: the API's batch endpoint, the
MCP server's escape hatch from tool-call chattiness, the CLI's `run` verb
(shipped today), and the inner loop of the AI interface are all the same
mechanism with the same authority and budget semantics.

A second wave of derived features (D9) extends the same authority chain
into standing and shareable forms: a streaming-conversation primitive, a
generated agent skill, durable watches (end-user automations), shareable
capability links, and approval-gated effects. Each is a projection or a
grant shape, not new machinery.

Nothing here invents a wire dialect, a permission language, or a doc
pipeline. The competitive claim is precise: no platform today derives an
end-user-scoped API + MCP server + CLI + near-data agent from schema and
authorization declarations. Supabase derives an API but its scopes stop at
identity claims and its API is a database dialect; Hasura derives a contract
but issues no tokens; Convex has tokens and functions but imperative,
underivable authorization. Snapback's function-level declarative auth
(LLP 0058/0172) plus the grant system (LLP 0055) makes the whole chain
derivable. LLP 0201's M6 milestone is the first consumer and the acceptance
bar for surface 1.

## Motivation

Concretely: an agent builds a Twitter-style app on Snapback. The app works
in its own clients. Now the owner wants third parties to build on it — a
bot that posts, a dashboard that reads a timeline, an AI assistant that
summarizes a user's mentions, a cron script that exports data. On every
mainstream platform this is where the free ride ends:

- On **Convex**, the developer hand-writes an `httpRouter`, hand-rolls API
  key storage and checking, installs a rate-limiter component, and writes
  docs by hand. Authorization is TypeScript inside functions, so no tool can
  generate any of it.
- On **Supabase**, PostgREST gives a free API, but it is a database dialect
  (tables and filter syntax, not product operations), the famous failure
  mode is a forgotten RLS policy, and per-integration scoping/quotas are
  DIY. Their 2025 OAuth 2.1 server is the part worth imitating.
- On **Firebase**, there is no third-party story at all.

The corpus has already built most of what is missing, under the framing of
*the developer's own agent* rather than *a stranger's integration*:

- A credential-free, digest-pinned, machine-readable API description of
  every app is already served (`GET /app-api/current`,
  `GET /app-api/envelope/{sha256}` — LLP 0062), including per-operation
  JSON Schemas and typed declarations.
- Scoped, expiring, revocable, fully audited user-delegated tokens are
  designed and enforced on local targets (LLP 0055) — though credentials
  come from harness provisioning today, with no user-reachable issuance
  surface (the S0 gap) — and LLP 0150 designs the consent ceremony,
  materially better than the industry's copy-paste-a-PAT norm.
- A generated MCP tool catalog projected from the function manifest is
  specified (LLP 0024 §Generated App-Data MCP Catalog).
- The generated CLI ships, including code mode (LLP 0062, Implemented).

What the corpus has never had is the document that says: these are not
agent-tooling conveniences; they are the app's **public product surface**,
they must be governed by one exposure declaration and one stability
contract, and they must ship with every app by default. LLP 0182 §8 names
the absence a production blocker; LLP 0201 M6 prices it against Convex.

The framing shift matters for the threat model. The corpus's existing
external caller is singular, trusted, and the owner's own agent. A third
party is plural, untrusted, needs independent revocation and quota, and —
hardest of all — needs a **stable contract across the app's redeploys**,
which the `expectedGeneration` pinning discipline (LLP 0012/0058)
currently makes impossible for outsiders.

## Design principles

- **P1 — One authority, many projections.** The exposed-function set, with
  its schemas and auth requirements, is the single authority. The HTTP API,
  the OpenAPI document, the MCP catalog, the CLI verb set, the AI
  interface's tool loop, and the generated `API.md` are projections that
  never independently reinterpret it (LLP 0194's registry rule, applied to
  the app).
- **P2 — Exposure is a declaration, not a router.** Developers mark
  functions as exposed; they do not write endpoint code. This is the Hasura
  lesson (declarative rules are derivable; handler code is not) applied at
  the correct altitude: the **function**, not the table. Row-level policy
  stays where Snapback already puts it — inside server-authoritative
  function bodies — so the Supabase forgot-RLS failure mode cannot occur:
  an exposed function enforces exactly what it always enforced.
- **P3 — External authority is app authority.** No API keys that "act as
  the app." Every *granted* external call resolves to the LLP 0055 audit
  tuple (actor principal, effective principal, grant); the ungranted
  lanes attribute to the declared-id / network-evidence tuple instead
  (D7). Cost, quota, revocation, and audit key off the lane's tuple.
- **P4 — Exposure implies stability.** Marking a function exposed opts it
  into a compatibility regime and out of hard generation pinning. Internal
  clients keep `expectedGeneration` semantics; the public surface promises
  additive evolution and declared deprecation instead.
- **P5 — Great ceremony first, standards as a facade.** The native consent
  flow is LLP 0150's approval link: better than OAuth's redirect dance for
  humans, and proof-of-possession rather than bearer. OAuth 2.1 compliance
  is a thin generated adapter for clients that expect it, not the core.
- **P6 — Budgets are part of the surface.** Every external surface carries
  admission, quota, and (for the AI interface) token-spend budgets as
  first-class, app-declared configuration. A surface without a budget is
  not enabled.

## D1 — The exposure declaration (keystone)

A new `api` block in the schema manifest, compiled into the artifact like
`auth.agents.*` (LLP 0055) is today:

```jsonc
{
  "api": {
    "enabled": true,                     // requires an explicit
                                         // auth.agents.mode declaration
    "disclosure": "exposed-only",        // or "full" (today's posture)
    "functions": {
      "timeline.list":   { "expose": true },
      "posts.create":    { "expose": true },
      "posts.search":    { "expose": true, "since": "v1" },
      "admin.purgeUser": { "expose": false }               // default
    },
    "budgets": { /* see D7 */ }
  }
}
```

Semantics:

- `expose` defaults to **false**. The external surface is opt-in per
  function; a fresh app exposes nothing until the developer (or the
  authoring agent, which is the common case) declares otherwise. Templates
  and the authoring guide make declaring it a one-line habit.
- The declaration governs **callability, disclosure, and documentation as
  one fact** under `disclosure: "exposed-only"` (the default for apps
  with `api.enabled`). An unexposed function is not callable with an
  integration credential, does not appear in the external envelope
  projection, the OpenAPI document, the MCP catalog, the CLI's external
  mode, or `API.md`. The refusal is enforced at authorization, not
  routing: an integration credential invoking an unexposed function is
  refused on the bare finite routes, live subscriptions, nested
  code-mode calls, and MCP alike — S1 acceptance enumerates these
  bypass paths adversarially. **Anonymous residual reachability is the
  honest limit of that claim**: an external anonymous caller is
  indistinguishable from a first-party anonymous caller on the bare
  routes, so for anonymous-admitting functions `expose: false` removes
  advertisement, projections, and declared/credentialed treatment — it
  cannot remove bare-route anonymous reachability while first-party
  anonymous traffic exists. An app that needs an anonymous-admitting
  function to be externally unreachable changes its authorization
  class; "callability follows exposure" is a credentialed-lane
  invariant. Per LLP 0062's warning,
  `disclosure: "exposed-only"` must govern `/inspect` and the envelope
  together — redacting one but not the other protects nothing.
  `disclosure: "full"` preserves today's decided anonymous-inventory
  posture for apps that want it — a deliberate exception in which
  disclosure exceeds callability; credentialed callability follows
  exposure regardless.
- Exposure composes with, and never weakens, LLP 0058/0172 authorization.
  An exposed `authenticated` function still requires an effective user.
  The **external anonymous set** is decided here, not left to
  projections: it is the exposed functions whose authorization admits
  anonymous callers under LLP 0058/0172 — `public`, and `optional-user`
  invoked without a user context — subject to a commissioned
  **external-anonymous admission and response contract** (a named
  LLP 0031/0071 amendment; today's `DeclaredPublicApplicationData`
  class covers only LLP 0090's two read lanes, narrower than this
  set). Callable external activation depends on that contract being
  enforced. Every projection (API, OpenAPI, MCP, CLI, code mode,
  envelope, docs) derives this same set.
- **`api.enabled` requires a registration posture.** Every credentialed
  lane (API tokens, MCP connect, CLI login) begins at principal
  creation, and LLP 0055's `auth.agents.mode` defaults to `disabled` —
  under which each of them dead-ends. Activation therefore refuses
  `api.enabled: true` without an explicit `auth.agents.mode`
  declaration (a manifest diagnostic names the missing lines — note
  `auth.agents.*` is meaningful only under `auth.mode: "sessions"`
  (LLP 0055), so `api.enabled` implies sessions mode and the diagnostic
  names both). An explicit `auth.agents.mode: "disabled"` is a *valid*
  posture: no new credentialed onboarding (anonymous + declared lanes
  only for apps that never opened registration; 0055's `disabled`
  stops new principal creation, so previously onboarded integrations
  retain their live granted lanes). For
  credentialed lanes the production creation-path constraint is
  inherited from LLP 0055 (`open`, or `invited` with
  `invitedBy: "users"`). "Automatic" in this RFC means derived from
  declarations — never silently opened registration.
- First-party clients are unaffected. The exposure declaration creates a
  second, outward-facing projection; it does not carve functions away from
  the app's own arms.

**Why function-granularity and not tables/rows.** The API unit third
parties want is `posts.create`, not `INSERT INTO posts`. Functions are
already the app's semantic operations, already schema-described, already
auth-classified, and already server-authoritative. Every alternative
(auto-REST over tables, GraphQL over schema) reintroduces an authorization
layer that must be maintained in parallel with function-body policy —
exactly the class of bug P2 exists to prevent.

## D2 — Surface 1: the third-party API

**Transport: the existing finite routes.** `POST /query/{name}`,
`/mutation/{name}`, `/action/{name}` (LLP 0093) are already a clean RPC
surface; third parties use the same routes with an integration credential.
No parallel REST router is introduced. What changes for external callers:

- **Versioned prefix, stability contract.** External calls address
  `POST /api/v1/{kind}/{name}` (registered in the LLP 0031 taxonomy as an
  app-data-plane family). `v1` names the **contract regime**, not the app
  version: within it, exposed functions may evolve additively (new optional
  args, new result fields); removing or breaking an exposed function
  requires a declared deprecation with a window, surfaced in the envelope
  and `API.md`, and refusals name the replacement (LLP 0150 invariant 4's
  refusal-carries-escalation pattern, applied to deprecation). LLP 0093
  explicitly left "pulling the finite surface under a version carrier" to
  its own proposal; for the *external* projection only, this is that
  proposal. The compatibility classifier (which argument, result,
  refusal, authorization, and pagination changes count as additive) and
  the proof that deprecated implementations stay callable through their
  window are S1 implementation-phase deliverables.
- **No generation pinning.** External calls omit `expectedGeneration`; the
  server serves the current generation. The envelope digest lets a careful
  client detect change; the stability contract makes not caring safe.
  (Internal clients keep pinning; nothing changes on the first-party path.)
- **Pagination and result bounds** are a protocol concern (LLP 0149 F8):
  exposed queries above a declared result bound must accept cursor
  arguments; the generated docs state the bound. v1 can enforce this as a
  lint at exposure time rather than new runtime machinery.
- **Ungranted lanes first on hosted.** On hosted targets the gate-free
  external lanes are exactly the ungranted ones: anonymous and declared
  (D7) calls to the external anonymous set (D1). Every granted
  invocation — delegated *reads included* — is a service-principal
  invocation and inherits LLP 0055's plane boundary verbatim: refused on
  hosted until LLP 0039's deployment-security contract lands, with
  external mutations additionally gated on the durable audit log
  (LLP 0019 F8). This RFC does not amend that boundary; un-refusing any
  hosted granted lane is a named dated LLP 0055 amendment with its own
  security argument, never an implication here. Ungranted lanes bypass
  only the service-principal gate: on hosted targets the LLP 0019 F8
  audit gate binds granted external mutations (and externally
  effectful actions equivalently), while anonymous-admitting mutations
  are today's first-party surface and follow its posture. Local/trusted-local
  targets get the granted *finite* surface immediately (LLP 0055 v1:
  function routes + `/connection/open`), which is exactly what
  LLP 0201 M6 needs.
- **Live data.** v1 documents plain re-polling of the finite query
  routes (fresh snapshots; the envelope digest for change detection) —
  sufficient for LLP 0201 M6's "documented polling." The
  `authorized-lease` mint is *not* part of the third-party recipe:
  LLP 0055 pins the v1 service-principal surface to the finite routes
  plus `/connection/open` and names retained reads a non-goal, so
  admitting the lease under scoped tokens would be a named dated
  LLP 0055 amendment with its own argument. Connection-grant streaming
  for integrations is v2 (the connection-open path assumes first-party
  lifecycle handling).
- **CORS** for browser-based third parties: exposed-surface routes get an
  app-declared origin policy (`api.origins`). LLP 0039's deferred
  origin-allowlisting contract is scoped to cookie transport;
  bearer-token CORS for `/api/v1/*` needs its own statement inside the
  amendment that lands `api.origins`. Absent a declaration, no CORS —
  today's posture.

**Projections generated from the envelope** (all P1-derived, no hand
maintenance): an **OpenAPI 3.1 document** (one operation per exposed
function, schemas from the envelope's per-operation JSON Schemas) served
alongside the envelope — this buys the entire OpenAPI ecosystem (codegen,
Speakeasy/Stainless-class SDK and MCP generators, Retool-class tools) for
free; and a hosted **`API.md` / reference site** using the LLP 0194
registry→projections pipeline pointed at the exposed manifest, including
the token-acquisition walkthrough. The LLP 0201 M6 grader ("with only an
access token and `API.md`…") is the acceptance test for this projection.

## D3 — Surface 2: the MCP server

LLP 0024's generated app-data MCP catalog, filtered by the exposure
declaration and served remotely:

- **Endpoint:** streamable-HTTP MCP at an app-data-plane route (`/mcp`,
  registered in the 0031 taxonomy). Tool set = exposed functions
  (`snapback_fn_<functionId>`, input/output schemas from the envelope),
  plus a small fixed set: `describe_api` (envelope digest + docs pointers),
  `run_code` (code mode, D6 — advertised only on targets carrying the
  evidenced untrusted-code profile), and — where enabled — `ask` (the
  AI interface, D5, so any MCP client gets the high-level surface too).
- **Authorization:** this is where the OAuth facade (D8) earns its keep.
  MCP clients speak OAuth 2.1 + dynamic client registration; the generated
  authorization-server metadata points at the facade, whose consent step
  *is* the LLP 0150 approval link. The resulting token is an LLP 0055
  delegated grant scoped to the user who approved it. Tool listing is
  public (it is the envelope, per the disclosure posture). Tool *calls*
  come in the same two lanes as the API: unauthenticated calls are
  admitted to exactly the external anonymous set (D1) under the
  anonymous/declared budgets, and granted calls carry the grant — so on
  hosted targets, before LLP 0039 lands, the MCP surface serves the
  anonymous set only, same as every other projection.
- **Scope shaping:** eager one-tool-per-function does not scale (LLP 0149
  F3). The catalog groups tools, ships a bounded search/describe
  projection rather than relying on eager enumeration alone, and
  advertises `run_code` prominently; clients with small tool budgets
  can operate through code mode alone — the Stainless/Cloudflare "code
  mode" convergence, which Snapback gets natively because the typed
  client already exists.

An end-user-scoped MCP server derived automatically from schema + auth
declarations is, per the 2026-08 survey, not offered by any platform. It is
this RFC's most differentiated deliverable and mostly composition.

## D4 — Surface 3: the downloadable CLI

LLP 0062 shipped the engine, the envelope, and code mode; what remains is
distribution and authority:

- **Acquisition:** `npx snapback-app <app-url>` (engine fetches the
  envelope and self-configures) as the paved path, plus the app's docs
  page offering a pinned invocation. A per-app branded binary is explicitly
  out of scope; the engine+envelope split exists precisely to avoid it.
- **Login:** `... login` runs the LLP 0150 ceremony from the terminal:
  prints the approval URI + user code, polls, stores the key-bound
  credential per 0150's custody rules (0600 file, named honestly). Scopes
  default to the app's declared read bundle (the OQ3 scope vocabulary);
  escalation happens at refusal time.
- **Verb surface:** external mode lists exposed functions only; the
  developer's own CLI against a trusted-local target keeps today's full
  surface, discovered from local build artifacts per LLP 0062's shipped
  path when `disclosure: "exposed-only"` redacts the anonymous
  projection (the app CLI is app-data-only and never accepts admin
  authority, so LLP 0031 D3's operator-plane twin is not its discovery
  surface). Same engine,
  same knob, two projections — P1 again.

**Implementation note (S3 Landing D, 2026-08-09):** the generic Node CLI now
accepts an app URL as its useful default surface and ships `login` through the
local OAuth facade: authorization-server discovery, one cached public DCR
registration, PKCE S256, loopback-or-paste completion, named-bundle defaults,
and an honestly named mode-0600 bearer record with its 15-minute expiry and no
refresh claim. Served mode consumes the already exposure-filtered envelope;
explicit trusted-local artifacts retain the full function manifest. A per-app
branded binary remains out of scope.

## D5 — Surface 4: the near-data AI interface

The novel surface: `POST /api/v1/ask` (and the `ask` MCP tool). The caller
sends a task in natural language plus an optional result schema; a hosted
agent runs **next to the data**, iterates over the app's exposed functions
(and only those), and returns a result with receipts, streamed via the
D9.1 primitive by default.

**Per-turn authority ruling (2026-08-23).** Starting an Ask run does not
authorize every future provider call in that run. Each provider turn requires
an exact durable handoff bound to the run, turn, provider/model, request
digest, and spend reservation. Retirement before that handoff prevents the
provider call; a handoff committed before retirement owns that turn's send and
settlement even if retirement follows. Later turns must re-authorize and
refuse after retirement. Implementation is tracked by
`issues/shelved/20260823-ask-per-turn-authority-handoff.md`.

- **Authority = caller's authority.** The agent runs under the caller's
  grant; every function call inside the loop passes the same per-function
  authorization as if the caller made it directly. RBAC scoping is
  therefore not a new mechanism — the agent simply cannot call what its
  principal cannot call. `ask` itself is an exposed capability an app must
  enable (`api.ask.enabled`), with its own scope so a user can consent to
  "read my data" without consenting to "spend AI tokens as me."
- **Budgets are hard and layered** (P6): per-request token/step/wall-clock
  caps, per-principal and per-integration daily budgets, and an app-level
  monthly ceiling, all declared in `api.budgets` and enforced by the host.
  Exhaustion returns a typed refusal carrying spend-so-far and the
  escalation path. **Who pays** is declared, not implied:
  `billing: "app" | "caller-key"` — app-pays meters through LLP 0104 to
  the owner's account; caller-key means the request carries the caller's
  own model credential and the app spends nothing. A caller-supplied
  model credential is a new secret class with a fixed custody posture:
  request-scoped, never persisted, never logged, never an LLP 0036
  handle. Default: no budget
  declared → surface disabled.
- **Execution shape:** the agent's tool loop is code mode (D6) plus plain
  function calls, under D6's per-target untrusted-code gate, with the
  LLP 0047 execution-limit regime extended with a token meter. v1 is **read-only** (queries only)
  regardless of grant, mirroring the corpus's own hosted-mutation
  sequencing; mutating `ask` follows the audit-log gate.
- **Receipts are provenance, not proof.** The response includes the
  function calls made (names, argument digests, result digests) so
  audit attributes every read to the ask that caused it and a caller
  can re-run the same reads directly — but a digest trace cannot by
  itself verify the answer's derivation (LLP 0149 F9 separates "the
  task completed" from "the answer is verified"). Verification-grade
  receipts (result bytes, snapshot identity) are a declared upgrade,
  never an implied property. Retained digests follow LLP 0062's
  value-minimization precedent (domain-separated keyed commitments;
  omitted from less-authorized audit projections; custody rule
  implementation-phase).
- **Model plumbing** rides the existing egress/secret machinery (LLP 0036
  handles for provider keys; LLP 0070's guarded-egress posture). Model
  and provider allowlists are app policy. The `ask` consent scope and
  each receipt identify the model/provider and disclose that authorized
  application data egresses to it — the scope names data egress, not
  only token spend.

Nothing in the industry survey offers this as a platform primitive; it is
also the surface most sensitive to cost abuse, hence the budget-or-disabled
default and read-only v1.

## D6 — Code mode, unified

Code mode already exists in the CLI (LLP 0062): a TypeScript program
against the generated typed client, executed with the app's types. This
RFC promotes it to a first-class **server-side execution primitive**
shared by all surfaces:

- **Submission:** `POST /api/v1/run` (and MCP `run_code`, and the AI
  interface internally): a bounded program + the envelope digest it was
  written against. The server type-checks against `code-mode.d.ts` from
  that envelope and executes it action-class — the invocation class
  whose outer VM runs with an armed interruptible-eval deadline
  (LLP 0009) — returning the program's value. (The server-side checker
  is S4 machinery; LLP 0062's shipped code mode checks in the CLI
  engine.)
- **Untrusted code is a separate capability, not a courtesy of the
  handler VM.** `snapback runtime-qualify` qualifies the restricted
  no-eval VM for *owner-authored* code; a submitted program is
  *adversary-authored*, a different threat class whose prerequisite
  LLP 0009 names plainly: comprehensive preemption. Third-party code
  mode is therefore **per-target conditional**: a target serves
  `/api/v1/run` (or MCP `run_code`) only when it carries an evidenced
  untrusted-code profile meeting LLP 0047's enforced limits — killable
  runtime, CPU/heap/result ceilings, per-invocation isolation, no
  ambient powers — and refuses the surface with a typed capability
  refusal otherwise. Owner-code runtime qualification is never accepted
  as that evidence. The `ask` inner loop is gated identically wherever
  the model can emit code-mode programs.
- **Authority:** the program holds no ambient authority. The injected
  client is bound to the caller's grant; every call it makes traverses the
  same authorization and admission path as a wire call. Code mode changes
  *round trips*, never *reach*.
- **Budgets:** statement/time/call-count caps under LLP 0047's regime;
  calls inside count against the same quotas as direct calls.
- **Why it's worth having everywhere:** it collapses N-round-trip agent
  interactions into one (the chattiness problem MCP's own ecosystem is
  converging on code execution to solve), it gives scripts atomic-ish
  read-compose-return without a bespoke endpoint, and it is the natural
  inner loop for D5. One sandbox, one authority model, one budget model —
  audited once.

Code mode is explicitly **not** durable app code: no schema access beyond
the client, no registration, no persistence between runs. It is a query
plan, not a deployment.

**Implementation note (S4 Landing B, 2026-08-09):** `/api/v1/run` is a
registered, bounded, envelope-digest-bound surface and MCP `run_code` is a real
tool, but every current target returns the same typed untrusted-code capability
refusal. The evidence gate reads the `hosted_untrusted_code` gap plus LLP
0047's enforced resource-limit rows. No server-side checker or executor exists
behind the unevidenced profile; author-gated target promotion remains the next
step.

## D7 — Integration records, admission, and metering

The thin new identity object between "agent principal" and "OAuth client":

- **Integration vs installation — two objects, deliberately.** An
  **integration** is the client registration: display identity, optional
  origin/redirect facts for the OAuth facade, credential (key-bound per
  LLP 0150), status (active/suspended/revoked), budget overrides, and an
  owner (a user principal of the app) who controls *the client's
  identity and lifecycle* — nothing more. An **installation** is one
  user's consent to that integration: a per-user LLP 0055 delegated
  grant (actor = the integration's agent principal, effective = the
  consenting user). The lifecycle authorities are disjoint, stated
  against LLP 0055's actual verbs: **each user** revokes their own
  installation (and only theirs). **Key-holder rotation**
  (`POST /auth/agents/rotate`) is hygiene and *grant-preserving* by
  0055's design — old tokens and connections die, fresh tokens mint
  against the same installations; it is not a consent event and is
  disclosed as none. The **fail-closed global kill** — terminally
  revoking every installation for fresh consent — is 0055's *owner
  re-credentialing* (owner session + step-up) where an owner exists,
  and **operator** suspension / credential revocation always. Because
  a DCR-created record can be durably unowned, this RFC commissions a
  named dated LLP 0055 amendment adding an **integration retirement**
  verb — key-possession-proving or operator-invoked, terminally
  revoking the credential family and every installation — as the
  unowned record's non-operator kill path. Ownership: a DCR-created
  record (D8) starts **unowned and provisional** (consistent with
  0055's unowned open registrations), and — by a second commissioned
  LLP 0055/0150 amendment — integration-record registrations are
  **exempt from 0150's approver-as-owner rule**: an installation
  approval never seats ownership (under `open` mode the first approver
  would otherwise become owner — exactly the first-installer capture
  this design forbids). Ownership is claimable only through a
  key-possession-proving ceremony or operator action; `invited`
  creations record the inviter. Integration principals are
  **delegation-only** — and because LLP 0055's `auth.agents.template`
  can mint autonomous grants at registration, delegation-only is
  itself a commissioned **integration registration class** (template
  suppressed; the mint predicate refuses non-installation tokens;
  activation and migration checks enforce it), not an inherited
  property. Records live as app data in reserved tables like auth
  state today; the registration policy knob is LLP 0055's existing
  `auth.agents.mode: disabled | invited | open`. An integration is an
  agent principal with a public face, not a new principal kind — but
  DCR creates only the record; authority exists only as installations,
  each minted by its own user's consent.
- **Admission — a three-lane ladder:** LLP 0071's admission contract gains
  per-integration keys: every external call is admitted against
  (integration, principal) budgets before execution. Below the granted
  lane sit two auth-free lanes:

  - **Anonymous** — the commissioned external-anonymous admission
    contract (D1), keyed on network evidence. The hard floor; nothing
    weakens it.
  - **Declared** — auth-free but *identified*: the caller self-chooses a
    client id that must **contain a syntactically valid e-mail
    address** — the contact requirement is carried in the id string
    itself, no separate field (no registration round trip, no secret —
    a header such as
    `Snapback-Client-Id: crawler-7f3a9c/ops@example.com`, matching the
    NCBI/Wikimedia identify-yourself etiquette) — and the server
    auto-creates a usage ledger row on first sight. Declaration conveys
    **zero authority** — the reachable set is exactly the external
    anonymous set (D1) — but buys the cooperative treatment: a stable,
    more generous budget, per-id attribution in the owner's console, a
    contact channel for warn-before-block, and refusals that say which
    lane you are in and how to move up (the LLP 0150 escalation pattern
    at the rate-limit layer). Precedent: NCBI E-utilities' `tool`/`email`
    params, Wikimedia's identifying User-Agent etiquette — cooperative
    identification, not authentication, matching LLP 0055's existing
    declared-vs-credentialed honesty split.

  The sybil trap is handled structurally, for budgets and for storage:
  declared budgets **compose with, never replace, the anonymous
  network-evidence floor** (minting fresh ids cannot multiply past the
  ceiling); new ids start modest and age up; operators can bless or
  suspend individual ids. Ledger rows are pre-auth state and bounded the
  same way (LLP 0071 discipline): creation passes a low-cardinality
  network-evidence gate, idle ids expire on a TTL and are evicted, and a
  global per-app cap refuses new ids before rows accumulate without
  bound. A declared id is an on-ramp, not an identity: **upgrading
  issues a fresh authenticated integration identity**, and declared
  history attaches to it as explicitly untrusted attribution only (or
  after a demonstrated contact/operator proof). An unauthenticated
  string can be squatted, so continuity of treatment is never inherited
  from possession alone.
- **Attribution:** usage rolls up to the integration in LLP 0104 metering,
  so the app owner sees per-integration consumption and can suspend from
  the admin console. Revoking the integration revokes its grants — one
  switch, LLP 0055 semantics.

## D8 — Authority acquisition: the ceremony and the facade

Current standards, for the record: OAuth 2.1 (PKCE-required
authorization code), RFC 8628 (the device-authorization grant, not
consolidated into 2.1), RFC 7591 (dynamic client registration), RFC 9728 (protected
resource metadata), and the MCP authorization spec built on OAuth 2.1 with RFC 8414
authorization-server metadata, RFC 7591, and RFC 9728; plus
the 2025-vintage commercial versions (Supabase OAuth 2.1 server, Clerk
OAuth Applications, Stytch Connected Apps). Bearer JWTs are the industry
norm; proof-of-possession is the direction of travel.

The answer to "is there something simpler and less annoying than OAuth?"
is: **we already designed it — LLP 0150.** Its approval-link flow is
structurally the device grant with better properties: no redirect URI
management, no client-secret custody, no scope checkbox grids (the caller
compiles the exact request; the human vetoes), proof-of-possession instead
of bearer, refusals that carry pre-compiled escalations. The native path
for all four surfaces is 0150 verbatim; this RFC adds no second ceremony.

The **OAuth facade** exists because interop is a feature: MCP clients,
agent frameworks, and existing SDKs speak OAuth 2.1 and nothing else. The
facade is generated per app: authorization-server metadata, DCR endpoint
(creating an integration record, subject to `auth.agents.mode`), an
authorization endpoint whose consent page *is* the approval surface, and a
token endpoint minting facade tokens bound 1:1 to underlying grants —
scopes mapped from the grant's canonical scope set. Where a client can
hold a key, the facade issues DPoP-style sender-constrained tokens;
plain-bearer is a per-app opt-in with shorter lifetimes, because a bearer
facade over a PoP core is a real weakening and must be a visible choice,
not a default. Revocation is grant revocation; nothing in the facade has
independent authority. Facade routes — including the origin-root
`/.well-known/*` metadata documents the RFCs structurally require —
land via a dated LLP 0031 amendment extending the root `/auth/*`
precedent. Standards for the ecosystem, the better ceremony
for everyone who talks to us directly (P5).

**Operational admission amendment (2026-08-23):** an OAuth authorization
proposal and its pairing request consume one slot in LLP 0055's durable
per-human budget of ten unresolved, unexpired consent ceremonies. OAuth and
ordinary pairing creation use the same transactional admission primitive;
pairing-secret consumption does not release the slot, while grant approval
does. The existing OAuth request foreign key remains `ON DELETE RESTRICT`.
Consequently, this admission bound does not fix the global expiry-sweep or
destructive-parent teardown wedge; the companion-table rebuild is deferred in
`issues/shelved/20260823-oauth-pairing-fk-wedge-deferred.md`.

**Implementation note (S2 Landing C, 2026-08-09):** the first local facade is
bearer-only behind the explicit `api.oauth.bearer: true` opt-in. It issues
single-use 60-second authorization codes and 15-minute grant-bound scoped
tokens. It deliberately omits refresh tokens; clients repeat authorization
after expiry. Hosted targets refuse the complete family.

"PAT-like" long-lived credentials for the M6-style headless script are the
same mechanism at maximum simplicity: a user mints a scoped delegated
grant from the app's console (the LLP 0055 approval surface), bound to a
key the script generates — never a copy-paste bearer secret (LLP 0150
invariant 1).

## D9 — Second-wave derived features

Five features adopted into this RFC's scope (2026-08-08). Each derives
from the D1–D8 chain; none introduces a new authority model.

### D9.1 — Streaming conversations

A first-class stream result kind for chatbot-style UIs, and the transport
`ask` (D5) uses by default. An action may declare `stream: true`: chunks
ride the existing ephemeral/live machinery to subscribed clients, and the
**durable transcript settles into reserved platform tables on
completion** — attempt identity, final text, and token accounting land
as a row, so chat
history, reconnect (cursor resume), and cancellation are platform
behavior rather than per-app boilerplate. Streams are **private to the
initiating authority by default**: chunks may derive from data read
under the initiator's grant, and a second principal's right to
subscribe to a room proves nothing about their right to read those
inputs. Multi-viewer streaming remains the differentiating capability —
as an explicit sharing declaration, delivered through a durable result
query whose ordinary row-level authorization independently admits each
viewer (or per-viewer re-evaluation where the app declares it) —
something point-to-point SSE cannot express either way. v1 `ask`
streaming is request-bound private SSE, distinct from live-subscription
authority; subscription-shaped reconnect and multi-viewer arrive with
the v2 sharing declaration. Transcripts
settle into reserved platform tables (like auth state) under platform
authority, so `ask`'s v1 read-only claim concerns app data and stays
honest on gated targets. A Vercel AI SDK-compatible SSE endpoint
(`/api/v1/stream/...`) is a projection for drop-in chat UIs, not the
core. Token accounting integrates with the D5/D7 budget ladder.

**Implementation note (S4 Landing A, 2026-08-09):** `defineAction` now accepts
the action-only manifest fact `stream: true`, and Ibex actions emit strings or
bounded JSON values through `ctx.stream.emit`. The host starts a durable
single-runner attempt before returning its opaque token, then publishes
zero-based, monotonically indexed chunks through the reserved `_snapback_stream` ephemeral
collection. The v1 limits are 16 KiB per serialized chunk, 2 MiB per attempt,
and 20 chunks per rolling second. Subscription is private to the initiating
session user, service credential, or anonymous connection; the same session
user may reconnect from a second connection, while another principal is
refused.

The manifest activates an exact protected transcript table only when at least
one streaming action exists. Immutable terminal rows record attempt/function/
initiator identity, start and settlement times, cause, a final value bounded to
256 KiB, chunk count, and nullable token counts. Chunks and reconnect cursors
are not durable. `sinceChunk` resumes only from retained live chunks and marks
a missing prefix `truncated` with a `/streams/{attemptToken}` transcript
pointer. Initiator-scoped transcript read and cancel routes are registered as
private no-store AppData operations. This landing does not flip `ask`, wire
`run_code`, the AI-SDK SSE projection, durable history queries, shared viewing,
or token metering.

### D9.2 — Generated agent skill

Every app serves an installable Agent Skill — a small, digest-pinned
bundle (SKILL.md + pointers) that teaches a harness three things:
discovery (the envelope), authority acquisition (the D8 ceremony), and
code mode (taught as target-conditional, per D6). It deliberately does **not** embed the full API: it teaches
the agent to fetch current facts from the envelope and reference
projections, so it cannot rot (LLP 0203 P1 — generated or gated, never
transcribed). It never contains credentials and never presents static
scope lists as current authority. This is a sibling of D2's `API.md` /
OpenAPI projections and lands with them; harness-side install follows
the same conventions this repo already uses for skill distribution.

### D9.3 — Durable watches (end-user automations)

Any exposed live query can anchor a **watch**: a standing rule owned by
a principal — `when this query's result satisfies this predicate, do
that reaction` — persisted via durable background work and evaluated off
the existing invalidation machinery, not by polling. v1 predicates are
a closed declarative grammar (comparisons and presence over the
result), never caller-submitted code; an executable predicate would be
durable untrusted code and takes D6's gate. Reactions in v1:
deliver a notification/webhook, or call one exposed function; a
code-mode reaction follows D6's gates. Standing authority anchors per
LLP 0070's contracts — `capturedGrant` for integration-owned watches
(using LLP 0055's exact-watch 365-day watchAnchor profile and 365-day renewal
ceiling, where renewal is fresh consent: the "IFTTT for free" pitch is honest about that recurring
ceremony — OQ11), `revalidatePrincipal` for user-owned watches, whose
authority is session-shaped rather than grant-shaped; webhook reactions
inherit 0070's SSRF/idempotency/retry contracts. Every firing is
admitted against the owner's budgets and journaled; revoking the
anchoring authority kills the watch. This gives every app an automation layer ("IFTTT
for free") with authorization and cost attribution built in. Storm
control (debounce, coalescing, per-watch firing budgets) is part of the
admission design, not an afterthought (OQ10).

**Implementation checkpoint (S5 Landing B, 2026-08-09).** When `api.enabled`
is true, the protected `_snapback_watches` catalog and bounded
`_snapback_watch_firings` journal activate with the manifest. A user session
may create and inspect its own `wtch_` records through `POST|GET /watches`,
and may delete, suspend, or resume them through the exact session-only
management routes recorded in LLP 0031. The durable record pins owner and
authority-instance ids, exact query/reaction function ids and current scope
bases, canonical bounded argument bytes and digests, read dependencies,
predicate, status, budgets, debounce state, counters, timestamps,
notification, and the last 16 firing outcomes.

The v1 predicate wire grammar is closed JSON. A leaf is
`{"path":"/RFC6901/pointer","op":"eq|ne|gt|gte|lt|lte|exists|absent|contains","value":...}`;
`value` is required for comparison and `contains`, and forbidden for
`exists`/`absent`. Internal nodes are exactly `{"and":[...]}` or
`{"or":[...]}`, with at most eight total leaves and depth at most two. The
predicate observes the serialized live-query result document. No executable
predicate is accepted. Reactions are exactly
`{"kind":"function","function":"...","args":{...}}` and may name an exposed
finite query, mutation, or action, or
`{"kind":"webhook","url":"https://...","secret":"optional receiver secret"}`.
When the secret is omitted Snapback generates it, stores it under LLP 0036
custody, and returns it once in the creation response. Webhooks use LLP 0070's
manifest-activated delivery/attempt ledger, stable firing idempotency key,
HMAC signature, DNS-pinned public-address/HTTPS gate, bounded attempts,
exponential job backoff, and terminal dead-letter evidence.

User-owned watches use `revalidatePrincipal`: no session bearer or session
secret is retained. Every evaluation constructs fresh credential-free owner
authority and revalidates the principal, authority anchor, exact query and
reaction identities, current scope bases, API exposure, and watch status
before work. The v1 anchor lifetime is 365 days. Renewal may extend at most
365 days from that renewal's fresh admission instant. The shipped
`POST /watches/{id}/renew` route requires the effective user's fresh provider
session and atomically replaces, rather than mutates, the anchor grant. Principal deletion
or deactivation, function replacement, basis revocation, expiry, or deletion
makes the watch terminally `dead`.

**Implementation checkpoint (external-automations bundle, 2026-08-10).** An
active integration scoped token may create and manage an integration-owned
watch. Creation atomically mints a 365-day ordinary protected grant under the
`watchAnchor.v1` profile and the watch record. It carries only the exact query
and, for function reactions, exact reaction scope; its consent digest binds the
watch id, installation grant, canonical argument/reaction digests, webhook
target if present, and expiry. Each evaluation and pre-effect boundary reloads
the active integration, live installation, anchor, current exact scope bases,
digest, and watch state. User revocation of either retained grant kills the
watch and clears pending firing state in the revocation transaction.

Invalidations enter the same dependency matcher used by live subscriptions
and enqueue the reserved `_snapback.watch.evaluate` action through LLP 0070's
durable queue. One pending evaluation per watch coalesces further invalidations;
the evaluator's own job-status changes are excluded to prevent recursive
wakeups. Evaluations fire only on a false-to-true predicate edge, enforce a
minimum/default five-second debounce, default to 100 firings per UTC day
(with a 30-day debounce ceiling and a configurable firing budget from 1
through 1,000), and admit at most four evaluations per owner concurrently.
Exhausting the daily budget suspends the watch with a
visible notification and journal outcome. The owner telemetry lane and firing
journal retain outcomes and diagnostic codes without credential material.
Evaluation or reaction failures retain the same firing ordinal through LLP
0070's bounded retry attempts; final exhaustion journals the failed firing and
lets the durable job settle `dead`. Tests drain the durable queue with an
injected clock and no wall-clock sleeps.

### D9.4 — Shareable capability links

A principal may mint an **expiring, revocable URL** bound to: one
exposed function, an argument template (pinned args + caller-supplied
args validated by schema), a narrowed delegated grant as ceiling, and
an optional use count. The server renders a generated destination —
live result view for queries, a validated form for mutations/actions,
asset delivery where applicable. Uses: public dashboards, upload
requests, RSVP links, approval forms, temporary data rooms. Possession
of the link is bearer *invocation* authority — and LLP 0055/0058 have
no carrier for it: a URL possessor supplies no actor principal, no
credential generation, no grant, and the resolved-authority set is
sealed. The design is therefore staged honestly. **v1 links bind only
functions in the external anonymous set (D1)**: the link adds pinned
arguments, attribution, and budget treatment to an invocation that was
already anonymously callable — no new execution authority, no
amendment needed. Extending links to granted operations (the narrowed
delegated-grant ceiling) is **commissioned, not assumed**: named dated
LLP 0055/0058/0031 amendments defining the link carrier (actor /
effective / grant attribution for a possessor, route class, mint
lineage, invocation gate), plus the LLP 0150 bearer-exception entry,
with secret-URL discipline attached throughout: short default and
bounded maximum expiry, instant revocation, narrow-by-construction,
journaled per use, no state change on GET, preview-crawler safety, no
logging or referrer leakage of the link token. Minting consumes the
minter's authority, so a revoked minter's links die with the grant.
Queries by default; a mutating link requires explicit opt-in or an
approval gate (D9.5, OQ9). "No amendment needed" means no new
execution-authority model: v1 links still take an LLP 0031
route/response registration and secret-token handling, and link
budgets compose with the anonymous network-evidence floor.

**Implementation note — S5 Landing A (2026-08-09).** The anonymous-set v1
slice above is implemented. Raw `sbl_` tokens are returned only inside the
mint URL and persisted only as domain-separated hashes; the registered
`{token}` template is the telemetry/diagnostic identity. The catalog retains
bounded `use_count`, `last_used_at_ms`, and `last_outcome` facts, while the
`link` caller-attribution span is the S2-D usage lane; durable full audit rows
remain deferred to the audit-log program. Link life is tied to the minter
human principal's validity, not the original session's liveness, while the
stored session and authority-instance lineage makes revocation exact-minter
only. Mutations/actions are single-use until D9.5 supplies the approval gate.
No granted-operation carrier or new execution authority is implemented.

### D9.5 — Approval-gated effects

An exposed mutation or action may declare `approval: "required"` (in
total, or per caller class — e.g. required for integration/agent
callers, direct for first-party sessions). An external invocation then
produces a **pending effect** and an approval link instead of executing:
the binding covers caller, function, args digest, authority, effect
class, expiry, and a preview receipt (dry-run where the function
supports it; disclosed prospective effects otherwise — never a
pretended dry-run). What the human approves is **prospective
authorization of an effect class, not a verified preview**, and the
ceremony presents it that way; where a function declares deterministic
inputs, the binding may carry a short-lived plan receipt (read/data
versions + effect summary) and execution refuses on staleness.
Approval revalidates the binding (generation and authority still
current) before execution; expiry and refusal settle into the journal. The approval surface is LLP 0150's, reused verbatim.
This is the trust primitive for consequential agent-initiated writes.
It does not move the LLP 0019 F8 audit-log gate: approval is consent,
not audit. What it can honestly narrow is the *first landing's scope* —
an audit log covering only approval-gated operations is a smaller
deliverable than one covering every external mutation, which may pull
the gated date earlier.

**Implementation note — S5 Landing C (2026-08-10).** The schema accepts
`approval: "required" | "external"` only on exposed mutations/actions and
compiles the closed fact onto the function manifest and public envelope.
`required` gates every caller; `external` keeps direct first-party sessions
immediate while service/integration/link and anonymous external lanes create a
24-hour (maximum seven-day) exact `_snapback_pending_effects` intent. Bare,
`/api/v1`, MCP, and link invocation share the
`SNAPBACK_EFFECT_APPROVAL_PENDING` 202 shape.

V1 honestly emits only `kind: "disclosed"`: the preview names the function's
declared write set and canonical args digest, never a fabricated dry run.
Approval and denial use the LLP 0150 session inbox/decision ceremony. Approval
revalidates expiry, function identity/kind, generation, exposure and current
gate, argument binding, original session or exact grant/credential generation,
approver policy, and link minter lineage, with operation-bound step-up for
`authorityCreating`. Execution then enters the ordinary mutation/action path
under the original caller semantics and records the approver separately.
Every state change appends a bounded journal fact. Expiry is lazy; a jobs-based
sweeper remains a tidy-up, not a correctness dependency. Granted capability
links and a genuine function-specific dry-run interface remain deferred.

## D10 — What falls out for free (the pitch, and the test)

For an app that adds ~ten `expose: true` lines, one budget block, and
an explicit `auth.agents.mode` declaration (D1):

- `API.md` + hosted reference + OpenAPI 3.1 document, generated.
- `POST /api/v1/...` with scoped tokens, quotas, deprecation discipline.
- A remote MCP server agent clients connect to with consent
  (bearer-only clients require the app's plain-bearer opt-in, D8).
- `npx snapback-app <url>` CLI with login.
- Optional `ask` endpoint with hard budgets, streaming by default.
- Code mode on all of the above, on targets carrying the evidenced
  untrusted-code profile (D6).
- An installable agent skill; watches, capability links, and
  approval-gated effects as the app opts in (D9).
- Per-integration usage attribution, suspension, and revocation in the
  admin console.

The acceptance bar is LLP 0201 M6, generalized: a stranger with only the
docs URL must reach "authenticated, listed, paged, sent, received" on the
API, the MCP server, and the CLI without reading the app's source. `ask`
is read-only in v1, so its bar is the read variation only — the "send"
case lands with mutating `ask` after the audit-log gate. The grader's
variation ("fetch the latest message of a named conversation using only
`API.md`") must pass on all four surfaces.

## Sequencing

- **S0 (unblocks LLP 0201 M6, local targets):** user-reachable grant
  issuance — close the `auth.agent-registration` GAP
  (`guide/capabilities.md`) with the LLP 0150 ceremony + console approval
  surface; generated `API.md` v0 from the envelope. No new wire surface.
- **S1:** exposure declaration + disclosure knob (governing `/inspect` +
  envelope together) + `/api/v1/*` route family with the stability
  contract; OpenAPI projection and the generated agent skill (D9.2 —
  same projection family); CORS via the dedicated `api.origins`
  amendment (D2).
- **S2:** remote MCP endpoint + OAuth facade + integration records +
  per-integration admission/metering.
- **S3:** CLI login + `npx` distribution polish (smallest slice; mostly
  shipped).
- **S4:** the streaming primitive (D9.1), code mode over the wire
  (`/api/v1/run`), then `ask` read-only with budgets, streaming.
- **S5:** the standing-authority cluster — durable watches (D9.3),
  capability links (D9.4), approval-gated effects (D9.5) — after S2's
  integration records and admission ladder, which they all key off.
- **Hosted gates, in parallel, unchanged by this RFC:** LLP 0039
  deployment-security contract, durable audit log (LLP 0019 F8) for any
  granted external mutation and externally effectful action (the D2
  lane matrix), hosted envelope/app-api serving.

## Open questions

All eleven questions were ruled at the author sitting of 2026-08-08;
each entry keeps the question and records the ruling.

- **OQ1 — Default disclosure for `api.enabled` apps.** This RFC proposes
  `exposed-only`, which inverts the decided anonymous-full-inventory
  posture of `/inspect` for such apps. **Ruled (author, 2026-08-08):
  `exposed-only` is the default for api-enabled apps; `disclosure:
  "full"` stays as the explicit opt-in.**
- **OQ2 — Where integration records live.** Proposed: app-owned rows +
  host-owned ceremony (mirroring LLP 0055's policy/mechanism split). The
  alternative — platform-level records with cross-app identity and a
  shared consent UX — changes the product (an "app store of integrations")
  and is deliberately not proposed here. **Ruled (author, 2026-08-08):
  app-owned rows + host-owned ceremony, as proposed; a platform registry
  may be layered later without unwinding this.**
- **OQ3 — Scope vocabulary for the facade.** Map OAuth scopes 1:1 to
  LLP 0055 canonical scopes (exact but ugly), or define coarse named
  bundles per app (`read`, `write`, per-system groups) compiled to scope
  sets? Proposed: bundles declared in the `api` block, compiled at
  activation, since third-party consent screens need human-sized nouns.
  **Ruled (author, 2026-08-08): named bundles, as proposed.**
- **OQ4 — Versioning mechanics.** Is `v1` additive-only with per-function
  deprecation windows enough, or do exposed functions need per-function
  `since`/`until` version stamps surfaced in the envelope? (Proposed:
  start additive-only; add stamps when the first real deprecation forces
  the question.) **Ruled (author, 2026-08-08): additive-only now, as
  proposed.**
- **OQ5 — `ask` result contract.** Free-form text + receipts, or
  caller-supplied JSON Schema the agent must satisfy (retry-until-valid)?
  Proposed: both, schema optional — but the schema path is what makes
  `ask` composable by other programs, so it should not slip past v1.
  **Ruled (author, 2026-08-08): both in v1, schema optional, as
  proposed.**
- **OQ6 — Streaming for third parties.** How far can the poll/lease loop
  carry external integrations before connection-grant streaming (and its
  lifecycle obligations) must be opened to them? **Ruled (author,
  2026-08-08): connection-grant streaming for integrations is a
  committed v2 deliverable on the roadmap — not evidence-gated — 
  scheduled after the hosted gates and the S5 cluster; polling remains
  the documented v1 story.**
- **OQ7 — Abuse posture for `ask` under caller-key billing.** With the
  caller paying model costs, the residual risk is data exfiltration rate,
  not spend; does the read-budget admission suffice, or does `ask` need
  its own result-volume ceiling? **Ruled (author, 2026-08-08): `ask`
  carries its own result-volume ceiling (bytes/rows per request and per
  principal-day) on top of read budgets; the refusal carries the
  escalation path.**
- **OQ8 — Declared-tier mechanics.** Minimum id entropy and format
  (proposed: free-form string ≥ 16 chars, prefix-namespaced like LLP 0148
  ids only when server-suggested); is `contact` required or merely
  rewarded (proposed: rewarded — a contactable id ages up faster); and
  the aging curve for fresh ids. Also whether the declared tier applies
  to `ask` at all (proposed: no — `ask` always requires at least a
  granted principal or caller-key billing, because compute is not a
  cooperative resource). **Ruled (author, 2026-08-08): as proposed
  with one strengthening — contact is required for the declared tier,
  not merely rewarded; refined same day: the requirement is satisfied
  by the id string itself containing a syntactically valid e-mail
  address (one string, no separate field). ≥16-char ids (an embedded
  e-mail satisfies length), age-up curve, and the `ask` exclusion
  stand.**
- **OQ9 — Capability-link bearer posture.** Default and maximum expiry;
  whether mutating links exist at all without an approval gate
  (proposed: a mutating link is always approval-gated or single-use);
  and whether link minting is itself a scoped grant operation (proposed:
  yes — minting a link consumes the minter's authority, so a revoked
  minter's links die with the grant); and whose approval a
  possessor-initiated anonymous-set mutating link solicits (minter vs
  record owner). **Ruled (2026-08-08, author-delegated,
  orchestrator-selected): the proposed package — short default and
  bounded maximum expiry; mutating links always approval-gated or
  single-use; minting is a scoped grant operation; the minter is the
  approver for possessor-initiated mutating links.**
- **OQ10 — Watch storm control.** Debounce/coalescing policy, per-watch
  and per-owner firing budgets, and the refusal shape when a watch
  exhausts its budget mid-storm (proposed: suspend + notify owner with
  the escalation pattern, never silent drop). **Ruled (author,
  2026-08-08): as proposed.**
- **OQ11 — Watch authority lifetime.** Integration-owned watches under
  `capturedGrant` die with LLP 0055's ≤90-day grant maximum; is a
  standing-automation renewal ceremony acceptable UX, or does 0055 need
  a named amendment for watch-anchoring grants (longer-lived,
  narrower)? User-owned watches under `revalidatePrincipal` need a
  stated policy for suspended/deleted principals. **Ruled (author,
  2026-08-08): commission the named LLP 0055 amendment for
  watch-anchoring grants — longer-lived, strictly narrower (exactly
  the watch's query + reaction scope), instantly user-revocable; a
  suspended or deleted principal kills the watch.**

## Revision history

- 2026-08-09 — S4 Landing C implemented D5 and the OQ5/OQ7/OQ8 rulings:
  `api.ask` plus complete `api.budgets.ask`, the manifest-activated exact
  `_snapback_ask_spend` ledger, `POST /api/v1/ask`, and MCP `ask`. V1 is
  read-only and catalogues only exposed queries; app-paid authority consumes
  the distinguished data-egress consent scope, caller-key authority requires
  a granted read principal, and anonymous/declared callers are refused.
  Admission reserves per-request maxima transactionally and settlement swaps
  them for actual token/result-byte spend. Receipts name provider/model,
  token accounting, current spend, and per-run domain-separated HMAC call
  commitments under a `provenanceNotProof` field. The D5 phrase “LLP 0070
  guarded egress” was a mis-cite: the implementation follows LLP 0009's
  guarded outbound-action gate and LLP 0036's declared runtime secret seam.
- 2026-08-09 — S4 Landing A implemented the D9.1 private streaming-action
  primitive: action-only manifest fact and implementation identity,
  `ctx.stream.emit`, bounded server-authorized ephemeral delivery, initiator
  privacy, live retained reconnect hints, immutable manifest-gated transcript
  settlement, process-death reconciliation, cancellation, route taxonomy, and
  focused proofs. The wider D9.1 projections remain explicitly deferred.
- 2026-08-08 — v0.1 Draft. Synthesis of the 2026-08-08 corpus survey
  (agent-access primitives: LLPs 0024, 0055, 0062, 0149, 0150) and the
  competitive survey (Convex, Supabase, Firebase, PocketBase, Hasura,
  Appwrite, Directus, Strapi, Clerk/Stytch/WorkOS, MCP ecosystem) into a
  unified four-surface proposal with exposure declaration, stability
  contract, code-mode substrate, and OAuth-facade-over-0150 authority
  model. Same day: added the declared tier (auth-free identified access —
  self-chosen client id, cooperative budgets over the anonymous floor,
  claimable into an integration record) per author direction.
- 2026-08-08 — v0.2. Adopted five second-wave derived features per author
  direction after a dual-model brainstorm (Claude + Codex gpt-5.6-sol):
  D9.1 streaming conversations (durable settling transcripts,
  multi-viewer, AI-SDK projection), D9.2 generated agent skill, D9.3
  durable watches, D9.4 shareable capability links, D9.5 approval-gated
  effects. `ask` now streams by default; sequencing gains S5; OQ9–OQ10
  added.
- 2026-08-08 — v0.3. Super-refine round-1 revision (reviews:
  `llp/reviews/0204-app-external-surfaces.{claude,gpt-5.6-sol}.md`,
  round 1, both NOT READY on 26c16b2eb). Material repairs: (claude M1 /
  D2) hosted ladder restated — only ungranted lanes are gate-free on
  hosted; granted invocations, reads included, inherit LLP 0055's
  wholesale refusal pending LLP 0039, mutations additionally LLP 0019
  F8; (claude M2 = gpt M1 / D6) untrusted code mode made per-target
  conditional on an evidenced LLP 0009/0047 profile, action-class
  execution named, LLP 0009 added to Related; (claude M3 / D1, D10)
  `api.enabled` refuses activation without an explicit
  `auth.agents.mode`; (gpt M2 / D7) integration record split from
  per-user installations, delegation-only v1, re-credentialing kills
  installations rather than transferring them; (gpt M3 / D7)
  declared-tier ledger bounded (network-evidence gate, TTL, per-app
  cap); upgrade issues a fresh identity with declared history as
  untrusted attribution; (gpt M4 / D1) external anonymous set =
  `public` + anonymous `optional-user` per LLP 0058/0172, uniform
  across projections; (gpt M5 / D9.1) streams private to initiating
  authority by default, multi-viewer only via declared sharing over
  row-authorized durable results; (gpt M6 / D5, D9.5) receipts labeled
  provenance-not-proof; approval labeled prospective authorization with
  optional plan receipts. Minors folded: one-fact claim scoped to
  exposed-only, bypass-path enforcement named (bare routes, live,
  nested, MCP), watch authority anchored to LLP 0070 modes (+ OQ11),
  capability links commissioned as a named LLP 0150 bearer amendment
  with secret-URL discipline, bearer-only MCP claim qualified, facade
  routes assigned a dated LLP 0031 amendment, caller-key custody
  posture fixed, Motivation matched to the S0 gap, transcript custody
  stated, OAuth 2.1 parenthetical corrected, stability classifier
  assigned to S1, CLI default scope tied to OQ3 bundles, D9.5 on-ramp
  claim replaced with audit-scope narrowing.
- 2026-08-08 — v0.4. Super-refine round-2 revision (delta round on
  e36ef7bfe; claude NOT READY: 1 MATERIAL in-delta + 1 pre-existing;
  gpt-5.6-sol NOT READY: 4 MATERIAL in-delta). Repairs: (both M1 / D1)
  anonymous residual reachability stated — `expose: false` cannot
  remove bare-route anonymous reachability of anonymous-admitting
  functions; callability-follows-exposure scoped to credentialed
  lanes; (claude M2 / D2) `authorized-lease` removed from the v1
  third-party recipe (outside LLP 0055's v1 service-principal
  surface); plain re-poll documented; (gpt M2 / D3) MCP unauthenticated
  calls admitted to exactly the D1 anonymous set; hosted MCP =
  anonymous set only pre-LLP 0039; (gpt M3 / D7) lifecycle authorities
  made disjoint and named — per-user revocation, key-holder rotation
  as fail-closed global kill with plain disclosure, operator
  suspension; DCR records unowned/provisional, owner bound at
  LLP 0150 approval, never first-installer; (gpt M4 / D9.4) v1
  capability links restricted to the external anonymous set;
  granted-link carrier commissioned as named LLP 0055/0058/0031
  amendments. Minors: Summary/D5 execution wording aligned to D6's
  per-target gate; sessions-mode implication + explicit-`disabled`
  validity stated; transcript custody wording unified; MCP-auth
  standards list corrected (RFC 8414); generation-pinning attribution
  corrected (LLP 0012/0058); CORS claim scoped; anonymous-floor
  ownership cited precisely; dev-tooling discovery named (LLP 0031 D3
  gated projection); granted-local claim scoped to the finite surface;
  ungranted-lane mutation posture stated; skill/D10 code-mode claims
  made target-conditional; digest value-minimization added; P3 tuple
  scoped to granted lanes; v1 `ask` SSE named request-bound; watch
  predicates pinned to a closed grammar.
- 2026-08-08 — v0.5. Author-authorized post-terminal revision (rounds
  4–6 authorized after the round-3 budget terminal; reviews:
  `llp/reviews/0204-*`, round 3, both NOT READY on 384c5f638). The
  six-item ledger: (both M1 / D7) rotation restated grant-preserving
  per 0055; global kill = owner re-credentialing (session + step-up) /
  operators; **integration retirement** verb commissioned as a named
  0055 amendment for unowned records; (both M2 / D7) integration
  registrations exempted from 0150's approver-as-owner via a second
  commissioned 0055/0150 amendment — installation approvals never seat
  ownership; ownership claimable only by key-possession ceremony or
  operator action; (gpt M3 / D7) delegation-only recast as a
  commissioned integration registration class (template suppressed,
  installation-only minting, activation/migration checks); (gpt M4 /
  D1, D7) external-anonymous admission and response contract
  commissioned as a named 0031/0071 amendment (the
  `DeclaredPublicApplicationData` class is narrower than the D1 set);
  (gpt M5 / D4) dev discovery reverted to 0062's local-artifact path
  (no operator-plane twin on the app CLI); (gpt M6 / D10) `ask`
  acceptance read-only in v1; "send" deferred to mutating-`ask`.
  Minors: credentialed-callability wording; explicit-`disabled`
  posture corrected (no new onboarding, existing grants survive); F8
  clause scoped "on hosted targets" and the Sequencing bullet aligned;
  S1 CORS names the `api.origins` amendment; v1 link plumbing named
  (0031 registration, secret-token handling, floor-composing budgets);
  MCP bounded search/describe projection; `ask` consent/receipts
  disclose model identity and data egress; OQ9 gains the
  approver-identity question; server-side checker noted as S4
  machinery.
- 2026-08-08 — v0.6. Decision-sitting propagation (author sitting
  2026-08-08): OQ1 exposed-only default confirmed; OQ2 app-owned
  records; OQ3 named scope bundles; OQ4 additive-only; OQ5 optional
  schema in v1; OQ6 integration connection-grant streaming committed
  as a v2 roadmap deliverable (author override of the evidence-gated
  proposal); OQ7 `ask` result-volume ceiling; OQ8 as proposed but
  `contact` required (author strengthening); OQ9 proposed package with
  minter-approves (author-delegated); OQ10 as proposed; OQ11
  watch-anchoring grant amendment commissioned. Unreviewed relative to
  the converged v0.5 (310745d3d).
- 2026-08-08 — v0.7. OQ8 refinement (author): the declared-tier contact
  requirement is carried in the id string itself — the id must contain
  a syntactically valid e-mail address; no separate `contact` field
  (NCBI/Wikimedia etiquette precedent). Status advanced to
  **Accepted** by author direction ("if that seems reasonable then go
  ahead and accept it"; orchestrator judged it reasonable and recorded
  the judgment in D7). Acceptance follows the round-4 dual-READY
  convergence on v0.5 and the complete OQ sitting.
