# `expo-dev-loop.test.mjs` carrier-startup-timeout case is load-sensitive

- Status: Open
- Date: 2026-08-26
- Systems: `packages/snapback-cli` (`expo-dev-loop.test.mjs`, carrier-kit
  `startupTimeoutMs`)
- Governing: LLP 0189 (verification cadence), LLP 0232 (inherited/flaky reds are
  not a landing veto)
- Related: `issues/closed/20260825-expo-dev-loop-temp-scaffold-module-resolution.md`

## Symptom

The "production `runExpoDev` barrier through the carrier's real startup timeout"
case declares `startupTimeoutMs: 15_000` and then asserts, in order:

```js
assert.equal(existsSync(cliTimeoutBarrier), true);   // beforeReadinessPublish ran
assert.equal(existsSync(cliTimeoutCleanup), true);   // its abort listener fired
```

Under machine load neither is reliable, and **which** one fails moves with how
loaded the machine is:

| Run | Load (1 min) | Outcome |
|---|---|---|
| `origin/main` @ `ed8300f90`, ×2 | ~10–15 | both assertions pass |
| branch, ×3 (one with the Track A supervisor change reverted) | ~25–30 | barrier written, **cleanup marker missing** |
| branch, ×1 | ~28 | **barrier missing** — startup never reached `beforeReadinessPublish` inside 15 s |

The last row is the tell: a supervised startup that does not reach
readiness-publish within 15 seconds is a slow machine, not a product defect. The
cleanup-marker failure is the same problem one step earlier — the carrier
SIGTERMs, and the CLI's abort listener loses its race with the process exit.

## Not a regression from the LLP 0310.000 wave

Reverting the Track A supervisor change (`packages/snapback-cli/expo-dev.mjs`)
and rerunning reproduced the failure unchanged, and nothing else in that wave
executes on this path: Track A/A2 is `packages/snapback-expo/provider.mjs`,
Track D is `packages/snapback-react/implementation.mjs`, and Track C's staging
directory is created outside the project the carrier drives.

## Direction

Make the row's timing explicit rather than ambient:

1. Scale `startupTimeoutMs` for this case, or take it from an env override, so a
   loaded machine does not read as a supervisor defect.
2. Wait for the cleanup marker rather than sampling it once — the carrier's
   `stopOwned(child)` resolves when the child exits, but the abort listener's
   `writeFileSync` and the process teardown are not ordered against each other.
3. Consider asserting the abort *effect* (no detached process group, no
   descriptor) rather than a marker file the runner races.

## Consequence while open

`expo-dev-loop.test.mjs` cannot report green on a loaded developer machine. The
LLP 0310.000 A1/A3 coverage added by this wave — the live-successor arm held
across schema and functions successors — sits **after** this case in the file
and is therefore unexecuted locally until this is fixed or the machine is quiet.
