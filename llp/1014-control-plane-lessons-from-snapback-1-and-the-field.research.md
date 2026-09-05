# LLP 1014: What Snapback 1 and the field built as an administrative control plane

**Type:** Research
**Status:** Draft
**Systems:** Control plane, Hosted target, `deploy`/`rollback`/`secret`
(LLP 0329.016 §5.11), Tokens and credentials, Secrets, Environments and
previews, Release ledger and rollback, Backup and export, Metering, Admin
surface, MCP
**Author:** Claude Fable 5.1 (corpus + external-evidence synthesis),
commissioned by Charlie Cheever 2026-09-05 in session
**Date:** 2026-09-05
**Revised:** 2026-09-05 (initial synthesis)
**Related:** **LLP 1015** (the RFC this feeds), LLP 1000 (the root), LLP 1002
§1 (decision 6: `serve` mode; §5 the owner and its `/control/*` routes),
LLP 1003 (effects — where secrets are consumed), LLP 1005 and LLP 1008 (the
same shape of document, for assets and observability), LLP 1009 (Shelved),
LLP 1012 §13, LLP 0329.016 §2.2 (M7, M8), §2.4, §3.2, §5.9, §5.11, §9.9;
Snapback 1: LLP 0017, 0019, 0024, 0036, 0047, 0060, 0072, 0089, 0103, 0104,
0105, 0111, 0150, 0184, 0202, 0296; `guide/deploying/index.md`,
`guide/deploying/hosted-control.md`, `guide/operating/*`;
`rules/RULES.md`, `rules/NOT-DOING.md`

## Summary

"Control plane" is AWS's word for the administrative half of a service: the
APIs that create, read, update, delete, and list the resources — projects,
environments, releases, credentials, secrets, backups — as opposed to the data
plane that serves the traffic. Every backend-as-a-service in this survey has
one, and by 2026 they have converged on the same small shape. Snapback 1
designed the most careful control plane in the set and shipped none of it as a
product. Snapback 2 has three empty rows in its verb table (`deploy`,
`rollback`, `secret`) and an owner that already serves fourteen `/control/*`
routes over a loopback secret. This document is the evidence for filling those
rows without repeating Snapback 1.

Three findings:

1. **Snapback 1 built the control plane from the safety end inward and never
   reached the URL.** Twenty-four LLPs and about 21,500 lines specify targets,
   leases, fences, immutable releases, a ten-step activation, a control
   catalog, keypair-bound agent grants, and Expo-hosted metering. What shipped
   is a rich *local* operating surface (50 host-ops request spellings, an
   eleven-view admin console, forks with TTLs, a config store that never
   reads a value back) and a hosted lane in which all seventeen lifecycle
   verbs refuse by design. The guide's own deployment page opens: "Snapback
   does not currently offer an end-to-end path that deploys an arbitrary user
   application to any hosted target." Every provider in the field did the
   opposite: a URL first, then safety added under a working product.
2. **The field's object model is five things, and its surfaces are four.**
   Account → app → environment → release, plus credentials, with secrets as a
   write-only property of an environment; projected onto a dashboard, a CLI,
   an HTTP API, and — new in 2025–26 — an MCP server or skill. The 2026
   additions are specifically agent-era: account-less first deploy with a
   claim URL (Cloudflare, Neon, InstantDB, Convex), credentials scoped to the
   smallest object with a mandatory expiry (Neon, Convex, PlanetScale, Fly),
   and agent tools split by blast radius with a read-only default (Supabase,
   Turso, Convex).
