# Snapback 4: distinguish stale generated polls in effect-generation guidance

**Priority:** P3
**Status:** Open
**Date:** 2026-09-17
**Scope:** `snapback4/crates/snapback4-lang/src/guide/codes.rs`, `guide/effects.rs`

The generic `E_EFFECT_GENERATION` guidance says a changed declaration parks
the effect. The strict generated declaration-poll fence also returns that
code, but deliberately refuses before selecting or changing any row. Detailed
claim documentation already distinguishes this behavior.

Independent B3b [Sol review](../llp/reviews/3000.009-bwork3b.sol.md) recorded
this as a nonblocking advisory on source `42ce2d9f563bfba6fa8bd357920b3e7ca2e4ad80`.
Root confirmed the wording against the tested declaration fence. Do not
change runtime parking or lease behavior to fit the generic message.

Update the two generic descriptions to distinguish a stale generated worker
poll (no row mutation; regenerate/restart the worker) from an admitted row's
declaration drift (queued/running work parks; terminal evidence is retained).
Add focused guide assertions and run the guide target. No production behavior,
authority, lease or wire change is required.
