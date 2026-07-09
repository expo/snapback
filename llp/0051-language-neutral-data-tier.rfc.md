# LLP 0051: The language-neutral data tier — a promoted mutation IR, a recordable ctx, and WASM handler artifacts

**Type:** RFC
**Status:** Draft
**Systems:** Runtime, Codegen, Wire Protocol, Client SDK, Conformance, Cloudflare
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-09
**Revised:** 2026-07-09 (r3 — second review round (dated re-review sections
in `llp/reviews/0051-*`) plus reconciliation with Exact LLP 0329 r4 and its
adversarial rounds: builder-first authoring adopted (the Contract grammar is
0329's evidence-gated option); Increment 3 re-gated on the verified
transcription facts, with `applyLiveFeedSnapshot` as the real negative
exemplar; `Get`-missing, null-propagating bracket-key access, and
expression-valued returns decided into the v1 profile; the measured
mutation-profile table added; §Relationship rewritten around 0329 r4's
committed/option split. Earlier: r2 applied the first review round — Ibex
deterministic-member asymmetry corrected, set-oriented steps added,
LLP 0032 DK-1/E3 engaged, the reads-are-never-ledgered rule stated)
**Related:** LLP 0003 (execution and write semantics — the injectable-ids
aspiration and DK-1), LLP 0006 (valet retrospective), LLP 0008 (local-first
sync — DK-3 op-log deltas, DK-9 store-agnostic client store), LLP 0009
(code-execution security — bi-engine, ambient bans, DK-4/DK-5), LLP 0010
(agent DX — the designed machine-readable conformance corpus), LLP 0012
(headless integration contract — the Online/Parity client-class vocabulary),
LLP 0014 (Cloudflare strategy — platform facts), LLP 0020 (core authoring
surface — the "`HostPlan` is an internal bridge" demotion this RFC
re-litigates), LLP 0024 / LLP 0042 (agent operating surface / MCP —
`mutationDryRun`), LLP 0032 (decision docket — DK-1/E3, the host-plan
isolation decision D2 extends), LLP 0034 (Contract source seam,
provider side — the authoring-grammar fence), LLP 0037 (schema source of
truth — DK-7), LLP 0039 (auth vertical slice — the `AuthContext` the D1
ledger freezes), LLP 0040 (Cloudflare narrow proof), LLP 0043 (offline replay
retention — the Parity gap this RFC closes the execution half of), LLP 0047
(hosted execution limits), LLP 0048 (V8 conformance twin). Peer repo: Exact
LLP 0329 (`exact/llp/0329-snapback-language-neutral-data-tier.rfc.md`) is
this document's Exact-side counterpart; see §Relationship to Exact LLP 0329.

## Summary

Snapback's execution surfaces are JavaScript at both ends: server handlers
are `IbexModule { source, export }` strings run in Hermes or V8, and the
only client is an Online-class JS adapter that runs no handlers at all.
That is fine for the shipped v1 — and it leaves three declared gaps that
all have the same root:

- **Parity-class clients** (`offline_mutation_replay`, `optimistic_replay:
  false` in every capability manifest) — LLP 0043 designs the retention and
  queue but excludes local handler execution, so optimistic UI depends on
  hand-written per-app reducers;
- **non-JS clients** — a Rust, Swift, or widget-process consumer today
  would have to hand-mirror the live wire kinds a third time and could
  never execute a mutation locally;
- **handler updates on Cloudflare** — the deployed Workers runtime forbids
  dynamic code evaluation (LLP 0014 §Platform Facts), so changing a JS
  handler means a deploy or a Workers-for-Platforms upload.

This RFC proposes closing all three with machinery Snapback largely
already has, in five moves:

1. **Promote and extend the mutation IR (D2).** `FunctionRuntime::HostPlan`
   with its `ValueExpr` expression IR is a shipped, schema-versioned,
   drift-gated declarative tier — currently demoted to an "internal
   bridge" by LLP 0020 because hand-authoring raw plan objects is bad
   ergonomics. The ergonomics problem is real; the demotion of the
   *execution tier* was collateral damage. With the typed `define.mjs`
   builder as the first-class front-end (shipped — todo-v2 authors every
   mutation with it today), a modestly richer expression set, and — if
   Exact's evidence gate ever fires — a Contract-source grammar
   (LLP 0329's option), the IR becomes the primary artifact for the
   common mutation (a measured claim: 12 of the demo corpus's 13, per
   D2's profile table) — evaluated natively by the server (as today), by
   any client in any language, and updatable on Cloudflare at runtime
   because **data is not code**.
2. **Make ctx answers recordable (D1).** Ambient *authority* is already
   runtime-denied on both engines; the deterministic *members*
   (`Date.now`, `Math.random`, zero-arg `Date`) are runtime-denied on V8
   but only codegen-banned on Ibex in v1 (a declared engine fact —
   §Context); `ctx.runtime.now()` is already per-invocation frozen;
   `ctx.runtime.id()` is the one remaining nondeterministic call in the
   designed ctx surface. D1 adds the **ctx-answer ledger** — record and
   replay modes for the deterministic host ops — and closes the Ibex
   member gap so the runtime ban is true on both engines, realizing
   LLP 0003's "ids and timestamps should be injectable" aspiration and
   giving LLP 0043's mutation queue its captured environment as a
   defined channel.
3. **WASM as the third handler artifact (D3).** For logic beyond the IR,
   `FunctionRuntime` gains a `WasmModule` variant: one set of bytes
   executed identically on the local server, in a widget process, and —
   bound at deploy time — on Cloudflare. The host-import surface is the
   existing ctx host-call op set; LLP 0048 already proved that seam is
   engine-neutral and RPC-shaped.
4. **Finish wire single-sourcing (D4).** DK-7 single-sources manifests
   and artifacts from Rust types; the live envelope kinds (`live_replace`,
   `live_delta`, `resync_required`, the socket messages) and the handler
   completion envelope are still hand-mirrored Rust↔JS — valet's
   `protocol.ts`/`protocol.rs` trap re-created at smaller surface. Extend
   the DK-7 machinery to cover them.
5. **Extend the conformance surface (D5).** LLP 0010's designed
   machine-readable corpus plus LLP 0048's twin harness generalize to the
   data tier: replay cases with ctx-answer ledgers, IR-profile cases, and
   an executor matrix that grows from {Ibex, workerd-V8} to include the
   IR evaluator and the WASM runtime.

Together these produce the client story (D6): Online today, **Parity by
construction** — retained reads (LLP 0043 M1) + the mutation queue with
ledgers (M2 + D1) + local IR evaluation for *derived* optimistic overlays
(D2), all behind DK-9's store-agnostic contract, implementable in any
language from the committed schemas. And they produce the agent story
(D8): `mutationDryRun` (specified in LLP 0024, unbuilt) becomes cheap and
high-fidelity, because deterministic, engine-free mutations are trivially
simulable.

**What this RFC does not change:** the server-authoritative sync contract
(LLP 0008 — replay transmits `{generatedIds, now}`, never random; the
server wins), the commit boundary (buffered writes, single-version commit,
read-set validation), the bi-engine posture (Ibex canonical + V8; Boa
stays banned), the JS handler path (`IbexModule` remains fully supported
— it becomes the tier for logic the IR doesn't reach, alongside WASM), or
the Contract authoring-grammar fence (LLP 0034 §7, LLP 0037 scope fence:
Exact owns the syntax; this RFC defines what Snapback executes).

## Context: what exists (verified in-repo, 2026-07-09)

Facts this design stands on, with the deltas it proposes marked:

- **The expression IR ships today.** `FunctionRuntime ∈ {HostPlan,
  IbexModule}` (`src/manifest.rs:361-371`); `MutationPlan` steps are
  `Insert | Patch | Delete` over `ValueExpr ∈ {Arg, AuthUserId, Binding,
  Literal, RuntimeId, RuntimeNow}` (`src/manifest.rs:774-815`), used
  symmetrically by query filters (`FilterExpr`/`FilterOp`), mutation
  values, return values, and action steps. It is serde-defined,
  `schemars`-derived, committed at `schemas/functions.manifest.schema.json`,
  and drift-gated (DK-7). The JS front-end (`define.mjs` `arg()/lit()/
  runtimeId()/runtimeNow()` + `defineMutation`) and the compiler into the
  IR (`serializeMutationPlan`, codegen `index.mjs:1011-1036`, wired at
  `:523`) exist.
  `ValueExpr::RuntimeId`/`RuntimeNow` are *already declarative injection
  points* for id and time. **Delta: richer expressions, a `guard`/read
  step, promotion out of "internal bridge" status.**
- **The demotion.** LLP 0020 §Constraints: "`HostPlan` … must not be
  presented as the primary application authoring model"; public examples
  must use JS `ctx.db` handlers; the open question "how visible should
  `HostPlan` remain?" (`llp/0020:488-489`) was left unresolved. The
  motivation was authoring ergonomics during the era when the Ibex
  host-call bridge was a capability gap. **Delta: answer the open
  question — promote the tier, fix the ergonomics with a real front-end.**
- **The ctx world is closed server-side — up to one declared asymmetry.**
  Handlers reach the host only through `ctx` over one host-call channel
  (`host(op, args)` → `dispatch_host_call`). Ambient *authority*
  (`fetch`, `crypto`, timers, `WebSocket`) is runtime-denied on both
  engines from the single-sourced allowlist
  (`packages/snapback-harness/allowlist.json`), each leg with its own
  survivor probe. The deterministic *members* are asymmetric in v1, by
  declared design: the V8 strip denies `Date.now`/`Math.random`/zero-arg
  `Date` at runtime, while Ibex leaves them reachable and relies on the
  LLP 0009 codegen ban — a declared engine fact the twin pins
  (`tests/workerd_twin_v0.rs`
  `deterministic_member_denial_is_a_declared_engine_fact`; LLP 0048),
  kept because existing watchdog tests depend on handler-visible
  `Date.now`. `ctx.runtime.now()` returns a per-invocation frozen clock;
  `ctx.runtime.id()` returns a fresh UUIDv7 per call
  (`src/runtime.rs:537,556`); cron already constructs the runtime with a
  *supplied* clock (`now_ms: run.due_at_ms`, `src/runtime.rs:384`), so
  externally-answered time is proven plumbing, not a new mechanism.
  There is **no record/replay mechanism**; execution is
  server-authoritative; `optimistic_replay: false`
  (`src/manifest.rs:1033`). LLP 0003:374-375 explicitly wants
  ids/timestamps "injectable so offline/replay semantics can be added
  without changing the handler API." **Delta: the ctx-answer ledger, and
  closing the Ibex deterministic-member gap for queries/mutations —
  JS-tier replay fidelity depends on it, and narrowing that declared
  engine fact is a deliberate decision this RFC makes, not drift.**
- **The client is Online-class, by honest design.** No local handler
  execution (`packages/snapback-contract/index.mjs:6-11`; LLP 0043
  non-goals). Optimistic UI = app-supplied idempotent reducers. LLP 0043
  (Draft) designs offline as retained reads + a queued mutation replay
  the *client drives* but the *server executes*, with the wire replay
  environment pinned to `{generatedIds, now}` and `Math.random`
  deliberately non-deterministic (LLP 0008:300-314). DK-9 (ratified):
  the client store is a document/result cache plus outbox — "nothing in
  the wire contract may require SQL semantics client-side," with the
  recorded revisit trigger "if parity-class offline execution ever
  requires query capabilities the interface cannot express"
  (`llp/0008:388-424`). **Delta: fire that trigger's answer — Parity via
  IR evaluation, not via SQL or local JS handlers.**
- **Bi-engine is permanent; the twin polices it.** Ibex canonical, V8 on
  workerd/Cloudflare, Boa banned (LLP 0009). The LLP 0048 twin runs one
  corpus (`tests/conformance/twin-corpus.handlers.js` — cases are JS
  functions today) across both engines, diffing outcomes, host-call
  traces (`HostCallTraceEntry`), and committed storage; divergences are
  contract violations / declared engine facts / noise. **Delta: cases as
  data (IR + ledger), executor matrix grows.**
- **Live wire kinds are hand-mirrored.** The outbound kinds are
  hand-written Rust with stringly-typed `kind` fields — `LiveUpdate`
  (`src/local.rs:357-363`, constructed at `:1037/:3161/:3257`) and the
  ephemeral lane's `json!` payloads (`src/ephemeral.rs`) — the socket
  *client* messages are a local serde enum (`src/server.rs:2254`), and
  the JS side string-dispatches on `kind`
  (`demos/_kit/client.mjs:734-777`); none appear in `schemas/`. The
  handler completion envelope is decoded twice (`parse_handler_output`
  in `src/runtime.rs` and `packages/snapback-harness/envelope.mjs`) with
  a strictness divergence documented at `envelope.mjs:8-15`. Codegen's
  own header names the valet trap this re-creates. **Delta: DK-7
  coverage for the live envelope.**
- **Cloudflare facts.** Deployed Workers forbid `eval`, `new Function`,
  and buffer-based WASM compilation; code is compiled into the Worker at
  deploy or uploaded via Workers-for-Platforms; an interpreter-in-WASM
  path (JS-engine-in-WASM to dodge the eval ban) is rejected
  (`llp/0014:118-122,452-455`). CF handlers already run with no ambient
  powers, host access only through the generated async ctx surface
  (LLP 0040). **Delta: none needed — this RFC's design conforms; see
  §Cloudflare.**

## Design

D-numbers align with Exact LLP 0329 for cross-reading (D1 ABI/ledger,
D2 IR, D3 WASM, D4 protocol, D5 conformance, D6 clients, D7 server/scale,
D8 agents).

### D1. The ctx-answer ledger: recordable, replayable deterministic ops

The mutation-visible ctx surface is already closed — up to the declared
Ibex deterministic-member asymmetry (§Context). D1 closes that gap *for
the deterministic tier*: queries and mutations get runtime member denial
on Ibex, single-sourced from the same allowlist `members` list the V8
strip already consumes. Actions are untouched — they are already the
ambient-powered, non-deterministic class, and the wall-clock watchdog
tests that busy-wait on `Date.now` are action tests; a frozen
`ctx.runtime.now` could never drive a busy-wait, which is itself a small
proof that the classes need different rules. With the gap closed, D1
adds the record/replay channel the surface lacks:

- **Record mode** (default, today's behavior): `runtime.id` and
  `runtime.now` answer live (UUIDv7; frozen invocation clock) and the
  host appends each answer to an ordered **ctx-answer ledger** for the
  invocation: `{ ids: [...], now, principal }`. This is a productionized
  sibling of the host-call trace the twin already captures
  (`HostCallTraceEntry`) — same seam, durable purpose.
- **Replay mode**: the ledger is supplied with the invocation
  (`HandlerInput` gains an optional field, additive) and `runtime.id`/
  `runtime.now` consume it in order. Consuming past the end is a typed
  divergence error, mirroring LLP 0043's drop-and-mark-failed posture.
- **The principal is part of the ledger.** `ctx.auth` is captured at
  first execution and re-supplied on replay, never re-read — aligning
  with LLP 0043's auth-context fingerprint retention and closing the
  replay-under-changed-authority hole by construction. Concretely: the
  ledger's auth entry is the *resolved* auth context (LLP 0039's
  `AuthContext` shape, not just a principal string) plus LLP 0043's
  fingerprint; a fingerprint mismatch at replay surfaces the
  `SNAPBACK_AUTH_STALE_RESULT`-class diagnostic LLP 0043 already
  specifies rather than replaying under new authority. (Authorization
  *decisions* still re-evaluate server-side at commit; what freezes is
  the identity the handler observed.)
- **Reads are never ledgered.** The ledger pins *answers* (`ids`, `now`,
  the auth context); `ctx.db` reads always re-evaluate against the
  executing tier's current view. This one rule is what makes the word
  "replay" mean three compatible things: LLP 0043 queue replay reads
  fresh server state (rebase semantics — the server may legitimately
  produce a different outcome, and wins); conformance replay (D5) reads
  the case's pinned initial rows (exact-output semantics); client
  overlay evaluation (D6) reads the retained cache (an approximation the
  server's confirmed result supersedes). A design that ledgered reads
  would instead be claiming bit-exact reproduction across tiers — this
  RFC deliberately does not.
- **Ledger mechanics.** `runtime.log` is excluded (diagnostics, never
  data — the twin already strips it); the ledger format is versioned
  alongside the IR profile (D5) so pre-extension ledgers stay
  replayable; ledger length is capped as a declared LLP 0047-style
  limit row (a JS handler can call `runtime.id()` in a loop — the cap
  turns that into a typed error, not an unbounded artifact).
- **No random, still.** `Math.random` stays banned; the ledger carries
  no random channel. This matches LLP 0008's deliberate asymmetry (only
  `{generatedIds, now}` cross the wire) — and where valet retro-fitted
  that rule onto ambient interception, here the environment simply has
  no random source to leak.
- **Wire alignment, and the split pinned now:** LLP 0043 M2's "captured
  replay environment" *is* the ledger — `generatedIds` = the `ids`
  sequence, `now` = the frozen clock. Which fields cross the wire is
  decided here, not deferred:

  | Ledger field | Crosses the wire (LLP 0043 M2) | Server-retained |
  | --- | --- | --- |
  | `ids` (`generatedIds`) | yes | recorded |
  | `now` | yes | recorded |
  | auth context + fingerprint | no | yes — checked at replay |
  | trace / diagnostic material | no | yes |

  D1 gives that design its server-side and (future) client-side
  producer/consumer without changing the handler API, exactly as
  LLP 0003:374-375 anticipated. (Q7 keeps only the rung-2 question.)

Scope: queries and mutations. Actions keep their richer surface
(`ctx.fetch`, secrets, `runMutation`) and are out of the deterministic
tier — their idempotency story remains LLP 0016-class outbox work, not
replay.

### D2. Promote the mutation IR; extend it to the common mutation

**The re-litigation.** LLP 0020 demoted `HostPlan` for two reasons: raw
plan objects are miserable to author, and JS `ctx.db` handlers had just
become possible. Both were correct. Neither is a judgment about the
*execution* properties of a declarative tier, which are uniformly
superior where the tier suffices: host-plan queries are the analyzable
subset that makes `live_delta` membership maintenance ~5,200× cheaper
(DK-3); host-plan write plans are what LLP 0043 computes sound optimistic
overlays from; IR mutations are simulable for dry-run without an engine;
and IR is the only handler form that can ever execute on a client that
has no JS engine, or update on Cloudflare without a deploy. This RFC
answers LLP 0020's open question: **`HostPlan` returns to first-class
visibility as the default tier for simple mutations — with the authoring
problem fixed at the front-end, not by hiding the tier.**

**The front-end fix — the typed builder, first-class.** The authoring
problem is fixed by the surface that already exists: the `define.mjs`
builder, extended to the full profile below, is the **first-class
authoring surface** for the IR. todo-v2 already authors every mutation
with it, and TS metaprogramming is load-bearing, not incidental — the
all-aboard constant-driven unrolls are a `PATTERN_IDS.map(...)` in the
builder and a wall of near-identical statements in any grammar (the
0329 r3 transcription experiment's finding). A typed builder package
with generated schema types gives more static safety than any v1
grammar would.

**The Contract-source option** (Exact-side: LLP 0329 E1–E3,
evidence-gated): mutations additionally authored in Contract source —

```contract
mutation createTodo(title: string) writes todos
  guard trim(title) != "" else "EMPTY_TITLE"
  insert todos { title: trim(title), done: false, createdAt: ctx.now() } as newId
  return newId
```

— compiling to this same IR. 0329 r4 demoted that grammar from
committed work to an option behind a falsifiable trigger (a measured
grammar-vs-builder authoring comparison, or Design-Mode data-branch
body editing shipping as a committed feature); until the trigger fires
the builder is the surface, and if it never fires the LLP 0179 §5 and
LLP 0034 §7 fences stand. Either way the IR, not any syntax, is the
contract; `serializeMutationPlan` already demonstrates the compile
path.

**The IR extension** (all snapback-owned, serde-first per DK-7):

- **`ValueExpr` grows a closed expression set**: arithmetic (including
  `%`), comparison, logical operators, `??`-style coalescing,
  conditionals (ternary), string concatenation/templates, field access
  on bound rows (`Binding("row").field` — data access only, never
  method dispatch), and calls into a **pinned function library** (`len`,
  `trim`, `lower`, `abs`, `min`, `max`, `round`, `floor`, `ceil`,
  `coalesce`; small, versioned, corpus-pinned — `round`/`min`/`max` is
  the clamp idiom every real feed handler already uses). No arrows, no
  closures, no free calls, no JS method binding — the profile stays
  closed so every evaluator in every language is finite work.
- **Steps grow reads and guards**: `Get { table, id, bind_as,
  else_error }` (a point read captured into the read-set; missing-row
  semantics below), `Guard { cond, else_error }`, and
  `Let { bind_as, expr }`. A guarded update becomes
  Get → Guard → Patch — read-check-write, evaluated inside the commit
  transaction with the read captured server-side.
- **Steps grow two closed set-oriented forms** — because the repo's own
  demos say the common mutation includes them. All three all-aboard
  mutations contain a clear-and-replace core: clear the
  `liveDepartures` table, and (in `applyLiveFeedSnapshot`) insert one
  row per element of an args array
  (`demos/all-aboard/snapback/handlers.mjs:463-517`); the other two
  clear-and-patch from constants or stored state. Without set-oriented
  steps those cores are unexpressible in any per-row IR and the tier
  misses the single most common feed-app write shape.
  So: `DeleteWhere { table, filter }` (a `FilterExpr` over one table —
  clear-table is the empty filter) and
  `InsertEach { table, source, item_as, values }` (one insert per
  element of an *argument-supplied* array, each field a `ValueExpr`
  over `item_as` — a bounded comprehension, not a loop construct).
  Both are statically analyzable per step (fixed table, fixed filter
  shape, fixed value template), bounded by input size, and no more
  expressive than a SQL `DELETE … WHERE` / `INSERT … SELECT` — the
  data tier stays set-oriented the way its substrate is. General
  iteration, recursion, and cross-step data-dependent control flow
  stay out of the profile permanently.
- **Field access is by arbitrary string key, and access on null
  propagates null.** The IR is serde data, so a field-access node
  carries any field-name string — hyphenated JSON keys
  (`tick.delays["sb-local"]`; every all-aboard pattern id is one) are
  first-class in the IR and reachable from the builder. This settles
  the IR half of 0329 EQ8; the grammar spelling, if the option fires,
  stays Exact's. Access on null/absent yields null rather than a type
  error, composing with `??` for the defaulting idiom the corpus uses
  (`tick.delays ?? {}`) — the null-propagation and `||`-vs-`??`
  semantics are pinned as corpus value-model cases (Q5).
- **`Get` binds the row or null; missing is data, not failure.**
  `Get { table, id, bind_as, else_error }`: on a missing row, if
  `else_error` is set the mutation fails with that typed code
  (mirroring `Guard`); otherwise the binding is null and the read is
  captured as a MissingRow read-set entry (per-row validation
  machinery that already exists — LLP 0032 E4's note). The corpus
  decided this: todo's `setCompleted`/`deleteTodo` want soft-missing,
  all-aboard's `applyFeedTick` wants defaulting
  (`(state && state.tickCount) || 1` on first run), and a guarded
  update wants a bindable check — null-binding plus `coalesce` covers
  all three; error-on-missing covers none without a fallback clause.
  This settles the semantics half of 0329 EQ7.
- **Returns grow one expression form.** `ReturnValue` gains
  `Expr(ValueExpr)`, and `ValueExpr` gains a closed **record
  constructor** (`Record { fields: map<String, ValueExpr> }` — the
  same shape as `Insert`'s values map, evaluated by the same
  machinery). Evidence: two of the three all-aboard mutations return
  computed summaries (`{ tickIndex, note }`) that are app-visible API
  — `refreshFeed` propagates them as the action's result — so a
  profile without computed returns cannot finish mutations it can
  otherwise express. Leaving returns out was considered and declined:
  it would have re-created the acceptance-gate gap one form over. (An
  array constructor is deliberately *not* added — no corpus demand
  yet; it is a named Q1 growth candidate.)
- **Plans get declared bounds**: maximum step count, expression depth,
  `InsertEach` fan-out, and serialized plan size, versioned with the
  profile and pinned by corpus cases. The bounds are what make
  "IR updates are runtime-loadable data" (§Cloudflare) a safe claim —
  an expression tree is still CPU and memory, so the evaluator budget
  is declared, not assumed.
- **DK-1 Option B falls out — and this RFC knowingly pays its price.**
  LLP 0032's E3 leg decided **Option A** on 2026-07-02 (client-supplied
  `read_set` is the host-plan isolation mechanism *by design*; pending
  ratification), recording Option B — "host-plan mutations carry
  declarative conditional read predicates the server evaluates
  atomically" — as a future extension that is "strictly bigger surface
  (a precondition language, portability, codegen, diagnostics)"
  (`llp/0032:552-571`; LLP 0003:358-360 carries the same record).
  `Get`+`Guard` *is* that extension, and the four named costs are
  exactly what D2 (the language), D5 (portability via corpus), and
  codegen's fail-closed diagnostics are budgeting for — Option B was
  deferred for lack of a reason to pay them, and the engine-free client
  tier is that reason. Option A is not reversed: the client-supplied
  baseline remains the mechanism for plain plans, and accepting this
  RFC should be read as ratifying-and-extending E3, not reopening it.
  Implementation note: the E3 rationale comment at
  `src/storage.rs:570-579` reasons from plans being *unconditional*
  write sequences — the day `Get` lands, that `@ref` must be updated
  with the code (LLP 0016 discipline).
- **Analyzability is a preserved invariant, not a hope.** The op-log
  delta path depends on the live matcher agreeing with SQL `WHERE`
  including three-valued NULL logic (`llp/0008:260-278`). Every
  expression form added to `FilterExpr`/`ValueExpr` lands with matcher
  + SQL + corpus cases together, or it doesn't land. Expression forms
  legal in mutations but not yet analyzable in filters are fine —
  those queries fall back to `live_replace`, the honest default.

**Where the IR ends — named classes, not vibes.** The tier ladder is
explicit: IR for the common mutation (point CRUD, guards, defaults,
counters, small conditionals, clear-and-replace); `IbexModule` JS
handlers (and D3 WASM) for real logic. Codegen already fails closed on
what it can't express; "outgrew the IR" is a normal, spanned diagnostic
pointing at the JS/WASM path — and the known out-of-profile classes are
named so the diagnostic can be class-specific:

- **Conditional writes** — data-dependent step skipping
  (`applyLiveFeedSnapshot` patches only the patterns present in the
  args object, and accumulates a data-dependent result): permanently
  out; the profile's honest negative exemplar (Increment 3 gate c).
- **Filtered-read guards** — uniqueness, quotas,
  membership-by-non-id-key: `Get` is point-by-id, so these are JS-tier
  today, and they are arguably the most common guard class after point
  reads. A bounded `Exists`/`Count` read form is the named Q4-adjacent
  growth candidate.
- **Type-coercion of untyped inputs** — `v.json()`-fed writes that
  sanitize with `Number(…)`/`String(…)` (applyLiveFeedSnapshot's
  `departures`) need coercion functions the pinned library lacks;
  `num`/`str`/`bool` are named Q1 growth candidates, and until they
  land, `v.json()`-fed `InsertEach` is out of profile.
- **General iteration and data-dependent cross-step control flow** —
  permanently out, by design.

**The measured profile.** "The common mutation" is a measured claim,
not a slogan — the classification of every durable mutation in the
demo corpus, which is also the denominator Q1 growth pressure is
judged against:

| Demo mutation | Profile verdict |
| --- | --- |
| todo-v2 `createTodo`/`setCompleted`/`editTitle`/`setPriority`/`deleteTodo` | **IR today** — shipped plans (`demos/todo-v2/snapback/functions.mjs:47-84`) |
| graffiti `paintCell` | **IR today** — shipped plan |
| todo `editTitle` | **IR today** — shipped plan |
| todo `setCompleted`, `deleteTodo` | **IR today** — the JS defensive-get idiom lowers to plain `Patch`/`Delete` + `ChangedCount` (missing row is a no-op with changed count 0, `src/storage.rs:618-646`; todo-v2 ships exactly this) |
| todo `createTodo` | **v1 extension** — `Guard` + `trim` |
| all-aboard `resetFeed` | **v1 extension** — six builder-unrolled `Patch` steps + `DeleteWhere` (empty filter) + constant `Literal` return |
| all-aboard `applyFeedTick` | **v1 extension** — null-binding `Get` + `%`/`max` + string-template id + bracket-key access + record-constructor return; drops two defensive coercions (`Number.isInteger`, `Number()||0`) the schema/seed already guarantee — the corpus case pins that equivalence |
| all-aboard `applyLiveFeedSnapshot` | **JS-tier, permanently** — conditional writes (`hasOwnProperty` skip) + data-dependent result accumulation; its `DeleteWhere`/`InsertEach`/clamp cores land as corpus fragments |
| cursors-web | no durable mutations (ephemeral lane only) |

Twelve of thirteen in the v1 profile; the thirteenth is the negative
exemplar the tier ladder needs.

**Semantics and the value model.** IR evaluation semantics (numeric
behavior, string semantics, null/absent, ordering non-observability,
type errors) are pinned by the corpus (D5) — the executable definition
every evaluator must pass. The Exact-side evaluators are *consumers* of
this IR, and the Contract compiler (if 0329's option fires) is a
*producer* that must compile to corpus-conformant semantics; Snapback
owns the IR node set and its meaning (§Relationship).

### D3. WASM handler artifacts: one set of bytes, every tier

`FunctionRuntime` gains a third variant:

```rust
WasmModule { module_hash: String, export: String }
```

- **Content-addressed executable storage.** The manifest references the
  module by hash; the bytes live in artifact storage keyed by that hash.
  This also repairs a known soft spot: `bundleHash` today "hashes
  manifest metadata, not the executable text" (LLP 0009's DK-4 note) —
  WASM artifacts are hashed as the bytes that run, and warm-VM-class
  caching keys on real content.
- **Host imports = the ctx host-call op set.** The module imports
  exactly the D1/ctx surface — `db.*`, `runtime.now`, `runtime.id`,
  `auth` — as host functions speaking the same `dispatch_host_call` op
  set the Ibex FFI trampoline and the workerd loopback already serve
  (`src/runtime.rs:880-909`). LLP 0048 built the proof that this seam
  is engine-neutral and RPC-shaped; a WASM executor is its third
  consumer, not a new seam. (Naming care: this is the *handler* seam —
  distinct from the LLP 0024 "host ops" operating surface in
  `src/host_ops.rs`, which is the admin/agent API. This RFC says "ctx
  host-call op set" for the former, never "host-op table".)
- **Execution environments:** local server — wasmtime-class runtime
  with fuel and memory caps; client processes (widgets, native apps) —
  interpreter-mode runtime (wamr-class; iOS extensions forbid JIT, and
  handler workloads are tiny and storage-bound); browser — the page's
  own WASM engine; **Cloudflare — deploy-time module bindings only**
  (§Cloudflare).
- **Limit reporting stays honest — per artifact class, not by wishful
  target rows.** Wasmtime fuel makes *`WasmModule` invocations*
  CPU-cappable, but the local target's `cpu_budget` row
  (`src/manifest.rs:1076-1079`, `Missing`) cannot flip to `Enforced`
  while `IbexModule` handlers — which this RFC keeps fully supported —
  remain uncappable under Hermes (LLP 0047's non-goal). So LLP 0047's
  accounting grows artifact-class granularity: a `WasmModule`-scoped
  `cpu_budget: Enforced` row alongside the target-level `Missing`, the
  same honesty pattern as today's per-class wall-clock rows (only
  `action_wall_clock_timeout` is Enforced locally).
- **Determinism scope, stated honestly — and a strict profile to make
  it true.** Same bytes eliminate cross-engine semantic drift for the
  core spec *modulo NaN payload bits*, and only if the nondeterministic
  features stay out. So the Snapback WASM profile is pinned: no
  threads, no relaxed-SIMD, no WASI (the ctx imports are the only host
  surface — the ambient-ban posture, transplanted); NaN canonicalization
  at the host boundary as part of canonical serialization; traps map to
  typed handler errors, corpus-pinned like every other rejection (D5).
  Same bytes do **not** by themselves make an invocation replayable;
  that is the ledger's job (D1), plus canonical serialization at the
  host boundary and defined DB read ordering, all corpus-tested (D5).
  No claim beyond that is made here; in particular the server stays
  authoritative (no confirmed-not-rebased contract change — see Q7).
- **Authoring:** any language with a WASM target; Rust first-party. The
  TS-authoring toolchain (javy-class vs typed-subset) is deferred (Q3)
  — and note the javy-class option is in tension with LLP 0014's
  rejection of interpreter-in-WASM on Cloudflare, which is one more
  reason the IR should absorb the common case instead.

`IbexModule` JS handlers remain fully supported — server-side under
SB-standard engines exactly as today. No QuickJS, no client-side JS
execution: a client that wants local mutation execution gets it through
the IR (any language) or WASM, never by embedding a JS engine.

### D4. Finish DK-7: the live envelope becomes schema-governed

Extend the single-source machinery — not a new mechanism — to the wire
shapes DK-7 stopped short of:

- Define the live envelope kinds (`live_replace`, `live_delta`,
  `resync_required`, `ping`/`pong`, the ephemeral kinds, and the
  `LiveSocketClientMessage` family) as serde types with `schemars`
  derives in one module; commit generated schemas at `schemas/`; extend
  the `tests/artifact_schemas_v0.rs` drift gate and `snapback-schemagen`.
- The JS client and adapter validate against (or are generated from)
  those schemas, replacing string-dispatch drift with the same
  fail-closed posture codegen already applies to manifests.
- Retire the second hand-mirror: the handler completion envelope decoder
  (`envelope.mjs` vs `parse_handler_output`) gets one generated or
  conformance-locked definition, closing the documented strictness
  divergence.
- **The inventory is bigger than the live envelope, and D4 says so.** A
  non-JS client also needs the HTTP request/response envelopes, the
  connection grant, mutation receipts, and the ephemeral frame family —
  some already schema-governed (`diagnostic.schema.json` is committed),
  most hand-mirrored in `demos/_kit/client.mjs` the same way. D4's
  scope is the full client-visible wire surface, live envelope first
  because it is the currently-ungoverned core; the rest lands under the
  same mechanism before any "non-JS client is unblocked" claim is made.
- A `snapback-protocol` **crate** is deliberately *not* carved yet — the
  repo is a single crate and the first Rust-client consumer doesn't
  exist. The schemas come first; the crate boundary is mechanical
  refactoring when D6's native client work starts.

This is the lowest-risk increment. Once the *full* client-visible
surface above is schema-governed — not before — a third-language client
becomes a code-generation exercise plus DK-9's store contract, not an
archaeology project.

### D5. Conformance: the corpus becomes the data-tier contract

LLP 0010 already specifies the machine-readable corpus this needs
(product-artifact cases, `required_capabilities`, soft skips,
`$NOW`/`$ID` placeholders, replay-and-wire runners first); LLP 0048
already ships the executor-swap harness. D5 joins them:

- **Replay cases:** given (schema manifest, initial rows, function ref —
  IR plan or module — args, ctx-answer ledger, principal) → expected
  (committed writes, resulting rows, return value, receipt facts, or a
  typed error). The ledger placeholder mechanism is exactly LLP 0010's
  `$NOW`/`$ID:<name>` tokens, now load-bearing.
- **IR profile cases:** every expression form, every pinned library
  function, every value-model rule, and every *rejection* — the
  executable pin for D2's semantics. Rejection classes are enumerated,
  not implied: malformed plan, unsupported expression form, plan over
  declared bounds (steps/depth/fan-out/size), ledger exhaustion and
  overrun, auth-fingerprint mismatch, stale artifact hash.
- **Everything is version-pinned together.** The IR profile, the ledger
  format, and the corpus carry one shared data-tier version (DK-7
  schema-versioning discipline); a case declares the version it pins,
  so pre-extension ledgers and plans stay replayable after `ValueExpr`
  grows and an old evaluator soft-skips newer cases
  (`skipped:corpus_version_too_new`, exactly LLP 0010's mechanism).
- **The corpus hosts the cross-tier divergence pins.** 0329 E3's
  divergence table (Contract-UI vs data-profile semantics for shared
  spellings — starting rows: `==` equality, template-string number
  formatting) is enforced only through paired cases pinning *both*
  behaviors, and each table row is gated on the snapback case existing
  first — those paired cases are this corpus's to host.
- **The executor matrix grows:** {Ibex, workerd-V8} → {Ibex, workerd-V8,
  IR evaluator (host), WASM runtime, and eventually client-side IR
  evaluators}. The twin's three-way divergence classification (contract
  violation / declared engine fact / noise) applies unchanged; the
  normalization step that today scrubs ids/timestamps becomes
  unnecessary for ledger-driven cases — outputs are exact.
- Corpus cases for the data tier are **data** (plans + ledgers), not JS
  functions, so every implementation in every language can run them —
  the corpus, not the Rust host, is the definition of correct.
- **Status honesty:** LLP 0010's corpus format and runners are designed,
  not built — `tests/conformance/` holds exactly the twin's JS handler
  corpus today, and no `$NOW`/`$ID` placeholder exists under `tests/`
  yet. D5 includes standing that machinery up; until it lands,
  data-tier cases stage through the twin harness (which is built and
  proven) as a bridge.

### D6. Clients by class: Online today, Parity by construction

Using the Online/Parity client-class vocabulary — defined in LLP 0012,
reported today by the adapter as `SNAPBACK_CONTRACT_CAPABILITY_CLASS =
'Online'`:

- **Online (shipped):** unchanged, plus D4's generated wire shapes.
- **Parity (the LLP 0043 + this-RFC composition):** retained reads
  (M1) + the queued mutation replay (M2) with D1 ledgers + **local IR
  evaluation for optimistic overlays**. For IR mutations the overlay is
  *derived from the plan* — evaluated against the retained result cache
  with the recorded ledger, so it is idempotent (same cache + same
  ledger → same overlay) and convergent (the server's confirmed result
  supersedes it) by construction. **Reducers stay first-class**:
  derived overlays are the *generated default* for the IR tier, they
  land only after passing the adapter's existing reducer regression
  suite (duplicate-reapply, reconcile-failure), and an app-supplied
  reducer always overrides — one app may run derived, reducer, and
  pending-without-overlay mutations side by side, with receipts
  identifying the overlay class per mutation (0329 E5's committed
  contract). Derived is not clairvoyant: the overlay reads
  the *cache*, the server reads *current state* (D1's
  reads-are-never-ledgered rule), so a `Guard` can resolve differently
  locally than at commit — the overlay is an honest prediction, the
  server outcome is the truth, and the overlay-rollback presentation is
  Q10. JS-handler mutations keep the reducer path (or accept
  pending-without-overlay); nothing about Parity requires client-side
  JS execution, honoring LLP 0043's non-goal permanently rather than
  provisionally.
- **Non-JS clients (Rust, Swift-hosted, widget processes):** consume the
  committed schemas (D4), implement the store contract (DK-9 — a
  document/result cache plus outbox; explicitly no SQL semantics
  required), and evaluate IR (D2) — with the corpus (D5) as their
  acceptance gate. This *answers* DK-9's recorded revisit trigger:
  parity-class offline execution arrives via the IR, so the store
  interface does not need SQL capabilities.
- **Widget/extension processes:** read the main app's retained result
  cache through the store contract; refresh-time query evaluation is IR
  over cached rows. Named plainly: this is the one place the RFC
  commits to client-side *query* evaluation (filters/order over the
  cache), not just mutation-overlay derivation — same closed IR, same
  corpus gate, still no SQL semantics required of the store (DK-9
  honored). Whether widgets may *write* (enqueue into the outbox vs
  hand off to the main app) is Q6.

Every tier reports honest capability flags through the existing
capability-manifest discipline. On the Exact adapter seam the flags are
named (0329 E5): `derivedOptimisticOverlays` and `offlineReplay` join
today's honest `optimisticMutations: false` — and `Parity` is claimable
only when both are true *and* the provider passes the D5 replay corpus.
The flags are the mechanism; the class is the claim.

### D7. Server and scale effects (mostly already true, kept honest)

- **IR mutations already execute natively** (`execute_mutation`, no
  engine, inside the commit transaction) — D2 widens how much of the
  workload gets that path; there is no "SQL lowering" project because
  the host executor *is* the lowering. The new cost to watch is
  expression evaluation inside the commit critical section — which runs
  under the global instance mutex, so it is everyone's latency; the D2
  bounds (steps, depth, `InsertEach` fan-out) make it declared work
  rather than hoped-small work, and the corpus doubles as the place to
  pin worst cases.
- **`live_delta` reach grows carefully:** richer analyzable filters
  extend the op-log path's ~5,200× fan-out advantage to more
  subscriptions, under the matcher≡SQL invariant (D2). Unanalyzable
  stays `live_replace` — correct-by-fallback, as today.
- **WASM density on first-party infra** (wasmtime pooling, fuel caps)
  is a hypothesis with a measurement gate before any infrastructure
  claim; on Cloudflare, isolates are the platform's density story and
  no claim is needed.
- The delta fan-out, subscription tracking, and commit machinery gain
  no new load-bearing parts from this RFC.

### D8. The agent surface: dry-run becomes cheap and trustworthy

LLP 0024 reserved `function.explain` kind `mutationDryRun` with a
designed result shape (`wouldCommit`, `predictedWrites`, `readSet`,
`deterministicInputs`, …) and left it unbuilt pending execution
fidelity. This RFC supplies the fidelity:

- **IR mutations:** dry-run is plan evaluation against a snapshot with a
  recorded ledger — execute-and-discard on the buffered substrate
  (LLP 0020 Phase 3 / LLP 0019's propose → check → commit), with
  `deterministicInputs` literally being the ledger. No engine, no
  side-effect risk, exact `predictedWrites`.
- **JS/WASM mutations:** the same buffered path under a recorded ledger;
  determinism means the dry-run answer is evidence, not a guess.
- LLP 0024's pinned MCP catalog entry shape carries `dryRunSupported`
  per function (`llp/0024:401`), and LLP 0042 (Draft) specifies codegen
  emitting it — the catalog is designed, not generated today. When it
  lands, `dryRunSupported` goes true for the IR tier first.
- Agents author against the typed builder today — the shipped surface
  the entire demo corpus was authored on — with machine-readable
  manifests and the corpus as the oracle, the same properties that make
  the rest of Snapback agent-legible (LLP 0010's Agent Contract).
  Whether a closed Contract grammar measurably improves agent authoring
  is exactly 0329's E-1 trigger question, not this section's premise.

## Cloudflare

The design conforms to LLP 0014's platform facts rather than fighting
them, and the CF target is a first-class beneficiary:

- **IR mutations are runtime-updatable on CF.** Interpreting a plan is
  not dynamic code evaluation; `functions.load` of IR-only changes needs
  no Worker deploy and no Workers-for-Platforms upload. This is a
  capability the JS tier can never have on CF (LLP 0014:118-122). The
  claim is safe *because* plans carry declared bounds (D2): what
  hot-loads is data with a declared evaluator budget, not unbounded
  computation.
- **WASM modules bind at deploy time on CF** — buffer-based compilation
  is forbidden, so the `WasmModule` path on the `cloudflare` target
  means module bindings compiled into the deployed Worker (phases 0–2)
  or per-tenant user Workers via dispatch namespaces (phase 3). The
  capability manifest reports the difference honestly (a
  `handler_artifact_hot_load` capability: Enforced locally, Missing on
  CF), exactly like today's limit rows.
- **Distinct from the rejected interpreter-in-WASM path:** LLP 0014
  rejected shipping a JS engine inside WASM to evade the eval ban for
  *app bundles*; first-class WASM handler modules are deploy-time
  artifacts with no embedded engine, on the sanctioned side of that
  line. The companion text in any CF LLP revision should cite both to
  prevent conflation.
- **Limits are target-conditional by existing convention:** wasmtime
  fuel/memory locally, platform CPU-ms/memory on CF — declared per
  profile in the capability manifest as LLP 0047 already does for
  wall-clock and CPU rows; the corpus never encodes limit-kill behavior
  as cross-target-identical.
- The V8 twin (LLP 0048) remains the JS-tier conformance gate; the IR
  tier *reduces* the surface it must police, since IR mutations never
  touch engine semantics.

## Relationship to Exact LLP 0329

Exact LLP 0329 (r4) is the Exact-side counterpart, and its §Context
crosswalk table is the pair's authority map — aligned D-numbers, one
authority per boundary. This document owns the IR node set and its
meaning, the profile and its version, the ledger, the WASM artifact
model, the wire schemas, the corpus and its governance, server
execution, and the typed builder. 0329 owns the Exact client tiers'
evaluators, the DataProvider overlay/receipts presentation, the Acto
projection, and corpus consumption in Exact CI.

The corrections this section listed in r1 (IR authority lives here; the
client story is LLP 0043's, not valet's) were applied in 0329's r3. Its
r4 then went further, on its adversarial rounds' convergent
recommendation: the Exact side split into a **committed track** (E4–E6
plus corpus consumption — none of which depend on where plans come
from) and an **evidence-gated option** (E1–E3: the Contract mutation
grammar, its emission pipeline, and the one-notation-two-regimes
semantics treaty), with the typed builder first-class until a
falsifiable trigger fires (0329 §Increments: a measured
grammar-vs-builder authoring comparison, or Design-Mode data-branch
body editing shipping as a committed feature).

Corrections now flow *toward* this document, and this revision takes
them: 0329's r3 transcription experiment re-scoped the pair's gates
(Increment 3; `applyLiveFeedSnapshot` is the honest negative exemplar),
and its EQ7/EQ8 asked for the `Get`-missing and field-key semantics D2
now decides (the semantics are snapback's to own; the grammar
spellings, if the option fires, are Exact's). One precision note flows
back the other way: 0329's precondition phrase "all-aboard's
clear-and-replace mutations are the builder-authored IR gate" is looser
than the verified facts — `resetFeed` and `applyFeedTick` express
entirely (the latter only with this revision's null-binding `Get` and
record-constructor return), while `applyLiveFeedSnapshot` never does —
and 0329's next revision should tighten that phrase to match
Increment 3's wording. Each document defers to the other by section and
neither restates the other's authority; the pair advances together.

## Increments

Ordered so each ships value alone; 1–3 are independent of each other.
Standing check (adopted from 0329's path decision): every increment
names the shipped surface it pays on, and nothing front-runs a
Parity-class consumer that doesn't exist — 1–4 pay on today's surfaces
(the wire schemas on the shipped JS client, the ledger on LLP 0043 M2
and twin determinism, the IR on `live_delta` reach and the demo corpus,
dry-run on the agent surface); 5–6 are the increments this check
disciplines.

1. **Wire single-sourcing (D4):** serde types + schemas + drift gates
   for the live envelope; envelope decoder unification. Mechanical; the
   live envelope is the ungoverned core, and the rest of the D4
   inventory (grants, receipts, HTTP envelopes, ephemeral frames)
   completes under the same mechanism before the non-JS-client claim
   is made.
   *Status (2026-07-09, ENG-23891): landed.* `src/live_wire.rs` defines
   the durable fan-out envelopes, both socket frame families, receipts,
   the polling wrapper, the connection grant, the error envelope, and
   the live HTTP outputs; ten generated schemas joined `schemas/` under
   the existing drift gate, and `demos/_kit/tests/live-wire-schema.mjs`
   pins the kit's dispatch kinds to them. The handler completion
   envelope was already conformance-locked (ENG-23586/ENG-23603 —
   `envelope.mjs` vs `parse_handler_output`). Remaining D4 inventory
   before the non-JS-client claim: the HTTP *request* bodies
   (subscribe/resume/unsubscribe inputs, mutation/query inputs) are
   typed serde but not yet schema-exported.
2. **The ctx-answer ledger (D1):** first, close the Ibex
   deterministic-member gap for queries/mutations — two mechanisms, as
   on V8: member deny-stubs single-sourced from the allowlist
   `members` list the V8 strip already consumes, **plus** the zero-arg
   `Date`-constructor rule, which is a constructor wrapper
   (`workerd/strip.mjs`'s shape, ENG-23588), not a `members` entry, and
   would be silently missed by a members-only port. Actions keep
   today's surface (the busy-wait watchdog tests are action tests and
   stay untouched — verified: no demo query/mutation handler touches
   the ambient members), and the twin's declared-fact pin flips to
   convergent for the deterministic tier *deliberately* — the pin
   exists precisely so this is a decision, not drift. Then record mode
   + replay mode behind the existing ctx host-call seam; `HandlerInput`
   additive field; the ledger-length limit row; twin corpus cases
   proving Ibex/V8 ledger equivalence. Gives LLP 0043 M2 its captured
   environment as a defined channel.
3. **IR v1 extension + promotion (D2, D5):** `ValueExpr` expression set
   (including the record constructor), `Get`/`Guard`/`Let` steps with
   null-binding `Get`, `DeleteWhere`/`InsertEach`, expression-valued
   returns, matcher+SQL parity for newly analyzable filters, corpus
   profile cases (staged through the twin harness until the LLP 0010
   corpus format lands — D5); `define.mjs` builder parity as the
   first-class authoring surface (metaprogramming in scope — the
   unrolls are a `.map()`); LLP 0020 demotion text amended. The gate is
   the D2 profile table, held to three specifics: (a) todo and todo-v2
   mutations express entirely in IR — todo-v2 already does
   (`demos/todo-v2/snapback/functions.mjs:47-84`), the existence proof
   for plain CRUD; (b) all-aboard's `resetFeed` **and** `applyFeedTick`
   express entirely via builder-authored IR — the acceptance cases for
   the set-oriented steps, null-binding `Get`, bracket-key access, and
   the record-constructor return — and the
   `DeleteWhere`/`InsertEach`/clamp cores of `applyLiveFeedSnapshot`
   land as corpus fragments; (c) the negative gate against profile
   creep: `applyLiveFeedSnapshot` itself produces the class-specific
   "outgrew the IR: conditional writes" diagnostic — a real in-corpus
   mutation, not an invented example.
4. **Dry-run (D8):** `mutationDryRun` built on the buffered substrate
   with ledgers, IR tier first; MCP `dryRunSupported` goes true.
5. **Parity slice (D6):** LLP 0043 M1+M2 with derived IR overlays in
   the JS client — the first Parity-class claim, gated on the replay
   corpus **and** on derived overlays passing the adapter's existing
   reducer regression suite (duplicate-reapply, reconcile-failure) for
   every mutation they cover, with receipts identifying the overlay
   class per mutation (0329 E-B is the Exact-side half of this gate).
6. **WASM runtime (D3):** `WasmModule` variant + content-addressed
   artifact storage + wasmtime executor locally (with the density/fuel
   measurement gate); CF deploy-time binding proof after; TS toolchain
   decision (Q3) last.

## Alternatives considered

- **QuickJS (or any JS engine) on clients for Parity.** Rejected: welds
  every future client to a JS engine, contradicts LLP 0043's non-goal,
  and re-imports the cross-engine divergence class the twin exists to
  police — on devices where we can least afford it. The IR + reducers
  split covers the need without it.
- **Client-side handler execution valet-style.** Already litigated by
  LLP 0006/0043: `handler.toString()` shipping broke on module-level
  references; local replicas of handler behavior doubled the divergence
  surface. Not revisited.
- **A bespoke mutation language.** Rejected: `ValueExpr` exists, is
  schema-governed, and has a compiler; Contract exists as a possible
  authoring grammar (Exact LLP 0329's evidence-gated option). A third
  language would fork both.
- **Grammar-first authoring (Contract mutation bodies as the primary
  surface).** This document's own original framing, re-decided between
  r2 and r3 by 0329 r4's path decision on its adversarial rounds'
  convergent evidence: the grammar's marginal benefit over the typed
  builder (single-file spanned diagnostics, Design-Mode body editing,
  one grammar for agents) is asserted but unmeasured, while the builder
  gets metaprogramming and full TS typechecking for free and already
  authored the entire demo corpus. Builder-first now; the grammar is an
  option behind 0329's falsifiable trigger. Recorded here because the
  framing changed, not just the emphasis.
- **Promoting JS handlers to the only tier and dropping `HostPlan`.**
  The tempting simplification LLP 0020's demotion gestures toward.
  Rejected: it forecloses engine-free clients, runtime CF updates,
  cheap dry-run, and the `live_delta` analyzable subset — four
  independent wins — to remove one enum variant.
- **Native Rust handlers, dynamically distributed.** Rejected outright:
  no unsigned dynamic code on iOS-class targets, native cross-target
  nondeterminism. Statically-linked Rust in a client binary can
  trivially evaluate IR; that is the sanctioned shape.

## Open questions

- **Q1 — IR growth governance.** Which forms may join `ValueExpr`/steps
  and who says no. Propose: corpus-demand-driven, one-in-one-analyzed
  (a form lands with matcher+SQL+corpus coverage or not at all), with
  the LLP 0032 docket as the decision venue and the D2 profile table as
  the demand ledger. Named candidates already on it: `Exists`/`Count`
  filtered reads (Q4), `num`/`str`/`bool` coercion functions, an array
  constructor.
- **Q2 — cross-repo profile/corpus consumption.** Partially answered by
  0329 r4: Exact CI *commits* to consuming the corpus by reference for
  its evaluators (0329 E3 — one corpus, two consumers, no vendored
  fork; the exact-conformance.mjs discovery pattern, reversed), with
  compiler consumption conditional on the grammar option. What remains
  snapback's to decide: publishing the committed profile schema, plan
  bounds, and library list on the same channel (0329 EQ4's
  durable-mechanism decision — pinned checkout, published artifact, or
  generated fixture; a provisional pinned checkout is acceptable if
  option work ever lands first, stated never silent).
- **Q3 — TS→WASM authoring toolchain** for authors who outgrow the IR:
  javy-class (fat, and in tension with LLP 0014's interpreter-in-WASM
  rejection on CF), typed-subset compiler, or "write Rust." Gates
  nothing before Increment 6.
- **Q4 — query/filter IR convergence.** `FilterExpr` is 6 comparison
  ops; D2 grows it under the analyzability invariant. How far do
  ordered/limited windows and cross-table filters go before the
  matcher-parity cost exceeds the `live_delta` benefit? The named
  standing pressure: filtered-read *guards* (uniqueness, quotas — D2's
  out-of-profile class) want a bounded `Exists`/`Count` read form,
  which lands under this question's discipline or not at all.
- **Q5 — the value model, precisely.** Numeric semantics (integer/real
  boundary, NaN non-persistence), string normalization, null vs absent
  — including field-access-on-null propagation and the `||`-vs-`??`
  defaulting idioms the demo corpus uses — key-order
  non-observability, blob/timestamp representations: decided in the D2
  profile, pinned as corpus cases, and reconciled with the Exact-side
  expression-semantics spec (Exact LLP 0328 D2), whose evaluators
  consume this corpus (and whose Contract compiler would too, if
  0329's option fires).
- **Q6 — widget/extension writes.** Enqueue into the shared outbox vs
  hand off to the main app; interacts with app-group storage and the
  LLP 0043 queue's single-writer assumptions.
- **Q7 — confirmed-not-rebased (rung 2).** With ledgers (D1) and
  identical bytes (D3), the server *could* verify a client's optimistic
  result instead of recomputing — removing visible snap-back on the
  happy path. That is a sync-contract change (LLP 0008 amendment, wire
  ledger transmission, a verification-failure story) and is explicitly
  out of scope here; a future RFC may take it up once Increments 2–5
  have evidence. (The ledger's wire split is no longer open — D1 pins
  it.)
- **Q8 — public visibility of plans.** LLP 0020's open question,
  answered "promoted" by D2 — but the `PublicHostPlanKind` redaction
  currently drops step bodies from `/inspect`. Do promoted IR plans
  become inspectable artifacts (aiding agents and debugging) or stay
  operationally redacted? Propose: inspectable, since IR carries no
  secrets by construction (secret access is action-only). 0329 E6
  strengthens the case: an agent looping over `mutationDryRun` wants to
  read the plan it is simulating.
- **Q9 — `IbexModule` self-containment.** The valet retro's
  "handlers must be self-contained" constraint (LLP 0006) still binds
  the JS tier; does the D3 artifact model (content-addressed bytes)
  eventually absorb JS bundles too (an artifact-format registry under
  DK-7's schema discipline), giving `bundleHash` real
  executable-content semantics everywhere?
- **Q10 — overlay-rollback presentation.** D6's derived overlays are
  honest predictions the server may contradict (a `Guard` passing
  locally can fail at commit, and vice versa — D1's
  reads-are-never-ledgered rule makes this normal, not exceptional).
  What does the client surface between optimistic overlay and
  authoritative failure — silent rollback, a pending→failed transition
  on the affected rows, an app-visible callback? The Exact half is now
  specified: 0329 E5 commits the receipts contract (lifecycle
  pending → confirmed | failed; `rollbackReason` carrying the typed
  guard code; per-mutation overlay-class identification). What remains
  here is the provider-side receipt population and the store-contract
  events that feed it (details tracked with 0329 EQ5).
- **Q11 — the WASM artifact trust chain.** D3 names content-addressed
  storage but not custody: where module bytes live per target, whether
  hashes alone are trust (they are integrity, not provenance), whether
  first-party-only modules defer signing entirely, and what the
  per-target binding manifest looks like for the CF deploy-time path.
  Gates Increment 6, nothing earlier.
