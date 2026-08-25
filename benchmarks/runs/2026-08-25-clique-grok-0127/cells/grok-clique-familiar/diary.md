# Diary — grok-clique-familiar

## M1 — Accounts and profiles

Built email/password sessions on Snapback's built-in auth (`defineAuth` + `auth: { mode: "sessions" }`), a public `profiles` table keyed by `ownerId: v.principal()`, handle uniqueness, avatar upload via `defineAssetUpload`, and Expo Router screens wired to the frozen Clique UI kit. Starter log `starter-m1.log` replays through `signUpWithPassword` / `upsertMine` / asset upload. Suite and M1 choreography are green.

What felt easy: the familiar TypeScript constructors (`query` / `mutation` / `useQuery` / `useMutation`) mapped cleanly onto a Convex-shaped mental model. Codegen from `schema.ts` plus top-level modules was one command. Live profile edits just worked once the mutation actually committed.

What fought me: supervised Expo web injects `EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN` and mints an ambient session, but does **not** inline `EXPO_PUBLIC_SNAPBACK_URL`. Adopting that mint made choreography miss `sm-auth-email`; signing it out crashed the provider with `SNAPBACK_AUTH_SESSION_EXPIRED`. URL-first `SnapbackProvider` using the supervisor bootstrap's `binding.target.origin` (and ignoring the minted bearer) was the working landing. Also: RN-web showed the profile editor before `getMine` seeded, so choreography saved an empty handle.

Familiar profile saved: `query`/`mutation`/`useQuery` spelling, generated `api.profiles.*` namespace, durable custody by default (session persist on reload). Still Snapback-specific: explicit `auth` on every function, `reads`/`writes` sets, `ctx.assets.attach`, `ctx.refuse`, codegen.policy.json opt-in, and the supervised Expo rendezvous vs URL-first split.

Missing docs/diagnostics: the familiar page still says `_generated/` in some older briefs while 0.1.27 refuses that directory; supervised web does not document that `EXPO_PUBLIC_SNAPBACK_URL` is absent; `SNAPBACK_AUTH_STALE_RESULT` guide lookup pointed at an unrelated assets page.

## M2 — Posts, follows, feeds

Built `posts` / `follows` / `likes` / `reposts` with unique client and pair indexes, `posts.create` (text, images, video, replies), `follows.set`, `social.setLike` / `setRepost`, and following/global/thread queries with cursor pages. Replay of `starter-m2.log` goes through the same mutations as the UI. Expo Router: feed tabs in AppChrome, `FeedList` as ScrollView+map (FlatList hid items on RN-web), thread route with composer on top, `router.replace` so the stack does not accumulate hidden copies. Suite and M2 choreography green. Additive schema successor from M1 kept the original sqlite; identities recorded in run-log.

What felt easy: once posts and follows existed, live like/repost counts and Following projection were ordinary `useQuery` subscriptions. Fixture replay of follow/post/like/repost/reply was mechanical. The frozen FeedCard/FeedTabs/Composer contracts were enough surface for the required two-client checks.

What fought me: Metro died on generate (`SNAPBACK_EXPO_METRO_EXITED`, ENOENT on a codegen tmp dir) — restarted the same `snapback dev` against `dev.sqlite3` with no reseed. `router.push` stacked dozens of feed copies so thread compose timed out on a hidden input. Bob still followed Dave from the seed, which broke the "unfollowed author absent from Following" assertion until the suite used Frank. Image/video compose choreography is skipped by the frozen harness (no media-picker test ID).

Familiar profile saved: `api.posts.*` / `api.social.*` namespaces, live feed without a custom socket. Still Snapback-specific: `reads`/`writes` on every function, `ctx.runtime.now()`, unique pair indexes as uniqueness, asset upload intents for image/video, and the Metro-watcher fragility across generate.

Missing docs/diagnostics: generate vs Metro file watching is not called out as a restart-the-owner event; no guidance that Expo Router stack + RN-web FlatList will hide the only composer the harness can see.

## M3 — DMs, groups, messages, typing, quotes

Built `conversations` / `members` / `chatMessages` plus `defineEphemeral` typing, with `chats.dmOpen` (pairKey reuse), `groupCreate` (clientId idempotency), `memberAdd` / `memberRemove` (NOT_ADMIN), `send` (clientId + optional quote), `list` / `messages`. Starter-m3.log replays through those mutations. UI: ChatListRow strip in AppChrome so choreography can open a DM from the feed (no `sm-nav-chats` in the contract), ConversationScreen with kit MessageBubble / QuotedReply / TypingIndicator / message Composer, quote jump via `scrollIntoView`, Reply as lane-owned `sm-convo-quote` inside the bubble wrapper. Suite required IDs and M3 choreography green (live DM, typing 2s/5s, quoted excerpt+jump; receipts/avatar/member-removal skipped as unimplemented by the frozen harness).

What felt easy: DM reuse and group coexistence were ordinary unique-index / pairKey handlers. Quote excerpt is just a self-join on `chatMessages`. The kit already owned `sm-convo-quote-preview` and `sm-convo-typing`.

What fought me: `@expo/snapback-expo` activity presence needs an Expo lifecycle context the URL-first provider does not have — use `@expo/snapback-react` instead. `touch()` on every keystroke starts a new presence generation and cancels the in-flight publish; publish once on typing start and idle-stop locally. Native key listeners on the same component as the controlled Composer disabled `sm-convo-send` by force-rendering an empty `value`. Worst: each keystroke in ConversationScreen re-rendered AppChrome + the full chat list, making Playwright `pressSequentially` of `typing-${uuid}-n` take ~2.7s, which is already over the 2s appearance ceiling *before* the indicator is observed. Isolating `MessageComposer` dropped that to ~1.4s and typing went green. Second Metro death after M3 generate; same sqlite restart, no reseed.

Familiar profile saved: `useQuery` on `chats.messages` is live across two contexts with no extra work; mutation constructors matched M1/M2. Still Snapback-specific: ephemeral collections, activity-presence generations, the Expo-vs-core hook split, and schema-successor hashes on the running owner.

Missing docs/diagnostics: activity presence "gated" vs ungated; that `touch()` is generation-fenced; that supervised Expo presence is unusable without `SnapbackExpoProvider`; no warning that a 2s typing SLO is measured after `pressSequentially` of a 45-character run id.
