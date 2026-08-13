---
title: The authoring loop
id: getting-started.the-authoring-loop
order: 2
audience: agent-first
capabilities: [backend.codegen, authoring.declaration-suggestions, operating.packaged-dev-loop, testing.acceptance, operating.inspect]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0041-packaged-dev-loop.rfc.md, llp/0245-infer-show-freeze-declarations.rfc.md, src/cli.rs, packages/create-snapback-app/cli.mjs, packages/snapback-cli/index.mjs, packages/snapback-cli/templates, packages/snapback-codegen/index.mjs, scripts/snapback-package-cold-install.mjs, scripts/verify-local-proof]
examples: [packages/snapback-cli/templates/todo-contract, packages/snapback-cli/templates/react, packages/snapback-cli/templates/expo-chat, packages/snapback-cli/sessions-dev-loop.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/todo/surfaces/headless/run.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-12
reviewed-authorities-digest: sha256:0af8f5acd5cd1550dd9e76f0f7bd95bafe486035c46d59b08ca37aba0bd02d16
---

# The authoring loop

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The cycle you repeat while building on Snapback:

```text
edit snapback/*.mjs  ->  regenerate  ->  run the acceptance suite  ->  inspect
```

The `snapback` command ships in the published `@expo/snapback-cli` package.
Install it once, globally, with whichever package manager you use:

```sh
npm install -g @expo/snapback-cli    # or: bun add -g @expo/snapback-cli
```

The current source and packed-package React path is:

```sh
snapback doctor --json
snapback new my-app --template react
cd my-app
bun install
bun run dev
```

<!-- since: 0.1.12 -->

Five templates ship in the packaged CLI:

- `todo-contract` — the smallest backend-first scaffold, with generated
  headless client references and acceptance but no Contract UI.
- `react` — a minimal React/Vite web app with a live todo query, mutation,
  and connection state.
- `crud-dashboard` — a React/Vite project dashboard with relational directory
  reads, independent live detail, and optimistic CRUD.
- `media-feed` — an Expo iOS/Android/web feed with image upload, a composed
  publish command, and collision-safe load-more pagination.
- `expo-chat` — the golden-path Expo conversation starter described below.

The `expo-chat` template carries
the LLP 0176 conversation surface as runnable code: a `messages` table
with an image `assetRef` field, the `messageImageUpload` intent, live
queries, the generated `conversation` surface (reads, a bound `sendText`
mutation, the composed `send` command with optional image upload, and
typing presence), and a React Native chat screen driving all of it
through `useSurface`. Scaffold it with
`snapback new my-chat --template expo-chat` and edit the working example
instead of composing that wiring from prose. The starter ships sessions
mode (`auth: { mode: 'sessions' }`) with seeded personas: the supervised
dev loop mints an ordinary session automatically, so authenticated send
and image upload work with zero edits. It still passes the seeded persona
as an explicit `senderId` argument and keeps chat history public-read; a
production chat derives sender identity from the adopted session and
scopes reads to conversation membership
([auth](../auth/sessions-and-principals.md)).

<!-- since: 0.1.15 -->

The same scaffold is also reachable through the ecosystem-standard entry
point, the `create-snapback-app` package (first published with the 0.1.15
closure):

```sh
npm create snapback-app my-chat
# equivalently: npx create-snapback-app my-chat
#               bun create snapback-app my-chat
#               pnpm create snapback-app my-chat
```

It is a thin wrapper — argument parsing and next-step output only — that
delegates to the same `snapback new` scaffold mechanism and template
registry in `@expo/snapback-cli`. Its default template is `expo-chat`;
`create-snapback-app --help` lists every template the installed CLI ships,
and `--template <name>` selects one.

The generated `dev` script is one supervisor:
`snapback dev snapback --client . --client-command vite`. It generates the
backend, starts or attaches to the native server, loads the app, then starts
Vite and watches both sides. Browser code uses only Vite's relative
`/__snapback` relay; it does not receive the loopback origin, admin token,
runtime path, or repository path. The template uses generated query/mutation
references and the first-party React provider/hooks; it does not add
application-owned subscription cleanup. If you launch Metro or Expo yourself
— including `CI=1 snapback dev --client-command "npx expo start"` — do not
inherit a truthy `CI`: Expo/Metro disable file watching and you will serve a
stale bundle. Prefer `snapback dev --expo`, or unset `CI` / pass `CI=0`.
`snapback dev` prints `SNAPBACK_EXPO_METRO_WATCH_INERT` as an advisory when
it can see that environment; it does not refuse.

The React/Vite templates import the relative relay base from the generated
development virtual module:

```ts source=packages/snapback-cli/templates/react/src/snapback-dev.d.ts
declare module 'virtual:snapback/dev' {
  export const snapbackBasePath: string;
  export const snapbackDevState: Readonly<{
    mode: 'off' | 'external' | 'attach' | 'managed' | 'auto';
    shape: string | null;
    ready: boolean;
    basePath: string;
  }>;
}
```

`@expo/snapback-vite` supplies `virtual:snapback/dev`; there is no file to
install or generate at that specifier. A hand-built TypeScript/Vite app must
add the ambient declaration above (conventionally
`src/snapback-dev.d.ts`) so the compiler knows `snapbackBasePath` and
`snapbackDevState`. Import `snapbackBasePath` in the client entry and pass it
to the Snapback provider/client instead of baking in a loopback server URL.

The package `@expo/snapback-cli` supplies the `snapback` command — the
terminal npm identity (LLP 0115 decision 9): the workspace name and the
registry name are the same. The recorded pre-migration public closure
(`0.1.x`) was published under the interim `@ccheever/snapback-*` aliases from
the then-`@snapback/*` source names; those receipts remain verifiable as
lineage. The original byte-verified `0.1.0` closure contained the
macOS/arm64 and Linux/x64 runtimes plus Contract, client, codegen, React,
app CLI, and developer-loop CLI packages; clean GitHub-hosted machines on
both supported runtime tuples installed that exact closure and passed the
original `todo-contract` scaffold/generate/dev/watch proof. The published
closure has since widened to eleven packages, including
`@expo/snapback-expo` and `create-snapback-app`.

Which closure you get from npm is recorded, not remembered:
[`published-closure.json`](../published-closure.json) is the authority, and
its two fields carry the tradeoff. `newestPublished` is the newest closure on
the registry — what the `latest` tag installs. `newestQualified` is the
newest closure that also carries a complete public-qualification receipt from
the LLP 0137 G1 arm
(`demos/improvement-sweep/arms/g1-public-package-qualification/`):
`snapback new --template react`, `bun install`, `snapback generate`, a strict
typecheck, `vite build`, the `snapback dev` lifecycle, template live
acceptance with real handler execution, and a clean stop, proven from a clean
external directory. When the two fields differ, the newer publications are
deliberate fast-path releases with no qualification-arm receipt of their own
(the "Fast-path pre-consumer release" section of
[LLP 0041](repo:llp/0041-packaged-dev-loop.rfc.md)): install `latest` for
the newest surface and fixes, or pin the recorded `newestQualified` version
when you need the independently proven closure.

Still do not infer that a published closure contains every surface in the
current source tree: source lands continuously, and a packaged consumer has
whatever the newest published version froze. When a page describes a surface
newer than the newest closure, it says so. This rule is mechanical: pages carry
`since:` / `unreleased:` fences checked against
[`published-closure.json`](../published-closure.json) by
`scripts/check-guide.mjs`.

On each supported tuple the mapped runtime package carries the prebuilt server
and Hermes runtime. `doctor` first launches that relocated binary with
ambient dynamic-loader overrides removed, then creates a disposable app and
database, generates and loads its bundle, invokes a query, commits a mutation,
opens and closes a live subscription, stops the owned server through its ready
descriptor, and removes the temporary state. Its `snapback.cli-doctor.v2`
result reports one stable code per completed boundary; a launch-only result is
test instrumentation and never the installed-product claim. Other host tuples
report `SNAPBACK_IBEX_HOST_UNSUPPORTED`—they are not source-build fallbacks
disguised as installs. The former `@snapback/*` source scope belongs to an
unrelated npm product, which is why publication historically used the
`@ccheever/snapback-*` aliases; under the terminal `@expo/snapback-*` scope
application imports and published names are one identity and no alias
mapping exists.

## 1. Edit

Change `schema.mjs`, `functions.mjs`, or `seed.json`
([your first backend](./your-first-backend.md) covers each; apps on the
legacy bundled-module form also edit `handlers.mjs`).

## 2. Regenerate

In a source checkout, install the pinned workspace dependencies once before
running repository codegen:

```sh
bun install --frozen-lockfile
```

```sh
node packages/snapback-codegen/index.mjs <app>/snapback
```

Outside this repository, use the packaged equivalent:

```sh
snapback generate snapback
```

`snapback dev snapback` runs that generation first, starts or attaches to the
native server via `.snapback/dev.ready.json`, loads the generated schema and
functions, installs a generated versioned seed only for a newly created
managed database, and watches source changes through one coalesced generation
at a time. Later starts and watch reloads require the exact installed seed
identity to match; they do not reset or restore user data. A changed
`seedVersion` therefore reports `SNAPBACK_SEED_MIGRATION_REQUIRED` until you
choose migration or an explicit destructive reset-install. For the local dev
destructive branch, `snapback reset --dev-fresh` is the one-shot path: fresh
database, seed re-install, and sessions verification or supervised re-mint.

The command infers `dev` versus `sessions` from the generated schema.
Sessions-mode managed starts supply the complete closed schema/functions
startup carrier before listener bind, including on backend restart; later
reloads use the complete admin-authorized provisioning pair instead of the
dev-only raw host-load verbs. The attach path validates the database target
before reading the managed owner-only token. A different target fails with
`SNAPBACK_DEV_SERVER_TARGET_MISMATCH`. If initial attach/load fails, a server
started by this command is stopped. If later generation succeeds but live load
fails, the event state is `generated-but-not-loaded`; generation errors are
the distinct `generation-failed` state.

Use `snapback --help` to enumerate the complete packaged and delegated native
surface. `snapback <command> [<subcommand>...] --help` is non-executing and
selects the longest registered wrapper path, so commands such as
`snapback backup create plan --help` show their actual required flags rather
than only the top-level backup summary. Package help also declares whether the
selected command is one-shot or long-running, its machine output, exit
taxonomy, and recovery channel. `snapback hosted lifecycle --help` lists its
closed verbs, transport flags, and current availability gate.

Bare `snapback` is also discovery-only and prints root help. Start the normal
authoring loop explicitly with `snapback dev`; use native `snapback start` only
when a lower-level harness deliberately owns server loading and lifecycle.

<!-- since: 0.1.21 unreleased -->
> **Unreleased.** Declaration suggestions are newer than the newest published
> `@expo/snapback-*` closure, 0.1.20; use them from this source checkout until
> a later closure is published.

## Suggest, review, and apply a result contract

After generation has produced current context types, ask Snapback to derive a
result-only candidate from one operation's TypeScript/JSDoc return evidence.
Review the ordinary patch and its grouped runtime/type consequences first:

```sh
snapback author suggest snapback/functions.mjs#createTodo --format patch
```

Retain the machine record when you want the stale-safe apply seam:

```sh
snapback author suggest snapback/functions.mjs#createTodo --json > suggestion.json
```

Then apply exactly that one suggestion. The command rereads the complete
definition/helper/type/schema/compiler input closure and writes atomically
only when its identity and exact patch target still match:

```sh
snapback author suggestion apply suggestion.json --json
```

An `exact` or `schema-derived` candidate has a complete patch. `widened`
evidence deserves extra review; `holed` and `refused` candidates deliberately
have no patch until an author supplies the missing bound, refinement, or
closed shape. The suggestion receipt never becomes runtime authority: normal
generation freezes the accepted `result:` declaration and derives runtime
validation plus generated-client types from that source.

When `snapback dev` runs without a TTY, stdin accepts optional
`snapback.dev-command.v1` JSON lines while it remains open. EOF only closes
that control channel: it does not stop the server, watcher, or generated
client arm. Stop a detached loop with SIGINT/SIGTERM; an interactive terminal
may also use `q` or Ctrl-C. This is deliberately different from stdio MCP
servers, where EOF ends the protocol process.

If a selected native runtime predates the generated artifact shape, the loop
reports `SNAPBACK_RUNTIME_ARTIFACT_IDENTITY_MISMATCH` with the exact selected
binary, its independent build stamp when available, the artifact paths, and
two safe recovery paths: rebuild from the same source revision or point
`SNAPBACK_RUNTIME_BINARY` at a compatible binary. Do not delete generated
fields or hand-edit artifacts to fit an older runtime.

Codegen is deterministic and **fails closed** — on error it writes nothing
and exits 1 with stable diagnostic codes on stderr, so there is never
silently stale output. On success it prints an author summary and the
`inputsHash` freshness key. Commit `generated/artifacts.json` with your source
change, plus only projections explicitly named by consumer policy. The
complete graph is regenerated under `.snapback/codegen-cache/<inputsHash>/`;
see [generated artifact custody](./generated-artifacts.md). The server compares hashes and
rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
`SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`) rather than serving them.

