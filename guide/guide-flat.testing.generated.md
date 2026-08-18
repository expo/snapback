<!-- Generated testing section flat projection by scripts/generate-guide-manifest.mjs. Never hand-edit. -->

---

<!-- snapback-guide-source: guide/testing/acceptance.md -->
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

---

<!-- snapback-guide-source: guide/testing/verify.md -->
---
title: Verify the declared app contract
id: testing.verify
order: 2
audience: agent-first
capabilities: [operating.verify]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0146-agentic-authoring-affordances.rfc.md, packages/snapback-cli/package.json, packages/snapback-cli/verify.mjs, packages/snapback-cli/verify-receipt.schema.json]
examples: [packages/snapback-cli/verify.test.mjs, packages/snapback-cli/fixtures/verify/snapback.verify.config.mjs, packages/snapback-cli/fixtures/verify/minimal-profile.mjs]
status: current
targets: [local]
maturity: partial
reviewed: 2026-08-08
reviewed-authorities-digest: sha256:359ad5ef75925fd5932dec2dcd91eb5a9de3e7d399a3bd0da2cd2e6444e5b133
---

# Verify the declared app contract

> **Local target, partial surface.** This page describes generated-artifact
> admission and explicitly registered acceptance paths. Live-target admission
> and automatic discovery of acceptance suites beyond the conventional config
> file remain GAPs.

`snapback verify --json` is the CLI-owned readiness composition from LLP 0146
D2. It is not the unbuilt `acceptance.run` host operation. In fixed receipt
order it checks fresh generated identity, the digest-bound LLP 0010 runtime
readiness receipt, local schema/function admission plus registered D1
coverage, generated target capabilities, and registered acceptance profiles:

```sh
snapback runtime-qualify --persist
snapback verify ./snapback --config ./snapback.verify.config.mjs --receipt ./.snapback/verify-receipt.json --json
```

When the current directory contains `snapback.verify.config.mjs`, omit
`--config`: `snapback verify --json` discovers that conventional filename.
An explicit positional `<backend-dir>` is resolved from the shell's current
directory. A `backendDirectory` authored inside the config remains relative to
the config file, as do `testFiles`.

## Author `snapback.verify.config.mjs`

Prefer the dedicated `@expo/snapback-cli/verify` subpath. The package root
currently re-exports the same helpers for compatibility, but the subpath keeps
verifier-only imports explicit and matches the package's dedicated export.
Default-export one `defineVerifyConfig(...)` value. Config-authored paths in
`backendDirectory` and `testFiles` are relative to the config file:

```js source=packages/snapback-cli/fixtures/verify/snapback.verify.config.mjs
import { defineVerifyConfig } from '@expo/snapback-cli/verify';

import { runMinimalProfile } from './minimal-profile.mjs';

export default defineVerifyConfig({
  schemaVersion: 'snapback.verify-config.v1',
  backendDirectory: './snapback',
  profiles: [{
    id: 'local-headless',
    title: 'local headless acceptance',
    testFiles: ['./minimal-profile.mjs'],
    requiredCapabilities: ['result_contract_v1'],
    paths: [{
      id: 'list-success',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: 'app:list',
    }],
    run: runMinimalProfile,
  }],
});
```

Each profile lists every file whose bytes define the acceptance run, every
capability it needs, and every expected path. Path `kind` is one of `success`,
`failure`, `action`, `relational`, `search`, or `snapshot-bundle`;
`targetProfileId` names the target actually exercised; `functionId` binds D1
read/write evidence to a declared function when the path has one.

Profiles have a five-minute timeout by default. Set a positive integer
`timeoutMs` on one profile, override all profiles for one invocation with
`--timeout-ms`, or set `SNAPBACK_VERIFY_PROFILE_TIMEOUT`. A timeout fails the
profile with `SNAPBACK_VERIFY_PROFILE_TIMEOUT`.

