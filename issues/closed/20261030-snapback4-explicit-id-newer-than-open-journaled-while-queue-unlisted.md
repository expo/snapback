# Snapback 4 progressive writes: an explicit id minted after this document opened is journaled while the device queue is still unlisted (double dispatch)

Status: Closed
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2); progressive becomes the web default under the author's 2026-10-30 ruling, so this is default-path exposure once Lane D lands
Source: Grok 4.7, Lane B verification pass (llp/reviews/3000.002.000-lane-b-r4.grok.md), Medium, recorded after the Lane B landing (68b3e2f829)

While `deviceKnown` returns undefined, the refusal also requires `mintedAt <= openedAt`, so any well-formed id newer than `openedAt` falls through to `journal.mutate`. Tab A (outbox-owned) admits O2 with `mintId()` after tab B's `openedAt`; tab B (journal-owned, queue read not finished) runs `app.mutate(op, args, { id: O2 })`: O2 is in neither `mutationIds` nor `custodyEntries`, the time floor treats it as fresh, the journal admits it, and after listing both the outbox prefix and the journal dispatch O2. A clock step has the same effect.

Fix: refuse every explicit id while `deviceKnown(id) === undefined && !freshlyMinted(options)`; keep the time floor only as a positive signal for ids both newer than `openedAt` and absent from the device registry after listing. Regression: admit a `mintId()` on an outbox document after the journal document constructed `ProgressiveWrites`, hold the `queued` read, assert the id is not in the journal.

Landing posture: Lane B landed after four blind fix rounds; the author ruled "land it and make it the default and then keep
working on ironing out all bugs in it", so this ticket is bug-ironing work (Lane E), not a landing veto.

Resolution: fixed in Lane E round 1. Require actual listing or facade-minted provenance for unknown explicit ids; remove the timestamp shortcut.
Proof: progressive-writes.test.mjs:642 — peer outbox admits an id after journal open while queued read is held; journal refuses it. web-start.test.mjs:894 covers the real hook and explicit-id distinction. Negative control: snapback4/reports/lane-e1/negative-explicit-id-v2.log.
