# Clique on Snapback 4 — diary

## M1 — Accounts and profiles

Built password identity (`use identity`), public profiles with unique handles, avatar `image` columns, Expo Router auth + own-profile edit, `localStorageSessionStore` so reload keeps the session, and server-side logout.

Felt easy: Quarry `check` is fast and the diagnostics name the rewrite. Built-in password auth meant no KDF work. The published README really is the whole language.

Fought: Expo Router still mounts the feed route before a Snapback client exists (`useClient: no SnapbackProvider`). Logout on `/settings` did not return a signed-out auth form, then after re-login did not show feed tabs. Those were agent routing mistakes, not Snapback defects.

Prior familiarity: Expo Router + Playwright testIDs. Snapback 4 itself was learned from the installed README/guide in this session.

Missing: I wanted a one-line “render this screen only with a client”; the client card is clear, the Expo shell is on us.

Compared with Convex/Supabase at this step: schema + rules + sync in one file is less plumbing than SQL migrations plus RLS plus a generated client. The cost is learning Quarry’s “locals bind once” and exact sync/read-rule pairing.

## M2 — Posts and the follow graph

Fan-out-on-write feed, public posts, likes/reposts/replies, global timeline. Seed replayed starter-m2 through mutations including image/video uploads.

Easy: `maintain` counts and `if absent` idempotent follows. Image/video columns plus `client.upload` matched the brief.

Fought: unique-key collisions on unread digest rows surfaced as generic `E_RULE` because the writer could not read the hidden row. Choreography assumes feed tabs exist after navigating to a profile; that is a shell concern. Thread replies share the post composer testID.

Hermes iOS export failed on private class fields in the RN/DOM graph if `snapback4/web` is in the native bundle — lazy-import on web.

## M3 — DMs, groups, receipts, search

Backend: `createDm` reuses `dmIndex`, disappearing TTL from shortened windows, typing expire, view-once `once` assets, group membership mutations. Suite m3 passed against the HTTP API.

Easy: Quarry `expire at` for disappearing messages is one column. Words indexes for search compiled on the first try.

Fought: send died on `unreads` unique clash (`E_RULE` because the sender cannot read the counterpart's unread row) — same class as digestAcc. After that, Playwright live DMs still missed: replica DM forks, RN Web controlled inputs, ScrollView clipping, then a ConversationView JSX break that left Metro serving an error overlay. One early choreography pass of live text/typing proved the mutation path; later runs accumulated messages and client-shell bugs. Dave was already an admin in Weekend Plans from a partial membership check, so addable-candidate `dave` vanished until we removed him.

Prior familiarity: the unique-hidden-row `E_RULE` pattern from M2.

Missing from the published surface: mutation `Write` has no result payload on the React `run()` path, so the client cannot read `createDm`'s reused id and must re-query `dmByPair`.

Compared with Convex at this step: receipts and typing are just tables plus expire. The friction is rule/sync pairing, not missing primitives.

## M4 — media in chat, reactions, edit/delete

Suite m4 passed (photo/video send, reaction replace/remove, edit). Windows come from the seeded shortened config. Choreography for M4 shares the same live-conversation shell as M3.

Easy: `sendMedia` with image/video columns and duration check. Hard: same Playwright conversation surface as M3, so web green is blocked.

## M5 — view-once, disappearing, search, chat chrome

Suite passed (view-once open, non-admin rename refusal, people/in-chat/global search). `once` on `photoOnce` and `expire at` did the server work. Search `matching` on words indexes is the pleasant path. Choreo blocked on M3 live DM.

## M6 — offline/push/custom client / scale adapter

Suite passed: custom-client HTTP demo (`inbox`, `threadMessages`, `send`, `/changes`), sample-50 replay. Push worker writes `push-log.jsonl` from `emit push`. Scale replay adapter started on a `--fresh` instance at :49302 at epoch 1789346150; 167157 actions cannot finish under identity rate limits in remaining wall. Compared with Convex cron+httpActions, the replay is “the same mutations against an empty store,” which is the right shape; the host rate limit is the brake.

## M8 — insights and trending

Suite passed: `insights()` totals and 7-day buckets, `trendingFeed`. `maintain` counts plus a trending table with `expire at` is less code than a warehouse. Multi-device offline choreography was not run (blocked by M3 web).

