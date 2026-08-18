---
title: Acceptance testing
id: testing.acceptance
order: 1
audience: agent-first
capabilities: [testing.acceptance, operating.server-lifecycle]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0031-server-route-taxonomy.spec.md, crates/snapback/src/cli.rs, demos/_kit/harness.mjs, demos/_kit/server-process.mjs, packages/snapback-cli/comparator-profile.mjs, packages/snapback-cli/comparator-receipt.schema.json, schemas/host-ready.schema.json]
examples: [demos/todo/tests/acceptance/headless.mjs, demos/card-game/tests/acceptance/authority-scope.mjs, demos/all-aboard/tests/acceptance/headless.mjs, packages/snapback-cli/fixtures/comparator/green.config.mjs]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:b0d9926f4ded2f3c1b3fd241040a6ba00c0b1ad64a34f295e039b92def0b82f4
---

# Acceptance testing

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Snapback apps are proven **headless-first** (LLP 0012): the required
surface is a suite that boots a real server, loads the real generated
artifacts, and drives the product client — no UI in the loop. UI arms
(Contract, React) are additional surfaces over the same backend.

Generated `todo-contract` and React starters preserve that meaning in their
default command: `npm test` owns an isolated local server and database, waits
for the ready descriptor and generated-and-loaded lifecycle event, verifies
the loaded artifact identity, executes a real query and mutation through the
starter's product client, tears everything down, and emits one bounded
`snapback.starter-acceptance.v1` receipt. `npm run test:static` is deliberately
different: it checks generated-file and scaffold-source coherence without
starting Snapback. A static pass is useful and fast, but it is not runtime
acceptance and must not be used as the app's done-oracle.

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

Small headless app kernels may use
`openHeadlessApp(import.meta.url, { appId })` from
`demos/_kit/headless-app.mjs`. It resolves the app directory, starts the same
provenance-verified server, provisions generated schema/functions/routes and
seed, then returns fresh `client` and admin-gated `admin` clients plus one
`close` cleanup. The five-app workout corpus runs this helper through
`node scripts/run-workout-apps.mjs`.

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
and the first one can land surprisingly early: an `everyMs` job seeds the
most recent past slot on its epoch-anchored grid, so its first tick fires
promptly after arming **regardless of when demand arrived** ([LLP 0028
§Inspection and query
surface](repo:llp/0028-cron-scheduled-execution.rfc.md), ENG-22604 and the
2026-08-01 a4-f4 amendment — the run's trusted clock is its due time,
within one interval of wall clock). Start the server with the scheduler
inert and drive ticks yourself:

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

## The backend-comparator profile

Use the published comparator profile when an app needs portable evidence for
the five properties that backend bake-offs most often blur together:

1. a mutation from one identity reaches another identity over native push;
2. one mutation changes every declared durable-write witness;
3. a rejected mutation leaves both visible state and the durable version
   unchanged;
4. connection-owned presence disappears on disconnect and TTL-bounded
   presence disappears from a fresh server snapshot; and
5. an ephemeral publish does not advance the durable storage version.

Create a configuration module with `defineComparatorProfile` from
`@expo/snapback-cli/comparator`. It names the generated live-query, mutation, and
ephemeral-collection refs and supplies arguments plus bounded callbacks:
`live.matches(rows)`, `atomic.snapshot(client)`,
`rejection.snapshot(client)`, and `presence.matches(entry)`. The kit owns the
operations those callbacks observe; a callback cannot substitute polling for
the live transport or take over lifecycle. The packaged
`fixtures/comparator/green.config.mjs` is a complete, generated-ref example.
Applications may append explicitly named `extraChecks`; the five profile
checks remain mandatory and ordered.

Run it from the application root:

```sh
snapback accept comparator \
  --config ./snapback-comparator.config.mjs \
  --receipt ./.snapback/comparator-receipt.json
```

The command generates and provisions the named backend into a fresh
file-backed database, starts an OS-port-isolated managed server, creates
separate actor and observer clients, disables live polling fallback, applies a
deadline to every operation, and tears down the server and temporary state.
Client setup follows the process-scoped `/auth/session` handshake: a dev-mode
fixture uses body-carried local impersonation, while a sessions-mode fixture
uses the provider to mint bearer-backed clients. The runner never calls the
session provider merely because a managed impersonation sidecar exists.
Its exit codes match the ordinary acceptance harness: `0` means every declared
check and cleanup passed, `1` means a product check failed or a required
capability was classified as a GAP, and `2` means setup, timeout, server death,
or cleanup failed.

