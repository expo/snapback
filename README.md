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
> The local target also has built-in email-code sessions,
> authorization-scoped live delivery, coordinator-backed credential
> transitions, and lease-gated retained reads.
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
scripts/bootstrap-ibex-runtime
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
- Local sessions-mode auth with server-derived principals, connection-bound
  live grants, auth-invalidation barriers, and signed authorized retained-query
  leases.
- HTTP endpoints for health, inspect, schema/function load, reset, seed, query,
  mutation, live subscribe, outbox drain, and ephemeral publish/subscribe.
- The existing typed in-memory ephemeral store: process-local rooms, TTL expiry,
  connection-owned cleanup, `scopeEpoch`/`entryVersion`, rate and payload limits,
  and an in-memory client overlay.

These auth guarantees are local-target guarantees. ENG-24607 now defines and
enforces the local transport fence, hosted-capability descriptor, and honest
browser bearer/XSS posture, but it does not make this target hosted-auth ready.
The local target deliberately reports no target-owned external TLS, trusted
effective-source derivation, shared authentication throttle, multi-replica
invalidation, or sender-constrained browser credential.

The local runtime reports Ibex as the canonical engine and detects an installed
`ibex` binary. Ibex is vendored as a git submodule at [`vendor/ibex`](./vendor/ibex);
Snapback looks for `SNAPBACK_IBEX`, then `vendor/ibex/target/debug/ibex` or
`vendor/ibex/target/release/ibex`, then `ibex` on `PATH`.

A clean checkout needs Ibex's ignored Hermes artifacts before ordinary Cargo
builds will work. For normal Snapback work, use the root bootstrap:

```sh
scripts/bootstrap-ibex-runtime
```

The script first makes sure the `vendor/ibex` submodule checkout itself
exists, running `git submodule update --init --recursive -- vendor/ibex` when a
fresh clone or worktree has not initialized it yet. If the submodule is
uninitialized but the directory already contains stray files, it still
attempts the init (a retained submodule gitdir can check out over regenerable
artifacts); only when git cannot complete it does it refuse with
`SNAPBACK_IBEX_SUBMODULE_WEDGED` and print the recovery commands, without
writing anything itself (writing artifacts into an uninitialized submodule
path is how fresh worktrees used to get permanently blocked at
`git submodule update --init`). `scripts/ibex-doctor` diagnoses these states
read-only.

With the checkout in place, the script reuses prepared artifacts from a sibling
`../ibex` checkout when they are present, copying them into the ignored
`vendor/ibex/ios`, `vendor/ibex/linux`, and `vendor/ibex/tools/hermes`
locations that Ibex's `build.rs` already expects. If no complete sibling
artifact set exists, it falls back to
`vendor/ibex/scripts/download-hermes.sh`, which may download or build
Hermes for the current platform. On macOS, this matters because the release
Hermes xcframework does not contain the pure macOS framework Cargo links. Set
`SNAPBACK_IBEX_CHECKOUT=/path/to/ibex` if your prepared checkout is not the
sibling `../ibex` directory.

With the artifacts in place, the script validates by actually **building and
launching** the `snapback` binary (with `DYLD_*` scrubbed on macOS), not just by
`cargo check`. On macOS the binary loads `hermesvm.framework` through an
`@rpath`-relative install name, so `build.rs` bakes in the matching `LC_RPATH`;
that is why `cargo run` works in a fresh worktree without setting
`DYLD_FRAMEWORK_PATH`, even though macOS SIP strips `DYLD_*` for protected
process trees. If the binary cannot load the framework at launch, the bootstrap
fails with `SNAPBACK_IBEX_RUNTIME_LOAD_FAILED` instead of leaving the crash for
the first real run.

If you specifically need to build the vendored runtime CLI rather than use the
sibling prebuilt binary, run:

```sh
cargo build --manifest-path vendor/ibex/Cargo.toml --bin ibex
```

JavaScript handlers with `ctx.db` host calls now run through the embedded Ibex
runtime. The older manifest-backed `HostPlan` runtime remains available for
deterministic fixtures and bring-up.

