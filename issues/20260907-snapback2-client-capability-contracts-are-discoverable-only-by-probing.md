# snapback2: the client capability contracts (grants, outbox states, drain completion, echo shapes, byte leases, locks) are discoverable only by probing (guide-gap)

**Date:** 2026-09-07 · **Area:** snapback2 client arms / offline / guide · **Source:** Clique full run, muse-snapback2 lane (all milestones green, scale replay PASS) — diary M3/M5/M6/M8, essay "Where it added friction"

The best Snapback 2 lane of the run estimates "a third of my build time went to deriving capability
contracts from behavior" and kept "the `.d.ts` files and a row-shape dump script open the way
other projects keep the docs open." Each item below cost it a headless-probing loop; none is
written down anywhere it could find.

1. **Replay-grant lifecycle.** Who mints the grant and when it is adopted is stated nowhere;
   "login mints the grant, signup alone races adoption" was derived from `outbox.ready()` flaking,
   and the fixture now logs in after signup as "a load-bearing ritual I cannot cite a source for."
2. **Outbox entry shape.** `queued` / `replaying` / `failed` and `issuedSeq` semantics came from
   dumps; a loop was burned treating the client-assigned sequence as flush-order proof (the
   authoritative check is peer-visible order plus entry states).
3. **Drain completion / quiescence.** One-shot queries on capped streams carry no backfill cursor
   (`next` is null even when more pages exist); history walks need the live hook machinery, whose
   completion is signalled only by delivery-state transitions plus silence. "Convex queries resolve,
   Supabase queries return, Snapback queries settle, and 'settled' is your responsibility to define."
   Every aggregate the lane ships now gates on quiescence by a rule it had to invent.
4. **Live echo shapes.** A view-once open's echo arrives with the message join nulled; it first
   crashed the thread and then silently erased the just-opened bubble. Undiscoverable without a
   row-shape dump.
5. **Byte-path viewed guard.** Exists only as `.d.ts` prose; no error code names which step (mint,
   fetch, lease) refused, so fetch-after-commit looked like a timing flake for a full loop before
   "mount-first with a per-instance viewing lease, commit on bytes-ready" turned out to be mandatory.
6. **Navigator lock per origin.** A second same-user page is starved by the exclusive lock and must
   boot a memory-only client; nothing documents the lock.
7. **Resume log cap.** `E_OFFLINE_RESUME` silently stops live updates after membership churn until a
   "surgical mirror recovery" (clear answers and rows, keep grants and outbox); a full
   `deleteDatabase` kills the replay grant. Neither the cap nor the recovery is documented.
8. **Server time vs client time** on edit windows: `E_QUARRY_UNKNOWN` until `at + windowMs >= now`
   in server time (also hit by both other snapback2 lanes; see the time-arithmetic ticket).

## Proposed

One guide page per numbered item is too many; the offline page and the assets page can absorb
most of them: a "lifecycle" section on the offline page (grant, outbox entry states, resume cap and
recovery, the lock), a "reading a live stream" section (settled vs capped vs streaming, backfill
cursors), and refusal codes for the byte-path guard so the diagnostics registry names them. The
lane's rule "gate every aggregate on quiescence, chain pages oldest-first, tag optimistic rows and
exclude them from sums" is the paragraph the live-query page is missing.

Related: `20260906-snapback2-guide-gaps-from-the-clique-run.md`, `20260906-snapback2-per-row-subscriptions-hit-the-256-cap-and-crash-the-browser.md`.
