<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="brand/snapback-logo-dark.png" />
    <img alt="Snapback" src="brand/snapback-logo.png" width="440" />
  </picture>
</p>

# Snapback

**A complete, coherent backend for Contract/Exact apps — light enough to
prototype on for free, built to scale to real production load. MIT licensed,
host it anywhere, including for other people.**

> **Status: early design with a first local-dev core slice.** Snapback is still
> primarily in the vision-and-design stage, worked out in the open as a corpus
> of [LLP design documents](./llp/). The repository now contains a Rust local
> development server with SQLite storage, manifest-backed query/mutation
> invocation, live-query updates, and the in-memory ephemeral realtime state
> backend from
> [`llp/0013-ephemeral-realtime-state.rfc.md`](./llp/0013-ephemeral-realtime-state.rfc.md).
> Start with the project explainer,
> [`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md).

## What it is

Snapback aims to be everything you need behind an app, under one roof, with the
pieces designed to work together — a bit like Ruby on Rails, but for the modern
mobile-first, local-first, realtime world.

The primary client target is the **Contract/Exact** app stack. React and Expo
are first-class secondary consumers — made to work as well as they can, without
driving the core design the way Contract/Exact integration does.

Snapback is also **agent-first**. We expect essentially all Snapback framework
code and Snapback app code to be written by AI agents, so syntax, APIs, tools,
and feedback loops optimize for agents getting close to guarantees and
validating their own work. Human ergonomics are useful only when they do not
weaken that priority.

Two properties matter most:

- **Scale to zero.** An idle app should cost (almost) nothing and need no
  babysitting, so you can prototype without worrying about bills or ops.
- **Scale up.** The same system is meant to carry a realistically popular app.
  The north-star goal is something like Partiful at a few hundred thousand
  monthly users on SQLite and a lightweight JavaScript runtime, within a
  workload envelope that still needs to be benchmarked and specified.

## The parts

**v1**

- **Code execution** — your backend logic, in JavaScript. Runs on
  [Ibex](https://github.com/ccheever/ibex) for local and size-sensitive
  deployments, or a V8-based runtime when you're on Cloudflare or want its
  performance characteristics.
- **Data storage** — SQLite at small scale, Postgres at large scale, with one
  abstraction over both so graduating from SQLite to Postgres is a smooth,
  mostly seamless move rather than a rewrite.
- **Auth / login** — a first-class auth system (think WorkOS/Clerk) whose data
  lives right next to the rest of your data, so you can join, query, and export
  it freely. Bring your own provider if you prefer.
- **Asset storage** — uploads for photos and video first (with a processing
  pipeline), plus other file types. Asset bytes live on the filesystem or in
  S3-style object storage; metadata, ownership, permissions, references, and
  processing state live with the rest of the application data.
- **Cron** — scheduled code execution. Every mature backend grows this; Snapback
  has it built in.
- **Notifications** — email, SMS, and push, as a thin layer you configure with
  your own provider API keys.

**Planned for v2 (post-launch)**

- **AI gateway & data gateway** — call AI APIs, or fetch data like sports scores
  and weather, through Snapback (some free, some paid).

## Principles

- **Paved path.** Do whatever you want — but the blessed ways of doing things
  work *really* well.
- **Run anywhere.** Your laptop, your own hardware, Cloudflare, AWS, Google
  Cloud, Azure, DigitalOcean, Hetzner, Railway, and Fly.io. (Cloudflare is
  unusual and gets dedicated effort.)
- **Truly open.** MIT licensed — no source-available licenses that stop you from
  hosting it for other people.

## Built for mobile, local-first, and realtime

Contract/Exact makes mobile a first-class concern; web and desktop are supported
but secondary.

Two capabilities are required, not optional:

- **Local-first with partial sync.** A mobile app has to keep working offline —
  imagine if WhatsApp showed you no messages, not even old ones, the moment you
  lost signal. Snapback syncs the relevant slice of your data down to the device.
- **Realtime live updates.** If someone RSVPs to your party while you're looking
  at the list, the guest should appear and the count should tick up instantly.

## Project history

Snapback's predecessor was **Valet** ([expo/valet](https://github.com/expo/valet)),
an earlier prototype whose general architecture remains directionally important:
a small Rust service running alongside SQLite, executing your code and using
SQLite for storage. Empirical testing surfaced real problems that made that
version hard; recovering those lessons is early design work, not historical
cleanup. See
[`llp/0000-snapback.explainer.md`](./llp/0000-snapback.explainer.md) for details.

## Next design work

The immediate LLP work should make the broad claims above implementable:

- Storage abstraction and the SQLite-to-Postgres portability contract.
- Local-first partial sync and realtime update semantics.
- Runtime and deployment matrix, including Cloudflare-specific constraints.
- Agent DX and validation feedback loops.
- Auth/login and the bring-your-own-provider boundary.
- Valet retrospective and benchmark lessons.

## Current code

The first implemented slice is a local development server focused on SQLite and
the canonical Ibex runtime target:

```sh
git submodule update --init --recursive
cargo test
cargo run
```

By default the server tries `127.0.0.1:4287` and, if that port is busy, scans
through `127.0.0.1:4387` until it finds an available local port. It stores data
in `.snapback/dev.sqlite3` and prints the actual admin URL on startup. Use
`--memory` for an in-memory database, or `--db` / `--port` to choose a different
local database or pin an exact port:

File-backed servers also take an exclusive sidecar lock next to the SQLite file,
so a second server will not accidentally mutate the same app database from a
different port. Use the already-running server, stop it, pass `--memory`, or
choose a different `--db`.

```sh
cargo run -- --port 9000 --db .snapback/other.sqlite3
cargo build
./target/debug/snapback
```

`snapback-local` remains available as an alias for the same local server.

Implemented now:

- SQLite infrastructure tables, schema application, reset, and declarative seed.
- Manifest-backed single-table query and mutation plans.
- Server-authoritative mutations with one commit version and read-set conflict
  validation.
- Live-query subscription snapshots and online replace updates through the
  durable realtime lane.
- HTTP endpoints for health, inspect, schema/function load, reset, seed, query,
  mutation, live subscribe, outbox drain, and ephemeral publish/subscribe.
- The existing typed in-memory ephemeral store: process-local rooms, TTL expiry,
  connection-owned cleanup, `scopeEpoch`/`entryVersion`, rate and payload limits,
  and an in-memory client overlay.

The local runtime reports Ibex as the canonical engine and detects an installed
`ibex` binary. Ibex is vendored as a git submodule at [`vendor/ibex`](./vendor/ibex);
Snapback looks for `SNAPBACK_IBEX`, then `vendor/ibex/target/debug/ibex` or
`vendor/ibex/target/release/ibex`, then `ibex` on `PATH`. Build the vendored
runtime from the submodule once its Hermes prerequisites are installed:

```sh
cargo build --manifest-path vendor/ibex/Cargo.toml --bin ibex
```

JavaScript handlers with `ctx.db` host calls are not wired yet. The first
callable handler path is the restricted manifest-backed `HostPlan` runtime used
by the tests; Ibex-backed handlers return a structured capability diagnostic
until the host-call bridge lands.

## Demos

Runnable reference apps live under [`demos/`](./demos), with shared
codegen/client/bridge in [`demos/_kit/`](./demos/_kit). The first is the todo
list ([`demos/todo/`](./demos/todo)): one source-authored Snapback backend
consumed by a required headless surface and an optional, working Contract/Exact
surface. See [LLP 0015](./llp/0015-demo-application-suite.plan.md) for the plan
and [`diaries/0001-todo-demo.diary.md`](./diaries/0001-todo-demo.diary.md) for the
build record.

```sh
node demos/_kit/codegen.mjs demos/todo/snapback   # generate manifests from source
node demos/todo/tests/acceptance/headless.mjs     # required surface (node)
bun  demos/todo/tests/acceptance/contract.mjs     # Contract/Exact surface (needs ../exact)
```

## Design docs (LLP)

This repository uses **Linked Literate Programming (LLP)** to keep design
rationale next to the code that will implement it. Design decisions live as
numbered documents in [`llp/`](./llp/):

- Put durable rationale in `llp/NNNN-slug.type.md` documents.
- Annotate code with `@ref` when an implementation decision is governed by an
  LLP section.
- Run `./ref-check --verbose` before pushing changes that touch LLP documents or
  referenced code (CI runs the same check).
- Workflow skills are exposed through [`skills/`](./skills/); the skill files
  are symlinked from upstream repos under [`vendor/`](./vendor/) and refreshed
  with [`scripts/sync-agent-skills`](./scripts/sync-agent-skills).
- Agent-facing rules are in [`AGENTS.md`](./AGENTS.md).

The LLP workflow itself comes from <https://github.com/ccheever/llp>.

## Brand

Logo, favicon, and app-icon assets live in [`brand/`](./brand/), with usage
notes in [`brand/README.md`](./brand/README.md). The vector mark
([`brand/snapback-mark.svg`](./brand/snapback-mark.svg)) is the canonical master.

## License

MIT.
