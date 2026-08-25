# Capstone execution runbook — expo-build-450b

## STOP: this authored packet is not execution-ready

No driver code was changed. There is therefore no driver diff to apply.

Do **not** start a scored authoring clock from this revision. Local source
inspection found six fail-closed incompatibilities between the charter and the
named R2 stack:

1. `r2-cell-admission.mjs` obtains `hardwareModel`, CPU brand, and physical CPU
   count with macOS-only `sysctl` keys. It will fail on Linux before it can
   compare the configured host.
2. Admission, seriality replay, and `r2-finalize-existing.mjs --publish` require
   Git object reads. The declared execution tree has no `.git` directory.
3. The exact Node executable SHA-256/byte size, kernel release, and exact
   `os.totalmem()` value were unavailable under the authoring-only/no-host-touch
   constraint. The config records nulls instead of invented Mac-style values;
   current admission correctly cannot accept those nulls.
4. `r2-cell-driver.mjs` is reduced-run-only in material semantics: it writes
   `runScope: "reduced"`, appends an M1–M3-only handoff, launches one native
   harness session, and tells that process to exit after M3. Listing eight
   milestones in JSON does not create the charter's continuous M1–M6+M8 session
   plus a separately metered fresh M7 session.
5. Admission's `allCampaignPorts()` reads only `cell.ports`; it ignores the
   capstone config's `m7Ports`, so the required M7 blocks would not be included
   in the fresh all-campaign port probe.
6. The stack has no non-consuming admission/controller dry-run for this config.
   An ordinary admission acquires the production lock and issues a 30-second
   one-attempt transition; the old R2 dry-run is pinned to 0.3.3-m8 and is not a
   capstone smoke substitute.

The user constraint permits driver edits only when strictly necessary for
Linux. A Linux `sysctl` patch alone would leave the Gitless-tree, full-session,
M7-metering, M7-port, and smoke contracts broken, while a full-session rewrite
would be a non-Linux semantic change forbidden by that constraint. For that
reason no partial patch was made. The exact sequence below is the orchestrator
sequence **after** a separately authorized tool revision resolves all six
items, updates the source hashes in `harness-config.json`, and is landed before
the host tree is refreshed.

Every unexecuted host step is marked **UNVERIFIED**. Nothing in this file was
run over SSH while authoring it.

Run the ordered blocks in one Bash session so the fail-closed shell options
established in step 0 remain active. Use a second read-only shell only for the
explicit watch commands.

## Fixed paths and execution order

- Checkout: `/home/ccheever/projects/snapback-capstone`
- Raw campaign root: `/home/ccheever/capstone-0127-20260825`
- Materialized instrument: `/home/ccheever/capstone-0127-20260825/instrument`
- Exact Node: `/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node`
- Exact Codex: `/home/ccheever/.local/bin/codex`
- Cell order: `capstone-clique-explicit-sol-high`, then
  `capstone-clique-familiar-sol-high`

The frozen R2 prompt text still says `effort=xhigh`. That text is deliberately
unchanged because the charter allows exactly three prompt deltas. Launch
authority is `harness-config.json`: Codex runs `gpt-5.6-sol` with
`model_reasoning_effort="high"`.

## 0. Pre-execution stop checks

**UNVERIFIED.** Run from the checkout after the six blockers above have been
resolved and the replacement hashes have been landed. Any mismatch stops the
campaign before materialization.

```sh
set -euo pipefail

cd /home/ccheever/projects/snapback-capstone

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node --version
/home/ccheever/.local/bin/codex --version
/home/ccheever/.local/bin/codex login status

hostname
uname -srm
lscpu
free -b
sha256sum /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node
stat --printf='%s\n' /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node
```

Expected version facts are Node `v24.18.0` and Codex `0.149.0`. Expected
non-sensitive host facts are hostname `expo-build-450b`, Linux x86-64, AMD
Ryzen 5 3600 (6 physical/12 logical CPUs), and 125 GiB RAM. The authoring config
does not fake a Mac hardware model, kernel release, exact memory byte count, or
Node digest. The resolved, landed config must bind the observed values before
admission.

Re-verify npm `latest` for all fourteen identities. The expected output is
`0.1.27` fourteen times; retain the output under the raw root.

