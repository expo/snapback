---
title: The authoring loop
id: getting-started.the-authoring-loop
order: 2
audience: agent-first
capabilities: [backend.codegen, operating.packaged-dev-loop, testing.acceptance, operating.inspect]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0041-packaged-dev-loop.rfc.md, packages/snapback-cli/index.mjs, packages/snapback-codegen/index.mjs, scripts/snapback-package-cold-install.mjs, scripts/verify-local-proof]
examples: [packages/snapback-cli/templates/todo-contract, packages/snapback-cli/templates/react, packages/snapback-cli/sessions-dev-loop.test.mjs, demos/todo/tests/acceptance/headless.mjs, demos/todo/surfaces/headless/run.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-28
reviewed-commit: HEAD
---

# The authoring loop

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The cycle you repeat while building on Snapback:

```text
edit snapback/*.mjs  ->  regenerate  ->  run the acceptance suite  ->  inspect
```

The current source and packed-package React path is:

```sh
snapback doctor --json
snapback new my-app --template react
cd my-app
bun install
bun run dev
```

The generated `dev` script is one supervisor:
`snapback dev snapback --client . --client-command vite`. It generates the
backend, starts or attaches to the native server, loads the app, then starts
Vite and watches both sides. Browser code uses only Vite's relative
`/__snapback` relay; it does not receive the loopback origin, admin token,
runtime path, or repository path. The template uses generated query/mutation
references and the first-party React provider/hooks; it does not add
application-owned subscription cleanup.

The source package `@snapback/cli` supplies the `snapback` command. Public
version `0.1.0` is installed under the alias
`@ccheever/snapback-cli`; its published manifest preserves the same bin and
maps internal `@snapback/*` dependencies to the corresponding
`@ccheever/snapback-*` artifacts. The byte-verified public closure contains
the macOS/arm64 and Linux/x64 runtimes plus Contract, client, codegen, React,
app CLI, and developer-loop CLI packages. Clean GitHub-hosted machines on both
supported runtime tuples installed that exact closure and passed the original
`todo-contract` scaffold/generate/dev/watch proof.

Do not infer that the public `0.1.0` bytes contain every surface described by
the current source tree. In particular, the current React scaffold depends on
`@snapback/vite`, and its retained cold proof is a staged, dirty-source
checkpoint on macOS/arm64. `@snapback/vite`, the current React starter, the
current versioned-seed integration, and the Linux run of that expanded starter
still need one newly versioned public closure before this page can call the
React command a public-registry path.

On each supported tuple the mapped runtime package carries the prebuilt server
and Hermes runtime. `doctor` first launches that relocated binary with
ambient dynamic-loader overrides removed, then creates a disposable app and
database, generates and loads its bundle, invokes a query, commits a mutation,
opens and closes a live subscription, stops the owned server through its ready
descriptor, and removes the temporary state. Its `snapback.cli-doctor.v2`
result reports one stable code per completed boundary; a launch-only result is
test instrumentation and never the installed-product claim. Other host tuples
report `SNAPBACK_IBEX_HOST_UNSUPPORTED`—they are not source-build fallbacks
disguised as installs. The `@snapback/cli` npm identity belongs to an unrelated
product, so application imports remain `@snapback/*` through npm aliases while
publication uses `@ccheever/snapback-*`.

## 1. Edit

Change `schema.mjs`, `functions.mjs`, `handlers.mjs`, or `seed.json`
([your first backend](./your-first-backend.md) covers each).

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
choose migration or an explicit destructive reset-install.

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

## 3. Run the acceptance suite

Headless first — the required surface is driveable without any UI
(LLP 0012). A suite boots its own isolated server and drives the real
product path:

```sh
node <app>/tests/acceptance/headless.mjs
```

Exit `0` = every declared check passed; `1` = a check failed or the run was
short (zero checks can never pass); `2` = setup error. See
[testing/acceptance](../testing/acceptance.md) for the harness and server
lifecycle discipline.

For a demo in this repo, the whole-repo proof is
`scripts/verify-local-proof` (add `SNAPBACK_VERIFY_EXACT=0` for a
deliberately core-only iteration; merge CI requires the Exact-gated block).

## 4. Inspect

A running server tells you what it is actually serving:

```sh
cargo run                      # prints the admin URL on startup
curl http://127.0.0.1:4287/inspect
```

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
