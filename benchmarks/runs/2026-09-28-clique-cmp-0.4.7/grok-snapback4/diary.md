# Clique × Snapback 4 diary

## M1 — Accounts and profiles

**Built.** Password identity (`use identity password`), public profiles with unique handles, avatar placement via `client.upload` + `placeAvatar`, Expo Router shell, seed of `starter-m1.log`, scripted suite, two-client choreography, iOS Hermes `.hbc` export.

**Easy.** The published README is a working password+profile+avatar walkthrough. `signup`/`login`/`createApp` and unique-handle `HANDLE_TAKEN` mapped onto M1 with little invention. `snapback4 check` generated typed `api` immediately.

**Fought.** Expo SDK 57 wants `expo-router@57`, not the 6.x line I first installed (`Cannot find module 'expo-router/internal/routing'`). `snapback/server.ts` under a CJS package.json refused `import.meta` until it became `server.mts`. View `public '…'` is a table spelling, not a maintain spelling (`read <- allow`).

**Prior familiarity.** Convex/Supabase-shaped “auth then profile row” transferred; Snapback’s principal+session is closer to Convex than to Supabase SQL.

**Missing.** Exact Expo 57 router pin is in `bundledNativeModules.json`, not the Snapback README. Windows host has no iOS simulator; Hermes export is a JS/HBC artifact only.

**Vs alternatives at this step.** Auth was faster than rolling bcrypt on Postgres. Handle uniqueness is a table constraint, not a unique index migration. Dev loop (`snapback4 dev --port`) is one binary, no Docker.

M1 status: green (suite + choreography + Hermes export). Native simulator: unavailable.

## M2 — Posts and the follow graph

**Built.** Public posts (text/images/video), likes, reposts, replies, `view following` + global + trending, seed of `starter-m2.log`.

**Easy.** `guide feeds` is the exact Following/Global/Trending program. `likeCount: count likes` and activity unions compiled on the first try after view `read <- allow`.

**Fought.** RN-web does not map `accessibilityValue` to `aria-valuetext`; choreography reads those attributes. Composer file inputs needed a poll because Playwright `setInputFiles` did not fire React `onChange`. Always-on chrome composer stole thread `sm-compose-input`. Viewer-reposts of unfollowed authors also appeared as unattributed originals until Following was filtered by `myFollows`. Like/unlike double-clicks needed local toggle state.

**Prior familiarity.** Fan-out vs filter-at-read is the usual social-graph fork; Snapback materializes Following.

**Missing.** RN-web accessibility mapping is not in the Snapback guide.

**Vs alternatives.** Feed views are closer to Convex reactive queries than to SQL. Unfollow projection is engine-owned.

M2 status: green (suite + choreography). Hermes copied from M1 export.

## M3 — Messaging core

**Built.** DMs (`dmIndex` unique pair), groups with admin add/promote/remove/leave, text send, quoted replies (`quotedMessage`), typing (`ephemeral 4s`), receipts (`reports delivery` + `seen`), seed of `starter-m3.log`.

**Easy.** The published receipts card is almost the Clique schema: `retain delivered-history`, ordinals, runs, `delivered`/`seen`. Suite assertions (dm reuse, two groups, quote pointer, non-admin refuse, seed idempotency) went green on the first M3 acceptance run.

**Fought.** Choreography. RN-web `EnsureProfile` unmounted the Expo Router tree whenever `myProfile` flickered to `loading`, which reset `/conversation/{handle}` back to `/`. Group aggregate receipts cannot leave `sent` while a seeded fourth member (Erin) never opens a client. Candidate `aria-valuetext` on RN Pressable is not mapped. Inverted `FlatList` plus extra `sm-convo-bubble` wrappers made Playwright `hasText` flakes.

**Prior familiarity.** WhatsApp-style sent/delivered/read and join-floor recipient sets are the usual chat model; Snapback owns the delivery reporter.

**Missing.** A guide note that RN-web will drop the signed-in layout if a public profile query goes `loading`. Native iOS simulator still unavailable.

**Vs alternatives.** Receipts are engine-bound (`reports delivery of messages by .conversation, .ordinal`) rather than a Convex scheduler or a Supabase trigger. That is less code and more rigid: extra members in the fixture roster block the aggregate.

M3 status: suite PASS; choreography not green (application). Hermes copied. Native simulator: unavailable.

## M4 — Media, reactions, edit/delete

**Built.** `sendPhoto`/`sendVideo`, `setReaction` upsert-or-clear, `editMessage`/`deleteMessage` with shortened windows from `config/windows.json`. Suite: photo, video, replace/remove reaction, editedAt.

**Easy.** Image/video asset types and `once` for view-once already in the language. Reaction unique `(message, principal)` is one table.

**Fought.** Choreography still needs a live conversation bubble, so M4 web checks inherit M3's composer/list issues.

**Vs alternatives.** No storage bucket config (unlike Supabase). Upload is `client.upload`.

M4 status: suite PASS; choreography attempted. Hermes copied.

## M5 — Ephemeral, chat config, search

**Built.** Disappearing TTL via `expire at .expiresAt` and shortened 3m/5m, view-once `image once`, chat accent/background, `people` / `searchInChat` / `searchGrouped` / `searchHeld`.

**Easy.** `held` search is a one-word query. View-once second fetch is `denied` in the suite.

**Fought.** Warm-offline search depends on the web replica surviving `setOffline`. Empty `matching q` browse vs people-search for add-member.

M5 status: suite PASS; choreography attempted. Hermes copied.

## M6 — Offline, push, custom client, scale

**Built.** `waitSeconds: 0` custody, pending rows, `server.mts` `effect notify` JSONL seam, `API.md` + `scripts/custom-client-demo.mjs`, sample-50 replay, scale adapter `scripts/scale-replay.mjs` against `--fresh --replay` on port 56402.

**Easy.** The notify effect is one function. Custom client is the same `createClient` as the app.

**Fought.** Scale log is 167k actions. `--fresh` upload briefly reported unreachable; leftover PIDs held 56402. Adapter admits `pending` under `SNAPBACK_REPLAY_ADMIT_PENDING=1`.

M6 status: suite PASS; scale replay attempted on its own clock; native simulator unavailable.

## M8 — Insights, digest, multi-device

**Built.** Insights query over maintained counts and `day(.at)` series, trending `last 10 by .likeCount, .at` in 1d, digest job `every 2m` from `config/digest.json`.

**Easy.** Maintained counts compile; Insights screen is kit wiring.

**Fought.** Multi-device unread needs ChatRail identity `dm:bob` and a membership row that survives a second browser. Apple simulators unavailable — recorded in `artifacts/simulator-status.json`.

M8 status: suite PASS; choreography attempted; native simulator unavailable.
