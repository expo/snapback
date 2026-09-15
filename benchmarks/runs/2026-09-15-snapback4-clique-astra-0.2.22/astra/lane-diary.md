# Build diary

## M1 — Accounts and profiles

Built password signup/signin, persisted sessions, logout, public profiles with all six fields, avatar upload and replacement, and Expo Router navigation with the frozen UI kit. Backend declaration, generated types, and native Hermes export all worked on the first implementation. Real fixture signup and upload was fast. No password implementation was needed.

The 2,600-line published README took more orientation than the small model required, but supplied the actual media, auth, replica and release contracts in one place. The harness snapshot omitted an external JSON-schema helper and carried read-only permissions into copies; these were environment repairs inside the lane. The shell's actual Node differed from the overlay, so proof execution now uses its named absolute Node 24 executable.

Prior familiarity with React and Expo saved navigation and form plumbing. I had no prior implementation context for this app or Quarry. Relative to Convex, the profile table and operations are shorter but use a new syntax. Relative to Supabase, auth feels comparably built in while authorization and client replication are declared together. These are qualitative comparisons from general knowledge, not competing timed builds. No M1 capability gap was observed. Suite, choreography, and Hermes export passed.

## M2 — Posts and the follow graph

Built all post/media variants, likes, attributed reposts, direct replies, user post lists, Following/Global pagination, and live follow counts. The published prefixed feed recipe avoided designing celebrity delivery from nothing. Media stays on original post rows; feed entries hold references. Its caps and backfill limit are explicit and are retained as a scale risk to check at M6.

Quarry compiled the full social model first time. Generated types explained which operations moved to server-only execution. Integrating the recipe made profile saves queue without prediction; that is acceptable for this milestone but a visible tradeoff. The full README and recipe integration example saved substantial work.

The first choreography run exposed a shell navigation mismatch: after following on a profile the harness expects feed tabs to be directly available. Added those navigation tabs; retry passed. This was app wiring, not backend failure. Typecheck caught a local/online union and heterogeneous feed result union; both were authoring errors. Native inline video now uses Expo Video; web also renders a playable video element.

Compared with Convex, adopting a supplied feed recipe was less code than building a fan-out pipeline, but its caps and interpreter bounds require understanding. Compared with SQL/Supabase, maintained counts and one declared replication policy are convenient; the client/backend boundary is more constrained. No measured comparison with earlier Snapback generations is claimed.

## M3 — Messaging core

Built unique pair DMs, distinct groups, admin add/promote/remove and leave, full paged history, retained delivered history, quoted replies with actual scroll targets, typing expiry, and sent/delivered/read aggregation. The seed remains idempotent across all three segments. The suite and choreography retry passed; Hermes export passed.

The recipient-list plus per-member read positions expressed the intended receipts without per-message per-recipient rows. Membership and retention rules fit naturally. Principal IDs are not texts in Quarry: my attempted concatenated DM key was refused; two sorted principal columns were the cleaner solution. Groups now navigate by ID because names are deliberately not unique.

The hard part was an app startup race, not the message schema. A lazy web-device import added a split JavaScript fetch just as choreography navigated and cut connectivity. Warm reconnect worked, but that boundary missed delivered receipts. Static platform-specific device imports made the exact navigation/offline sequence work. React/Expo familiarity helped isolate the additional network dependency. The package's partition and retention declarations saved a custom offline-history layer; compared with typical Supabase client work, that is a substantial change in what the application owns. Compared with Convex, local query completeness and prediction eligibility are extra concepts to track.

## M4 — Media messages, reactions, edit/delete

Built photo/video message picking, inline rendering, playback, one reaction per user with replacement/removal, text and caption editing, and delete-for-everyone tombstones. Window durations are read from the fixture-selected config during Quarry generation; checks use server time. Clearing the media column immediately revokes asset reads. All prior data adopted the new optional fields and literal defaults without migration code.

The optimistic path briefly fooled my acceptance code: the browser rendered a predicted media message before a separate server query could see it. Waiting for settlement fixed the test, and the kit's edited label needed a punctuation-tolerant selector. The first choreography checked every behavior successfully but correctly stayed non-green because the suite receipt was red. The corrected suite and new choreography are green; native export and typecheck pass.

Media revocation is the strongest reduction in friction so far. In a storage bucket plus database design I would normally coordinate metadata, signed URL lifetimes and client cache eviction. Here clearing the home column expresses the refusal and feeds device purging. This observation concerns this implementation, not a blanket security claim about other products. No backend defect was demonstrated in this milestone.

## M5 — Ephemeral content, customization, search

Built per-chat disappearance, per-recipient one-view photos, group name/description, palette colors and uploaded backgrounds, and people/in-chat/global word-prefix search. The suite and choreography passed, including the five-minute real-time closed-client expiry check. An independent fresh-instance test advanced only its own dev clock with no clients connected and observed both message absence and 404 asset refusal. Hermes export and typecheck pass.

