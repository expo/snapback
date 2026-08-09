# LLP 0204: App external surfaces

**Type:** RFC
**Status:** Draft
**Systems:** API, Auth, Client integration, Agent tooling, MCP, Codegen,
Hosted platform, Developer experience, Docs
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-08-08
**Related:** LLP 0004 (application data API — deferred "REST auto-generation,
public endpoint routing"), LLP 0024 (agent operating surface — generated
app-data MCP catalog), LLP 0031 (server route taxonomy — reserved-prefix
invariant), LLP 0039 (hosted deployment security — origin allowlisting,
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
envelope); the server executes it in the restricted no-eval handler VM under
the caller's grant, with every embedded call still individually authorized.
Code mode is the shared execution substrate: the API's batch endpoint, the
MCP server's escape hatch from tool-call chattiness, the CLI's `run` verb
(shipped today), and the inner loop of the AI interface are all the same
mechanism with the same authority and budget semantics.

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
  designed and shipped on local targets (LLP 0055), with a consent ceremony
  that is materially better than the industry's copy-paste-a-PAT norm
  (LLP 0150).
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
which the `expectedGeneration` pinning discipline (LLP 0093) currently
makes impossible for outsiders.

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
  the app." Every external call resolves to the LLP 0055 audit tuple
  (actor principal, effective principal, grant). Cost, quota, revocation,
  and audit all key off that tuple.
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
    "enabled": true,
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
  one fact**. An unexposed function is not callable with an integration
  credential, does not appear in the external envelope projection, the
  OpenAPI document, the MCP catalog, the CLI's external mode, or `API.md`.
  Per LLP 0062's warning, `disclosure: "exposed-only"` must govern
  `/inspect` and the envelope together — redacting one but not the other
  protects nothing. `disclosure: "full"` preserves today's decided
  anonymous-inventory posture for apps that want it; the default for apps
  with `api.enabled` is `exposed-only`.
- Exposure composes with, and never weakens, LLP 0058/0172 authorization.
  An exposed `authenticated` function still requires an effective user; an
  exposed `public` function is callable anonymously subject to the
  LLP 0090 anonymous budget posture.
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
  proposal.
- **No generation pinning.** External calls omit `expectedGeneration`; the
  server serves the current generation. The envelope digest lets a careful
  client detect change; the stability contract makes not caring safe.
  (Internal clients keep pinning; nothing changes on the first-party path.)
- **Pagination and result bounds** are a protocol concern (LLP 0149 F8):
  exposed queries above a declared result bound must accept cursor
  arguments; the generated docs state the bound. v1 can enforce this as a
  lint at exposure time rather than new runtime machinery.
- **Reads first on hosted.** Anonymous/`public` reads (including the
  declared auth-free lane, D7) and user-delegated reads are v1; external mutations follow the same gate LLP 0055 already
  states — hosted service-principal invocation stays refused until
  LLP 0039's deployment-security contract and the durable audit log
  (LLP 0019 F8) land. Local/trusted-local targets get the full surface
  immediately, which is exactly what LLP 0201 M6 needs.
- **Live data.** v1 documents a poll/lease loop (`authorized-lease` +
  re-poll) for third parties; connection-grant streaming for integrations
  is v2 (the connection-open path assumes first-party lifecycle handling).
- **CORS** for browser-based third parties: exposed-surface routes get an
  app-declared origin policy (`api.origins`), implemented under LLP 0039's
  deferred origin-allowlisting contract. Absent a declaration, no CORS —
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
  `run_code` (code mode, D6), and — where enabled — `ask` (the AI
  interface, D5, so any MCP client gets the high-level surface too).
- **Authorization:** this is where the OAuth facade (D8) earns its keep.
  MCP clients speak OAuth 2.1 + dynamic client registration; the generated
  authorization-server metadata points at the facade, whose consent step
  *is* the LLP 0150 approval link. The resulting token is an LLP 0055
  delegated grant scoped to the user who approved it. Tool listing is
  public (it is the envelope, per the disclosure posture); tool *calls*
  carry the grant.
- **Scope shaping:** eager one-tool-per-function does not scale (LLP 0149
  F3). The catalog groups tools and advertises `run_code` prominently;
  clients with small tool budgets can operate through code mode alone —
  the Stainless/Cloudflare "code mode" convergence, which Snapback gets
  natively because the typed client already exists.

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
  default to the CLI's task tier; escalation happens at refusal time.
- **Verb surface:** external mode lists exposed functions only; the
  developer's own CLI against a trusted-local target keeps today's full
  surface. Same engine, same knob, two projections — P1 again.

## D5 — Surface 4: the near-data AI interface

