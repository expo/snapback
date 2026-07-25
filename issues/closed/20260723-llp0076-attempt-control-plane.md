# StreamAttemptV1 control plane: trusted terminalizer + single-runner lease

**Status:** Resolved (2026-07-24 — landed on the local arm; residue explicitly reassigned, see Resolution)
**Severity:** P1
**Systems:** Actions, Runtime, Durable mutations, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0076 §Settlement and retry (terminalizer/lease/StreamAttemptV1) + Evidence-status gaps, LLP 0070 (fenced-claim model), LLP 0028 (action commit gate), demos/competitive-checkpoint/snapback/handlers.mjs (reference pattern), src/runtime.rs (ActionStreamRequest), issues/20260723-llp0076-streaming-program.md
**Marker:** llp-0076, streaming, control-plane

Implements the specified-but-unimplemented late-effect fence. The reference
progress pattern leaves durable terminal settlement to an authored mutation that
cannot run once the action is abandoned (so the attempt row can stay `running`
with no durable winner), and `startReply` hands the same attempt to concurrent
callers with no lease (so two runners can splice differently-segmented bytes).
The Spec makes both a host-owned `StreamAttemptV1` record: the runtime owns the
attempt identity, runner-generation lease, `initiationState`, and terminal
cause+certainty, and issues an opaque attempt token binding fetch, progress,
cancellation, lease renewal/takeover, and terminal settlement.

**Done when:**

- A host-owned `StreamAttemptV1` record + opaque attempt token exist; the
  authored progress row references the token and does not own the fence-critical
  fields.
- A trusted compare-and-set terminalizer (or lease-expiry reconciler) writes the
  terminal row on generation retirement, service-authority terminalization, and
  watchdog abandonment, so a durable winner always exists; the action returns
  the committed terminal result verbatim.
- The single-runner lease binds every progress and terminal mutation; a second
  runner cannot commit; retry after the first durable progress commit is refused.
- Barrier-controlled cancellation/timeout/completion/failure race tests at both
  sides of the commit cut; the abandoned-action terminalization race is
  witnessed.
- Automatically retried cron/LLP 0070 durable invocations are refused for
  streamed actions until this lands.

## Resolution (2026-07-24)

Landed on the local arm in `src/stream_attempt.rs` plus the
`DetachedActionHost` / action-runner integration in `src/server.rs`, with the
`ctx.streamAttempt.start`/`settle` surface and `attemptToken` stream-request
binding through `src/runtime.rs` and the harness bridge:

- Host-owned `StreamAttemptV1` registry: opaque token, single-runner lease
  (dead-holder takeover bumps the runner generation), per-cursor child records
  (decision 3) whose `initiationState` folds pessimistically into the
  parent's effect certainty (decision 2).
- Trusted CAS terminalizer, three legs: watchdog abandonment (linearized
  under the commit gate), fence-loss completion (generation/authority loss →
  `cancelled`), authored forfeiture (return-without-settle → `failed`). The
  action receives the committed winner verbatim; a divergent late settle
  observes, never overwrites.
- Lease binds every nested-mutation progress commit (host `progress_guard`)
  and terminal settle; retry after the first durable progress commit is
  refused at cursor bind; automatic cron re-dispatch (attempt > 1 or recovery
  trigger) refuses `fetchStream` open outright.
- Witnesses: 7 registry unit tests including a barrier-controlled
  authored-vs-terminalizer settle race; host-level lease/fence tests; a real
  action-path test proving verbatim-winner return and terminalizer
  forfeiture; a hung-action watchdog witness proving the abandoned-action
  terminalization race. `cargo test --lib` 1129 passed; the LLP 0075
  local-streaming instrument stays PASS 6/6.

Residue, explicitly reassigned rather than silently dropped: the
crash-durable write-ahead substrate rides
`20260723-llp0076-initiation-state.md`; the direct attempt-to-cursor
cancellation signal rides `20260723-llp0076-per-read-authority-fence.md`; the
Workerd arm has no attempt control plane (tracked in the program index's
baseline-landing note); duplicate-sequence digest acceptance and the frozen
fixture's token adoption ride the prospective LLP 0075 amendment named in LLP
0076. The lease refusal rides the `SNAPBACK_ACTION_STREAM_INVALID` family
rather than minting a ninth diagnostic code.
