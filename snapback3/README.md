# Snapback 3

An independent Snapback candidate that designs the whole application together:
authoring, live data, offline work, interface behavior, and the development loop.
The design and experiment are in [LLP 2000](../llp/2000-snapback3.rfc.md).

This directory is its own Cargo and Bun workspace. Snapback 1 remains at the
repository root; Snapback 2 and Snapback 4 live beside it. All four can be
inspected in the same checkout.

The first implementation reuses Snapback 2's Quarry compiler, certified Rust
engine, SQLite storage, TypeScript evaluator, Unicode contract, and semantic
corpus from `a93edb979a5cbe6357f1fc1f95b66f85bd308844`. Its client and Node
development server are new. Builds use Rolldown and TypeScript.

The initial experiment uses independently acquired query resources sharing
authorized facts. A complete resource remains useful when a neighboring
resource is unknown. Durable operations own their retry identity and terminal
receipt, so applications do not coordinate ID grants or transport retries.

The first working slice is [Commonroom](examples/chat/README.md): a responsive
chat app with membership authorization, live messages, unread state, conditional
edits, saved drafts, and durable offline sends. Read the [builder guide](guide.md)
for the application-facing concepts and API.

From this directory, with Bun, Node 22.12 or newer, and Rust installed:

```sh
bun install --frozen-lockfile
cargo build -p snapback3-worker --release
node build.mjs
node examples/chat/build.mjs
node packages/snapback3/dist/cli.mjs dev examples/chat --port 4383
```

Open [Commonroom](http://127.0.0.1:4383). The development server signs in local
personas, seeds only a fresh database, and installs accepted Quarry changes
without resetting data. Failed compilation keeps the previous generation serving.
Interface changes need another example build. `check examples/chat` certifies
the backend and writes its inferred API declarations. `serve` disables personas
and development seeding; it is a foreground self-hosted owner, not a managed host.

Run focused verification:

```sh
node build.mjs --check
cargo test -p snapback3-core
bun test tests/resource-client.test.ts examples/chat/tests
node scripts/test-owner.mjs
bun test tests/browser.test.ts
bun run test:compiler
bun run test:evaluator
```

The browser witness uses an isolated temporary application and a headless browser.
Set `SNAPBACK3_BROWSER` to a Chromium executable when Chrome is not installed in
its usual macOS location. It uses actual IndexedDB and the compiled example.
Build the SDK and example before running it.

Create and verify an installable local package with `node scripts/pack.mjs`.
It builds a private experimental tarball under `.snapback3/packages/`, bundles
the worker for the current operating system and architecture, then installs it
outside the repository and tests its CLI, generated types, and a real SDK write.
This is a host-specific local package; it has not been published to npm.

To exercise the large, deterministic chat fixture:

```sh
node packages/snapback3/dist/cli.mjs check examples/chat
node scripts/generate-hub.mjs
node scripts/bench-hub.mjs
```

The benchmark seeds a separate temporary database and reads all 1,000 inbox
entries and 100,015 messages through authorized query pages. Its report states
the measurement boundary: Rust worker and JSONL, including serialization, but
excluding browser persistence and rendering. It is not a full Clique or sibling
comparison. Input files and measurements live in ignored `.snapback3/fixtures/`
under the example.

This remains an experimental candidate. Runtime admission supports persisted
Quarry queries and mutations. Effects, jobs, schedules, channels, connected
presence, clock-driven live queries, and media are refused until their runtime
slices exist. Mutation timestamps work. Native clients, hosted deployment,
backup/restore tooling, automatic cache eviction, and complete offline dataset
acquisition remain work to do. Inherited compiler exports do not imply those
capabilities are served. No comparative performance win or production readiness
is claimed.

Commonroom can reopen with the network disconnected after a successful first
online visit installs its application shell. The service worker caches only
versioned interface assets. The SDK separately owns account data and operations.
Updates wait for older tabs to close and preserve saved drafts.

The first build experience and scoped measurements are recorded in
[Diary 0120](../diaries/0120-snapback3-commonroom.diary.md).

MIT licensed; see [LICENSE](LICENSE).
