# Diary 0012: Cloudflare narrow proof (notes) + V8 conformance twin

**Demo:** Notes-on-Cloudflare narrow proof (`cloudflare/`) — one syncable
table, one V8 mutation, one live subscription on a Worker + Durable Object
**Surfaces:** Miniflare acceptance (required, passing); real-Cloudflare
runner (staged, blocked on a valid API token)
**Author:** Claude
**Date:** 2026-07-07
**Related:** LLP 0009, LLP 0014, LLP 0040, LLP 0047, LLP 0048, Diary 0006

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
