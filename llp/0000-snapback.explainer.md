# LLP 0000: Snapback

**Type:** Explainer
**Status:** Active
**Systems:** Project
**Role:** Root
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-06-27
**Related:** LLP 0001, LLP 0002, LLP 0003, LLP 0004, LLP 0005, LLP 0006, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, LLP 0013, LLP 0014, LLP 0015, LLP 0016, LLP 0017, LLP 0018, LLP 0022, LLP 0024, https://github.com/ccheever/ibex, https://github.com/expo/valet, https://github.com/ccheever/llp

## Summary

Snapback is a complete backend for application projects. It is designed to
**scale to zero** — to be so light that an idle app costs almost nothing and
needs no babysitting, letting you prototype without worry — while being built so
the same system can **scale up** to the workload of any realistically popular
production app.

It is **comprehensive and coherent**: it aims to give you everything a backend
needs under one roof, with the pieces designed to work together rather than
bolted on, a bit like Ruby on Rails. And it is **truly open** — MIT licensed,
with no source-available restrictions that would stop you from hosting it for
other people.

This document is the root of the Snapback LLP corpus. It captures the project's
intent, its subsystem boundaries, and the non-obvious constraints that every
follow-on design and every line of code is expected to respect. It reflects the
founder's stated direction for the project as of the date above. Treat the
direction here as active; treat subsystem details as boundary-level guidance
until follow-on LLPs turn them into implementation specs.

## Source and ratification

This document is based on Charlie Cheever's Snapback project brief from
2026-06-25 and the same-day review/revision pass over the README and LLP corpus.
Charlie is the ratifying source for the product direction captured here. Future
LLPs should preserve this distinction: this root document states the current
direction, while subsystem LLPs define the specific contracts agents implement.

A cross-family review of this document (Claude / Anthropic) was recorded under
[`llp/reviews/0000-snapback.claude.md`](./reviews/0000-snapback.claude.md) on
2026-06-25. Editorial clarifications from it have been applied to sharpen wording
and surface gaps; they do not change the ratified product direction, which
remains Charlie's to set.

## Ratification ledger

This ledger records ratified decisions that cut across multiple LLPs, so the
corpus does not rely on scattered "pending Charlie" notes.

- **2026-06-25:** the root Snapback product direction in this document is
  Active.
- **2026-06-26:** the canonical first dev/test target is the full local server
  on Ibex + SQLite, as recorded in [LLP 0002](./0002-canonical-local-target.decision.md).
- **2026-06-26:** the first implementation slice is the narrow local proof
  captured in [LLP 0010](./0010-agent-dx-and-acceptance.spec.md) §V0
  Implementation Charter.
