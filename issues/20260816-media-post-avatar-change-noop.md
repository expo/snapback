# media-happy-post: second avatar change silently does nothing

**Filed:** 2026-08-16 · **Status:** Open · **Systems:** Demos

During the device pass, tapping the avatar and picking a new image committed
correctly the first time (profile row updated, asset ready), but a later
attempt produced no upload attempt, no asset record, and no visible error.
Likely a swallowed picker-cancel/permission path or an error routed to a
non-rendered error slot in `demos/media-happy-post/src/media-post-screen.tsx`'s
avatar flow. Small demo fix: surface every non-cancel outcome of the
changeAvatar command in the header UI. (The related rendering staleness is
tracked separately in
issues/20260816-media-livequery-retained-row-staleness.md.)
