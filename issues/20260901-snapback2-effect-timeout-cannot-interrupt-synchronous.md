# snapback2: effect timeout cannot interrupt synchronous JavaScript

**Status:** Open
**Systems:** snapback2, effects, lifecycle
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-effects/src/ibex.rs:514-556

Failure scenario: an authored effect run function executes while(true){} or creates a microtask that schedules itself forever. The declared 30-second budget never fires, the outbox row remains running, and dev --stop/SIGTERM hangs joining the effects thread.

Why it happens: the timer starts only after call_host returns, and elapsed time is checked only after drain_microtasks returns. Neither synchronous host invocation nor a microtask pump has an interrupt/deadline. EffectsStatus::drop at snapback2/crates/snapback2/src/effects.rs:265-271 performs an unbounded join.

Suggested fix: install a Hermes interrupt/watchdog or instruction deadline around initial invocation and every microtask drain, propagate cancellation into shutdown, and bound/reap the runner thread. Test an infinite loop and recursively scheduled microtasks.
