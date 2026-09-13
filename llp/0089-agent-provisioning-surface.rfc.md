# LLP 0089: Agent provisioning surface

**Type:** RFC
**Status:** Draft
**Systems:** Developer experience, Deployment, API, Tooling, Auth, Security
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-07-23 (initial draft under LLP 0086 §CC-1)
**Related:** LLP 0010, LLP 0011, LLP 0012, LLP 0018, LLP 0019, LLP 0024, LLP 0037, LLP 0053, LLP 0060, LLP 0082, LLP 0086, LLP 0087

## Summary

This RFC is the contract for Snapback's **agent provisioning surface**: the
operations by which an agent holding only credentials and an endpoint takes a
Snapback deployment from nothing to a working app — created, schema'd,
permissioned, code loaded, and invocable — with no human dashboard session.

The evidence motivating it is
[LLP 0082](./0082-instantdb.research.md) §Agent-first DX: InstantDB's remote
MCP server plus programmatic platform API is the current competitive
high-water mark, and the combination — an agent goes from nothing to a
provisioned, permissioned backend without a human in a browser — is the
highest-leverage product gap against the competitor closest to Snapback's
surface. [LLP 0086](./0086-prior-art-course-corrections.plan.md) §CC-1
converted that finding into this work item.

This document owns the *contract*: the versioned operation table, its
projections, artifact identity and rollback policy, target scope, and the
acceptance gate. It deliberately owns nothing LLP 0024 already owns — the
host-ops operating surface for a running server stays where it is.

## Placement (resolves LLP 0086 open question 4)

LLP 0086 asked where the CC-1 provisioning contract lives: an extended
[LLP 0024](./0024-agent-operating-surface.spec.md) or a new document. The
resolution embodied here:

- **The contract lives in this new document.** LLP 0024's scope is **not**
  extended. LLP 0024 §Scope explicitly does not own hosted control planes,
  billing, tenants, or project lifecycle, and that exclusion stands; its
  2026-07-23 pointer note records this. LLP 0024 remains the operating
  surface for an app that already exists on a running server; LLP 0089 is
  the lifecycle surface that brings an app into existence and manages its
  published code.
- **[LLP 0087](./0087-facets-hosted-adoption.plan.md) Phase 2 consumes this
  contract.** Phase 2's "apps as data" control plane names CC-1's
  provisioning surface as its contract prerequisite; this document is that
  contract. Phase 2's Gate 2 entry requires the accepted contract — not the
  admin-token fallback — before any live migration.

Rationale for a new document rather than amendment: the two surfaces have
different authority postures (operating an app you own vs. creating apps on
a platform), different target maturity (LLP 0024's core is built locally;
provisioning is new), and LLP 0024's dated 2026-07-16 amendment already
refuses hosted operations pending prerequisites this document must state and
sequence explicitly. Folding project lifecycle into LLP 0024 would blur a
scope boundary that document has defended through review three times.

## Scope

This RFC owns:

- the versioned provisioning operation ids, required arguments, and required
  result data;
- artifact identity, provenance, version selection, rollback, and the
  anti-rollback policy for pushed code;
- schema/code compatibility checking at admission time;
- the schema-lockdown toggle's operating-surface half (the safety feature is
  named in [LLP 0037](./0037-schema-source-of-truth.decision.md)'s 2026-07-23
  amendment, which requires this surface to expose it);
- the projection order and projection-consistency rule (remote MCP, platform
  HTTP API);
- the provisioning authority model per target class, including the hosted
  prerequisites and the interim-fallback rules;
- the riding deliverables: `.md`-suffixed docs URLs and the skills package;
- the acceptance gate proving the end-to-end path.

It does not own:

- host-ops operations on a running app (`host.*`, `app.inspect`,
  `function.run`, …) — LLP 0024;
- schema, handler, or `ctx.db` syntax — LLP 0004; schema source-of-truth and
  the lockdown guarantee's mechanism — LLP 0037;
- the auth token model, service principals, and permission language —
  [LLP 0011](./0011-auth-and-permissions.rfc.md);
- the hosted deployment security contract —
  [LLP 0060](./0060-hosted-auth-security.rfc.md);
