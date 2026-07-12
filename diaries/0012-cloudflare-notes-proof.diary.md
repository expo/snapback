# Diary 0012: Cloudflare narrow proof (notes) + V8 conformance twin

**Demo:** Notes-on-Cloudflare narrow proof (`cloudflare/`) — one syncable
table, one V8 mutation, one live subscription on a Worker + Durable Object
**Surfaces:** Miniflare acceptance (required, passing); real-Cloudflare notes
runner (first real run 2026-07-08, 11/11 — see the ENG-23640 entry); All Aboard
live-data proof and deliberate no-subscriber idle window (ENG-23840/ENG-23841)
**Author:** Claude / Codex
**Date:** 2026-07-07
**Related:** LLP 0009, LLP 0014, LLP 0028, LLP 0040, LLP 0047, LLP 0048,
LLP 0049, LLP 0050, Diary 0006, Diary 0008, ENG-23626, ENG-23840, ENG-23841

## 2026-07-07 — Building LLP 0048 (twin) and LLP 0040 (Cloudflare proof)

This is the first Snapback code that runs handlers on an engine other than
Ibex, and the first that runs on Cloudflare at all. Two RFCs, built together
because 0048 is prerequisite-shaped for 0040: the same single-sourced handler
harness the twin proves locally is the one the Cloudflare proof deploys.

### What felt good

- **The `ctx` seam was already the right shape.** LLP 0014's one-way door 3
  ("keep the handler↔host seam async and RPC-shaped") paid off exactly as
  intended. The single hardest thing about a second engine — the host boundary
  — turned out to be a protocol I could implement twice (synchronous FFI on
  Ibex, loopback HTTP on workerd, a re-entrant DO fetch on Cloudflare) against
  one op table. `dispatch_host_call` is that one table; both engines route
  through it, so the conformance trace is identical by construction, not by
  luck. The exploration agents' map was right that there was "no executor
  trait yet"; adding the seam was a clean insertion, not a refactor.
- **Single-sourcing the harness JS was mechanical once extracted.** Pulling
  `ctx-bootstrap.js` and the invocation IIFE out of Rust string constants and
  `include_str!`-ing them back meant the Ibex leg, the workerd leg, and the
  Cloudflare deploy Worker literally share bytes. The moment I made
  `collect()`/`first()` unwrap either a value or a thenable, the same bootstrap
  ran unmodified against a synchronous host (Ibex) and an async one (workerd,
  Cloudflare). That is the whole "engine-neutral by construction" thesis in one
  small change.
