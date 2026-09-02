# snapback2: Sort disagrees across twins when an input row lacks the key

**Status:** Closed
**Resolution:** Prevalidated every Rust Sort key so missing fields return E_FIELD like the evaluator; added matching twin regressions.
**Systems:** snapback2, evaluator, core engine, corpus
**Severity:** P2
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:642-652

Failure scenario: execute Sort by key over an input array whose first row lacks key and whose second row has key=0. The evaluator calls field and returns E_FIELD/refused. Rust at snapback2/crates/snapback2-core/src/engine/runner.rs:485-500 treats any comparison with a missing field as Equal and returns the original array.

Why it happens: the shared builtin has two incompatible missing-field policies, and ArgType::Scalar permits this concrete input. Certification validates neither row shape nor Sort keys, so both executions accept the same plan before diverging.

Suggested fix: choose one explicit shared policy, preferably a typed E_FIELD for a missing required sort key, implement it in both twins, and add a corpus vector containing one missing-key row.
