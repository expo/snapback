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

---

**2026-08-01 (A5 arm re-verification + refinement):** the epoch-0
catch-up run reproduced on the A5 refresh cron
(`{scheduledAtMs: 0, Succeeded}`, evidence
`demos/improvement-sweep/arms/a5-snapback-web/evidence/scenario-evidence.json`
A5-12 scheduleIdentity). Refinement: the epoch clock applies to the
ACTION invocation only — mutations the action runs via `ctx.runMutation`
during that same catch-up run see their own real trusted time (A5's
`beginRefresh` minted real-timestamp dedupe keys like
`refresh:1785591363185` inside the slot-0 run, never `refresh:0`). So
time-gated logic is wrong at epoch only when it uses the action's clock
or an action-passed `now`; nested-mutation clocks are sound — and the
two clocks being different trusted values inside one run is itself worth
documenting.
