# Are lanes being blocked by routes the ruling does not scope them to?

**Status:** Closed — author ruled 2026-08-25
**Systems:** Auth, Sync, Kernel, Engine
**Date:** 2026-08-24
**Related:** LLP 0303, `issues/20260824-sealed-trait-does-not-seal-its-database-parameter.md`,
  `issues/20260824-q05-database-provenance-confirmed.md`

## The observation

Six review verdicts have returned in this wave. All six said DO NOT LAND, and **every finding was
real and executed** — none was speculative, and several were reproduced from an external dependent
crate. Nothing here disputes a finding.

But LLP 0303 says two things that bear on whether every one of them should *block a landing*:

> Implementing these does not license a structural-property, fence, or closure claim. **Each landing
> states what it enforces, scoped to the functions and routes it changed.**

Sorting the six findings by that scope:

**Clearly in scope — the lane's own changed surface.**

| Lane | Finding |
|---|---|
| deny | Its own readbacks project 4/11, 3/15, 4/11, 3/8, 13/47 columns; a combined mutant passed |
| Q12 | `map` on the carrier **it introduced** rewraps a foreign payload; `take_unused` recycles |
| Q43 | Setters **on its own type** undo the derivation one line after the constructor |
| Q14 | `Clone` **on its own types**; and an artifact it introduced while reporting it had not |
| Q04 | A caller-forged authority reaches a **public factory the lane itself added** |

**Arguably out of scope — pre-existing surface the lane never touched.**

| Lane | Finding |
|---|---|
| Q05 | `AuthDatabasePlan::execute` — file **byte-identical between `origin/main` and the branch** |
| Q10 | `reconcile_auth_scope_bases` + `current_exact_scope` — pre-existing readers |

Q05 and Q10 each closed every construction route they set out to close, verifiably, and were then
blocked by a route that exists on `main` today and would exist whether or not they landed.

## Why this is worth deciding rather than drifting

Neither position is obviously right.

**For blocking:** a row is not closed while the value it protects can still be manufactured. Landing
"Q10 closed the constructors" while a public reader mints the same scope from a disposable database
records a guarantee the code does not have — and this program has already published and withdrawn
three false property claims.

**For landing with a scoped claim:** the ruling explicitly scopes a landing to the routes it changed
and explicitly withholds closure claims. A lane that derives correctly at its own boundary has done
what was asked. Blocking it on `main`'s pre-existing surface means **no row can land until the whole
surface is closed**, which converts 96 independent rows into one indivisible program — the opposite
of how the work was decomposed. Six lanes are currently blocked and none has completed a cycle.

## The recommendation

Land a lane when **its own changed routes** derive correctly and its tests meet the evidence bar,
with any pre-existing bypass filed as its own ticket and named in the landing as explicitly not
closed. That is what the ruling's scoping sentence describes, and it is what was already done for
`issues/20260824-sealed-trait-does-not-seal-its-database-parameter.md` — a pre-existing hole found
while reviewing Q05, filed separately because the surface is not the lane's.

Under that rule: **Q05 and Q10 would land now** with their pre-existing routes ticketed; deny, Q12,
Q43, Q14 and Q04 would still be blocked, because each was defeated through surface it authored.

This is not a relaxation of the evidence bar. Watched fail-first, exact accepted/refused sets,
durable readbacks and mutation review all stand unchanged. It is a question about which *routes* a
given landing is answerable for.

**This needs an author decision.** It is not a supervisor's call to make: it changes what "a row is
done" means, and getting it wrong in the permissive direction re-creates exactly the false-claim
failure this program was convened to fix.

## Resolution (2026-08-25)

The author ruled:

> **scoped landing**. A lane lands when its OWN changed routes derive correctly and its tests meet
> the unchanged evidence bar (watched fail-first, exact accepted/refused sets, durable readbacks,
> mutation review). A pre-existing bypass on `main` that the lane never touched does not block the
> lane: it is filed as its own `issues/` ticket and named in the landing as explicitly NOT closed. A
> lane defeated through surface it authored stays blocked. Under this rule Q05 and Q10 may land now
> with their pre-existing routes ticketed; deny, Q12, Q43, Q14, Q04 remain blocked. No landing may
> make a structural-property, fence, or closure claim beyond its changed routes.

This unblocks Q05 and Q10 for scoped landing with their pre-existing bypasses ticketed and named as
explicitly NOT closed. It does not unblock deny, Q12, Q43, Q14, or Q04. The unchanged evidence bar
still applies. The durable decision is recorded in LLP 0303 §Claim discipline this ruling does NOT
grant.
