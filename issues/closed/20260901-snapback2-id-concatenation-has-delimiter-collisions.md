# snapback2: Id concatenation has delimiter collisions

**Status:** Closed
**Resolution:** Replaced colon-joined Id concat with canonical Value-tuple encoding in Rust and TypeScript; added collision-pair regressions in both twins.
**Systems:** snapback2, core engine, evaluator, identifiers
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/crates/snapback2-core/src/engine/runner.rs:443-455

Failure scenario: concat(Id("a:b"), Id("c")) and concat(Id("a"), Id("b:c")) both return Id("a:b:c"). The shipped compiler fixture uses concat to construct unread row IDs, so legal user IDs containing colons can make distinct conversation/member pairs collide and cause a duplicate rejection or attach state to the wrong pair.

Why it happens: both Rust and snapback2/packages/evaluator/src/evaluator.ts:607-615 join IDs with an unescaped colon. Id validation forbids only the reserved system principal, not colons, and no downstream layer can recover the original tuple.

Suggested fix: use a canonical injective tuple encoding such as length-prefixing/canonical Value JSON, or reject unsafe components at the authoring boundary. Add the two-pair collision to the corpus and fixture tests.
