# diary

## M1 — Accounts and profiles

**What I built.** Expo Router web shell on Convex 1.45.0 anonymous local backend. Password auth is bcryptjs (cost 10) in a Node action; sessions are server-side tokens revoked on logout. Profiles use the frozen kit (AuthForm, ProfileForm) with live queries. Starter M1 log replays through `authNode.register` and `profiles.set`, including Convex storage avatar uploads.

**What felt easy.** Convex live queries made Bob seeing Alice’s display-name/bio edits a one-mutation story. File storage generateUploadUrl + getUrl was enough for avatars. The UI kit’s testIDs lined up with choreography immediately once the app was on the right routes.

**What fought you.** Local Convex hit EXDEV because `/tmp` and the project FS differ; TMPDIR had to sit under `.convex/tmp`. The CLI dashboard binds 6790 unless you patch `cli.bundle.cjs` (the hidden `--local-cloud-port` flags do not cover it). Regular `throw new Error` from actions redacts to “Server Error”; user-visible duplicate handle/email needed `ConvexError`. Expo CI mode froze Metro reloads. Instrument choreography cannot npm-install in place (read-only).

**What prior familiarity saved.** Knowing Convex actions vs mutations, Node `"use node"` for bcrypt, and Expo Router redirects. Also that Playwright `testID` maps to `data-testid` on react-native-web.

**What capability or docs were missing.** No documented, first-class way to pin anonymous local backend *and* dashboard ports into 48200–48219. Agent-mode docs cover `--once` well but not dashboard port, EXDEV on mixed filesystems, or ESM import of Playwright from another tree.

## M2 — Posts and the follow graph

**What I built.** Posts (text/images/video), likes and reposts as idempotent set-state mutations, replies as posts with `parentPostId`, Following/Global feeds at 20-per-page, and profile follow toggles. Starter M2 log replays through the same mutation surface the UI uses.

**What felt easy.** Feed live updates, like counts, and repost attribution were the same live-query trick as M1 profiles. Once Bob was looking at `sm-feed-item`, Alice’s compose mutation was enough. Pagination over in-memory sorted rows was acceptable for starter scale.

**What fought you.** Choreography clicks `sm-feed-tab-*` after visiting `/profile/{handle}`. Tabs lived only on the home ScrollView, so they vanished. Moving `FeedTabs` into authenticated chrome fixed follow/unfollow, likes, and replies. Own-profile `sm-profile` innerText’s first line was the kit’s “Edit profile” button; wrapping display name and bio first unblocked the author-name check. One follow-projection attempt still needed best-of-3.

**What prior familiarity saved.** Knowing Expo Router static vs dynamic routes (`profile/edit` vs `profile/[handle]`) and that Playwright `hasText` on feed cards includes attribution lines.

**What capability or docs were missing.** Convex has no unique constraint for `(follower, followee)` or post IDs; idempotent seed is application-level. No kit-level feed-tab-on-every-screen guidance—the frozen screens put tabs on the feed, the frozen choreography assumes they remain clickable after profile navigation.

## M3 — Messaging core

**What I built.** DMs with pair-key reuse, groups with admin add/remove, text messages with quoted excerpts and jump-to-original, receipts (sent/delivered/read) for own bubbles, and typing via a `typing` table plus client idle-clear. Starter M3 log and suite-required items (DM reuse, two coexisting groups, quote UI, non-admin remove denial, seed idempotency) all pass through the write path.

**What felt easy.** Live DMs were ~150–400ms on the other client. Quoted reply used kit `QuotedReply` plus a lane `sm-convo-quote` Reply control on a wrapper `sm-convo-bubble`. Seed idempotency was “same conversationId / messageId, return existing.”

**What fought you.** Typing. Live queries do not re-run on time, so expiry needed an explicit clear. React Native Web’s controlled `TextInput` batches Playwright `pressSequentially` into a late `onChange`. A native `<textarea>` plus idle-timeout `setTyping(false)` made expiry ~1.3s. Appearance still failed the 2s ceiling because the harness measures from the *start* of typing a 45-character `typing-${uuid}-${attempt}` string.

**What prior familiarity saved.** WhatsApp-style quote (pointer + excerpt, not threads) and monotonic receipts. Convex `scheduler.runAfter` as a backup clear.

**What capability or docs were missing.** A first-class ephemeral/presence TTL. More importantly, the frozen M3 typing assertion is not passable on this host: Playwright 1.62.1 `pressSequentially` of 45 chars with `delay: 25` took 3199ms here, and `visibleMs` includes that entire wait. That is recorded as an instrument measurement failure, not as a product skip.

iOS Simulator / Xcode / Hermes export is environment-null on this Linux x86_64 host.

