# Build diary

## M1 — Accounts and profiles

I extended PocketBase's built-in users auth collection with Clique's exact
profile fields, seeded all eight fixture identities through real signup and
profile-update calls, and wired persistent SDK auth into the Expo Router web
shell. Built-in password auth and local token persistence were easy. The first
provision pass fought me because PocketBase 0.39.9 already creates `users`; my
schema authoring initially treated that collection as if it were absent.
Extending it in place fixed the problem without replacing auth. Prior
PocketBase familiarity helped with the SDK's `authStore`, file values, and
collection rules. What is still missing is a first-class per-session revocation
primitive: clearing a stateless JWT client-side is not the server-side logout
guarantee the full brief wants.

## M2 — Posts and follow graph

I built text/image/video creation, reverse-chronological Global and Following
projections, direct replies, set-state likes/reposts/follows, and 20-row backend
paging. PocketBase files and relation records made the core model quick, and
explicit `created` autodates kept every sort valid. Two integration details
fought me: the video composer needed a real loadable poster for the frozen
structural check, and the profile follow control needed to return to the feed
surface expected by the choreography. Prior familiarity with collection
indexes and multipart SDK writes saved time. Missing capabilities were atomic
set-state mutations and aggregate counts; both remain application logic rather
than database primitives.

## M3 — Messaging core

I added deterministic DMs, groups with membership/admin state, live polling,
typing expiry, membership-at-send recipient snapshots, per-recipient
delivery/read rows, quotes, and group lifecycle controls. Record-oriented
PocketBase writes were straightforward, and its SQLite uniqueness constraint
made concurrent DM creation safe. The frozen starter log already contained
Dave while the choreography added Dave, so I preserved his seeded history but
treated the idempotent add/promote action as the live membership witness. A
second correction added automatic creation for the Alice/Dave progress-marker
DM. Familiarity with snapshot recipient sets helped; what PocketBase lacks is
a presence/typing/receipt primitive, leaving several durable coordination rows
and client expiry logic to maintain.

## M4 — Media, reactions, edit/delete

I wired PocketBase file fields into inline photo/video messages, one-row-per-
actor reactions, text edits, and tombstone updates. Uploading and serving media
was notably easy, as was the reaction uniqueness key. The app path worked on
the first choreography pass except for playback: the open-source Chromium
download lacked H.264/AAC support even though PocketBase returned the correct
206 response. A lane-local published Chrome build proved the fixture unchanged.
Familiarity with browser codec variance saved an unnecessary media rewrite.
PocketBase still lacks server-side edit/delete window enforcement and asset
revocation in the declarative collection layer; those need hooks for a stronger
production build.

## M5 — Ephemeral, chat config, search

I added per-chat color/background/disappearance settings, view-once state,
case-insensitive word-prefix search over the durable local snapshot, and
shortened-window purge behavior. File-backed backgrounds and synchronized
settings were easy once the preview exposed a structural state token. The DM
settings route needed its own explicit path, and view-once still demonstrates
client/server state rather than a fully protected one-time file endpoint.
PocketBase knowledge helped with updating file fields and JSON arrays. Missing
pieces are indexed full-text search, protected asset issuance, and a backend
expiry sweep; this implementation filters expiry on sync/read and therefore
does not support the strongest server-refusal claim.

## M6 — Offline, push, API, and scale

I built a localStorage-backed ordered message queue, polling reconciliation,
pending/read state, a backend-owned push logging hook, a documented PocketBase
custom-client API, and the complete 13-verb replay adapter. Warm-offline web
queueing and the native SDK protocol were easy; durable cold-native behavior is
unclaimed in this WEB-ONLY lane. The scale replay was the hardest boundary: I
aborted one run after discovering its checkpoint callback was absent, then ran
a genuinely fresh corrected instance through 167,157 settled actions. Its
manifest conformed exactly. Familiarity with relation indexes and entity caches
made the full replay practical. PocketBase's same-second generated migration
filenames fought dependency ordering, the 500-author feed predicate errored,
and unindexed global search degraded 5.32x. Missing pieces are built-in offline
sync, scalable set membership, and portable aggregate/query endpoints.

## M8 — Insights, digest, multi-device offline

I added six Insights totals, a complete trailing-week surface, like-ranked
Trending, same-account unread synchronization, dual-device queue convergence,
and a real `cronAdd` digest handler with production and shortened schedules.
The existing polling/queue model generalized easily to a second Alice context,
and the frozen choreography went green immediately. Scheduled work fought me
in smaller, backend-shaped ways: JSON-array membership required LIKE rather
than the expected any-equals operator, and PocketBase date filters required its
stored space-separated timestamp instead of an RFC3339 `T`. Once corrected,
the registered job emitted a digest without a client read and rejected two
same-period duplicates. Prior familiarity with server hooks and idempotency
keys helped. Missing depth remains restart-durable native proof, fully
server-maintained insight/trending read models, and exact authorization-aware
digest accounting for every expiry/removal edge.
