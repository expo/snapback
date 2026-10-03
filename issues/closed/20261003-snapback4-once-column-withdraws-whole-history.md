# Snapback 4: a `once` column makes a whole history withdraw to loading during slow settlement

**Opened:** 2026-10-03, from lane LM (merge 3d1ec31ff6), investigating calibration #29's empty-list transition
**Area:** client read preservation (LLP 3000.023, lane RV's preservation certificate), `once` media authority
**Status:** Resolved — lane ON, 2026-10-03

## What happens

Lane RV's rule keeps a live answer on screen unless a change can remove a row. That rule needs a preservation certificate, and a table with a `once` (view-once media) column cannot receive one, because the column's authority is unknown until settlement. During a slow settlement replacement, the one-second revalidation episode therefore withdraws the whole history read to `loading`, and the `usePage` accumulator exposes zero items. The list flashes empty even though no row was removed. Both offline sends later appear exactly once. In LM's paired control, removing the unused nullable `once` column preserves the complete history.

This is the documented conservative authorization boundary, not a lost message. But it withdraws every row of a chat history to protect one column's authority, and chat histories with view-once media are the common case.

## Wanted

Narrow the withdrawal to what the unknown authority can actually affect: the `once` column's value or asset handle, not row membership or the rest of the row. Then a settlement episode keeps the list on screen and masks only the unproven column. The narrowing must keep LLP 3000.023's hard withdrawals and the view-once guarantee: a revoked once-asset must never be shown.


## Resolution

LLP 3000.023 §12 now admits conditional row preservation for a proved bare
point/page while every once cell is null. Other fields and row membership keep
their existing certificate; private view-ledger authority is checked in the
server query transaction before restoration. Devices mask unproven cells.
Filtered/derived queries and all hard withdrawals remain conservative.

LM's base empty transition was reproduced on process and wasm, then its oracle
was changed to require retained rows. New regressions cover real asset values,
revocation, second-view refusal, deletion, denial, sign-out and facade/page
masking; the real store replacement harness now includes a once column.
Qualification, disclosure audit, mutation result, wasm bytes and full-suite
failure classifications are recorded in
`snapback4/reports/20261003-on-once-narrow/REPORT.md` and `~/sb5-lanes/on.report.md`.