The retained `snapback.comparator-receipt.v1` document is validated against
the package-owned
`@expo/snapback-cli/comparator-receipt.schema.json`. It carries exact target,
generated-artifact, and server-binary identity when those identities became
available; pre-start failures mark unavailable identity sections explicitly.
It also carries expected and executed checks, per-check timing, capability
GAPs, cleanup attestation, and nonclaims. Verify a retained receipt before
aggregation, including freshness:

```sh
snapback accept comparator \
  --verify-receipt ./.snapback/comparator-receipt.json \
  --max-age-ms 3600000
```

Transport attribution comes from the product client’s
`SubscriptionReceipt.transport`; an update callback alone is not push
evidence. A zero-check or short receipt cannot validate as a pass, and a
cleanup rejection always produces infrastructure exit `2`.

## Bootstrap a backend without the JS kit

A non-JS harness (Swift, Kotlin, plain curl) can load an app into a bare
server from documents alone — no `ensureApp(...)`, no kit. The model
consumer is the Swift clean-room harness
([snapback-prove](repo:clients/swift/SnapbackClient/Sources/snapback-prove/main.swift)).

**1. Start the server and discover it through the ready file.** A process
without a controlling terminal must pass a fresh `--ready-file <path>`;
once the listener binds, Snapback writes a JSON readiness descriptor there
(schema: [host-ready](repo:schemas/host-ready.schema.json)) with
`serverUrl`, `port`, `ready`, and — when a token was auto-minted —
`adminTokenFile`:

```sh
snapback start --memory --ready-file /tmp/sb-ready.json &
# ...wait for the file, then:
BASE_URL=$(jq -r .serverUrl /tmp/sb-ready.json)
```

**2. Get the admin token.** If you exported `SNAPBACK_ADMIN_TOKEN`, that
exact token is active and no file is written. Otherwise the server mints
one and persists it 0600 in the sidecar named by the descriptor's
`adminTokenFile` — mechanically `<ready-file>.admin-token` (the same
sibling convention as the instance lock). Tooling that can read that
owner-only file is already local admin; send it as the
`x-snapback-admin-token` header on every call below:

```sh
ADMIN_TOKEN=$(cat "$(jq -r .adminTokenFile /tmp/sb-ready.json)")
```

**3. Load the generated manifests and seed.** The three admin routes take
these exact body shapes — the load routes take the **raw generated
manifest JSON as the whole body** (no wrapper object), and reset wraps the
seed:

- `POST /_snapback/api/schema/load` — body is the contents of
  `demos/<app>/snapback/generated/schema.manifest.json`, unmodified.
- `POST /_snapback/api/functions/load` — body is the contents of
  `generated/functions.manifest.json`, unmodified.
- `POST /_snapback/api/app/reset` — body is optional; to reset **and**
  seed deterministically, send `{"seed": <contents of seed.json>}`.

```sh
G=demos/todo/snapback/generated
curl -sf -X POST -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @"$G/schema.manifest.json" "$BASE_URL/_snapback/api/schema/load"
curl -sf -X POST -H "x-snapback-admin-token: $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @"$G/functions.manifest.json" "$BASE_URL/_snapback/api/functions/load"
jq '{seed: .}' demos/todo/snapback/seed.json | curl -sf -X POST \
  -H "x-snapback-admin-token: $ADMIN_TOKEN" -H 'content-type: application/json' \
  --data-binary @- "$BASE_URL/_snapback/api/app/reset"
```

The reset response reports `{"seeded": ...}` when a seed was applied. From
here the harness drives the app through the ordinary client surface
(`/query/{name}`, `/mutation/{name}`, `/connection/open`, live routes) —
the wire contract is [LLP 0094](repo:llp/0094-wire-envelope-contract.spec.md)
and the lifecycle obligations are
[LLP 0095](repo:llp/0095-client-lifecycle-and-conformance.spec.md).

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
