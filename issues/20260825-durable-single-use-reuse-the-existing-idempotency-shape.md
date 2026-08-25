# Durable single-use: reuse the existing idempotency shape, do not invent a ninth

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Systems:** Kernel, Auth, Sync
**Date:** 2026-08-25
**Related:** LLP 0303 revision (j), `issues/20260824-q05-operation-identity-route-enumeration.md`,
  `issues/20260824-q04-membership-writer-route-enumeration.md`

## Why

LLP 0303 revision (j) established that **single-use of a fact requires durable state** — move
semantics protect a Rust binding, not the underlying fact. Four lanes are now implementing that
requirement simultaneously. Left alone they will produce four different mechanisms for the same
property, which is worse than one mechanism even if all four are individually correct.

They do not need to invent anything. **The repository already carries at least eight durable
idempotency and replay mechanisms.**

## What already exists

Tables:

```
_snapback_auth_guest_idempotency          _snapback_auth_guest_idempotency_retention
_snapback_auth_budget_idempotency         _snapback_auth_rehearsal_idempotency
_snapback_auth_rehearsal_mint_idempotency _snapback_sender_nonce
_snapback_sender_nonce_expiry             _snapback_job_idempotency_tombstones_v
```

Implementations to read before writing anything:

- `crates/snapback-kernel/src/storage/auth_catalog_ops.rs` — `GUEST_IDEMPOTENCY_TABLE` and
  `ensure_guest_idempotency_table` (~:282).
- `crates/snapback-kernel/src/auth/sender_proof.rs` — nonce issue/verify against
  `_snapback_sender_nonce`.
- `crates/snapback-kernel/src/storage/auth_rehearsal.rs` — `persist_idempotency` (~:1714).
- `crates/snapback-kernel/src/storage/jobs.rs` — `find_job_by_scoped_idempotency` (~:633).

## The shape, from the guest idempotency table

```sql
CREATE TABLE IF NOT EXISTS _snapback_auth_guest_idempotency (
  key_digest   BLOB PRIMARY KEY,
  request_digest BLOB NOT NULL,
  key_id       TEXT NOT NULL,
  created_at_ms INTEGER NOT NULL,
  retain_until_ms INTEGER NOT NULL,
  state        TEXT NOT NULL CHECK(state IN (...)),
  budget_name  TEXT,
  retry_after_ms INTEGER,
  refusal_correlation_id TEXT,
  CHECK((state='refused') = (budget_name IS NOT NULL))
)
```

Four properties worth copying, each of which a fresh invention tends to miss:

1. **`key_digest` is the PRIMARY KEY.** The second attempt fails on insert, in the database, not in
   application logic that could be bypassed by another caller.
2. **`request_digest` is stored separately.** That is what distinguishes *replay of the same request*
   from *a different request reusing a key* — the two need different answers, and a table holding
   only the key cannot tell them apart.
3. **`retain_until_ms` and a retention index.** A replay ledger that grows without bound is an
   availability problem; retention is part of the design, not a follow-up.
4. **The refusal is recorded, not just the success** — `state`, `retry_after_ms`,
   `refusal_correlation_id`, and a `CHECK` tying them together. A ledger that records only successes
   cannot answer "was this already refused, and why".

## Instruction to the four lanes

Read the guest idempotency implementation first. If your row's single-use property fits that shape,
use it — extend the existing table where the key space genuinely differs, or add a table with the
same four properties. **State in the commit message which existing mechanism you reused or mirrored,
and why the key space justified a new table if you added one.**

A ninth bespoke mechanism needs a stated reason, not silence.

## Caveat

This ticket says *reuse the shape*, not *reuse the table*. Sharing one physical table across
unrelated key spaces creates contention and confuses retention. The point is that the
primary-key-collision, request-digest, retention, and recorded-refusal properties are already worked
out here and should not be rediscovered four times in parallel.
