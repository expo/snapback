# Eight rows verified closed at origin/main by two independent instruments

Status: open
Date: 2026-08-25
Systems: snapback-sync, snapback-auth, snapback-engine
Related: llp/0291-authority-forgery-surface.research.md,
  issues/20260825-none-of-the-nine-landed-rows-were-closed.md,
  issues/20260825-llp-0291-r14-r16-is-the-root-under-everything.md,
  issues/20260825-a-closes-rows-trailer-is-a-claim-not-a-label.md

## The result

`ac20e30a6` claimed two rows (F143, C005) and closed eight. The additional six were the shared
R14–R16 root under the rows an audit had reopened; F157 and F175 fell to the same binding.

Verified at `origin/main` by **two independent instruments**, run separately, agreeing exactly:

| Row | Production-shaped cell | Additive `test-support` cell | Refusal |
|---|---|---|---|
| F157 | REFUSED | REFUSED | `SNAPBACK_AUTH_POLICY_UNAVAILABLE` — resolved authority does not match its resolution graph |
| F171 | REFUSED | REFUSED | `SNAPBACK_AUTH_POLICY_UNAVAILABLE` — grant management authority belongs to another engine graph |
| F172 | REFUSED | REFUSED | same |
| F173 | REFUSED | REFUSED | same |
| F175 | REFUSED | REFUSED | runtime in production; **compile time** in additive, `synthetic_for_test` no longer exposed |
| F188 | REFUSED | REFUSED | same as F171 |
| F190 | REFUSED | REFUSED | same as F171 |
| F191 | REFUSED | REFUSED | same as F171 |

Every refusal lands at the named attack expression **after** imports, compilation, authority production
and target-engine setup succeed. None is an import or compile-time artefact except F175's additive
cell, which is noted as such.

## Why this is trustworthy where the previous count was not

This programme previously reported nine rows closed and an audit found all nine open. Three things
differ now:

- **A negative control.** F170 is `STILL-SUCCEEDING` in both cells in both instruments, and its probe
  still issues a credential and registers a durable OAuth client. A run reporting everything green
  would have been the finding, not the result.
- **Two instruments.** One ported the preserved audit corpus against current `main`; the other is the
  checked-in ledger at `tests/fixtures/row-attacks/`, rebased and re-run. They agree row-for-row and
  cell-for-cell.
- **A before/after by one instrument.** The ledger read 9 OPEN on a tree without the fix and 8 CLOSED
  after: **16 semantic cells moved OPEN → CLOSED**, 0 mismatches, carrier controls refusing 15/15 in
  each cell.

One instrument also reported that the preserved corpus **no longer compiles byte-for-byte** against
current `main` because authority variants became opaque and the former preparation method is private.
The attack failing to build is itself evidence the carriers were sealed.

## Standing verification

`node scripts/run-row-attacks.mjs` re-runs the whole ledger. It is deliberately **not** part of any
blocking gate — it has to earn trust by being run. Its two mismatch classes carry distinct meaning:
`CLOSED → OPEN` is a regression or a false closure claim; `OPEN → CLOSED` is a row closed by other work
that would otherwise stay invisible, which is exactly how six of these eight were discovered.

## What remains

**F170 is genuinely open** and is fixed in a separate lane under dual review. Its defect is different in
kind — not a forged authority but a genuine lease belonging to another engine graph — which is why the
R14–R16 binding does not reach it.

Closes-rows: F157, F171, F172, F173, F175, F188, F190, F191
