# `main` did not compile, and twenty landings went by without a gate noticing

**Status:** open
**Found:** 2026-08-26, by running `scripts/cold-clone-check.sh` — a gate LLP 0283 F-3
lists as never having been exercised.

## The break

`crates/snapback-server/src/server/oauth.rs:700` calls `provider.agent_random_source()`.
That method does not exist. Default features, no `cfg` gate:

```
error[E0599]: no method named `agent_random_source` found for struct `std::sync::Arc<AuthProvider>`
error: could not compile `snapback-server` (lib) due to 1 previous error; 12 warnings emitted
```

Reproduced on three separate hosts from `cargo build --locked --bin snapback`.

## How it got here

`dd12664e0` ("test: preserve security assertions while narrowing seams", 2026-08-26 03:44)
deliberately removed this accessor from `AuthProvider`:

```rust
/// CSPRNG dependency shared with the agent-secret storage transactions.
pub fn agent_random_source(&self) -> &dyn RandomSource { self.random.as_ref() }
```

and moved the capability behind `AuthMaintenanceGuard`. **The narrowing was correct** — it is
exactly what LLP 0303 asks for. What it missed was the surviving consumer in `snapback-server`.

This is LLP 0303 revision (s) in its plainest form: the commit proved a *spelling* was gone
without enumerating the effect's *consumers*. The same defect the row programme is chasing,
committed by the programme itself.

## The process finding, which matters more than the break

`dd12664e0` is **20 commits back** on `main`. Twenty landings ran their affected-scope checks
in that window and not one of them built `snapback-server`. The break was found only because a
never-run F-3 gate was executed for information.

Landing checks that never build a workspace member cannot detect a cross-crate break in it. The
narrower the seams get — and this programme narrows seams continuously — the more cross-crate
callers will break exactly this way.

## What to consider

1. A fast `cargo check --workspace` (or at minimum `-p snapback-server`) in the affected-scope
   landing path. It need not be a full build to catch `E0599`.
2. When a landing removes or narrows a `pub` item, require the diff to show the caller census.
   `git grep` for the removed identifier is a two-second check that would have caught this.
3. `scripts/cold-clone-check.sh` should run on a schedule, not only when someone remembers. It
   found a build break on `main` the first time it was ever executed.

## Related

- `issues/20260826-server-unit-tests-do-not-compile-on-main.md` — two `E0624` errors in the
  server unit-test target, plausibly the same narrowing wave.
- LLP 0189 — verification cadence; this is an argument for what belongs in the fast path.
- LLP 0303 revision (s) — a compile-fail witness proves a spelling is gone, not a capability.