- the hosted platform topology, app registry location, artifact byte
  placement, and migration — LLP 0087 (and LLP 0014's ratified decisions);
- billing, quotas, tenant management, and organization/account structure —
  unowned today; explicitly out of scope here too.

## Operation table (provisioning.v0)

One authority table, in LLP 0024's style: stable dotted operation ids used
in result envelopes, logs, and projection metadata. Every operation returns
LLP 0024's result-envelope shape (`schemaVersion`, `requestId`, `operation`,
`ok`, `target`, `authority`, `artifacts`, `data`, `diagnostics`, `next`)
with `resultKind: "provisioningResult"`; diagnostics use the LLP 0012
diagnostic schema. A projection-specific result shape is a bug.

| Operation id | Purpose | Required v0 result data |
| --- | --- | --- |
| `app.create` | Create a new app on the target: identity, empty durable state, default-closed permissions, schema lockdown engaged. | `appId`, target profile, initial `databaseVersion`, lockdown state, capability manifest reference. |
| `schema.push` | Admit a schema manifest for the app, subject to lockdown and compatibility checks. | `schemaHash` (content hash), previous/new schema hashes, compatibility verdict, schema diagnostics. |
| `permissions.push` | Admit a permissions/auth-rules manifest for the app. | permissions artifact hash, previous/new hashes, diagnostics. |
| `code.push` | Publish a function/code artifact for the app. Publication only; does not change the active version. | `bundleHash` (content-hash identity), provenance record, admission verdict (schema/code compatibility), function count, diagnostics. |
| `code.activate` | Select the active artifact version, including rollback to a previously published version, subject to the anti-rollback policy. | previous/new active `bundleHash` and version, rollback flag, anti-rollback policy verdict, provenance of the activated artifact. |
| `capabilities.read` | Read the target's capability manifest for the app, so an agent can plan against what this target actually supports. | `capabilityManifest` (LLP 0012 family), target profile. |
| `schema.lockdown` | Toggle the LLP 0037 schema-lockdown mode. Default is **locked**; unlocking requires an explicit reason recorded in the result. | previous/new lockdown state, actor, reason, diagnostics. |

Notes binding the table:

