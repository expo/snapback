# Repeated short-lived authenticated headless clients stall the backend until an exact-PID restart

**Filed:** 2026-08-15 · **Source:** clique-0121 exploratory sweep (LA Durand,
`~/clique-0121-20260814`), lanes `sol-snapback-explicit`,
`sol-snapback-familiar`, `sol-snapback-simplified` (0.1.21) ·
**Systems:** Runtime, Auth, Realtime lifecycle

## Problem

All three Snapback lanes independently hit backend stalls under repeated
short-lived authenticated headless clients (fixture seeding, acceptance
replay):

- **familiar:** two M1, three M2, and two M3 auth-client stalls; the
  workaround was grouping fixture actions by persona/process phase and
  restarting exact backend PIDs between retries. Headless `closeAuth` also
  retained a realtime lease, so one-shot scripts had to use process-owned
  in-memory custody and explicit process completion.
- **simplified:** repeated duplicate/sign-in probes could leave a correct
  auth request stalled until the backend child was restarted; M3 replay was
  rewritten to preflight identities specifically to avoid password-session
  churn.
- **explicit:** a transient auth timeout stalled one silent acceptance run.

This is the highest-frequency runtime defect in the sweep — it caused more
correction loops than any application-model issue, it makes acceptance
suites flaky by construction, and every agent building on Snapback runs
exactly this seed/replay pattern.

## Evidence

- `lanes/sol-snapback-familiar/diary.md` + `final-report.md`
  (instrument/tooling loop table: 12 loops, majority auth-lifecycle stalls).
- `lanes/sol-snapback-simplified/diary.md` M1 + `final-report.md` backend
  loops ("password-session stalls after repeated fixture auth").
- `lanes/sol-snapback-explicit/diary.md` M2 (transient auth timeout).

## Suggested fix

Reproduce with a loop of N sequential connect → password-auth →
mutate → disconnect headless clients against one dev backend; instrument
where the stall sits (session establishment, custody barrier, realtime
lease teardown, or connection accounting). Fix `closeAuth` to release its
realtime lease deterministically. Add the loop as a stress acceptance test
with a stall watchdog so regressions are visible in CI rather than in
downstream agents' correction loops.

## Resolution

Resolved 2026-08-15. A 32-client packaged-client acceptance loop reproduced
the stall reliably on the twenty-first password signin. Temporary phase
instrumentation localized the wait to the detached password commit's provider
admission: planning still held a shared maintenance/address guard after
projection `Begin`, while periodic garbage collection was queued for the fair
write side, so the commit's nested shared admission self-deadlocked behind the
writer. Password flows now release planning guards before `Begin`, and the
owned commit reacquires one fresh guard afterward; exact predecessor checks
retain race safety.

`closeAuth()` now idempotently aborts auth work, closes and settles every raw
stream and live manager, and clears local grants and reconnect demand. The
acceptance witness completed all 32 signin → mutate → protected-live-query →
disconnect clients with a per-phase watchdog (slowest phase: 1.333 seconds),
and `password-auth.test.mjs` proves terminal realtime drain directly.
