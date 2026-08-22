# `effect_guard` fences the global mode epoch, not session logout or grant revocation

**Status:** Resolved 2026-08-21 by the split-phase primitive (`138d24164`,
`1b0d76425`); see "Resolution" at the end
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


## Demonstrated — 2026-08-21, and it is worse than filed

A regression now exists on `lane/logoutreg` (`cc460f310`), committed FAILING.
Request A pauses at `BeforeHandler` after middleware attaches
`PreparedAuthority`; a real `POST /auth/logout` runs with the same bearer; A is
released.

Every earlier assertion passes:

- logout returns **204**
- the session becomes **terminal**
- **both global mode counters are unchanged** — so nothing here retires the
  global epoch, which is exactly what the twelve landed fences and their sixteen
  mutation proofs all rely on, and exactly why none of them observes this
- A returns the typed **`SNAPBACK_AUTH_SESSION_EXPIRED`** diagnostic

And then:

```
assertion failed: the logged-out authority must not add a durable row
  left: 2   right: 1
```

### The refinement that matters

**A is refused and its write commits anyway.**

This was filed as "the fence does not see logout," implying the write proceeds
unchallenged. It does not. The authorization layer correctly identifies the
session as expired and returns a typed refusal — and the durable row still
lands.

That is a different defect class: **a refusal with a durable side effect**. The
caller is told the operation failed while the effect persists. Fixing the fence
so it "sees" logout may not address this at all, because the refusal is already
being produced; what is missing is that the refusal does not prevent — or does
not roll back — the write.

The remedy in `issues/20260821-authorized-effect-fence-design.md` should be
re-examined against this: a split-phase authorized-effect reservation prevents
work from STARTING, but this write starts before logout lands and commits after
a refusal is already computed. Determine whether the correct fix is reservation,
rollback-on-refusal, or both.


## Root cause and remedy settled — 2026-08-21

### Why this path has no fence at all

The mutation is a HostPlan inserting into `items`. `items` is **not
permission-backing**, so the staged change classifies as `NoAuthorizationEvent`
(`crates/snapback-kernel/src/storage/authorization.rs:117`,
`crates/snapback-engine/src/local/engine.rs:20950`). The staging wrapper then
proceeds directly to commit work **in the same Local turn**
(`crates/snapback-server/src/server/writer_gate.rs:493`).

Function preparation calls only `validate_admission`
(`crates/snapback-sync/src/auth/invocation.rs:2150`), which checks global
admission and rehearsal authority — not the session publication fence.

So no fence is involved: no authorization event, no reservation, no guard. The
`SNAPBACK_AUTH_SESSION_EXPIRED` the caller sees is computed at outer response
publication, **after** `tx.commit()`.

### The general rule is narrower than feared

**Postcommit refusal is general; post-staging refusal is not.**

- A refusal first computed AFTER `tx.commit()` cannot undo the durable effect.
  Outer response-publication refusal can therefore mask an already-committed
  mutation.
- A refusal after SQL writes are staged but BEFORE commit rolls back normally.

Case by case:

- **Session logout/expiry — affected.** This path never consults the session
  publication before commit.
- **Scoped-service grant/credential revocation — NOT affected.** That path
  already revalidates durable service authority before execution
  (`engine.rs:15443`, `:6951`), and a committed matrix asserts effects remain
  absent across grant revoke, credential rotation/revoke, deactivation, expiry
  and cap eviction (`server/tests.rs:7541`, `:7630`). **This is the working
  precedent.**
- **Global epoch retirement — NOT the same failure.** The mode guard retains the
  controller mutex through commit (`admission.rs:947`), so retirement either
  rolls back or orders after.
- **Quota — not inherently affected.** Checked inside the transaction and exits
  via `?` before commit (`asset_attempts.rs:286`, `:234`).

### The recorded design does address this

`issues/20260821-authorized-effect-fence-design.md` stands. Its premise was
questioned when this turned out to be a refusal-with-side-effect; the premise is
correct, because the regression pauses **before** handler/work reservation, not
after the durable write began.

- If logout premarks or commits first, `try_reserve_work` refuses before
  mutation work starts (`session_projection.rs:658`).
- If A reserves first, logout's premark closes new reservations and drains
  existing permits (`coordinator.rs:672`, `:688`), so A commits *before* logout.

**Rollback-on-refusal is not available** — the transaction has already
committed at the observed refusal point. And a bare "check again before commit"
is insufficient unless it owns a fence through commit, or it just creates
another check/commit race. Acquiring the session lock inside SQLite is
prohibited by the lock order (LLP 0059 §751).

So: reservation, not rollback. Proceed with the split-phase design.


## Resolution (2026-08-21)

Closed by the split-phase authorized-effect reservation:

- `b441f87b7` — the regression, committed failing, demonstrating that logout
  returned 204 with the session terminal while the caller's row committed anyway.
- `138d24164` — the primitive. Session/service publication is reserved outside
  `LocalSnapback`, the lock-free permit is carried in, the mode guard is acquired
  last at the SQLite commit, and the permit is retained through durable commit.
  Logout's premark drains outstanding permits before committing terminal state.
- `1b0d76425` — exact-entry removal of retained service guards, fixing a
  release-build authority bypass found in review: the TLS stack was popped by
  top rather than by identity, so an out-of-order guard drop left a stale entry
  that `active_witness()` would honour after terminal state committed.

Both race orderings are proven and were verified unsandboxed at the landed
commit: logout-wins (no durable row, caller gets `SNAPBACK_AUTH_SESSION_EXPIRED`)
and reservation-wins (write commits, logout waits, terminal state commits after).

Reviewed by codex and grok independently. Two findings were raised and fixed; a
third (unbounded logout drain) was refuted as pre-existing LLP 0059 behaviour
rather than introduced here, and is tracked separately as follow-up work.

Scope note: the primitive is wired at the ordinary HTTP mutation seam. Migrating
the remaining call sites is tracked in
`issues/20260821-authorized-effect-remedy-classification.md`.
