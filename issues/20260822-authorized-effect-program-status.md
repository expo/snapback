# Authorized-effect fence program: what is landed, what is open, what is blocked

Status: Open — index; update as items close
Created: 2026-08-22
Related: LLP 0283 F-1, LLP 0058

Index for the durable-write fence program. It exists because the work now spans ~15 tickets and
the individual documents do not say where the program stands.

## The property being pursued

> An ordinary session or scoped-service caller cannot commit a durable write after their own
> authority has gone terminal.

**It is not true yet.** `issues/20260821-residual-caller-terminal-write-exposure.md` measured the
aggregate rather than the site count and found the ordinary mutation seam sound while direct routes
still violate it. Counting fenced sites overstates progress; that ticket is the honest measure.

## Landed

| What | Commit |
|---|---|
| Split-phase authorized-effect primitive + the regression that demonstrated the gap | `b441f87b7`, `138d24164`, `1b0d76425` |
| 10 mode-epoch fences (job claim, 7 watch-job families, derived-fork marker, coverage-gap) | `65ab481ad` |
| 6 asset SQLite state/receipt sites | `556d18e07` |
| 8 migrated mode-only → split-phase sites | `860c2c2fd` |

Every fenced site carries a mutation test that fails when its own fence is removed. All four
landings were reviewed independently by two models; between them review found ~12 defects,
including four regressions the fences themselves introduced.

## Open, unblocked

- **Asset follow-ups** (`lane/assetfix`) — 409 retry, plan-proof enforcement, width convergence.
  In its fifth review round.
- **Bounded commit capsule prototype** (`lane/capsule`) —
  `issues/20260822-bounded-commit-capsule-spec.md`. The shared dependency for everything below.
- **Residual findings 4 and 5** — watch renewal/management, denial/revocation.
  `issues/20260822-residual-findings-4-9-disposition.md`.
- **Stream refactor R1–R3** — `issues/20260822-stream-attempt-refactor-design.md`.

## Open, blocked on author rulings

1. **Detached-action ownership** — is a detached action the caller's effect or the system's once
   accepted? Blocks Critical 1.
2. **OAuth consent atomicity** — may a grant survive code-issuance failure? Blocks the OAuth
   storage refactor.
3. **Watchdog vs never-wait-for-Local** — blocks stream R4.
4. **Terminal accounting** — does retirement block only new handoffs, or retroactively veto
   settlement? `issues/20260821-terminal-accounting-settlement-ruling.md` recommends the former;
   two of the three settlements need no change either way.
5. **Capsule rollout** — common deadline budget vs per-operation; automatic retry for all calls or
   only idempotency-bearing ones.

## Deferred with a recorded design

- **Watch creation** — `issues/20260822-watch-creation-fence-design-decision.md`. Decided:
  restrict the anchor rather than witness state. Stays mode-only until four prerequisites exist.
  Extracted after six review rounds; `issues/20260822-watch-creation-fence-needs-a-design.md`
  records why.
- **External/irreversible effects** — withhold rather than fence.
  `issues/20260821-durable-authority-to-effect-handoff-design.md`. 4 of 9 need work; 5 are already
  correct.

## Program-level defects found along the way

- Every landed split-phase fence pins logout on an unbounded Local wait —
  `issues/20260822-permits-pin-logout-on-unbounded-local-wait.md`. The capsule is the fix.
- Diagnostics silently inherit HTTP 500, and the registry undercounts classified codes by 558 —
  `issues/20260822-diagnostic-http-status-registry-gaps.md`.
- `check-inventories` has no hook or CI enforcement —
  `issues/20260821-check-inventories-has-no-mechanical-enforcement.md`. Four distinct reds on main
  in two days.
- OAuth proposals are uncapped and can wedge the pairing sweep —
  `issues/20260822-oauth-proposal-pairing-sweep-fk-wedge.md`.
- Orphan blobs after a partial reset wipe are never reclaimed, and a partial wipe is
  indistinguishable from a complete one —
  `issues/20260821-orphan-blob-reclamation-after-reset.md`.

## Census confidence

- **SQLite side: source-complete.** An independent enumeration reproduced the same 22 families —
  `issues/20260821-durable-write-census-completeness-audit.md`.
- **Non-SQL side: swept separately** — `issues/20260821-nonsql-durability-census.md`, 21 sinks, 11
  reachable-and-unguarded. Its one Critical (reset `wipe_all`) was **adjudicated and withdrawn**;
  the handoff design's "no remedy" verdict was correct.

## What would make the property true

From the residual audit's closure set: finish the asset ticket; land the stream refactor and its
fences; and add split-phase reservations to the new direct-route families — detached-action nested
mutations, pending-effect/grant/OAuth/watch-management decisions, and the auxiliary issuance and
lazy-write paths that were not accepted.

