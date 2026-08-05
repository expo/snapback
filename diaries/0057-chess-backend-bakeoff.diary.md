# Diary 0057 — Chessfield, a real-time chess backend on Snapback

**Demo:** external — `~/projects/chess-bakeoff/implementations/snapback/`
(`app/`, `conformance.mjs`, `README.md`)
**Surfaces:** `@expo/snapback-cli` + `@expo/snapback-client` @0.1.8, packaged
platform runtime, sessions auth, local server (no Rust toolchain)
**Date:** 2026-08-04
**Brief:** build a server-authoritative real-time chess backend from a frozen,
backend-agnostic spec — a genuine singleton matchmaking pool, an arbiter with two
adversarial writers, a server-owned Elo trust boundary, a per-game live channel with
an app-defined audience rule, a durable queue with a DLQ, and a dynamic per-game
deadline (the chess clock) — and record what the experience was actually like.

**Provenance.** This is one arm of a four-backend comparative build (Snapback,
Convex, Supabase, and the `jonliak/backend.yml` generator), each built in parallel by
a separate Opus 5 agent from the same frozen `SPEC.md` and the same build prompt, each
keeping a contemporaneous diary. The body below is the arm's diary **verbatim**;
only this header was added on sync. The agent had a read-only detached worktree of
this repo at `origin/main` and built against the published npm packages.

**Result:** 23 pass · 0 gap · 0 fail (21 required checks plus two the arm added
because the spec's queue and analytics claims are the kind a conformance script can
assert vacuously). The suite was independently re-run from a fresh generate and a
fresh database by the orchestrating session before this sync.

**Comparison, in one line:** the app itself took about five minutes to write and three
codegen rounds to compile; everything expensive was environmental. Convex reached a
smaller green suite in ~18 minutes with no debugging phase. See
[LLP 0170](../llp/0170-authorization-obligation-feasibility.research.md)
(authorization-obligation feasibility, against the `backend.yml` arm) and
[LLP 0171](../llp/0171-chess-authoring-loop-observations.research.md) (the
authoring-loop observations, against Convex), both drafted from this diary.

---


## Log

### 21:01 — orientation
Read `prompts/build-prompt.md` and `SPEC.md` in full. Chessfield: 10 operations, bearer
auth, server-owned Elo, a singleton matchmaking pool, a per-game live channel with a
"no echo to the mover" audience rule, a durable queue with DLQ, a dynamic per-game
deadline (chess clock), and 21 conformance checks.

Arm root: `implementations/snapback/`. Read-only framework checkout at
`implementations/snapback/snapback-main` (detached worktree of `~/projects/snapback` at
`origin/main`).

First thing I looked at: `snapback-main/AGENTS.md`. It is the *contributor* doc — LLP
conventions, `@ref` annotations, `ref-check`, `scripts/bootstrap-ibex-runtime`. It says
plainly, near the top:

> **Before building an app on Snapback, load [`guide/index.md`](./guide/index.md);
> before using a feature area, load its guide page.** ... Building Snapback itself is a
> different job — that's `AGENTS.md` and the LLP corpus, not this guide.

That split is stated twice (AGENTS.md and guide/index.md) and it is the single most
useful thing in the first five minutes: it told me to stop reading AGENTS.md. Good.