The novel surface: `POST /api/v1/ask` (and the `ask` MCP tool). The caller
sends a task in natural language plus an optional result schema; a hosted
agent runs **next to the data**, iterates over the app's exposed functions
(and only those), and returns a result with receipts.

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
  own model credential and the app spends nothing. Default: no budget
  declared → surface disabled.
- **Execution shape:** the agent's tool loop is code mode (D6) plus plain
  function calls, in the restricted VM, with the LLP 0047 execution-limit
  regime extended with a token meter. v1 is **read-only** (queries only)
  regardless of grant, mirroring the corpus's own hosted-mutation
  sequencing; mutating `ask` follows the audit-log gate.
- **Receipts:** the response includes the function calls made (names, arg
  digests, result digests) — LLP 0149 F9's "task completed" receipt —
  so callers can verify the answer against the API directly and so audit
  attributes every read to the ask that caused it.
- **Model plumbing** rides the existing egress/secret machinery (LLP 0036
  handles for provider keys; LLP 0070's guarded-egress posture). Model
  and provider allowlists are app policy.

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
  that envelope, executes in the restricted no-eval handler VM (the same
  VM class every JS handler already qualifies under — `snapback
  runtime-qualify`), and returns the program's value.
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

## D7 — Integration records, admission, and metering

The thin new identity object between "agent principal" and "OAuth client":

- **Integration record:** owner (a user principal of the app), display
  name, optional origin/redirect facts for the OAuth facade, credential
  (key-bound per LLP 0150; the facade can hold the key client-side),
  status (active/suspended/revoked), and per-integration budget overrides.
  Stored as app data in reserved tables like auth state today; the
  registration policy knob is LLP 0055's existing
  `auth.agents.mode: disabled | invited | open` — an integration is an
  agent principal with a public face, not a new principal kind.
- **Admission — a three-lane ladder:** LLP 0071's admission contract gains
  per-integration keys: every external call is admitted against
  (integration, principal) budgets before execution. Below the granted
  lane sit two auth-free lanes:

  - **Anonymous** — the LLP 0090 bounded posture, keyed on network
    evidence. The hard floor; nothing weakens it.
  - **Declared** — auth-free but *identified*: the caller self-chooses a
    client id (no registration round trip, no secret — a header such as
    `Snapback-Client-Id: <id>; contact=<email-or-url>`) and the server
    auto-creates a usage ledger row on first sight. Declaration conveys
    **zero authority** — only exposed `public` functions are reachable,
    same as anonymous — but buys the cooperative treatment: a stable,
    more generous budget, per-id attribution in the owner's console, a
    contact channel for warn-before-block, and refusals that say which
    lane you are in and how to move up (the LLP 0150 escalation pattern
    at the rate-limit layer). Precedent: NCBI E-utilities' `tool`/`email`
    params, Wikimedia's identifying User-Agent etiquette — cooperative
    identification, not authentication, matching LLP 0055's existing
    declared-vs-credentialed honesty split.

  The sybil trap is handled structurally: declared budgets **compose
  with, never replace, the anonymous network-evidence floor** (minting
  fresh ids cannot multiply past the ceiling), and new ids start modest
  and age up; operators can bless or suspend individual ids. A declared
  id is also the on-ramp: it can later be **claimed** into an integration
  record — same string, usage history carried over — so the path from
  curious script to consented integration has no cliff.
- **Attribution:** usage rolls up to the integration in LLP 0104 metering,
  so the app owner sees per-integration consumption and can suspend from
  the admin console. Revoking the integration revokes its grants — one
  switch, LLP 0055 semantics.

## D8 — Authority acquisition: the ceremony and the facade

Current standards, for the record: OAuth 2.1 (consolidating PKCE-required
authorization-code and device-authorization grants), RFC 8628 (device
grant), RFC 7591 (dynamic client registration), RFC 9728 (protected
resource metadata), and the MCP authorization spec built on all four; plus
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
independent authority. Standards for the ecosystem, the better ceremony
for everyone who talks to us directly (P5).

"PAT-like" long-lived credentials for the M6-style headless script are the
same mechanism at maximum simplicity: a user mints a scoped delegated
grant from the app's console (the LLP 0055 approval surface), bound to a
key the script generates — never a copy-paste bearer secret (LLP 0150
invariant 1).

## D9 — What falls out for free (the pitch, and the test)

For an app that adds ~ten `expose: true` lines and one budget block:

- `API.md` + hosted reference + OpenAPI 3.1 document, generated.
- `POST /api/v1/...` with scoped tokens, quotas, deprecation discipline.
- A remote MCP server any 2026 agent client can connect to with consent.
- `npx snapback-app <url>` CLI with login.
- Optional `ask` endpoint with hard budgets.
- Code mode on all of the above.
- Per-integration usage attribution, suspension, and revocation in the
  admin console.

The acceptance bar is LLP 0201 M6, generalized: a stranger with only the
docs URL must reach "authenticated, listed, paged, sent, received" on each
surface without reading the app's source — and the grader's variation
("fetch the latest message of a named conversation using only `API.md`")
must pass on the API, the MCP server, the CLI, and `ask`.

## Sequencing

- **S0 (unblocks LLP 0201 M6, local targets):** user-reachable grant
  issuance — close the `auth.agent-registration` GAP
  (`guide/capabilities.md`) with the LLP 0150 ceremony + console approval
  surface; generated `API.md` v0 from the envelope. No new wire surface.
- **S1:** exposure declaration + disclosure knob (governing `/inspect` +
  envelope together) + `/api/v1/*` route family with the stability
  contract; OpenAPI projection; CORS under the LLP 0039 contract.
- **S2:** remote MCP endpoint + OAuth facade + integration records +
  per-integration admission/metering.
- **S3:** CLI login + `npx` distribution polish (smallest slice; mostly
  shipped).
- **S4:** code mode over the wire (`/api/v1/run`), then `ask` read-only
  with budgets.
- **Hosted gates, in parallel, unchanged by this RFC:** LLP 0039
  deployment-security contract, durable audit log (LLP 0019 F8) for any
  external mutation, hosted envelope/app-api serving.

## Open questions

- **OQ1 — Default disclosure for `api.enabled` apps.** This RFC proposes
  `exposed-only`, which inverts the decided anonymous-full-inventory
  posture of `/inspect` for such apps. Confirm the inversion, or keep
  `full` as default and make curation opt-in.
- **OQ2 — Where integration records live.** Proposed: app-owned rows +
  host-owned ceremony (mirroring LLP 0055's policy/mechanism split). The
  alternative — platform-level records with cross-app identity and a
  shared consent UX — changes the product (an "app store of integrations")
  and is deliberately not proposed here.
- **OQ3 — Scope vocabulary for the facade.** Map OAuth scopes 1:1 to
  LLP 0055 canonical scopes (exact but ugly), or define coarse named
  bundles per app (`read`, `write`, per-system groups) compiled to scope
  sets? Proposed: bundles declared in the `api` block, compiled at
  activation, since third-party consent screens need human-sized nouns.
- **OQ4 — Versioning mechanics.** Is `v1` additive-only with per-function
  deprecation windows enough, or do exposed functions need per-function
  `since`/`until` version stamps surfaced in the envelope? (Proposed:
  start additive-only; add stamps when the first real deprecation forces
  the question.)
- **OQ5 — `ask` result contract.** Free-form text + receipts, or
  caller-supplied JSON Schema the agent must satisfy (retry-until-valid)?
  Proposed: both, schema optional — but the schema path is what makes
  `ask` composable by other programs, so it should not slip past v1.
- **OQ6 — Streaming for third parties.** How far can the poll/lease loop
  carry external integrations before connection-grant streaming (and its
  lifecycle obligations) must be opened to them? Needs traffic evidence,
  not speculation.
- **OQ7 — Abuse posture for `ask` under caller-key billing.** With the
  caller paying model costs, the residual risk is data exfiltration rate,
  not spend; does the read-budget admission suffice, or does `ask` need
  its own result-volume ceiling?
- **OQ8 — Declared-tier mechanics.** Minimum id entropy and format
  (proposed: free-form string ≥ 16 chars, prefix-namespaced like LLP 0148
  ids only when server-suggested); is `contact` required or merely
  rewarded (proposed: rewarded — a contactable id ages up faster); and
  the aging curve for fresh ids. Also whether the declared tier applies
  to `ask` at all (proposed: no — `ask` always requires at least a
  granted principal or caller-key billing, because compute is not a
  cooperative resource).

## Revision history

- 2026-08-08 — v0.1 Draft. Synthesis of the 2026-08-08 corpus survey
  (agent-access primitives: LLPs 0024, 0055, 0062, 0149, 0150) and the
  competitive survey (Convex, Supabase, Firebase, PocketBase, Hasura,
  Appwrite, Directus, Strapi, Clerk/Stytch/WorkOS, MCP ecosystem) into a
  unified four-surface proposal with exposure declaration, stability
  contract, code-mode substrate, and OAuth-facade-over-0150 authority
  model. Same day: added the declared tier (auth-free identified access —
  self-chosen client id, cooperative budgets over the anonymous floor,
  claimable into an integration record) per author direction.
