# Faceplate — avatar & profile (LLP 0139 App A)

The smallest real upload flow, built per-arm under `./<backend>/`.
Checklist frozen 2026-08-01 before the first arm; unchanged since.

## Acceptance checklist (evidence per arm, recorded in the diary)

1. Two users exist (the provider's ordinary local/dev identity path;
   posture recorded).
2. User A picks a local image → it serves as A's avatar (wall-clock
   from empty project to this check = the ceremony measurement, with a
   distinct-concept count).
3. User B, as a different authenticated identity, can view A's avatar.
4. A GPS-tagged JPEG uploaded as an avatar: does the location metadata
   serve back? (`_shared/gps-jpeg.mjs` builds the fixture and checks
   served bytes; the answer is recorded per provider, including "the
   provider never mentions EXIF anywhere in its docs" as a finding.)
5. A replaces the avatar → B sees the new one; cache behavior recorded.
6. The old avatar after replacement: orphaned? deleted? still
   fetchable by URL? Recorded.
7. A signed-out (no-credential) fetch of the avatar URL: recorded
   behavior vs. the provider's documented default.
8. Ceremony count + wall-clock from (2), plus diagnostics quality notes
   for every mistake actually made en route.

## Arms

`snapback/`, `convex/`, `supabase/`, `firebase/`, `pocketbase/` — each
a minimal headless driver (`run.mjs`) plus whatever backend definition
the provider's recommended path requires. Evidence prints as a
checklist table; the diary carries the narrative.
