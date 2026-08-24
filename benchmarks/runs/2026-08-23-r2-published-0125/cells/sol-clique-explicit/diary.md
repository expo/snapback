# Clique build diary

## M1 — identity and profiles

I built password signup/sign-in, generated-principal profile ownership, unique email and handle enforcement, durable browser session custody, logout, profile editing, and fixture-avatar persistence. The first starter segment was replayed twice through the same generated mutations the app uses, with fixture mutation identities retained and transport identities isolated per replay. The M1 suite passed all seven required assertions, the frozen two-client choreography passed all three required checks, and an iOS Hermes bundle was exported.

The easiest part was the explicit data model. Deriving every profile from `ctx.auth.userId` made ownership legible, and the generated references made the frontend/backend seam difficult to mistype. Live profile propagation also worked without special synchronization logic once the query and mutation contracts were correct.

The fight was application boot, not product behavior. A separately launched Metro process had no AppBinding delivery. The combined Expo supervisor then selected several unbounded internal ports, conflicting with the lane's fixed-port constraint, and its custom command health check correctly noticed that Metro was not on the port it had assigned. The eventual fixed-port solution uses the generated descriptor in an explicit provider environment while the backend and Metro stay on 42000 and 42001. Once booted, the untouched M1 choreography went green immediately.

The explicit profile saved time in authorization reasoning and schema review. It cost verbosity: nine tables, twenty-one generated operations, and deliberate function-level read/write/refusal declarations for what would be a few loose handlers elsewhere. That cost felt useful for principal-bound profile state; the code generator caught a guest/profile classification mistake early.

The missing diagnostic was a documented, supported way to run supervised Expo web on caller-selected fixed ports. CLI help exposes the backend port but not the Metro public/process or bootstrap ports. The provider type also accepts an explicit binding override, while the default supervised environment does not consume that override; the necessary custom environment pairing was discoverable only from shipped type and implementation files, not the served Guide.

## M2 — feed, graph, posts, and threads

I built Following and Global projections; text, two-image, and video post storage and rendering; URL linkification without unfurling; follow/unfollow, like/unlike, and repost/unrepost set-state mutations; attributed repost feed entries; direct replies and chronological thread screens; and bounded feed paging. The suite passed all twenty-two required assertions. The choreography passed all seven required realtime checks, while retaining the harness's two honest optional skips for image/video composition because the frozen contract has no media-picker control. A fresh M2 iOS Hermes bundle was exported.

Creating posts and making likes/reposts live was pleasantly direct. The explicit tables made idempotency obvious: unique pairs plus set-state handlers meant a retry never had to infer intent from the current UI. The live query invalidation path also propagated counts and new feed entries with no client cache surgery.

Navigation fought harder than data. The first browser run showed that the choreography expects feed tabs to remain reachable after its direct profile route and that stacked Expo Router screens can keep background test IDs mounted. I added a lane-owned profile shell around the unchanged frozen ProfileForm and exposed the unchanged frozen FeedTabs there; I also unmounted the background feed composer whenever its screen lost focus. A second loop exposed the harness's display-name extraction assumption—the first text inside `sm-profile`—which the frozen ProfileForm itself does not guarantee because its Edit button precedes the name. The shell now provides a stable name heading without changing the component contract.

The explicit backend saved time in projection correctness. `feed` declares every read table and the graph edge remains separate from implicit self-membership, so own originals and own reposts could be included without polluting follower counts. The cost was query verbosity and N+1 codegen advisories around projected authors and interactions. For this fixture volume the bounded implementation is correct, but production scale would justify batched exact lookups.

What was missing was a diagnostic connecting a strict Playwright locator collision to an unfocused Expo Router screen still mounted beneath the thread. The harness receipt was precise enough to infer it, but a route/state snapshot on failure would have shortened the loop. The choreography/profile text-order assumption is also stricter than the frozen ProfileForm's documented contract and would benefit from a dedicated display-name test ID.

## M3 — conversations, groups, messages, presence, and receipts

I built canonical one-per-pair DMs, coexistence of groups with identical membership, admin/member roles, active membership history, member add/remove enforcement, live ordered messages, quoted replies with excerpt-and-jump behavior, typing presence with bounded expiry, per-recipient receipt obligations, and delivered/read aggregation. Every installed starter segment was replayed again through generated mutations and left table counts unchanged. The M3 suite and required choreography passed; the harness also passed its optional quoted-reply check and retained four honest optional skips where the frozen contract supplies no semantic sender-avatar, receipt-state, or group-member lifecycle controls. The final iOS Hermes bundle was exported.

DM and message identity were easy. A sorted pair key plus a unique index makes “same DM” a data invariant instead of a race-prone application convention. Quoted replies were similarly clean: store one message reference, project the bounded excerpt, and let the frozen QuotedReply render it. Presence also fit the surface abstraction naturally; its main client obligation was an explicit expiry timer.

The suite correction was small but revealing. The product path was correct, but my static assertion looked for the preview test ID in the lane route even though that ID belongs to the unchanged frozen QuotedReply component, and I used the wrong prop spelling. Pointing the assertion at the actual component boundary turned the already-correct behavior green. The browser choreography then passed without a product correction.

The explicit profile saved the most in authorization. Membership checks, admin checks, sender derivation, and receipt ownership all live beside declared writes. Removing a member can discharge only that member's still-required receipt obligations without weakening everyone else's history. The cost is ceremony and several bounded loop projections that would need batching at larger scale.

The missing documentation is an end-to-end recipe for aggregate receipts and retained-history removal semantics in explicit functions. The primitives were sufficient, but the served Guide did not bridge them into a messaging pattern. It would also help if the surface/presence documentation included an Expo Router example showing typing cleanup across navigation and unmount.