```sh
mkdir -p /home/ccheever/capstone-0127-20260825/logs

for package in \
  @expo/snapback \
  @expo/snapback-acceptance \
  @expo/snapback-app-cli \
  @expo/snapback-cli \
  @expo/snapback-client \
  @expo/snapback-codegen \
  @expo/snapback-contract \
  @expo/snapback-expo \
  @expo/snapback-expo-custody \
  @expo/snapback-react \
  @expo/snapback-runtime-darwin-arm64 \
  @expo/snapback-runtime-linux-x64 \
  @expo/snapback-vite \
  create-snapback-app
do
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
    /home/ccheever/.local/node-v24.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js \
    view "${package}@latest" version
done | tee /home/ccheever/capstone-0127-20260825/logs/npm-latest-preflight.log
```

Also confirm that the checkout contains the reviewed cell slots and config.
The current R2 admission requires Git; a resolved Gitless mode must replace
this check rather than silently skipping source identity.

```sh
test -f benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json
test -f benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/cells/capstone-clique-explicit-sol-high/cell.json
test -f benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/cells/capstone-clique-familiar-sol-high/cell.json
```

## 1. Materialize the immutable instrument

**UNVERIFIED.** The materializer's actual argv contract is
`--out <new-empty-path> [--source benchmarks]`; the destination must not exist.

```sh
cd /home/ccheever/projects/snapback-capstone

mkdir -p /home/ccheever/capstone-0127-20260825/locks

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/materialize-instrument.mjs \
  --out /home/ccheever/capstone-0127-20260825/instrument \
  | tee /home/ccheever/capstone-0127-20260825/logs/materialize-instrument.json

sha256sum /home/ccheever/capstone-0127-20260825/instrument/instrument.manifest.json
```

For this authored revision, the expected manifest digest is
`cb90c7ebe2997c305222e94d6d4b1b378b34cb747171b268d6cbf41f95ea7cac`.
Any separately authorized tooling revision must replace this digest and the
corresponding config pin before execution.
The materializer re-resolves every manifest artifact, rejects symlinks, and
changes the complete snapshot to read-only permissions.

## 2. Install choreography dependencies outside the instrument

**UNVERIFIED.** The instrument choreography package has no lockfile and imports
`playwright` by package name relative to its own path. The current tooling does
not accept a lane-owned module root, and `NODE_PATH` is intentionally forbidden.
The narrow available adaptation is a campaign-private ancestor
`node_modules/`: Node resolves it from
`.../instrument/tools/social-messenger/choreography/choreography.mjs`, while no
byte under `instrument/` changes. This is campaign-owned, not lane-owned; that
deviation from the open ticket's preferred per-lane scratch direction is
explicit.

Writes from these commands are limited to:

- `/home/ccheever/capstone-0127-20260825/package.json`
- `/home/ccheever/capstone-0127-20260825/package-lock.json`
- `/home/ccheever/capstone-0127-20260825/node_modules/`
- the existing `/home/ccheever/.cache/ms-playwright/` cache if Playwright needs
  to repair an absent browser file

```sh
/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  /home/ccheever/.local/node-v24.18.0-linux-x64/lib/node_modules/npm/bin/npm-cli.js \
  install \
  --prefix /home/ccheever/capstone-0127-20260825 \
  --ignore-scripts \
  --no-audit \
  --no-fund \
  --save-exact \
  playwright@1.62.1

PLAYWRIGHT_BROWSERS_PATH=/home/ccheever/.cache/ms-playwright \
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  /home/ccheever/capstone-0127-20260825/node_modules/playwright/cli.js \
  install chromium

sha256sum /home/ccheever/capstone-0127-20260825/instrument/instrument.manifest.json
```

The second instrument digest must be identical to the post-materialization
digest. Any difference stops the campaign.

## 3. Mandatory non-scored smoke

**UNVERIFIED and currently incomplete.** These commands prove source parsing,
the exact 0.3.4-m8 choreography's dependency resolution, Chromium launch, and
real M1/M7/M8 self-test reachability. They do not prove a production admission
transition or a controller-owned full/fresh-session lifecycle. The scored run
must remain blocked until the separately authorized tool revision supplies a
non-consuming admission/controller smoke and that smoke passes.

```sh
cd /home/ccheever/projects/snapback-capstone

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs \
  --help

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/lane-controller.mjs \
  --help

PLAYWRIGHT_BROWSERS_PATH=/home/ccheever/.cache/ms-playwright \
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  /home/ccheever/capstone-0127-20260825/instrument/tools/social-messenger/choreography/self-test.mjs \
  | tee /home/ccheever/capstone-0127-20260825/logs/choreography-self-test.log

env \
  -u NODE_PATH \
  -u NODE_OPTIONS \
  -u DYLD_FRAMEWORK_PATH \
  -u DYLD_LIBRARY_PATH \
  -u LD_LIBRARY_PATH \
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  --test \
  benchmarks/tools/social-messenger/metering/test/metering.test.mjs \
  | tee /home/ccheever/capstone-0127-20260825/logs/metering-tests.log
```

