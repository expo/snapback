# Snapback 4 progressive writes: an outbox delta notification establishes complete custody knowledge

Status: Open
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass, High, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

The device holds unlisted O1 (affecting `items`). Before the first full queue read, orphan adoption emits only O2 (affecting `rooms`) through `onOutbox`; the callback merges O2 into the empty cache and sets both listing flags true. While attachment is held, an `items` query can publish without accounting for O1; if attachment fails, `recoverDeviceCustody()` skips the full read because the queue counts as observed. The host emits deltas, not necessarily complete snapshots.

Fix: preserve received entries, but establish complete listing only from a successful full queue read; a delta must not suppress recovery inspection. Test as described.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.
