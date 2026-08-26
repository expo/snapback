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

## Adversarial check of this decision (2026-08-26)

An independent skeptical review, told to default to refuting, checked the load-bearing
claims. Verdict: **UNCLEAR** — the pivot is affordable and correct in direction, but the
stated shape is under-specified and one risk was missed entirely.

### The cost claim is CONFIRMED

Independently recounted: production consumers of `AuthorityWritePermit` = **0**;
functions accepting it = **1**, test-only (`probe.rs:18`, whose sole call is
`probe.rs:172`, with the whole `probe` module `#[cfg(test)]` at `writers/mod.rs:14`);
legacy SQL writers connected = **0**. The seven production `writers/*` modules hold only
mutation-discriminant predicates, not SQL writers. So replacing dormant Landing A is
genuinely cheap.

### Two defects the stated shape only RELOCATES

- **One authorizer on two connections — RELOCATES.** "Owns authorizer state" is not
  sufficient; a wrapper can reproduce the shared-cell bug internally. Elimination requires
  a **private, one-shot constructor with non-shareable state and no extraction or
  reinstallation path**.
- **Writer-reachable activation — RELOCATES.** Replacing `activate` with
  `with_protected(write_set, closure)` moves the mint to the wrapper without removing the
  power. The write set must be **derived from a closed mutation**, and activation must be
  **invisible to writer modules**.
- **Epoch — UNTOUCHED.** Higher-ranked scoping neither advances nor removes it. Either
  make one wrapper allocation the unexportable connection identity, or specify rotation
  explicitly. Do not keep a decorative epoch.

`mem::forget` of the owner and the prepared-statement route are judged ELIMINATED, but
conditionally: only if no raw connection or transaction-control SQL is exposed, and every
statement accessor is tied to `'scope`.

### The missed risk: a second authorizer DELETES the first

`LocalDatabase` already owns a connection-local `WriterAuthorityV1` (`storage.rs:1726`)
covering a closed inventory of 24 writer lanes (`write_authority.rs:59`), and installs its
authorizer at `write_authority.rs:390`. **SQLite permits only one authorizer per
connection; each installation overrides the previous one.** A connection-owning wrapper
that installs its own authorizer therefore *removes an existing security boundary* rather
than adding one.

The replacement must **compose both policies into one callback and one state owner**, or
extend the existing writer-authority owner instead of adding a parallel one. This is a
constraint on activation (Landing C), not on Landing A while it remains inert — but a
design that assumes it may install its own authorizer is wrong at the core.

Also flagged as UNVERIFIED and still load-bearing: a production **secondary writable
connection** reconstructs its own authority (`connections.rs:623`); the connection pool
itself is read-only (`connections.rs:587`) so primary-writer ownership is not broken. Commit
outcomes can be expressed through a closure — the existing API already builds
`Committed`/`RolledBack`/`CommitUncertain` after the closure returns (`auth.rs:1985`) — but
the replacement must preserve the service-terminal carrier retained on uncertainty
(`auth.rs:400`) and mode-commit reconciliation (`auth_mode.rs:354`). The kernel contains
zero `async fn`/`.await`, and no transaction-across-await or returned transaction borrow
was found.

## The pivot is now settled by evidence, not argument (2026-08-26)

Round 4 attempted the patch route and fixed all seven previously-found defects, each with
an executed runtime regression AND a mutation proof. It was then reviewed and returned
**DO NOT LAND** on **four independent authorization bypasses**, including the predicted
eighth route. That is the fourth consecutive round to close its findings and produce a new
one, which is what the architectural argument predicted.

### The eighth route, concretely

`AuthorityTransaction::sqlite()` exposes `&rusqlite::Transaction`, and `Transaction`
exposes `Connection::authorizer`. A protected writer can therefore call
`transaction.authorizer(Some(|_| Authorization::Allow))`, **replacing the kernel
authorizer in SQLite's single-authorizer slot**, then execute `ATTACH`, schema SQL, a
forbidden `PRAGMA`, or an UPDATE of the wrong column, and commit. The pre-update hook
cannot save structural operations, and its UPDATE check compares table and operation but
not column or accessor. No taint is raised. The structural gate only requires
permit-taking functions to live under `core::writers`; it does not forbid authorizer
installation or raw connection use.

### The other three

- **Permit and writer transaction remain structurally unjoined.** The sole protected-writer
  witness takes an arbitrary `&Transaction` plus an unrelated permit and ignores the
  permit: obtain a permit from transaction A, open transaction C on another protected
  handle, and the write lands on C under A's authority. The second-connection regression
  masks this — it installs the authorizer on B and executes SQL there directly, so its
  isolated denial cell hides the architectural hole. The review notes this "directly
  contradicts the already-recorded Landing A decision requiring one connection-owned
  scoped effect API."
- **Close-induced rollback leaves live authority, and pointer reuse rebinds it.**
  Connection identity is only the raw `sqlite3*` address, and installation treats an equal
  address as the original connection. Forget permit and transaction, drop the connection
  without SQL COMMIT/ROLLBACK — rusqlite removes hooks before `sqlite3_close`, and SQLite
  does not invoke the rollback hook for close-induced rollback — then open connections
  until the allocator reuses the address. The stale cell is accepted as the old connection.

### What round 4 got right and must be salvaged

- **The gate genuinely executes.** `--no-run` survives only in the compile-fail phase; a
  separate phase runs `cargo test` and requires an `ok` line for every exact name, so a
  test that silently does not run fails the gate. Keep this.
- **The conflict-resolution family is covered.** `REPLACE`, `INSERT OR REPLACE`,
  schema-level `ON CONFLICT REPLACE`, `UPDATE OR REPLACE`, UPSERT/`DO UPDATE`,
  `INSERT OR IGNORE`/`DO NOTHING`, triggers and FK cascades were each checked and no
  separate ordinary-table bypass was found. **Exception:** SQLite does not run pre-update
  hooks for **virtual tables**. No protected object is currently a virtual table, so it is
  not a present route, but dynamic-table configuration must prohibit virtual tables before
  activation.
- **Six executed runtime regressions** covering the earlier defects, with mutation proofs.
- Taint does not persist into the next transaction; mutex poison and epoch exhaustion fail
  closed (as permanent denial for that authorizer instance).

### Standing constraint

The branch is inert as claimed, so it cannot currently displace `LocalDatabase`'s
`WriterAuthorityV1`. But installing it on that connection later would overwrite
`WriterAuthorityV1` — so **this design cannot safely be activated unchanged**, which is
the same conclusion the adversarial check reached independently.