The runner receives `{ artifact, backendDirectory, generatedDirectory,
profileId }`. It returns boolean `ok`, the exact target/data/authority/seed
identity in force, optional diagnostics, and one six-field D1 conformance
report for every registered path:

```js source=packages/snapback-cli/fixtures/verify/minimal-profile.mjs
// This package fixture proves the authoring contract without claiming that it
// observed an application's reads or writes. Replace this body with the real
// headless acceptance run and report complete provenance only when measured.
export async function runMinimalProfile({ artifact, profileId }) {
  if (profileId !== 'local-headless' || typeof artifact?.identity?.inputsHash !== 'string') {
    throw new Error('minimal verify profile received the wrong execution context');
  }
  return {
    ok: true,
    context: {
      target: { kind: 'local-generated-artifact', identity: artifact.identity.inputsHash },
      data: {
        kind: 'sqlite-fixture',
        identity: 'sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd',
      },
      authority: { kind: 'dev-asserted', identity: 'user_ada', principalClass: 'dev' },
      seed: artifact.seedIdentity,
    },
    conformance: [{
      pathId: 'list-success',
      status: 'observed',
      report: {
        missingReads: [],
        missingWrites: [],
        extraReads: [],
        extraWrites: [],
        readProvenance: 'unsupported',
        writeProvenance: 'unsupported',
      },
    }],
  };
}
```

Replace the fixture identities with facts from the run. `target.identity`,
`data.identity`, and `authority.identity` must be non-null;
`authority.principalClass` must be named; and `seed.kind` must say what was
exercised rather than `not-exercised`. This minimal shape deliberately reports
both D1 provenance classes as `unsupported`, so it proves registration and
identity plumbing without claiming authoritative read/write coverage. A real
runner reports `complete` only from measured evidence.

Missing registered path evidence and non-empty
`missingReads`/`missingWrites` fail coverage.
Those deltas are authoritative only for a class whose provenance is
`complete`; an observed `incomplete` or `unsupported` class stays visible as
partial coverage and is never labeled conformant.
`extraReads`/`extraWrites` become a warning only when their intersection over
every complete class observation for the function stays non-empty, which preserves a table
used only on a conditional path.

