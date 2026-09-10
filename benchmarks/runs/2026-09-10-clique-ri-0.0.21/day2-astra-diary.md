# Day-2 build diary

Only this lane's app, tests, installed snapback2 0.0.21 npm package, README, and served guides were used. No other lane or Snapback source checkout was inspected. The work was serial: editedAt, then pins, then pure refactor. There was no database drop, store rollover, fill job, or backend restart.

## Setup

The existing owner opened the populated store on port 52200. Authenticated reads captured 39 messages in 13 Alice-visible conversations before the schema edit. The copied web dependencies were missing binary assets in expo-router, @expo/metro-runtime, and @react-navigation/elements. I restored assets from the exact npm versions inside the lane. My initial CI setting disabled Metro watching; replacing that process required one actual frontend restart. I also made two unsuccessful launcher attempts (occupied port, then incorrect nested CLI path), and initially raced browser navigation against startup. These are environment/agent costs, not migrations. Expo forked a listener child; the PID audit and shutdown include both child and launcher. npm cache and test temporary files were directed into day2.

## 1. Nullable editedAt — pass

The app already supported editing through an optional `edited` boolean, but had no timestamp. I added `editedAt: time ?` and set `editedAt: now` in the existing edit mutation. Old timestamps were deliberately left null: inventing historical edit times would be incorrect.

The migration required three observed platform operations: an unsuccessful check (8.165 s), a corrected check (2.412 s), and one automatic transactional successor install. No install command or fill job was needed. The first check refused because the extra 44 bytes of certified row width pushed `messages.searchAll` over its 4 MiB closure budget (4,199,688 versus 4,194,304 bytes). I changed that query's cursor page from 20 to 19, retaining its 100 conversation lanes and cursor reachability. The old generation continued serving during refusal. This is a documented budget constraint with surprising coupling to an unrelated query, not evidence of data corruption.

Two test-harness issues also needed correction: the copied evidence/seed-map.json was absent (reconstructed through authenticated reads, without reseeding), and an unset optional field in a mutation return is omitted while query rows expose null. All 39 captured messages preserved their original message fields. The browser rendered all 22 captured DM rows; an actual edit returned a server timestamp and rendered the edited label. Three root-cause correction loops, zero forced resets during this change.

Compared with a SQL/ORM migration, adding a nullable timestamp would normally be one ALTER TABLE migration plus the writer change, with no backfill. Snapback removed migration-file authoring and coordinated the live install, but made me repair a certified query budget that a SQL/ORM nullable-column migration would ordinarily not affect. Exact successor execution duration is not emitted; observation bounds and check durations are retained in migration-timing.json.

## 2. Pinned messages — pass

I added a pins table with conversation and message references, pinning actor, server time, a unique conversation/message index, and a conversation/time pagination index. The pin mutation derives conversationId from the referenced message, checks current membership and non-deletion, and returns an existing pin for retries. List and unpin require current membership; durable row rules also enforce membership. The UI provides Pin, Unpin, and paginated per-conversation pinned messages, including an unavailable-message fallback.

Two platform operations: one successful check (0.910 s), one automatic additive successor install. No manual SQL, migration plan, fill, restart, or store reset. The public client handled invalidation and live delivery without handwritten WebSocket infrastructure.

My first UI implementation misused `drain: true`. The served live-query guide explicitly reserves it for ascending append logs. The backend and two headless subscriptions already worked, but both browser lists showed unavailable. Replacing it with `usePage` fixed the descending mutable list and preserved live pagination. This was one agent correction loop (including a diagnostic rerun), not a missing platform capability. Two browser clients then observed pin and unpin without reload. Tests also proved outsider denial, conversation isolation, duplicate idempotence, and denial after membership revocation. Zero forced resets.

Compared with SQL/ORM, the table/index migration is similarly small. The useful reduction in work was that rule enforcement, query invalidation, and delivery to both clients came from the same backend declarations. The client hook distinction was easy to misuse and cost a correction loop.

## 3. Pure refactor — pass, with explicit acceptance scope

Renamed the internal `isMember` expression helper to `isConversationMember` and updated every import/call, including messages.send. Added a documentation comment above the backend helper. No schema or product behavior changed in this request. The resulting generation is exactly the same hash as before the refactor: `07e086b237ec37340dd118f0617e4d64695464b2a3c74d2a20c3409c097935d9`.

Four platform operations: three checks (1.349 s refused, 0.828 s refused, 1.779 s passed), and one watcher applied report with identical from/to generation and empty migration delta. The two refused checks were my guesses at comment syntax (`//`, then `#`); Quarry uses `--`, as its diagnostic rewrite demonstrates. I also mistakenly let an acceptance command run after a failed check; that run is preserved but excluded from final refactor evidence. Four root-cause correction loops overall, counting the fixture issue below. No backend restart, client full reload, fill, or reset was required.

The final existing suites cover auth/profile (M1), social/feed (M2), messaging (M3), media/edit/reactions (M4), privacy/search (M5), custom client/push/replay (M6), and insights (M8). Additional current-baseline checks preserve all original captured messages and exercise send idempotence, editedAt, pins, polls, vote replay, counts, and deletion. The existing M7 functional assertions are also run with fresh test accounts, including its real 180-second expiry check. Its three historical-artifact checks are explicitly skipped: old benchmark snapshots/reports are prohibited inputs for this task, so fresh day2 history and regression evidence replace them.

The first extra M7 run on repeatedly reused Alice fixtures hit an existing route limitation: ResolveConversation searches only the first 20 memberships. Accumulated test groups put its target outside that page. Fresh fixture accounts allow the same functional assertions to run without changing the product during a pure refactor. The limitation is preserved and documented, not silently fixed or erased through a database reset.

A SQL/ORM refactor would require no database migration. Snapback also produced no semantic generation change, although its watcher still checked/reported the source update. The identical hash is useful evidence alongside actual acceptance reruns. `snapback2 test` was not invoked because its documented fresh isolated owner has no advertised fixed-port option; the app's acceptance checks instead used the two authorized ports.
