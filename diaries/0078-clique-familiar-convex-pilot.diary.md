# Diary 0078: Clique familiar profile versus Convex pilot

**Date:** 2026-08-13
**Demo:** reduced Clique social messenger, M1–M3
**Models:** GPT-5.6 Sol xhigh and Grok 4.6 xhigh
**Backends:** `snapback-familiar-ts-v1` at `e15064b46` and
`convex@1.44.0`

This was a calibration run, not a publishable magnitude run. The familiar
profile existed only in the Snapback source checkout; npm still exposed the
0.1.20 explicit closure. I intentionally retained that deviation because the
goal was to test the new authoring API immediately, but it means the Snapback
cells measure the new API plus an unreleased consumer/runtime closure.

## Sol on Snapback familiar

Sol built a sessions-authenticated Expo Router app with profiles, posts,
follow/like/repost state, threads, DMs, groups, receipts, typing, and quotes. All
M1–M3 suite assertions and required choreography checks finished green. The
application layer felt good: familiar schema and top-level functions were
readable; `ctx.db` operations, generated nested references, and familiar React
hooks kept UI, replay, and acceptance on one typed surface. Once it was running,
the M2 feature loop felt remarkably close to Convex.

The first milestone was dominated by everything around that application layer.
The published runtime correctly refused the new artifacts. The source carrier
needed a matched Hermes framework and qualification, file-linked packages split
the prepared React binding into separate module singletons, and the source
client rejected a generated dotted function reference until narrowly patched.
Those are source-closure defects or diagnostics, not the cost of writing a
profile function, but they were exactly the cost a source evaluator paid.

M3 exposed a more product-shaped problem. Typing initially wrote per keystroke,
and receipt projection/acknowledgement created a reactive feedback loop. After
that was reduced, a generated `take(4096)` still exceeded the runtime's 1024
limit and turned message subscriptions into explicit 400 refusals. The refusal
was useful and structured; accepting the impossible query at generation time
was not. Once bounded reads and incremental acknowledgements were in place,
live DM, typing, and quote choreography were green.

What remained unmistakably Snapback-specific was sessions artifact identity,
prepared binding custody, explicit auth ownership, table visibility, structured
refusals, protected live-query constraints, and client-owned expiry filtering
for clock-dependent typing. None of that made the familiar syntax bad; it did
mean that familiar syntax alone did not make the operational model Convex.

## Sol on Convex

The matched Convex build reached the same green M1–M3 boundary. Anonymous local
development came up with one command and no account, which made the setup
contrast stark. Convex still required the model to build password auth itself:
bcrypt lived behind a Node action, sessions were hashed/revocable rows, and
uniqueness was enforced in internal mutations. Snapback's built-in sessions and
password path was conceptually stronger here even though its source closure was
harder to launch.

Convex was delightful for the core benchmark shape. Mutations held invariants;
queries were live views; storage upload URLs handled media; and two clients saw
profile, feed, count, message, and typing changes without a separate transport
or cache layer. It did not decide product semantics such as repost identity,
membership-at-send, removed-member history, or group receipt aggregation. The
model still had to encode those choices explicitly.

The frozen UI and choreography generated several loops common to both
backends—linked package peer resolution, route state after profile navigation,
the profile component leading with “Edit profile,” and stable quote jumps.
Convex also developed a real loaded-chat typing regression after first green:
the controlled composer rerendered a large message list on every keystroke.
Splitting typing into a small query, throttling its heartbeat, and memoizing the
message list fixed it. Realtime removed invalidation plumbing, not query and
render economics.

The timing split was more informative than the total. Sol's M1 was 3,308
seconds on Snapback versus 1,213 on Convex; M2 was essentially tied at 594
versus 600; M3 first green was 1,005 versus 385. My read is that familiar
authoring delivered on its premise once the closure was live, while package
integration and a few Snapback-specific loaded-query limits still imposed a
large tax.

## Grok on Snapback familiar

