# snapback2: evaluator applies user write rules to engine-owned maintained rows

**Status:** Open
**Systems:** snapback2, evaluator, maintained aggregates
**Severity:** P1
**Author:** GPT-5.6 Sol (ultra), directed by Charlie Cheever
**Date:** 2026-09-01

snapback2/packages/evaluator/src/evaluator.ts:798-818

Failure scenario: use the shipped chat-style schema where messages maintain messageCounts and the target table denies insert/update. Inserting an otherwise valid message locally reaches applyAggregate, checks the target insert rule, and throws E_RULE; the authoritative engine commits the source row and maintained count because maintained targets are engine-owned.

Why it happens: applyAggregate calls checkRule for the target at lines 814-816. LLP 1001 and the Rust path at snapback2/crates/snapback2-core/src/engine/runner_ops.rs:179-194 explicitly exempt aggregate writes from user insert/update/delete rules while still enforcing constraints.

Suggested fix: remove target user-rule evaluation from evaluator aggregate writes, retain row validation and constraints/unique checks, and add a corpus case whose maintained target denies all authored writes.