If every command passes, this smoke proves:

- the read-only materialized choreography resolves its campaign-private
  Playwright 1.62.1 dependency;
- cached Chromium can launch headlessly on this Linux host;
- the real instrument self-test reaches and validates M1, standalone fresh M7,
  and M8 paths, including one deliberate red;
- the current metering unit/integration fixtures pass under the exact Node.

Authoring-local result: materialization passed with the registered digest, but
the scrubbed metering suite is currently red (52/85 pass). Failures include
stale 0.3.3-m8 fixtures rejected by the 0.3.4-m8 controller, source-closure
mismatches, and local sandbox `ps` denial. Treat the host smoke as a mandatory
stop check, not as a predicted green.

What remains to be proved by the missing non-consuming smoke:

- Linux host identity admission;
- Gitless source/cell-state binding;
- exact controller claim of the admission lock;
- continuous M1–M6+M8 plus a second fresh M7 Codex process;
- native usage aggregation and separate M7 metering;
- all four main/M7 port blocks in both admission probes.

## 4. Cell 1 admission — Explicit

**UNVERIFIED; blocked by the STOP section.** Once the replacement tool revision
is landed and its smoke passes, this is the complete production admission argv.
It holds the campaign-private host lock and performs the three real one-minute
load samples. Do not add `--recover-stale-lock` unless an expired unused
admission is independently established and the tool prints the exact recovery
disposition.

```sh
cd /home/ccheever/projects/snapback-capstone

mkdir -p benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/admissions

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-explicit-sol-high \
  --reserved-by capstone-orchestrator-20260825 \
  --out benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/admissions/capstone-clique-explicit-sol-high.json \
  | tee /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.admission.log
```

Admission is valid for exactly 30 seconds. Launch immediately; do not inspect
or edit the admission JSON between issuance and launch.

## 5. Cell 1 launch — Explicit

**UNVERIFIED; blocked by the STOP section.** This is the exact registered
lane-controller + `r2-cell-driver.mjs` argv and detached logging pattern.

```sh
cd /home/ccheever/projects/snapback-capstone

nohup env \
  -u DYLD_FALLBACK_FRAMEWORK_PATH \
  -u DYLD_FALLBACK_LIBRARY_PATH \
  -u DYLD_FRAMEWORK_PATH \
  -u DYLD_INSERT_LIBRARIES \
  -u DYLD_LIBRARY_PATH \
  -u LD_PRELOAD \
  -u NODE_COMPILE_CACHE \
  -u NODE_OPTIONS \
  -u NODE_PATH \
  -u NODE_PRESERVE_SYMLINKS \
  -u NODE_REPL_EXTERNAL_MODULE \
  PLAYWRIGHT_BROWSERS_PATH=/home/ccheever/.cache/ms-playwright \
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/lane-controller.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-explicit-sol-high \
  --driver benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs \
  --admission benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/admissions/capstone-clique-explicit-sol-high.json \
  > /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.controller.stdout.log \
  2> /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.controller.stderr.log \
  < /dev/null &

printf '%s\n' "$!" > /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.controller.pid
```

## 6. Watch cell 1 and recognize finalization

**UNVERIFIED.** Use read-only watches. Expected file appearance order:

1. `attempt.json`, provenance files, and `process-ownership*.json` after the
   controller repeats admission and atomically creates the private cell;
2. `rendered-prompt.md`, `record-base.json`, `events/harness.stdout.jsonl`, and
   `gates/M1` after driver prepare/launch;
3. `gates/M2` ... `gates/M8`, then the fresh-session M7 gate/stream defined by
   the replacement driver; receipts and typed observation JSONL accumulate per
   attempted milestone;
4. `terminal-boundaries.json`, `metering-manifest.json`, `metering.json`, and
   `record.json` during deterministic finalization;
5. one JSON success line in controller stdout. Any stderr finalization failure
   retains `attempt-failure.json` and blocks cell 2.

```sh
tail -F \
  /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.controller.stdout.log \
  /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.controller.stderr.log
```

In a second read-only shell:

