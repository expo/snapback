# Clique build diary

## M1 — in progress

The generated Quarry template made an unusually useful starting point: actual password identity, owner-scoped writes, typed media arguments, and live queries were already described together. I kept the runtime's identity system and replaced demo rows with replay through signup and profile mutations. Familiar React Native form wiring helped; it did not spare me an Expo Router catch-all mistake.

The first hard integration boundary was serve-mode CORS. A same-origin Node gateway resolved it without replacing the backend. Enabling durable offline storage before onboarding also refused profile creation because the device held no replay grant. I removed premature offline configuration for M1 and retained the diagnostic for the M6 work. The guide says login/guest/resume grant IDs; it does not include signup in that list. That distinction needs explicit onboarding treatment later.

Compared with Convex's familiar query/mutation split, Quarry adds declarative access rules and certified bounds directly to the model. Compared with Supabase, I have written no SQL policies or storage bucket configuration, but the unfamiliar runtime's custody and deployment rules required more discovery. These are comparisons to model knowledge, not other lanes or timed control results.

M1 boundary: suite and two-client choreography passed; Hermes artifact retained under artifacts/m1-ios. Avatar upload required no storage service integration. The snapshot portability shim is disclosed separately from product corrections.

## M2 boundary

Built original text/image/video posts, public and following feeds, follows, likes, attributed reposts, direct reply threads, and cursor pagination. Maintained counts and explicit merge lanes fit the social graph well. Typed media arguments kept upload plumbing small. The compiler's closure accounting stopped an oversized 1,000-follow read; a 500-follow bound covers the benchmark but remains a product limitation for larger accounts.

The hardest work was client and instrument integration: RN Web omitted native semantic values, the kit's video preview needed a real poster image, and the harness expected feed tabs on profile routes. The copied kit carries an explicit web accessibility adaptation. I also ran a suite during a choreography attempt and buried its retained post; that was my execution error, corrected by sequential runs. Familiar virtualized-list behavior helped diagnose why DOM counts made poor pagination evidence.

Compared with Convex, the compiler's preflight bound gives earlier feedback but more up-front constraints. Supabase would permit a larger query freely and leave its cost to indexing, plans, and measurement. The declared maintain values save explicit counter-update logic, although their number return type and read-rule syntax required a guide lookup. No alternative implementation was inspected.

## M3 — verification in progress

Messaging uses pair uniqueness for DMs, explicit group entities and membership roles, server-time message ordering, quoted pointers, a four-second typing channel, and server-computed receipt state. A recipient table captures membership incarnations at send time. Per-membership delivery/read watermarks avoid rewriting every historic message when a client reads a chat.

Quarry's immutable lexical bindings surprised me: rebinding an outer accumulator inside a loop did not update the outer result. The receipt test caught this immediately; two bounded early-return passes replaced the accumulator. Certification then demanded that the recipient scan include the conversation authorization key. The resulting query states its authority more clearly, although this cost a correction cycle that a familiar TypeScript or SQL aggregate would not have required.

The browser's hard route navigation canceled a member-removal request. Headless removal proved the rule worked; the web mutation transport now uses keepalive. The kit/harness's fourth seeded member is represented by an actual Erin browser, not automatic server acknowledgments. This preserves the product's all-recipient rule.

M3 boundary: the corrected client passed the complete choreography, including membership removal with retained history. The two bugs were distinct: an unsettled write canceled by hard navigation, then a route reset on authorization loss. The server denied access correctly after actual removal. Compared with a familiar hosted backend, transport lifecycle and retained-data semantics were more visible concerns; the built-in typing channel was straightforward and did not require a heartbeat table. The Hermes bundle remains a build proof, not yet a simulator interaction proof.

## M4 — verification in progress

Photo/video messages reuse typed assets; reactions use set-state intents and maintained emoji counts. Text and caption edit operations have separate input bounds. Window constants are generated from the selected fixture JSON, and mutations compare server `now` with server-created message time. Delete clears all media references and preserves a tombstone.

