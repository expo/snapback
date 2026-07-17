---
title: The authoring loop
id: getting-started.the-authoring-loop
order: 2
audience: agent-first
capabilities: [backend.codegen, testing.acceptance, operating.inspect]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, packages/snapback-codegen/index.mjs, scripts/verify-local-proof]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/todo/surfaces/headless/run.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-16
reviewed-commit: a8bfff367ed5e203faaa78a56a39ab42f5d2cfa8
---

# The authoring loop

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

The cycle you repeat while building on Snapback:

```text
edit snapback/*.mjs  ->  regenerate  ->  run the acceptance suite  ->  inspect
```

## 1. Edit

Change `schema.mjs`, `functions.mjs`, `handlers.mjs`, or `seed.json`
([your first backend](./your-first-backend.md) covers each).

## 2. Regenerate

```sh
node packages/snapback-codegen/index.mjs <app>/snapback
```

Codegen is deterministic and **fails closed** — on error it writes nothing
and exits 1 with stable diagnostic codes on stderr, so there is never
silently stale output. On success it prints the `inputsHash` freshness key.
Commit `generated/` with your source change: the server compares hashes and
rejects stale artifacts loudly (`SNAPBACK_STALE_SCHEMA_ARTIFACT_VERSION`,
`SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH`) rather than serving them.

If you forget this step, the very first server load or acceptance run tells
you; nothing downstream guesses.

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
