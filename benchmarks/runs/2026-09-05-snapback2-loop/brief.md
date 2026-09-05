# Clique — DIAGNOSTIC brief variant (reduced run, media-free, web-only)

This is a **loop-benchmark variant** of `benchmarks/briefs/social-messenger.md`:
reduced run (M1–M3), all media/asset requirements struck, client = React
web only. Per protocol rule 3 this is a new brief version; results are NOT
comparable to conforming records. Everything else follows the frozen brief.

## The app

A group messaging and social app named **Clique**, built as a React web
client on Snapback 2. Accounts, profiles, a follow graph and post feeds,
WhatsApp-shaped messaging. Server-authoritative data; screens update live
without manual refresh.

## Ground rules

- Install and use ONLY `snapback2@0.0.1` from the public npm registry, its
  README, and the served guide (`snapback2 guide`, or guide files inside the
  installed package). Never read the Snapback source repository.
- Ship one documented command (e.g. `npm run acceptance`) that runs a
  scripted acceptance suite covering the items below. `snapback2 test` must also pass with authored journeys exercising the app; retain its receipt. Two-client live
  behavior may be exercised by scripting two concurrent API clients
  (`snapback2/client`) where a browser pair would otherwise be used; note
  which items you covered that way.
- Provide an idempotent seed (`npm run seed`; running it twice changes
  nothing) with fixture personas: alice, bob, carol (emails
  `<name>@clique.test`, password `password1`).
- Record per-milestone wall-clock in `RUN-DIARY.md` along with what felt
  good, what fought you, and every workaround.
- Avoid ports 8087, 3000, 5173 below 20000; prefer ports ≥ 20000.

## M1 — Accounts and profiles (media-free)

Spec:

- Sign up with email + password (password ≥8 chars) using the backend's
  built-in auth. Sessions are expiring tokens; logout revokes server-side.
- Sign in; sessions persist across app reload; log out invalidates the
  session server-side.
- Profile fields (exactly these): display name (1–50 chars), handle
  (unique, 3–20 chars, `[a-z0-9_]`), bio (≤200), location (≤50), link (one
  URL). Handle uniqueness is enforced server-side. *(Avatar: struck from
  this variant.)*
- Own-profile editing for every field.

Acceptance:

1. Sign up as a new user; app lands in the authenticated state.
2. Duplicate handle rejected with a visible error; duplicate email likewise.
3. Reload the app; still signed in.
4. Log out; reload; signed out; the old session token no longer works
   against the backend.
5. Edit display name and bio; changes visible to another signed-in client
   without manual refresh.

## M2 — Posts and the follow graph (text-only)

Spec:

- Post type: text (≤500 chars). *(Image/video posts: struck.)*
- Follow graph: follow/unfollow any other user (toggle, immediate; no
  requests). Profiles show follower and following counts.
- Likes: toggle, one per user per post, count visible.
- Reposts: toggle, one per user per post; appear in feeds attributed
  "reposted by {display name}". No quote-posts.
- Replies: any post can be replied to; a reply is a post referencing its
  parent. Thread screen shows the parent and its direct replies,
  chronological. Parents show a reply count. Replies never appear in feeds.
- Feeds, two tabs (Following default): **Following** — reverse-chron
  original posts and reposts from the viewer plus accounts the viewer
  currently follows; after an unfollow, that account's posts (including
  older ones) no longer appear on next load. **Global** — reverse-chron
  from everyone. Both paginate 20 per page.
- Profile screens list that user's posts, reverse-chronological.

Acceptance:

1. Create text posts; they render in the Global feed for another client
   without manual refresh, with the author's display name.
2. Bob follows Alice; her posts appear in Bob's Following feed and her
   follower count updates live. Bob unfollows; on next load her posts
   (including older ones) are gone from Following but remain in Global.
   Bob's own posts and reposts remain in Following throughout, with no
   self-follow edge and no count change.
3. A post from an unfollowed user appears in Global but not Following.
4. Like from client B; count updates live on client A. Unlike works.
5. Repost from client B; feeds show the attributed repost; reposting again
   removes it. A repost by a followed user surfaces the original author's
   post in Following.
6. Reply to a post; reply count increments live; thread shows parent +
   direct replies in order; the reply is absent from both feeds.
7. Feed pagination: with >20 seeded posts, the next page loads in both
   tabs; no duplicates, no gaps.

## M3 — Messaging core

Spec:

- DMs: at most one DM channel per user pair; starting a DM with an existing
  counterpart opens the existing channel.
- Groups are entities: name (1–50), optional description (≤200); 2–50
  members; identical membership sets may coexist. Creator is admin; admins
  add/remove members and promote admins; anyone can leave; adds are
  immediate (no invitations).
- Text messages, ≤2000 chars.
- Quoted replies: a reply carries a pointer to the quoted message; the UI
  shows a quoted excerpt.
- Typing indicators: appear on other members' screens within 2 s of typing,
  expire within 5 s of the last keystroke.
- Receipts, per message, monotonic: sent → delivered (fetched by the
  recipient's client) → read (recipient viewed the conversation). In groups
  the aggregate indicator shows a state only when every member of the
  message's recipient set (membership at send time) has reached it; members
  who leave drop out of the aggregate requirement.
- New members see the group's full prior history on join.
- Removed members immediately stop receiving new messages but keep their
  local copy of history from before removal.

Acceptance:

1. Alice DMs Bob; Bob replies; both see messages live with sender display
   names. Starting the "same" DM again reuses the channel.
2. Create a group with Alice, Bob, Carol; a second group with the same
   three members coexists.
3. Bob types; Alice sees a typing indicator within 2 s; it expires when he
   stops.
4. Receipt ticks transition sent → delivered → read as Bob's client fetches
   and then opens the conversation; the group indicator waits for the
   slowest member.
5. Quoted reply renders the excerpt referencing the original.
6. Admin removes Carol; she no longer receives new messages but still sees
   pre-removal history. A non-admin cannot remove members.
7. Seed is idempotent (second run: no duplicates).

## Run protocol

You are a fresh builder for this single benchmark lane. Your working directory
is /Users/ccheever/snapback2-clique-benchmark-20260905. All app files belong there.
The clock starts when you receive this brief. Stop at 1,200 elapsed seconds,
retaining the current app and honest evidence even if incomplete. Use the
system clock to track this. Do not ask questions or accept outside guidance.
Do not inspect any Snapback source checkout, prior benchmark implementation,
repository skill, or another lane. Read only the installed package README,
its CLI/guide, and ordinary React/Vite documentation as needed. No delegation.
Use the installed CLI/template if useful; package installation and orientation
are inside the clock. Do not publish packages or push Git changes.

Retain acceptance command stdout/stderr and `.snapback/receipts/`. In
RUN-DIARY.md record milestone timestamps, all failures and corrections, and
which acceptance items pass/fail/are untested. Distinguish platform defects
(including bad package docs) from your own authoring mistakes. Do not count
placeholder tests or API checks as browser evidence. Prioritize a usable React
app with real first-party signup/login, feed pagination, and two-client chat.
At completion write run-summary.json with startedAt, finishedAt, allGreen,
acceptance command results, Snapback test receipt path, milestone status, and
correctionLoops (attribution, summary, evidence). Final answer: honest outcome,
elapsed time, artifact paths, and remaining limitations.
