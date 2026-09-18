# Repair C — where this branch stands

Branch `sb4/repair-c-history-owner-0bf8a4b5`, based on `27a8a4d66`. The design of
record is LLP 3000.001 `#reliability-retention`, including the ownership decision
this work implements: delivered history binds to (store incarnation, acquiring
principal), recorded at acquisition, checked at open and in `trust_synced_read`.

**This is not landed and should not be landed as-is.** After six fix rounds and
five blind review rounds across two model families, neither has returned READY.
This lane touches authorization, so the bar is higher than usual.

## What passes

- `cargo test -p snapback4-device`: 652 passed, 3 pre-existing ignores.
- `cargo test -p snapback4-core`: 159 passed.
- Source-host tests: 33 passed.
- The ticket's own case: `both()` is back to 25 retained + 26 held across a
  program-only deployment, on both stores and both entry points.
- The review's identity-mode scenario — guest history read by a later password
  principal — is now an executed refusal test, not a narrative.
- Across the fix rounds every fix was proven by mutation, and both families
  independently reproduced samples (eight and four behavioural failures).

## What is open

From the closing review round. Full review texts under
`snapback4/target/reviews-round2/` … `reviews-final/` (gitignored); implementer
reports under `target/repair-c-round*/`.

1. **`dequeue`, `clear_rows` and the media paths are not on the ownership fence**
   that `query`, `queued`, `begin_send` and `settle` now enforce (GPT family,
   High, reproduced through the C ABI). With two live native handles across an
   allowed same-store principal change, the stale handle deletes the other
   principal's only queued write and their acquired rows, and resolves, reads and
   overwrites their cached media. Swift's separate media methods rely on the
   handle and path without consulting device ownership.
2. **`settle` is not on the outbox-owner fence** (grok, High) — overlaps (1).
3. **The `GROUPS` commit in `apply`** (grok, High).
4. **`sqlite.rs` `stored_tables` / `stored_rows_after`** (grok, High) — the scan
   that decides whether a reset may proceed.

## Deferred on purpose, with tickets

- `issues/20260917-snapback4-orphan-recovery-deletes-retained-history.md` —
  same-owner orphan recovery removes a source holding 25 unreacquirable retained
  rows without proving custody elsewhere, and matching legacy orphan writes are
  stranded because inspection skips unbound sources before consulting the device.
  Both are inherited defects in paths this lane touches; fixing the stranding
  without the deletion would widen the loss path.

## The pattern worth carrying forward

Every High in every round of this lane was one ownership or refusal fact with two
rules — one in a TypeScript host, one in the device. Round 6 moved
executable-outbox ownership into the device for both hosts; the open findings are
the same move not yet made for deletion, media and settlement. The round-5 report
contains a full inventory of the host decisions that could be delegated and what
it would take, which is the right basis for finishing this.