## Demos

Runnable reference apps live under [`demos/`](./demos), with shared
codegen/client/bridge in [`demos/_kit/`](./demos/_kit). The first is the todo
list ([`demos/todo/`](./demos/todo)): one source-authored Snapback backend
consumed by a required headless surface and an optional, working Contract/Exact
surface. See [LLP 0015](./llp/0015-demo-application-suite.plan.md) for the plan
and [`diaries/0001-todo-demo.diary.md`](./diaries/0001-todo-demo.diary.md) for the
build record. [`demos/todo-v2/`](./demos/todo-v2) is a comparison demo that adds
priority and specifically exercises the LLP 0021 Contract/Exact hardening slice;
see [`diaries/0004-todo-v2.diary.md`](./diaries/0004-todo-v2.diary.md).
[`demos/card-game/`](./demos/card-game) proves two real sessions over one
hidden-hand query: disjoint finite and live results, logout blanking, and honest
offline retention only until the exact authorized-lease deadline. See
[`diaries/0013-card-game.diary.md`](./diaries/0013-card-game.diary.md).

```sh
bun install --frozen-lockfile                         # root JS toolchain (packageManager pin)
node packages/snapback-codegen/index.mjs demos/todo/snapback   # generate manifests from source
node demos/todo/tests/acceptance/headless.mjs     # required surface (node)
bun  demos/todo/tests/acceptance/contract.mjs     # Contract/Exact surface (installed packages or local override)
node demos/card-game/tests/acceptance/authority-scope.mjs # sessions/live/offline auth proof
```

The canonical CI proof requires the full Contract/Exact and admin checks. For a
deliberately core-only local iteration, use:

```sh
SNAPBACK_VERIFY_EXACT=0 scripts/verify-local-proof
```

The default local proof runs the Contract/admin checks when each target
surface's committed Exact package lock has been installed by the
required-surface gate. CI sets `SNAPBACK_VERIFY_EXACT=1`, so unavailable Exact
dependencies fail instead of skipping. `SNAPBACK_EXACT_ROOT` remains a local-development
override, not the default build path. Acceptance probes only the package tree
owned by the surface under test; an install in another demo or `admin-ui` never
turns a missing target green.

The repository root has one JavaScript dependency authority: the exact Bun
version in `package.json` plus `bun.lock`. Root `npm install` is rejected; npm
locks under self-contained demo subprojects remain independent where declared.

To upgrade the root Bun authority, first install/select the intended exact Bun
release and verify it with `bun --version`. Change the `packageManager` value in
`package.json`, run `bun install` with that same binary to regenerate `bun.lock`,
then run:

```sh
bun install --frozen-lockfile
node scripts/check-toolchain-authority.mjs
scripts/verify-local-proof
```

The Node runtime that executes proof scripts and package tests is pinned the
same way: `.node-version` at the repository root is the single exact Node
authority. Every CI workflow consumes it via `node-version-file`, and
`scripts/check-toolchain-authority.mjs` asserts the active `node` matches it,
so the same commit cannot run the proof under drifting Node patch releases.
Package `engines` ranges stay compatibility declarations, not the CI
authority. To upgrade Node, install/select the intended exact release (any
version manager that reads `.node-version` works), verify it with
`node --version`, update `.node-version` to that release, then run:

```sh
node scripts/check-toolchain-authority.mjs
scripts/verify-local-proof
```

No workflow edit is part of a Node upgrade; the workflows read the same file.

Rust upgrades are coordinated with the linked runtime rather than floated in
Snapback alone. First land the exact channel in Ibex's `rust-toolchain.toml`,
update Snapback's `vendor/ibex` submodule to that Ibex commit, and set the root
`rust-toolchain.toml` to the identical channel. Then run
`scripts/bootstrap-ibex-runtime`, `node scripts/check-toolchain-authority.mjs`,
and the canonical local proof. The authority check intentionally fails if the
root and vendored pins differ or if the active compiler does not match them.

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
