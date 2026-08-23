# Make Expo push reservation the caller-authority handoff

**Status:** Open — unblocked by author ruling 2026-08-23
**Opened:** 2026-08-23
**Systems:** Expo push, Auth, Durable ledger, External effects
**Governing:** LLP 0143 D3
**Source:** `issues/20260821-durable-authority-to-effect-handoff-design.md`

## Scope and exit

For immediate session/service sends, atomically revalidate caller authority
while committing the exact durable reservation. Remove every live-session
veto after accepted reservation; claim, `transmitting`, provider I/O, and
settlement derive authority from the reservation. Any earlier check is only a
fast-fail aid and cannot replace the reservation cut.

Tests must prove retirement-before-reservation yields no intent/provider call;
reservation-before-retirement permits the exact attempt and settlement;
pre-`transmitting` recovery remains safe; post-marker uncertainty remains
`ambiguous`; and System/Deferred paths are unchanged.