- **`app.create` defaults are fail-closed.** A newly created app has
  default-deny permissions (LLP 0011's stance) and schema lockdown engaged
  (LLP 0037). An agent must push schema and permissions explicitly; nothing
  is writable by omission.
- **Content-hash artifact identity.** `schemaHash` and `bundleHash` are
  content hashes in LLP 0012's artifact-identity family; the hash is the
  join key between the registry row and artifact bytes wherever the bytes
  live (LLP 0087 open question 3 decides placement for the hosted target —
  this contract only requires that identity is the hash).
- **Publication and activation are separate operations.** LLP 0087 Phase 2's
  rollback rehearsal and anti-rollback tests need "which artifact is live"
  to be an explicit, auditable state transition, not a side effect of
  upload. `code.push` then `code.activate` is the normal deploy;
  `code.activate` naming an older version is the rollback.
- **Anti-rollback policy.** Per LLP 0087 Phase 2: no silent downgrade to a
  known-vulnerable artifact. v0 policy: an artifact version may be marked
  `deniedForActivation` (with a provenance-recorded reason); `code.activate`
  refuses it with a structured diagnostic; overriding requires the same
  authority that could have deleted the app, plus an explicit
  `overrideReason` recorded in the result and audit trail. Rollback to a
  non-denied prior version is a first-class, tested path, not an exception.
- **Provenance.** Every `code.push` records an immutable provenance fact:
  publishing principal, authority mode, timestamp, content hash, and the
  request id. `code.activate` results carry the provenance of what was
  activated. Provenance is queryable by the operations above and is part of
  the hosted audit-log prerequisite (LLP 0019 F8) — locally it may live in
  the app registry; hosted it must be durable.
- **Schema/code compatibility at admission.** `code.push` is checked against
  the app's admitted schema (and `schema.push` against active code) at
  admission time, per LLP 0087 Phase 2's requirement. v0 verdicts:
  `compatible`, `incompatible` (refused with diagnostics), or
  `unverifiable` (refused by default; a target may admit with an explicit
  override, recorded). The check mechanism is LLP 0037's manifest
  validation; this contract only pins that admission is where it runs and
  that refusal is structured.
- **Lockdown interaction.** While `schema.lockdown` is engaged (the
  default), `schema.push` is the *only* path that changes schema, and it
  still validates against LLP 0037's manifest rules; no code path admitted
  by `code.push` may create tables, fields, or indexes dynamically.
  Disengaging lockdown is a deliberate, logged act — it exists for
  exploratory dev flows, not as a convenience default.

Versioning: this table is `provisioning.v0`. Additive operations bump the
minor surface the same way LLP 0024's host-ops table does; renaming or
re-semanticizing an id requires a dated amendment here.

## Projections (resolves LLP 0086 open question 1)

**Proposed decision: one authority op table, two projections — remote MCP
first, platform HTTP API second.** Both project the table above with
identical authority semantics and the same result envelope, under LLP
0024's projection-consistency rule: a behavior difference between
projections is a bug unless this document names it transport-only.

- **Remote MCP first.** The agent-first path mirrors the LLP 0082 evidence:
  what moved the needle for Instant was an agent connecting to a remote MCP
  endpoint with credentials and provisioning without any human session.
  Snapback's buyer for this surface is an agent harness, and MCP is the
  transport agent harnesses already speak. Tool names follow LLP 0024's
  convention (`snapback_app_create`, `snapback_schema_push`,
  `snapback_code_push`, `snapback_code_activate`,
  `snapback_permissions_push`, `snapback_capabilities_read`,
  `snapback_schema_lockdown`), each calling exactly one operation id.
- **Platform HTTP API second.** The same table over HTTP for CI, scripts,
  and non-MCP tooling — one operation endpoint in LLP 0024's
  `POST` + operation-id style rather than a REST resource model, so the
  table stays the single source of truth. It ships after the MCP
  projection but before the surface is declared stable, because the
  acceptance gate exercises both.
- **Not chosen:** HTTP-first (agents are the priority customer and the
  evidence says MCP is their door), and MCP-only (CI and the acceptance
  harness need a projection that does not require an MCP client).

The control-plane MCP server LLP 0024 pins (operating a local server) and
this provisioning MCP surface are distinct tool families and must stay
visibly distinct, exactly as LLP 0024 separates control-plane from app-data
tools. A provisioning tool never invokes app functions; an app-data tool
never creates apps.

## Target scope and authority

**Local / trusted-local first.** On the local target apps are already data
(LLP 0003's model): `app.create`, `schema.push`, and `functions.load`-class
operations have existing machinery, and the local admin authority model
(LLP 0024's authority tuple, `AdminWrite` for mutating operations) applies
directly. The v0 implementation and the acceptance gate below run here.

**Hosted delivery coordinates with LLP 0087 Phase 2** and inherits its
prerequisites without restatement drift — the authoritative list is LLP
0087 Phase 2's entry conditions:

- LLP 0060's target-authored deployment contract (LLP 0024's 2026-07-16
  amendment refuses hosted operations without it);
- LLP 0019 F8's durable audit log (hosted mutations, which every
  provisioning operation is, additionally require it);
- the applicable LLP 0011 service-principal work: hosted provisioning
  authenticates a service principal with scoped grants, never a dev
  impersonation mode. `devUser`/`devAdminBypass` remain local-only exactly
  as LLP 0024 pins them.

**Interim fallback (hosted, pre-contract).** If development needs hosted
provisioning motion before this contract passes review, LLP 0087 Phase 2's
fallback rules govern, verbatim in effect: a minimal op set on the
coordinator's existing admin-token-gated surface
(`SNAPBACK_ADMIN_TOKEN`-checked endpoints in
`targets/cloudflare/src/coordinator.js`), explicitly marked pre-contract and
non-public — reachable only with the admin token, enabled only on the
non-production facets profile, absent from the emitted capability manifest
— and **never** on the handler↔host op table
(`targets/cloudflare/src/host-ops.js`), the door-3 seam loaded app code can reach.
Any wrangler-automation path (scripting today's per-app deploy cycle) is
the same class of fallback and follows the same rules. The fallback cannot
satisfy any exit criterion here or any LLP 0087 gate.

## Riding deliverables

Two smaller absorptions from LLP 0082 ride this surface, each with a
checkable exit:

1. **Docs as `.md` URLs.** Every served docs page is also reachable with a
   `.md` suffix returning raw markdown (Instant's pattern: agents fetch
   markdown, not rendered HTML). Exit: the acceptance gate fetch-checks at
   least one guide page by `.md` URL and asserts markdown content.
2. **Skills package.** A Snapback skills package installable into an agent's
   skill-discovery path (the same aggregation model this repository already
   uses under `skills/` and `.agents/skills`), teaching the provisioning
   flow: connect, `capabilities.read`, `app.create`, push, activate,
   verify. Exit: at least one acceptance scenario runs the provisioning
   flow driven by the installed skill package.

## Acceptance gate

Per [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)'s bar — structured
diagnostics, machine-checkable, no human ritual — this RFC's gate, run on
the local/trusted-local target:

An agent holding **only credentials and the surface endpoint** provisions a
working app end-to-end: `app.create` → `schema.push` → `permissions.push` →
`code.push` → `code.activate` → one generated function invocation succeeds
(via LLP 0024's `function.run` or the generated app-data path — the
invocation itself is LLP 0024's surface; reaching the point where it can
succeed is this document's). "Working" is LLP 0086 CC-1's definition:
schema, permissions, and function code all loaded, at least one generated
function invocation succeeding.

The gate additionally proves:

- both projections (MCP and HTTP) run the flow and return identical
  envelopes for the same operations;
- rollback: publish two artifact versions, activate the second, roll back
  to the first, and verify the anti-rollback refusal on a
  `deniedForActivation` version — all with structured results;
- an incompatible `code.push` (against the admitted schema) is refused with
  a structured admission diagnostic;
- `schema.push` against a locked app succeeds through the paved path while
  a dynamic schema change attempt from app code does not exist as a path
  (structural, per LLP 0037);
- the `.md` docs fetch check and the skills-package scenario above.

The hosted equivalent of this gate lands with LLP 0087 Phase 2 and is that
plan's to schedule, behind its prerequisites.

## Open questions

1. **Operation ids vs. LLP 0024 collisions.** `schema.push` and LLP 0024's
   `schema.load` are deliberately distinct (admission to a registry vs.
   loading into a running server), but the local implementation will likely
   implement one atop the other. Does the local target expose both ids, or
   does `schema.push` subsume `schema.load` locally? Decide at
   implementation start; the build issue
   (`issues/shelved/20260723-0086-cc1-provisioning-build.md`) carries it.
2. **Remote MCP authentication.** Instant's remote MCP uses OAuth. Snapback's
   equivalent needs an LLP 0011-shaped answer (service-principal issuance
   for agent harnesses, token TTL, revocation via LLP 0053's machinery
   where applicable) before the hosted MCP projection is public. Local
   trusted use can ride the existing admin credential.
3. **`deniedForActivation` authority.** Who may mark an artifact denied
   (vulnerability response) on shared hosted infrastructure — the app
   owner, the platform operator, or both — and how does that interact with
   LLP 0087's artifact-security workstream?
4. **App deletion/teardown.** `app.delete` is deliberately absent from v0
   (destructive, and the acceptance story for hosted data deletion is
   unowned). Does v0 need it for local hygiene, or does LLP 0024's
   `app.reset` suffice until a lifecycle v1?
5. **Registry of record for provenance on the local target.** Hosted
   provenance durability is pinned to LLP 0019 F8; locally, is the app
   registry's SQLite sufficient, or should provenance ride the LLP 0012
   artifact families so it survives resets?

## Status

Draft. Authored 2026-07-23 under LLP 0086 §CC-1 (spec half,
`issues/20260723-0086-cc1-llp0089-provisioning-spec.md`), by author
direction ahead of the LLP 0082 evidence review — CC-1 is
commitment-gated on that review per LLP 0086 governing constraint 2, and
this document drafting early does not waive the gate. The build half
(`issues/shelved/20260723-0086-cc1-provisioning-build.md`) stays blocked until
this spec passes review. Resolves LLP 0086 open question 4 (new owning
document; LLP 0024 unexpanded) and proposes the resolution to open
question 1 (one table, remote MCP projection first, platform HTTP API
second); both resolutions are ratified only when this document is.
