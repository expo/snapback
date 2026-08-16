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

## 2026-08-16 — the physical-device pass (orchestrator entry)

Ran the LLP 0239 device acceptance with the author and a real iPhone (Expo
Go, SDK 57) against this demo. The transport was deliberately fence-honest:
snapback stayed loopback-only and Tailscale Serve terminated TLS in front
(`sessions` transport policy refuses plaintext non-loopback binds, and the
dev override rightly does not bypass it), so nothing insecure ever faced the
LAN. Metro served over the LAN as usual.

**What the paved path proved on hardware:** multi-select picker → one
`createPost` media command → four uploads with real per-item progress → one
atomic parent/collection commit (ordinals 0–3, stable item ids) → signed
issuance through the TLS origin → rendered thumbnails. Residue honesty also
proved itself twice without being asked: a corrupt fixture got a typed 422
with per-item provenance, and a failed video left three ready siblings plus
one failed item, exactly as LLP 0180/0239 promise.

**What only a physical device could catch** (each now fixed or ticketed):

1. Real iPhone media vocabulary: photo libraries are HEIC-first and pickers
   deliver QuickTime `.mov` even in compatible mode. No intent example in
   the guide mentions either; this demo now sets
   `preferredAssetRepresentationMode: 'compatible'` and accepts
   `video/quicktime` (the strip walker supports the `qt` brand).
2. `delivery: 'private-strict'` cannot feed a native renderer — RN `Image`
   attaches no bearer, so device rendering needs `private-signed`. The
   guide's Path 1 fixture uses strict delivery; a device-facing note
   belongs there.
3. Changing an intent's delivery bricked the boot with
   `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` — and the repair text worked
   exactly as written: boot the pinned pair, then move the deployment
   forward live (`ensureApp` intent:'provision' + the minted admin token),
   data intact. `tests/provision-forward.mjs` records the recipe.
4. Two real product bugs surfaced within minutes of hardware use: the
   media-command preview identity hole (fixed as
   `fix(assets): thread the replay-stable identity…`) and the JS query-path
   double projection that bricked any re-projected stored media field
   (Phase F fix). Neither was reachable by the existing unit/harness tests.
5. RN/Yoga layout: `aspectRatio: 1` + percent width collapsed image tiles
   to content height (0 for a bare `Image`) — uploads "worked then
   vanished". Explicit pixel tiles fixed it. Layout truth needs a device.
6. Still open, with precise repros: iPhone MOV `box` parse refusal
   (issues/20260816-video-strip-walker-iphone-mov-box.md), device retained
   store serving stale media-bearing live rows while headless live
   subscription returns truth
   (issues/20260816-media-livequery-retained-row-staleness.md), and one
   demo-level silent no-op on a second avatar change.

**Ergonomics verdict for this slice:** the authored surface held up — the
schema/command declarations never needed touching after the intent
vocabulary was right, refusals were consistently typed and specific, and
every mid-session recovery had a paved path. All friction lived in the
seams the guide does not yet describe for devices: media vocabulary,
delivery-profile choice for native renderers, and the sessions evolution
ceremony. Against a Convex/Supabase baseline, the atomic
multi-upload-plus-commit and the per-item residue honesty have no
equivalent; the delivery-profile and transport fences cost setup time but
each refused with an accurate, actionable message.

## 2026-08-16 — public delivery-default follow-up

The author subsequently ruled that ordinary public media should prefer the
no-issuance path. Both this demo's public profile avatar intent and public feed
media intent now declare `public-immutable`, making the policy reviewable while
exercising exactly the path the new omitted-delivery default recommends. This
removes signed-URL issuance and refresh from the native rendering path without
weakening a promised revocation boundary: neither demo surface is intended to
be private or revocable after publication.

The change was pleasantly small—two declarations, regenerated descriptors,
and a clean demo-local TypeScript check. The companion guide update now teaches
the three-way choice before its first upload example, including the important
contrast that recipient-grant and view-once examples must stay private. No
server or device was restarted for this source-only follow-up, so it makes no
new runtime or latency claim.

Compared with a React plus Convex or Supabase implementation, Snapback still
asks the author to name delivery semantics explicitly, but the chosen public
path now removes an otherwise app-visible issuance controller and refresh
cycle. The source-attributed omission advisory is a useful compromise: fast
public delivery is the code default, while security-sensitive authors still
see the decision they must review.
