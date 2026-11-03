# snapback4: a maintained count in the starter's `inbox()` projection makes the early offline inbox read `E_PREDICT`

**Opened:** 2026-11-03 · **Area:** `snapback4/crates/snapback4-device/src/device/acquisition.rs` (`require_read`, `read_dependencies`), the chat starter schema · **Status:** open

LLP 3000.001.001 §5.2 admits a read before full acquisition over the dependency closure of what it
reads. The chat starter's inbox projects `count: messageCounts[.conversationId]`, a maintained count
over `messages`, so the closure of `inbox()` includes `messages`, and an offline inbox read answers
`E_PREDICT` until message acquisition finishes, even though memberships, conversations and the count
rows themselves (value rows delivered with tier 1) are on the device. The RFC's motivating case is
"the inbox is usable first"; with the starter's projection it is not, offline (online the read falls
back to the server). Observed in Diary 0124; the demo removed the count from the projection.

**Fix shape (needs a ruling):** either (a) deliver maintained value rows as tier-1 facts whose
admission does not require the underlying table's acquisition when the server computed them (they
are server-authored values, not device-derived), with a §5 note on when such a count may be stale;
or (b) change the starter's inbox projection to drop the count and document the dependency rule in
the guide's sync page so authors know a maintained aggregate in a projection delays its offline
admission to the underlying table's acquisition. (b) is a guide-gap at minimum.
