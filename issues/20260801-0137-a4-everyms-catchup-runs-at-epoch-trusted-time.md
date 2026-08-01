# A4 sweep: everyMs cron catch-up run executes with trusted time at the epoch-0 nominal

**Opened:** 2026-08-01
**Systems:** Cron, Runtime
**Related:** LLP 0137 (A4 arm), LLP 0028, LLP 0051, demos/improvement-sweep/arms/a4-snapback-web/findings/0137-a4-f4-everyms-catchup-runs-at-epoch-trusted-time.json

The documented epoch-anchor catch-up run of an everyMs job fires at
nominal slot 0 — and the handler's trusted clock inside that run IS the
nominal: `ctx.runtime.now()` returns 0. Time-gated scheduled logic (A4's
`remindAt <= now` reminder scan) silently no-ops while the run ledger
records Succeeded; any timestamps committed would be 1970-dated. Observed
directly (retained probe): tick 0 = `{scheduledAtMs: 0, Succeeded}` over a
long-past-due reminder delivering nothing; tick 1 = real-wall nominal,
delivers. The cron guide documents "the first tick can look early" but
not the trusted-time consequence.

Fix shape: clamp the catch-up nominal to the most recent past-due slot
(floor(now/everyMs)*everyMs), or skip the never-run catch-up — either
way keep run identity deterministic — and document the rule. Witness: a
conformance job records ctx.runtime.now() on its first tick and the value
is within one interval of wall clock; a past-due time-gated scan delivers
on the first effective run.
