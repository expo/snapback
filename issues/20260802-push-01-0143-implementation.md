# PUSH-01: LLP 0143 implementation — the Expo push-notification seam

**Status:** Open
**Systems:** Runtime, Storage, Auth, Wire Protocol, Client integration
**Related:** LLP 0143 (ACCEPTED 2026-08-02), the landed ctx.fetch egress
seam, LLP 0045 (outbox — sequencing OQ), the closed a4expo-f1 finding

Implement the three-piece seam LLP 0143 accepts, in its own order:

1. **Device-token registry** — platform-owned, custody + retirement wired
   to session end/rotation/`DeviceNotRegistered`; token bytes never
   exposed to app code.
2. **`ctx.push.send` action lane** — host-side audience→token resolution
   under a declared config grant over the ctx.fetch egress seam.
3. **Handoff ledger** — crash-safe
   `handed-to-expo`/`expo-accepted`/`expo-error`/`ambiguous` states with
   the doc's never-claims list intact.

The doc's nine open questions are implementation-resolvable; resolve each
with a dated note in the LLP as you go (surface naming first — it names
the capability id). Split this ticket into sub-tickets if the registry
lands separately from the send lane. Flip `notifications: false` only when
the full seam ships with its acceptance kit; add the GAP row meanwhile if
the guide gains a push page.

**Exit:** the seam demonstrated against a fake-Expo fixture (OQ7's kit)
plus one real Expo push receipt on a dev build; capability manifest
updated honestly; dated implementation-record amendment on the LLP.
