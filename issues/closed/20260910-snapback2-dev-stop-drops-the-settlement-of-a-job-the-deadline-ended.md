# `dev --stop` drops the settlement of an effect job the deadline ended

Status: Closed — writer accepts the bounded runner's final settlement before teardown (2026-09-10)
Priority: P1
Systems: Snapback 2 owner (effects runner shutdown order)
Related: LLP 1021 §5 (owner bullet), LLP 1003 §2 and §4, lane `deadline` fix round r1
Reported: 2026-09-10, lane `deadline` fix round r1 (`snapback2/crates/snapback2/tests/effects.rs`, `dev_stop_observes_owner_process_exit_while_a_spinning_effect_runs`)

`Action::Stop` sets the owner's shared `stop` flag, and the writer's drive loop
(`snapback2/crates/snapback2/src/writer_jobs.rs`, `drive`) breaks right after
answering that request. The effects runner is joined only later, when
`EffectsStatus` drops at the end of `owner()`. A job the engine's deadline ends
after the stop — up to the 30 s budget later — is settled by the runner through
`OwnerHandle::call(Action::OutboxSettle { .. })`, which by then fails with
`owner_gone()` because the writer has left; the runner's log line for the
failed drain goes the same way (`let _ =` in `WriterAccess::write_logs`). The
row stays `running` and is `sent_unknown` on the next boot — the RFC's
detachment outcome — although the deadline did fire and the process waited for
it. Observed (`.snapback/store.sqlite` after the exit): a stop during the
first attempt leaves `("running", None)`; a stop during the second attempt —
the journey's shape — leaves `("running", Some("E_EFFECT_TIMEOUT: budget
30000 ms"))`, the `last_error` being the first attempt's, which settled while
the owner was alive (a claim does not clear it). Either way the owner exited
~30.04 s after `dev --stop`, and the settlement would have made the row
`queued` with the timeout and the backoff `next_at`.

Wanted: on the stop path the writer outlives the runner's join (or the runner is
stopped and joined before the writer breaks), so the settlement lands and
`.snapback/log.jsonl` carries the runner's line; then the journey can assert
the row after exit. Today it observes the deadline through the first attempt's
`running → queued` transition while the owner is alive, stops during the
second attempt's spin, and prints (does not assert) the post-exit row. This
belongs with the owner `Drop`/detach work of LLP 1021 §5 (lane `traps`), which
is restructuring the same stop path; do not fix it from the effects crate.

## Reconciliation — 2026-09-11

Fresh Hermes tests prove synchronous-loop and recursive-microtask deadlines now fire,
but LLP 1021's implementation record explicitly retains this owner shutdown ordering
defect. `Action::Stop` can still end the writer loop before the joined runner's
post-deadline `OutboxSettle` and log write arrive. The 30-second stop case was not repeated
because the current source/LLP record is decisive and this pass was bounded.

Next acceptance: keep the writer able to accept settlement/log actions until the runner
is stopped and joined, then assert the post-exit row is `queued` with the current timeout
and backoff rather than restart-derived `sent_unknown`. Preserve bounded stop and do not
move this fix into the effects crate.

## Resolution — 2026-09-10

`Action::Stop` now fences new effect claims without ending the writer loop. Owner
teardown drops `EffectsStatus` first, which preserves its existing budget-plus-one-second
join/detach bound while the writer can still accept `OutboxSettle` and `EffectsLog`; an
internal `FinishStop` action ends the writer only after that bounded step. The fix stays
in the owner/writer lifecycle and does not change the effects crate.

`dev_stop_observes_owner_process_exit_while_a_spinning_effect_runs` now reads the store
after the owner exits and requires the second/current attempt to be `queued`, with the
exact `E_EFFECT_TIMEOUT: budget 30000 ms`, a retry `next_at`, and the matching logged
`running → queued` transition at attempt 2. The default
`detached_stop_removes_owner_state_and_waits_for_the_pid` regression passes. This host
does not have the vanilla-Hermes fixture required to execute the 60-second spinning
journey; `scripts/hermes` reports that prerequisite explicitly, so the strengthened
Hermes assertion remains part of the scheduled Hermes suite rather than being claimed
as a local pass.
