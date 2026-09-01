# snapback2: evaluator ignores certificate plan and schema hashes

**Status:** Open
**Systems:** snapback2, evaluator, certificates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:935-942

Failure scenario: retain the named-thread certificate but replace the program body with Return Null. evaluateCase accepts it and returns a fresh Null result. The Rust engine rejects the identical pairing with E_TRACE_SUBSET because digest(program) no longer equals plan_hash.

Why it happens: evaluateCase validates only value_model_version. It never recomputes plan_hash or schema_hash, while snapback2/crates/snapback2-core/src/engine/mod.rs:489-500 enforces all three identities before execution. Thus a stale or mismatched corpus/client plan can be evaluated as authoritative.

Suggested fix: canonicalize and hash the supplied program and schema with the shared algorithms and reject any certificate identity mismatch before constructing ClientStore. Add independent plan-hash and schema-hash tampering cases.
