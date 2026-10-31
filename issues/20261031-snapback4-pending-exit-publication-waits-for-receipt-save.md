# snapback4: the pending-exit publication still waits for the receipt save

**Opened:** 2026-10-31 · **Area:** `app-online.ts` `settle` → `persisted`; LLP 3000.002.000.000 §2.2 P2 · **Status:** open

LLP 3000.002.000.000 §2.2 claims the durable `store.set` never gates publication. The landed executor
(`main 1b0a49003e`) starts the revocation episode at arrival (the finding that mattered: a stalled save can
no longer postpone a withdrawal bound) but emits `persisted` only after `settle` awaits the journal save,
so the one publishing read with the in-memory cut still waits for the save. The lane S3c recorded the
claim as unsupported in RFC §7; the held-save S2b witness asserts `responded` and `published=false` until
release.

**Next:** either emit `persisted` (or a `pendingExit` event) when the intent leaves the in-memory pending
set and let the durable save lag, with a witness holding the save past the publication; or amend §2.2 P2
to the landed behavior and say why the lag is acceptable. Row/property change, not an executor conditional.
