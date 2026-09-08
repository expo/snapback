# snapback2: `messages.sendPhoto`/`sendClip` produce no delivery rows, so the delivery-log thread never shows them

**Filed:** 2026-09-07 by Claude Fable 5.1, from the Sol implementation review of LLP 1018.003 (finding 7).
**Status:** open · **Severity:** recipe gap, pre-existing

`messages.sendPhoto` and `messages.sendClip` in the chat recipe insert a `messages` row and no `deliveries` fan-out (`messages.q`), while `sendOncePhoto`, `post`, `edit`, and `unsend` do. The thread screens read the per-recipient delivery log (`deliveries.thread`), so ordinary photo and clip messages are absent from the inbox and thread on every arm. This predates LLP 1018.003: the previous `threadBubbles` reducer also read only delivery rows; the Expo witness drains `messages.thread` separately for media leases for that reason.

## Fix shape
Fan out deliveries in the two media mutations (the same `for m in memberships[...]` loop), or route media through delivery-producing mutations, and add a rendered-thread assertion for a photo message to the browser and Expo witnesses. LLP 1018.000 §7's helper or a declared fan-out would remove the sixth copy of the loop rather than add a seventh.
