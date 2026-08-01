# Party Wall — shared photo feed (LLP 0139 App B)

The upload↔database↔realtime integration app, built per-arm under
`./<backend>/`. Checklist frozen 2026-08-01 before the first arm.

## Acceptance checklist (evidence per arm, recorded in the diary)

1. Three identities: members A and B, outsider O (provider's ordinary
   identity path; posture recorded).
2. B subscribes to the event feed FIRST, with polling disabled or
   provably absent; A uploads a burst of 5 photos (one GPS-tagged) and
   posts them; record the delivery mechanism B's view actually uses
   (websocket push / SSE / listener / re-fetch), whether entries and
   thumbnail-readiness arrive without any client poll, and
   time-to-visible per photo.
3. O sees nothing: feed query/subscription refused or empty, AND a
   direct fetch of a photo URL from O (and signed-out) recorded — the
   App A privacy axis under sharing.
4. B leaves (or is removed) → B's live view loses the photos; the
   revocation mechanism and its propagation latency recorded (push
   frame? next-request denial? nothing until refresh?).
5. A deletes one photo → it leaves B's feed (mechanism + latency), and
   the stored bytes' fate recorded (URL behavior after delete).
6. GPS check on a served feed thumbnail (`_shared/gps-jpeg.mjs`):
   does the uploader's location serve to feed viewers?
7. The authorization model recorded with its exact artifacts
   (membership table / RLS policies / security rules / capability
   URLs), and where photo-read authority actually lives.
8. Ceremony count + wall-clock from empty project to check 2's first
   live photo, plus diagnostics-quality notes for mistakes made.

## Arms

`snapback/`, `convex/`, `supabase/`, `firebase/`, `pocketbase/` — each
a minimal headless driver (`run.mjs`) proving the checklist with
printed evidence; the diary carries the narrative. Firebase Storage
remains access-gapped (App A finding); its arm measures the Firestore
listener half and records the whole-app posture as PARTIAL.