Grok took a broader, more improvisational path. It built much of M1–M3 up
front, generated far more narrated/tool traffic, and independently hit several
of the same seams: no published familiar closure, Hermes/Expo transform issues,
dotted references, familiar live projection behavior, generated-file watch
loops, and the frozen profile text assumption.

Its M1 and M2 suites and required choreography eventually went green. One
especially useful M2 failure came from denormalizing feed rows into an
owner-scoped table. A writer could not see another owner's existing row before
a globally unique insert, so the runtime correctly refused the duplicate. Grok
replaced the fan-out table with read-time feed composition. The incident made
table visibility feel less like a declaration detail and more like a query
planning constraint that a familiar author must understand.

Grok did not green M3 choreography. The suite passed, but the frozen RN-web
message Composer repeatedly remained disabled or unstable after Playwright
filled it, live rerenders reset draft state, and two-client ephemeral typing was
not observed inside the two-second ceiling. Repeated retries did not change the
failure, so the retained result is honestly non-green. Some of this is generic
RN-web/UI integration, but the polling fallback Grok added around familiar
queries and its use of Snapback presence materially shaped the failure.

This lane also made a documentation gap concrete. The guide should have let an
author build and reload a source familiar Expo app without inspecting the React
projection source, reconstructing package singleton ownership, or inventing a
polling fallback. It also needs a proved two-browser Expo-web message Composer
and ephemeral typing example. That gap is recorded in
`issues/20260813-guide-gap-familiar-source-consumer-closure.md`.

## Grok on Convex

Grok's Convex control eventually reached a fully green M1–M3 boundary. The
anonymous local deployment was again a major advantage: one command provided a
backend and generated client URL without account or dashboard work. Grok wrote
the schema, password/session layer, feed and messaging functions, fixture
replay, acceptance adapter, and most of the Expo app as one broad initial pass.
Argon2 packaging, nested route paths, and Expo Router style handling caused M1
correction loops, but none required reconstructing a native carrier or client
artifact closure.

M2 initially failed both suite assertions and choreography. Moving feed tabs
into persistent shell chrome, making suite lookups independent of first-page
state, and wrapping the owner profile's frozen “Edit profile” ordering brought
all seven required browser checks green. These were mostly app/harness seams,
not Convex semantics. Live queries made text posts, follow projections, counts,
reposts, and replies straightforward once the visible routes matched the
contract.

M3 was the revealing control. Its first required DM check failed just as the
Snapback lane's had, but here the cause was a broad chat-row selector: a group
preview containing “Alice Alvarez” won the regex intended for the direct chat.
Sorting DMs first and removing sender names from group previews made required
DM and typing checks pass. An implemented optional quote assertion still gated
the segment, so every bubble gained an explicit quote action and the final run
went green. Thus Grok could stabilize the RN-web choreography; the Snapback
failure was not simply “Grok cannot build M3,” though the two lanes had
different integration burdens by then.

The lane took 2,705 seconds end to end, emitted 119,074 output tokens, and used
104,151 reasoning tokens. Its Snapback lane took 10,098 seconds, emitted
223,282 output tokens, used 200,983 reasoning tokens, and still ended M3
non-green. Because the outcomes differ, those numbers describe the observed
cost of these two runs rather than a backend performance ratio.

## Exact and Contract

Neither backend cell used Exact or Contract as an application authoring layer.
Snapback's generated contract artifacts and structured diagnostics were
visible, but there is no separate Exact/Contract ergonomics claim to make from
this run.

## Final judgment

The familiar API is worth keeping. The code agents wanted to write was ordinary
and coherent, and Sol's M2 timing suggests the surface can make Snapback feature
work genuinely Convex-like. The highest-leverage next step is not more syntax;
it is publishing one qualified, matched closure and making codegen, client, and
runtime share function-name and query-limit rules. After that, repeat the full
LLP 0201 protocol with randomized order and multiple samples.

The consolidated timings, raw token fields, receipt outcomes, and caveats live
in `benchmarks/runs/2026-08-13-clique-familiar-pilot/record.md`.