3. **The single-binary products serve their admin surface from the app
   itself, and that is the shape Snapback 2 already has.** PocketBase's admin
   UI, Convex's self-hosted dashboard, and SpacetimeDB's `/v1/mcp` are all
   served by the thing being administered. The products with a *separate*
   dashboard service (Supabase Studio, Snapback 1's console) are the ones
   whose CLI and dashboard drift apart — the "click-only control" that LLP
   0184 spent 1,574 lines cataloging.

This is a Research document. It proposes no Snapback 2 surface and binds
nothing (`rules/RULES.md`: only implemented specs bind). §7 is the input to
LLP 1015, which decides.

## 1. Where the evidence is

| Source | What it measures |
| --- | --- |
| LLP 0072 (1,083 lines), 0184 (1,574), 0024 (957), 0017 (1,140), 0036 (1,010), 0089 (314), 0150 (1,124), 0103/0104/0105, 0111 (1,908), 0296 (763), 0217, 0272 (2,454) | Snapback 1's control-plane design, in the order it was written |
| `guide/deploying/index.md`, `hosted-control.md`, `releases.md`; `guide/operating/host-ops.md`, `admin-console.md`, `secrets-and-config.md`, `agent-controls.md`, `instance-forks.md`, `backup-and-copy.md`, `replication.md` | The paved form of what actually shipped (guide pages are the truth of the surface; LLPs are its history) |
| `crates/snapback-cli/src/cli.rs` (`HostCommand` and its nested enums); `guide/reference/diagnostics-registry.json` | Surface size: verbs and diagnostic codes by family |
| LLP 0202 (the 2026-08-08 nine-auditor surface audit); LLP 0329.016 §2.2 (M7 "publication lag, and no deploy", M8 "deployment-identity ceremony") | What the surface cost agents |
| 126 diaries under `diaries/`; 563 open and 2,160 closed tickets under `issues/` | Keyword incidence of control-plane concerns in real builds (over-inclusive; a keyword hit is not a friction event) |
| Public documentation of Heroku, Firebase, Supabase, Convex, InstantDB, PocketBase, PlanetScale, Neon, Turso, AWS (Amplify Gen 2 and the Well-Architected reliability pillar), Render, Fly.io, Cloudflare, Vercel, Railway, and the app builders (Lovable, Bolt, Replit, v0) | The field, verified against current pages on 2026-09-05; §10 lists the pages read |
| LLP 0329.016 §3.2 | The prior field survey, which this document extends rather than repeats |

Not measured here: time-to-URL on any provider (no provider was exercised);
prices beyond what the pages state; anything about Snapback 1's hosted
Cloudflare proof beyond the guide's own description of it as two closed proof
apps.

## 2. What a control plane is

AWS's definition is the useful one because it is operational, not
organizational: *control planes provide the administrative APIs used to
create, read and describe, update, delete, and list resources; data planes
handle day-to-day service traffic.* Two consequences follow and every mature
provider has learned both:

- **Static stability.** A control plane is optimized for consistency and is
  statistically more likely to fail than a data plane; the data plane must
  keep serving from its last-known state while the control plane is down.
  AWS's own reliability guidance (REL11-BP04) says to *avoid control-plane
  dependencies during recovery*. Concretely: a deployed app must not need the
  dashboard's backend to answer a query.
- **The control plane is where the credentials that matter live.** Whoever
  can deploy can run code; whoever can read secrets owns the integrations.
  The control plane's security model *is* its credential model.

The vocabulary the field has settled on, with each provider's spelling:

| Object | Heroku | Firebase | Supabase | Convex | Instant | PocketBase | PlanetScale | Neon | Fly | Cloudflare | Render |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| tenant | account | GCP project owner | organization | team | account | (none: one binary, one app) | organization | organization | organization | account | workspace |
| app | app | project | project | project | app | the instance | database | project | app | Worker | project + service |
| environment | app (per stage, grouped by pipeline) | (project per stage, by convention) | branch | deployment (prod, dev-per-member, preview) | (app per stage, by convention) | (instance) | branch | branch | app (per stage, by convention) | environment / version | environment |
| release | release (append-only ledger) | Hosting release; Functions revision | migration version | deploy (push) | push | migration | deploy request | (n/a: data, not code) | release (image) | version | deploy |
| credential | API key; OAuth | IAM principal; service account | PAT (expiring); OAuth; project API keys | deploy key (named permissions); deployment token (expiring) | admin token; platform OAuth token | superuser session | service token (fine-grained, TTL) | API key (account / org / project scoped) | macaroon token (org → app → command, expiring) | API token (scoped permissions) | API key; deploy hook |
| secret | config var | Secret Manager / functions params | vault secret; Edge Function secret | env var (per deployment) | (none: app secrets live in your host) | settings | (n/a) | (n/a) | secret (staged until deploy) | secret (`wrangler secret put`) | env var / env group |

What is *not* a control plane, and matters here because Snapback 2 already
has it: the app's own authentication and authorization. Supabase's RLS,
Firebase's rules, Instant's `perms`, and Snapback 2's rules govern app users.
The control plane governs operators. Snapback 1's LLP 0072 drew this line
correctly ("control-plane credentials never enter application bundles,
function arguments, client storage, database backups, application logs, or
app-level secret APIs") and it survives into this document unchanged.

## 3. What Snapback 1 built

### 3.1 The design, in the order it arrived

| LLP | Date | Owns | Lines |
| --- | --- | --- | ---: |
| 0017 admin console inspection surface | 06-26 | a browser console over a headless admin contract; 11 views | 1,140 |
| 0024 agent operating surface | 06-27 | one host-ops core projected through CLI, HTTP, MCP; one result envelope | 957 |
| 0036 app secrets and config | 07-02 | declared config entries; a per-app 0600 store; `status`/`set`/`unset`/`verify`/`plan`; no read-back | 1,010 |
| 0047 hosted execution limits | 07-07 | the bar a target must meet before it runs other people's code | 156 |
| 0060 hosted auth security | 07-13 | transport confidentiality, effective source, shared throttling, fenced invalidation | 1,302 |
| 0072 trusted single-tenant control plane | 07-20 | nine identities; targets; immutable releases; leases and fences; a 7-state serving machine and a 10-step activation; backup/restore drills; plan/apply CLI | 1,083 |
| 0089 agent provisioning surface | 07-23 | `app.create`, `schema.push`, `permissions.push`, `code.push`, `code.activate`, `schema.lockdown` — provisioning with no human in a browser | 314 |
| 0111 Fly completion and hosted ephemeral | 07-27 | finish the Fly Machines/Tigris driver; one ordinary product-journey receipt | 1,908 |
| 0103 / 0104 / 0105 Expo-hosted Snapback | 07-28 | Expo owns identity, billing, dashboard; Cloudflare owns the substrate (Workers for Platforms + Durable Object SQLite); meters and prices | 675 / 575 / — |
| 0150 agent token acquisition | 08-01 | keypair-bound grants; the human authenticates and vetoes; no bearer transits a person | 1,124 |
| 0184 agent-accessible control plane | 08-05 | `ControlCatalogV1`: every operation joined to intent, authority, projections, availability; "no accidental click-only controls" | 1,574 |
| 0202 agentic surface audit | 08-08 | nine auditors, ~107 findings, four P0 | — |
| 0296 provider-composable hosting profiles | 08-21 | ten interfaces × adapters × a conformance corpus per combination | 763 |
| 0272 verified provisioning writer lane | 08-16 | custody-sealed identity binding for provider-asserted identities | 2,454 |

Twenty-four control-plane LLPs total 21,474 lines. For scale, the entire
Snapback 2 corpus (LLPs 1000–1013) is under 6,000.

### 3.2 What shipped, on the local target

The paved form, from the guide pages rather than the LLPs:

- **Host operations** (`guide/operating/host-ops.md`): one `hostOpsResult`
  envelope; 50 served request spellings including `app.inspect`,
  `function.run`, `function.explain`, `data.patch.preview/apply`,
  `branch.*` (six operations), `asset.*` (ten), `auth.*` (nine),
  `telemetry.*`, `errors.*`, `debug.live.forceResync`, `host.stop`.
- **The admin console** (`guide/operating/admin-console.md`): a browser
  debugger over `/_snapback/api/*` with Overview, Health, Errors, Logs,
  Schema, Data, Functions, Secrets, Capabilities, Realtime, Diagnostics, and
  a Docs tab; launched by `snapback admin --ready-file`, which mints a derived
  `sbcc_` browser credential and never exposes the `sbat_` master token.
- **Secrets and config** (`guide/operating/secrets-and-config.md`):
  `defineConfig` declares names, purpose, required, pooled, a probe, and
  acquisition help; `status` reports what is declared, set, and verified and
  never a value; `set` is loopback-only and CLI-only ("MCP JSON-RPC has no
  defined equivalent of the process-scoped stdin/fd secret carrier"); values
  survive `app.reset` because "reset owns app data, not deployment custody."
- **The control catalog** (`guide/operating/agent-controls.md`): `snapback
  controls list --intent "table scan"` searches the catalog embedded in the
  binary; every row carries `surfaceAccess`, `operability`, availability by
  target and profile, and a guide anchor; a running server exposes the exact
  catalog it was compiled with plus an instance projection; "invocation
  admission is the authoritative check."
- **Forks** (`guide/operating/instance-forks.md`): `snapback fork create
  --from <ready-file> --ttl 2h` snapshots a store, rotates every identity,
  scrubs sessions and credentials, boots cron and jobs inert, applies
  deny-all egress, refuses boot after expiry, and admits against
  `--max-forks`/`--max-fork-bytes`/`--max-total-bytes` under a lock.
- **Backup** (`guide/operating/backup-and-copy.md`): "A Snapback store is not
  one file" — sixteen members in six dispositions; `snapback store describe`
  lists them; `store export` produces a directory that boots.
- **Replication** (`guide/operating/replication.md`): an experimental
  Litestream-style LTX lane to a file or S3 target, with the auth keyring
  encrypted separately and a *restorable frontier* that is the lesser of the
  replicated position and the keyring coverage.
- **Two MCP servers**: `snapback mcp` (docs, resource-only) and `snapback
  mcp-control` (the host-ops core as tools, read-only by default).
- **Release and target objects** (`guide/deploying/releases.md`): `snapback
  deploy build` produces a content-addressed, credential-scanned immutable
  closure; `snapback target add` registers a descriptor with a pinned driver
  digest and a credential *handle*; every release built has
  `activationEligible: false`.

The native CLI carries this on 38 verbs (LLP 0329.016 §5.11's count), the
top level of a `HostCommand` enum with nested families for `admin`,
`telemetry`, `errors`, `cron`, `ephemeral`, `connections`, `debug`, `data`,
`controls`, `remediation`, `config`, `jobs`, `network-profile`, `migrate`,
`auth`, `replicate`, `store`, `authority`, and `fork`. Thirteen diagnostic
families are control-plane families: `HOST` 112 codes, `ADMIN` 110, `FORK`
54, `DEPLOY` 37, `MCP` 37, `REPLICA` 35, `CONFIG` 33, `RELEASE` 27, `RESTORE`
15, `BACKUP` 8, `TARGET` 5, `FLY` 3, `CLOUDFLARE` 2 — 478 of the registry's
3,780, one code in eight.

### 3.3 What did not ship: the URL

`guide/deploying/index.md`, reviewed 2026-08-08, in its entirety on this
point:

> Snapback does not currently offer an end-to-end path that deploys an
> arbitrary user application to any hosted target. The local target runs an
> app for development and testing, the Fly control plane stops behind evidence
> and lifecycle gates, and the Cloudflare workflow deploys only two checked-in
> proof apps.

Its table of stopping points: every `deploy build` release is
activation-ineligible with blocking GAPs; ordinary `deploy plan` output cannot
be applied; the Cloudflare script deploys only the `notes` and `all-aboard`
proofs from a source checkout; and "every one of the 17 `snapback hosted
lifecycle` verbs returns `SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`." The
hosted-control page is explicit that this is not a missing executor: "The
current V2 carrier cannot express the operation-specific authority and
recovery facts required for safe effects," and lists five things that must
land before any verb is enabled, the last of which is "a packed live
Fly/Tigris journey covering reservation, interruption, recovery, head CAS, and
zero premature capability advertisement."

LLP 0329.016 recorded the cost as M7: agents run the published pin, fixes
sit unpublished, and "there is no deploy" — item 10 on its list of what not to
do again is simply "Shipping without deploy." Incidence in the diaries is
consistent with the surface being present and the product absent: of 126
diaries, 50 mention deploy and 43 mention hosted; 4 mention the admin
console; none mention `mcp-control`. Of 2,723 tickets, 454 match a
control-plane keyword (99 of the 563 open).

### 3.4 Why

Six causes, each visible in the documents themselves:

1. **Safety-end-first ordering.** LLP 0072's activation is ten steps under an
   external lease with a monotonic fence, an `ambiguous` operation state, and
   a rollback posture (`codeOnly` / `forwardFix` / `restoreRequired` /
   `generationRepublish` / `blocked`) that must be named before activation.
   All of it is correct for a bank. None of it was reachable by a user,
   because the first slice was the *complete* profile
   (`trusted-single-tenant-app-complete.v1`: TLS, auth semantics, immutable
   deploy, controlled rollback, backup and destructive-restore drill,
   redacted logs, authenticated inspection) rather than the first URL.
2. **Designed for a threat model the product did not have.** LLP 0047 and
   0060 set the bar for running *other people's* code at a public origin;
   LLP 0103 chose Workers for Platforms for "untrusted per-release handler
   code." The product was a single-tenant binary whose handlers the app
   author wrote. The gates protected against a tenant that did not exist.
3. **Surface multiplied by projection.** LLP 0024's rule — one core, three
   projections — became five (CLI, HTTP, MCP, `AdminClient`, console). The
   catalog of LLP 0184 exists to keep five projections honest; LLP 0202
   found within days that "two projections started lying" and that the
   catalog's intent columns "are structurally present and CI-gated for parity,
   but hollow."
4. **The target moved.** Fly `single-instance-container-vm.v1` (LLP 0072,
   0111) was the first complete journey; LLP 0103 then made Expo-hosted
   Cloudflare the product. The result is two half-adapters, a target-neutral
   lifecycle engine, and LLP 0296's proposal to compose *ten* provider
   interfaces — a generalization of something that had not yet worked once.
5. **The credential design reached the highest standard first.** LLP 0150's
   keypair-bound grants where "durable bearer authority secrets never transit
   the human — and in the preferred path never exist at all," LLP 0072's
   credential handles that reject URI userinfo, and LLP 0272's custody-sealed
   identity source are all defensible. Each was specified before a single
   token had been issued to a single agent for a single hosted app.
6. **Diagnostics with the cardinality of the implementation.** 478 codes in
   control families — more than PocketBase's whole API — is the local symptom
   of a global choice LLP 0329.016 §2.4 item 5 already rejects.

### 3.5 What is worth keeping

Stated as the ideas, not the artifacts:

- **One envelope for every operation** (LLP 0024): `ok`, `diagnostics[]`,
  `next[]`, the target it ran against. Snapback 2's refusal envelope already
  has the shape.
- **A config `status` that says what is missing and never a value** (LLP
  0036). The single best-liked piece of the whole surface, and the thing every
  provider's "environment variables" page lacks: *which* declared secrets are
  unset in *this* environment.
- **Personas never reach production** (LLP 1002 decision 6 already carries
  it forward).
- **Capability, availability, and projection are three axes** (LLP 0184
  finding 3). A verb can exist, be forbidden on this target, and be missing
  from MCP, independently. Snapback 2's answer should be fewer projections,
  not a catalog — but the axes are real.
- **Name the rollback posture before the deploy** (LLP 0072 §Migrations and
  rollback). "Rollback means switching code and traffic to a compatible
  earlier release; it does not silently rewind application data." The field
  is sloppier than this (§6 F5).
- **A store is not one file** (`backup-and-copy.md`). Snapback 2 has one
  SQLite file plus `owner.json` and `log.jsonl`; keeping it that way is the
  cheap version of this lesson.
- **Loopback-only value writes; values never in argv, logs, receipts, or
  MCP results** (LLP 0036, LLP 0184 §P3). Every provider agrees (§6 F4).
- **Forks with a TTL, resource admission, and scrubbed credentials** — the
  local preview environment done right, and the model for hosted previews.
- **The "click-only" audit question** (LLP 0184 finding 1): "No backend
  action is inherently browser-only, but some are practically click-only."
  The answer Snapback 2 can afford is to have no browser.

## 4. The field

One profile each. *Objects · surfaces · credentials · environments · release
and rollback · secrets · data operations · observability · metering ·
self-host · agent posture · the cautionary tale.* Verified against the
providers' pages on 2026-09-05; where a claim is older training knowledge
rather than a page read that day, it says so.

### 4.1 Heroku — the original

Heroku (2009) named most of the vocabulary. **Objects:** app; **config
vars** ("customizable configuration data that you can change independently of
your source code, exposed as environment variables"); **releases**, "an
append-only ledger of your app's build artifact and config vars" — a config
change is a release; `heroku rollback` returns to a prior release "without
re-compilation." Pipelines group apps by stage; **review apps** build per pull
request but "don't support inheriting config vars," the first instance of the
secrets-do-not-copy-to-previews rule. Add-ons are the marketplace shape every
later platform copied. **Surfaces:** dashboard, `heroku` CLI, Platform API.
**Cautionary tale:** the dyno-hour meter and the 2022 free-tier removal — a
platform that billed by process-time taught a generation to fear idle
servers, which is the demand scale-to-zero later served.

### 4.2 Firebase

**Objects:** a Firebase project *is* a Google Cloud project; IAM basic roles
(Owner, Editor, Viewer) plus Firebase-predefined roles; apps registered
under a project; environments by convention (one project per stage, the
launch checklist says so). **Surfaces:** the console; the `firebase` CLI
(`init`, `deploy`, `emulators:exec`, `projects:create`); the Management API;
the Firebase MCP server (GA October 2025) and an agent-skills catalogue
(early 2026); Firebase Studio, sunsetting 2027-03-22 with signups closed
2026-06-22. **Release and rollback:** Hosting keeps a release history with
rollback; Functions and rules are redeployed, not rolled back. **Secrets:**
Cloud Secret Manager via functions parameters. **Data operations:** the
console's data editors; Firestore point-in-time recovery and scheduled
backups on the Blaze plan, gated by `datastore.backupsAdmin`. **Metering:**
the console "automatically prompts you to set up a budget alert when you
upgrade to Blaze"; alerts are email, and stopping spend requires a separate
cap or a billing-disabling function — the docs page is titled "Avoid surprise
bills." **Agent posture:** LLP 0329.016 §3.2 already recorded the clean
`emulators:exec 'npm test'` primitive and MCP prompts that generate rules
*with unit tests*; the emulator does not enforce composite indexes, so green
locally can be red in production. **The tale:** App Check exists because the
public API key plus permissive rules was the default breach.

### 4.3 Supabase

**Objects:** organization → project (one Postgres, one region) → branches
(preview branches, "experimental and requires a paid plan"). **Surfaces:**
Studio (table editor and SQL editor with tabs, auth, storage, a logs explorer
with a unified view "coming soon," Security Advisors that run the open-source
Splinter linter and an Assistant that will "generate and apply RLS
policies"); the `supabase` CLI ("the first consumer of the new Management
API"); the Management API with personal access tokens "with a custom expiry"
and OAuth2 for integrations; the MCP server (pre-1.0, June 2026 docs) with
**project scoping** and **read-only mode** that "restricts execution to a
read-only Postgres user, which blocks INSERT, UPDATE, DELETE, and DDL at the
role level," plus account-level `create_project` / `pause_project` /
`restore_project` tools. **Credentials:** the `anon` / `service_role` keys are
being replaced by `sb_publishable_…` / `sb_secret_…` (deprecation "by the end
of 2026"); "the publishable key only opens the lobby, the secret key is the
master key that stays in your pocket." **Environments:** a branch is a
separate database, optionally cloned from production, with its own compute
size. **Release:** migrations pushed with `db push`; rollback is a new
migration. **Data operations:** daily backups on Pro, point-in-time recovery
as an add-on; free projects pause after inactivity and resume from the
dashboard. **Self-host:** Docker Compose; "self-hosted Supabase runs as a
single project, which means that Studio doesn't support multiple
organizations or projects." **Agent posture and the tale:** LLP 0329.016 §3.2
has the numbers — the only published tooling measurement (Opus baseline 58%
→ MCP-only 50% → MCP plus a workflow skill 67%), RLS `SELECT` returning `[]`
on denial, CVE-2025-48757 across 170+ Lovable apps, and the July-2025
prompt-injection incident whose fix was "a read-only Postgres role below the
model, where an injected prompt cannot reach." The control-plane lesson is
that the read-only guarantee had to be moved *out* of the tool description
and *into* a database role, i.e., into the data plane's authorization.

### 4.4 Convex

**Objects:** team → project → deployments: "every project has one shared
production deployment and one development deployment per team member," plus
preview deployments on paid plans. **Surfaces:** the dashboard (Data browser,
Functions with a runner — `Ctrl+`` ` — Logs, Health with query insights,
Schedules, Settings with environment variables, deploy keys, backups); the
CLI (`npx convex dev`, `deploy`, `run`, `logs`, `env`, `export`, `import`,
`deployment create|token`); the MCP server whose `runOneoffQuery` is sandboxed
read-only; Chef. **Credentials:** deploy keys "identify a deployment, project,
or team; confer permission to take certain actions with those resources; and
can change the behavior of the convex CLI" — created in the dashboard with a
name and *named permissions* (`deployment:deploy` for CI), or minted and
revoked with `npx convex deployment token` including `--expiration "in 5
days"` and `--save-env`. A preview deploy key set as `CONVEX_DEPLOY_KEY` makes
`npx convex deploy` in CI create a preview named after the git branch.
**Agent mode:** "`npx convex` will never prompt the agent to log in"; with no
key it provisions an anonymous local deployment. **Release and rollback:**
`deploy` pushes functions and validates the schema against live data; there
is no code rollback verb (redeploy the previous commit); **backups** are
scheduled per deployment and restorable, and **snapshot export** produces a
ZIP that `npx convex import` re-imports — the docs' stated workflows are
"store a backup of your deployment's data, and restore from this backup at a
later date," and "populate a dev deployment with data from a prod
deployment." **Secrets:** environment variables per deployment, with defaults
set at the project level. **Self-host:** `docker compose up`, an admin key
generated inside the container, "most features of the cloud product,
including the dashboard and CLI." **The tale:** the local backend's
most-commented issue is a startup failure with no diagnostics (LLP 0329.016
§3.2), and the dashboard-served insight that a team can be missing is the
one about *cost* — Convex's Health page tells you a query is slow, not that
it is expensive.

### 4.5 InstantDB

**Objects:** account → app; no environment object (a second app is your
staging); team members per app. **Surfaces:** the dashboard (explorer for
data, schema, perms, auth, a sandbox); the CLI (`instant-cli init`, `push
schema`, `push perms`, `pull`, `query --as-email | --as-guest`); a remote
MCP server; the **Platform API** with **Platform OAuth** (scopes `apps-read`
and `apps-write`) so "end-users provide their own Instant accounts and give
permissions to manage apps on their behalf," and `PlatformApi.createApp`
that creates an app with schema and permissions in one call. **Credentials:**
an admin token per app scopes the CLI "to change schema and perms just on
that app." **Temporary apps:** "an Instant app that deletes itself in 2
weeks … you don't need to authenticate to create temporary apps." **Release:**
`push schema` "evaluates your schema, compares it with production, and
migrates your data model"; renames need `--rename`. **Secrets:** none — Instant
has no server-side code of yours, so nothing to hold a secret for.
**Self-host:** no local backend (LLP 0329.016 §3.2). **The tale:** Instant is
the competitor whose control plane is closest to what an agent wants —
create an app without a human, push two files, query as anyone — and it
achieves it by having the least to administer. Its costs are the mirror:
untyped allow-all-by-default rules, no error schema, and nowhere to put a
webhook secret.

### 4.6 PocketBase

**Objects:** one ~12 MB Go binary = one app = one `pb_data/` directory
(`data.db`, `auxiliary.db` for logs and migrations, `storage/`, `backups/`,
`pb_hooks/`, `pb_migrations/`). **Surfaces:** the admin UI at `/_/`, "blocked
until a superuser exists" (v0.36+), for collections, records, logs, settings
(SMTP, S3, backups), and API rules; the CLI (`serve`, `superuser create`,
`migrate`); the REST and realtime APIs. **Credentials:** superusers; per-record
API rules for app users. **Environments:** none in the product — a second
instance. **Release:** JS migrations in `pb_migrations/` generated by editing
collections in the UI (schema flows UI → files), hooks in `pb_hooks/` on the
Goja runtime. **Data operations:** backups are ZIPs of the whole `pb_data/`,
manual or cron, to local disk or S3; restore is a UI action. **Scaling and
tenancy:** "multi-tenant with multiple separate databases for each tenant is
not planned, as it will complicate the API"; "if you have different
non-related applications, it's better to keep them separate." **The tale:**
PocketBase is the proof that the control plane can be *inside* the app and
that the local loop can *be* production ("the model spent its effort on
product code, not backend wiring," Diary 0114; fastest to green in every
matrix). It is also the proof that a UI-first control plane fights agents:
schema flows UI → files, and the FAQ says "please do NOT use PocketBase" with
AI-only tooling.

### 4.7 PlanetScale

**Objects:** organization → database → branches (development and
production, the latter with **safe migrations** on) → **deploy requests**.
**Surfaces:** the dashboard; `pscale` (`branch switch --create`,
`deploy-request create|deploy|revert`, `service-token create|add-access`);
the API; Insights (query statistics, slow queries, plans); Prometheus and
pganalyze log integrations for the Postgres product (GA October 2025).
**Credentials:** service tokens with per-database accesses from a closed list
(`read_branch`, `create_deploy_request`, `approve_deploy_request`,
`connect_branch`, `write_database`, …), **names** (2026), **expiry** (2026:
"the token automatically stops once that date is reached"), and API endpoints
to manage them. Branch passwords are the data-plane credential, minted per
branch. **Release and rollback:** a deploy request is a schema diff reviewed
like a pull request, deployed online, and **revertible for a window after
deploy** (thirty minutes, from training knowledge) — the only design in this
survey in which a schema change has an explicit, bounded undo. **Data
operations:** automatic daily backups plus scheduled ones; restore creates a
branch. **The tale:** "Building PlanetScale with PlanetScale" — the control
plane runs on the product, which is the dogfooding posture LLP 1015 adopts.
The other tale is commercial: the 2024 free-tier removal, since partly
reversed, showed that a control plane whose unit is a *database cluster*
cannot price a hobby app.

### 4.8 Neon

**Objects:** organization → project → branches (copy-on-write, a root plus
children) → computes (scale to zero). **Surfaces:** console; `neon` CLI
(`api-keys` at "account, organization, and project scope"); the REST API;
the MCP server with OAuth, a **scope-selection UI** in the authorization
flow, and a read-only mode; the `neondatabase/agent-skills` repository.
**Credentials:** "project-scoped API keys … cannot create projects, mint more
keys, or see any other project, making them safe for agents or CI jobs."
**Claimable Postgres:** "an instant Postgres database with a single API call
with no account required; your database expires after 72 hours unless you
claim it" — the response carries a `claim_url` at `neon.new/claim/…`.
**Rollback:** branch restore and Time Travel; a branch per checkpoint is how
Replit restores an app "without changing the connection string." **The
tale:** "over 80% of databases … created by AI agents" — the control plane's
customer is now a program, and Neon reshaped keys, TTLs, and the claim flow
around that fact before anyone else.

### 4.9 Turso

**Objects:** organization → group → database (one SQLite file each, "millions
of small, file-based databases"), branches, point-in-time recovery.
**Surfaces:** the Platform API "built for platforms that want to integrate
with Turso to provide their users a serverless SQLite database … a
database-per-user architecture or a platform/reseller that provisions
databases on behalf of end users"; the CLI; MCP servers with a two-level
authentication split (organization operations vs per-database access) and
tools split by blast radius (`read_database`, `write_database` refusing
`DELETE`/`DROP`, `delete_from_database`, `evolve_schema` — LLP 0329.016
§3.2). **Credentials:** tokens per database with read-only and expiry
options; "unscoped tokens are rejected." **The tale:** Turso is the closest
substrate to Snapback 2's data plane (a SQLite file per app) and shows that
the per-app unit makes the control plane *simpler*: create, token, branch,
restore, delete, and nothing about connection pools.

### 4.10 AWS — the reference, and Amplify Gen 2

AWS is where the vocabulary comes from and the heavy end of the spectrum.
**Objects:** account (the isolation and billing unit; Organizations above
it) → resources; **IAM** principals and policies; **CloudFormation/CDK** as
declared state; **CloudTrail** as the audit ledger of every control-plane
call; Budgets for alerts. **Amplify Gen 2** (GA 2024) is the app-builder
projection: `npx ampx sandbox` creates "a CloudFormation stack named
`amplify-<app>-<whoami>-sandbox` in your AWS account" and hot-swaps changes
as you edit; `ampx pipeline-deploy` and Amplify Hosting **branch
deployments** map git branches to backends; secrets are set with `ampx
sandbox secret set` into SSM. **The tale:** every per-developer sandbox is a
full stack of real resources, deploys take minutes, and Gen 1 was rewritten
because its CLI-generated CloudFormation was unmaintainable. The floor AWS
sets — identity, declared state, audit — is the enterprise floor; the agent
drowns in it. The Well-Architected rule from §2 is the durable contribution.

### 4.11 Render

**Objects:** workspace → project → environment → services (web, worker,
cron, Postgres, Redis); **Blueprints** — "every Render Blueprint is backed by
a YAML file that defines a set of interconnected services, databases, and
environment groups" at the repository root — with `previews.generation:
manual | automatic` so that "Render keeps preview environments up to date on
every commit and destroys them when the pull request is merged or closed."
**Surfaces:** dashboard, `render` CLI, REST API, and an official MCP server
with toolsets (services, logs, metrics: CPU, memory, latency, instance
count) so that "AI assistants can read your deploy logs, check service
metrics, and help diagnose failures." **Credentials:** API keys; deploy
hooks are secret URLs ("regenerate it if exposed"). **Secrets:** env groups
"scoped to a project environment or shared across the workspace";
environment isolation on Professional plans. **Release and rollback:**
zero-downtime deploys with health checks; a failed deploy keeps the old
instance; rollback to a previous deploy from the dashboard or API. **The
tale:** the Blueprint is the control plane *as a file in the repository* —
declared, reviewed, and reproducible — which is the right custody for
everything that is not a secret.

### 4.12 Fly.io

**Objects:** organization → app → Machines (Firecracker VMs, created in
seconds by the Machines API) + volumes; releases per app. **Surfaces:**
`fly` (`launch`, `deploy`, `secrets set`, `logs`, `scale`, `releases`,
`tokens create`), the Machines REST API, the dashboard; **Sprites** (January
2026): "persistent Linux VMs that create in 1–2 seconds and
checkpoint/restore instantly, with object-storage-backed persistence," and
since March 2026 an MCP through which "agents can authenticate to a Fly.io
org, create machines, exec commands, checkpoint, and destroy everything."
**Credentials:** macaroons — "predefined scopes to reduce access from
org-wide all the way down to running a specific command on a single app's
Machines"; `fly tokens deploy` mints a token "capable of managing the
application in your current directory." **Secrets:** `fly secrets set` stages
values that apply at the next deploy. **Data operations:** volume snapshots;
LiteFS/Litestream for SQLite. **The tale:** Snapback 1 chose Fly Machines for
its first complete journey (LLP 0111) and retained "some Fly observation,
backup primitive, supervisor, and custody evidence" without ever serving an
app; the substrate was never the problem.

### 4.13 Cloudflare

**Objects:** account → Workers (versions, gradual deployments, rollback) with
bindings (KV, D1, Durable Objects, R2, Queues); **Workers for Platforms**:
"a dispatch namespace is a container that holds all of your customers'
Workers … each user Worker runs in untrusted mode," with per-customer CPU
and subrequest limits and a Tail Worker that collects logs for every user
Worker. **Surfaces:** dashboard, `wrangler` (`deploy`, `dev`, `secret put`,
`tail`, `versions`, `rollback`, `types --check`), the API, docs as Markdown
via `Accept: text/markdown`. **Credentials:** API tokens with scoped
permissions from per-product templates. **Temporary Accounts** (2026-06-19,
Agents Week): `wrangler deploy --temporary` "provisions a temporary account,
issues a short-lived API token, and returns a live Worker URL plus a claim
URL"; the deployment "stays live for 60 minutes"; a proof-of-work challenge
limits abuse; Workers, static assets, KV, D1, Durable Objects, Hyperdrive,
Queues, and certificates are supported; since 2026-07-14 platforms can create
temporary accounts via the API "while keeping users in their onboarding
flow." **Data operations:** D1 and Durable Object SQLite carry thirty-day
point-in-time recovery. **The tale:** LLP 0329.016 §3.2's $34,895 in eight
days with zero users from a `setAlarm()` loop across preview deployments,
"because alerts watched CPU time while row reads exploded" — the argument for
caps that refuse rather than meters that bill.

### 4.14 Vercel and Railway

**Vercel:** team → project → deployments (production, and a preview per git
branch) → environment variables per environment, with a *sensitive* flag
that makes a value write-only after creation; account tokens with expiry;
CLI, REST API, and an MCP server; instant rollback by promoting a previous
deployment; v0 provisions its databases through Neon's claimable flow.
**Railway:** workspace → project → environments (including pull-request
environments) → services with volumes; a GraphQL API, CLI, and an MCP server
that covers "project management, service deployment, environment variable
configuration, deployment monitoring and logs, volume management, and
database provisioning"; env-var references across services; rollback to a
previous deployment. Both are the shape of §2 with nothing surprising, which
is the point: the shape is settled.

### 4.15 The app builders

Lovable, Bolt, Replit, and v0 "all abandoned 'connect your own backend' for
a bundled one" (LLP 0329.016 §3.2). The 2026 portability scorecards read the
same way: Lovable Cloud "ships a managed Postgres backend, auth, file storage,
and edge functions, but the backend is bolted on through managed Supabase";
connecting your own Supabase project gives "a full PostgreSQL database in an
account you control, so standard dumps work"; whereas Replit's "auth,
database, hosting, and rollback features are tied to Replit's
infrastructure, and migrating out means rebuilding the infrastructure layer
from scratch." Replit's Agent 4 (March 2026) "supports checkpoint-based
rollback" over a Neon branch per checkpoint; Bolt's version history "does not
support database restores." In every builder the human types the secret into
a form and it is "not read back."

## 5. The comparison matrix

| | Snapback 1 (shipped) | Heroku | Firebase | Supabase | Convex | Instant | PocketBase | PlanetScale | Neon | Turso | AWS Amplify | Render | Fly | Cloudflare |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Object depth (tenant→leaf) | 9 identities (LLP 0072) | 2 | 3 | 3 | 3 | 2 | 1 | 3 | 4 | 3 | 4+ | 4 | 3 | 3 |
| Dashboard | yes (local only) | yes | yes | yes | yes | yes | yes, served by the app | yes | yes | yes | yes | yes | yes | yes |
| CLI | 38 native + 23 packaged verbs | yes | yes | yes | yes | yes | minimal | yes | yes | yes | yes | yes | yes | yes |
| HTTP API | host-ops, admin | yes | yes | Management API | limited | Platform API | REST | yes | yes | Platform API | yes | yes | Machines API | yes |
| MCP / skill | 2 servers (local) | — | GA 2025 + skills | yes, scoped + read-only role | yes | yes | — | — | yes, OAuth scopes | yes, split by blast radius | — | official | Sprites MCP | — |
| Account-less first deploy | no | no | no | no | anonymous local only | temp app, 2 weeks | n/a (self-host) | no | claimable, 72 h | no | no | no | no | temporary, 60 min |
| Credential scope + expiry | master token; keypair grants (designed) | key | IAM | PAT w/ expiry; project scoping | named permissions; token expiry | per-app admin token | superuser | fine-grained + TTL | account/org/project + expiry | per-db, read-only, expiry | IAM | key | macaroon to one command; expiry | scoped token |
| Previews / branches | local forks w/ TTL | review apps | no | branches (paid) | previews (paid) | temp apps | no | branches | branches | branches | sandbox per dev | previews per PR | no | versions |
| Rollback includes data | designed (`restoreRequired`) | no | Firestore PITR | PITR add-on | backups restore | no | backup zip restore | schema revert window; backup → branch | branch restore | PITR | no | no | volume snapshot | DO/D1 PITR 30 d |
| Secrets write-only | yes (loopback set; no read-back) | no (readable) | Secret Manager | vault | readable in dashboard | n/a | settings | n/a | n/a | n/a | SSM | readable | write-only | write-only |
| Export always works | `store export` | yes | export tools | `pg_dump` | snapshot zip | export | `pb_data` zip | dump | dump | dump | per resource | dump | volume | limited |
| Caps, not bills | forks: byte/count admission | no | budget alerts | pause on free | plan limits | plan limits | n/a | plan limits | TTL + size on claimable | plan limits | budgets | plan limits | no | no |
| Admin surface served by the app | yes (local) | no | no | no | self-hosted: yes | no | **yes** | no | no | no | no | no | no | no |
| Self-host is the same bits | yes | no | emulator | Docker, single project | Docker, with dashboard | no | **it is the product** | no | no | open-source engine | no | no | no | no |

## 6. Findings

**F1 — The object model is five things.** Every provider that has been
through a rewrite (Amplify Gen 2, Supabase's key rename, Convex's deploy
keys) has moved *toward* fewer objects: tenant, app, environment, release,
credential, with secrets as a write-only property of an environment. Snapback
1's nine identities (LLP 0072) and ten hosting interfaces (LLP 0296) were the
outliers. PocketBase and Turso show the SQLite-per-app unit collapses the
model further: an environment *is* a file.

**F2 — The URL comes first.** Heroku had `git push heroku` before it had
pipelines; Fly had `fly launch` before macaroons; Cloudflare shipped
Temporary Accounts *before* the platform API for them. Every provider added
safety under a product that already served traffic. Snapback 1 specified the
complete profile as the first slice and the first slice never landed (§3.4
cause 1). The field's order is not carelessness; it is how you learn which
safety you need.

**F3 — Credentials are the control plane's real security model.** The 2026
convergence is exact: one credential kind, scoped to the smallest useful
object (a deployment, a project, a database, a command), with a mandatory or
default expiry, mintable and revocable from the CLI without a dashboard
(Convex `deployment token create --expiration`, Neon project-scoped keys,
PlanetScale service-token TTL, Fly `tokens deploy`). LLP 0150's keypair-bound
grants are stronger than any of these and were never used; the field's
weaker shape was.

**F4 — Secrets are write-only, everywhere that matters.** Vercel's sensitive
flag, Fly's staged secrets, Cloudflare's `secret put`, Supabase's vault,
Snapback 1's no-read-back store, and every app builder's "not read back"
form agree. The only variance is *where the value transits*: stdin or a
TTY (Snapback 1, Fly), a dashboard form (the builders), or an env var in
CI. None lets an MCP tool carry a value in, which is LLP 0184 §P3's ruling
restated by the market.

**F5 — Rollback that includes data is what agents need, and only
cheap-snapshot systems deliver it.** Neon's branch-per-checkpoint (Replit),
PlanetScale's revert window, Convex's restorable backups, and DO/D1's
thirty-day recovery all give a checkpoint you can return to; Bolt, Heroku,
Render, and Fly roll back *code* and leave the data where it is, which is the
posture LLP 0072 named `codeOnly` and correctly refused to conflate with a
rewind. A SQLite-per-app data plane makes the snapshot nearly free
(`sqlite3 .backup`; Snapback 2 already has `fork`), so Snapback 2 can afford
the strong form — with the write-loss accounting LLP 0072 insisted on.

**F6 — Static stability is a rule, not a preference.** AWS states it
(REL11-BP04); Supabase's project pausing and Convex's self-hosted backend show
apps that serve with the control plane unreachable; Snapback 1's hosted
design put a lease-holding supervisor *in the activation path* of every
effect. A deployed Snapback 2 app must answer queries, accept mutations, and
run effects with no control plane reachable; only create, claim, and re-issue
may need one.

**F7 — The admin surface should be served by the app itself.** The products
whose dashboard and CLI stay honest with each other are the ones where there
is no separate dashboard service to drift: PocketBase (`/_/` from the same
binary), Convex self-hosted (the dashboard container talks to the backend's
own admin API), SpacetimeDB (the host serves `/v1/mcp`). The products with a
separate control-plane service (Supabase Studio, Snapback 1's console over
`/_snapback/api/*` with its own `AdminClient`) are the ones that needed a
catalog to prove nothing was click-only, and the catalog drifted within days
(LLP 0202). Snapback 2's owner already serves `/control/status`, `apply`,
`migrate`, `reset`, `fork`, `logs`, `personas`, `persona`, `why`, `trace`,
`subscriptions`, `clock`, `data`, `verdicts`, and `stop` behind a loopback
secret in `.snapback/owner.json` (`crates/snapback2/src/control.rs`). The
control plane for a hosted app is the same table reached with a token.

**F8 — 2026's agent-era moves are three, and all are cheap.** (a)
*Account-less first deploy with a claim URL*: Cloudflare (60 min), Neon
(72 h, 100 MB), Instant (2 weeks), Convex (anonymous local). The human's
first action is to claim something that already works. (b) *Least-object
credentials* (F3). (c) *Agent tools split by blast radius with a read-only
default*, enforced below the model: Supabase's read-only Postgres role,
Turso's four tools, Convex's sandboxed `runOneoffQuery`, Neon's read-only
mode. A fourth is a discipline rather than a feature: Supabase measured its
own MCP and found it made the strongest model worse until a workflow skill
was added.

**F9 — Metering with caps, not bills.** Cloudflare's $34,895 (alarms across
previews), Firebase's "avoid surprise bills" page, Heroku's dyno-hours, and
Neon's TTL-and-size caps on claimable databases are the same lesson from
both sides. A preview that expires and a store that refuses past a byte cap
are control-plane features; a budget alert is an apology. LLP 0329.016 §5.9
already says "per-environment read/write/egress caps with a refusal, not a
bill."

**F10 — Export is a trust feature.** The 2026 portability scorecards rank
builders by whether a standard dump works; Convex's snapshot ZIP round-trips
through `import`; PocketBase's backup is the whole directory; Snapback 1's
`store export` produces a directory that boots. LLP 0329.016 §5.9: "the
migration path *out* is a trust feature (Lovable Cloud's lack of one is a
cautionary tale)."

**F11 — What nobody has solved.** (a) *The human's view and the agent's view
are different objects*: a dashboard and a CLI that expose different
operations, reconciled by hand or by a catalog. (b) *Schema-change safety at
the control plane*: only PlanetScale treats a schema change as a reviewed,
revertible object; everyone else pushes a migration and hopes. Snapback 2's
`check` certificate and successor plans are already stronger than the
field, and `deploy` should carry them rather than re-invent them. (c)
*Observability bound to the program*: LLP 1008's finding; the control plane's
"logs" tab is the same collect-everything surface everywhere. (d) *Who is the
operator of an agent-built app?* Every provider assumes a human at a
dashboard with a credit card; the claim flows of F8 are the first products
to admit that the operator may arrive *after* the app exists.

## 7. What this means for Snapback 2 — inputs to LLP 1015

Numbered so the RFC can cite them.

1. **The owner is the control plane.** Widen the existing `/control/*` table
   to accept a token in `serve` mode; do not build a second service that
   projects it (F7; §3.4 cause 3).
2. **Five objects: app, environment, release, snapshot, token; secrets as a
   write-only property of an environment** (F1, F4). No target registry, no
   profile ids, no adapter contract, no catalog.
3. **The URL is the first slice** (F2). `deploy` returns a URL before it
   returns a receipt; safety lands under a working verb, in the measured
   loop.
4. **Account-less first deploy with a claim URL; TTL and size caps bound it**
   (F8a, F9). Three providers shipped it in 2026; it is table stakes for the
   agent's first hour.
5. **One credential kind, scoped `{app, environment, capability}`, with a
   required expiry, mintable from the CLI** (F3). Three capability levels
   are enough: read, deploy, admin. Keypair-bound grants (LLP 0150) are the
   v2 direction, not the v1 requirement.
6. **Rollback includes data by default, with loud write-loss accounting**
   (F5; LLP 0072's `restoreRequired`). Snapshot at every deploy; `rollback`
   refuses when commits have landed since the snapshot unless the count is
   named.
7. **Static stability is a test** (F6): an app serves, mutates, and runs
   effects with the registry unreachable; `deploy`, `rollback`, and `secret`
   work against the owner directly once a binding and a token exist.
8. **Secrets: name-level, declared by effects, checked at `check`, verified
   at `deploy`** (F4; LLP 0036's `status` primitive). `deploy` refuses when a
   required declared secret is unset in the target environment, naming it.
9. **No browser console** (F7; §3.3: 4 of 126 diaries). The verbs are the
   console; a human who wants to look runs `data --env production --json`.
10. **MCP after the verbs, from the same table, read tools by default,
    write tools split by blast radius** (F8c; LLP 0329.016 §5.10).
11. **Export by deploying to a directory** (F10): the local directory is the
    zeroth target; `init --from` re-imports. The verb table stays at fifteen.
12. **One hosted target, chosen once** (§3.4 cause 4). The RFC should
    recommend and the author should rule; the contract must not be
    target-neutral until a second target exists.
13. **Build the control plane on Snapback 2** (§4.7's "Building PlanetScale
    with PlanetScale"). The registry that mints apps and claim URLs is a
    Snapback 2 app with tables, rules, and effects; it is the first production
    Snapback 2 program and it exercises LLP 1003 for real.
14. **Keep Snapback 1's honest vocabulary** (§3.5): `codeOnly` vs a data
    rewind; declared-but-unset; capability vs availability vs projection;
    values never in argv, logs, receipts, or `--json`.

## 8. Confidence

- **High:** the Snapback 1 findings (§3), which are read from the corpus and
  the guide and counted from the tree on 2026-09-05; the object-model
  convergence (F1); write-only secrets (F4); static stability (F6); the
  2026 claim flows and credential scoping (F3, F8), which are dated
  changelog entries and product pages read that day.
- **Medium:** the causal reading in §3.4 — six causes are named from the
  documents' own text, but no one on the Snapback 1 program has confirmed
  them; the matrix cells marked from training knowledge (PlanetScale's
  revert window; Fly's snapshot cadence; which plans gate previews).
- **Low:** anything about *time-to-URL* on any provider — nothing was
  exercised; and the diary/ticket keyword counts, which are over-inclusive
  and bound the incidence from above only.

## 9. Non-claims

This document does not propose a Snapback 2 verb, route, object, or file;
LLP 1015 does. It does not choose a hosted provider. It does not change any
Snapback 1 status, nor does it say Snapback 1's control-plane design was wrong
for the product it described — it says that product was never the one being
built. It does not measure any provider's control plane; it reads their
documentation. It does not move anything on or off `rules/NOT-DOING.md`.

## 10. Pages read on 2026-09-05

Supabase: Management API introduction and access-control pages; MCP server
docs; API keys and the publishable/secret migration guide; self-hosting with
Docker; the 2025 security retrospective. Convex: projects, multiple
deployments, deploy key types, `npx convex deploy`, environment variables,
dashboard deployment settings, backup and restore, snapshot export, the
self-hosted README. InstantDB: Platform API, Platform OAuth, CLI, workflow.
PocketBase: docs index, FAQ, discussions #738 and #1673, issue #5005.
PlanetScale: deploy requests, service tokens, the 2026 changelog entries on
token TTL, token names, token API endpoints, and pganalyze log insights.
Neon: Claimable Postgres and its integration guide, API keys, the 2026
changelog entries (January through August), the agent-skills repository.
Turso: platform API, what-is-Turso. AWS: Well-Architected REL11-BP04, the
fault-isolation-boundaries static-stability page, ARC's control- and
data-plane page; Amplify Gen 2 sandbox setup and features, concepts. Render:
Blueprint YAML reference, preview environments, the projects-and-environments
changelog, MCP server docs, "How Render handles deploy failures." Fly.io:
Machines API overview, access tokens, Sprites coverage (January and August
2026). Cloudflare: the Temporary Accounts blog post and changelog
(2026-06-19 and 2026-07-14), claim-deployments docs, Workers for Platforms
overview, how-it-works, observability, and limits. Heroku: how Heroku works,
releases, config vars, review apps. Firebase: launch checklist, avoid
surprise bills, Firestore backups and IAM, the MCP server page, CLI release
notes. App builders: the 2026 portability scorecard and comparison pages
cited in §4.15.
