# snapback2 evaluator trust: cross-schema verdict reuse, missing version/cert checks

**Status:** Closed
**Priority:** P1 (trust boundary)
**Date:** 2026-09-12
**Source:** snapback2 comprehensive review workflow (2026-09-11 sweep)
**Location:** `snapback2/packages/evaluator/src/store.ts:57`, `:101-138`; `snapback2/crates/.../client.rs:181-190`; `snapback2/crates/.../engine/mod.rs:188-192`; `snapback2/packages/evaluator/src/evaluator.ts:73-84`; `snapback2/packages/evaluator/src/runner.ts:44`, `:107-133`

## What was reported

Several gaps in the evaluator receipt/trust chain:

- `store.ts:57` + `client.rs:181-190` — `checkedReceipt` clears absences
  only on `schema_hash` mismatch but **keeps verdicts**, enabling
  cross-schema verdict reuse (needs a schema pair with identical rule hash
  but changed `rule_input_is_readable` — not constructed; asymmetry only).
- `engine/mod.rs:188-192` — `install_receipt_authority` has no
  schema-hash check.
- `evaluator.ts:73-84` — never checks `evaluator_version`;
  `runner.ts:44` pins `CURRENT_EVALUATOR` but it is never enforced.
- `runner.ts:107-133` — `execute(certificate: any = null)` budget-only
  fallback with no identity; `reexecute`/`applyMutation`
  (`store.ts:101-138`) default to null with no binding.

Open question from the review: whether production `ClientStore` callers
route through `evaluateCase` or call `reexecute`/`applyMutation` directly
with attacker-influenced `certificate=null` — caller graph not traced.

## Suggested fix

- Clear **both** absences and verdicts on schema mismatch; enforce
  `evaluator_version` + `schema_hash` on install/execute; require a real
  certificate for non-ack paths (no `null`).
- Trace the `ClientStore` caller graph first and record which callers can
  pass `certificate=null`.

## Acceptance

- Schema change invalidates prior verdicts (regression test with a schema
  pair); version/cert enforcement covered by tests.

## Resolution (2026-09-12)

Receipt admission now clears both absences and verdicts on schema mismatch in TS and Rust; Engine installation independently checks the envelope hash. Runner.execute validates evaluator/value-model versions and canonical schema/program identity, so direct reexecute/applyMutation cannot use null certificates. Corpus preludes now carry actual Rust-issued certificates. Test-only hand-built IR uses an explicit fixture binder, never the production path.

Caller graph: production Twin.evaluate and Twin.predict pass operation.certificate directly; they do not route through evaluateCase. Authority-only Runner.readAuthority calls do not execute a program and legitimately carry no certificate. Current Rust/TS scoped rule hashes already bind the complete schema, so the reported identical-hash/schema-pair exploit is not reproducible on this head. Tests deliberately retag an inner verdict while preserving the stale envelope to prove the independent fence.

Validation: evaluator full suite green (266 executable cases,27 expected server-only refusals plus indexed/authority/merge/delivery/canonical regression groups); direct missing/stale certificate controls cover read and mutation. Rust merge16+spike13 tests green, including predecessor envelope rejection. Canonical hashing now also omits explicit opaque_cursor:false exactly as serde does.
