# G-01: Scheduling — verify C2's landed jobs seam against LLP 0070's runAfter, then close the remainder

**Status:** Open
**Program:** 20260802-convex-erg-00-program.md
**Systems:** Scheduling, Runtime, Storage
**Related:** LLP 0070 (owns `runAfter` per the LLP 0115 coverage audit v0.2),
LLP 0121 (scheduling research), LLP 0115 CV-9; Wave-1 lane C2 landings
(e25ab2a3, 804782a1 — jobs/enqueue seam)

## Task

Convex's `scheduler.runAfter` is its most-cited scheduling win. Snapback's
transactional one-off jobs are designed in LLP 0070/0121 but the 2026-08-02
synthesis calls them unbuilt — while Wave-1 lane C2 landed a jobs enqueue seam
the same week. These claims can't both be fully right.

**Step 1 — verify (do not skip):** read the C2 landing commits and the current
jobs surface (`src/jobs.rs`, cron machinery, the enqueue seam LLP 0131's
acceptance 14 rode). Establish precisely which of LLP 0070's contract is
shipped: transactional enqueue (job enqueued iff the mutation commits)?
delayed/one-off execution (`runAfter`-shaped)? attempt ledger/receipts?
authoring surface (`ctx.jobs`/`ctx.scheduler` spelling)? capability fact?

**Step 2 — record:** write the delta into this ticket as a dated note. If the
gap is only the authoring sugar, say so — the fix may be small.

**Step 3 — implement the remainder** under LLP 0070's design: the paved
outcome is an author scheduling a one-off function invocation from inside a
mutation, transactionally (enqueue commits with the mutation, never fires on
rollback), with a durable attempt ledger and stable diagnostics, on local +
served surfaces. Coordinate wire/receipt additions with the owners LLP 0070
names; do not invent a parallel job vocabulary if C2's seam already defines
one.

## Exit

- The dated verification note (step 2) — required even if step 3 turns out
  tiny.
- An acceptance test: mutation enqueues `runAfter`-style job; rollback
  enqueues nothing; the job fires once after its delay with a ledgered
  attempt; a crashed attempt is observable, not silent.
- Capability fact/guide row updated only if the whole contract ships (GAP row
  otherwise).
