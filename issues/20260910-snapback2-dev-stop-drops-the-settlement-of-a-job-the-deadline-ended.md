# `dev --stop` drops the settlement of an effect job the deadline ended

Status: Open
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
