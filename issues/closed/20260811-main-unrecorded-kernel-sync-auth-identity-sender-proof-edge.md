# main carries an unrecorded kernel→sync edge: `storage/auth_identity` → `auth/sender_proof`

**Opened:** 2026-08-11 · **Status:** open · **Area:** core modularization /
ownership ratchet (LLP 0225 §2, §5) · **Routed to:** the landing author of
`ef936353f`

## The edge

```
src/storage/auth_identity.rs (storage-migration-kernel) → src/auth/sender_proof.rs (sync-realtime-engine)
```

Kernel→sync, which §2 forbids. Observed at `ef936353f` and carried forward.

## How it got there

`ef936353f` ("route password issuance through the real provider core; lockout,
KDF bounds, budgets") added the call:

```rust
// src/storage/auth_identity.rs
let sender_constrained =
    crate::auth::sender_proof::presented_token_has_sender_family_binding(
        connection,
        acting.token_hash().as_bytes(),
    )
```

and **did not regenerate `ownership.baseline.json`** — that path is absent from
the commit's file list. Its parent's baseline records six edges from
`src/storage/auth_identity.rs` and none of them is to `sender_proof`, and
`ef936353f`'s own baseline is identical in that respect. So the edge exists in
committed code while no baseline entry, frozen fingerprint, or waiver record
names it.

Under §2 this is the one disposition that is not available: *"Genuinely new
forbidden coupling is never freezable by note: it is fixed before the
re-baseline, or it carries an explicit time-bounded waiver — a worklist entry
naming the edge, the inversion owner, and a deadline."* There is no such
waiver. (An earlier reading of this as "pre-existing with an existing waiver"
is wrong; there is no waiver record for it anywhere in `issues/`.)

## How it surfaced

The LLP 0225 item-3 **A2** slice regenerated the baseline with
`--update-baseline` against merge-base `ef936353f`, as its landing protocol
requires. The regeneration removed A2's own target fingerprint
(`storage/auth_catalog_ops → auth/provider`) and, in the same pass, recorded
this previously-unrecorded edge — so A2's frozen count came out **346 → 346**
instead of the expected 346 → 345.

**This edge is not A2's coupling.** A2 does not touch that call site: its diff
to `src/storage/auth_identity.rs` contains no `sender_proof` line on either
side. A2 recorded it because a re-baseline records the graph it finds, and the
graph it found already contained it.

## Why it matters beyond bookkeeping

The gate's whole promise is that a landing cannot introduce forbidden coupling
without a record. Here a landing did, because the baseline was not regenerated
in the same push — so the ratchet under-counts, and the next slice that
regenerates inherits the appearance of having frozen someone else's edge. That
is the failure shape `issues/closed/20260809-ownership-gate-prepush-tier.md`
was opened for; this is a fresh instance of it after the always-run promotion,
and worth checking whether the pre-push selection actually ran the ownership
gate for that push.

## What should happen

1. The `ef936353f` author decides the disposition: invert the call (the
   kernel should not reach up into sender-proof policy — A3 landed the typed
   `SenderProofAuthority` operations that this call could compose downward
   instead), or record an explicit time-bounded waiver naming the edge, the
   inversion owner, and a deadline.
2. Given A3, inversion looks cheap: `presented_token_has_sender_family_binding`
   is a durable read over a connection the kernel already holds, so it is a
   kernel operation by §3.1 rather than something to call up for.

Until then this ticket is the record that the edge exists and whose it is.

## Resolution — 2026-08-15 (backlog sweep)

Disposition option 2 was taken: the kernel→sync
`src/storage/auth_identity.rs → src/auth/sender_proof.rs` edge is recorded in
`ownership.baseline.json` as a time-bounded waiver (deadline 2026-09-15,
worklist `issues/20260811-llp0225-item-3-provider-split-implementation.md`).
The “unrecorded” failure is gone. Remaining inversion work lives on the
item-3 worklist, not this bookkeeping ticket.
