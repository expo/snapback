# Snapback 2 acknowledgement no-op still commits the mutation

**Status:** Closed
**Priority:** P3
**Date:** 2026-09-11
**Systems:** `snapback2/crates/snapback2-core/src/engine/runner_ops.rs` (`acknowledge`), `engine/acknowledgements.rs`
**Source:** Snapback 2 codebase review 2026-09-11
**Related:** LLP 1019 (removed members stay `received: false`)

## Symptom

Acknowledgement updates call `acknowledge`. A false result (`received` already true, `recipient != viewer`, or current membership probe misses) returns `Ok(())` and skips the write. The enclosing mutation still commits.

Idempotent re-ack is the right shape. A failed membership probe is also `Ok(false)` with a traced constraint, then a successful `Committed` state. A client that acks an event after leaving the group, or acks another principal’s receipt id, can observe `committed` while `received` stays false.

LLP 1019 wants removed members to stay `received: false`; the silent success is the problem, not the false value.

## Proposed

Distinguish:

1. Idempotent already-true → commit, no-op (keep).
2. Not this recipient / not a member → reject `E_RULE` (or a typed no-op in the result, not `committed` with no write).

```rust
        if self.acknowledgement.as_deref() == Some(table) {
            match self.acknowledge(table, &old)? {
                Ack::Applied | Ack::Already => {}
                Ack::Denied => {
                    return Err(RuntimeError::Rule {
                        table: table.to_owned(),
                        effect: Effect::Update,
                    });
                }
            }
        }
```

Shape `acknowledge`’s `bool` into an enum so already-true and denied are not the same `false`. Tests at `acknowledgements.rs` that expect `Rejected` only on missing original / broken membership *row* need a sibling for “not a member.”

## Acceptance

- Re-ack of an already-received event still commits and does not rewrite.
- Ack of another principal’s receipt, or ack after leave, is `rejected` / `E_RULE`, not `committed` with `received` still false.
- Removed members stay `received: false` (LLP 1019).

## Resolution (2026-09-11)

Separate denied recipient/current membership from idempotent already-received acknowledgement. Denials now return E_RULE (including foreign already-received receipts). The generated operation also refuses visible nonremoved events whose body/receipt is no longer readable, so a departed member cannot bypass the private membership check through an earlier null branch. Current recipients can re-ack without rewriting received/seq; removed recipients remain false.

The public mutation accepts delivery EVENT ids, not arbitrary receipt ids. Preserve the guide's retention contract: missing or unreadable submitted events remain indistinguishable no-ops; foreign receipt updates are rejected by the internal recipient check. This avoids turning an unreadable event into an existence oracle. LLP 1019 and guide state the boundary explicitly.

Validation: core library 189/189; delivery integration 59/59; final acknowledgement-focused 5/5 (missing original, malformed membership, absent membership, foreign false/true receipt, own true idempotency, reserve). The integration test now expects E_RULE after leave, while the existing duplicate re-ack witness preserves first seq. Regenerated ack corpus/certificate and manifest; exporter --check 293 passes, evaluator 266 runnable/27 serverOnly passes, rebuilt portable runner 266/27 passes.
