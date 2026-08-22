# Design decision: split-phase authorized-effect fence

**Status:** Implemented 2026-08-21 (`138d24164`, `1b0d76425`); migration of
remaining call sites tracked in the remedy classification
**Filed:** 2026-08-21
**Decides:** `issues/20260821-effect-guard-does-not-fence-logout.md`
**Governs:** the remaining fences, now scoped by
`issues/20260821-authorized-effect-remedy-classification.md` to 7 split-phase
families rather than ~20

## The question

`effect_guard` fences only the global mode epoch, so it does not stop an ordinary
logout or grant revocation. Twelve fences are landed on it and ~20 more are
planned. Should the PRIMITIVE compose the session/service publication fences, or
should each call site?

## Decision: neither — use a split-phase API

**Do not** make `effect_guard` transparently reserve publication permits.
**Do not** make twenty sites hand-compose the mechanics.

Instead: each site explicitly selects an **authorized effect** or a
**mode-only / terminal-carrier effect**, while ONE shared primitive implements
reservation, ordering, error mapping and permit retention.

Shape: reserve stream/session and optional service authority OUTSIDE
`LocalSnapback`; carry the owned, lock-free permits into the synchronous write;
acquire the existing mode guard LAST; hold everything through the SQLite commit.
Keep or rename the current method as `mode_effect_guard`, and add
`reserve_authorized_effect` plus an inner commit guard.

## Why not the primitive-level fix, despite its appeal

It would have corrected all twelve landed sites in one change. It is unsound:

1. **Legitimate callers have no publication** — host paths, internal work and
   operator lanes. A primitive requiring one would break them.
2. **Terminal writers would refuse themselves.** Logout is itself a durable write.
   If the fence required an unretired session, logout could not commit its own
   revocation. This alone rules the option out.
3. **Current calls happen underneath `LocalSnapback`**, where acquiring
   publication locks is expressly forbidden — so the reservation cannot live where
   `effect_guard` is called today.

## Why not per-site

Repeating clock sampling, session-`None` mapping, service ordering, retained-witness
installation, RAII cleanup, mode acquisition and terminal exemptions twenty times is
not drift-resistant. Sites should CHOOSE the path; they must not implement the
mechanics.

There is precedent for the shared bundle:
`PreparedConnectionAct::reserve_authority_work` already reserves stream/session then
service and returns one retained permit bundle
(`crates/snapback-server/src/server.rs:4323,4383`).

Also: mode-only status should be encoded EXPLICITLY, not inferred from
`Option::None`.

## The regression that must exist first

No fence in this program can claim to stop logout until this passes. "Logout wins
after preparation but before authority-work reservation":

1. Sessions fixture; mint one ordinary session bearer.
2. Record target durable row count and the mode epoch/generation.
3. Start request A — a minimal durable mutation with that bearer — paused at
   `BeforeHandler`, after middleware attaches `PreparedAuthority` but before the
   handler reserves authorized work. That pause exists
   (`crates/snapback-server/src/server.rs:14156`, `:12080`).
4. While A is paused, send a real `POST /auth/logout` with the same bearer.
5. Require 204, require the session terminal, and assert the global mode
   epoch/generation did NOT change.
6. Release A. Its authorized-effect reservation must fail with the typed
   session-revocation diagnostic, and the durable row count must be unchanged.
7. Assert no commit observer fired for A.

Step 5 is the crux: the existing admission proof retires the global controller epoch
immediately before guard acquisition (`server/tests.rs:17663`) and never performs a
session logout. That is exactly why twelve fences and sixteen mutation proofs did not
catch this.

**No new scaffolding is needed** for the core case — the service-expiry matrix already
demonstrates the same `BeforeHandler` race structure with an unchanged durable count
(`server/tests.rs:31077`).

## Sequence

1. Land the logout regression against the CURRENT code and watch it fail.
2. Build the split-phase primitive.
3. Migrate the twelve landed sites.
4. Then the remaining ~20, per-class: callees that revalidate take the guard at the
   deepest commit boundary; irreversible writes need the composite permit plus mode
   guard; external non-rollbackable effects need a retained lock-free permit and an
   idempotent/outbox protocol, never a `MutexGuard` across an await.

This should be absorbed into the LLP governing the admission gate algorithm (LLP 0058)
once implemented.
