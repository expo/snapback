# Diary 0087 — Media Happy Post

**Date:** 2026-08-16  
**Demo:** `demos/media-happy-post/`  
**Scope:** LLP 0239 R3/R4 source acceptance vehicle; no Metro, simulator, or
physical-device run

## 2026-08-16 — Building the owner-principal media path

The good part was how little application-specific media plumbing remained once
the backend used the intended shapes. `v.media()` made the avatar a typed row
field, `assetCollection` generated the bounded ordered child operations, and
`defineMediaCommand` projected one task that owns up to four uploads plus the
post mutation and append. The Expo screen could stay focused on picker input,
task snapshots, and rendering. In particular, `useSnapbackMediaCollection`
made sibling-local denied/unavailable handling a natural map over stable item
IDs instead of an application cache keyed by URLs.

The sharp edge was authentication. The charter initially called the persona
switcher “dev-auth,” but ordinary app-side asset HTTP in that lane is anonymous
and cannot satisfy an authenticated upload intent. The guide did prevent a
false start: `guide/backend/media-happy-paths.md` says app-side uploads require
sessions mode. The demo therefore provisions two fixed development-only
password accounts and signs into real sessions. That is slightly more launcher
and boot code than a client-asserted persona switcher, but it makes the demo an
honest media acceptance vehicle.

The other friction was that the local launcher prints a direct backend origin,
while `SnapbackExpoProvider`'s normal development path expects a supervised app
binding exchange. The app uses the same Expo package and asset-source adapter,
but prepares a React binding directly from the generated descriptor after the
test session is established. This is appropriate for the explicit local
origin, though a first-party “session persona + direct local origin” recipe
would be a useful future convenience.

Compared with React plus Convex or Supabase, Snapback asks for more explicit
declarations up front: upload intent, delivery policy, row sharing, collection
bounds, and command mapping. The payoff is that the generated API carries the
complete upload/commit shape and the renderer receives typed media projection
states, including denial. A Convex or Supabase version would likely reach a
first thumbnail with less schema vocabulary, but the application would own
more conventions for atomic multi-upload commit, ordered child identity,
signed delivery refresh, and partial failure.

The source-only phase intentionally stops short of claiming the hard part that
requires operator context: Expo Go on a physical phone and the unsupported LAN
carrier. The README makes that boundary and the open decision packet explicit.
