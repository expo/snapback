# Terminal reap at settle-flush breaks the attempt-to-cursor signal (main red)

**Opened:** 2026-08-08 · **Closed:** 2026-08-08 (fix-forward, same day) ·
**Severity:** main red — three lib contract tests failing on main, unticketed

## What broke

`24af62549` ("stream-attempt/jobs retention + diagnostic inventory") turned
`clear_dirty` into `clear_flushed`, which reaps a terminal attempt record
(`reap_terminal`) the moment its terminal snapshot durably flushes — i.e.
inside `settle_stream_attempt`'s own `flush_stream_attempts_required`,
while the settling invocation is still live. That removed `by_token` and
`by_cursor` entries that two @ref'd LLP 0076 contracts depend on:

- the per-read attempt-to-cursor cancellation signal
  (`cursor_attempt_terminal`, consulted before every pull) returned false,
  so a settled attempt no longer closed its open cursors —
  `server::tests::attempt_settlement_signals_the_cursor_without_a_progress_mutation`;
- a later leg of the same invocation (and the watchdog's
  hung-worker-late-settle path) found "the stream attempt token is unknown
  to this host" —
  `server::tests::stream_attempt_control_plane_settles_verbatim_through_the_real_action_path`,
  `server::tests::stream_attempt_lease_fences_second_runner_progress_and_cursor_retry`.

The retention commit's own new unit test asserted the immediate reap,
directly contradicting the three pre-existing contract tests — the reap
timing was accidental, not a ruled contract change.

## Fix (this commit)

Retention stays real; the reap moves to when it is safe:

- `clear_flushed` reaps a flushed terminal only when **no live invocation
  still references the token**.
- New `release_invocation(runner)` drops the invocation's registry
  reference and reaps released, clean, unreferenced terminals (dirty ones
  ride the next flush). Called on the worker completion leg (before the
  trusted flush) and the thread-death leg; the watchdog leg deliberately
  does not release, so a hung worker's own late settle still observes the
  durable winner verbatim.
- The retention unit test now asserts the corrected lifecycle, plus a new
  dirty-release deferral test.

Verified: the three named tests plus the full `stream_attempt`/`attempt_`
selection (27 passed) and `server::tests` module green on this tree.

Found while qualifying LLP 0200 Phase 1 (the off-turn scheduler branch
inherited the red and bisection attributed it to base); fix authored there
and cherry-picked to main.
