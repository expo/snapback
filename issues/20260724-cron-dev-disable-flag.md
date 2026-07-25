# Dev/test flag to disable or explicitly arm the cron scheduler

**Status:** Open
**Severity:** P2
**Systems:** Cron, Testing, Developer experience
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-24
**Related:** LLP 0028 (§Scheduler state, §Inspection and query surface), src/cron.rs, expo-jam-allaboard diary 0001
**Marker:** all-aboard-external-review

The scheduler tick loop spawns unconditionally whenever app data is
available (`src/server.rs:14151-14187`, spawned from `src/cli.rs:2166`).
There is no way to run a server with crons authored but inert: the only
levers are the per-job authored `enabled` flag, never subscribing a
`WhileLive` query, or driving ticks manually via the admin
`POST …/cron/tick`. The single cron env var,
`SNAPBACK_CRON_DISPATCH_CONCURRENCY`, tunes concurrency, not arming.

The All Aboard external review (Kimi, 2026-07-24) named the 180 s
`warmPoll` cron the "biggest hidden-behavior tax on every suite": it
commits ticks mid-test, and the first tick was observed ~180 s after
boot before any obvious subscription. That second observation is not a
bug — LLP 0028 §Inspection and query surface (ENG-22604) ratifies the
epoch-0 interval anchor, so `everyMs` nominals snap to absolute
wall-clock boundaries and the first armed evaluation finds a past-due
nominal (one catch-up run, no backfill). But nothing test-facing
surfaces that fact, so it presents as a mystery to every suite author.

Proposed: a dev/test-mode switch (env var and/or CLI flag, e.g.
`SNAPBACK_CRON_DISABLED=1`) that keeps cron definitions loadable and
inspectable but never claims a run; the admin manual-tick endpoint keeps
working so suites can drive ticks deterministically. Alternatively or
additionally, an explicit-arming mode where `WhileLive` jobs arm only
after an opt-in call. Document the epoch-anchor consequence ("first tick
can land up to one interval after boot regardless of subscribe time")
where suite authors will see it — the guide's testing/cron pages — not
only in LLP 0028.

**Done when:**

- A documented switch runs the server with the scheduler inert while
  manual ticks still work; a test proves no autonomous run commits under
  it.
- `demos/_kit` exposes the switch to acceptance suites.
- The epoch-anchor first-tick behavior is stated in the relevant guide
  page(s), with LLP 0028 cited.
