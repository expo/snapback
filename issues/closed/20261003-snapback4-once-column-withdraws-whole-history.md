# Snapback 4: a `once` column makes a whole history withdraw to loading during slow settlement

**Opened:** 2026-10-03, from lane LM (merge 3d1ec31ff6), investigating calibration #29's empty-list transition
**Area:** client read preservation (LLP 3000.023, lane RV's preservation certificate), `once` media authority
**Status:** Closed — 2026-10-03, lane ON2; bytes-once preservation

## What happens

Lane RV's rule keeps a live answer on screen unless a change can remove a row. That rule needs a preservation certificate, and a table with a `once` (view-once media) column cannot receive one, because the column's authority is unknown until settlement. During a slow settlement replacement, the one-second revalidation episode therefore withdraws the whole history read to `loading`, and the `usePage` accumulator exposes zero items. The list flashes empty even though no row was removed. Both offline sends later appear exactly once. In LM's paired control, removing the unused nullable `once` column preserves the complete history.

This is the documented conservative authorization boundary, not a lost message. But it withdraws every row of a chat history to protect one column's authority, and chat histories with view-once media are the common case.

## Original proposal (superseded by the author ruling below)

Narrow the withdrawal to what the unknown authority can actually affect: the `once` column's value or asset handle, not row membership or the rest of the row. Then a settlement episode keeps the list on screen and masks only the unproven column. The narrowing must keep LLP 3000.023's hard withdrawals and the view-once guarantee: a revoked once-asset must never be shown.

## Resolution — 2026-10-03

Charlie ruled that view-once protects bytes, not the handle or metadata. The
original masking proposal above is not adopted; lane ON remains parked.
`revocation::Dependencies::table` no longer marks an entire table unknown merely
because a scalar, optional or list image column is `once`. It retains the same
asset-column edit dependencies, membership checks and hard withdrawals.
LLP 3000.023 §12 records the contract and the narrowly scoped decision.

LM's original base test reproduces the one-second empty transition on process
and wasm. The updated regression keeps both offline sends and the original row
on screen throughout held settlement. Online coverage keeps a consumed handle
through a held replacement, while all three tiers still refuse a second asset
fetch with HTTP 410 / `E_ASSET_VIEWED`, remove deleted rows, withdraw revoked
membership history on its deadline, and withdraw on account/store switch.
The assets guide explains the bytes-once contract and the small “Opened” render
pattern. Verification, including the complete suite and its classifications,
is recorded in `snapback4/reports/20261003-on2-once-preserve/REPORT.md`.
