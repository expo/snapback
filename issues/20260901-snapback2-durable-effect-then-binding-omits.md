# snapback2: durable effect then binding omits the target mutation body

**Status:** Open
**Systems:** snapback2, effects, successors, durability
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2/src/writer_effects.rs:54-85

Failure scenario: an effect is running under generation A. Successor B changes only the body of its then mutation recordNotified while retaining the effect declaration/source and mutation name. When A's provider result returns, B's new mutation runs on the old result instead of failing E_EFFECT_THEN_CHANGED.

Why it happens: the durable generation is effects_hash, containing only EffectDecl values. Checks at snapback2/crates/snapback2-effects/src/runner.rs:280-302 and snapback2-core/src/registry.rs:469-515 compare the effect source and then name, then fetch the target program/certificate from the current generation. No claimed target digest is persisted.

Suggested fix: persist the certified then program/certificate digest at claim time and require an exact match before executing or rejecting then; otherwise settle E_EFFECT_THEN_CHANGED. Add running and then_pending body-only successor tests.