- **2026-06-26:** the first-slice execution/write boundary is accepted:
  poll-driven async handler completion, buffered `ctx.db`, snapshot reads,
  single-version commit, and commit-time read-set validation
  ([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution
  and Write Semantics; [LLP 0009](./0009-code-execution-security.rfc.md)
  §Runtime Boundary).
- **2026-06-26:** the first-slice app API decisions and v0 artifact schemas are
  accepted as implementation pins, with broader storage, sync, auth, and
  integration questions still Draft ([LLP 0004](./0004-application-data-api.rfc.md),
  [LLP 0012](./0012-headless-integration-contract.spec.md)).
- **2026-06-26:** Cloudflare remains the planned second target, but only through
  a dedicated strategy and prototype, not as an assumed port of the local core
  ([LLP 0014](./0014-cloudflare-strategy.rfc.md)).

## Who Snapback is for

Snapback is for people building real applications who want a backend that gets
out of the way at the prototype stage and stays with them into production.

The first-class product context is Contract/Exact app development, especially
mobile apps. React and Expo are important secondary consumers, but they should
not drive core design when their needs conflict with Contract/Exact.

The canonical Exact-side references are the Exact repository's
[`README.md`](../../exact/README.md) and [`AGENTS.md`](../../exact/AGENTS.md),
plus the Exact LLPs that define Contract, Contract's default-authoring policy,
and Design Mode: [Exact 0216](../../exact/llp/0216-contract-explained.explainer.md),
[Exact 0160](../../exact/llp/0160-contract-by-default.rfc.md),
[Exact 0158](../../exact/llp/0158-design-mode.rfc.md), and
[Exact 0200](../../exact/llp/0200-contract-design-mode-authoring-platform.rfc.md).
For Snapback-specific Contract data binding context, see [Exact 0263](../../exact/llp/0263-contract-data-bindings-for-snapback-and-backends.rfc.md)
and [Exact 0265](../../exact/llp/0265-contract-snapback-data-authoring-ergonomics.rfc.md).
Snapback should cite those sources rather than redefining Contract/Exact. The
known Snapback-side integration boundary is drafted in
[LLP 0005](./0005-contract-exact-react-integration.explainer.md) and specified
in [LLP 0012](./0012-headless-integration-contract.spec.md).

The first-class builder is an AI agent. Snapback's own implementation, generated
Snapback app code, and integration code should all assume agent authorship and
agent validation loops as the normal path. Human ergonomics are secondary to
giving agents strong affordances, tight feedback, and ways to get close to
guarantees.

A specific, important surface for that builder is Exact's **Design Mode** — where
an app is shaped by typing into a segment's chat box and turning knobs. Snapback
should integrate especially well with it. A useful design test for any Snapback
affordance: does a Design-Mode action (a sentence typed into a segment, a knob
turned) map cleanly onto the right backend behavior — the data read or written,
what syncs to the device, what updates live, who is allowed to see it — and is
that mapping legible enough for the agent to confirm it did the right thing? An
affordance that can't be driven well from Design Mode is a design smell.

The intended arc is one system across the whole lifecycle:

- **Prototype:** spin something up that costs ~nothing when idle and requires no
  infrastructure decisions.
- **Grow:** keep the same model and code as traffic increases.
- **Production:** carry a popular app without forcing a migration to a different
  stack. The north-star target is an app like Partiful reaching a few hundred
  thousand monthly active users on SQLite plus a lightweight JavaScript runtime
  (see [Scale targets and known limits](#scale-targets-and-known-limits)).

## Subsystems (v1)

These are the first-version building blocks. Each is sketched here at the
boundary level; the detailed design of each is expected to live in its own
follow-on LLP (see [Follow-on LLPs](#follow-on-llps)).

### Code execution

Backend logic runs as JavaScript. The runtime is pluggable:

- **Ibex** ([ccheever/ibex](https://github.com/ccheever/ibex)) for local
  deployments on your own machine and anywhere binary size matters.
- A **V8-based** runtime when running on Cloudflare, when you prefer it, or when
  you need its performance characteristics.

Both runtimes are *intended* to be interchangeable at the
programming-model level — the choice is meant to be an operational/target
decision, not a fork. That intent is **not yet earned**, but the mechanism that
earns it is now identified: a shared **runtime-conformance contract** (the
language/feature floor every acceptable engine must pass — see
[LLP 0009](./0009-code-execution-security.rfc.md) §Runtime Boundary), whose two
checkable properties are that the host can drive an `async` handler to
completion and does not hold the storage lock across async work. Valet's
`async`-handler rejection was an *execution-boundary* choice (synchronous eval
under the database lock), not an engine limit — Ibex already pumps the
microtask queue via `ex_hermes_poll` and Snapback adopts that boundary
([LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) §Execution and
Write Semantics; [LLP 0006](./0006-valet-retrospective.research.md)). Until
that contract is implemented and verified, "one programming model" remains a
goal, not a property already in hand. Boa is not a Snapback engine option; only
Ibex and V8 are, unless a future, explicit reason names a third.

How executed code is isolated — the sandbox boundary around app code, and the
tenant-isolation model when one deployment serves multiple apps or is hosted for
other people — is a load-bearing constraint this explainer does not yet settle.
It is called out here and owned by a dedicated security follow-on (see
[Follow-on LLPs](#follow-on-llps)).

### Data storage

SQLite at the small scale, Postgres at the larger scale. The key constraint:
there is **one abstraction over both** that you use most of the time, so that
graduating from SQLite to Postgres is a mostly seamless transition rather than a
rewrite. Preserving that portability is a hard design requirement — anything
that makes the SQLite→Postgres move a rewrite has failed the brief.

The contract binds the shared abstraction: code written against it must move
from SQLite to Postgres without a rewrite. Reaching past it to engine-specific
features stays allowed — *paved path, not a cage* — but is an explicit opt-out
that trades away portability for that code. Where exactly the line sits, and
whether a portable subset is guaranteed, is for the storage LLP to pin down.

### Auth / login

For most apps, auth data is the most important data, and it is something teams
spend a lot of time setting up. Snapback treats it as first-class and keeps it
**next to the rest of your data**, so you can join it with your other tables,
query it, and export it freely. The paved path is a built-in system in the
spirit of WorkOS or Clerk; bringing your own provider (WorkOS, Clerk, or
anything else) is explicitly supported.

### Asset storage

Users want to upload photos and videos, so those are the priority, including a
**processing pipeline** for them. Other file types (PDFs, etc.) are supported
too, but photo/video processing drives the design. Asset bytes are normally
stored on the filesystem or in S3-style object storage as appropriate for where
you are hosting. Asset metadata, ownership, permissions, references, and
processing state live with the rest of the application data in SQLite/Postgres.

### Cron

Scheduled code execution. Every backend platform that matures grows this, so
Snapback includes it from the start.

### Notifications

Reach people by email, SMS, and push (and possibly other channels). This is a
**thin layer** that you configure with your own provider API keys, not a
reimplementation of those providers.

## Subsystems planned for v2 (post-launch)

These can wait until after the initial launch:

- **AI gateway** — call an AI API for something directly through Snapback.
- **Data gateway** — fetch data such as sports scores or weather through
  Snapback and pay for it where needed (sometimes free, sometimes paid).

## Cross-cutting requirements

These span every subsystem and are part of what makes Snapback distinct.

### Local-first with partial sync

Mobile apps must keep working offline, which means syncing the relevant slice of
data down to the device. The bar: a messaging app should still show your old
messages with no connection — the failure mode where WhatsApp would show *no*
messages offline is exactly what local-first exists to prevent. Full replication
is not assumed; **partial** sync of the data a given client needs is the model.

Desktop apps are an explicit case, not an afterthought, and they differ from
mobile in a way that matters here: far more data may live locally — a desktop
client might reasonably keep a large working set, or close to the whole dataset,
on disk. Partial sync therefore has to scale across a wide range of local-store
sizes, from a phone holding a thin slice to a desktop holding a great deal; the
sync model must not assume the mobile size profile.

### Realtime live updates

Changes should propagate to interested clients immediately. If someone RSVPs to
a party while another user is viewing the RSVP list, that guest should appear
under "Yes" and the count should increment without a refresh.

High-frequency transient state such as cursors, selections, typing indicators,
and online presence is realtime state too, but not ordinary durable data by
default. [LLP 0013](./0013-ephemeral-realtime-state.rfc.md) owns the proposed
ephemeral-state contract for that class: typed, TTL-bound latest-state
collections backed by process memory locally and adapter-specific infrastructure
on hosted targets.

### Multi-target deployment

Snapback should run on your own machine, your own hardware, Cloudflare, AWS,
Google Cloud, Azure, DigitalOcean, Hetzner, Railway, and Fly.io. **Cloudflare is
unusual** enough that making Snapback work well there is called out as requiring
dedicated effort rather than being assumed to come for free. A runtime/deployment
LLP must define target profiles and launch requirements before agents treat the
whole matrix as implemented. Cloudflare is important enough that doing it well is
the planned second step after the local core (see
[Implementation order](#implementation-order)), and we should be open to
rearchitecting around its model rather than treating it as a port.

This is also where *scale to zero* has to be made precise. Idle cost is
target-dependent: a serverless or Cloudflare-style substrate can bill to
(almost) zero when idle, while an always-on VM — a Hetzner box, a cloud droplet
— keeps incurring its base rate no matter how light the app is. "Costs almost
nothing when idle" is therefore a property the architecture must earn per
target, not a universal guarantee; the deployment LLP should state what idle
cost looks like for each target profile.

## Canonical local target

Of all the targets, one is privileged as the **standard place to build and
test**: the whole server — code hosting *and* data store — running **locally on
your machine via Ibex + SQLite**. Other configurations are valid (for example,
running only the Wasm part of the sync engine in the browser), but this local
Ibex + SQLite server is the **first standard target** — the default an agent
assumes when it builds, runs, and validates its work, and the baseline the
[reference apps](#reference-apps) and their acceptance suite run against. The
decision and its consequences are recorded in
[LLP 0002](./0002-canonical-local-target.decision.md).

## Reference apps

These are concrete apps Snapback must be able to build *and run well* — the
working set the design is validated against, not just demos. Each leans on a
different mix of the subsystems and cross-cutting requirements above; together
they set the capability bar. (Some lean on
[v2 subsystems](#subsystems-planned-for-v2-post-launch) and are correspondingly
post-launch targets.)

- **Todo list** — the floor: basic CRUD, auth, and offline edits on the
  scale-to-zero prototype path. If this isn't trivial, nothing else matters.
- **1-1 and group messaging** (Signal/WhatsApp) — local-first with partial sync
  plus realtime delivery; the canonical "show old messages with no connection"
  case from [Local-first with partial sync](#local-first-with-partial-sync).
- **Kanban board** — realtime collaborative edits, optimistic reordering, and
  modest fan-out.
- **E-commerce store** — write correctness (inventory, orders) and asset storage
  for product media; also pulls in payments, an integration this corpus does not
  yet cover.
- **Collaborative whiteboard** — shared cursors and edits propagated *keystroke
  by keystroke*: the extreme realtime fan-out case, and exactly the
  [open fan-out question](#scale-targets-and-known-limits) this corpus has not
  yet answered.
- **Collaborative rich-text pad** — a small focused multiplayer editor across
  platforms. This is a nice-to-have stress case distinct from the Notion-like
  workspace: it asks whether Snapback can support at least one good approach to
  rich-text collaboration — operation log, CRDT/OT bridge, block-level mutations,
  or another explicit design — with cursor/selection presence, offline replay,
  and realtime convergence. It does not require Snapback's ordinary row-sync
  model to solve every editor architecture automatically.
- **Task tracker** (Linear) — local-first partial sync over a large dataset, with
  a snappy offline UX as the bar.
- **Notion-like workspace** — documents-plus-databases with realtime collab and a
  large local dataset, especially on desktop: a stress test for local-first at
  scale (the [desktop](#local-first-with-partial-sync) large-local-data case) and
  for flexible, structured-and-freeform data.
- **Team chat / community hub** (a mini Slack or Discord) — channel-scale
  realtime fan-out, presence, history partial-sync, and notifications. A mini
  version is fine; we don't need every feature.
- **Social / video app** (TikTok/YouTube/Instagram/Twitter) — the
  [asset storage](#asset-storage) and processing pipeline at scale, plus
  read-heavy feed fan-out; the photo/video-first case that subsystem targets.
- **Blog** — read-heavy content with image assets; web is a secondary client
  target but should still be served well.
- **Multiplayer card game** — each player sees a different view (secret hands), so
  partial sync must be **authorization-aware** — syncing only what a viewer is
  permitted to see — over realtime, server-authoritative state.
- **Party app** (Partiful) — RSVP realtime and invite/reminder notifications;
  already the north-star [scale target](#scale-targets-and-known-limits).
- **Finance app** (Robinhood/Coinbase) — money-grade write correctness, realtime
  price reads, sensitive-data auth, and external market data (a **v2** data
  gateway consumer).
- **Daily-fantasy / fantasy-sports picker** — scheduled scoring and contest locks
  via Cron, realtime leaderboards, and external sports data (a **v2** data
  gateway consumer).

The aim is breadth of *kind*, not a feature-complete clone of each: together
they exercise every v1 subsystem and every cross-cutting requirement, and they
push the realtime, correctness, and asset axes to their edges. What "works well"
means for each is acceptance-suite work for a follow-on LLP.

## Non-goals

Setting expectations is part of the design. Snapback is **not** trying to be
excellent at the following, and we'd rather say so up front. (You may still be
able to build a small version of some of these — they just aren't what the system
is optimized for, and they must not steer the design.)

- **Fast-twitch realtime games** — massively-multiplayer first-person shooters
  and other fast-action multiplayer games that stream large volumes of
  positional state at high tick rates. These want authoritative low-latency game
  servers, not a SQLite-backed sync model.
- **High-frequency write firehoses** — clickstream/ad-tech ingestion, large-scale
  IoT telemetry, or matching engines sustaining very high write rates. That
  throughput profile fits neither the small-scale stack nor the scale-up target.
- **Analytics / data-warehousing workloads** — heavy OLAP over huge datasets
  belongs in a warehouse (BigQuery, Snowflake, ClickHouse). Snapback's store is
  transactional and app-facing, not an analytics engine.
- **CDN-scale streaming infrastructure** — being the global live-video transcode
  and delivery backbone. Building an app that *hosts and plays* user video is in
  scope (see the social/video reference app); being a streaming CDN is not.
- **Heavy compute / ML training** — GPU training jobs and large batch-compute
  pipelines. Snapback runs app logic and should call out to dedicated services
  for these.

These are starting expectations, not a final boundary; the ratifying source can
prune or extend the list as the scale-up envelope is benchmarked.

## Design principles and non-obvious constraints

Future work is expected to honor these even when they are inconvenient.

- **Scale to zero, then scale up.** Lightness at idle is a primary design goal,
  not an afterthought. The same system must still scale up to a popular
  production app.
- **Comprehensive and coherent.** Prefer one roof where the pieces are designed
  together over a loose collection of services. The Rails comparison is
  intentional.
- **Paved path, not a cage.** Let people do whatever they want, but make the
  blessed ways of doing things work exceptionally well. Bring-your-own
  alternatives (e.g. external auth providers) should remain possible.
- **Agent-first developer experience.** We expect essentially all Snapback
  framework code, generated app backend code, and integration code to be written
  by AI agents. Agent DX is therefore the priority, and where it trades off
  against human ergonomics, agent DX wins. Concretely, the syntax, tooling, and
  APIs should give agents ways to get *close to guarantees* about what they
  intend, and should provide **complete feedback loops** so an agent can
  validate its own work and understand the current state of the system.
  (`ref-check`, run by both agents and CI, is an early example of this
  feedback-loop philosophy applied to the design corpus itself.)
- **Contract/Exact first; React/Expo a strong second.** The primary client
  target is the Contract/Exact app stack, and its needs drive core design
  decisions. React and Expo are first-class *secondary* consumers — supported as
  well as they can be, but not steering the design.
- **Truly open.** MIT licensed. No "funny business" source-available licenses
  that prevent hosting Snapback for other people.

## Scale targets and known limits

- **Target:** SQLite + Ibex should carry an app like Partiful to a few hundred
  thousand monthly active users. That is the goal the small-scale stack is being
  designed against, not yet a proven benchmark.
- **Needs definition:** the workload envelope must be specified before this
  becomes an engineering claim: concurrent users, reads/sec, writes/sec,
  realtime subscription fan-out, asset upload volume, cron load, notification
  throughput, latency targets, and acceptable degradation behavior.
- **Benchmark gate:** every reference-app family that is used to claim scale
  must have an acceptance profile with data shape, local-store size, mutation
  rate, subscription count, fan-out pattern, and degradation behavior. A demo
  proves product shape; a benchmark proves the scale claim. The runnable demo
  corpus and its Contract/Exact dependency policy are planned in
  [LLP 0015](./0015-demo-application-suite.plan.md).
- **Out of scope:** several workloads are explicit non-goals — fast-twitch
  realtime games, write firehoses, analytics warehouses, and more — collected under
  [Non-goals](#non-goals).
- **Open question:** the upper bound on high-frequency fan-out is not yet known
  — e.g. whether ~100 people on the same site, each with a continuously synced
  mouse position pushed out to every other client, is realistic on this stack.
  This needs empirical answers, ideally informed by what was learned from Valet.

## Lessons from Valet

Snapback's predecessor was **Valet** ([expo/valet](https://github.com/expo/valet)),
an earlier prototype whose general architecture remains directionally important:

- A small **Rust** service running alongside **SQLite**, executing your code and
  using SQLite for storage, is considered directionally correct.
- For the code engine, **Ibex** is fine, and **V8** should also work well.
- Empirical testing of Valet ran into real problems that made it hard. Those
  specific problems have now been recovered from Valet's experience diaries and
  LLP corpus in [LLP 0006](./0006-valet-retrospective.research.md), then
  promoted into the storage, sync, runtime, auth, DX, and integration LLPs. The
  recovered record is strong enough to constrain v1: no silent codegen drops, no
  handler source-only replay, no per-row version triggers for one logical
  mutation, no silent backpressure drops, no stale subscription initial state, no
  typecheck theater, and no pretending Ibex/Hermes can enforce hosted-code
  resource limits until it actually can. What remains unanswered is not the
  basic failure list but the production envelope: single-writer breaking point,
  fan-out ceiling, retention/matcher cost, hosted isolation, and idle-cost
  behavior by target.

## Implementation order

Direction, not a schedule. Build it in this order, with the first step treated as
a **narrow proof**, not as a compressed version of the whole product:

1. **Code hosting + data storage first, on Ibex + SQLite.** Get the core — your
   code running and your data stored — solid on the
   [canonical local target](#canonical-local-target) before broadening anything
   else. It is the foundation every other subsystem sits on. The first-slice
   architecture is split across
   [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md) for the local
   Rust server and SQLite core, and
   [LLP 0004](./0004-application-data-api.rfc.md) for the application data API
   that apps and agents use.
2. **Then Cloudflare, done well.** Once the core feels good, the next move is to
   make Snapback work *well* on Cloudflare — which may mean more than a port.
   Cloudflare's model is unusual enough (see
   [Multi-target deployment](#multi-target-deployment)) that we should be open to
   **rearchitecting around how Cloudflare works** rather than bolting it onto a
   design shaped only by the local stack.

The **first implementation slice** is deliberately smaller than the v1 product
surface. It should prove:

- one trusted local app on Ibex + SQLite;
- generated schema and function artifacts loaded by the local server;
- one portable single-table indexed query shape;
- one server-authoritative mutation path with one atomic commit version;
- a named mutation isolation strategy, so reads performed before commit cannot
  silently violate invariants under concurrent writes;
- one syncable live-query subset with an authoritative initial snapshot and
  online realtime deltas;
- deterministic reset/seed and machine-readable diagnostics;
- a headless or React fixture that consumes the generated contract without
  Contract/Exact-private backend semantics.

That first slice should **not** claim offline mutation replay, hosted/untrusted
execution, Postgres graduation, Cloudflare, real auth providers, assets, cron,
notifications, rich text, high-frequency whiteboard fan-out, finance-grade money
semantics, or Design Mode authoring. Those later capabilities must appear as
explicit capability gaps, not as half-implemented hidden behavior.

Cloudflare remains the planned second target, but it needs its own strategy LLP
before the local core hardens around unportable assumptions. At minimum that
strategy should identify the target seams for connection ownership, change
notification, durable state, scheduler/alarm behavior, WebSocket/session
lifetime, runtime isolation, secrets, asset storage, and storage-engine choice.
That strategy is drafted as
[LLP 0014](./0014-cloudflare-strategy.rfc.md).

Everything else — the rest of the deployment matrix, the v2 subsystems, and the
broader reference-app set — follows once the narrow local proof and the Cloudflare
strategy are in hand.

## Follow-on LLPs

As the project takes concrete shape, expect dedicated LLPs (numbered when
written) for at least:

- The **local code-hosting and storage core** — the first Rust companion server
  slice that hosts app code, owns SQLite, and drives realtime. Drafted as
  [`0003-local-code-hosting-and-storage-core.rfc.md`](./0003-local-code-hosting-and-storage-core.rfc.md).
- The **application data API** — the schema, handler, `ctx.db`, and generated
  client API that apps use to communicate with Snapback. Drafted as
  [`0004-application-data-api.rfc.md`](./0004-application-data-api.rfc.md).
- The **storage abstraction** and the SQLite↔Postgres portability contract.
  Drafted as
  [`0007-storage-portability.spec.md`](./0007-storage-portability.spec.md).
- The **local-first sync** model (partial sync, conflict handling, and the range
  of local-store sizes from a mobile slice to a desktop bulk copy), together
  with the **realtime** update mechanism. Drafted as
  [`0008-local-first-sync-and-realtime.rfc.md`](./0008-local-first-sync-and-realtime.rfc.md).
- The **auth** system and bring-your-own-provider boundary. Drafted as
  [`0011-auth-and-permissions.rfc.md`](./0011-auth-and-permissions.rfc.md).
- The **code execution** runtime model across Ibex and V8.
- The **asset storage** and media processing pipeline.
- The **prior-art retrospective** (Research) — lessons from Valet, Zero/
  Replicache, LiveStore, Supabase, Convex, SpacetimeDB, Firebase, PlanetScale,
  Neon, Val.town, and Rails. Drafted as
  [`0001-prior-art.research.md`](./0001-prior-art.research.md); Valet is its
  deepest strand. A dedicated Valet recovery draft now lives at
  [`0006-valet-retrospective.research.md`](./0006-valet-retrospective.research.md).
  The primary-source pass on the three closest living peers — ElectricSQL,
  PowerSync, and Turso/libSQL — is
  [`0022-electric-powersync-turso.research.md`](./0022-electric-powersync-turso.research.md).
- The **agent DX and validation** model for agent-authored Snapback work.
  Drafted as
  [`0010-agent-dx-and-acceptance.spec.md`](./0010-agent-dx-and-acceptance.spec.md).
- An **admin console and inspection surface** for health, runtime state, durable
  data exploration, ephemeral rooms, generated function running, and the serving
  model for the local web console. Drafted as
  [`0017-admin-console-inspection-surface.rfc.md`](./0017-admin-console-inspection-surface.rfc.md).
- The **app and instance boundary** — the distinction between physical Snapback
  instances, logical Snapback apps, client surfaces, and explicit app suites.
  Drafted as
  [`0018-app-instance-boundaries.rfc.md`](./0018-app-instance-boundaries.rfc.md).
- The **runtime/deployment matrix**, especially Cloudflare constraints.
- A **security and tenant-isolation** model: the sandbox boundary for executed
  app code, isolation between apps/tenants, and secret handling — load-bearing
  once Snapback runs user code and is hosted for other people. Drafted as
  [`0009-code-execution-security.rfc.md`](./0009-code-execution-security.rfc.md).
- **Schema migrations and evolution**, and how they interact with the
  SQLite↔Postgres portability contract.
- **Observability** — logs, errors, and metrics for *running* apps: the runtime
  feedback loop that agent-first DX implies, distinct from `ref-check`, which
  serves the design corpus.
- A **reference-apps acceptance suite** — what "works well" means for each app in
  [Reference apps](#reference-apps), expressed as agent-checkable validation.
  Drafted as
  [`0010-agent-dx-and-acceptance.spec.md`](./0010-agent-dx-and-acceptance.spec.md).
- A **demo application suite** — the runnable demo/reference app corpus,
  beginning with todo, including shared Snapback backends, Contract/Exact and
  React surfaces, and the external Exact dependency policy. Drafted as
  [`0015-demo-application-suite.plan.md`](./0015-demo-application-suite.plan.md).
- A **diary-driven change program** — the priority order and ownership split for
  turning demo diary findings into product changes across Snapback core,
  adapters, and Exact/Contract. Drafted as
  [`0016-diary-driven-change-program.plan.md`](./0016-diary-driven-change-program.plan.md).
- **Exact Design Mode integration** — how Snapback affordances surface in, and are
  driven from, Exact's Design Mode. Drafted as
  [`0005-contract-exact-react-integration.explainer.md`](./0005-contract-exact-react-integration.explainer.md).
- A **headless integration contract** for Contract/Exact, React/Expo, tests, and
  agent tools. Drafted as
  [`0012-headless-integration-contract.spec.md`](./0012-headless-integration-contract.spec.md).
- An **agent operating surface** for host operations, CLI/HTTP/MCP projections,
  and generated app-data MCP tools. Drafted as
  [`0024-agent-operating-surface.spec.md`](./0024-agent-operating-surface.spec.md).
- A **Cloudflare strategy** — how to do Snapback well on Cloudflare, including
  whether to rearchitect around its model. Drafted as
  [`0014-cloudflare-strategy.rfc.md`](./0014-cloudflare-strategy.rfc.md).

This list is a pointer to expected work, not a commitment to numbering or
sequence; create each via the `llp-create` workflow when its design is ready.

## Repository and LLP setup

This repository keeps its LLP corpus directly in [`llp/`](../llp), rather than
using an LLP submodule for the documents themselves. The agent-facing rules are
in [`AGENTS.md`](../AGENTS.md), validation is via [`ref-check`](../ref-check)
(also run in CI), and the project skill aggregate lives under
[`skills/`](../skills/).

The skill files in `skills/` are symlinks into branch-tracking upstream
submodules under [`vendor/llp`](../vendor/llp) and
[`vendor/ccheever-skills`](../vendor/ccheever-skills), then exposed to each
agent through that agent's project-local skill directory. Run
[`scripts/sync-agent-skills`](../scripts/sync-agent-skills) after updating the
upstream skill repos. The LLP workflow itself is maintained at
<https://github.com/ccheever/llp>.

## Status

This is a living document and the root of the corpus. It will change as
subsystem boundaries firm up and as follow-on LLPs settle the provisional
choices noted above. Update it — and land the update with the change that
motivated it — whenever the project's intent or top-level structure moves.