If you forget this step, the very first server load or acceptance run tells
you; nothing downstream guesses.

A raw `ERR_MODULE_NOT_FOUND` for `acorn`, `esbuild`, or `typescript` means the
source checkout has not completed the pinned install above. It is a contributor
environment failure, not an application diagnostic. Packaged
`snapback generate` installs these as ordinary package dependencies.

## Evolve a table that already has data

Adding an **optional** field to a populated table is an ordinary edit, not a
migration ceremony: change the schema and let the running `snapback dev`
watch reload pick it up. The reload evolves the catalog in place, and live
handles may stay attached while it happens — a subscriber does not have to be
torn down first.

What matters is *where* you do it. Stop the server, regenerate, and restart,
and a sessions-mode app refuses with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`, whose details carry the expected
and observed deployment identities: the settled deployment's startup carrier
no longer matches the artifacts on disk. The recovery is the running-server
path above — evolve through the watch reload rather than through a restart.

Additive changes (new optional fields, new tables, new indexes) are what this
loop supports. Destructive changes — dropping a field, tightening an optional
field to required, changing a field's type — are refused by the conservative
applier; they need the reviewed migration path
([reviewed migrations](../backend/migrations.md#run-the-reviewed-loop);
design: [LLP 0081](repo:llp/0081-reviewed-storage-evolution-and-migrations.rfc.md)),
not a redeploy. Seeded data is separate again: a changed seed identity reports
`SNAPBACK_SEED_MIGRATION_REQUIRED` and is resolved on the
[versioned seeds](../backend/versioned-seeds.md) page, not here.

## 3. Run the acceptance suite

Headless first — the required surface is driveable without any UI
(LLP 0012). A suite boots its own isolated server and drives the real
product path:

```sh
cd <generated-app>
bun run test
```

The generated todo and React starters make that default live: it boots and
loads an isolated Snapback target, executes generated query and mutation
references, verifies loaded artifact identity, cleans up, and prints a
`snapback.starter-acceptance.v1` receipt. Use `bun run test:static` for the
faster generated-file/source-coherence check; it does not boot Snapback and
does not satisfy acceptance. The templates declare `packageManager: bun`, so
Bun is the paved runner; the scripts themselves are package-manager-agnostic
(`npm test` / `npm run test:static` are the equivalents if you manage the
generated app with npm). Repository demos that do not use a generated
starter run their named headless suite directly, for example
`node <app>/tests/acceptance/headless.mjs`.

Exit `0` = every declared check passed; `1` = a check failed or the run was
short (zero checks can never pass); `2` = setup error. See
[testing/acceptance](../testing/acceptance.md) for the harness and server
lifecycle discipline.

For a demo in this repo, the whole-repo proof is
`scripts/verify-local-proof` (add `SNAPBACK_VERIFY_EXACT=0` for a
deliberately core-only iteration; merge CI requires the Exact-gated block).

## 4. Inspect

A running server tells you what it is actually serving. `snapback dev`
prints the admin console URL on startup, and the packaged CLI opens the
console against the supervised server's ready descriptor:

```sh
snapback admin --ready-file .snapback/dev.ready.json
curl http://127.0.0.1:4287/inspect
```

(Contributors running the server from a source checkout get the same admin
URL printed by `cargo run`.)

`GET /inspect` is the public projection (instance, capability facts);
`GET /_snapback/api/inspect` is the admin-gated full view, and the admin
console renders the same surface in a browser — the author's debugger for
"what schema/functions/data does this server hold right now". Structured
failures everywhere carry stable `SNAPBACK_*` diagnostic codes
(`{ code, severity, subsystem, message, details }`), so match on
`error.diagnostic.code`, never on message text.

## Anti-patterns

- **Do not hand-edit the review manifest/cache or skip the regenerate step** — the
  server's stale-artifact rejection exists because "it probably still
  matches" was wrong often enough.
- **Do not assert on diagnostic message strings.** Codes are the contract;
  messages are prose.
- **Do not point a new suite at a server you didn't start.** Suites own
  their server lifecycle; see
  [testing/acceptance](../testing/acceptance.md).
- **Do not parse server logs for readiness.** `snapback dev` consumes the
  ready-file descriptor and verifies the live target; log text is not a
  lifecycle protocol.
- **Do not set `SNAPBACK_RUNTIME_BINARY` in ordinary installed projects.** It
  is a contributor/test override. Installed apps should exercise the selected
  platform runtime package so `doctor` verifies the artifact users receive.
- **Do not inherit `CI=1` when you launch Metro or Expo yourself.** File
  watching is inert and the served bundle goes stale. Prefer
  `snapback dev --expo`, or unset `CI` / pass `CI=0`
  ([React Expo clients](../clients/react-expo.md#know-what-the-supervisor-owns)).
