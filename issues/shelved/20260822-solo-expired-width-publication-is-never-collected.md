# A solo expired width PUT strands its object and publication indefinitely

Status: Open — follow-up to the asset lease work; a missing collector, not a mistaken deleter
Created: 2026-08-22
Related: issues/shelved/20260822-remote-effect-uncertainty-outlives-process-local-leases.md, LLP 0044

Found by review of `52985a975`, which removed the ticket-side deletes that were causing data loss.
This is the residual in the other direction.

## The interleaving

1. A Ready asset is missing `w128`; request C creates publication P and writes the correct bytes.
2. C's lease expires after the PUT, or while its commit ticket waits for Phase C. The new code
   **refuses without deleting and without recording durable abandonment**
   (`crates/snapback-services/src/assets.rs:932`, `:989`).
3. No sibling commits the width.
4. Reconciliation sees P's object verify and moves it to `staged`
   (`crates/snapback-engine/src/local/engine.rs:14447`).
5. Because the asset stays Ready and `w128` stays absent, `publication_width_owner_live` returns
   true forever (`crates/snapback-kernel/src/storage/asset_maintenance.rs:140`), so the staged
   sweep never condemns P (`engine.rs:14480`).

No work row completes the staged width. Only another request for that exact width, or deleting the
asset, resolves it — which the revised LLP 0044 already acknowledges (`:918`).

Consequence: bytes remain physically stored with no width quota settlement, and the publication row
persists indefinitely, bounded only by the unrelated record ceiling. Repeated incidents can exhaust
that ceiling.

## Why this did not block landing

The two reviewers agreed on the facts and differed on classification, and the classification is
the part that matters:

- The lane's characteristic defect across nine rounds and ~15 findings was **"a ticket deletes from
  a stale snapshot"** — that is what produced winner-blob loss, undiscoverable objects, and the
  torn-plan race. `52985a975` removes four width deletes, makes expired tickets refuse rather than
  delete, and gives finalizers sibling-aware leases. That class is closed.
- This residual is a **different class: a missing collector, not a mistaken deleter.** It does not
  reopen winner-blob loss and costs retention rather than correctness.

Extracting the lease work for a bounded leak, after it had just eliminated a data-loss class, would
have been the worse trade.

## Fix direction

From the review: widen the existing planned-torn predicate for the case where `lease == None`, so a
staged width with no live owner becomes collectable. **Do not add a ticket-side delete** — that is
the exact move that produced the data-loss class this lane spent nine rounds removing.

Worth pairing with `publication_width_owner_live`, whose "asset Ready and width absent implies a
live owner" inference is what makes the row immortal. That inference is right for an in-flight
request and wrong for an abandoned one; distinguishing them durably is the real fix.
