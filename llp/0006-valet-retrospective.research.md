# LLP 0006: Valet retrospective

**Type:** Research
**Status:** Draft
**Systems:** Runtime, Storage, Sync, Realtime, Developer experience, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-06-25
**Revised:** 2026-06-26
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0004, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0012, https://github.com/expo/valet, https://github.com/expo/valet/tree/main/diaries

## Summary

Valet is the highest-value prior-art input for Snapback because it is not just a
neighboring product. It was the previous attempt at this architecture: a small
Rust service beside SQLite, running JavaScript application code and pushing
realtime changes to clients. LLP 0001 already identifies Valet as the deepest
strand of prior art, but it did not yet recover the empirical record that made
Valet hard.

**That recovery has now started.** Valet's repository contains a set of
first-person **experience diaries** — agent-authored field notes from building
real demos (todo, kanban, Partiful invites, multiplayer Klondike, Pong) on
Contract + Snapback. The diaries are exactly the kind of "recoverable artifact"
this document's own provenance rules admit as first-hand evidence, and they turn
a large fraction of the candidate questions below into **confirmed findings**.
This revision promotes those findings (see
[Confirmed findings](#confirmed-findings-valet-experience-diaries-2026-06-25))
and pins each to the Snapback LLP that must absorb it.

Two scoping caveats keep this honest:

- The diaries are **demo- and dev-scale**, single-session, point-in-time notes
  against a moving codebase (the diaries' own README calls them "allowed to be
  opinionated and wrong"). They are strong evidence for **correctness and
  developer-experience** failures in the build loop. They are **not** evidence
  about production-scale behavior — write contention under real concurrency, the
  realtime fan-out ceiling, multi-tenant noisy-neighbor effects. Those remain
  open (see [Open Questions](#open-questions)).
- Some diary findings were **fixed inside Valet during the build**. A fix is
  still a lesson: it records that the gap existed and shows the shape of the
  remedy Snapback should design in from the start rather than rediscover.

## Sources recovered

The findings below are drawn from `expo/valet/diaries/` (2026-06-25):

- `0000-demo-contract-todo-v0` / `0001-demo-contract-todo-v1` — todo, headless,
  the data-binding seam and the Snapback SDK edges.
- `0002-*` (codex, composer), `0003-demo-contract-todo-pi`,
  `0004-demo-contract-todo-browser` — the browser/wa-sqlite local-first path and
  cross-workspace packaging.
- `0005-demo-contract-kanban` — the silent schema-codegen field drop.
- `0005-demo-solitaire-multiplayer`, `0006-demo-contract-solitaire`,
  `0007-demo-contract-klondike-codex`, `0008-demo-contract-pong` — multiplayer:
  handler replay, runtime-engine limits, backpressure, multi-row atomicity, and
  presence.
- `0005-demo-contract-partiful` — multi-table apps and manifest/table coupling.

A second findings pass draws on the **Valet LLP corpus** itself — its
implementation-status guide (`valet/llp/0048`) and subsystem specs — which records
what was actually built, what broke, and which decisions were reversed. Those
findings carry different provenance from the diaries (design docs and status
facts, not demo field notes) and are captured under their own heading in
[Findings from the Valet LLP corpus](#findings-from-the-valet-llp-corpus-design-docs--implementation-status).

## Research Goal

The goal is to answer a narrow question:

What exactly did Valet teach us that should change Snapback's storage, realtime,
sync, code-execution, developer-experience, or testing contracts before the first
durable implementation hardens?

The output is a set of findings, each with:

- the observed failure or success;
- who confirmed it and when (or which artifact);
- where it showed up in the system;
- whether Snapback must treat it as a hard constraint, a benchmark target, a
  non-goal, or just historical context;
- which LLP must absorb the lesson.

## Provenance Rules

Use the tags from LLP 0001:

- `[confirmed - Name, YYYY-MM-DD]` for first-hand evidence from someone who saw
  the behavior or from a recoverable artifact such as a demo diary, issue, trace,
  benchmark, log, or commit.
- `[observed]` for facts visible in Valet source, docs, demos, or artifacts.
- `[inferred]` for analysis of what a fact may mean for Snapback.
- `[unconfirmed]` for memory prompts and candidate failure modes.

The diaries are tagged `[confirmed - Valet diaries, 2026-06-25]` for the behavior
they record, with the demo-scale caveat above. When a finding becomes a design
constraint, promote the constraint into the LLP that owns the affected subsystem
instead of leaving it only here.

## Confirmed findings (Valet experience diaries, 2026-06-25)

The recurring theme across every demo is **local-optimistic vs.
server-authoritative divergence**: initial reads, query ordering/filtering, auth
context, and multi-row atomicity all behaved differently on the client replica
than on the server. Determinism between those two executions is the central
hard problem Snapback inherits, and most findings below are facets of it.

### Finding: Cold-start subscriptions don't surface existing local rows

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diaries 0000(#4),
0001, 0002-composer, 0002-codex, 0003-pi(#5), 0004 — hit independently by every
browser build.
**Area:** Sync
**Observed behavior:** A fresh `subscribe` stayed `loading` until the *next*
change notification; existing local rows were not surfaced. Every demo worked
around it by priming from `syncEngine.getAllDocs(table)` — a speculative read
racing the subscription. Pi: "the bridge should get one authoritative initial
read, not a speculative one … the kind of seam that hides a future flicker bug."
**Impact:** A data app's most common case ("subscribe and show what's there")
required a hand-rolled workaround in every single build.
**Snapback implication:** Hard constraint.
**LLPs to update:** LLP 0008 (subscription snapshot must be an authoritative
initial local read).

### Finding: Local query results diverge from server query results

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0000(#6) (local
notify used `getAllDocs(table)`, so the handler's `.order()/filter` was not
applied locally — same query, different order/results local vs. server); diary
0005-partiful(#3) (`.withIndex()` works in server handlers but the browser-local
`ctx.db` throws `withIndex is not a function`, so agents copying indexed queries
from server examples crash locally).
**Area:** Storage / Sync
**Observed behavior:** The same named query returned different results depending
on whether it ran locally or on the server.
**Impact:** Silent correctness divergence; the local replica is not a faithful
preview of server behavior.
**Snapback implication:** Hard constraint. Portability is not only SQLite↔Postgres
— it is **local-optimistic execution ↔ server execution**.
**LLPs to update:** LLP 0007 (identical query semantics across engines *and*
execution sites), LLP 0008 (the local store/matcher must run the actual query,
not a whole-table read).

### Finding: Schema codegen silently dropped fields (false model of the data)

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0005-kanban(#1,
High) with a 7-step debugging arc.
**Area:** DX / Storage
**Observed behavior:** `lane: laneStatus` (a field referencing a validator
*variable*) caused codegen to emit the `by_user_lane` index referencing `lane`
while `lane` never appeared in the table's `fields` array. Inserts succeeded; the
field was stripped at persistence; every column filter returned zero. Root cause:
the schema parser matched only `field: v.type(` literals, not `field: variable`.
**Impact:** The worst agent-DX failure mode — the system silently taught the
agent a false model of its own data. No crash, no diagnostic; the bug surfaced
only as wrong UI.
**Snapback implication:** Hard constraint. This confirms the hypothesis that
silent schema/codegen failures are more dangerous than crashes for an agent-first
product.
**LLPs to update:** LLP 0010 (codegen must error or resolve, never silently drop;
manifest completeness validated against what is actually persisted), LLP 0007
(the schema manifest must faithfully reflect persisted fields).

### Finding: Server replay ships only handler source — handlers must be self-contained

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diaries
0005-solitaire(#1, High), 0006-solitaire(arc #6 — a same-day user bug report),
0007-klondike, 0008-pong.
**Area:** Runtime / Sync
**Observed behavior:** Codegen shipped only the handler function source
(`handler.toString()`) to the server for deterministic replay. Module-level
helpers (`loadCards`, `GAME_ID`, `colorForUser`, `.then()` chains) ran fine in
the browser but threw `ReferenceError` / engine compile errors on server replay,
so connected mutations failed and optimistic writes rolled back — "tabs looked
like separate games." Non-obvious; cost ~30 minutes per agent who hit it.
**Impact:** A whole class of mutations works locally and fails on the server,
discovered only at multiplayer-truth-test time.
**Snapback implication:** Hard constraint. Confirms "handler dependencies missing
from replay bundles."
**LLPs to update:** LLP 0009 (the bundle model must actually bundle the
dependencies the runtime boundary claims to accept, or codegen must reject the
out-of-scope reference), LLP 0010 (codegen lint: warn on identifiers not defined
in the handler body).

### Finding: The pluggable runtimes were NOT interchangeable (async rejected)

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diaries
0005-solitaire(#2, High), 0007-klondike(#1), 0006-solitaire (run note: "Requires
.env with SNAPBACK_JS_RUNTIME=boa (Hermes cannot replay async handlers)").
**Area:** Runtime
**Observed behavior:** The local server defaulted to the Ibex/Hermes engine,
which **rejected `async` handlers** at push/validate time. Authors had to set
`SNAPBACK_JS_RUNTIME=boa` to use async/await.
**Impact:** The choice of code engine changed which programs were even legal —
i.e. it *was* a fork in the programming model.
**Snapback implication:** Hard constraint, and a **direct contradiction** of LLP
0000's "Both runtimes are considered acceptable; the choice is an
operational/target decision, not a fork in the programming model." Either the
engines must pass a shared language-conformance contract, or the "pluggable
runtime, one programming model" promise is false as stated.
**LLPs to update:** LLP 0009 (define a runtime conformance contract — the
language/feature floor every acceptable engine must meet), LLP 0000 (soften or
qualify the interchangeability claim).

> **Correction to the root-cause attribution (2026-06-25).** The diary run note
> framed this as "Hermes cannot replay async handlers," but the cause was the
> *execution boundary*, not the engine. Hermes has `async`/`await` and a
> microtask queue; Valet ran mutation replay inside a synchronous `eval` that
> held the database mutex for the entire handler, so an `async` handler returned
> an unresolved Promise with no microtask drain and was rejected at validation.
> Ibex already drives async to completion via `ex_hermes_poll` + `drainMicrotasks`,
> releasing the runtime lock between ticks (`[observed - Ibex source,
> 2026-06-25]`). The historical finding above — Valet *did* reject async — stands;
> the inference that Hermes is async-incapable does not. [LLP 0009](./0009-code-execution-security.rfc.md)
> §Runtime Boundary and [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md)
> §Execution and Write Semantics now adopt the poll-driven boundary as the fix,
> and Boa is dropped as an engine option (Ibex and V8 only). This is a session
> finding recorded in the cross-document review (`llp/reviews/0000-snapback.claude.md`,
> fourth Claude pass); it was ratified for the first trusted local
> implementation on 2026-06-26.

### Finding: Backpressure dropped writes and left mutations pending forever

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0007-klondike(#2,
High); related diary 0005-solitaire(#6).
**Area:** Realtime / Sync
**Observed behavior:** `dealGame` produced 52 inserts; the client flushed them as
a burst; the server's default rate limit of **50 messages/second** dropped the
last few, and the client kept those mutations **pending forever** with no
recovery. The demo set `SNAPBACK_RATE_LIMIT=1000` to paper over it. A single
mutation fanning out to ~55 queued ops was also noted as wanting a server-side
bulk path.
**Impact:** Silent permanent data loss from a normal burst; a limit that drops
without recovery is worse than no limit.
**Snapback implication:** Hard constraint.
**LLPs to update:** LLP 0008 (designed backpressure; dropped/over-limit messages
must be recoverable, never silently lost; a bulk/multi-row write path), LLP 0009
(an outbound-message limit is needed but must fail loudly, not drop silently).

### Finding: Multi-row optimistic mutations rendered partial state in other tabs

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0007-klondike(#5,
fixed); diary 0006-solitaire ("moves rolled back, tabs looked like separate
games").
**Area:** Sync / Storage
**Observed behavior:** A Klondike move touches several rows. Local-first
optimistic replay produced multiple queued writes, letting another tab render a
half-applied move. The fix was to route gameplay through **one
server-authoritative function call** and keep only single-row presence
local-first.
**Impact:** The atomic-changeset guarantee ("no half-applied multi-row state is
published") held on the server but was violated by optimistic *client*
application.
**Snapback implication:** Hard constraint. The atomic changeset boundary must
apply to optimistic client application too, not only to server commit.
**LLPs to update:** LLP 0007 (atomicity contract spans optimistic application),
LLP 0008 (the "one observable changeset" requirement is load-bearing and was
empirically broken).

### Finding: Local identity is not server auth — and they disagreed

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diaries 0000(#1, fixed —
`localAuthUserId`/`setLocalAuthUserId()` added; "the single biggest blocker to a
real offline-first demo"), 0007-klondike(#3 — local identity present but server
replay still had no `ctx.auth.userId`; "easy to mistake for server auth"),
0005-solitaire(#4 — a mutation fired on mount before auth, "joinPlayer requires
an authenticated user").
**Area:** Sync / Runtime (owned by Auth)
**Observed behavior:** `ctx.auth` was available only after a server handshake, so
a cold-start offline app could not run user-scoped sync filters; and once a local
identity existed, server replay still didn't see it, so the two executions
disagreed about who the user was.
**Impact:** Offline-first was blocked until auth context could exist locally, and
auth-dependent mutations behaved differently locally vs. on replay.
**Snapback implication:** Hard constraint. Confirms "local and server execution
disagree about auth."
**LLPs to update:** LLP 0011 (`ctx.auth` must exist offline and agree between
optimistic and server replay), LLP 0008 (replay carries and reconciles auth
context).

### Finding: Server-owned fields + runtime-captured time were secure by construction

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0000 (Part 2,
"nice").
**Area:** Storage / Runtime (success)
**Observed behavior:** `userId` came from `ctx.auth.userId` and `createdAt` from
a replay-captured runtime clock (not the app's `Date.now()`); cross-user writes
were rejected; args were validated. Security tests were "trivial to write and the
invariants held."
**Impact:** A correctness/security win worth preserving deliberately.
**Snapback implication:** Hard constraint to keep.
**LLPs to update:** LLP 0007 (system fields + runtime-clock timestamps — already
specified; this is empirical support), LLP 0009 (server owns sensitive fields).

### Finding: Honest manifests worked; `shape: "unknown"` left rows untyped

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0000 (R2
`manifest.json` with `shape:"unknown"`, `inferredReturn`, `seedStates`,
`inputsHash`; R6 `getRowSyncState` → `{syncedVersion, approxSyncedAt,
pendingMutations}`), diary 0001(#2) (rows are `any` because shape is unknown),
diary 0003-pi(#3) (`exact:doctor` caught a real staleness bug via `inputsHash`).
**Area:** DX
**Observed behavior:** The generated manifest was a clean, honest contract that
consumers projected from rather than re-declaring; the `inputsHash` staleness
marker caught a real bug. But `shape:"unknown"` meant bound rows had no type.
**Impact:** Manifest-as-contract and honest provenance are validated; typed row
shapes are a real, still-unmet want.
**Snapback implication:** Benchmark/keep + open goal.
**LLPs to update:** LLP 0012 (manifest-as-contract + capability/runtime state;
`inputsHash`-style staleness is a versioning model), LLP 0010 (doctor value
confirmed), LLP 0007 (typed row shapes).

### Finding: Manifest namespace/table coupling silently broke multi-table apps

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0005-partiful(#4,
"biggest papercut"); related diary 0005-solitaire(#3).
**Area:** DX / Sync
**Observed behavior:** `events.listRsvps` carried `namespace: "events"` while the
handler read the `rsvps` table; counts stuck at zero and the guest list stayed
empty even though the rows were in SQLite, because the data never reached the
query boundary. The fix was to move the query so codegen emitted the right
namespace. Suggested remedies: infer the table from the handler body, or add a
manifest `primaryTable`.
**Impact:** Another silent "data exists but never reaches the UI" failure.
**Snapback implication:** Hard constraint.
**LLPs to update:** LLP 0010 / LLP 0012 (the manifest must make the read-set /
primary table explicit and validated), LLP 0008 (the matcher needs the actual
tables a query reads).

### Finding: Offline codegen exited non-zero when a server URL was configured

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0000(#5).
**Area:** DX
**Observed behavior:** Codegen generated all files correctly, then failed the
server push and returned a non-zero exit code — surprising for a local/offline
build, and a false failure signal in an agent's validation loop.
**Impact:** Breaks the agent build→validate loop on the canonical local target.
**Snapback implication:** Test/DX constraint.
**LLPs to update:** LLP 0010 (local/offline tooling must exit cleanly; push
failure is a warning; provide a `--no-push`/local mode).

### Finding: Cross-workspace packaging was artisanal and defeated typecheck

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0003-pi(#2)
("`tsc` can't see `@exact/*` and exits 0 anyway … typecheck is lying about being
green"), diary 0004(#1/#4/#5) (alias duplication; isomorphic clients dragging
native modules into browser bundles; three competing wa-sqlite recipes), diary
0001(#3) (peer vs. vendored checkout diverged silently — "newer commit ≠ has the
feature"; wants capability-aware resolution), diary 0000(#2, fixed — the
"framework-agnostic" client was React-coupled by packaging).
**Area:** DX / Integration
**Observed behavior:** Consuming Snapback + the runtime from another workspace
required hand-maintained alias maps, native-module stubs, and per-demo wasm
recipes; `tsc` passed while showing real unresolved-module errors.
**Impact:** "Typecheck is theater" defeats the agent's primary self-validation
signal, and the integration cost was almost entirely packaging, not semantics.
**Snapback implication:** Hard constraint on the integration contract.
**LLPs to update:** LLP 0012 (ship real, typed, *versioned* packages — not source
aliases; a preset that owns wiring; capability-based resolution; a truly
framework-agnostic client with tree-shakeable backend selection), LLP 0010
(typecheck must be trustworthy).

### Finding: Multi-client Playwright + a deterministic harness caught the real bugs

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diary 0007-klondike
("Playwright caught the real bugs" — two-client cursor sync exposed the
server-auth mismatch), diary 0005-partiful(#4) (smoke test found unsupported
`withIndex`, wrong namespace, bad testId), diary 0004 (Vite piping the browser
console to the server log turned "blind" into "observable"; Playwright `.click()`
timed out because the Contract DOM mirror re-creates nodes per render, needing
`force:true`/direct dispatch), diary 0000 (the deterministic `SyncTestHarness`
disconnect→mutate→reconnect→`syncAll` "passed first try"), diary 0001 (the
host-ops tree is "a better test surface than a DOM" for an agent).
**Area:** Testing / DX (success + gotcha)
**Observed behavior:** The bugs that mattered were correctness-under-concurrency
bugs, and only two-client / multi-client tests surfaced them; a deterministic,
no-network sync harness covered the offline-convergence path cheaply.
**Impact:** Defines the acceptance surface that actually works.
**Snapback implication:** Test constraint.
**LLPs to update:** LLP 0010 (the acceptance ladder must be multi-client early;
pair a deterministic sync harness with a browser smoke test; provide a stable,
structured inspection/test surface), LLP 0012 (a real web-E2E story).

### Finding: Bridge glue and seeds were copy-pasted and imperative

**Provenance:** [confirmed - Valet diaries, 2026-06-25] every demo (~200 lines of
demo-local bridge per app; LLP 0088's `openSnapbackContractRuntime` /
`@expo/snapback/contract` wanted to make it first-class); diary 0003-pi(#6)
(browser seeding ran real mutations — "a `snapback seed:apply <state>` that
writes directly to the replica (bypassing mutation handlers) would make seeds
reproducible and inspectable").
**Area:** DX / Integration
**Observed behavior:** Each consumer re-implemented manifest projection +
query-state-sum adaptation + cold-start prime; seeds were imperative mutation
calls, awkward to order against codegen.
**Impact:** Repeated integration tax and non-reproducible fixtures.
**Snapback implication:** Constraint.
**LLPs to update:** LLP 0012 (ship the bridge as a first-class adapter), LLP 0010
(a declarative, handler-bypassing seed/reset path).

### Finding: wa-sqlite in the browser is a proven local store

**Provenance:** [confirmed - Valet diaries, 2026-06-25] diaries 0002-0008 ran the
full local-first replica on wa-sqlite in a real browser tab.
**Area:** Sync (success)
**Observed behavior:** The local-first engine ran in the browser on wa-sqlite,
seeded and queried, across many demos.
**Impact:** Evidence for a concrete client-local-store option.
**Snapback implication:** Context/benchmark.
**LLPs to update:** LLP 0008 (informs the "SQLite vs. IndexedDB vs. framework
storage" local-store question), LLP 0002 (browser Wasm target confirmed viable).

## Findings from the Valet LLP corpus (design docs + implementation status)

Where the diaries record what an app-builder *felt*, the Valet LLP corpus records
what the system actually *did* — and, in `valet/llp/0048`, what was built, what
broke, and what was reversed. These are tagged `[observed - Valet LLP NNNN]`.
Several confirm or sharpen diary findings; a few are new and load-bearing.

### Finding: A single mutation must commit exactly one version — Valet's per-row trigger did not

**Provenance:** [observed - Valet LLP 0001/0013] The stated contract ("every
mutation increments the version once") was implemented by a per-row
`AFTER INSERT/UPDATE/DELETE` trigger doing `version = version + 1`, so a multi-row
mutation bumped the global version **once per row** and rows from one changeset got
**different** versions.
**Area:** Storage
**Impact:** Breaks atomic changeset delivery and the "compare `_version` to a
cursor" contract that sync depends on.
**Snapback implication:** Hard constraint — do not copy the per-row trigger.
**LLPs to update:** LLP 0007 (allocate one commit version per mutation, stamp it on
every affected row and the changeset record).

### Finding: Code engines could not enforce CPU/wall-clock limits (watchdog was a stub)

**Provenance:** [observed - Valet LLP 0038/0048] Ibex/Hermes shipped **no-op**
watchdog stubs; because `eval` is a synchronous FFI call, an async wall-clock
timeout cannot preempt a handler already inside the engine. "The Hermes path is
unsafe against CPU-exhaustion attackers." Valet 0005 *claimed* 5s/300s timeouts;
that claim was fictional. The deprecated Boa engine had crude real limits (1M loop
iterations, 256 recursion depth); the default engine inherited the gap.
**Area:** Runtime / Security
**Impact:** No real containment of runaway handlers on the canonical engine.
**Snapback implication:** Hard constraint, and a **contradiction** of any claim
that Snapback "enforces an invocation wall-clock timeout" on Ibex.
**LLPs to update:** LLP 0009 (state honestly what each engine can enforce; make a
real watchdog or a killable process/isolate or the V8 path a prerequisite for
untrusted/hosted code). Related: the diary async-rejection finding (engines are not
interchangeable).

### Finding: Runtime pooling/isolation was attempted and never solved; V8 was designed and never built

**Provenance:** [observed - Valet LLP 0037/0041/0048] Valet shipped a fresh runtime
per invocation (complete isolation, allocation cost accepted). Shared-VM pooling
had no safe technique (Hermes exposes no snapshot/restore), so it became "an open
question rather than a shipped technique." The V8/`deno_core` runtime — the engine
with real isolate hygiene and CPU enforcement, intended for untrusted/hosted — was
"a trait shell that … rejects execution as `Unimplemented`."
**Area:** Runtime / Security
**Impact:** The hosting-safe execution path was the single biggest unbuilt item.
**Snapback implication:** Fresh-context-per-invocation is the durable default;
pooling is research, not a near-term optimization; hosted multi-tenant must not be
promised on Ibex.
**LLPs to update:** LLP 0009.

### Finding: Replay must transmit captured ids and time, never random

**Provenance:** [observed - Valet LLP 0001/0016] Mutations replay as
function + args + a captured environment. The client captures `{generatedIds,
randomValues, now}` but the wire transmits **only `{generatedIds, now}`** —
`Math.random()` is deliberately *not* replayed deterministically because the server
is authoritative and the client rebases. Divergent ids/timestamps would corrupt
data; divergent randoms would not, because the server wins.
**Area:** Sync / Runtime
**Impact:** This is the precise "local and server disagree about time/random/ids"
risk, already drawn correctly by Valet.
**Snapback implication:** Adopt the contract.
**LLPs to update:** LLP 0008 (replay env), LLP 0004/0007 (handlers derive
reproducible values from ids/args, not from `Date.now()`/`Math.random()`).

### Finding: Change-log retention by "GC after all subscriptions advance" grows without bound

**Provenance:** [observed - Valet LLP 0013/0021] The `_snapback_changes` table was
GC'd only after **every** active subscription advanced past a version
(`min_last_sync_version()`), with no time bound and no resnapshot escape valve — so
one slow or zombie subscription pinned the log and it grew without limit.
Reconnection sidestepped this by forcing a full sync whenever a mutation log
existed, rather than resuming from a retained version.
**Area:** Realtime / Sync
**Impact:** Confirms the change-table-growth hypothesis with a concrete mechanism.
**Snapback implication:** Snapback's instinct (version- **and** time-bounded
retention with forced resnapshot below the floor) is the correct fix.
**LLPs to update:** LLP 0008 (cite the min-watermark as the anti-pattern).

### Finding: Single-writer SQLite holds the DB lock for the whole handler execution

**Provenance:** [observed - Valet LLP 0001/0013/0021] The server held the database
mutex for the entire duration of JS handler execution (the price of transactional
consistency; "handlers should be fast"), with measured P99 write→delta latency of
**~1s under contention or many subscriptions**.
**Area:** Storage / Runtime
**Impact:** Answers the write-contention question at the mechanism level: slow
handlers serialize all writes. This is *not* a load-tested breaking point, but it
is a confirmed structural cost.
**Snapback implication:** Benchmark + constraint. Couples directly to handler
timeouts (which the engine could not enforce — see above).
**LLPs to update:** LLP 0003 (the serialized write boundary), LLP 0009 (handler
time budgets), LLP 0007 (transaction concurrency expectations).

### Finding: The portability proof and the test harness both omitted the paths that matter most

**Provenance:** [observed - Valet LLP 0007/0035/0048] The deterministic sync harness
applied mutations as **snapshots, not handler re-execution**, so handler-based
replay — the hardest correctness surface — was never exercised by it. The
machine-readable conformance corpus shipped 4 of 9 runners; the **`wire` and
`mutation_replay` runners (the ones that distinguish a local-first product) were
never built**, and the cross-engine matrix CI rig was never built, so "the trait is
portable" stayed an assertion.
**Area:** Testing / DX
**Impact:** The most product-critical guarantees were the least tested.
**Snapback implication:** Build the replay/wire test surfaces first, not last.
**LLPs to update:** LLP 0010 (sequence replay/wire conformance + handler-replay
harness early), LLP 0007 (a cross-engine conformance matrix is the portability
proof).

### Finding: CRDTs and semantic conflict policies were fully designed and never built

**Provenance:** [observed - Valet LLP 0044/0080/0048] Replay handles three of four
conflict regimes but "loses keystrokes or serializes" on true concurrent
collaborative state. The CRDT design (opt-in types, server-stamped provenance,
write-admission caps) and the semantic-conflict-policy design were both written in
full and both recorded as "design only; no code."
**Area:** Sync
**Impact:** Strong evidence that field-merge/CRDT is a large, deferrable effort.
**Snapback implication:** Reinforces deferring CRDT/collaborative-text to a later
LLP; keep a typed conflict payload and treat presence as ephemeral, not table sync.
**LLPs to update:** LLP 0008.

### Finding: BYOP was solved as stable principal + identity links; core auth tables stayed hidden and unsynced

**Provenance:** [observed - Valet LLP 0006/0042/0048] Auth resolved to
Snapback-owned **stable principal ids** plus provider **identity links**
(`_auth_identities` mapping `(provider, external_subject) → principal`), with
transactional first-login provisioning (not racing a webhook), intra-provider
verified-email merge allowed but **cross-provider email auto-link opt-in only**
(account-takeover vector). Crucially, the core `_auth_*` tables were **not synced to
clients, server-authoritative, and hidden from client types** to prevent leaks; the
portable bundle exported identity but **not** sessions, verification codes, or
secrets. RLS filter variables were resolved **once at subscribe time**, so an auth
change required a resubscribe — Valet never did mid-connection re-evaluation.
**Area:** Auth
**Impact:** A worked-out BYOP model, and a sharper line on "auth as first-class
data," and a warning that live permission-change deltas are harder than what shipped.
**Snapback implication:** Adopt the principal+identity-link model; distinguish
protected server-authoritative identity/session state from app-queryable profile
data; decide deliberately whether to build live permission re-evaluation or adopt
resubscribe-on-change.
**LLPs to update:** LLP 0011.

### Finding: Decisions Valet reversed (bank the corrections)

**Provenance:** [observed - Valet LLP 0048] Recorded reversals worth not repeating:
time-travel replay is **forward-from-snapshot** (the "walk backward applying
inverses" description was wrong); a branch merge default flipped from "parent wins
silently" to "abort with explicit override"; a durable-work `step_id` had to become
`hash(workflow_id, operation_index)` because a per-run counter broke outbox dedup
across replays; a per-operation provenance side-table was unbounded and needed
batching/compaction; secret-value hashing in audit logs was removed (low-entropy
leak); "Tier 1/Tier 2" collided across three unrelated RFCs and had to be renamed.
**Area:** Other
**Impact:** Cheap-to-avoid, expensive-to-fix design traps.
**Snapback implication:** Context now; constraints when actions/cron/branching land.
**LLPs to update:** LLP 0009/0011 (fail-loud defaults, no per-run counters in
determinism keys, distinct vocabularies per axis).

## Investigation Areas — status after the diaries

The diaries answered most of the **correctness and DX** questions below;
**production-scale** questions remain open.

### SQLite and Write Contention

- Single-writer blocking under real concurrency: **mechanism confirmed, breaking
  point still open.** Valet held the DB mutex for the *entire* handler execution
  and measured P99 write→delta ~1s under contention (see the corpus finding) — so
  slow handlers serialize all writes by design. Where that bends under real load,
  and WAL checkpoint stalls / long-lived readers, were not load-tested.
- Large local databases and schema application: the schema-applier's *silent field
  drop* is confirmed (see findings); migration pain at scale is still open.

### Realtime Pipeline

- Burst writes exceeding limits: **confirmed** (backpressure finding).
- Retention/resume correctness, change-table growth, matcher cost under fan-out:
  **still open** — not exercised at scale.

### Local-First Sync and Offline Mutation

- What is synced (query results vs. tables vs. event log): the diaries used
  query-result sync over a wa-sqlite replica; **directionally confirmed**.
- Optimistic replay vs. server authority and partial multi-row state:
  **confirmed** (atomicity finding; cold-start finding; local/server divergence
  finding).
- Conflict explainability to agents: **still open**.

### Code Execution and Isolation

- Engine startup/pooling: **partly confirmed.** Valet shipped a fresh runtime per
  invocation and accepted the allocation cost; safe shared-VM pooling was attempted
  and **never solved** (no Hermes snapshot/restore). Host-call overhead: still open.
- Per-invocation resource limits: **confirmed broken.** The engine watchdog was a
  no-op stub; CPU/wall-clock timeouts were not enforceable in-process.
- Did the runtime choice change the programming model: **confirmed yes** (async
  rejection finding), and the hosting-safe V8 engine was designed but never built.
- Did app code reach the filesystem/network/SQLite/secrets directly: not observed
  to in these (local, trusted) demos; the hosted/multi-tenant threat model is
  **still open** and owned by LLP 0009.

### Schema, Codegen, and Agent Feedback

- Silent field/codegen drops: **confirmed** (schema-drop, namespace-coupling,
  handler-self-containment findings).
- Local vs. server disagreement about auth/time/ids: **confirmed** (auth finding;
  the runtime-clock success is the counter-example to copy).

### Deployment, Operations, and Economics

- Local server lifecycle for tools: handled well by the Vite plugin in the demos
  (one `bun run dev`); **directionally fine** at dev scale.
- Idle cost / scale-to-zero and the Cloudflare-as-redesign question: **still
  open** — out of the diaries' scope.

## Finding Template

Use this shape for each new confirmed finding:

```markdown
### Finding: <short title>

**Provenance:** [confirmed - Name, YYYY-MM-DD] <source or memory note>
**Area:** Storage | Realtime | Sync | Runtime | DX | Deployment | Other
**Observed behavior:** ...
**Impact:** ...
**Snapback implication:** Hard constraint | Benchmark | Test | Non-goal | Context
**LLPs to update:** LLP NNNN, LLP NNNN
```

## Hypotheses — now resolved or still open

The earlier hypotheses, updated against the diaries:

- "The trigger/change-table/tailer/matcher shape is directionally right, but its
  retention, resume, coalescing, and matcher-cost contracts were probably where
  correctness and scale issues hid." — **Partly confirmed:** correctness issues
  did hide in the optimistic/realtime path (atomicity, backpressure, cold-start).
  Retention/resume and matcher cost **at scale** are still open.
- "Fixed-interval polling is acceptable for local bring-up but poor for
  scale-to-zero and Cloudflare." — **Still open** (not exercised).
- "Silent schema/codegen failures are more dangerous than runtime crashes for an
  agent-first product." — **Confirmed** (the kanban field drop is the canonical
  case).
- "Auth, sync, and realtime cannot be debugged as separate layers; the card-game
  and messaging apps force them together." — **Confirmed** (the multiplayer
  diaries only found the auth/replay bugs via two-client tests).

## Deliverables

- [x] At least one first-hand pass over the Valet failure areas — done, via the
  diaries, captured above.
- [x] A second pass from the Valet LLP corpus / implementation-status doc — done,
  under [its own heading](#findings-from-the-valet-llp-corpus-design-docs--implementation-status).
- [x] A list of confirmed constraints promoted into LLP 0007, 0008, 0009, 0010,
  0011, and 0012 — see the per-finding "LLPs to update," now reflected in those
  documents' revisions.
- [x] A short list of Valet behaviors Snapback explicitly chooses not to copy:
  whole-table local notification (use the actual query); silent
  drop-on-codegen (error instead); optimistic application of multi-row mutations
  without an atomic boundary (route through a server-authoritative changeset);
  rate-limit-by-silent-drop (fail loudly and recover).
- [ ] Benchmark scenarios for LLP 0010's acceptance suite at **production** scale
  (the diaries supply demo-scale acceptance shapes but no load/fan-out numbers).

## Open Questions

The genuinely unresolved questions are now the **production-scale** ones the
diaries could not reach:

- Single-writer SQLite under real concurrent write load: where does it bend, and
  does the serialized write boundary in LLP 0003 hold?
- The realtime fan-out ceiling (LLP 0000's mouse-position question): the diaries
  showed two-client presence working and a 50 msg/s default dropping a 52-write
  burst — but never stress-tested many simultaneous high-frequency clients.
- Retention/resume horizon and matcher cost under load.
- Hosted multi-tenant isolation and noisy-neighbor effects (owned by LLP 0009;
  untested in the local, trusted demos).
- Idle cost / scale-to-zero per target, and whether Cloudflare is a redesign.
- Are there Valet traces, issues, benchmarks, or commits beyond the diaries that
  should be summarized here (the LLP-corpus pass)?

## Status

Draft. The first-hand recovery is no longer a gap: both the diary findings and the
Valet LLP-corpus findings above are captured and have been promoted into the
subsystem LLPs (0007–0012). This document should stay `Draft` until the
remaining **production-scale** open questions are answered by a Snapback prototype
benchmark — the single-writer breaking point, the realtime fan-out ceiling, and
atomic cross-engine import. The recovered findings are strong enough to constrain
the first implementation now, which is what they have been used to do.
