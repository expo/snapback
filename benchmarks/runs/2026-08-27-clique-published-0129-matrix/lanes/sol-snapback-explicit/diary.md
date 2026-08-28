# Clique build diary

## M1 boundary — 1787853966

Built password signup/sign-in on Snapback's built-in provider, durable web session custody, server-owned public profiles with unique handles, avatar/profile editing, logout revocation checks, and the frozen UI-kit auth/profile surfaces. The eight-person M1 action log now runs through real signup and the generated profile mutation, and its second replay converges without duplicate profile rows.

The easy part was expressing unique handles and owner lookup as indexed schema facts, then consuming generated references in both Expo and a headless client. The explicit handler made the actual identity boundary unusually legible: `ctx.auth.userId` is the only profile owner input.

What fought me was setup ceremony. I initially gave `defineAuth` an invalid optional false flag and omitted a required disabled guest-policy object; the diagnostics were accurate but the first code had to bounce through two codegen loops. Node's process-global durable auth partition also made separate headless objects restore one principal until the served multi-persona recipe supplied the required partition key. Finally, the first choreography failure was ordinary route behavior: relogin on `/settings` stayed there even though auth succeeded.

The explicit profile saved me from guessing which generated consumer API to call and made mutation read/write admission reviewable. It cost boilerplate in validators, result contracts, reads/writes lists, and the auth-program declaration. Missing at the point of failure was a focused `defineAuth` minimal password-only example; the Guide search returned no entry for the broad module-evaluation code, so package types and the diagnostic prose carried the repair.

## M2 boundary — 1787856232

Built the follow graph, text/image/video posts, typed public media uploads, bounded media child rows, Global and Following projections, likes, repost attribution, direct replies and threads, live profile counts, and cursor pagination. The 52-line starter segment replays through ordinary authenticated writes, while image/video bytes travel through Snapback's upload/finalization path rather than document strings. The final suite covered every one of M2's 22 suite-owned atoms, and all nine frozen two-client checks passed.

The easy part was the social graph and set-state interactions: indexed pair rows plus server-derived viewer identity made follow, like, and repost idempotency direct. Once feed rows were flattened, live cross-client count changes arrived without application polling.

Media and web projection fought hard. A base64 video immediately hit the documented 32 KiB structured-value ceiling. The Guide's preferred generated media collection then compiled but the published Linux runtime refused its required capability, so I used the Guide's typed child-table fallback. Separately, Metro repeatedly raced Snapback's temporary generation directories until those backend artifacts were excluded from its watch graph. React Native Web also dropped the frozen kit's `accessibilityValue` and retained inactive route DOM, requiring an app-owned web semantic/media projection and route-aware composer removal.

The explicit profile saved the database from the first media shortcut: typed references, attachment verification, public delivery, unique conflict disclosure, and structured handler diagnostics made the safe boundary concrete. It cost several authoring loops because codegen exposed newer collection syntax than the pinned runtime could load, and owner-visible collection parents interacted with cross-author feed reads. Missing diagnostics were a published-capability table paired to each Guide path and a warning that Metro's fallback watcher needs Snapback generation artifacts excluded.

## M3 boundary — 1787859249

Built canonical one-channel direct messages, distinct named groups, live text delivery, quoted replies with an actual jump interaction, connection-owned typing presence, monotonic per-recipient receipts, slowest-recipient group aggregation, and owner/admin membership operations. The starter's 19 actions replay idempotently, and the frozen segment passed all required checks including remove/re-add/leave and retained pre-removal history.

The easy part was the durable model. Explicit indexed membership and receipt rows made authority checks and aggregate receipt state readable, while the generated ephemeral typing reference paired cleanly with the activity-presence helper and met both clocks.

What fought me was page-lifecycle timing. The harness takes a just-reloaded context offline at `DOMContentLoaded`; the provider failed its supervised bootstrap before mounting the app and did not recover, despite the Guide describing a web binding cache. A narrow online-event reload repaired that named failure. Full navigation could also abandon a settings mutation, so the destination route resumes a locally witnessed pending removal and waits for authoritative roster absence before exposing send. Several early quote browser checks were my own locator races.

The explicit profile saved me from accepting client-supplied sender identity and made every group authority transition auditable. It cost substantial bounded-query/result-contract code, and the public typing rule is broader than the desired membership scope because I did not find a generated ephemeral authorization composition that could share the custom membership check. Missing documentation was a sessions-app example proving the supervised cold-boot cache and a Router-navigation recipe for settled mutations that must survive page replacement.

## M4 boundary — 1787862002

Built typed photo/video message upload and delivery, reaction set/replace/remove with one reaction per user, server-windowed edits, and delete-for-everyone tombstones. The suite covered all five suite-owned atoms and the frozen two-client segment passed photo render, inline video playback, reaction convergence, edit visibility, and deletion.

Media upload itself was comparatively direct after M2: the established typed child-row asset pattern transferred cleanly. The explicit reaction invariant was also easy to express as a unique message/reactor row and set-state mutation.

