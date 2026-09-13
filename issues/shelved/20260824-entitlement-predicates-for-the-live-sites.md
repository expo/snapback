# What each broken site should actually check — the naive fix is wrong for two of five

Status: open
Date: 2026-08-24
Systems: snapback-engine, snapback-server, snapback-auth
Related: issues/shelved/20260824-authority-validated-subject-supplied-separately.md,
  issues/shelved/20260824-wide-predicate-sweep-inverse-variant-confirmed.md,
  issues/shelved/20260824-authority-minting-factory-inventory.md

## Why this was asked before any fix was written

Five sites validate a caller's authority and then act on a caller-named subject. The obvious fix is
"verify the authority owns the subject." **That fix is wrong at two of the five**, and shipping it
would have broken legitimate production behaviour — plausibly without a failing test, since the
tests encode the current permissive behaviour.

Result: **owner-only is correct for S1, S3 and part of S4; wrong for S2 and S5. None of the five is
genuinely unrestricted by design.**

## S1 — grant revocation (single + bulk): OWNER-ONLY, and the fix is small

Production callers are the two grant-management routes (`server.rs:17492`, `:17545`), both of which
call `require_grant_session` first (`server.rs:16952`). The legitimate caller is **the effective
user/grantor revoking grants they issued — not an agent owner administering grants issued by other
users.** A grant recipient can be another user's agent; the kernel test at
`crates/snapback-kernel/src/storage/auth_grants.rs:2482` has `user-b` approve a grant to `agent-a`,
classified `OwnedByAnotherUser`.

Predicate: live session authority + source `AgentGrantManagement` + session user ==
grant's `effective_user_id`. For bulk, every affected grant must match that user and the requested
actor.

The kernel is **already correct** — its query is keyed `WHERE id = ?1 AND effective_user_id = ?2`
(`auth_grants.rs:1067` region) — and `require_grant_session` already derives the user from the
session. The gap is only that the engine planner accepts `user_id` as an independent parameter.
Fix in flight on `lane/grant-ownership`.

## S2 — retained service authority resolution: ENTITLED-MANAGER. Owner-only would break it.

The sole production path is effect approval: `effect_approve` takes an effect-management session
(`server/effects.rs:240`), loads the pending effect, and calls `prepare_original_authority`
(`:259`), whose service-principal arm passes the retained tuple into
`resolve_retained_effect_service_authority` (`:117`).

**The management session belongs to the approver; the named service principal is the original
caller whose authority is being reconstructed. They are not expected to be the same principal.** An
owner-only check would break effect approval entirely.

Correct predicate (entitled-manager, same-app scoped): live effect-management session; entitled to
approve this exact pending effect; for an ordinary effect its session authority passes current
policy for the effect's exact function; for a link-originated effect it is the exact link minter
with link/function still matching; and the retained service tuple is the original authority stored
on that exact pending effect.

## S5 — detached-action recorded-mutation sinks: NOT owner-only

Ordinary mutations reserve and stage from the same request authority (`server.rs:30502`, `:30542`)
and supply staged mutation and reservation separately to the sink (`:30572`). Managed-host actions
reserve under the staged child authority (`server.rs:4878`, `:4912`) and meet again at the sink
(`:4964`).

**The legitimate authority may be a delegated service principal acting as an effective user under an
exact grant/function scope — it need not own that effective user.** The correct rule is
same-origin/same-reservation correlation, not ownership.

## S3, S4

Owner-only is correct for S3 and for part of S4; see the source analysis for the per-site
predicates before implementing either.

## The generalisable lesson

Two of five sites are cross-principal *by design*. "Add an ownership check" would have been a
plausible, confident, test-passing change that broke effect approval and delegated mutation. The
parameter name (`management`) was not evidence either way; only the production callers and the
authorization model were. Any fix to the remaining sites — including the 137 LIVENESS-ONLY rows in
the factory inventory — must establish the intended policy per site before changing code.