Multi-transaction routes need care: a permit must span every sibling transaction, or each must take
its own. Guarding only the main transaction leaves the earlier authorization-clock commit exposed.

---

## 2026-08-22 — the two hard-date items are already done (queue correction)

The program's only deadline-bearing work was believed to be the two raw-SQL ingress allowlist
rows expiring 2026-09-19:
`issues/20260819-fork-read-view-raw-sql-ingress.md` and
`issues/20260819-replication-wal-raw-sql-ingress.md`. An analysis pass dispatched to scope their
removal found the premise stale, and I verified each claim directly:

- `crates/privilege-surface-allowlist.v1.json` contains `"entries": []` — the allowlist is
  **empty**, so the gate now excuses nothing.
- Both tickets are in `issues/closed/`, resolved 2026-08-19.
- `ForkReadView` survives only as a private services type with a private constructor; both WAL
  helpers are `pub(crate)`. No public kernel ingress remains.

**The program now has no deadline-bearing work.** Every remaining item is fix-forward.

Two details worth keeping:

1. **These were never dangerous.** Both ingresses accepted a raw connection the caller *already
   possessed* and returned neither a connection nor write authority. They were
   ungoverned-by-the-gate, not a privilege escalation. The WAL operation is operationally
   safety-critical, but making its helper public granted no capability a caller lacked. Useful
   calibration: an allowlist row is evidence of ungoverned surface, not of exposure.
2. **The expiry date was off by one in our own notes.** The gate rejects when
   `expiresAt < today` on the Los Angeles calendar date
   (`scripts/check-kernel-raw-sql-api.mjs:60-67`, `:110-123`), so the rows would first have gone
   invalid on **2026-09-20**, not during 2026-09-19.

Not claimed: a fresh green run of the live gate. The analysis ran read-only and the gate's helper
build needs to write under `target/`, so this rests on static inspection plus the direct file
checks above. Separately, `issues/20260819-security-gates-expected-red-until-f1.md` still expects
the product gate red for unrelated F-1 reasons.

---

## 2026-08-23 — both fence lanes landed; what the review rounds actually cost and bought

Landed on `main`: watch-management fencing (6 commits, ending `ff8885a49`) and the R1
stream-attempt authorization stack (7 commits, ending `783928858`). Main verified green
afterwards: sync 251+6, kernel 820+6, engine 513, server 553, `check-inventories` PASS. The sole
remaining failure is `s5_d10_production_diagnostic_inventory_cannot_drift`, which predates this
work and is under diagnosis.

### The rounds were not overhead

Each lane needed several review rounds, and **every round found something real**:

- R1 round 3 found terminal adoption accepted any public, deserializable row and checked only that
  a terminal field was present — a doc comment asserting durability that nothing enforced.
- R1 round 3 also found **storage was a signing oracle**: private witness fields prevent direct
  construction but not *laundering through the issuer*. I had verified the fields were private and
  concluded unforgeable; that inference was wrong, and it took an independent read to catch.
- R1 round 4 found the previous round's watchdog "fix" still lost the race, because the worker's
  backstop terminalized with the pre-abandonment cause.
- Watch-management rounds 2 and 3 found **six tests that were false proofs**, including one
  sentinel that never invoked the closure it claimed to test, and one that could not reach the
  defect it was named for.

### What actually changed the outcome

Two practices did nearly all the work, and both are cheap:

1. **Demand a green-mutation.** For every test claiming a structural property, construct the
   shortest production mutation that violates the property while leaving the test green. This
   turned "that test looks weak" into a checkable claim, and it found thirteen non-discriminating
   tests already on `main` (see
   `issues/20260822-landed-fence-tests-do-not-prove-non-substitutability.md`).
2. **Require the fix to be watched failing.** "A test you have not watched fail is not evidence."
   The final R1 round confirmed its new tamper test by omitting `record_json` from the MAC framing
   and observing `expect_err` receive `Ok(())`.

### What was narrowed rather than claimed

Several guarantees could not be made structural and were **narrowed instead of restated**: the
durable-read claim became post-read context non-substitution; the witness claim became downstream
non-forgeability; LLP 0225's assertion that AppState component splicing was closed was corrected,
because it was not. Narrowing is the correct outcome when the code cannot support the claim, and
it is strictly better than a fix that overstates.

### Next

The critical path is the binding implementation plan's Step 5 — the first step that makes carrier
substitution inexpressible. Its independent early slice (sealing the capsule destination at
construction) is in flight now and closes the Critical in
`issues/20260822-capsule-structural-residuals.md`.
