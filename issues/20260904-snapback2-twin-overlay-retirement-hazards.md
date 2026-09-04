# Snapback 2 twin: overlay retirement and drained-query keying hazards

**Status:** Open
**Systems:** snapback2 client (`packages/snapback2/src/store/range-store.ts` applySwap, `pageOfDrainedQuery`; `client-outbox.ts` logTail; `templates/chat/react/src/chat/log.ts`)
**Date:** 2026-09-04
**Related:** LLP 1012 §7 (revision (h)); reviews `o2b-r3-grok.md` item 1, `o2b-r3-muse.md` M1 (cross-family)

## What the third review round found (landing 6, `4f5eef21f`)

The overlay drop rule (a page of the tail chooser's query, or a delivery holding a predicted row;
otherwise one miss of two) closed the round-2 early-vanish, but:

1. Any later page of the tail chooser's query drops the overlay, including an empty inbox page
   carrying no rows (another conversation's activity advancing the inbox) — the bubble can
   retire before its rows arrive. Re-holding the base page `{c:null}` at or past the commit seq
   also matches and drops it without the log advancing.
2. `moved()` counts any watermark swap (`swap.watermark !== undefined`), not the tail chooser's
   advancing: two re-marks of an unrelated drain strand-drop an overlay whose log never moved.
3. On arrival of the predicted row the overlay is deleted but `entry.predicted` stays `true`; a
   renderer that treats `predicted === true` as "in the twin's result" loses the row (the chat
   template renders a committed post from `args`, so it does not).
4. `pageOfDrainedQuery` treats any `null → string` key as the cursor rather than `cursorArg(op)`,
   and `logTail` still writes `c`; a drain whose cursor is not `c`, or a query with two nullable
   string arguments, mis-keys.

## Resolution wanted

Key the tail-page match to the tail chooser's cursor argument by name and require the page to
carry a seq strictly past the watermark held at commit (or the predicted row); count a miss only
when the tail chooser's own watermark advances; clear `predicted` when the overlay is deleted on
arrival; tests for each. This was the lane's third review round, so it is filed, not fixed in a
fourth loop.
