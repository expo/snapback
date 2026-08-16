# Item-3 remainder: the kernel→sync auth call-ups are an ownership question, not an import fix

**Opened:** 2026-08-10 · **Status:** CLOSED 2026-08-11 — ruled, with the
premise below corrected · **Area:** core modularization / ownership ratchet
(LLP 0225 §4 continuing item 1)

## Resolution (2026-08-11)

Ruled under LLP 0225 §5/§6 authority and recorded as LLP 0225 revision (n),
§4 "Item-3 remainder — the provider split, ruled".

**The ruling rejects this ticket's framing.** The analysis below was built from
`auth_catalog_ops.rs`'s *import list*. Reading the function *bodies* inverts
the picture: `auth_catalog_ops.rs` is the **transaction-scoping** half, not the
SQL half. Its operations open the connection or immediate transaction — §3.1's
commit primitive, correctly kernel-owned — and hand the borrowed
`&Transaction` to a function in `src/auth/provider.rs`, where the SQL actually
lives. `planned_revocation_transaction`, `plan_exchange_read`,
`plan_session_issuance_read`, `lookup_presented_session`, and
`reconcile_planned_revocation` all take a `&Connection`/`&Transaction` plus an
already-composed typed plan and run `UPDATE`/`SELECT` against `_auth_sessions`,
`_auth_identities`, and `_auth_session_tokens` — several of them calling *down*
into `crate::storage::auth::*_in` helpers. The `plan_*` names describe what the
returned value is for, not what the function does.

So **both candidate resolutions below are wrong**, and the "opposite failure
modes" that made this look like a ruling were an artifact of the inverted
premise. (a) would move the transaction primitive out of the kernel while
leaving canonical-store SQL in a domain service — strictly worse on §3.1.
(b) is the right direction named at the wrong module: the wrappers are already
typed kernel operations.

The split runs through `src/auth/provider.rs`: SQL bodies down to the kernel,
plan/outcome value shapes down to the leaf, plan composition and refusal
classification staying in sync — with the read-and-classify functions
(`plan_exchange_read`, `plan_session_issuance_read`) cut so the kernel returns
the durable facts it read and `provider.rs` classifies them. Implementation is
sequenced A1/A2/A3 in
`issues/closed/20260811-llp0225-item-3-provider-split-implementation.md`.

**Lesson worth carrying:** on this program, histogram the edges by target file
and crossing symbol *and then read the bodies*. An import list tells you which
module names cross; it does not tell you which side the behavior is on.

---

*Original analysis follows, retained for provenance. Its finding (the module
pair and the 24 functions) is accurate; its interpretation of which side holds
the SQL is the part the ruling corrects.*

## Why this is filed rather than implemented

Ratchet worklist item 3 said the kernel→sync/auth-core edges are "exactly the
`with_auth_*` escape-hatch shape: as owner-#2 slices convert closures to typed
kernel ops, callers should pass typed inputs down instead of the kernel calling
up." Two cuts have now landed against item 3 and items 4-5 by moving *value
shapes* down (`5373238eb`, `b6a317ed8` — 18 forbidden edges removed between
them, no waivers on the second). What is left is not the same kind of problem,
and the remainder should not be attempted as another relocation.

## The finding

Of the 28 remaining `kernel → src/auth/* (sync)` frozen edges, the dominant one
is a single module pair:

**`src/storage/auth_catalog_ops.rs` calls 24 distinct functions in
`src/auth/provider.rs`:**

```
auth_required                  planned_family_alarm_transaction
authenticated_use_row          planned_revocation_transaction
exchange_transaction           planned_rotation_transaction
family_alarm_transaction       planned_session_issuance_transaction
internal_collision_snapback    reconcile_planned_issuance
internal_state_snapback        reconcile_planned_revocation
is_constraint_error            reconcile_planned_rotation
logout_transaction             reconcile_rejected_issuance
lookup_presented_session       record_authenticated_use_transaction
mint_session_transaction       refresh_transaction
plan_exchange_read             rejected_exchange_transaction
plan_session_issuance_read     throttled_snapback
```

That is not a leaked type or a convenience import. `auth_catalog_ops.rs` is the
SQL/transaction half of the provider's session lifecycle — plan, mint, refresh,
rotate, revoke, reconcile — and it is currently assigned to
`storage-migration-kernel` while its entire logical counterpart lives in
`sync-realtime-engine`.

## The two candidate resolutions

**(a) The module is misassigned.** `auth_catalog_ops.rs` belongs to
`sync-realtime-engine` alongside `provider.rs`, and the edges vanish because
they were never cross-owner in the first place. LLP 0225 §1 explicitly holds
`uncertainAssignments` open as "invitations to re-decide at the owning slice,"
and §5 makes module *assignments* operational — no prose amendment required.
This costs one manifest edit and no code motion. The risk is that it moves a
module that opens rusqlite transactions out of the owner that §3.1 says owns
*every* transaction against the canonical store — which would be a real
weakening of the commit-authority claim unless the transaction primitives
themselves stay kernel-side.

**(b) The inversion the worklist intended.** Design ~24 typed kernel operations
so the provider passes already-composed intent down and the kernel never calls
up. This preserves §3.1 exactly, but it is a substantial design slice — and
several of these are *planners* and *reconcilers* whose whole job is to decide,
which is domain policy, not a commit primitive. Mechanically converting them
into kernel operations risks pushing session policy *into* the kernel, which
§2 forbids ("neither the leaf nor the kernel owns domain policy").

**These have opposite failure modes**, which is exactly why this is a ruling and
not a refactor: (a) risks diluting who owns transactions; (b) risks diluting who
owns policy. The honest reading of §3.1 plus §2 together is that the *commit
primitives* stay kernel-side and the *session policy* goes to sync — i.e. a
split of `auth_catalog_ops.rs`, not a wholesale reassignment either way. That
split is the third option and probably the right one, but it is a real slice
with a real acceptance envelope, not a mechanical move.

## Smaller, independent leftovers (safe to take without the above ruling)

- `session_projection` value shapes — `RevocationReason`,
  `SessionTerminalCauseRecord`, `SESSION_TERMINAL_CAUSE_META_PREFIX`,
  `AuthorizationStreamIncarnation` — are pure shapes and would clear **5** of
  the 7 `* → session_projection` edges (`storage/auth_mode`,
  `storage/push_registry`, `storage/auth`, `storage/auth_catalog_ops`,
  `storage/schema_seed`). **`SessionProjection` itself must not move** — it
  carries 36 methods and is behavior.
  Destination constraint: `src/local.rs` (unassigned) consumes
  `AuthorizationStreamIncarnation`, so the destination must be a leaf module
  `local.rs` already depends on, or the move buys a waiver — the same
  constraint that shaped both landed cuts.
- `storage/auth_sender.rs → sender_proof` imports six *functions*
  (`admit_sender_constrained_request`, `apply_sender_replay_epoch_floor`, …) —
  same class as the provider problem above, same ruling needed.

## Recommendation

Take the `session_projection` shape cut as an independent increment (cheap,
proven recipe, 5 edges). Do **not** take the `auth_catalog_ops` /
`auth_sender` call-ups until the owner question above is ruled — record the
ruling as an LLP 0225 amendment if it changes the ownership map's shape.
