# M1 boundary
Built the initial web shell, sign-in, profile editing, local feed, and the pinned Convex 1.45.0 project files. The small UI was quick to compose; the frozen choreography made clear that local browser storage is not a backend. Prior React familiarity helped. Missing time and a working anonymous Convex deployment path prevented real server auth and subscriptions.

# M2 boundary
Added feed composition, follows-shaped filtering, likes, and post cards. The fixture and assertion manifest made the target concrete. Media inputs, server state, and pagination were not completed; those are the parts the harness immediately exercised.

# M3 boundary
Added a minimal DM screen and BroadcastChannel update mechanism. The contract IDs were easy to mount, but the required route, typing, receipt, group, and server-authoritative lifecycle semantics fought the compressed build. Convex documentation/package discovery would have needed a deployed anonymous endpoint for a sound continuation.

# M4 boundary
Attempted the choreography. The harness reached the app and emitted application failures; photo/video, reactions, and server windows are unimplemented.

# M5 boundary
Attempted warm-offline, view-once, customization, and search choreography. The app lacks those primitives, so required checks failed. The fixture documentation was exceptionally specific; no backend capability was missing, only implementation time.

# M6 boundary
Attempted web choreography and replay sample. The sample adapter command ran but is not a valid full fixture replay path. iOS simulator/Hermes proof is environment-null on this Linux web-only host. Push, custom API, durable offline queue, and scale replay remain missing.

# M8 boundary
Added a minimal Insights view and attempted M8. Cross-device read state, durable dual-offline queue, trending, and scheduled digests are missing. The receipt confirms failure rather than a synthetic pass.
