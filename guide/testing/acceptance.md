---
title: Acceptance testing
id: testing.acceptance
order: 1
audience: agent-first
capabilities: [testing.acceptance, operating.server-lifecycle]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, demos/_kit/harness.mjs, demos/_kit/server-process.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-17
reviewed-commit: 0ef40d4a2c1856b841585474602878b6d96a3c59
---

# Acceptance testing

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback apps are proven **headless-first** (LLP 0012): the required
surface is a suite that boots a real server, loads the real generated
artifacts, and drives the product client — no UI in the loop. UI arms
(Contract, React) are additional surfaces over the same backend.

## The harness

`demos/_kit/harness.mjs` provides a dependency-free suite with structured,
machine-readable results and **vacuous-pass protection** — a run that
executes zero checks (or fewer than it declared) can never report success:

```js source=demos/_kit/harness.mjs
    finish() {
      const passed = results.filter((r) => r.ok).length;
      const total = results.length;
      // ENG-22486: zero checks (or a short run against a declared count) can
      // never be a pass — a pre-check throw that skips the checks must fail.
      let shortfall = null;
      if (total === 0) {
        shortfall = 'zero checks ran';
      } else if (expectedChecks !== null && total !== expectedChecks) {
        shortfall = `ran ${total}/${expectedChecks} expected checks`;
      }
      const ok = passed === total && shortfall === null;
```

Use `createSuite(title, { expectedChecks })` and `await suite.check(name,
fn)` per behavior; `runAcceptance(suite, body, { cleanups })` is the shared
runner tail — it surfaces setup errors with their stacks, prints a
machine-readable JSON report line after running every cleanup in reverse
order, and exits `0` (pass), `1` (check failure or short run), or `2`
(setup/teardown infrastructure error). Cleanup rejections cannot turn a
passing check run green: the final report has `ok: false` and retains every
failure in `cleanupErrors`, including stable error codes and process-tree
attestation details when supplied by the lifecycle helper.
Assertion helpers: `assert`, `assertEqual`, and
`assertThrows(fn, code, msg)`, which matches `error.diagnostic.code` —
stable codes, never message text. `requireBunRuntime(label)` guards suites
that must run under bun.

## Server lifecycle: isolated, provenance-verified, owned

`startServer` from `demos/_kit/server-process.mjs` is the only way a suite
should obtain a server:

```js source=demos/todo/tests/acceptance/headless.mjs
const server = await startServer({ port: 4399, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo', artifactsPath: join(repoRoot, 'demos', 'todo', 'snapback', 'generated', 'artifacts.json') } });
const db = new SnapbackClient(server.baseUrl, server.clientOptions);
```

What it guarantees:

- **Isolated ports by default.** Ordinary starts pass `--port 0`, so the OS
  assigns a port and the child reports its actual bound URL through a ready
  file; always use the returned `server.baseUrl`, never the port you asked
  for.
- **Reuse only with verified provenance.** A server already listening is
  reused only when its loaded bundle identity matches the declared
  `provenance` (or `binaryProvenance`); any mismatch — or no declared
  identity — refuses reuse and spawns a fresh isolated server instead.
- **Owned teardown.** The returned handle's `.stop()` tears down the whole
  process tree the harness itself started (SIGTERM then SIGKILL, attested
  group exit). Nothing else is ever killed.
- `--memory` for `db: ':memory:'`; file-backed servers take an exclusive
  sidecar lock so two servers can't mutate one database.

Then load and drive the app exactly as production clients do — see
[your first backend](../getting-started/your-first-backend.md) for
`loadSchema`/`loadFunctions`/`reset`/`seed` and the query/mutation calls,
and [realtime/live-queries](../realtime/live-queries.md) for asserting on
live updates.

## What a good suite asserts

The todo headless suite (`demos/todo/tests/acceptance/headless.mjs`) is the
model: authoritative reads after writes, structured mutation results
(`result`, `changed_count`), server-owned system fields, live snapshot +
cross-client realtime delivery, error paths by diagnostic code, and
admin-gated operations with the server-issued `server.adminToken`.

## Anti-patterns

- **Do not claim a fixed port and kill whatever holds it.** Request an
  OS-assigned port (the default); reuse a server only after provenance
  verification; stop only processes your own harness started.
  `server-process.mjs` implements exactly this discipline — inherit it.
- **Do not swallow setup errors into a green run.** Zero-check and
  short-run passes are structurally impossible under the harness; keep
  `expectedChecks` declared so they stay impossible.
- **Do not detach or catch-and-ignore cleanup promises.** Return each cleanup
  promise through the shared `cleanups` stack. The runner attempts all of them
  in reverse order and fails the run if any cleanup rejects.
- **Do not assert on diagnostic message text.** Use `assertThrows(fn,
  'SNAPBACK_...')` against the code.
