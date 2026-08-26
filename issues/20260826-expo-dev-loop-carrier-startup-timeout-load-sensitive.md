# `expo-dev-loop.test.mjs` carrier-startup-timeout case is load-sensitive

- Status: Open — fix landed 2026-08-26, **not verified end to end**
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

## Fix landed 2026-08-26 — and what is still unproven

Both directions above are applied:

1. `startupTimeoutMs` for this row is now `60_000`. The comment states why the
   number is free to move: the barrier hook blocks forever, so the carrier always
   times out and the row proves the timeout *path*, not that startup fits a
   budget. It only has to exceed real supervised startup, which 15 s did not on a
   loaded machine. Cost: this row now burns 60 s instead of 15 s.
2. The cleanup marker is sampled with `eventually` instead of once. The abort
   listener's `writeFileSync` and the CLI's exit are not ordered against each
   other, so a single sample at an arbitrary instant was a race. This strictly
   weakens a check; it cannot turn a passing case red.

**Not verified.** The run that would prove it has not completed. The machine has
been at sustained load 29–33 from concurrent sessions, and the suite advanced one
console line per ~20 minutes — it never reached this row. The fix is landed on
the reasoning above, not on a green run, and this ticket stays **open** until
someone watches the row pass on a quiet machine.

Direction 3 (assert the abort *effect* — no detached process group, no
descriptor — rather than a marker file the runner races) is **not** done and
remains the better long-term shape.

## Still blocked behind this row

LLP 0310.000's A1/A3 live-arm coverage sits after this case in the file and has
therefore still never executed. That is the reason this ticket matters beyond
its own noise.

**The independent repair, and why it was not done here.** This file already
supports section isolation — `--metro-stop-race-only`, `--http-control-only`,
`--no-token-carrier-only`, `--regular-file-only`, and others, dispatched from one
`if/else if` chain. Every one of them gates a suite that has been **extracted
into a named function**. The live-successor arm is not: it is roughly 400 lines
of inline top-level code, so `--live-successor-only` cannot be added without
extracting it first.

That extraction is the change that would make the RFC's headline acceptance row
runnable on demand, independent of everything before it in the file and
independent of this timeout entirely. It was deliberately not attempted in the
same session that wrote the coverage, because the machine could not run the file
to validate the refactor — moving 400 lines of a suite you cannot execute is how
coverage silently stops covering. Whoever has a quiet machine should do it there.

Ordering note for that work: extract first and prove the extracted suite passes
in isolation, *then* add the flag. A flag added first will appear to pass by
running nothing.