```sh
find /home/ccheever/capstone-0127-20260825/cells/capstone-clique-explicit-sol-high \
  -maxdepth 3 -type f -printf '%P\n' | sort
```

After the detached PID exits successfully, validate and publish the one-attempt
graph into the run directory. This step is mandatory before cell 2 admission;
the current command is blocked on Gitless-tree support.

```sh
/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-explicit-sol-high \
  --reserved-by capstone-orchestrator-20260825 \
  --publish \
  | tee /home/ccheever/capstone-0127-20260825/logs/capstone-clique-explicit-sol-high.publish.log
```

## 7. Cell 2 admission — Familiar

**UNVERIFIED; run only after cell 1 has a validator-clean finalized slot and all
four campaign port blocks are unbound.** The admission command again owns the
real three-minute load window.

```sh
cd /home/ccheever/projects/snapback-capstone

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-cell-admission.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-familiar-sol-high \
  --reserved-by capstone-orchestrator-20260825 \
  --out benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/admissions/capstone-clique-familiar-sol-high.json \
  | tee /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.admission.log
```

## 8. Cell 2 launch — Familiar

**UNVERIFIED; blocked by the STOP section.** Launch within the admission's
30-second window.

```sh
cd /home/ccheever/projects/snapback-capstone

nohup env \
  -u DYLD_FALLBACK_FRAMEWORK_PATH \
  -u DYLD_FALLBACK_LIBRARY_PATH \
  -u DYLD_FRAMEWORK_PATH \
  -u DYLD_INSERT_LIBRARIES \
  -u DYLD_LIBRARY_PATH \
  -u LD_PRELOAD \
  -u NODE_COMPILE_CACHE \
  -u NODE_OPTIONS \
  -u NODE_PATH \
  -u NODE_PRESERVE_SYMLINKS \
  -u NODE_REPL_EXTERNAL_MODULE \
  PLAYWRIGHT_BROWSERS_PATH=/home/ccheever/.cache/ms-playwright \
  /home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/lane-controller.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-familiar-sol-high \
  --driver benchmarks/tools/social-messenger/metering/r2-cell-driver.mjs \
  --admission benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/admissions/capstone-clique-familiar-sol-high.json \
  > /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.controller.stdout.log \
  2> /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.controller.stderr.log \
  < /dev/null &

printf '%s\n' "$!" > /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.controller.pid
```

Watch the Familiar logs and private cell with the same pattern as cell 1:

```sh
tail -F \
  /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.controller.stdout.log \
  /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.controller.stderr.log
```

After successful controller exit, publish the validator-clean graph:

```sh
/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-familiar-sol-high \
  --reserved-by capstone-orchestrator-20260825 \
  --publish \
  | tee /home/ccheever/capstone-0127-20260825/logs/capstone-clique-familiar-sol-high.publish.log
```

## 9. Post-run validation and artifact locations

**UNVERIFIED.** The controller first writes raw final artifacts at:

- `/home/ccheever/capstone-0127-20260825/cells/capstone-clique-explicit-sol-high/metering.json`
- `/home/ccheever/capstone-0127-20260825/cells/capstone-clique-explicit-sol-high/record.json`
- `/home/ccheever/capstone-0127-20260825/cells/capstone-clique-familiar-sol-high/metering.json`
- `/home/ccheever/capstone-0127-20260825/cells/capstone-clique-familiar-sol-high/record.json`

`r2-finalize-existing.mjs --publish` schema-validates and semantically validates
each hash graph, then copies the publication leaves into the corresponding
`benchmarks/runs/.../cells/<cell>/` directory and writes finalized `cell.json`
last. Re-run the no-launch validator/finalizer without `--publish` for each cell,
then validate the committed-record inventory:

```sh
/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-explicit-sol-high \
  --reserved-by capstone-postrun-validator

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/social-messenger/metering/r2-finalize-existing.mjs \
  --harness-config benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/harness-config.json \
  --cell capstone-clique-familiar-sol-high \
  --reserved-by capstone-postrun-validator

/home/ccheever/.local/node-v24.18.0-linux-x64/bin/node \
  benchmarks/tools/validate-records.mjs \
  | tee /home/ccheever/capstone-0127-20260825/logs/validate-records.log
```

The expected postcondition is two `[MACHINE VALID]` lines naming the capstone
records, no schema/semantic errors, both private `publication-manifest.json`
files present, both published slots finalized, and the exclusive lock released.
Do not aggregate or compare typing-path figures against the v1 0.1.25 run.
