# Durable single-use: reuse the existing idempotency shape, do not invent a ninth

**Status:** Open
**Impact:** 4
**Urgency:** 4
**Systems:** Kernel, Auth, Sync
**Date:** 2026-08-25
**Related:** LLP 0303 revision (j), `issues/shelved/20260824-q05-operation-identity-route-enumeration.md`,
  `issues/shelved/20260824-q04-membership-writer-route-enumeration.md`

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

---

## What three lanes actually built, 2026-08-25

The instruction above was issued to four lanes at once. Three have reported, and they converged on
the same shape **without coordinating** — which is the evidence that this generalises rather than
being three bespoke fixes.

| Lane | Durable record | Written where | Rows |
|---|---|---|---|
| Q14 | `_snapback_hosted_admission_consumptions`, **envelope-digest primary key** | same `BEGIN IMMEDIATE` transaction as the admission watermark, in the deployment database | — |
| Q43 | `_snapback_meta.auth_invalidation_boot_issuance_v1` | atomically with the boot-sequence high-water; records database-open owner, authorization incarnation, boot sequence | `F084` |
| Q03 | `_snapback_meta.auth_commit_consumed:<operation-id>` | **inside the same SQLite transaction as the auth effect** | `F100, F101, F102` |

Their refusals, verbatim:

```
SNAPBACK_AUTH_HOSTED_ADMISSION_REPLAYED: hosted admission envelope has already been durably consumed
authorization invalidation boot issuer is already active for this database lifetime
authentication commit operation was already durably consumed
```

### The property they all got right

**The durable record is written in the same transaction as the effect it guards.** Not before, not
after, not in a separate connection. That is the difference between a guard and a race: if the record
and the effect can commit independently, a crash between them either loses the guard (the operation
becomes replayable) or blocks a legitimate first use (the operation becomes wedged).

This is worth stating because it is not implied by "add a replay ledger". A ledger written after the
effect is a log; a ledger written before it, in a separate transaction, is a lock that can leak. Only
the atomic form is a single-use guarantee.

### How they proved it

All three tested from an **external dependent crate**, and each reconstructed the input by the route
that had previously defeated it rather than by cloning:

- Q14 **reselected the serialised document and reopened the database** — the exact attack that beat
  its previous round, where consuming the Rust binding left the signed envelope deserializable.
- Q43 called the complete producer twice.
- Q03 ran a replay-and-readback regression.

Each then read back the durable rows and confirmed the refused second attempt changed nothing. That
last step is what distinguishes "the call returned an error" from "nothing happened".

### What remains complementary, not substituted

All three **kept** their move-only consumption as a compile-time complement, as instructed. That
combination — a type that cannot be reused accidentally, plus a durable record that cannot be
replayed deliberately — is the shape to copy.

None of the three added a genuinely new privilege-surface violation: each measures 105 against a
`main` at 107, with zero new entries once line-number churn is normalised away.

---

## Reviews of the four: two findings, and one lane that did it by reusing

The first two reviews of these implementations both found holes, and **neither was about whether the
ledger existed**. Both were about where the boundary sat relative to the check.

**Q14 — the key can be poisoned.** Its table stored only `envelope_sha256`, with a
caller-constructible commit carrier crossing a public boundary. Pre-seeding the canonical digest made
a **later genuine signed envelope refused as already replayed**. That is property 2 of the shape above
— a separately stored request digest — and its absence converts a security control into an
availability attack. It also had no retention (property 3).

**Q43 — the handle outlives the record.** Two processes, one SQLite file: A installed boot sequence 1
and stayed alive, B installed sequence 2, and A then issued another connection from sequence 1. The
ledger was written and read correctly; the durable check ran at handle **acquisition**. Recorded as
LLP 0303 revision (k): *a durable record consulted only at acquisition is a cache.*

**Q12 — reused rather than invented, and that is the model.** Its report named
`auth_stream_incarnation_v1` and `authorization_epoch_v1`, and its diff adds **neither** — because
both already exist on `main` (`crates/snapback-kernel/src/auth/session_projection.rs`,
`.../storage/auth_identity.rs`, `.../storage/auth_stream.rs`). It bound its staging facts to durable
state the repository already maintained, in the same transaction as activation and destruction.