Expiry and asset lifetime were unusually direct: optional expiry plus an index and `expire at` handled server reads, sweeping, stream deletion and device behavior. One-view media used a dedicated asset column rather than an app token service. The app stores only the opened indicator; the temporary image is revoked on close, deletion, or unmount. Search was one query family on server and device instead of a second JavaScript matcher.

There is a real scale caveat: the compiler notes the possible work of merging 1,000 chat search lanes. The named probe has 100 conversations, and M6 will measure rather than assume. The kit's exact colors also corrected my guessed coral code. General React knowledge saved the presentation plumbing; the published retention, search and media contracts supplied the backend specifics. Compared with a typical Supabase implementation this removed custom cache/index coordination; compared with Convex it added explicit local completeness semantics but reduced offline search authoring. No M5 platform gap was observed.

## M6 — offline, push seam and replay adapter
Built durable local writes, a custom authenticated client demonstration, queued notification logging, the complete 13-verb replay adapter, deterministic verification and a checkpoint probe driver. The sample's 50 actions pass against actual API reads. Full replay execution waits for M8 so its checkpoints include analytics; the adapter and probes were authored here. Browser choreography and the suite pass, and the Hermes bundle exports.

The same local-client API made a cold process restart surprisingly straightforward: pending writes, history and cached ordinary assets survived, and the server accepted both queued IDs exactly once. Presence-driven emits fit inside Quarry. The structural fanout diagnostic rejected my derived recipient list; iterating the original capped roster fixed it. The durable effect outbox is the logged push seam, with no delivery provider implied. Familiarity with offline journals helped choose a real restart proof instead of a network-toggle-only test. Compared with an ordinary Supabase client this avoided writing a replication engine; compared with Convex, the explicit local database and durable queue changed the client design substantially. I have not measured those alternatives in this run.

## M8 — insights, trending, scheduled digest and two devices
Built six maintained lifetime totals and seven UTC day buckets, a transactional ranked table whose original posts expire from the trailing-day window, a server-owned multi-sweep digest, and the kit's Insights/Trending screens. The home surface now combines the inbox with the feed, keeping cross-device unread state visible. Same-account live messaging, cross-device reads, dual offline convergence and receipts pass the frozen choreography. The suite proves exact seeded aggregates, day zeroes, ranking/ties and the old-post exclusion on an isolated clock. A second isolated persistent server proves scheduled digests with all clients closed, before/after-boundary restarts, quiet subsequent periods, tombstone exclusion and unauthorized-chat exclusion. The installed native arm exports a Hermes artifact; process-device restart evidence is supplemental, not an iOS interaction claim.

Maintained aggregates were compact and the guide explicitly explained calendar versus rolling windows. That distinction saved a tempting but incorrect day-bucket Trending implementation. Exact-on-load ranking requires server-side like writes, so the offline UI exposes a queued state rather than inventing an authoritative count. The scheduler's cursor-and-commit semantics removed external cron and retry infrastructure. I chose a full message sweep for digest correctness; it is resumable but intentionally more expensive than an incremental digest model and deserves production load work. The service-token setup in my isolated proof was initially missing; the application digest itself passed once the proof authenticated correctly. Familiar SQL aggregation concepts helped, but Quarry's aggregate syntax and completeness rules required its own reading. Relative to Convex or Supabase, fewer external services were needed, while the schema carried considerably more operational policy.

## After the green boundaries — retained scale and proof corrections
The complete in-memory replay passed its manifest checks, but I realized its state would disappear at the required shutdown. I retained that evidence and repeated on an empty persistent store. This made a stopped-store copy available at each checkpoint, so additional write and browser probes could mutate a disposable copy while the primary dataset stayed exact.

My first browser proxy probe used Playwright's request-fetch proxy without handling cancellation. An asset request rejection escaped the callback and interrupted the driver. Direct browser request forwarding fixed it; the retained store resumed through stable IDs without duplicating source writes. The first successful cold browser probe completed against the real 100-conversation account, and group sends rendered through the actual UI. A second measurement correction distinguished an account following five people from an author with five followers; the corrected write comparator checks its follower count before timing. These were proof-authoring errors, and the original attempts remain present.

A post-green code review also added an explicit pending label for reactions. Their writes already used the local queue; the label makes that state visible. A separate offline-intent proof verifies both likes and reactions, and M6/M8 browser regressions still pass. The M8 Hermes artifact was refreshed. This late work is recorded separately from the historical first-green timestamps; no efficiency claim hides it.

The original harness-native token stream, first-edit driver artifact and bounded orientation custody were not supplied inside this lane. I am retaining null usage rather than synthesizing them. The base protocol record can be validated, but a composed efficiency-grade record cannot honestly be manufactured from the app receipts alone.
