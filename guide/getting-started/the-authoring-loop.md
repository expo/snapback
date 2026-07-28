---
title: The authoring loop
id: getting-started.the-authoring-loop
order: 2
audience: agent-first
capabilities: [backend.codegen, operating.packaged-dev-loop, testing.acceptance, operating.inspect]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0041-packaged-dev-loop.rfc.md, packages/snapback-cli/index.mjs, packages/snapback-codegen/index.mjs, scripts/snapback-package-cold-install.mjs, scripts/verify-local-proof]
examples: [packages/snapback-cli/templates/todo-contract, demos/todo/tests/acceptance/headless.mjs, demos/todo/surfaces/headless/run.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-07-21
reviewed-commit: e37dc3a3dcde3c8ea3de13c1bfde4e8b683493f1
---

# The authoring loop

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The cycle you repeat while building on Snapback:

```text
edit snapback/*.mjs  ->  regenerate  ->  run the acceptance suite  ->  inspect
```

From an installed package, start with the same loop through the public CLI:

```sh
snapback doctor --json
snapback new my-app --template todo-contract
cd my-app
bun install
snapback dev snapback
```

The source package `@snapback/cli` supplies the `snapback` command. The first
public registry alias is `@ccheever/snapback-cli`; its staged manifest preserves
the same bin and maps internal `@snapback/*` dependencies to the corresponding
`@ccheever/snapback-*` artifacts. On Apple-silicon macOS the mapped runtime
package carries the prebuilt server and Hermes framework. `doctor` first
launches that relocated binary with
ambient dynamic-loader overrides removed, then creates a disposable app and
database, generates and loads its bundle, invokes a query, commits a mutation,
opens and closes a live subscription, stops the owned server through its ready
descriptor, and removes the temporary state. Its `snapback.cli-doctor.v2`
result reports one stable code per completed boundary; a launch-only result is
test instrumentation and never the installed-product claim. Other host tuples currently report
`SNAPBACK_IBEX_HOST_UNSUPPORTED`—they are not source-build fallbacks disguised
as installs. Public registry publication is still pending. The `@snapback/cli`
npm identity belongs to an unrelated product, so release probes use labeled
`@ccheever/snapback-*` prereleases while keeping the documented source imports
through npm aliases. The retained proof distinguishes immutable-tarball and
public-registry modes and will not treat one as evidence for the other.

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
functions, seeds only a newly created managed database, and watches source
changes through one coalesced generation at a time. The attach path validates
the database target before reading the managed owner-only token. A different
target fails with `SNAPBACK_DEV_SERVER_TARGET_MISMATCH`. If initial attach/load
fails, a server started by this command is stopped. If later generation
succeeds but live load fails, the event state is `generated-but-not-loaded`;
generation errors are the distinct `generation-failed` state.

Codegen is deterministic and **fails closed** — on error it writes nothing
and exits 1 with stable diagnostic codes on stderr, so there is never
silently stale output. On success it prints the `inputsHash` freshness key.
Commit `generated/` with your source change: the server compares hashes and
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

- **Do not hand-edit `generated/` or skip the regenerate step** — the
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