The generated [`VerifyConfig` reference](../reference/expo-snapback-cli--verify.md#symbol-verifyconfig-181f105dc0)
is the declaration-exact config contract; `snapback guide VerifyConfig`
returns the same symbol identity without loading this whole page.

The package-owned `snapback.verify-receipt.v1` schema binds the profile-set
identity, digest of the config and actual test bytes, artifact target, data,
authority, seed, all five stage verdicts, and ordered `next[]` actions.
`recommendedNext` appears only when exactly one stage failed. With no
registered profiles, a fresh app can pass the platform checks, but the receipt
says `status: "passed-without-acceptance"` and does not claim D1 aggregate
coverage. This status is successful for process automation but machine-distinct
from a receipt whose registered acceptance profiles passed. Each next action
separates a nullable runnable `command` from its prose `instruction`.

Stage 2 probes the digest-bound local packaged runtime only for local target
profiles. For a non-local generated target it records an explicit
`not-applicable-non-local-target` result with `claim: false`; it does not imply
that target's runtime is ready. Register a Cloudflare runner with
`defineCloudflareVerifyProfile`. The adapter launches the runner with
`SNAPBACK_PROOF_URL` and `SNAPBACK_ADMIN_TOKEN`, requires its final
`snapback.cloudflare-acceptance.v1` machine receipt, and checks the receipt's
app, schema, and bundle identities against the artifact regenerated by
`snapback verify`. It replaces the receipt's target and data context with the
deployment identities the runner observed; the admin token itself is never
retained and is redacted from failure diagnostics.

The repository's All Aboard runner at
`cloudflare/test/acceptance.remote.all-aboard.mjs` is the reference producer.
Its 22-check live run can be registered like any other profile, with each path
targeting `cloudflare-do-sqlite-v8`. The existing runner reports read/write
provenance as unsupported, so its D1 aggregate remains honestly partial even
when remote acceptance passes. Unit tests prove the adapter contract; only a
credentialed run against a real deployment proves that deployment.

The current admission authority is the locally regenerated generated-artifact
set. It does not claim that a live target admitted those bytes, does not
implement `acceptance.run`, does not prove product completeness, and does not
perform or custody CV-14 semantic review. Build acceptance profiles with the
headless-first discipline in [Acceptance testing](acceptance.md).

---

<!-- snapback-guide-source: guide/testing/large-fixtures.md -->
---
title: Loading large deterministic fixtures
id: testing.large-fixtures
order: 3
audience: agent-first
capabilities: [testing.large-fixtures]
authorities: [llp/0109-versioned-seed-evolution.spec.md, llp/0183-zerobugs-quality-surface.rfc.md, demos/zerobugs/control/scripts/load-fixture.mts, demos/zerobugs/control/snapback/functions.mjs, demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs, crates/snapback-kernel/src/seed_identity.rs, crates/snapback-kernel/src/storage.rs]
examples: [demos/zerobugs/control, demos/zero-bakeoff/apps/fleet-observatory]
status: current
targets: [local]
maturity: shipped
reviewed: 2026-08-07
reviewed-authorities-digest: sha256:5742dae5187b91cc2e253e1b98308576566793436f851c2b776a78b53ec1c471
---

# Loading large deterministic fixtures

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

A [versioned seed](../backend/versioned-seeds.md) installs at most **1,024
effects** — direct rows plus changed maintained-projection outputs — and
refuses a larger fixture with `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED`. A single
mutation has the same order of ceiling: at most **1,024 buffered writes**
(`SNAPBACK_BUFFERED_WRITE_LIMIT_EXCEEDED`; see
[bound and resume bulk work](../backend/mutations.md#bound-and-resume-bulk-work)).
Both ceilings are deliberate. When an acceptance suite needs a deterministic
fixture bigger than that — thousands of rows across many tables — do not
fight the seed protocol. Load through an **app-authored, acceptance-only
batch-ingest mutation**, driven in bounded batches by a loader script, and
verify the loaded state by content digest.

This page distills the paved shape from two CI-exercised sources: the minimal
loader in the fleet-observatory bakeoff app
([functions](repo:demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs),
driven by its own acceptance suite) and the hardened sessions-app loader in
the zerobugs control
([functions](repo:demos/zerobugs/control/snapback/functions.mjs) +
[loader script](repo:demos/zerobugs/control/scripts/load-fixture.mts), whose
compiled-plan/handler/digest pipeline runs under the demo's
`bun run test:fixture` suite and whose live path runs in its `test:lane*:live`
acceptance lanes).

## Declare a batch-ingest mutation

The minimal shape is one JS mutation that takes a table name and a bounded
array of rows, refuses anything outside its closed table set, and returns a
count receipt:

```js source=demos/zero-bakeoff/apps/fleet-observatory/snapback/functions.mjs
export const ingestFixtureBatch = defineJsMutation({
  args: {kind: v.string(), rows: v.json()}, writes: ['fleets', 'fleetMemberships', 'owners', 'devices', 'events'], result: results.value(v.integer()),
  handler: async (ctx, args) => {
    if (!Array.isArray(args.rows) || args.rows.length > 900) throw new Error('fixture batch must contain at most 900 rows');
    if (!['fleets', 'fleetMemberships', 'owners', 'devices', 'events'].includes(args.kind)) throw new Error('unknown fixture table');
    for (const row of args.rows) await ctx.db.insert(args.kind, row);
    return args.rows.length;
  },
});
```

The **≤900-row batch bound is headroom, not superstition**: the 1,024 ceiling
counts every write expanded into the same commit, including maintained
projections and membership commands, so a batch sized at the ceiling breaks
the moment a table gains a projection. Size batches so direct rows plus
generated effects stay comfortably under 1,024.

Each batch is its own atomic commit — the whole fixture load is **not** one
transaction. That is fine for a fixture: batches are deterministic, ordered,
and verified as a whole at the end (below).

## Gate the loader in a sessions app

An ungated ingest mutation is a general data-import API wearing a test badge.
The zerobugs control gates its loader three ways — `auth: 'authenticated'`
(the loader mints a real dev session, below), refusal of caller-authored
system fields, and a **bootstrap window** that closes the mutation forever
once the fixture is complete:

```js source=demos/zerobugs/control/snapback/functions.mjs
async function requireFixtureBootstrapWindow(db) {
  // @ref LLP 0109#155-quantitative-and-acceptance-closure — this fixture is a
  // sequence of ordinary bounded commits, not a partially installed seed.
  // `searchEpoch` is deliberately last in the frozen load order and therefore
  // acts as the completion sentinel: any later ingest attempt fails closed.
  const completed = await db.query('searchEpoch').take(1).collect();
  if (completed.length !== 0) {
    throw new Error('fixture ingestion is closed after fixture completion');
  }

  // Bootstrap is circular: the fixture creates the source users that a later
  // identityBinding maps to session principals. While the sentinel is absent,
  // only the frozen user population may exist. A foreign source user closes
  // the acceptance loader rather than widening this into a general import API.
  const expected = fixtureUserRoles();
  const users = await db.query('user').take(15).collect();
  if (
    users.length > 14
    || users.some(user => (
      user.role === 'crew'
        ? !expected.crew.includes(user.id)
        : user.role !== 'user' || !expected.user.includes(user.id)
    ))
  ) {
    throw new Error('fixture ingestion found source users outside the frozen fixture');
  }
}
```

The pattern generalizes: pick the table that is **last** in your frozen load
order as the completion sentinel (any row in it means the load finished, so
further ingest refuses), and refuse ingestion whenever data outside the frozen
fixture already exists (the empty-of-source refusal). Together they make the
loader a one-shot bootstrap channel, not an import surface.

## Mint the loader's session from the readiness descriptor

In a sessions-mode app the loader needs a real bearer. `snapback session mint`
is an **admin-gated host operation**; the dev server's readiness descriptor
(`.snapback/dev.ready.json`, schema
[host-ready](repo:schemas/host-ready.schema.json)) names the managed
admin-token carrier in its `adminTokenFile` field — the same owner-only
sidecar described in
[acceptance testing](./acceptance.md#bootstrap-a-backend-without-the-js-kit).
Given `--ready-file`, the CLI discovers that auto-minted token itself when the
declared carrier is the descriptor's mechanical sibling; a loader can also
read the carrier explicitly, as the zerobugs loader does, instead of asking
the caller to export secrets:

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
  const command = process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(CONTROL_ROOT, 'node_modules/.bin/snapback');
  // `session mint` is an admin-gated host-op: it requires the dev server's
  // admin token (SNAPBACK_ADMIN_TOKEN or --token). The readiness descriptor
  // names the managed token carrier; read it here rather than requiring the
  // caller to export secrets.
  const adminTokenFile = ready.adminTokenFile;
  const mintEnv = {...process.env};
  if (!mintEnv.SNAPBACK_ADMIN_TOKEN && typeof adminTokenFile === 'string') {
    mintEnv.SNAPBACK_ADMIN_TOKEN = (await readFile(adminTokenFile, 'utf8')).trim();
  }
  const {stdout} = await execFileAsync(
    command,
    ['session', 'mint', '--email', email, '--ready-file', readyFile],
    {cwd: CONTROL_ROOT, env: mintEnv, maxBuffer: 1024 * 1024},
  );
```

The mint envelope carries `data.token` (the bearer) and
`data.session.userId` (the principal); check `ok === true` before trusting
either. Drive the loader's mutations through
`createExternalSessionClient(baseUrl, { bearerToken })` — see
[native-app auth](../auth/native-apps.md) for that client's contract.

## Batch in frozen order, map the minted IDs

Fixture rows on disk carry **placeholder** identities; the server mints the
real row `_id` at insert. Split each table into ≤900-row batches in one frozen
load order (references only ever point at already-loaded tables):

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
export function fixtureLoadPlan(
  tables: FixtureTables,
): Array<{table: TableName; rows: FixtureRow[]}> {
  const plan: Array<{table: TableName; rows: FixtureRow[]}> = [];
  for (const table of LOAD_ORDER) {
    const rows = tables[table];
    for (let offset = 0; offset < rows.length; offset += MAX_FIXTURE_BATCH_ROWS) {
      plan.push({table, rows: rows.slice(offset, offset + MAX_FIXTURE_BATCH_ROWS)});
    }
  }
  return plan;
}
```

Have the ingest mutation return the minted IDs in input order (the zerobugs
`fixtureIngestBatch` returns `{inserted, ids}`), and maintain the
placeholder↔runtime maps as each batch's receipt arrives; rewrite reference
fields in later batches through that map before sending them. Refuse duplicate
mappings — one placeholder must map to exactly one runtime ID.

## Verify by digest under the null/absent canonical form

After loading, read every table back through the ordinary query surface and
compare a canonical digest against the fixture's compiled contract. One
runtime fact matters here: **an unset optional field is stored — and returned —
as an explicit `null`**. The query surface does not distinguish `null` from
absent, so canonicalization must fold them into one form before digesting (the
zerobugs loader drops nulls, strips server-owned system fields, and maps
runtime IDs back to placeholders):

```ts source=demos/zerobugs/control/scripts/load-fixture.mts
    const normalized: Record<string, JsonValue> = {_id: placeholder};
    for (const [field, value] of Object.entries(row)) {
      if (field === '_id' || field === '_version' || field === '_createdAt' || field === '_updatedAt') {
        continue;
      }
      // Canonical form: unset optional fields are omitted. The runtime's query
      // surface returns them as explicit null and does not distinguish null
      // from absent, so nulls are dropped before digesting.
      if (value === null) {
        continue;
      }
      if (REFERENCE_FIELDS[table].includes(field) && typeof value === 'string') {
        const reference = actualToPlaceholder.get(value);
        if (!reference) fail(`${table}.${field} returned unknown runtime id ${value}`);
        normalized[field] = reference;
      } else {
        normalized[field] = value;
      }
    }
```

Digest the normalized, identity-sorted rows with a key-sorted canonical JSON
encoding and compare per-table counts and digests, plus one overall digest,
against the checked-in contract. Any mismatch is a hard failure naming the
first differing row — determinism is the whole point of the fixture.

## Anti-patterns

- **Do not fight `SNAPBACK_SEED_EFFECT_LIMIT_EXCEEDED` by chaining seeds or
  reset-installs.** The versioned-seed protocol is fixture *identity*, not
  bulk transport; over-ceiling fixtures belong to bounded ordinary mutations.
- **Do not size batches at the 1,024 ceiling.** The ceiling counts expanded
  writes (maintained projections, membership commands), not just your rows;
  ≤900 direct rows is the proven headroom.
- **Do not leave the ingest mutation open.** Require a session, refuse
  caller-authored system fields, and close the bootstrap window with a
  completion sentinel plus an empty-of-source refusal — otherwise you have
  shipped a general import API.
- **Do not compare observed rows to fixture bytes raw.** Strip `_version`/
  `_createdAt`/`_updatedAt`, map minted IDs back to placeholders, and fold
  explicit `null` and absent optional fields into one canonical form first.
- **Do not ask callers to export admin secrets.** The readiness descriptor
  already names the managed `adminTokenFile` carrier; discover it (or let
  `--ready-file` discovery do it) instead of pasting tokens into shells or CI
  configuration.
