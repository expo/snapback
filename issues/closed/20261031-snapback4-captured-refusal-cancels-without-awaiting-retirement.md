# snapback4: a captured call refused inside the admission transaction cancels its record without awaiting retirement

**Opened:** 2026-10-31 · **Area:** `app-online.ts` admission transaction (post-landing review, Fable L3) · **Status:** closed · **Severity:** Low

When `storeRefusal` lands between the pre-transaction check and the locked admission, the captured call
now returns the terminal refusal inside the transaction and cancels its capture without awaiting
`retirement`. LLP 3000.013.000 §4.7 says the record is cancelled only when `refusedStore` returns the
terminal refusal, and a failed retirement leaves the call `pending` with the record kept. Net positive
today (no intent is pushed behind a completed retirement), but the retirement-failure case keeps nothing.

**Next:** return a marker from the transaction and route it through `refusedCapture()` so a failed
retirement still keeps the record; witness with a rejecting retirement save.

**Resolution (2026-10-31, Lane T1):** The locked admission returns a `storeRetired` marker and routes it through `refusedCapture()` after releasing the journal lock. Cancellation now follows `refusedStore()`'s terminal outcome. Session and persona witnesses inject refusal between the pre-check and locked callback, hold retirement to prove the call and record remain pending, then cover both a rejected save (pending, record kept, one replay on next open) and a successful save (terminal refusal, capture cancelled, no replay). Known custody and locked authority precedence remain unchanged. RFC §2.4/§7 and `REPORT-T1.md` retain the evidence.
