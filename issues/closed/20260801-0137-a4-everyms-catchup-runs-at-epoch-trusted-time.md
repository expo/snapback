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

---

**Status:** Resolved (2026-08-01, 0137 between-arms fix lane)

**Root cause.** `initial_nominal` (src/cron.rs) seeded a never-run `everyMs`
job at epoch slot 0; the claimed run's trusted clock is bound to its due
time (`now_ms: run.due_at_ms` in the action host context), so the catch-up
run executed with `ctx.runtime.now()` ~0 while `finish_run` recorded
Succeeded. Consistent with the A5 refinement above: only the ACTION
invocation's clock is nominal-bound — nested mutations construct their own
context with wall-clock trusted time — so the fix targets exactly the
due-scan's nominal seeding.

**Fix.** The never-run seed is now the most recent epoch-aligned slot at or
before now (`floor(now / everyMs) * everyMs`): the grid stays
epoch-anchored, run identity stays deterministic
(`cron:{job}:scheduled:{slot}`), the catch-up still fires promptly, and its
trusted clock is within one interval of wall clock. LLP 0028 §Inspection
and query surface amended (dated 2026-08-01) — including retiring the
`nextNominalAtMs: 0` fresh-job wire value; guide cron + acceptance pages
updated.

**Witness.** `cron::tests::first_interval_claim_seeds_at_the_most_recent_slot_not_epoch_zero`
asserts the claim's `scheduledAtMs`/`dueAtMs` are the current slot (proven
to fail pre-fix with `Some(0)`); two existing tests that claimed exactly on
a slot boundary moved off it.

**Residual (flagged in the LLP amendment as an open design question).** A
STALE PERSISTED nominal after downtime still coalesces to a single catch-up
run that keeps the missed slot's identity and therefore its nominal-bound
(old) trusted time; whether that recovery run should clamp its trusted
clock is a design decision under LLP 0028 §Delivery, not a regression
repair. The A5-noted action-vs-nested-mutation clock split inside one run
remains observable for that recovery case.
