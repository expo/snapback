# Snapback 4: a `once` column makes a whole history withdraw to loading during slow settlement

**Opened:** 2026-10-03, from lane LM (merge 3d1ec31ff6), investigating calibration #29's empty-list transition
**Area:** client read preservation (LLP 3000.023, lane RV's preservation certificate), `once` media authority
**Status:** Open — queued for an sb5 lane after the current 3000.032 lanes free eb1000

## What happens

Lane RV's rule keeps a live answer on screen unless a change can remove a row. That rule needs a preservation certificate, and a table with a `once` (view-once media) column cannot receive one, because the column's authority is unknown until settlement. During a slow settlement replacement, the one-second revalidation episode therefore withdraws the whole history read to `loading`, and the `usePage` accumulator exposes zero items. The list flashes empty even though no row was removed. Both offline sends later appear exactly once. In LM's paired control, removing the unused nullable `once` column preserves the complete history.

This is the documented conservative authorization boundary, not a lost message. But it withdraws every row of a chat history to protect one column's authority, and chat histories with view-once media are the common case.

## Wanted

Narrow the withdrawal to what the unknown authority can actually affect: the `once` column's value or asset handle, not row membership or the rest of the row. Then a settlement episode keeps the list on screen and masks only the unproven column. The narrowing must keep LLP 3000.023's hard withdrawals and the view-once guarantee: a revoked once-asset must never be shown.