That is what this document asked for and it is worth naming, because it looked like a discrepancy on
first inspection: a lane whose durable-state diff is *empty of new identifiers* may have done the
best available thing rather than the wrong one. Check whether the identifiers pre-exist before
treating their absence as a defect.

### The pattern is validated, with a caveat

Four lanes produced four working ledgers with atomic writes. The failures were not in the ledger
concept but in two adjacent questions this document should have asked more loudly:

1. **Who else can write the key?** If a caller can seed it, the guard is a lockout weapon.
2. **When is it read?** If only at acquisition, live handles outlive it.

Both are now in LLP 0303 revision (k). Add them to the four properties above when using this shape.

### Singleton keys and per-operation keys behave differently under revision (k)

Worth separating, because the acquisition-vs-use flaw does not apply uniformly.

- **Q43 used a singleton key** — one `auth_invalidation_boot_issuance_v1` record describing the
  currently-live boot issuance. A long-lived handle validated against it at acquisition keeps working
  after the record moves on, which is exactly the cross-process replay that blocked it. Singleton
  keys describe *current state*, so anything holding a reference to "the current one" can go stale.

- **Q03 used a per-operation key** — `auth_commit_consumed:<operation-id>`, one row per operation.
  A per-operation record describes *a specific event that happened*, not a state that can be
  superseded. There is no later value for a stale handle to be out of step with, because the row for
  operation X never becomes the row for operation Y.

So revision (k) bites hardest on singleton-key designs. That is not a licence to skip the question
for per-operation keys — a handle could still cache "I checked operation X" and be reused for
operation Y — but the failure requires a different mistake, and the cross-process test that broke Q43
would not break Q03 for the same reason.

**Stated as a structural hypothesis, not a verdict.** It was reached by reading the key shapes, and
reading has been wrong repeatedly in this programme; the reviews will settle whether each lane is
actually exposed. Recorded because it predicts *which* lanes to worry about, which is useful even if
an individual call turns out wrong.

---

## Property 5, which the four above do not cover: a no-op must not consume

Found on the third ledger review, and it is the most serious of the ledger findings because it is
**remotely reachable without credentials**.

A reviewer repeated `plan_family_alarm("malformed-N")` → `commit_planned_family_alarm` **32 times**
from a dependent crate:

```
32 requests, 32 permanent consumption rows, ZERO auth effects, no retention, no GC
```

Every attempt returned `Committed(Noop)` — it did nothing — and still wrote a permanent row. The
server exposes that malformed-bearer path. So a caller **with no valid bearer at all** can inflate
the ledger indefinitely.

> **Write the consumption record only when the effect actually happened.** A ledger that records
> attempts rather than effects is an unauthenticated growth vector, because attempting is free and
> the guard is what makes it permanent.

This is distinct from retention (property 3) and both are needed. Retention bounds how long rows
live; this bounds which rows are written at all. Retention alone still lets an attacker sustain
unbounded pressure up to the retention window; refusing to consume on no-op removes the vector.

It is also a place where the guard's own security property creates the availability risk — the row
is permanent *because* it must be, so the discipline has to be about not creating it. Check this
explicitly for every ledger: enumerate the outcomes that write a record, and confirm each one
corresponds to a real durable effect.

### Where each lane stood after review

| Lane | Key shape | Atomicity | Findings |
|---|---|---|---|
| Q14 | new table, digest PK | correct | poisonable key (no request digest); no retention |
| Q43 | singleton | correct | acquisition-vs-use, cross-process |
| Q03 | per-operation | correct | no-op consumes; no request digest; no retention |
| Q12 | reused existing keys | correct | review pending |

**All four got atomicity right, and none of the findings was about the ledger concept.** They were
about which outcomes write, who can write the key, when it is read, and how long rows live — the
four questions around the edge of the mechanism rather than the mechanism itself.
