# Snapback 4 progressive writes: a same-id retry of a journal-owned id is refused as E_ADMISSION while device custody is unlisted

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2); progressive becomes the web default under the author's 2026-10-30 ruling, so this is default-path exposure once Lane D lands
Source: Fable, Lane B verification pass, Medium, recorded after the Lane B landing (68b3e2f829)

Returning visit, custody present, journal holds unsent J1 from the last session, engine held or failed so `deviceKnown` returns undefined. `app.mutate(op, args, { id: J1 })` (the documented same-id retry) is not facade-minted and predates `openedAt`, so the wrapper answers `failed / E_ADMISSION "device write custody has not been listed"` while `start()` replays J1 through the journal. The caller holds a failed receipt for an executing intent, and `E_ADMISSION` means safe to resubmit, so a fresh id duplicates the write (RFC §7.2 rule 4 violated).

Fix: before the refusal, if `this.current().some(w => w.id === options.id) || recorded(options.id)`, route to `journal.mutate`; a journal-known id can never be a device id. Ids minted before this document opened at module scope also hit the refusal (Low).

Landing posture: Lane B landed after four blind fix rounds; the author ruled "land it and make it the default and then keep
working on ironing out all bugs in it", so this ticket is bug-ironing work (Lane E), not a landing veto.

Resolution: fixed in Lane E round 1. Route positively known journal pending/recorded ids through journal same-id recovery before the unknown-device refusal.
Proof: progressive-writes.test.mjs:630 — J1 retry with held/failed engine; no failed-admission result for executing custody; one dispatch after listing. Negative control: snapback4/reports/lane-e1/negative-same-id-v2.log.
