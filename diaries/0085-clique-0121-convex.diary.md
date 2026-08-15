# Diary 0085: Clique 0.1.21 Convex exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-convex/`

**Lane:** `sol-convex`

**Model:** GPT-5.6 Sol, high effort

**Backend:** Convex 1.44.0

## 1786765958 — M1 boundary (green)

Built password signup/sign-in with scrypt, expiring random session tokens, server-side logout revocation, unique email/handle indexes, the exact profile shape, profile editing, avatar persistence, Expo session restoration, and reactive profile views. The clean-state suite passed all 7 suite-required assertions and the frozen choreography passed all 3 implemented required checks. An iOS Hermes bundle was exported.

What felt easy: Convex tables, indexes, public functions, and reactive profile queries fit the domain directly; once the client subscribed, the two-browser live-edit proof required no channel plumbing. The generated API types also caught backend/client drift early.

What fought me: Convex 1.44's local flag entered account setup despite the requested local posture. Reading the published CLI source revealed `CONVEX_AGENT_MODE=anonymous`, which created an isolated SQLite deployment without an account. Node actions then rejected the machine's Node 26, while the CLI error correctly named supported versions; the preinstalled Volta Node 24.18.0 resolved it. Expo 57 also required React Native 0.86.2 rather than registry-latest 0.87.0.

Documentation and workarounds: CLI `--help`, package source, and the error messages were more useful than general model memory. I vendored the frozen UI kit unchanged into the lane so Metro and TypeScript resolve its React peers locally. Auth is application-owned because base Convex has no built-in password credential provider: Node actions run scrypt, while mutations own sessions and revocation. That is real backend-specific authority friction and more code than managed password auth.

## 1786766636 — M2 boundary (green)

Built text/image/video post persistence, direct replies, live reply counts, idempotent likes/reposts, explicit follow edges with implicit self-feed membership, follower/following counts, reverse-chronological Following and Global projections, and cursor-shaped 20-row pages. The clean-state suite passed all 22 suite-required assertions. The final frozen choreography passed all 7 implemented required checks; its two media-composition checks remained honest optional structural skips because the frozen contract exposes no picker ID. An iOS Hermes bundle was exported.

What felt easy: live likes, repost counts, follower counts, and newly created feed rows were almost mechanical once represented as indexed Convex documents. The client did not need event handlers or cache invalidation. Server-side idempotent intent rows made retry behavior explicit and inspectable.

What fought me: the data model was easier than the automation-facing application shell. The first choreography run revealed that a profile route needed a route-level feed-tab affordance after follow toggling. Later runs found the UI kit's profile DOM text order and Expo Stack's retained hidden screen creating duplicate test IDs. The final fix unmounted the Home contract DOM while unfocused. A direct `@react-navigation/native` import was briefly attempted, but Expo Router 57's bundle guard rejected it and pointed to Expo Router's own `useIsFocused` export.

Documentation and workarounds: the frozen choreography source was indispensable because the route choreography is more specific than the screen wireframe. Convex itself caused little friction here; the main ownership choice was computing feed projections at read time from indexed edges rather than maintaining fan-out tables. That stays simple for the reduced fixture envelope but would need performance validation before the omitted scale replay.

## 1786766701 — M3 boundary (green)

Built deduplicated DMs, distinct group entities, active and historical memberships, admin-only add/remove authority, full-history-on-join semantics, removed-member history cutoffs, text messages, quoted replies, aggregate receipts over the send-time recipient set, live chat lists/messages, sender avatars, and server-scheduled typing expiry. The clean-state suite passed every suite-required M3 assertion plus explicit receipt, removal-history, and typing-expiry probes. The frozen choreography passed all implemented checks. Its four unsupported observations remained optional structural skips: sender-avatar selection, semantic receipt tokens, group aggregate receipts, and member-removal controls are not automatable through the frozen IDs. An iOS Hermes bundle was exported.

What felt easy: message delivery itself was the cleanest part of the run. A message insert immediately updated both browser contexts through the same query used for initial history. DM uniqueness was a single indexed canonical pair key, while groups stayed independent entities. Capturing the recipient set on each message made receipt aggregation and member-removal semantics understandable.

What fought me: typing is ephemeral product state but Convex's straightforward expression is a durable row plus a scheduled cleanup mutation. It worked, although observed browser visibility arrived close enough to the two-second ceiling to feel load-sensitive. Receipt state also required explicit client mutations on fetch/open; live queries alone cannot infer delivery authority. The UI kit has no group lifecycle controls, so those guarantees were proved through the app's public function surface rather than frozen browser choreography.

Documentation and workarounds: Convex's generated function API and scheduler were sufficient without external services. The main missing documentation at point of need was a concise anonymous-local recipe covering Node-action runtime selection; package source and the CLI's actual errors supplied it. Backend authority was generally clear: membership checks, quote locality, recipient snapshots, removal cutoffs, and password/session rules live in Convex functions, not client conditionals.

Post-boundary completeness audit: I noticed the backend had add/remove authority but lacked promote/leave mutations and the client lacked a new-chat/group surface. I added those core M3 surfaces, exposed group membership controls, then reran the clean M3 suite and frozen choreography and exported a new final Hermes artifact. Both remained green; the final M3 boundary is the later re-verification timestamp recorded in the run log.
