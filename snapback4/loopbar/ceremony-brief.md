# The ceremony bar: five Clique shapes on Snapback 4

You are a senior product engineer building a small production-shaped app from
scratch, alone and timed. Work fully autonomously; there is no human to ask.
Work only in the current directory. Do not read any Snapback source
repository or any prior implementation on this machine.

Use ONLY `snapback4@{VERSION}` from the public npm registry. The runner has
already installed that exact pin (`npm install --save-exact snapback4@{VERSION}`)
and its platform binary. Read `node_modules/snapback4/README.md` first, then
`npx snapback4 guide`, `npx snapback4 guide <keyword>`, `npx snapback4 why <CODE>`,
and the generated types (`snapback/generated/api.ts`, written by `check`).
Those and this brief are your entire packet. Do not inspect package implementation
files, use another backend, patch the package, use native Rust, or ask another agent.

Build one small Quarry backend under `snapback/` plus a headless Node client;
no UI. All five answers are computed in Quarry, including aggregation, ranking,
date buckets, receipt state and grouping. Node transports requests, generates
seed inputs, runs assertions and performs emitted effects; it does not compute
the application's answers from fetched rows. Choose your own tables, indexes,
maintains and helpers. Do not special-case personas, seed keys or the anchor in
answer logic. The seed is deliberately small; do not raise package ceilings.

## Fixed data and meanings

Use `use personas alice, bob, carol, dave, erin, frank, grace, heidi`. A persona
is `dev:<name>` on the wire. All eight have profiles. `active` is an explicit
profile boolean, true for alice, bob and carol only; it does not mean connected.
Let `A = 1789322400000` (2026-09-13 18:00:00 UTC), `D = 86400000`, `H = 3600000`.
Logical keys below are strings, independent of engine-minted IDs.

Create exactly 40 posts through your own mutations:

| Keys | Author | Kind / target | Created time |
| --- | --- | --- | --- |
| p01–p16 (i = 1…16) | repeat alice, bob, carol, dave | original, no target | A − i × H |
| p17 | alice | original | A − 2 × D |
| p18 | alice | original | A − 8 × D |
| p19 | alice | reply to p02 | A − 2 × D |
| p20 | alice | repost of p03 | A − 3 × D |
| p21 | bob | reply to p01 | A − D |
| p22 | carol | reply to p01 | A − 4 × D |
| p23 | dave | repost of p01 | A − D |
| p24 | erin | repost of p01 | A − 5 × D |
| p25–p40 (i = 25…40) | frank | original | A − (10 + i) × D |

Post text is `Post <key>`. For each p01–p16, install `floor((17-i)/3)` likes
at `A − H/2`; p17 gets 7 likes at `A − 2×D + H`; p18 gets 2 at `A − 8×D + H`.
For each post, take the first N personas in the declared order above excluding
its author. No other likes. Duplicate likes and self-likes are refused.
Follows: alice → bob, alice → frank, bob → alice, carol → alice, dave → alice.

Three chats, with no other memberships:

| Chat key | Members (first is admin) | Message keys | Author of all 20 |
| --- | --- | --- | --- |
| alpha | alice, bob, carol, dave, erin | a01–a20 | alice |
| beta | alice, frank, grace | b01–b20 | frank |
| gamma | bob, heidi | c01–c20 | heidi |

In every chat message j (1…20) has time `A − 60000 + j×1000`.
In alpha, j divisible by 5 has body `Launch lantern alpha`; otherwise j modulo
5 equal to 1 has `planning lantern alpha`; all others have `ordinary alpha note`.
In beta, multiples of 5 have `launch beta`, others `ordinary beta note`.
In gamma, multiples of 5 have `LAUNCH gamma`, others `ordinary gamma note`.
Initially no recipient has delivered or read a message. An author never counts
as their own recipient. Membership is current membership: leaving removes that
person from receipt aggregates and that chat from their search and digest.

## Five shapes and fixed wire contract

Expose the following bare operation names from `schema.q`. JSON below describes
the query's `data`, not its HTTP envelope. Lists in nested answers may be plain
arrays or the package's native page objects (`rows` plus page metadata); the
verifier unwraps pages but performs no sorting, grouping or arithmetic for you.
Extra object fields are allowed. All reads on this complete small seed must
report `complete: true` (including any nested page). Query arguments `at` are
explicit clocks for reproducible acceptance, not constants in the implementation.

1. `query insights(at: time)` for the viewer returns
   `{posts, likesReceived, repostsReceived, repliesReceived, followers, following,
   days: [{day, posts, likesReceived}, ...]}`. `posts` counts authored originals;
   likes received are likes on those originals, and replies/reposts received are
   posts targeting those originals. Totals are lifetime, independent of `at`.
   Days are seven UTC day starts, oldest first, including the day containing `at`;
   posts use creation time, likes use like time, no-activity days are zeros.
   At A, alice's six totals are **6, 21, 2, 2, 3, 2**. Her days' posts are
   **[0,0,0,0,1,0,4]**, likes **[0,0,0,0,7,0,12]**.
2. `query trending(at: time)` returns a list of `{key, likes, at}`: top ten
   originals created in `[at−D, at]`, like count descending, ties newest first
   (key ascending as final tie-break). At A the keys are p01…p10 and counts
   **[5,5,4,4,4,3,3,3,2,2]**. The older p17 with 7 likes is absent. Changing
   likes must change the ranking without client work or a manual rebuild.