What fought me was live projection behavior and web structure. Nested reaction reads committed correctly but did not wake the active JS live query, and even a dedicated reaction query did not deliver insert/patch changes. I used connection-owned ephemeral activity only as an invalidation signal, followed by a fresh authoritative bounded query; it carries no reaction state. Separately, the frozen kit places reaction chips beside the bubble while the frozen harness scopes them beneath it, so the same web semantic projection already needed for receipts and media now mirrors those kit-owned chips into the contracted subtree.

The explicit profile saved the asset access and reaction authority boundaries from client-supplied identities, but it cost repeated result/read/write declarations and several successor cycles while isolating invalidation. Missing diagnostics were a live-query dependency trace explaining why a committed child-table insert did not wake either subscribed projection, plus a contract note calling out the kit/harness reaction-chip ancestry mismatch.

## M5 boundary — 1787864364

Built server-timestamped disappearing messages with reconnect purge, recipient-unique view-once opens, admin-gated group identity/configuration, synchronized accents and backgrounds, people/in-chat/global prefix search, and a durable warm-offline search cache. The final suite covered all six suite-owned atoms and the frozen segment passed all four implemented checks, including its full five-minute expiry clock.

The indexed invariants were pleasant: one view-once-open row per message/recipient and server-derived expiry timestamps made the security-sensitive facts compact. Search semantics were also straightforward as bounded word-prefix projections.

What fought me was navigation and observability rather than storage. The harness leaves settings immediately after selecting disappearance, so the destination must resume an abandoned intent before exposing send. React Native Web put background image state below the frozen preview root, requiring a semantic `data-value` projection. Retained retries selecting identical fixture bytes also needed a versioned URI. Custom JS live queries again failed to refresh reliably, so appearance display moved to a declarative chat-row query.

The explicit profile saved the recipient and admin authorization boundaries and made server-time usage unambiguous. It cost validators and refresh witnesses, especially because query-time server clocks are rejected for protected visibility. Missing documentation was a first-class expiry/tombstone recipe, a durable offline query-cache/search example, and a diagnostic explaining why nested or custom live-query dependencies remained stale while direct row queries converged.

## M6 boundary — 1787865002

Built a logged push-provider seam for text and media, a generated custom-client history API with cursor paging, a runnable headless polling demo, a generic action-log adapter that settles every frozen verb, and a browser-durable ordered message outbox with pending receipts. The M6 suite and frozen web choreography are green; iOS-only artifacts are explicitly environment-null on this host.

The custom-client surface felt cohesive because it reused the same generated references and authentication machinery as the Expo app. Extending the existing write path to emit structured push rows was also direct. The 50-action sample replay completed quickly and exposed a real set-state issue in reaction replay, which the explicit mutation contract could fix without changing UI behavior.

Offline UI was the fight. The active query blanked when transport dropped, taking the composer with it even though retained messages were still present. Keeping the initialized composer mounted and owning a small localStorage outbox produced the required pending/order behavior. This is less automatic than Firebase, but the resulting recovery boundary is legible.

The explicit profile saved the custom client from becoming a second API implementation and made its minimum field manifest checkable. It cost a long result validator and repeated bounded related-row reads. Missing documentation was an end-to-end application outbox example for Expo Web, plus a production-shaped token issuance sample; the Guide accurately labels the current external-bearer path local-only, but leaves the application broker story intentionally incomplete.

## M8 boundary — 1787868680

Built exact lifetime Insights totals, seven server-UTC activity buckets with explicit zero days, a trailing-24-hour top-ten Trending projection, and an armed two-minute digest cron whose mutation is period-idempotent and suppresses zero digests. I also completed same-account live messaging, cross-device unread clearing, and dual-client offline convergence. The suite passed all six owned assertions and the frozen three-context browser segment passed all five required checks.

The analytical functions were the easy part. Indexed follows/posts/reactions plus bounded server handlers made the six totals and ranking rule understandable, and the cron guide's action-to-mutation chain was concrete enough to implement without guessing. The scheduler autonomously reached a succeeded ledger state.

What fought me was simultaneous web custody for two Alice contexts. Snapback repeatedly emitted `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`, leaving authenticated custom live queries or mutations stranded even while direct headless calls were fast. I progressively separated table-native public-read projections from authenticated custom snapshots, fixed my own stale purge gate, added a settled/optimistic sender echo, made unread receipts an atomic message-write fact, and bounded idempotent retries. Retained retry traffic also exposed a suite-isolation error when old high-like posts displaced new tie rows; using all eight isolated actors restored the intended current-run ordering proof without reseeding.

The explicit profile saved the digest idempotency, receipt uniqueness, and server-owned counters from ambiguity. It also made every workaround's trust cost visible: the public conversation projections are bounded but broader than a membership-filtered authenticated query would be. The largest missing diagnostic was a causal explanation and recovery recipe for `SNAPBACK_CLIENT_AUTH_COMMIT_REENTRANT`; the runtime surfaced the code but not which provider operation stranded which hook. A supported server-side aggregate/read model that remains a query, rather than requiring a declared-write mutation, would also simplify Insights and snapshot fallbacks.
