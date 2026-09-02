# snapback2: effect timeout cannot interrupt synchronous JavaScript

**Status:** Open
**Systems:** snapback2, effects, lifecycle
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-effects/src/ibex.rs:514-556

Failure scenario: an authored effect run function executes while(true){} or creates a microtask that schedules itself forever. The declared 30-second budget never fires, the outbox row remains running, and dev --stop/SIGTERM hangs joining the effects thread.

Why it happens: the timer starts only after call_host returns, and elapsed time is checked only after drain_microtasks returns. Neither synchronous host invocation nor a microtask pump has an interrupt/deadline. EffectsStatus::drop at snapback2/crates/snapback2/src/effects.rs:265-271 performs an unbounded join.

Suggested fix: install a Hermes interrupt/watchdog or instruction deadline around initial invocation and every microtask drain, propagate cancellation into shutdown, and bound/reap the runner thread. Test an infinite loop and recursively scheduled microtasks.

## Upstream handoff for expo/ibex

Snapback 2 is pinned to expo/ibex revision `174c94fb7eb06785d3b48ce9f92527b6f9636bd3`. The blocking path at that revision is in `crates/ibex2/src/engine/hermes_shim.cc`: `ibex2_hermes_eval` calls `HermesRuntime::evaluateJavaScript`, `ibex2_hermes_drain_microtasks` calls `drainMicrotasks`, and `ibex2_hermes_pump` performs both pre- and post-task `drainMicrotasks` calls. None arms an async break or accepts a deadline. Their Rust wrappers in `crates/ibex2/src/engine/hermes.rs` (`Hermes::eval`, `Hermes::drain_microtasks`, and `Hermes::pump`) are correspondingly synchronous and expose no interruption control. Snapback cannot observe its elapsed budget while any one of those calls is stuck.

Ibex should add a deadline/interrupt API around all three execution entrances. With vanilla Hermes, the concrete `HermesRuntime` supports time-limit watching; the runtime must be created with async-break checks enabled for evaluated source, arm a remaining-duration deadline before evaluation or a microtask checkpoint, translate the engine-owned timeout into a distinct checked result, and always disarm it. `ibex2_hermes_pump` must also call `ibex2_end_drive` on the interrupted/error path so the task queue is not left permanently driving. The safe Rust surface should return checked results from eval, pump, and microtask drain rather than collapsing status or discarding it. Upstream regressions should cover `while (true) {}` during host eval and a recursively self-scheduling Promise microtask, then prove the runtime can be destroyed or reused according to the documented timeout contract.

There is no sound in-process Snapback-only boundary defense with the pinned API. Checking elapsed time before or after the call cannot preempt it; source-text loop rejection is evadable; and detaching the owner join would let runaway JavaScript keep consuming CPU while leaving the outbox row `running`. Process-isolating each effect could make termination enforceable, but that is a new engine architecture and apparatus, not a local bug fix. Therefore Snapback cannot honestly enforce `E_EFFECT_TIMEOUT` or bounded shutdown until Ibex exposes interruption, and this ticket remains open.