3. `job digest(periodStart: time, periodEnd: time)` and a schedule `every 2m`
   emit an effect named `digest` once per active user per period, even at zero.
   Payload: `{targetUserId, periodStart, periodEnd, unreadMessages, unreadChats}`.
   Count all current messages from other authors not marked read by that user
   across their current chats; no creation-time filter. The period labels the
   snapshot, not a filter. Counts initially: alice **20/1**, bob **40/2**, carol
   **20/1**. No inactive user gets an effect. Re-running the job with identical
   arguments across a backend restart must not emit another effect. A following
   period emits again. A worker holding a service token must claim, observe and
   settle the real effects over the wire. Do not simulate delivery in a table
   or deduplicate duplicate backend emissions in the worker. Also prove an
   actual scheduled two-minute boundary fires; a manual job run alone is not enough.
4. `query receipt(messageKey: text)` returns `{state}` for a member. For a01,
   alice is sender; bob, carol, dave, erin are the four recipients. State starts
   `sent`; becomes `delivered` only after all current recipients delivered or
   read; `read` only after all read. A read implies delivery. State is monotone
   for an individual recipient. No recipients means `read`. Non-members cannot
   see or acknowledge the message. Prove three deliveries still say sent,
   the fourth says delivered, three reads still say delivered, then erin leaves
   and the aggregate becomes read. A read receipt affects only that message's
   unread contribution, not every message in the chat.
5. `query search(q: text)` returns a list of `{chatKey, messages: [{key, body, at}]}`,
   grouped by the viewer's current chats, chatKey ascending, newest first inside
   each chat. Empty groups are allowed (and ignored in comparison); nonempty
   groups must come from the backend. Use actual word-prefix search, case folded,
   every term required. At A, alice searching `lau` sees alpha a20,a15,a10,a05
   and beta b20,b15,b10,b05, no gamma. `lau lan` matches only those four alpha
   messages; `aunch` matches none. Bob sees alpha and gamma for `LAU`.

Also expose these ordinary application mutations for independent probes (seed
may use additional mutations). They must enforce the viewer's authority:

- `like(postKey: text, at: time)` inserts the viewer's like.
- `ack(messageKey: text, state: enum('delivered', 'read'))` acknowledges as viewer.
- `leave(chatKey: text)` removes the viewer's membership.
- `send(chatKey: text, key: text, body: text, at: time)` inserts a message as viewer.

Use finite text bounds fitting these inputs. The verifier uses HTTP `/q/<name>`
and `/m/<name>` with `x-snapback-persona`; it supplies fresh mutation IDs.

## The proof

1. `npx snapback4 check` reports no problems.
2. `npm run seed` uses `SNAPBACK_URL` to install the specified eight profiles,
   three chats, forty posts and sixty messages plus follows and likes through
   your app's own HTTP mutations into an empty running backend. Do not use
   `/seed`, fixtures, SQL, direct store writes or a precomputed result file.
   Exit nonzero on a failed write. It seeds only; no test assertions, receipt
   changes, leaves, extra likes, worker or server launch in this command.
3. `npm run acceptance` — your own headless script — starts a backend in a fresh
   temporary project copy, runs your seed, and asserts all the exact values
   above plus the positive changes and authorization refusals. It must survive
   being run repeatedly. For restart tests use a persistent store in that
   temporary copy (not `--fresh`). Use `npx snapback4 run digest '<args>'` for
   deterministic duplicate/next-period tests and also wait for a real scheduled
   boundary. Mint a worker token with `npx snapback4 token --service ceremony`.
   Use a port above 49500.

   Keep the child handle and PID when you launch a server, and close that child in a
   `finally` block. Do the same for development servers you launch while
   building. Never discover another process by its name, directory or port
   and kill it. If a chosen port is occupied, choose another or report the
   conflict. The runner repeats acceptance from a new copy with no dev store;
   it preserves that copy for diagnosis and does not stop unowned processes.
4. Record your schema choices in `run-log.md`, with this one machine-readable
   line (valid JSON, actual table/operation names, not counts):
   `schema-shape={"workTables":[],"perPrincipalCounterTables":[],"auxiliaryOperations":[]}`.
   A work/accumulator table is written only to be read back by the same job or
   mutation, rather than holding domain facts or an externally consumed result.
   Include all such tables regardless of their names. Per-principal counter
   tables hold numbers about a particular user, including maintains. Auxiliary
   operations exist only to support another operation or work table. Explain
   briefly why each listed table exists and every counter made world-readable.

The runner independently repeats `check`, your acceptance, and its own wire
probes on another fresh copy and seed. Your script passing is necessary but not
sufficient. It also changes likes, messages and membership and repeats queries;
hardcoded seed answers do not pass. The run stops at 1,800 seconds if unfinished.

## The record

Create `run-log.md` first. Its first line is `start=<unix epoch seconds>`.
Append one timestamped line for every milestone start and green, every
error and how you resolved it, every knowledge lookup (source: model
knowledge, package README/guide, `why`, diagnostic, web), and every
correction loop with an attribution: `snapback4-defect` (the package refused
something the README says it does, or behaved wrongly), `docs-gap` (the
README or guide did not say), `agent-error`, or `environment`. When the four
proofs above pass, append `green=<unix epoch seconds>` and stop; do not
polish after green. Finish with `final-report.md`: what you built, wall
clock by milestone, each correction loop with its attribution, and a candid
gap list.

For machine counting, each correction loop's line must contain
`loop=<unique-number> attribution=<category>`. Categories are `snapback4-defect`,
`docs` (the normalized name for `docs-gap` above), `agent-error`, `environment`,
or `ambiguous`. Name the failed command and resolution on that same line. If you
reclassify a loop, append another line with the same loop number and its final
attribution; if you retract it entirely, append `loop=<number> retracted`.
Do not classify ordinary first implementation or a knowledge lookup as a loop.
