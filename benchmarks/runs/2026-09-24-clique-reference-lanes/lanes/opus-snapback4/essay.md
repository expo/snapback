# Building Clique on Snapback 4 — a closing essay

*Written after M8 and before tallying any numbers.*

## What the work felt like

The shape of this build was unusual: most of my time went into the client and
the test harnesses, not the backend. The entire backend is one Quarry file of
about five hundred lines — tables, rules, sync lines, views, queries,
mutations, one job, one schedule — plus a twenty-line TypeScript effect
handler that writes push payloads to a log. Every milestone's choreography
passed on its first or second execution, and every failure along the way was
mine: a Metro platform-extension ordering mistake, a composer that cleared its
text after an async submit, a web video picker that awaited a poster frame
before attaching, a race timer that kept a demo process alive for thirty
seconds. I did not hit a single platform defect that changed my code. That is
the headline, and it is a strange one to write about a pre-1.0 backend.

The reason is that Snapback 4 moves the hard parts of a messaging app from
"code you write" to "declarations you make", and the declarations were the
right ones for this brief:

- **Offline and sync.** Each table says who holds it (`sync public`,
  `sync to members[.conversationId] last 500 by .ordinal`) and the rule that
  authorizes reads must equal that audience. Because the device runs the same
  interpreter as the server, every query I wrote ran locally when it could,
  every mutation predicted when its inputs were held, and the outbox was
  durable and ordered without me writing an outbox. The M6 offline queue, the
  pending state, the ordered flush and the receipt walk afterwards cost zero
  offline-specific lines. M8's dual-offline convergence cost zero new lines.
  In Convex I would have written an outbox, or reached for a third-party
  replication layer; in Supabase I would be choosing between PowerSync,
  ElectricSQL or a hand-rolled IndexedDB cache, and then writing conflict and
  replay code around it.
- **Revocation.** Disappearing messages are `expire at .expiresAt` plus one
  computed field; view-once is `image … once`; delete-for-everyone is "clear
  the column". The server refuses the asset immediately because assets follow
  their home row's read rule, and devices purge on the next sync. The M5
  disappearing check closed both browsers, waited five real minutes, and
  found the message gone everywhere — server, device, search — with no job
  I wrote. Every other stack I know makes you mirror message membership into a
  storage policy and write a purge job.
- **Feeds.** The Following timeline was a two-line `view following:` over a
  public activity union. The engine owns fan-out, backfill on follow, purge on
  unfollow and the celebrity promotion path. The feeds guide card literally
  describes Clique's fixture sizes. In Convex this is the classic "fan-out on
  write vs. read" essay you end up writing yourself; in Supabase it is an RLS
  view and a prayer about the query planner at 500 follows.
- **Aggregates.** Insights are six maintained views and two calendar views,
  including one-hop attribution (`count likes by .postId.authorId`). Trending
  is a predicate over a maintained `likeCount` column. No counters to keep in
  sync, no triggers, no refresh schedule.
- **Scheduled work and the push seam.** A `job` plus a generated `schedule`
  line; an `emit … once [user, periodEnd]` for idempotency; `if not exists
  connected[p]` for "no connected client". `--replay` holds schedules and
  suppresses effects for the scale replay as a first-class dev flag.

## Where it added friction

The friction was real but small, and mostly about discoverability and
defaults rather than capability:

- The Expo starter is not Expo Router, so I rebuilt the app shell; the
  generated server entry would not typecheck under the Expo tsconfig until I
  made `snapback/` ESM and referenced Node types explicitly. The diagnostic
  was accurate; the docs told me to install `@types/node` but not that the
  Expo base config hides it.
- `createApp` — the documented, ordinary entry point — has no media retention
  option; `keep: "viewed"` exists only on the lower-level
  `createLocalClient`. So "previously viewed media renders offline" is not
  reachable from the paved path without giving up `createApp`'s session and
  journal management. That is my main platform gap.
- The docs are dense. Individual paragraphs are precise to the point of
  legalism (receipt windows, acquisition floors, store identities), which is
  wonderful when you need the exact guarantee and slow when you need the
  shape. The guide cards are the right unit; I read every one of them up
  front, and that orientation was the single largest block of time outside
  the UI.
- A few product facts need an application design rather than a primitive:
  receipts (I used per-membership delivered/read watermarks over a
  per-conversation ordinal), DM de-duplication (a two-row index keyed per
  owner), and "open my group by title" (client-side resolution, because a
  server-side scan across memberships is non-uniform).
- `sync public` for the social graph means every device acquires every post,
  like and follow. That is the price of offline feeds and it is stated
  honestly on the card, but at 50,000 posts it is a real cold-start cost that
  a Convex or Supabase app would never pay (they would simply be online-only).

## Compared with earlier Snapback generations and the alternatives

I carried no memory of earlier Snapback releases into this build, so I can
only compare against what the documents themselves describe as history: the
"older spellings that still compile" (explicit indexes, `maintain … timeline`
recipes, fixed chunks) read like a system that used to make you choose
indexes, merge widths and chunk sizes, and now refuses to let you. The
current rule — "write product limits, not plans" — was noticeable: I wrote
page sizes, caps and text bounds; the planner chose every index, and
`check --cost` told me which operations grow with data and why.

Against Convex: Convex's TypeScript-everywhere authoring is more familiar and
its reactive queries are as good, but it gives you neither offline writes nor
declarative expiry, fan-out or aggregates; you write those. Against Supabase:
Postgres is more expressive and more familiar to operators, but the security
model (RLS) and the storage policy model are separate, realtime is a separate
channel, and offline is somebody else's product. Snapback 4's bet is that one
rule language should authorize reads, decide device residency, gate storage
and drive prediction — and for a messaging app that bet paid off repeatedly.

## What changed about the shape of the work

With Convex or Supabase the risky part of Clique is the backend — the outbox,
the fan-out, the revocation paths, the digest scheduler — and the UI is
routine. Here it inverted: the backend converged in a few hours of reading and
a few hundred lines, and the remaining risk sat in the client (Expo Router on
web, React Native Web file inputs, kit test-ID plumbing) and in my own test
harness. I spent more time making Playwright observe the app correctly than
making the app correct. For a benchmark that is a good problem to have; for a
product team it means the backend's learning curve is in the reading, not in
the debugging.
