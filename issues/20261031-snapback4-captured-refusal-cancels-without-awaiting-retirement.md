# snapback4: a captured call refused inside the admission transaction cancels its record without awaiting retirement

**Opened:** 2026-10-31 · **Area:** `app-online.ts` admission transaction (post-landing review, Fable L3) · **Status:** open · **Severity:** Low

When `storeRefusal` lands between the pre-transaction check and the locked admission, the captured call
now returns the terminal refusal inside the transaction and cancels its capture without awaiting
`retirement`. LLP 3000.013.000 §4.7 says the record is cancelled only when `refusedStore` returns the
terminal refusal, and a failed retirement leaves the call `pending` with the record kept. Net positive
today (no intent is pushed behind a completed retirement), but the retirement-failure case keeps nothing.

**Next:** return a marker from the transaction and route it through `refusedCapture()` so a failed
retirement still keeps the record; witness with a rejecting retirement save.
