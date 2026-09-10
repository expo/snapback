# Clique on Snapback 2 — diary

## M1

Built: Snapback 2 Quarry backend (`use identity` password auth, public profiles with unique handles, image avatars) plus an Expo Router web client using the frozen UI kit. Seed replays `starter-m1.log` through `client.auth.signup` / `profiles.createMyProfile`. Acceptance covers the suite-required M1 assertions. Two-client choreography m1 is green.

Felt easy: published `snapback2 init --template chat` plus `guide auth` mapped almost 1:1 onto M1 (signup/login/logout, unique handle, live profile reads). Built-in auth avoided a hand-rolled KDF.

Fought: Expo web + Playwright. RN `TextInput` `testID`s are real inputs, but controlled state lagged Playwright `fill`, and the edit form saved an empty handle until we seeded fields once from `profiles.mine` and read DOM values on save. Metro `hot=false` in this environment meant every UI fix needed an Expo restart.

Prior familiarity: Expo Router file routes, Playwright `data-testid`, last-write-wins profile edits. Snapback 2 itself was new; the installed README/guide and chat template were the only teacher.

Missing capability/docs: the chat template still uses `avatarUrl` strings; real avatars must be `image` uploads (seeds cannot mint ledger rows). Following-feed merge is priced at 50 follow lanes — recorded as a platform bound for later scale.

Compared with Convex/Supabase at this step: password auth and live profile queries felt closer to Convex (one owner, generated `api`, subscriptions by default) than to Supabase (no SQL, no RLS policies to author). The cost was learning Quarry’s named indexes, seed integer syntax (`60_000` refused), and the owner/dev-url dance instead of `npx convex dev`.

## M2

Built: posts (text/images/video), follow graph, likes/reposts/replies, Following/Global feeds with 20-row pages, profile posts, Expo compose-on-feed so choreography can post without leaving Global. Suite 22/22; two-client choreography green after RN-web `aria-valuetext` patches.

Felt easy: maintain counts (`likeCounts`, `followerCounts`) and `merge` following-feed mapped cleanly onto the brief. Image/video post mutations took fixture Files with no extra upload protocol.

Fought: Expo web accessibility. Kit `accessibilityValue` did not become `aria-valuetext` until we set the attribute explicitly. Video composer attachments cannot be `<img src=mp4>`. Follow choreography leaves the profile route, so feed tabs had to be mounted there too. Following-feed merge is capped at 50 follow lanes — recorded as a platform bound.

Prior familiarity: feed tabs, like/repost toggles, Playwright `data-testid`. Snapback 2 live queries made the “no manual refresh” checks cheap once the DOM semantics were honest.

Missing: no documented way to fan out digest `newPostsInFollowing` to an uncapped follower set (`E_STRUCTURAL_FANOUT` without `cap 50 by followed`).

Compared with Convex/Supabase: live like counts felt like Convex subscriptions. No SQL pagination cursors to author; `after c last 20` is the page. The merge-lane cap is the sharp difference vs a SQL `IN (followed)` feed.

## M3

Built: DMs (one pair), groups, quoted replies, typing channel (ttl 5s), monotonic receipts via pendingDelivered/pendingRead counts, delivery log thread so removed members keep history, Expo conversation UI. Suite 7/7 required. Two-client choreography not green after several loops: live DM delivery to the other client, typing appear/expire clocks, receipt `aria-valuetext`, and Dave as an addable member.

Felt easy: `dmPairs` unique pair, `channel typing … ttl 5s`, and `deliver` fan-out mapped onto the brief. Seed `starter-m3.log` replayed idempotently once unreadCounts were readable by senders.

Fought: Expo web composer vs Playwright. Native `<form>` send worked once, then remounts emptied controlled fields. Sender unread unique conflicts (`E_CONSTRAINT` on `unreadCounts`) until the read rule included fellow members. Starter group “Weekend Plans” also contains Erin, so aggregate receipts wait for a fourth member the harness does not drive.

Prior familiarity: WhatsApp-style receipts and quoted excerpts. Snapback 2 `retain delivered-history` is the right primitive for removed-member local history.

Missing: schedule-target mutations are not client-callable (`E_OPERATOR_REQUIRED` on `dropTrending`). Thread queries that join full `image` columns blow the 4 MiB maintained-address ceiling, so media is a second query.

Compared with Convex/Supabase: channels + ttl replace a presence table I would have hand-rolled on Convex. Write-rule races on unique indexes are closer to RLS surprises on Supabase than to Convex’s “run as the user” mutations.

## M4–M6 / M8 (suites only)

M4–M6 and M8 suites ran on the same owner: photo/video send, reaction replace/remove, edited flag, view-once first/second fetch, people/in-chat/global search, push log + Photo preview, custom-client demo, sample-50 replay, insights totals, trending hide. Web choreography for those milestones was not run because M3 choreography never went green. Scale.log was not replayed on a fresh instance. Simulator proofs were not installed.

Felt easy once the owner mutations existed: the suite is the same `createClient` path as seed. Fought: Expo web remaining the gate for green, and schedule-target mutations disappearing from the client map.
