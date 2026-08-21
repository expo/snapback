# `effect_guard` fences the global mode epoch, not session logout or grant revocation

**Status:** Open — reframes the unguarded-write program
**Filed:** 2026-08-21
**Found by:** codex and grok, independently, reviewing `065363756`
**Related:** `issues/20260821-unguarded-durable-writes-admission-fence.md`

## The finding

`PreparedAuthority::effect_guard` (`crates/snapback-sync/src/auth/invocation.rs:1599`)
validates only the **global mode `AdmissionLease`** and rehearsal authority. It does
NOT consult the authority's session `publication` or scoped-service
`service_publication` fences.

So a fence built on `effect_guard` does not stop an ordinary `/auth/logout` or an
ordinary grant revocation. Verified schedule:

1. Ask prepares authority under mode epoch E.
2. `/auth/logout` premarks and commits session revocation. Premark waits only for
   `FencedAuthorityWorkPermit`s (`crates/snapback-sync/src/auth/coordinator.rs:656`).
3. Ask returns from its provider call.
4. Settlement's mode epoch E is **still current**, so `effect_guard` succeeds and the
   quota transaction commits **after logout**.

Reservation has the same defect when it was authorized then queued behind logout.
Scoped-service grant retirement is ignored the same way.

## Why this matters beyond one commit

**`065363756` was written specifically to stop budget being consumed after logout. It
does not.** It is a correct mode-epoch fence — one guard, spanning the real
`tx.commit()`, no re-entrancy, all five weakening mutations fail — but it proves the
wrong property.

The same applies to the **twelve fences already landed**. They use the same
`effect_guard`, so they establish mode-epoch fencing, not logout or revocation
fencing. Their mutation proofs are sound for what they test; what they test is
narrower than what the unguarded-write ticket claims to be fixing.

**The proofs were never going to catch this.** The fence tests construct
`PreparedAuthority` directly, without either production publication fence
(`crates/snapback-engine/src/local/admission_fence_tests.rs:69`), and they retire the
**global mode epoch** rather than performing an ordinary logout. So they exercise the
guard's lifetime faithfully and never touch the mechanism a real logout uses.

## The mechanism that would work already exists

Reserve the session/stream authority work through
`FencedPublication::try_reserve_work`
(`crates/snapback-sync/src/auth/session_projection.rs:658`), plus the corresponding
service-authority permit, and retain those **lock-free** permits through the mode
guard and the SQLite commit.

That is what `/auth/logout`'s premark actually waits on.

## Do NOT copy the current shape to the remaining ~20 sites

Both reviewers said so explicitly, with per-class guidance:

- **Callees that revalidate** — acquire the guard at the deepest commit boundary, not
  at the outer method.
- **Irreversible writes** — need the composite leaf/service permit *plus* the mode
  guard.
- **External, non-rollbackable effects** — need a retained lock-free authority permit
  and an idempotent/outbox protocol. **Never hold a `std::sync::MutexGuard` across an
  await.**

## Next

1. Decide whether the fence primitive itself should compose the publication fences, or
   whether each site composes them. A primitive-level fix would cover the landed
   twelve without twelve more changes.
2. Add a test that performs an ordinary logout — not a global mode retirement — and
   asserts the durable write is refused. Until that test exists, no fence in this
   program can claim to stop logout.
3. Re-frame `issues/20260821-unguarded-durable-writes-admission-fence.md`: its
   reachability analysis stands, but "add an `AdmissionEffectGuard`" is not by itself
   the remedy.
