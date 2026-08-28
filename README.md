<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/snapback-logo-dark.png" />
    <img alt="Snapback" src="brand/snapback-logo.png" width="440" />
  </picture>
</p>

# Snapback

**An agent-first, open source, scale-to-zero backend.**

Snapback is everything behind an app under one roof — schema and functions,
server-authoritative queries and mutations, live queries, ephemeral realtime,
auth, assets and media, cron and one-off jobs, observability, and first-party
clients — designed so that an **AI agent** can write the backend, validate its
own work against real receipts, and ship. It works with any frontend, and is
especially tailored for **Expo and React**. Idle apps cost almost nothing; the
same system is built to carry a realistically popular one. MIT licensed: host
it anywhere, including for other people.

- **Build an app on Snapback** → [`guide/index.md`](./guide/index.md) (start
  with a [start packet](./guide/start/index.md) or
  [Snapback in one screen](./guide/start/mental-model.md))
- **Understand the design** → [`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md)
- **Work on Snapback itself** → [`AGENTS.md`](./AGENTS.md) and
  [Repository layout](#repository-layout) below

---

## Status at a glance

*Updated 2026-08-28. Where this section and
[`guide/capabilities.md`](./guide/capabilities.md) disagree, the capability
index wins — it is the authority, this is the summary.*

| | |
| --- | --- |
| **Local target** | Shipped and used daily. The `snapback dev` loop, the Rust/SQLite server, and the Ibex (Hermes) JS runtime are the canonical product. |
| **Capability index** | 118 author-facing rows: **73 shipped**, 37 partial, 4 experimental, 4 design-only — each shipped row carries a witness, each gap is owned. |
| **Published npm closure** | 14 packages at **0.1.29** (2026-08-27). See [`guide/published-closure.json`](./guide/published-closure.json). |
| **Rust workspace** | 13 crates, 427 modules, ~627k lines, under a fail-closed ownership gate — the LLP 0276 rearchitecture landed 2026-08-19. |
| **Hosted targets** | Honest partial profiles only. **No hosted target advertises the local target's full capability set**, and there is no end-to-end path that deploys an arbitrary app to a hosted origin yet. |
| **Next publication** | Rapid publication remains active. Four LLP 0283 F-1 defect families remain open and LLP 0284 security gates remain red by design; published closures claim no adversarial-handler containment. |

Two things are deliberately *not* claimed today: a general hosted deployment
product, and the SQLite→Postgres graduation contract. Both are tracked, not
hidden — see [What's done and what isn't](#whats-done-and-what-isnt).

---

## Quick start

Application authors need no repository checkout and no submodules — just the
published CLI:

```sh
npm install -g @expo/snapback-cli     # or: bun add -g @expo/snapback-cli
snapback new my-app --template react
cd my-app
bun install
bun run dev
```

Five templates ship in the packaged CLI:

| Template | What you get |
| --- | --- |
| `todo-contract` | The smallest backend-first scaffold: generated headless references and acceptance, no UI. *(CLI default)* |
| `react` | Minimal React/Vite web app: live query, mutation, password auth, connection state. |
| `crud-dashboard` | React/Vite dashboard: relational directory reads, independent live detail, optimistic CRUD. |
| `media-feed` | Expo iOS/Android/web feed: image upload, composed publish command, collision-safe pagination. |
| `expo-chat` | Golden-path Expo conversation app: assets, typing presence, generated surface. |

The ecosystem-standard entry point works too, and defaults to `expo-chat`:

```sh
npm create snapback-app my-chat       # or: bun create snapback-app my-chat
```

Then read [`guide/index.md`](./guide/index.md) — the agent-first authoring
guide, with intent-indexed pages and CI-verified snippets — and check the
[capability index](./guide/capabilities.md) before designing around any
feature.

### The loop

```text
edit snapback/*.mjs  →  bun run generate  →  bun run dev  →  bun run prove
```

A green `snapback verify` receipt is "done." Anything else is a claim. When
something refuses, read the `SNAPBACK_*` code and run `snapback guide <CODE>`
for the exact rule and fix.

---

## A backend in three files

You write `snapback/schema.mjs`, `snapback/functions.mjs`, and
`snapback/seed.json`. Codegen owns everything under `snapback/generated/` —
regenerate it, commit the review manifest, never hand-edit it.

**`snapback/schema.mjs`** — tables, field types, visibility, indexes, and
whether a table is syncable:

```js
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

export default defineSchema(
  {
    todos: defineTable({
      title: v.string(),
      completed: v.boolean(),
    })
      .visibility({ kind: 'public-read' })
      .index('by_title', ['title'])
      .sync(),
  },
  { auth: { mode: 'sessions' } },
);
```

**`snapback/functions.mjs`** — named queries, live queries, and mutations. The
server is the security boundary: scope inside the function with
`authUserId()`, never with a client-supplied owner argument.

```js
import {
  arg, asc, defineLiveQuery, defineMutation,
  insert, lit, results, returnBinding, v,
} from '@expo/snapback-codegen/define';

export const listTodos = defineLiveQuery({
  auth: 'public',
  table: 'todos',
  args: {},
  order: [asc('title')],
  index: 'by_title',
});

export const createTodo = defineMutation({
  auth: 'public',
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title'), completed: lit(false) }, { bindIdAs: 'todoId' }),
  result: results.value(v.id('todos')),
  returns: returnBinding('todoId'),
});
```

Mutations can also be plain JavaScript handlers (`defineJsMutation` with a
`ctx.db` handler module) when a declarative plan isn't expressive enough. Both
run server-side under one commit version with read-set conflict validation.

**The client** — bind the *generated* reference; there is no ad-hoc query
language on the wire:

```tsx
import { useSnapbackMutation, useSnapbackQueries } from '@expo/snapback-react';
import api from '../snapback/generated/api.mjs';

// Hoisted: useSnapbackQueries subscribes by the identity of this map.
const workspaceQueries = { todos: { ref: api.listTodos, args: {} } };

export function App() {
  const workspace = useSnapbackQueries(workspaceQueries);
  const createTodo = useSnapbackMutation(api.createTodo);
  const todos = workspace.queries.todos.status === 'ready' ? workspace.queries.todos.data : [];

  return (
    <main>
      <button onClick={() => void createTodo({ title: 'Next thing' })}>Add todo</button>
      <ul>{todos.map((todo) => <li key={todo._id}>{todo.title}</li>)}</ul>
    </main>
  );
}
```

### Smoke-check a running backend

With `bun run dev` still running, invoke a declared-public query directly from
the project root:

```sh
snapback run --ready-file .snapback/dev.ready.json listTodos
```

This is the public form: it sends no `userId`, session bearer, lease, or admin
credential to the application query route. The ready-file admin token reaches
host-ops first so the CLI can resolve the target, but it is not forwarded to
the query route. On the default sessions-mode React scaffold it offers the
anonymous-public auth protocol and succeeds only when the generated function
declares `auth: 'public'` (or otherwise admits an anonymous caller). An
authenticated function remains fail-closed with `SNAPBACK_AUTH_REQUIRED`.

For an authenticated sessions-mode call, mint a local test session from the
trusted terminal, then give the returned `data.token` to the first-party
external-session client in trusted server/test code:

```sh
snapback session mint --ready-file .snapback/dev.ready.json \
  --email person@example.test
```

```js
import { createExternalSessionClient } from '@expo/snapback-client/online';
import api from './snapback/generated/api.mjs';

const baseUrl = process.env.SNAPBACK_URL;
const bearerToken = process.env.SNAPBACK_SESSION_BEARER;
if (!baseUrl || !bearerToken) throw new Error('missing trusted test session');
const client = createExternalSessionClient(baseUrl, {
  bearerToken,
});
const result = await client.query(api.myAuthenticatedQuery, { args: {} });
await client.close();
```

Set `SNAPBACK_URL` from the readiness descriptor's `serverUrl` and set
`SNAPBACK_SESSION_BEARER` to the mint response's `data.token` only in that
trusted process. Keep the mint result and bearer out of browser/native bundles
and logs.

An `optional-user` operation can admit an anonymous caller and still require a
user in its implementation. In particular, a query that dereferences
`authUserId()` needs `snapback session mint` plus
`createExternalSessionClient`; without that session it fails closed with
`SNAPBACK_AUTH_USER_MISSING`.

`snapback run --user <id> ...` is the explicit client-asserted identity form
for an `auth: { mode: 'dev' }` backend. Against a sessions target, that host-op
path fails at the scoped secret-read boundary with
`SNAPBACK_ADMIN_SECRET_READ_REQUIRED` (exit 5); it does not reach the app
route's `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` refusal. Use
`snapback session mint` plus `createExternalSessionClient` there instead.

Every snippet in [`guide/`](./guide/index.md) marked `source=` is a verbatim
excerpt of a file CI executes end to end; `scripts/check-guide.mjs` fails the
build if one drifts.

---

## How we think about it

**Agent-first, not agent-friendly.** We expect essentially all Snapback
framework code and all Snapback app code to be written by AI agents. That is
the design constraint, not a marketing angle: syntax, APIs, refusal codes,
generated artifacts, and feedback loops exist so an agent can get close to
guarantees and *prove its own work* — a green receipt instead of a confident
paragraph. Human ergonomics matter where they don't weaken that priority.

Concretely, agent-first shows up as:

- **Stable `SNAPBACK_*` diagnostic codes** with a generated registry, so a
  failure is a lookup rather than a search.
- **A capability index with explicit GAP rows**, so an agent never reinvents
  a feature it didn't know existed, and never assumes one that is a named gap.
- **`snapback verify`** — one identity-bound receipt composing artifact,
  runtime, coverage, capability, and acceptance state into a partial
  done-oracle.
- **Two MCP servers** with deliberately different authority: `snapback mcp`
  (read-only guide resources) and `snapback mcp-control` (typed control tools
  with standing local admin authority).
- **A budgeted first read** (LLP 0259): a template start packet, then one page
  at a time via `snapback guide <query>` — not a 2.5 MiB corpus dump.

**Scale to zero.** An idle app should cost almost nothing and need no
babysitting, so you can prototype without worrying about bills or ops.

**Scale up.** The same system should carry a realistically popular app. The
north-star target is something like Partiful at a few hundred thousand monthly
users on SQLite and a lightweight JavaScript runtime.

**Complete and coherent.** Everything a backend needs under one roof, with the
pieces designed to work together rather than bolted on — a bit like Rails, for
the mobile-first, local-first, realtime world.

**Truly open.** MIT licensed. No source-available restrictions that stop you
from hosting it for other people.

**Built for mobile, local-first, and realtime.** Offline has to work — a chat
app that shows nothing the moment you lose signal is broken — so Snapback syncs
the relevant slice of data to the device and replays queued mutations. And live
updates are required, not optional: if someone RSVPs while you're looking at the
list, the guest appears and the count ticks up.

**Works with any frontend, tailored for Expo and React.** Snapback talks to
clients over a versioned wire protocol with a language-neutral conformance
corpus, so any frontend can consume it — the framework-neutral headless
`SnapbackClient` is the floor, and a Swift client ships for iOS and macOS.
**Expo and React get the deepest support**: first-party providers and hooks,
generated typed references, optimistic mutations, managed presence, offline
retention, a zero-configuration Expo binding with a config plugin, and a
managed Vite dev plugin. If you are building on Expo or React, you are on the
paved path.

---

## What's in the box

Grouped roughly as the [guide](./guide/index.md) groups it. Maturity labels
come from the [capability index](./guide/capabilities.md); everything below is
the **local target** unless noted.

### Data and functions
- Declarative schema (`defineSchema`/`defineTable`/`v.*`), indexes, enums,
  reviewed destructive migrations, sessions-mode schema evolution, record
  history.
- Server-authoritative queries and mutations: one commit version, read-set
  conflict validation, structured results, typed refusals.
- Declarative mutation plans plus JavaScript handlers with `ctx.db`, running on
  the embedded Ibex (Hermes) runtime.
- Server-authored time and IDs, scoped sequences, bounded relational queries
  and maintained projections, snapshot batches, keyset pages.
- Portable indexed **text search** and exact **vector search** (both
  experimental), declarative seeds and versioned fixtures.

### Realtime and sync
- **Live queries** — named, generated subscriptions with snapshot +
  replace/delta delivery over a durable push lane.
- **Ephemeral state** — presence, typing indicators, cursors, typed rooms with
  TTL, rate and payload limits.
- **Offline** — stale boot, durable outbox ordering, deterministic optimistic
  overlays, mutation replay, and lease-bounded retention of authorized data.

### Auth
- Sessions mode with server-derived principals; email + password with
  server-side argon2id, declared lockout, and one-time recovery codes.
- Scoped queries, table visibility, scoped roles and memberships, agent
  principals, connection-bound live grants, auth-invalidation barriers, signed
  authorized-query leases.
- Browser session custody, native iOS/Android custody, an external
  identity-broker seam, and **target honesty**: the server tells you what the
  running target actually enforces instead of asking you to trust prose.

### Assets and media
- Generated upload intents, one-call File/Blob/picker upload, TUS resumable
  transfer, signed-URL delivery with TTL refresh, typed `v.assetRef`
  attachment, per-recipient grants and view-once flows, consistent-cut logical
  export, signing-key rotation.

### Background work
- Cron with deterministic ticks and a run ledger; one-off durable jobs via
  transactional `ctx.jobs.enqueue`; actions and gated outbound fetch; streamed
  actions; an Expo push seam with crash-honest ticket/receipt handling.

### Clients
- `@expo/snapback-react` — hooks, optimistic mutations, managed presence, paged
  lists, Strict Mode-safe sharing, offline cold-boot custody.
- `@expo/snapback-expo` — zero-configuration Expo binding, provider, lifecycle,
  and config plugin; `@expo/snapback-vite` for the managed web dev loop.
- The framework-neutral headless `SnapbackClient`, a Swift client for
  iOS/macOS, an app CLI, and a versioned client protocol with a
  language-neutral conformance corpus for building your own arm.

### Operating
- `snapback dev` supervisor, admin console (Data / Functions / Realtime /
  Errors / Logs), host operations, secrets and config, backup/copy/restore,
  experimental LTX replication, network condition profiles, local instance
  forks, typed observability, backend error grouping and triage, an external
  `/api/v1` surface with OAuth and remote MCP.

### Testing
- Headless-first acceptance harness with vacuous-pass protection, large
  deterministic fixture loading, and `snapback verify`'s composed receipt.

---

## What's done and what isn't

**Shipped and load-bearing.** The local target's authoring loop, data model,
live queries, ephemeral realtime, sessions auth, assets, cron, observability,
the React/Expo/headless client arms, the admin console, and the
published CLI. This is what the 14-package 0.1.29 closure carries and what the
guide teaches.

**Partial, honestly fenced.** 37 capability rows are `partial` and 4 are
`experimental`. Each names its exact stopping point and a tracking ticket —
notably bounded child pages, sequences, jobs, structured stored values, media
collections and commands, the Swift arm, declaration conformance, and
replication.

**Design-only (4 rows).** Identity/serial columns, first-class notifications,
non-JS clients beyond Swift (Kotlin, Dart), and backend-only composition into
an existing app.

**Hosted deployment.** There is no end-to-end path that deploys an arbitrary
app to a hosted target. Local is a dev/test target, not a hosting adapter; Fly
has registration, planning, and a lifecycle engine but `deploy apply` cannot
qualify; Cloudflare deploys only two checked-in proof apps; all 17
`snapback hosted lifecycle` verbs refuse with
`SNAPBACK_HOSTED_LIFECYCLE_CARRIER_INCOMPLETE`. The full table is
[`guide/deploying/index.md`](./guide/deploying/index.md).

**SQLite → Postgres graduation.** Still design work.

**Blocking the next npm publication.** The LLP 0276 rearchitecture landed
structurally, but Phase 4 did not complete. Published packages are immutable
(LLP 0041), so publication waits on [LLP
0283](./llp/0283-post-rearchitecture-followups.plan.md):

- **F-1** — three privilege escalations survive in the post-carve authorization
  surface: a publicly claimable authority root, self-implementable capability
  traits that became public closure factories, and a caller-selectable Cargo
  feature exposing writable raw SQLite above the kernel. Behavior was not
  regressed and `schemas/` drift is zero; the problem is *surface*.
- **F-2** — the three security gates that reported those closed were written by
  the same lane whose work they constrain. They need rewriting from an
  independently authored threat model.
- **F-3** — the complete battery and cold-clone witnesses never ran against the
  final head.
- **F-4** — a small set of known/triage-pending test failures, including a real
  refusal-precedence ordering bug where the JS handler path and the HostPlan
  path disagree; it awaits an author ruling on which order is correct.

Sequencing: F-1 and F-2 together (by an author independent of the previous
attempts), then F-4's triage, then F-3's battery, and only then publication.

---

## Repository layout

The Rust side is a Cargo workspace whose crates *physically realize* the
ownership architecture: the contract-types leaf below the storage kernel below
domain services below transport adapters, with the kernel as the only commit
authority. Cargo
makes absent edges uncompilable, and a fail-closed workspace-graph gate over
`cargo metadata` enforces what construction can't express. Governing design:
[LLP 0276](./llp/0276-ideal-codebase-architecture.rfc.md).

```
snapback/
├── crates/          # Rust workspace — the server, runtime, and CLI
├── packages/        # npm workspace — the published JS surface
├── clients/         # protocol-native non-npm clients (Swift)
├── schemas/         # the cross-language contract corpus (295 files)
├── targets/         # target-local implementations (targets/cloudflare/)
├── demos/           # ~32 declared reference applications + _kit/
├── tests/           # cross-language acceptance, conformance, receipts
├── benchmarks/      # competitive-authoring instrument
├── scripts/         # proof engine, gates, release, bootstrap
├── guide/           # the agent-first product guide (150 pages)
├── llp/             # design corpus (numbered documents + reviews + overlays)
├── issues/          # filesystem tickets (open + closed/)
├── diaries/         # demo build diaries (113)
├── admin-ui/        # the browser admin console (own lockfile)
├── website/         # snapback.expo.app shell (own lockfile)
├── skills/          # agent skills aggregate (+ per-agent mirrors)
├── vendor/          # ibex, celld-ltx, llp, ccheever-skills submodules
└── archive/         # retired-but-kept trees
```

### `crates/` — the Rust workspace

Rank is total; every dependency edge lands on a strictly lower rank, so the
graph is a DAG by construction. The normative object is
`crates/allowed-dependencies.v1.json`, which the gate reads.

| Crate | Rank | What it owns |
| --- | --- | --- |
| `snapback-types` | 0 | Language-neutral schema/wire/id/value types; exports `schemas/`. |
| `snapback-kernel` | 1 | SQLite transactions — the only commit primitive; migrations, durability, search/vector storage machinery. |
| `snapback-auth` | 2 | The auth substrate: provider, session/credential/lease/custody policy, revocation publication. |
| `snapback-activation` | 3 | Composes and atomically installs successor generations. |
| `snapback-sync` | 3 | Subscriptions, live matching/coalescing, RQS, cursors, outbox settlement, fan-out, ephemeral rooms. |
| `snapback-services` | 3 | Assets and media, jobs, cron, push, webhooks, forks, replication, telemetry, error tracking. |
| `snapback-runtime` | 3 | JS execution: the Hermes/Ibex FFI, warm-VM lifecycle, exec guards, the workerd/V8 conformance twin. |
| `snapback-engine` | 4 | The transport-independent engine — provisioning, cross-service orchestration, host-op implementations. |
| `snapback-server` | 5 | The axum app: ~180 routes, wire envelopes, admin serving, OAuth/MCP remotes. |
| `snapback-cli` | 6 | The clap surface (~40 command groups), guide command, MCP stdio, lifecycle. |
| `snapback` | 7 | Public façade: `snapback::embed` and the `snapback` binary. |
| `snapback-conformance` | 7 | Wire fixtures, conformance twin, vectors — proof bins exercising the contract from outside. |
| `snapback-tools` | 7 | Dev tools, agent-safe worker, benches. |

External-dependency confinement is gate-enforced: `rusqlite` only in the kernel
(plus the telemetry sidecar's recorded exception), `ibex-runtime` only in
`snapback-runtime`, `axum` only in `snapback-server`, `clap` only in
`snapback-cli`. Every crate is `publish = false`; only `snapback::embed` is a
supported Rust surface.

### `packages/` — the npm workspace

No build step anywhere: hand-authored ESM `.mjs` with hand-written `.d.mts`.
TypeScript is a checker, not a compiler. Fourteen packages form the publication
closure:

`@expo/snapback-cli` · `@expo/snapback-codegen` · `@expo/snapback-client` ·
`@expo/snapback-react` · `@expo/snapback-expo` · `@expo/snapback-expo-custody` ·
`@expo/snapback-contract` · `@expo/snapback-vite` · `@expo/snapback-app-cli` ·
`@expo/snapback-acceptance` ·
`@expo/snapback` · `@expo/snapback-runtime-darwin-arm64` ·
`@expo/snapback-runtime-linux-x64` · `create-snapback-app`

The rest (`snapback-harness`, `snapback-admin-client`, `snapback-sidecar`,
`snapback-hosted-supervisor`, `snapback-publication-authority`,
`snapback-expo-dev-identity`) are `private` in-repo infrastructure.

---

## Building Snapback itself

This is a different job from building an app *on* Snapback. Read
[`AGENTS.md`](./AGENTS.md) first — it is the operative contributor contract and
goes deeper than this section.

**Do not start with recursive submodule initialization.** The normal checkout
initializes only the small `vendor/llp` and `vendor/ccheever-skills`
submodules. The large `vendor/ibex` runtime checkout is initialized on demand
by the supported bootstrap entry point, which also prepares the ignored Hermes
artifacts:

```sh
scripts/bootstrap-ibex-runtime
cargo test
cargo run -- start
```

The bootstrap validates by actually **building, launching, and
handler-VM-qualifying** the binary (with `DYLD_*` scrubbed on macOS), not just
`cargo check`, and persists a digest-bound readiness receipt. Every failure path
exits with a stable `SNAPBACK_*` code. When the runtime state looks wrong, run
`scripts/ibex-doctor` for a read-only diagnosis before repairing anything by
hand.

By default the server tries `127.0.0.1:4287` and scans through `4387` for a free
port, stores data in `.snapback/dev.sqlite3`, and prints the admin URL on
startup. File-backed servers take an exclusive sidecar lock, so a second server
cannot silently mutate the same database:

```sh
cargo run -- start --port 9000 --db .snapback/other.sqlite3
cargo run -- start --memory
```

### Verification

```sh
bun install --frozen-lockfile              # root JS toolchain (Bun version pinned in package.json)
scripts/verify-local-proof                 # the canonical local proof (~164 gates)
SNAPBACK_VERIFY_EXACT=0 scripts/verify-local-proof   # core-only local iteration
node scripts/check-guide.mjs               # docs-only fast path
./ref-check --verbose                      # LLP corpus + @ref validation
```

Demos are the executable proof surface:

```sh
node packages/snapback-codegen/index.mjs demos/todo/snapback
node demos/todo/tests/acceptance/headless.mjs
node demos/card-game/tests/acceptance/authority-scope.mjs
```

The [demo catalog](./demos/README.md) is a *checked* projection of each demo's
`demo.snapback.json` — pick by client, target, maturity, proof command, and
honest nonclaims without opening every directory.

### Toolchain authority

One pin per language, single-sourced and asserted by
`node scripts/check-toolchain-authority.mjs`: Bun via `packageManager` +
`bun.lock`, Node via `.node-version` (consumed by every CI workflow through
`node-version-file`), Rust via `rust-toolchain.toml` coordinated with the
vendored Ibex pin. Root `npm install` is rejected. Upgrade procedures are in
[`AGENTS.md`](./AGENTS.md); no workflow edit is ever part of one.

---

## Contributing

Snapback is designed in the open as a corpus of **Linked Literate Programming**
documents. The workflow itself lives at <https://github.com/ccheever/llp>; this
repository keeps its own corpus under [`llp/`](./llp/).
[`llp/foundation/`](./llp/foundation/) links the kernel;
[`llp/current/`](./llp/current/) links the declared working set.

**Before you write code:**

1. Read the LLP that governs the subsystem you're touching. For non-trivial
   work, run the `llp-orient` skill to assemble a context pack of the
   constraints your change must respect.
2. Check [`guide/capabilities.md`](./guide/capabilities.md) so you don't
   reimplement something that already ships, or assume something that is a
   named gap.

**While you write:**

- Add `@ref LLP NNNN#section — short gloss` where code implements a non-obvious
  documented decision. When editing code that already carries an `@ref`, verify
  the referenced section still applies. Don't annotate mechanically.
- Land doc updates in the same commit as the change that motivated them.
- If you make a design decision worth preserving, write or update an LLP.
  Prefer extending an existing one over creating a new one.
- Building or substantially changing a demo? Write a diary entry in
  [`diaries/`](./diaries/) recording the concrete build experience — what was
  ergonomic, what was surprising, what needed a workaround, how it compared to
  React + Convex or Supabase.

**Tracking work:** prefer filesystem tickets under [`issues/`](./issues/)
(`issues/YYYYMMDD-slug.md`, moved to `issues/closed/` with a recorded
resolution) for repository-scoped bugs, follow-ups, and maintenance. Graduate to
Linear only when the work needs human project-management state, assignment,
cycles, or cross-repository coordination.

**Landing policy** — the three rules that surprise people most:

- **`main` moves fast**, often continuously for days, with many concurrent agent
  sessions pushing around the clock. Never design a gate that requires `main` to
  be quiet. Expect to `git fetch` + rebase right before every push.
- **Optimistic landing is the default** (LLP 0232). If affected tests passed and
  the merge adds no semantic conflict, land. Don't rerun expensive checks merely
  because `main` advanced. This does not relax publication, destructive
  migration, or security protocols.
- **Verification cadence follows LLP 0189.** Landings run fast/affected checks;
  the complete battery runs on schedule and its reds become fix-forward
  tickets, not retroactive invalidation of unrelated work.

**Publication posture** (LLP 0041): publish to npm rapidly and often —
whenever `main` carries meaningful surface changes and the qualified
publication path passes. No current users depend on stability, and expected
users are agents who read the docs, so landed-but-unpublished surface fixes are
a liability, not caution. (The current pause is the F-1 authorization work
above, not a change in posture.)

**Agent skills** are aggregated under [`skills/`](./skills/) and mirrored into
each agent's discovery path (`.claude/skills`, `.agents/skills`,
`.cursor/skills`, `.pi/skills`, `.opencode/skills`): `llp-orient` (context
before coding), `llp-create`, `llp-review`, `llp-adopt`, `llp-maintain`,
`llp-super-refine`, `llp-ship`. Run `scripts/sync-agent-skills` after pulling
upstream skill changes, and activate the tracked hooks with
`git config core.hooksPath .githooks`.

---

## Operating it as an agent

```sh
snapback mcp                                       # read-only guide resources
snapback mcp-control                               # typed control tools, local admin authority
snapback agent setup --print claude --server mcp   # generate client config instead of guessing
snapback guide <query|SNAPBACK_CODE|Symbol>        # budgeted lookup
snapback admin --ready-file .snapback/dev.ready.json   # open the admin console
```

`mcp` is least-authority and safe to wire into any agent. `mcp-control`
authenticates with the auto-minted local admin token and therefore grants
standing local admin authority — a real grant a cold agent should understand
before opting in. Neither grants hosted or remote authority.

---

## Project history

Snapback's predecessor was **Valet**
([expo/valet](https://github.com/expo/valet)) — a small Rust service alongside
SQLite, executing your code and using SQLite for storage. That general
architecture remains directionally right; empirical testing surfaced real
problems that made the first version hard, and recovering those lessons is
active design work rather than historical cleanup. See
[`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md).

## Brand

Logo, favicon, and app-icon assets are in [`brand/`](./brand/) with usage notes
in [`brand/README.md`](./brand/README.md). The vector mark
([`brand/snapback-mark.svg`](./brand/snapback-mark.svg)) is the canonical
master.

## License

MIT. Host it anywhere, including for other people.
