---
title: Acceptance testing
id: testing.acceptance
order: 1
audience: agent-first
capabilities: [testing.acceptance, operating.server-lifecycle]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, demos/_kit/harness.mjs, demos/_kit/server-process.mjs]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs, demos/all-aboard/tests/acceptance/headless.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-07-20
reviewed-commit: 7d686f7d4ce4f606e3f9a00aeb1ea50d211ac1a7
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
executes zero non-skipped checks (or fewer checks than it declared) can never
report success. Explicit remote-dependency skips remain visible evidence, but
they are never counted as passes:

```js source=demos/_kit/harness.mjs
    finish() {
      const passed = results.filter((r) => r.ok).length;
      const skipped = results.filter((r) => r.outcome === 'skip').length;
      const failed = results.length - passed - skipped;
      const total = results.length;
      // ENG-22486: zero checks (or a short run against a declared count) can
      // never be a pass — a pre-check throw that skips the checks must fail.
      let shortfall = null;
      if (total === 0 || passed + failed === 0) {
        shortfall = 'zero checks ran';
      } else if (expectedChecks !== null && total !== expectedChecks) {
        shortfall = `ran ${total}/${expectedChecks} expected checks`;
      }
      const ok = failed === 0 && shortfall === null;
      const report = { title, passed, skipped, failed, total, ok, results };
```

Use `createSuite(title, { expectedChecks })` and `await suite.check(name,
fn)` per behavior; `runAcceptance(suite, body, { cleanups })` is the shared
runner tail — it surfaces setup errors with their stacks, prints a
machine-readable JSON report line after running every cleanup in reverse
order, and exits `0` (pass), `1` (check failure or short run), or `2`
(setup/teardown infrastructure error). Cleanup rejections cannot turn a
passing check run green: the final report has `ok: false` and retains every
failure in `cleanupErrors`, including stable error codes and process-tree
attestation details when supplied by the lifecycle helper. `suite.skip(...)`
is reserved for an explicitly classified unavailable remote dependency; it
adds a structured skipped result, cannot satisfy a required all-skipped run,
and is never represented as a passing check.
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
- **Launch by the LLP 0030 resolver ladder.** A fresh spawn resolves its
  command in order: a caller-configured binary (`serverBinary` option or
  `SNAPBACK_SERVER_BINARY`), then an existing `target/debug/snapback` whose
  `/health` build stamp verifies against the pinned checkout, then
  `cargo run` as the source-tree fallback. The handle reports which rung won
  (`server.launch.rung`) and an honest build-identity verdict
  (`server.identity.verdict`); see `demos/_kit/README.md` for the verdicts.
- **Owned teardown.** The returned handle's `.stop()` tears down the whole
  process tree the harness itself started (SIGTERM then SIGKILL, attested
  group exit). Nothing else is ever killed.
- **A dead child cannot masquerade as live.** After readiness the kit
  watches the spawned child: `server.exit` flips from `null` to
  `{ code, signal, expected }` when it closes; `server.assertAlive()`
  throws a typed `SNAPBACK_SERVER_CHILD_DIED` instead of letting a dead
  backend surface as raw connection errors; `startServer({
  onUnexpectedExit })` (or `server.onUnexpectedExit(fn)`) notifies
  wrappers so they can exit non-zero or restart; and `stop()` issued
  after an unexpected death still cleans up but **rejects** rather than
  attesting a clean teardown.
- `--memory` for `db: ':memory:'`; file-backed servers take an exclusive
  sidecar lock so two servers can't mutate one database.

### Need the requested port exactly?

Pass `bindPortExactly: true` with an explicit port when a fixed origin is
part of the contract — a restart seam reclaiming a released port, a wrapper
advertising a fixed URL. The child then binds that exact port atomically or
startup fails; there is no probe, no reuse, and no silent fallback, and the
ready-file port is verified against the request. Without it, `port` is only
a verified-reuse probe: a fresh child always binds an OS-assigned port, and
the kit announces the difference with a loud `PORT REASSIGNED` line. Either
way, read the effective origin from `server.baseUrl`.

### Keep cron out of your suite

If the app declares cron jobs, a live scheduler can commit runs mid-suite —
and the first one can land surprisingly early: an `everyMs` job's nominal
grid anchors at Unix epoch 0, so its first tick can fire up to one full
interval after boot **regardless of when demand arrived** ([LLP 0028
§Inspection and query
surface](repo:llp/0028-cron-scheduled-execution.rfc.md), ENG-22604). Start
the server with the scheduler inert and drive ticks yourself:

```js fragment reason="illustrative option on the startServer call above"
const server = await startServer({ db: ':memory:', cwd: repoRoot, cronDisabled: true });
```

`cronDisabled: true` sets `SNAPBACK_CRON_DISABLED=1` on the child (the CLI
form is `--cron-disabled`) and refuses to reuse an already-running server,
whose scheduler may be live. Definitions still load and inspect; the
admin `cronTick()` seam keeps working, so scheduled behavior stays testable
deterministically — see [backend/cron](../backend/cron.md).

If a suite hand-spawns `snapback`/`cargo run` without a controlling terminal,
it must pass a fresh `--ready-file <path>`. The process-bound impersonation
capability is published only to that owner-only sidecar; it is never written to
captured stdout/stderr. Prefer `startServer`, which already owns this handshake.

### Reset to the literal seed state between checks

Design app-level reset hooks **seed-true**: restore the exact seeded rows —
provenance-style fields like a `lastSource: 'seed'` marker included — rather
than stamping a distinguishable "reset" state. A reset that marks itself
forces every suite and wrapper to build admin-token reseed seams just to get
back to an honest baseline; this was the single most-tripped-on defect in
the All Aboard external review, across every client arm. The model is
all-aboard's `resetFeed`
([handlers](repo:demos/all-aboard/snapback/handlers.mjs)), whose seed-truth
is pinned by a byte-equivalence check against the seed fixture:

```js source=demos/all-aboard/tests/acceptance/headless.mjs
  await suite.check('resetFeed restores the literal seed state (byte-equivalent to seed.json)', async () => {
    // Dirty every handler-mutable feed field first: the tick above moved
    // tickIndex/lastSource/fetchedAt, and a claimFeedPoll stamps the optional
    // lastUpstreamPollAt (the ENG-23642 budget) that a seed-true reset must
    // clear back to "absent".
    await db.mutate('claimFeedPoll', { args: { trigger: 'test' } });
    await db.mutate('resetFeed', {});
    assertEqual((await snapshotDelays())['sb-limited'], 0, 'delays cleared');
```

If the product genuinely needs zero-state semantics distinct from seed,
keep them under a different mutation name so the seed-true hook still
exists for suites.

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
- **Do not build reseed side-channels.** If restoring the seed baseline
  needs an admin-token reset or a second control port, the app's reset hook
  is not seed-true — fix the hook (see "Reset to the literal seed state")
  instead of wrapping it.
