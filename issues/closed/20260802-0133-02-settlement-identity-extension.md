# 0133-02: Extend ClientMutationIdentity with lane, identity claims, declaration, and claim set — fail closed on changed facts

**Status:** Closed
**Program:** 20260802-0133-00-settlement-substrate-program.md
**Systems:** Storage, Runtime, Sync
**Related:** LLP 0133 §Exactly-once identity under the new semantics; LLP 0043
M2; `src/storage.rs` (`ClientMutationIdentity`, `mutation_input_fingerprint`)

## Task

The shipped settlement ledger keys by `clientMutationId` and already binds
function, auth fingerprint, authority-instance descriptor, and the input
fingerprint over `{args, readSet, ctxLedger}`. Extend the retained identity
with every 0133 semantics-affecting fact:

- the lane;
- the element-1/5 identity claims a lane-L submission carries
  (implementation hash, activation);
- the bounded-skew declaration identity in force at capture;
- the lane-L claim set (the captured-environment/ctx-answer analog).

Fingerprint inputs vs. compared columns is implementation choice; the
normative behavior is:

- identical identity ⇒ republish the stored settlement, **no freshness
  re-gate** (republish even if the activation has since moved);
- any changed semantics-affecting fact under the same `clientMutationId` ⇒
  fail closed in the shipped reused/stale family
  (`SNAPBACK_CLIENT_MUTATION_ID_REUSED` / `SNAPBACK_AUTH_STALE_RESULT`
  family) — never the stored result, never a silent re-execution.

Gate ordering, normative (§Exactly-once identity): descriptor comparison
first (shipped), then ledger lookup with full identity comparison, and only
an unsettled id proceeds to lane policy and fresh execution.

## Exit

Acceptance sketch 8, as tests: duplicate with identical identity republishes
after activation movement; same id with changed lane, hash, activation, claim
set, or declaration fails closed; no double execution under any interleaving
the harness can produce.

## Resolution

Landed in `2d63f246` (`feat(settlement): bind settle-time identity facts`).
The additive mutation carrier now binds lane, implementation/activation
claims, the versioned answer-claim set, and the singular bounded-skew
declaration into the retained exactly-once fingerprint. Descriptor comparison
still precedes lookup; an exact identity republishes before active-function or
generation checks; each changed fact fails with
`SNAPBACK_CLIENT_MUTATION_ID_REUSED`.

Proofs:

- `local::tests::llp0133_sketch_8_settlement_identity_is_exact_and_precedes_freshness`
  covers activation movement, every individual identity fact, and the
  no-double-execution row count.
- `tests/artifact_schemas_v0.rs` passed all 30 tests after regenerating the
  additive mutation-input schema and remote-service review manifest.
- `npm test --workspace packages/snapback-client` passed.
- `./ref-check --verbose` passed with 0 errors and 0 unchecked references.

The full Rust library run reached 1,636 passing tests and inherited three
unrelated deterministic live-query failures from the already-landed
`eda8f231` narrowing change:
`rqs_mutation_after_answer_and_register_loses_no_ops`,
`rqs_tokens_refresh_across_delta_replace_and_current_as_of`, and
`standard_pattern_live_is_conservative_and_recorded`. Each also fails alone;
this ticket does not touch their live-query matcher paths.