**Rust question, answered before I burned time on it.** AGENTS.md §"Working on this
project" says to run `scripts/bootstrap-ibex-runtime` before `cargo build|test|run` — but
that is scoped to *building Snapback*. `packages/` contains
`snapback-runtime-darwin-arm64` ("Prebuilt Snapback server and Hermes runtime for
Apple-silicon macOS") and `snapback-cli` / `snapback-app-cli`, which is the smell of a
pure-npm path. Confirmed the task brief's note: `vendor/ibex` is NOT initialized in this
worktree (`.gitmodules` lists it; the dir is empty). I am going to try the npm path first
and record how long it takes to be *sure* that's the intended one.

### 21:03 — the npm path works
```
cd app && npm init -y && npm i @expo/snapback-cli@0.1.8
added 9 packages, and audited 10 packages in 8s
npx snapback doctor --json
```
`doctor` ran a full vertical slice on the packaged prebuilt binary and passed every
boundary: `SNAPBACK_RUNTIME_LAUNCH_OK`, `SNAPBACK_DOCTOR_BUNDLE_LOAD_OK`,
`_QUERY_OK`, `_MUTATION_OK`, `_LIVE_OK`, `_SHUTDOWN_OK`. **No Rust, no Hermes build, no
`vendor/ibex`.** npm pulled `@expo/snapback-runtime-darwin-arm64` as an optional
platform package and the CLI relocated and launched it with `DYLD_*` scrubbed.

How easy was it to determine which path Snapback wanted? **Medium.** The signals were
there but split across three documents:
- `AGENTS.md` says run `scripts/bootstrap-ibex-runtime` before `cargo build` — true, but
  it is in a section titled "Working on this project", i.e. contributing *to* Snapback.
  A reader who starts at AGENTS.md (which `CLAUDE.md` symlinks to, so every agent does)
  hits the Rust instructions before the "don't read this, read the guide" line.
- `guide/getting-started/the-authoring-loop.md` has the answer explicitly — `snapback
  doctor`, `snapback new`, `bun install`, `bun run dev`, and a paragraph on the published
  `@expo/snapback-*` closure. It is the *second* page of the guide, not the first.
- `guide/getting-started/your-first-backend.md` (the first page) tells you to run
  `node packages/snapback-codegen/index.mjs myapp/snapback` — the **in-checkout** form —
  and only mentions the packaged form in passing.

So: the framework does not want you to build Rust for app work, and it is right, but the
one-line version of that ("app authors: `npm i @expo/snapback-cli`, nothing else") does
not appear until you are two pages deep. That is a **guide gap**, and a cheap one to fix.

The other thing the authoring-loop page does that I have not seen another backend's docs
do: it tells you **which published version has a proof receipt** and that `latest` does
not. "Treat 0.1.7 as the newest closure carrying that proof. The registry's `latest` tag
now selects the 0.1.8 closure ... with no qualification-arm receipt of its own; pin
`0.1.7` when you need the proven closure." I took 0.1.8 anyway (doctor passed on it) but
being *told* the difference is unusually honest.

Now the four questions that decide whether this app is buildable here:
1. can `chess.js` run inside a handler? (the inline form refuses imports outright)
2. can one query be readable with **no** credential while the rest require one?
3. is there a durable queue with retry + DLQ?
4. is there a *dynamic per-entity deadline* — not a fixed cron?

### 21:05 — reading the guide; four questions answered, one of them badly
Read `guide/getting-started/your-first-backend.md`, `the-authoring-loop.md`,
`auth/sessions-and-principals.md`, `backend/mutations.md`, `backend/jobs.md`,
`backend/cron.md`, `backend/trusted-runtime-values.md`, `realtime/live-queries.md`.
The guide is genuinely good: dense, intent-indexed, every code block is a verbatim
excerpt from a file CI runs, and every page carries `targets:` and `maturity:`.

**Q2 — public leaderboard?** Yes, cleanly. A query declares `auth: 'public'`, and a
client declares `custody: 'anonymous-public'` to call it with no credential. Protected
queries refuse the anonymous client exactly as they refuse a signed-out browser. And
identity can't be smuggled: sending `userId` in a body is `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`.
This is the strongest part of the model for this spec — §5.6's trust boundary is
structurally enforced, not conventionally.

**Q3 — durable queue with retry + DLQ?** Mostly. `ctx.jobs.enqueue(action, args, {
delayMs, maxAttempts, idempotencyKey })` from inside a mutation, transactional with the
commit ("if the mutation rolls back, no job exists"). `maxAttempts` 1..8, retry backoff
base 1s capped at 60s with jitter. **There is no separate dead-letter queue** — an
exhausted job goes to a terminal `dead` state on the same queue with `lastErrorCode`.
That is a DLQ in substance (durable, inspectable, terminal, not lost) but not in shape.
Recording it as a partial, not a gap.

**Q4 — a dynamic per-entity deadline?** Yes, and this is the nicest fit in the whole
spec. `delayMs` on the enqueue gives an exact per-game wake, re-armed on every move.
Cancellation is explicitly RFC-only in v1, so a re-armed deadline cannot revoke its
predecessor — the job must fence itself on the game's move count. That is the standard
idempotent-timer pattern and I would ship it. Separately, `defineCron({ schedule: {
everyMs: 1000 } })` (floor 1000ms) is an exact match for §10's 1-second matchmaking
heartbeat, so pairing gets the batched design the spec prefers.

**Q1 — chess.js?** This is where it got interesting, and cost me the most reading.
The paved inline handler form is *deliberately* closed: "Inline v1 ... does not capture
imports, sibling helpers, or outer constants". So `import { Chess } from 'chess.js'` is
out of the question in the paved form.

The escape hatch is the documented legacy `{ source: 'handlers.mjs', exportName }` lane,
which the guide says "remains useful ... for logic that genuinely needs imported or
sibling helpers". **That wording is misleading.** I read the packaged codegen
(`node_modules/@expo/snapback-codegen/index.mjs`) and the `source:` lane does *not* bundle:
`loadHandlerSource()` reads exactly one file and runs `scanUnsupportedHandlerSource()`
over it with `sourceType: 'script'`, which raises `BUNDLE_UNSUPPORTED_IMPORT` on any
`ImportDeclaration`. The lane buys you *sibling top-level functions in one file*, not
imports. **I had to read the framework's source to learn this**; the guide's sentence
told me the opposite.

The banned list in that scanner, which is the real handler contract:
`import`/`export`, `with`, `process`, `WebAssembly`, `eval`, `Function`/`AsyncFunction`/
`GeneratorFunction`, `require`, `fetch` and timers (unless egress is granted),
`Reflect.apply(eval, ...)`, **`Math.random()` (`BUNDLE_UNSUPPORTED_RANDOM`)** and
**`Date.now()` / `new Date()` (`BUNDLE_UNSUPPORTED_TIME`)**. Time and identifiers come
from `ctx.runtime.now()` / `ctx.runtime.id()` and are *frozen for the invocation and
replayed*, which is a genuinely good call for a chess clock. Classes are NOT banned in
this lane (only in inline v1), which matters because chess.js is class-based.

So the plan: pre-bundle chess.js with esbuild into a single closed IIFE script that
assigns `globalThis.__snapbackHandlers`, and point `source:` at that. I checked chess.js
first for the two things that would have killed it — `Date.now`: 0 hits, `Math.random`:
0 hits, `eval`: 0, real `Function(`: 0 (the one grep hit is `peg$startRuleFunction()`).
This is a build step I would ship, but it is a build step the framework does not know
about, and I'll say so in the README.

### 21:07 — the first real bruise: `ctx.refuse` is documented but not published
C10 and C11 require an out-of-turn move and an illegal move to be **distinguishably**
rejected. `guide/backend/mutations.md` has exactly the right primitive:

> Application-semantic refusals get typed codes instead of message prose. A handler
> declares a closed set — `refusals: ['STALE_MOVE']` ... and throws with
> `ctx.refuse(code, details?)`. The refusal arrives as the platform code
> `SNAPBACK_APP_REFUSAL` with `appCode` and `appDetails`.

It is not in the published closure.
```
$ grep -n "refusals" node_modules/@expo/snapback-codegen/define.mjs
(no output)
$ grep -n "refusals" snapback-main/packages/snapback-codegen/define.mjs
54:  'auth', 'authorityIndependent', 'publicInline', 'retainable', 'refusals', 'trackedRefusals',
```
Source has it; `@expo/snapback-codegen@0.1.8` does not.

The authoring-loop page *does* warn this class of thing exists — "do not infer that a
published closure contains every surface in the current source tree ... When a page
describes a surface newer than the newest closure, it says so." **The mutations page
does not say so.** It is `maturity: shipped`, `status: current`, with no version fence
on that section. So the warning is real but unenforced, and the failure mode is:
you author against the guide, codegen accepts your spec object silently (unknown fields
are dropped by `assertKnownSpecFields`... or rejected), and you find out late.

I am not building the Rust server from source to get it — that is a
`scripts/bootstrap-ibex-runtime` + cargo + Hermes detour for one primitive, well past
the budget for this arm. I'll find the best available refusal expression on 0.1.8 and
record the gap. This is the first time I left the guide to make progress, and I left it
for the framework's own `node_modules`.

### 21:09 — writing the app
Schema, functions and handlers in one pass. Shape:

| SPEC §4 route | Snapback operation |
|---|---|
| `POST /me/signup` | mutation `signup` |
| `POST /matchmaking/join` | mutation `joinPool` |
| `POST /matchmaking/leave` | mutation `leavePool` |
| `POST /games/:id/move` | mutation `move` |
| `POST /games/:id/resign` | mutation `resign` |
| `POST /games/:id/draw` | mutation `offerDraw` |
| `POST /games/:id/draw/respond` | mutation `respondDraw` |
| `GET /games/:id` | query `getGame` (membership-guarded) |
| `GET /me/games` | query `myGames` (`since` cursor) |
| `GET /leaderboard` | query `leaderboard`, `auth: 'public'` |
| §7 live channel | live query `watchGame` |

No HTTP gateway bolted on. The spec explicitly permits this and it is the right
call — a Snapback client calls `client.mutate(api.move, { args })`, and the
generated `api.mjs` reference carries the argument schema and result contract.

**Read models (SPEC §6), and why.** Two plain, one materialized.
- `game_by_id` — a plain read of `games`. No projection needed; the guard is the
  interesting part, not the shape.
- `rating_top` — a plain declarative query, `order: [desc('rating')], limit: 100,
  index: 'by_rating'`. Ratings change once per finish; a materialized view would
  be pure overhead.
- `games_by_player` — **materialized** as a `gamePlayers` table, one row per
  participant per game. This one has to be materialized: §4 requires an
  incremental pull from a cursor, and deriving "my games" from `games` means an
  OR over `white`/`black` with no index that can carry a change stamp. The
  materialized row carries `changedAt`, which IS the cursor.

Snapback's own `_version` (server-owned, monotonic, one value per commit) would
have been the *better* cursor — it is exactly the delta cursor the reference
backend uses. I did not use it because the index builder takes declared schema
fields and `_version` is a system field; I could not tell from the guide whether
`.index('by_player_version', ['playerId', '_version'])` is legal, and did not
want to spend the time finding out. `changedAt` from `ctx.runtime.now()` works
and is honest about at-least-once. **A guide sentence on "can I index a system
field" would have saved this.**

**The chess clock.** `ctx.jobs.enqueue('deadlineAction', { gameId, fence: ply },
{ delayMs: remainingMs })`. Re-armed on every move, and because v1 jobs have no
cancellation, the fence (`moveCount` at arm time) makes every superseded timer a
no-op. This is the single best fit between the spec and this backend — the spec
says "a timer that is not a cron" and `delayMs` is exactly a dynamic per-entity
deadline, transactional with the move that set it.

**Matchmaking.** `defineCron({ pairing: { schedule: { everyMs: 1000 } , action:
'pairPoolAction' } })` → action → `ctx.runMutation('pairPool')`. One cron, one
system-authority mutation, nearest-rating pairing inside a time-control bucket.
This is the reference's 1s flush cadence expressed directly.

### 21:14 — codegen, four rounds, all of them fast
```
ACTION_INVALID_EXPR  deadlineAction: runMutation arg gameId is not a value expression
```
I had written `{ Arg: 'gameId' }` (the raw IR) instead of `arg('gameId')`. The
message names the function AND the argument. Fixed in one edit.

```
FUNCTION_UNKNOWN_FIELD  watchGame: authScopeField references unknown field games.viewer
```
Right diagnosis: `authScopeField` names a field of the *read table*, not of the
computed record. I dropped it.

Codegen is genuinely good: deterministic, fails closed, stable codes, and the
summary prints `degraded <fn>` lines pointing at the exact file:line and the
exact fix for anything with an `unknown` result contract. Three rounds from
first draft to a clean generate. No round took more than a few seconds.

### 21:17 — `snapback dev` cannot be backgrounded, and that cost me a detour
`snapback dev snapback` generates, starts the native server, loads the app, and
watches — and then reads JSON commands on **stdin** (`{"state":"control-ready",
"verbs":["status","reload","restart"]}`). Backgrounded from a script, stdin hits
EOF and the supervisor shuts the server down. Exit code 0, ready file deleted,
no error. I lost several minutes to "the server started and then wasn't there".

The fix is documented, just not as a first-class command: build the
startup-artifacts carrier from the generated manifests and hand it to
`snapback start --startup-artifacts`. That is the sessions "one-boot form" the
auth page teaches for suites. I wrote `app/scripts/serve.mjs` to do it. **I would
ship this**, but it is 60 lines a framework should own — `snapback serve` or
`snapback dev --detach` is the missing verb.

The other half of that script: a sessions app binds its startup carrier to the
settled deployment, so adding a function and restarting refuses with
`SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`. The guide says so and says the
recovery is the watch reload — but the watch reload is inside the thing I can't
background. So `serve.mjs --fresh` drops the database. Fine for a bakeoff,
**not** fine for a real app, and it is the one place where I routed around
guidance rather than following it.

### 21:20 — first full conformance run: 17/22
The four failures were all one thing and it is the sharpest finding of the day.

### 21:21 — the anonymous-public gap
SPEC §4 requires `/leaderboard` to be reachable **unauthenticated**. The guide's
paved path is exact:

> Bare clients are refused (`SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED`) because
> the v1 profile requires declared custody. The paved path declares
> **anonymous-public** custody ...
> `new SnapbackClient(baseUrl, { custody: 'anonymous-public', adminToken: null })`

I got the error verbatim:
```
SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED: add the request header
`x-snapback-auth-client-protocol: 1`: this request does not offer the exact
supported auth-client protocol (on a WebSocket upgrade, offer the
`snapback.auth-client.1` subprotocol instead)
```
...and the cure is not in the published client:
```
$ grep -c "anonymous-public" app/node_modules/@expo/snapback-client/index.mjs
0
$ grep -c "anonymous-public" snapback-main/packages/snapback-client/index.mjs
5
```
That is the **second** time the guide taught a surface `@expo/snapback-*@0.1.8`
does not have (after `ctx.refuse`). Both pages are `maturity: shipped`, neither
carries a version fence. The framework's own honesty rule — "when a page
describes a surface newer than the newest closure, it says so" — is stated on
the authoring-loop page and not applied on the pages that need it.

Note what the error message did right, though: it named the exact missing header.
So the workaround was 20 lines — a tiny `fetch` wrapper that sends
`x-snapback-auth-client-protocol: 1` and no bearer, which is byte-for-byte what
anonymous-public custody does. It works: the leaderboard reads with no
credential, and a protected query from the same caller is `SNAPBACK_AUTH_REQUIRED`
(HTTP 401).

**Would I ship this workaround?** For a week, yes. Permanently, no — it is
hand-rolled HTTP against `/query/...`, which the guide correctly names as *the*
anti-pattern, and it bypasses the client's ingress limits and receipt handling.
The real fix is one published version away.

Two things I got wrong on the way and had to fix in my own test:
- My C02 first "passed" on `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` — a
  *transport* refusal, not an authentication refusal. That is a vacuous pass and
  I would have shipped it if I hadn't been fixing C03 next door. C02 now asserts
  that the code is **not** the protocol refusal.
- Sending `"auth": null` in the body is `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED`
  ("client-provided identity fields are not accepted when session authority is
  server-resolved"). The body may not speak about identity *at all*, not even to
  say "nobody". That is the right design and a good error.

### 21:22 — the default auth requirement is `optional-user`
Reading `/inspect` to fix C01, I noticed every one of my operations had shipped
as `authRequirement: "optional-user"`. I never wrote that; it is the default when
`auth:` is omitted, even in a **sessions-mode** app. My handlers all start with
`if (!ctx.auth.userId) throw`, so nothing was actually open — but the platform
gate was not enforcing SPEC §2's "everything else is 401 without a token"; my
handler was.

I added `auth: 'authenticated'` to all eleven user-facing operations. C02 went
from a handler-thrown `SNAPBACK_HANDLER_FAILED` to a platform
`SNAPBACK_AUTH_REQUIRED` / HTTP 401, which is what the spec asks for.

**This is the finding I'd escalate.** Everything else about Snapback's auth model
is default-deny and structurally enforced — identity cannot come from the body,
scoping is a server-side predicate, `custody` must be declared. But the *default
auth requirement for an app operation* is default-open at the gate. A sessions
app that forgets one `auth:` line has a hole that nothing in the loop points at:
codegen does not warn, `/inspect` shows it but you have to go look, and there is
no "every operation in a sessions app must declare a requirement" check.

### 21:23 — 23/23, and what the queue told me
All 21 required checks plus two extras pass against a real running server.

The extras are there because SPEC §8 says the queue must be *real* — "durable,
retried, with a DLQ, not a fire-and-forget in-process call" — and I wanted that
checkable from the product surface rather than asserted in prose. `X01` follows
one push job from the mutation receipt's `enqueues` association to a terminal
state through `defineJobStatusQuery`, which is exactly the lane the guide says is
the product surface (the admin jobs route is operator custody).

Then I went and looked at the attempt receipts through the operator lane, and
found something I would not have found otherwise:
```
"attempts": [
 { "attempt": 1, "outcome": "retryable", "diagnosticCode": "SNAPBACK_AUTH_RESERVATION_STALE" },
 { "attempt": 2, "outcome": "succeeded",  "diagnosticCode": null }
]
```
**The push job's first attempt routinely fails on authorization-reservation
contention with the concurrent player moves**, and succeeds on the retry. The
succeeded job row carries `lastErrorCode: null`, so from the product surface the
retry is invisible.

That matters because `maxAttempts` **defaults to 1**. If I had taken the default
— which is what "enqueue a push notification" looks like when you're not
thinking about it — the push would have gone terminal-`dead` on the first move of
every game, from platform contention, not from anything my consumer did. I set 3
because the spec asked for 3, and got away with it by luck.

Operator note: `snapback secret-read-mint` needs `--token` explicitly even with
the ready file present; without it the mint is
`SNAPBACK_ADMIN_TOKEN_REQUIRED` while the docs read as if ready-file discovery
covers it.

### 21:25 — clean-slate verification
Deleted `snapback/generated/` and the bundled handler, ran `npm run generate`
from nothing, dropped the database, restarted, re-ran conformance:
**23 pass · 0 gap · 0 fail**, exit 0. Nothing in the passing state depends on an
artifact I hand-edited or a database I hand-fixed.

Total wall clock: **~25 minutes** from first `ls` to a clean verified run.
Roughly: 6 min reading, 5 min writing the app, 3 min codegen iteration, 4 min
lost to the `snapback dev` / stdin detour, 7 min on the auth-surface findings and
strengthening my own weak checks.

---

## What felt good

**The npm path is real and it is fast.** `npm i @expo/snapback-cli` pulled nine
packages in 8 seconds, including a prebuilt server binary and Hermes runtime, and
`snapback doctor --json` then ran a full vertical slice — launch, load a
generated bundle, run a query, commit a mutation, open and close a live
subscription, shut down — and printed one stable code per boundary. For an
early-stage framework with a Rust core and a `vendor/ibex` submodule, "no
compiler on the user's machine, and here is proof the thing works before you
write a line" is a genuinely high bar cleared.

**Codegen is the best part of the product.** Deterministic, fails closed, writes
nothing on error, stable diagnostic codes, and messages that name the function,
the argument, the file and the line. Three rounds from first draft to a clean
generate on a 19-operation app with cron, jobs, live queries and two handler
files. It also prints `degraded <fn>` lines telling you exactly which operations
have an `unknown` result contract and exactly how to fix each one — a nudge
toward the typed thing, not a nag.

**The auth model, where it is enforced, is the strongest I have used for this
spec.** SPEC §5.6 ("no client-supplied value may set a rating") and §5.5 ("a
valid token for X must not let X read a game X is not in") are usually
conventions you have to remember. Here identity is *structurally* server-derived:
the request body may not mention identity at all — not even `"auth": null`, which
is `SNAPBACK_AUTH_BODY_AUTH_UNSUPPORTED` — and the generated closed argument
schema rejects an extra `rating` property before it leaves the client. The
original `backend.yml` bug this spec calls out is not merely avoidable here, it
is close to unexpressible.

**Jobs fit the chess clock better than anything else I could have asked for.**
"A timer that is not a cron" is the spec's own framing of the hard part, and
`ctx.jobs.enqueue(action, args, { delayMs })` — transactional with the move that
armed it, so a rolled-back move provably arms nothing — is exactly that. The
absence of cancellation forces the fence-on-move-count pattern, which is what
you'd write anyway.

**`ctx.runtime.now()` / `ctx.runtime.id()` being frozen per invocation and
replayed** is the right call and it is *enforced*, not advised: `Date.now()` in a
handler is a generation-time error with a file, a line, and the repair. For a
chess clock this is the difference between a deadline you can reason about and
one you can't.

**The guide is genuinely agent-first.** Intent-indexed, every code block a
verbatim CI-executed excerpt, `targets:`/`maturity:` frontmatter on every page,
an explicit capability index with GAP rows, and a stated rule that a behavior is
teachable only when it has an acceptance witness. I found what I needed by
navigating, not grepping, for the first hour.

## What felt bad or surprising

**Twice, the guide taught me a primitive the published package does not have** —
`ctx.refuse`/`refusals` and `custody: 'anonymous-public'`. Both pages are
`maturity: shipped`, `status: current`, no version fence. The framework *knows*
this class of drift exists and says so on the authoring-loop page ("when a page
describes a surface newer than the newest closure, it says so"), but the rule is
unenforced, so the honesty system has a hole in exactly the place it is most
confident. Both cost me a real workaround, and both workarounds are things the
guide separately names as anti-patterns (string-matching a message; hand-rolled
`fetch` against `/query/...`). A `since:` field in the frontmatter and a
`check-guide.mjs` rule joining it against the published closure would close it —
the machinery is already there.

**The default auth requirement for an app operation is `optional-user`, in a
sessions-mode app.** This one surprised me most, because everything *around* it
is default-deny. I only noticed because I was reading `/inspect` for an unrelated
reason. Nothing warns: not codegen, not the dev loop, not the acceptance harness.
Every other trust decision in this framework is "declare it or be refused"; this
one is "forget it and be open".

**`snapback dev` cannot be backgrounded.** It is a foreground supervisor that
reads commands on stdin and shuts down cleanly on EOF — exit 0, ready file
removed, no diagnostic. That is a perfectly good design for a human at a
terminal and a trap for anything scripted, which for an explicitly agent-first
product is the wrong way round. The sessions "one-boot form" exists and is
documented, but as a *testing* recipe, not as a command. `snapback serve` is a
missing verb, and I had to write 60 lines of it.

**A sessions app cannot evolve its function surface across a restart.** Adding
one function and restarting is `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH`; the
documented recovery is the watch reload, which lives inside the thing I cannot
background. So my loop became "drop the database", which is fine for a bakeoff
and would not be fine on Tuesday.

**The retry budget gets spent on platform contention.** Push jobs' first attempt
routinely failed `SNAPBACK_AUTH_RESERVATION_STALE` against the concurrent player
moves and succeeded on the retry — and the succeeded job row shows
`lastErrorCode: null`, so from the product surface nothing happened. `maxAttempts`
defaults to **1**. The obvious spelling of "enqueue a push notification" would
therefore go terminal-`dead` on the first move of most games for reasons that
have nothing to do with the consumer. I only avoided it because SPEC §8 told me
to write 3.

**Handler sources are single closed scripts, and the docs undersell how closed.**
The guide says the legacy `{ source, exportName }` lane is "useful ... for logic
that genuinely needs imported or sibling helpers". It is not: `loadHandlerSource()`
reads exactly one file and any `ImportDeclaration` is `BUNDLE_UNSUPPORTED_IMPORT`.
The lane buys you sibling *top-level functions in the same file*. I had to read
`node_modules/@expo/snapback-codegen/index.mjs` to establish that, which is the
first place I left the documentation to make progress. The constraint itself is
defensible — it is what makes a handler's bytes hashable and replayable — but a
one-sentence "you cannot import; pre-bundle" would save every agent this trip.

**No app-emitted analytics/telemetry event API** in this closure. Snapback has
real observability, but it is platform-owned. I wrote a table. That is a
legitimate GAP, not a failure, and per the spec I did not build a telemetry
system.

**No separate dead-letter queue.** Exhausted jobs land in a terminal `dead` state
on the same queue with `lastErrorCode`. Substantively a DLQ; not shaped like one.

## Did "agent-first" hold up? (the claim, judged)

Snapback says out loud that its guide is optimized for agents "getting close to
guarantees and validating their own work". Judging that honestly, separately from
whether I liked the framework:

**Where the claim held.**
- **Orientation was solved.** Two documents both told me, in the first screen,
  that building *on* Snapback and building *Snapback* are different jobs and
  which corpus is which. I stopped reading `AGENTS.md` because it told me to.
  That is a real and rare property.
- **The capability index is the right primitive.** A table of everything the
  product has, with explicit GAP rows, means "does this exist?" is a lookup, not
  an inference from silence. I used it to answer the durable-queue and cron
  questions in under a minute each.
- **Every claim carries a witness.** Pages name their `authorities:` (LLPs) and
  `examples:` (demos), and snippets are CI-verified excerpts. When I doubted a
  behavior I could go to the file that proves it.
- **Diagnostics are designed to be matched on, not read.** Stable `SNAPBACK_*`
  codes with `{ code, severity, subsystem, message, details }`, and an explicit
  "assert on the code, never the message" rule. My conformance script asserts on
  codes everywhere the platform gave me one.
- **Self-validation is a first-class surface.** `snapback doctor --json` proved
  the install before I wrote code. `defineJobStatusQuery` + the mutation
  receipt's `enqueues` array let me prove a *background effect* from the product
  side — I have not had another backend hand me that. The acceptance page's
  vacuous-pass protection ("zero checks can never pass") is thinking about
  exactly the failure mode that bites test-writing agents.

**Where the claim broke.**
- **It cannot tell you what version of itself you are running.** Twice I authored
  against a documented primitive that the installed package does not have. For a
  human this is an annoyance; for an agent, whose entire model of the system is
  the text, it is the *specific* failure the agent-first framing exists to
  prevent. The fix is mechanical (a `since:`/closure field, joined by the
  existing `check-guide.mjs`) and the framework already owns every piece of it.
- **One page told me the opposite of the truth** (the `{ source, exportName }`
  lane "for logic that needs imported helpers"). I only caught it by reading
  `node_modules`. An agent that trusted the sentence would have written
  `import { Chess } from 'chess.js'` into a handler and hit
  `BUNDLE_UNSUPPORTED_IMPORT` with no idea that the recommended lane could not
  help.
- **The paved dev loop assumes a human.** A stdin-driven foreground supervisor
  that exits 0 on EOF is the least agent-friendly shape a dev server can have,
  and it is the one the docs lead with.
- **One default points away from the guarantee.** `optional-user` on an
  undeclared operation in a sessions app is the only place I found where the
  framework lets you be less safe by omission, and nothing in the loop surfaces
  it.

Net: the *documentation architecture* is the most agent-aware I have worked with,
and its failures are all in keeping the artifacts synchronized with it — which is
a solvable engineering problem, not a rethink. Three of my four biggest time
sinks were caused by that one gap.

**On the Rust question specifically:** `vendor/ibex` is present-but-empty in this
worktree (listed in `.gitmodules`, uninitialized directory), and
`scripts/bootstrap-ibex-runtime` is what would initialize it — I never needed to
run it. The npm path (`@expo/snapback-cli` + the platform runtime package) is a
complete app-authoring path with zero native toolchain, and `snapback doctor`
proves it end to end. Determining that took about seven minutes and three
documents; it should take one line on the guide's first page.

## Where I lost the most time

1. **~4 minutes on `snapback dev` exiting silently.** The server started, printed
   `control-ready`, and then wasn't there. No error to search for. I diagnosed it
   by noticing the exit code was 0.
2. **~4 minutes on the anonymous-public gap** — mostly re-reading the guide
   convinced I had mistyped the option, before grepping both trees and finding
   the version split.
3. **~3 minutes establishing that handler sources cannot import.** Reading
   codegen source to answer a question the guide answers wrongly.
4. **~2 minutes deciding whether to build the Rust server** to get `ctx.refuse`.
   I decided no. That is the right call for a one-day budget, but it means two of
   my findings are about a *published package* rather than about Snapback's
   design, and I want to be clear about that distinction.

Notably *not* on the list: the app itself. Schema, functions and handlers took
about five minutes to write and three codegen rounds to compile. Everything
expensive was environmental.

## What I would tell someone starting this app on this backend tomorrow

1. **Read `guide/index.md` and `guide/capabilities.md` first, then
   `guide/getting-started/the-authoring-loop.md`.** Skip `AGENTS.md` entirely
   unless you are changing Snapback itself — it is the contributor doc and its
   Rust bootstrap instructions do not apply to you. `npm i @expo/snapback-cli`,
   `npx snapback doctor --json`, done.
2. **Cross-check every guide page against your installed `node_modules` before
   you build on it.** `grep` the option name in
   `node_modules/@expo/snapback-codegen/define.mjs`. Two of the things I planned
   around were source-only. Ninety seconds of grepping would have saved me eight
   minutes and shaped two design decisions differently.
3. **Put `auth: 'authenticated'` on every operation, immediately.** The default
   is `optional-user` even in sessions mode. Check `/inspect`'s
   `functions[].authRequirement` before you believe anything about your auth
   posture.
4. **Never take the default `maxAttempts: 1`** on a job that runs alongside user
   writes. Reservation contention will eat an attempt.
5. **Write your own `serve.mjs` on day one** (mine is 60 lines and copyable) and
   accept that the sessions dev loop wants a fresh database whenever the function
   surface changes.
6. **If you need a third-party library in a handler, plan the bundle step up
   front.** Handler sources are closed single scripts — no imports, no
   `Date.now()`, no `Math.random()`. esbuild to IIFE, then re-check the output
   against the banned forms yourself so it fails at build time, not at codegen.
   Keep the heavy handler in its own file: the manifest embeds handler source per
   function.
7. **Use `defineJobStatusQuery` plus the mutation receipt's `enqueues` array.**
   It is the product-side way to prove a background effect actually happened, and
   it saves you from the admin jobs lane, which in sessions mode needs an
   operator-minted secret-read lease.

## Honest self-assessment of the result

All 21 required checks pass, plus two extras I added because SPEC §8's "the queue
must be *real*" and "emit an analytics event" are exactly the kind of claim a
conformance script can assert vacuously. Every check runs against a real running
server through the first-party client with real sessions bearer custody; the only
raw HTTP is the credential-less leaderboard read, and that is a documented
workaround for a missing published option, not a shortcut.

What is genuinely good about the implementation: the trust boundary is
structural rather than conventional; the clock is a real dynamic deadline
transactional with the move that armed it, not a sweeper; the realtime audience
rule is a server-side predicate over the session-derived identity rather than
client-side filtering; pairing is a real 1s heartbeat with rating-nearest
matching; and the push queue is genuinely durable and observed end-to-end from
the product surface.

What is weak, and I want it on the record:
- **C10/C11 distinguishability rides a message string.** The typed channel
  (`ctx.refuse` → `SNAPBACK_APP_REFUSAL` + `appCode`) is the right answer and it
  is one published version away. Today, `refusalCodeOf()` regex-matches
  `CHESSFIELD_[A-Z_]+` out of the diagnostic. It is deterministic and it is not
  what I would ship.
- **The `--fresh` database reset** is a hole in the story. I never demonstrated
  evolving this app without dropping its data.
- **I did not exercise the DLQ path.** I asserted the queue is durable and
  retried and observed a real retry, but I never forced a job to `dead`. That is
  a check I would add with more time.
- **I never proved the singleton is contended-safe.** SPEC §1 calls the
  matchmaking pool "one piece of globally shared, contended state". My pairing
  runs in a single system mutation on a 1s cron with `overlapPolicy: NoOverlap`
  by default, which should serialize it — but I did not write the concurrent-join
  test that would prove no player is ever paired into two games. With another
  hour that is the first thing I would add.
- **Two of my sharpest findings are about the published package, not the
  design.** I chose not to spend the day on `scripts/bootstrap-ibex-runtime` +
  cargo + Hermes to test against source. That was the right budget call and it
  does bound what I can claim.

**Would I choose this backend for this app again?** For this app — a
server-authoritative arbiter with a genuine singleton, a hard trust boundary, a
per-entity dynamic deadline, and a live channel with an app-defined audience —
**yes**, and it would not be close. Four of the five hardest requirements in the
spec map onto a primitive Snapback already has and enforces, and the fifth (the
audience rule) is a five-line predicate. The parts that fought me were all
early-stage plumbing: a dev loop that assumes a human at a terminal, a published
closure trailing its own documentation, and one default that points the wrong way
for a sessions app. Those are the cheapest possible class of problem to fix, and
none of them is a design mistake. What I would want before betting a production
app on it is the published/documented gap closed and a story for evolving a
sessions app without dropping its database — not any change to the model.