- **The conformance runner caught real divergences immediately.** First run:
  two contract violations. Neither was a deep bug — one was an embedded UUID in
  a string the normalizer didn't reach, the other was `runtime.log` (console)
  showing up in the trace with different delivery timing per engine. Both were
  *correct* things for the runner to flag; classifying them (normalize embedded
  ids; drop diagnostics-only ops per the RFC's class 3) is exactly the
  discipline the twin exists to enforce. It made me trust the gate.
- **Miniflare's fidelity is high enough to be worth it.** The full behavioral
  checklist — snapshot-before-delta ordering, push-from-commit fan-out,
  hibernation accept, subscription rehydration — all runs locally with no
  Cloudflare account. `useSQLite: true` on the DO namespace was the one
  non-obvious config knob.

### What felt bad or hard

- **Discovering the ambient surface empirically.** The V8 strip and the Ibex
  ambient-denial list have to agree, and "agree" meant running the probe suite
  and watching it fail one global at a time: `performance`, `navigator`,
  `HermesInternal`, `queueMicrotask`. Each failure was a real decision (deny?
  allowlist? declared engine fact?), but there was no single authority to read
  the answer from — the Workers platform surface is large and Hermes's is
  different, and I was reconciling them by test feedback. Moving the banned
  list into `allowlist.json` as the one data source helped, but I'd have liked
  a generated inventory of both engines' `globalThis` to diff up front.
- **`HermesInternal` is genuinely unshadowable.** It is non-configurable *and*
  non-writable on the vendored runtime, so no `defineProperty`/`delete`/assign
  fallback removes it. I recorded it as a declared engine fact and filed the
  real fix (disable it at runtime construction) as a follow-up, but it is a
  reminder that "capability security by discipline" on the V8 leg has edges the
  Ibex-by-construction posture doesn't.
- **The DO host-call loop is a genuine re-entrancy puzzle.** The coordinator
  calls the handler isolate, which calls back to the coordinator for every
  `ctx.db.*`. That only works because the handler's host calls are synchronous
  SQLite reads with writes buffered until after settlement — no output-gate
  interaction mid-handler. It's correct, but it took care to convince myself it
  wouldn't deadlock, and it adds a network hop per host call that will show up
  in real-Cloudflare latency (Miniflare hides it).
- **The token being expired is the whole ballgame for the decisive evidence.**
  Everything behavioral is proven, but the *reason this RFC exists* — the
  scale-to-zero economics claim — is measured in dollars over real idle
  windows with real eviction, and Miniflare has neither a billing surface nor
  an evictor. So the proof is deploy-ready and blocked, which is an unsatisfying
  place to stop through no fault of the code.

### Snapback vs. the alternatives

Against a hand-rolled Cloudflare app (Durable Object + SQLite + a WebSocket
room), the thing Snapback's model bought here was the *commit contract*: one
`transactionSync` for version + rows + journal, and a live path that is a
consequence of the commit rather than a second system. Wiring that by hand —
and keeping it gap-free across eviction — is the part people get wrong. Against
React + Convex, the honest comparison is that Convex *is* the hosted backend
and here I'm building the thing Convex is; the interesting parity is that the
same generated client and the same handler semantics are meant to run on the
local target and this one, and the capability manifest is where the
divergences (no offline replay, no cron, `code_hot_load` missing) are stated
out loud instead of discovered in production.

### Where I stopped

16/16 Miniflare acceptance, conformance gate green (14 convergent / 2 declared
facts / 0 violations), both Workers bundle clean under `wrangler deploy
--dry-run`, capability manifests validate against their schemas. The one
command that produces the missing evidence — `cloudflare/deploy.sh` then
`acceptance.remote.mjs` — needs a fresh Workers+DO-scoped API token; the one in
the key file expired 2026-06-10.

## 2026-07-07 — The proof grows up: All Aboard live on real Cloudflare (LLP 0049)

The narrow notes proof became a two-app target today. A deploy-time app
selector (the `snapback-app` module alias, resolved per wrangler config and
per Miniflare harness) keeps the notes fixture untouched as this diary's
regression surface, while `wrangler.all-aboard.*.jsonc` deploys the real demo:
gateway + coordinator DO, TWO handler isolates (the action class gets its own
Worker — the handler server chains invocations per isolate, so a slow action
fetch on the shared isolate would have queued every query and live push behind
it), same-origin static assets for the generated Contract surface, deploy-time
secrets with descriptor-only grants, host-mediated fetch with placement slots,
and the demand-armed alarm warm poll.

The expired-token era ended: `deploy.sh` ran for real against
ccheever@expo.io, and immediately taught two lessons Miniflare could not —
first-deploy service bindings are circular (gateway ↔ handler both 10143
whichever goes first; the script now does a bootstrap pass with `services`
stripped), and real upstreams negotiate content types (OpenRouteService 406s a
strict `Accept: application/json`; the mocks never noticed). The guided
`config.set` flow worked exactly as designed on the real API: one
`wrangler secret bulk` activation carrying both entries plus the
`SNAPBACK_CONFIG_GENERATION` stamp, `pending` until `/config/status` attested
generation ≥ 1, then `applied`.

Remote acceptance (`acceptance.remote.all-aboard.mjs`) proves the LLP 0049
product claim against `https://snapback-all-aboard-proof.ccheever-0f6.workers.dev`:
live 511 data (200+ real SIRI visits mapped per refresh, committed through
`applyLiveFeedSnapshot`, key-redacted diagnostics), directions through the
header slot (ORS's first hit from a fresh colo can blow the 15s budget — the
suite allows one retry and says so), the 60s warm-poll cycle through the
hardened claimed runner with a live push to a real hibernation socket, and
disarm-on-last-unsubscribe. What this run does NOT earn: long-window billing
counters for the three idle shapes (no-connection, connected-hibernating,
scheduled-wakeup). Those need hours of controlled idle time; the structural
facts stand in honestly — zero armed alarms and an empty ledger while idle —
and the counters remain the open LLP 0040 §Measurements item.

## 2026-07-08 — The decisive evidence lands: real eviction, observed billing zeros (ENG-23640)

The one command that was blocked is blocked no more. Deployed the notes pair
for real (`SNAPBACK_CF_APP=notes deploy.sh`, bootstrap pass and all, admin
token secret set from the environment) and ran the remote acceptance with a
10-minute connected-hibernating idle window: **11/11**, including two legs
the runner didn't have yesterday.

The story of the run:

- **Cloudflare actually evicted us, and nobody noticed — which is the whole
  point.** I gave `/health` an `objectBoot` marker (fresh UUID per in-memory
  coordinator instance, never persisted). Across the quiet 10-minute window
  the marker changed: the platform genuinely discarded the hibernating
  object while the subscriber's WebSocket stayed open. The next committed
  mutation reached that same socket. Subscription rehydration from persisted
  rows, proven against a *real* eviction — the thing Miniflare structurally
  cannot do. The forced `/evict` leg passed too, minutes earlier, on the
  same deployment.
- **The analytics surface agrees with the hibernation story.** Settled
  per-script GraphQL analytics (new `billing-windows.mjs`; the datasets each
  have their own filter quirks, documented in the file): the pure interior
  of the connected-idle window returned no rows for either notes script,
  summarized as **0 estimated Worker requests / 0 estimated Worker execution
  GB-s / 0 estimated DO requests**; a 58-minute no-connection window after the
  run had the same observed-zero estimate. The adjacent setup/wake window shows
  the run's own traffic (8 requests, 3.8 GB-s), which is what makes the
  observed zeros credible as data rather than lag. Cold start of the run: 53 ms to
  first `/health`.
- **All Aboard taught the opposite lesson, honestly.** Its overnight
  "idle" was never idle: 6k+ outbound WebSocket pushes overnight means a
  subscriber (someone's tab, some agent) stayed connected the whole time,
  so the demand-armed warm poll correctly stayed armed — ~200–800 gateway
  requests/hour at ~215–420 GB-s/hour while armed, versus ~18–32
  requests/hour in the quietest stretch. Demand-gating did its job; what it
  cannot do is make a *watched* app idle. The no-connection→zero claim for
  All Aboard needs a deliberately scheduled no-subscriber window; the notes
  deployment carries that leg of LLP 0040 for now. Attribution has caught
  up, too — `scriptName: "__unknown__"` is gone from the per-script
  datasets.

What this closes: the LLP 0040 accepted-proof items Miniflare could not
produce (real eviction with the Hibernation API in use; both idle-window
billing counters). What stays open, stated in §Status: the percentile
benchmark report as a Research LLP, max practical subscribers, and the
contention/overload measurements.

## 2026-07-09 — The percentile report closes the checklist (ENG-23713, LLP 0050)

The proof's last measured gaps — percentile distributions, max practical
subscribers, contention/overload — are now numbers in
[LLP 0050](../llp/0050-cloudflare-proof-remote-benchmarks.research.md), from
a new public-surface runner (`cloudflare/test/measure.remote.mjs`). What the
run felt like:

- **The numbers are boring in the best way.** Mutation p50 93 ms against a
  56 ms network floor — the whole V8-handler-RPC-commit sandwich costs
  ~37 ms over transport. Reconnect is dominated by WebSocket establishment,
  not the resnapshot. Payload growth on `live_replace` is visible but tiny
  at these sizes. Nothing here argues with the design.
- **I almost published a wrong bottleneck.** Run 1 said fan-out fell off a
  cliff at 50 subscribers (665 ms per socket, 5 failed connects) and I had
  the "single-authority coordinator becomes visible" narrative half-written.
  A rerun with connect concurrency 8 instead of 25 deleted the entire
  effect: 50, 100, 200, and **400** subscribers all deliver flat
  (p95 150→191 ms, zero losses). The cliff was my own connect storm. The
  measured truth is the opposite of the easy story — the coordinator's
  subscriber ceiling is somewhere **above** 400, unfound by a single-client
  rig. Lesson for the next benchmark author: vary the client's own
  concurrency before believing any knee.
- **Failure shapes are honest except at the platform edges.** Mutation
  bursts keep versions unique and gap-free while shedding load with the
  stable `SNAPBACK_HANDLER_FAILED` — but the inner message is *"Subrequest
  depth limit exceeded"* (42/64 shed at 64-way; parallel requests somehow
  deepening a Workers chain — worth its own investigation), and a >2 MB
  value write comes back as a raw Cloudflare HTML 500, not a `SNAPBACK_*`
  envelope (coordinator survives; objectBoot unchanged). ENG-23849 owns
  both; the envelope taxonomy should own the platform caps too.
- **Credentials were the real friction.** The API token in the key stash
  was revoked since yesterday's runs and the last `SNAPBACK_ADMIN_TOKEN`
  rotation was never persisted (two sessions in a row rotated it
  write-only). Everything above ran on the public surface with fresh per-run
  boards instead of `/reset`; the deliberate All Aboard no-subscriber window
  stayed blocked twice over (ENG-23840 credentials, ENG-23841 the window
  itself — demand read 4 all session; the app was watched the entire time).

## 2026-07-11–12 — The watched app finally goes idle (ENG-23840/ENG-23841)

Closing the All Aboard proof was operational work, not another implementation
phase. A human had to mint an account-scoped Cloudflare token with analytics
read access. Before uploading the separately rotated Snapback admin token, I
persisted it in the operator's secret store; that reverses the two earlier
write-only rotations that left the deployed secret usable but the operator
unable to authenticate later. No credential value or private store locator is
part of the repository evidence.

The credential repair had two platform-shaped wrinkles. Token validity was not
captured by one universal check: the account-scoped analytics query was the
meaningful authorization proof, while the user-oriented verification surface
did not model the account-vs-user permission boundary the same way. And secret
upload success did not mean every edge location recognized the new admin token
immediately; bounded retries across propagation turned the first transient
authorization failures into a clean admin-gated request without weakening the
gate.
Both are small things, but both are exactly the sort of human-gated residue
that makes a finished implementation look unfinished operationally.

Once credentials worked, Snapback's own inspection surface made the decisive
window pleasantly legible. Five zero-demand observations at 2026-07-11
23:32:13Z, :18Z, :23Z, :33Z, and :44Z showed `inactive:no-demand`, demand
zero, no next run, and no last run; the final :44Z observation defines the
official disarm boundary. The fenced 7,200-second pure window was
23:37:44Z–01:37:44Z. A post-window status read at 01:39:47Z was still inactive
with no demand or scheduled work, and a public witness at
01:39:52.978Z–01:39:54.330Z returned 21 stations with refresh source
`511-siri-stop-monitoring`. The deployment was alive; the retained evidence
showed no work during the measured interval.

The analytics result is the missing app-specific proof: controls were read at
02:28:06Z and the final quiet interval was re-read at 02:43:38Z. Both the
aggregate and hourly Cloudflare reads returned empty arrays
for Worker invocations, Durable Object invocations, periodic activity, and
storage during the pure quiet window. The request datasets summarized to **0
estimated Worker requests / 0 estimated Worker execution GB-s / 0 estimated DO
requests**, while the account-wide periodic query observed 0 µs active time.
Empty rows alone are not evidence, so the run bracketed them
with controls through the same queries. The 15-minute pre-window control found
11 gateway requests, 0.240013125 GB-s, and 2,675 estimated Durable Object requests;
the post-window witness found 3 gateway requests, 0.2347815 GB-s, and 245
estimated Durable Object requests. Those nonzero adjacent rows, the hourly
equivalents, the settlement delay, the
inspectable zero-demand state, and the live 511 witness together rule out the
easy false-zero explanations. The raw record is
[`measurements.remote.idle.2026-07-12.json`](../cloudflare/generated/measurements.remote.idle.2026-07-12.json).
Cloudflare's periodic and storage datasets have no per-script dimension, so
they remain account-wide context; storage had no positive control and its empty
array is telemetry absence. The two script-attributed request datasets are the
deployment-specific evidence for All Aboard. Because those datasets are
Adaptive and the empty quiet rows expose no sample interval, the result is a
controlled observed-zero estimate, not an absolute invoice guarantee.

Compared with a managed backend such as Convex or Supabase, this was more
operator work than opening one billing dashboard: the relevant Cloudflare
counters live across GraphQL datasets with different dimensions and settle
asynchronously. The upside is unusually auditable raw evidence, and Snapback's
explicit demand count, activation state, alarm state, and last-run ledger made
the application half clearer than a generic usage chart. A managed dashboard
would have made the first glance easier; it would not by itself have supplied
the false-zero controls or shown why this particular application reached zero.
