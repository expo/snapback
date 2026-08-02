# 0133-02: Extend ClientMutationIdentity with lane, identity claims, declaration, and claim set — fail closed on changed facts

**Status:** Open
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
