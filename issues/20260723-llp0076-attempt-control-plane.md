# StreamAttemptV1 control plane: trusted terminalizer + single-runner lease

**Status:** Open
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