The media suite exposed my misuse of a plain asset URL in the presentational kit. The authenticated byte API is the correct bridge for its image URI props. Native has its own packaged asset-file hook. This is more explicit than ordinary public-bucket Supabase URLs, but the explicit authority is useful for the next milestone's revocation requirements. A gateway SSE cleanup bug was mine; after closing upstream streams correctly, the owner returned to zero subscriptions with clients closed.

M4 boundary: suite and full choreography passed; final Hermes export retained. Asset authority required a more deliberate renderer than a public URL, but deletion itself was a compact mutation over typed references.

## M5 — verification in progress

Added per-chat configuration, fixture backgrounds, server-scheduled expiry, view-once photos, and people/chat/global search. The platform's word-prefix indexes and durable local evaluator share a search model rather than requiring a second substring-search implementation. The carrier is now enabled; signup deliberately performs login afterward because the documented replay grant is issued by login/guest/resume.

Expiry authoring fought the static budget. Three branches each containing fan-out priced too much work, and inserting then conditionally updating also exceeded the reserve. A preallocated ID with branch-local insert and one shared delivery step compiled. The diagnostic named cost contributors, but the route from a simple product rule to an admissible shape was not obvious from the first message.

View-once itself needed little server code because the image column carries the allowance. That is a meaningful contrast with public storage URLs or manually issued signed links: the asset ledger owns refusal, while the client is responsible for releasing its viewing component. This comparison is based on backend knowledge, not observed control-lane artifacts.

M5 diagnosis notes: adding durable storage changed the client contract noticeably. Readable snapshots can be partial, writes return queued even while connected, and an uncaught resume rejection activates Expo's full-screen development overlay. The most costly loop was distinguishing those issues from missing React Native Web accessibility attributes. A two-client manual reproduction showed the background already synchronized; the preview root was simply not exposing its changed URI. Receipt writes also needed coalescing so restoring a delivery log did not put every historical message ahead of the user's next action.

M5 boundary draft (timed choreography still running): Built server-scheduled disappearance, schema-enforced once-only photos, synchronized customization with authenticated background bytes, and paginated word-prefix search over the durable store. The native Hermes export and type check pass. The direct API checks made the security properties easy to isolate: a second photo fetch is refused, a non-admin cannot configure a group, and the scheduler fires without the participants online.

The difficult part was connecting those guarantees to a React application under partial local evaluations. My familiar online-query pattern treated loading as a reason to replace the whole screen and inferred message type from the available asset. Both assumptions were wrong for this client. I also generated excessive automatic receipt work and used too many independent per-bubble subscriptions for a thirty-message first page. Preserving delivered display state, modeling once-only identity explicitly, keeping a visible outbox, separating online acknowledgments from user intent replay, and reducing the first page to ten messages made the UI substantially steadier. The expired-content purge still comes from the backend delivery tombstone, not from treating a missing partial row as a deletion.

My prior React and ordinary backend familiarity helped with account boundaries, cursor navigation, and idempotent writes, but did not save me from learning this offline runtime's admission and observation rules. Compared with Convex's familiar live query path, there is more client-state interpretation to get right here. Compared with Supabase, I did not have to build a durable row store or implement one-view byte enforcement myself. That reduction is meaningful, although the published guide's short explanations of conditional replies and partial envelopes left considerable diagnosis to application-level reproductions.

M5 boundary confirmed: suite and all implemented choreography checks pass, including expiry after the closed-client wait. The final correction was to keep Expo routing mounted while waiting for authenticated resume; a cold online conversation now starts after revocations have been applied. Native Hermes artifact: artifacts/m5-ios-green.

