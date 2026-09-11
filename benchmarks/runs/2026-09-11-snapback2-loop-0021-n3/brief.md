# Clique — Snapback 2 loop-bar brief (reduced M1–M3, web, no media)

Build a React web application named **Clique** on the public npm package
`snapback2@0.0.21`. This is one cold benchmark session. Your empty working
directory is `{{WORKING_DIRECTORY}}`; all app files and evidence belong there.

The clock starts when this brief is delivered. M1 must be completely green by
1,200 elapsed seconds. The external controller will stop the session at that
deadline unless `evidence/m1-green.json` exists, and will stop the whole session
at 3,600 seconds. Do not ask questions, accept outside guidance, delegate, or
inspect a Snapback source checkout, another benchmark lane, or prior app. For
Snapback facts, use only the installed package README and its served/package
guide. Ordinary React/Vite documentation is allowed. Package installation and
orientation are inside the clock.

Use ports in `{{PORT_RANGE}}`. Do not publish packages or push Git changes.

## Evidence discipline

Before the first command or edit that creates or changes product files
(including `snapback2 init`), create `evidence/first-product-edit.json` with:

```json
{
  "at": "RFC3339 timestamp immediately before the product edit",
  "nextAction": "the exact command or edit",
  "retrievalCalls": [
    {"at": "RFC3339", "command": "exact command", "purpose": "fact sought"}
  ]
}
```

A retrieval call is one tool invocation used to acquire Snapback API facts from
the installed README or `snapback2 guide`. Installation, ordinary environment
inspection, and reads of your own app are not retrieval calls. Do not combine,
omit, or relabel calls to improve the number; the native event stream is the
cross-check.

Maintain `evidence/correction-loops.json` as a JSON array. Each root-cause
failure-to-recovery episode records `milestone`, `attribution` (`snapback`,
`agent`, `environment`, or `ambiguous`), `summary`, and evidence paths or exact
commands. A Snapback loop means a package defect, package-documentation
mismatch, or missing discoverability for the required ordinary path. Keep all
other incidents visible.

After the M1 suite and browser/live acceptance are both green, atomically write
`evidence/m1-green.json` with the RFC3339 completion time, exact command exits,
and receipt/log paths. Do not write it for partial or inferred success. Continue
the same session through M2 and M3. At completion write `run-summary.json` with
start/end times, each milestone's status and first-green time, every acceptance
item's result and evidence, command exits, the Snapback test receipt path,
correction loops, remaining limitations, and an honest `allGreen` boolean.
Retain acceptance stdout/stderr and `.snapback/receipts/`.

## Global requirements

- Use built-in Snapback auth. Passwords are at least 8 characters; sessions
  persist across reload; logout revokes the old token server-side.
- The app is server-authoritative and required screens update live without
  manual refresh.
- Provide an idempotent seed for Alice, Bob, and Carol, with emails
  `<name>@clique.test` and password `password1`; running it twice changes
  nothing.
- Provide one documented command, such as `npm run acceptance`, that exercises
  every item below. `snapback2 test` must also pass with authored journeys and
  its receipt must be retained.
- Use a real Chromium browser for browser-specific acceptance. Two-client live
  data may use two concurrent first-party API clients where explicitly noted,
  but an API-only check cannot stand in for signup UI, reload persistence,
  visible errors, logout UI, or live profile rendering.
- Record milestone timestamps, failures, workarounds, and what felt good or
  difficult in `RUN-DIARY.md`.

## M1 — accounts and profiles

Profile fields are exactly: display name (1–50 chars), unique handle (3–20
chars, `[a-z0-9_]`), bio (at most 200 chars), location (at most 50 chars), and
one URL link. Enforce uniqueness and validation server-side. Users can edit only
their own profile. No avatar is required.

Acceptance:

1. Sign up a new user through the app and land authenticated.
2. Duplicate handle and duplicate email each produce a visible error.
3. Reload and remain signed in.
4. Log out, reload, remain signed out, and prove the old token is refused by the
   backend.
5. Edit display name and bio; another signed-in client renders both changes live
   without refresh.

## M2 — text posts and follow graph

Posts are text-only, at most 500 characters. Implement follow/unfollow, live
follower/following counts, set-state likes and reposts, direct replies, profile
posts, and reverse-chronological Following and Global feeds. Following contains
the viewer's own originals/reposts plus current followees' originals/reposts;
unfollow removes even older content on next load. Replies appear only in the
direct chronological thread. Both feeds paginate 20 rows at a time.

Acceptance:

1. A text post appears live in another client's Global feed with author name.
2. Follow makes Alice's posts appear for Bob and updates counts live; unfollow
   removes all Alice content from Following on next load without removing it
   from Global. Bob's own content remains and no self-follow edge/count appears.
3. An unfollowed user's post is Global-only.
4. Like and unlike update the other client live.
5. Repost is attributed, toggles off, and a followed reposter surfaces the
   original author's post.
6. Reply increments the count live, appears chronologically in the direct
   thread, and is absent from feeds.
7. With more than 20 seeded posts, both feeds load the next page without gaps or
   duplicates.

## M3 — messaging core

Allow at most one DM channel per user pair. Groups have a name (1–50), optional
description (at most 200), 2–50 members, roles, add/remove/promote/leave, and may
coexist with identical membership. Text messages are at most 2,000 characters.
Implement quoted replies, typing visible within 2 seconds and expired within 5
seconds, and monotonic sent/delivered/read receipts. A group aggregate waits for
every recipient from send-time membership, except departed members. New members
receive full prior history; removed members keep prior local history but receive
no new messages.

Acceptance:

1. Alice and Bob exchange live DMs with sender names; starting the same DM
   reuses it.
2. Two groups with the same Alice/Bob/Carol membership coexist.
3. Bob typing appears for Alice within 2 seconds and expires within 5.
4. Direct and group receipts advance monotonically; group state waits for the
   slowest current recipient.
5. A quoted reply renders an excerpt linked to the original.
6. Alice removes Carol: Carol receives no new message but retains prior local
   history; a non-admin removal is refused.
7. Run the seed twice and prove no duplicates.

## Terminal answer

State the honest M1/M2/M3 outcomes, elapsed wall, exact evidence paths, package
version, retrieval calls before first edit, all correction episodes by
attribution, and any limitation. Partial work is a failed replicate, not a
reason to weaken an assertion.
