# Diary 0084: Clique 0.1.21 InstantDB exploratory lane

**Date:** 2026-08-14

**Run:** Clique 0.1.21 exploratory sweep on the Durand M4 Pro Mac mini

**Raw lane artifacts:** `/Users/ccheever/clique-0121-20260814/lanes/sol-instantdb/`

**Lane:** `sol-instantdb`

**Model:** GPT-5.6 Sol, high effort

**Backend:** InstantDB 1.0.65

This is N=1 exploratory evidence for lane `sol-instantdb`. It is not scored, claim-eligible, or a promotion/default decision.

## M1 — Accounts and profiles

Built password signup/sign-in, persistent Instant sessions, logout, unique handles/emails, full profile editing, and fixture avatars. The managed realtime query path felt unusually direct: Bob observed Alice's profile edits in roughly 0.3–0.6 seconds without subscription plumbing. The hard part was authority rather than sync. InstantDB 1.0.65 has no built-in password credentials, so the documented custom-auth path required a small Node adapter, an admin token, scrypt hashes in a client-invisible namespace, and server-issued Instant refresh tokens. Official backend/auth docs saved time by stating that limitation plainly and documenting `createToken`/`signInWithToken`.

Two self/tooling corrections were needed: the login component initially left a newly authenticated user on `/settings`, which hid every harness-recognized authenticated surface, and the generated Expo scaffold retained NativeWind/Babel assumptions after simplification. The first iOS export also found that the copied frozen kit included its own development dependency tree; it was moved to Trash so Metro uses one React Native. Backend-specific friction: every password-auth mutation crosses the admin adapter, but realtime reads remain permission-checked Instant client subscriptions. M1 finished green with suite 7/7 and implemented choreography 3/3.

## M2 — Posts and follow graph

Built cumulative fixture replay, Following and Global feeds, text/image/video-shaped post records, pagination, profile-to-feed navigation, follow edges, live likes, repost attribution, direct-reply threads, and URL link behavior. Instant's broad client query made cross-browser projections easy to express: one subscribed graph of profiles, posts, follows, likes, and reposts was enough for both feeds, and remote writes appeared without explicit invalidation. The package types and frozen UI source were more useful than prose here; the missing documentation was guidance on transactionally toggling a scalar-ID relationship through an authoritative server path.

The route lifecycle fought the harness. A profile-only screen did not preserve feed navigation, and the web stack retained an inactive home composer with the same contracted test ID as the reply composer. Persistent frozen FeedTabs plus focus-aware rendering repaired those presentation contracts. A subtler ownership race came from computing `set: !liked` in a stale client render: rapid second clicks sometimes repeated the first write. The workaround was to keep explicit `set` for idempotent acceptance/seed operations but let the UI toggle endpoint derive current state from Instant before transacting. That extra read is safe for this reduced workload but is not a high-contention compare-and-swap primitive. The first static choreography invocation also pointed at the fixture parent directory, and Metro's lifecycle instability prompted a stable static Expo proof server. M2 finished green with suite 22/22, implemented choreography 7/7, and two optional media checks honestly unimplemented because the frozen composer exposes no media-picker control.

## M3 — Core messaging

Built deterministic pair-keyed DMs, distinct groups with identical member sets, active membership and admin authority, live ordered messages, quoted replies with excerpts and jump affordances, typing expiry, and receipt-shaped records. The happy path was compact: chat, membership, message, and typing entities joined by scalar IDs and consumed through the same live query already powering the feed. The starter replay stayed idempotent and the same Alice/Bob DM was reused. Instant's live delivery made bidirectional messages and quote projection straightforward; no websocket lifecycle code was necessary.

Authority again lived outside the client. Membership writes and message authorization go through the Node adapter because the rule surface alone was not a comfortable place to express active-member/admin checks over these scalar joins. That split is explicit but creates an operational component beyond the managed database. Typing used expiring Instant records plus client-side time filtering. It passed best-of-three, but the first two attempts missed the five-second disappearance boundary by a narrow scheduling margin; the third observed appearance in about 1.4 seconds and expiry in about 4.9 seconds. A production design should add backend cleanup and more expiry margin. Frozen choreography had no semantic controls for sender avatar, receipt state, group receipt aggregation, or member removal, so those four checks remain optional/unimplemented rather than inferred from glyphs. M3 finished green with suite 7/7 and raw implemented choreography 3/3.
