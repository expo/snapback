# Landing A: replace the permit design with a connection-owned scoped effect API

**Status:** open (decision recorded, implementation dispatched)
**Date:** 2026-08-26
**Systems:** snapback-kernel authority-transition core, LLP 0313 Landing A
**Related:** LLP 0313 §4 §8, LLP 0303 (derive over verify), LLP 0311 §241 (connection gateway)

## Decision

Landing A does **not** patch the round-3 permit design. It adopts a **connection-owned,
scoped protected-effect API**: the guarded connection owns the SQLite connection,
transaction, authorizer state, and commit; callers receive only a non-retainable, opaque
transaction borrow inside a higher-ranked closure.

## Why — the round pattern was architectural, not incidental

Landing A was rejected three times, each round for a different defect class. That is not
bad luck. Each defect is a failed join between independently existing things:

| Defect | Failed correspondence |
|---|---|
| leaked owner | Rust `Arc` liveness ≠ SQLite transaction liveness |
| shared authorizer | authorizer-stored origin/epoch ≠ actual installed connection |
| prepared statement | authorization at prepare ≠ authority at execution |
| `REPLACE` as `INSERT` | SQLite `INSERT` action ≠ non-destructive insert semantics |
| reachable `activate` | values supplied ≠ evidence actually verified |
| frozen epoch | copied epoch value ≠ connection lifecycle transition |
| `--no-run` gate | successful compilation ≠ executed security behaviour |

The architecture represents a security-relevant correspondence as **detached proxy state
verified later**, rather than making the authorized effect derivable only inside the exact
resource and lifetime that produced it. That is LLP 0303's verify-vs-derive failure at the
architectural level, so each review finds a new edge in the same correspondence graph.

Two independent reviews converged on the same remedy from unrelated lanes: the f244
lock-ordering review's landing condition is "do not return a lock-owning guard to code
that can retain it across arbitrary work; confine the overlap to a closed operation whose
type/lifetimes prevent caller execution while either guard is live."

## The objection that blocked this was false

Round 3 rejected the scoped shape as "reshaping every writer into a closure interface."
Measured against the checkout at `492d1386b`:

- Landing A has **zero** production writer call sites; it connects no legacy writer.
- Exactly **one** function accepts `AuthorityWritePermit` (a unit-only probe).
- The surrounding kernel is **already closure-shaped**: 208 call expressions across the
  `with_auth_transaction` / `attempt_auth_transaction` families, of which 205 are leaf
  call sites across 21 files. None needs reshaping into a closure; it already is one.

Landing A is dormant and has no consumers, so this is the cheapest moment the change will
ever be. The real later cost is concentrated in 8 guarded/observed sites and 23
`attempt_*` sites that carry `Committed`/`RolledBack`/`CommitUncertain` outcomes — not in
adding closure braces to hundreds of writers.

## Two defects the new shape does NOT fix

- **`REPLACE` is fully orthogonal.** `REPLACE` is an alias for `INSERT OR REPLACE` and
  SQLite reports it as an INSERT action. No API shape makes SQLite expose semantics it
  does not report. The misleading `ProtectedWriteOperation::Replace` capability must be
  removed and replacement SQL prohibited mechanically.
- **Gate execution is untouched by API shape.** The gate runs `cargo test --no-run`
  (`scripts/check-security-boundaries.mjs:378`), so runtime denial and liveness tests
  never execute — replacing the liveness check with unconditional authorization would
  leave every compile-fail probe green. The gate must be split into a compile-fail phase
  and an executing phase.

## Scope of the claim

This does not make the authorization kernel proved correct. `REPLACE`, triggers,
foreign-key side effects, and coverage inventory still require explicit matrices. It
removes the architectural reason each review keeps finding a new retention or binding
route.

## Provenance

Read-only design analysis at `492d1386b424e3cf8301900d33a09228c66d9136`; no files were
changed to produce it. Counts above are from that analysis and should be re-measured
before being quoted as current.
