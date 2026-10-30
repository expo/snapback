# Snapback 4 progressive writes: inspection completion wakes only loading watches, not watches retaining data

Status: Open
Date: 2026-10-30
Scope: progressive web startup (LLP 3000.002.000 §7.2), opt-in `startup: "progressive"` only; the default path is unaffected
Source: Astra, Lane B verification pass, Medium, recorded at landing of Lane B (commit on main; see the RFC §13 Lane B record)

A `rooms` watch displays data; its replacement evaluation finishes during a `messages` journal inspection; the custody fence withholds the replacement and `publishLocal` retains the displayed answer. When inspection completes, the callback wakes only `loading` snapshots, so the disjoint `rooms` watch stays stale and `revalidating` indefinitely.

Fix: track custody-parked watches explicitly and wake them when uncertainty clears, including watches retaining data, without renewing deadlines. Test with a watch that already displays data.

Landing posture: Lane B landed opt-in after four blind two-family fix rounds; the verification pass on the
landed snapshot raised this item and the orchestrator ticketed it rather than run a fifth round (LLP 0232
optimistic landing; LLP 0189 fix-forward). Closing this ticket is a precondition of the Lane C default flip.