M6 working notes (boundary confirmation follows): I added durable offline writes,
a logged idempotent push provider, the token-only custom-client wrapper and demo,
and the full fixture replay adapter with checkpoint verification. The web queue
was easier than expected once the earlier carrier and receipt work was stable:
both messages and engagement intents used the same durable outbox. The native
proof fought me much harder. An unsigned simulator build broke SecureStore; a
web-only AbortSignal convenience broke Hermes; my auth gate hid valid held reads;
and native accessibility hid text that the screenshot proved was present.
These were integration mistakes, not reasons to blame the database.

Prior React/Expo familiarity saved the application shell and the XCTest setup,
but also encouraged incorrect assumptions about native image helpers. The
package's public declarations were essential: useAssetFile is a cache reader,
assetUrl is asynchronous, and native bytes have their own API. The canonical
history query hit a compiler closure ceiling when combining reaction and receipt
aggregation. I documented a five-row canonical page plus public receipt-query
composition instead of silently removing fields. Compared with Convex, I did
less work inventing a durable mutation queue; compared with Supabase, I did less
work coupling local SQLite to authorization. I spent considerably more time
understanding the package's receipt/coverage states and their UI consequences.
Native qualification is still being established; web green does not stand in for
that proof.

M6 boundary: final suite and required browser choreography are green. The final
Hermes export is artifacts/m6-ios-green. Offline likes and reactions also passed
separate browser checks. Native qualification failed and is explicitly carried
in simulator-status.json; the partial screenshots, recording, and XCTest result
bundles remain available. Repeated sample replay also taught me to avoid uploading
new media before an idempotent mutation returns its existing row. The public upload
listing/discard APIs let me recover only the sample actors’ abandoned objects.

## M8 boundary

I built maintained Insights totals and UTC buckets, a timed top-ten Trending
index, a scheduled period digest with resumable work and a real provider seam,
and same-account live/offline convergence coverage. The web suite independently
counts persisted data, advances an isolated server clock for ranking expiry,
and closes every test client before restarting the digest owner. Choreography
also exercises simultaneous offline writes and receipt convergence. All of those
web checks passed; the final receipt binds the supplemental native failure.

The maintained counters felt concise once the indexes and optional migration
fields were right. The job model made restartable digest work natural. Quarry
syntax discovery still fought me: object literals inside arrays and reverse
index ambiguity required diagnostic-led revisions. The UI's held partial values
also needed explicit care so counters did not briefly show zeros during auth
restore. React familiarity saved layout and state work, while general database
experience supplied period boundaries, uniqueness, and idempotence. Familiarity
with Expo was insufficient for a reliable native proof: system password UI,
Metro cache contention, and transport/restart behavior consumed several retries.
Both native milestones retain candid failed artifacts.

Compared with backend approaches I know conceptually, Snapback makes maintained
aggregates and server-side timers unusually direct. Convex would keep more of
this logic in familiar TypeScript; Supabase would make SQL aggregation and
inspection easier but leave more offline synchronization work to the application.
Here the shared query/offline system helps, yet its partial and retained states
are product-level concerns the UI must explicitly understand. The full scale
replay follows on its own clock; no scale success is implied by this boundary.

## Scale replay and final verification

The fresh starter-seeded replay completed every action in order. Both frozen
checkpoints passed their named-fixture checks; the final verifier passed after
I corrected its missing starter-author identity lookup. I preserved the original
failed verifier receipt and continued on the same unchanged database. A separate
audit checked every action hash and both prefix hashes. All read and celebrity
write degradation comparisons passed, which suggests the bounded backend paths
avoided the obvious growing-corpus failure in this workload.

The browser result was weaker. Cold sync failed its deadline, and the busy-group
send/render probe timed out. A fresh-storage repeat showed the conversation list
but remained in the syncing state while heap usage grew substantially. I did not
call a partially rendered list a completed sync. This is where the unified
backend/offline model still needs more integration work in this app. The result
also reinforces the comparison in the essay: backend query viability and device
synchronization viability are separate engineering questions, even when one
package supplies both. Native parity and browser scale sync remain candid gaps.
