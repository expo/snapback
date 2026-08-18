# LLP 0125: Concurrency and conflict ergonomics

**Type:** Research
**Status:** Active
**Systems:** Competitive evaluation, Developer experience, Application data API, Client integration, Runtime, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-07-30 (v0.2, round-1 dual-family review corrections —
reviews in `reviews/0125-concurrency-and-conflict-ergonomics.fable.md`
and `reviews/0125-concurrency-and-conflict-ergonomics.codex.md`; all
twenty round-1 concerns were independently verified and applied, none
refuted. Codex: "domain-typed rejections do not exist" narrowed — the
host-plan `elseError`/`guard` app-authored code channel exists and is
now inventoried, with the three rejection concepts separated; the
explicit-CAS-only conflict claim corrected (JS reads are
server-captured; a per-write-class conflict matrix added) and the
two-actor-append claim scoped to Diary 0028's protected path; the
failure-shape option space completed (client-only normalization,
settlement unions, shared SDK abstraction, status quo) and the
"highest product-value" ranking removed; action partial-effect
semantics engaged (LLP 0028/0047); option 1's de-facto-collapse claim
tempered; a per-option evidence-preservation treatment added per
LLP 0115 constraint 1; 0115 OQ6 cited; the burst synthesis
measurement-scoped. Fable: the Diary 0039 "fix held" evidence restated
in absence-of-regression form (the concurrent-insert pagination check
is Diary 0028's chat arm; 0039 ran few contention exercises); the
codes-authoritative rule re-attributed to LLP 0092; LLP 0066's fourth
retry concern corrected to terminal settlement; the Diary 0030, Swift
replay, Linux-run, Diary 0027, Dispatch-union, CV-9, and guide-quote
citations trued up; Related extended with the load-bearing documents.)
**Related:** LLP 0115, LLP 0116, LLP 0003, LLP 0017, LLP 0028, LLP 0043,
LLP 0047, LLP 0059, LLP 0066, LLP 0070, LLP 0092, LLP 0093, LLP 0094,
LLP 0095, LLP 0108, LLP 0117, Diary 0027, Diary 0028, Diary 0029,
Diary 0030, Diary 0034, Diary 0038, Diary 0039

This document is part of the Convex-parity research series:

| LLP | Topic |
| --- | --- |
| 0116 | convex-parity-research-series (overview) |
| 0117 | typescript-type-flow-parity |
| 0118 | handler-composition-and-helper-reuse |
| 0119 | reactive-by-default-and-live-search |
| 0120 | relational-composition-and-aggregation |
| 0121 | transactional-one-off-scheduling |
| 0122 | installed-product-coherence-and-packaging |
| 0123 | runtime-readiness-and-operational-edges |
| 0124 | product-breadth-storage-and-vector-search |
| 0125 | concurrency-and-conflict-ergonomics (this document) |

## Summary

In the 2026-07-28 bakeoffs, Convex's concurrency story was "pleasantly
boring" (Diary 0028): ordinary serializable mutations plus automatic
conflict retry meant zero application code for two-actor appends and
capacity races. Snapback's original arms, by contrast, had to author a
bounded retry loop around `SNAPBACK_AUTH_RESERVATION_STALE` for an
ordinary two-actor append, had to understand two distinct 409 paths to
surface one user-visible conflict, and saw a capacity-race loser
degraded to a generic `SNAPBACK_HANDLER_FAILED`.

The load-bearing correction this document must open with: **the retry
half of that complaint was fixed on 2026-07-28 and the fix has held.**
The remediation reruns in Diaries 0027 and 0028 (Snapback commit
`5f31cb61`) moved the effect-free reservation retry into the standard
JavaScript and Swift clients, the arms deleted their application loops,
and the 2026-07-30 current-main rerun (Diary 0039) passed 40/40
Snapback and 38/38 Convex checks with not a single retry- or
conflict-shaped pain among its fifteen prioritized items —
absence-of-regression evidence; the rerun ran few direct contention
exercises. What remains open is narrower and different in kind: two
inconsistent failure shapes, no closed typed rejection channel for JS
handlers (the host-plan lane can author rejection codes, but no lane
declares a failure set that reaches client types), a wide 409 code
family whose app-facing contract is taught rather than enforced, and a
burst path whose last honest measurements predate current main and
have not been re-taken.

## What Convex does

**General product background** (not diary evidence; consistent with the
pinned versions the bakeoffs used, `convex` 1.42.x): Convex executes
mutations as serializable transactions under optimistic concurrency
control. Mutations are deterministic and queued; when a commit-time
conflict is detected the server re-executes the mutation against fresh
state automatically, so application code never observes the conflict at
all. Application-level failures use a typed error mechanism
(`ConvexError` with a structured `data` payload) that crosses the wire
to clients as data, distinct from opaque internal errors.

**Diary evidence**, which is what the comparisons actually scored:

- "Concurrent sends were pleasantly boring. Two authenticated clients
  crossing one `Promise.all` barrier committed two rows with distinct
  server sequences" (Diary 0028, Convex arm). The two-client
  twenty-message burst measured **179.0 ms median, 250.5 ms p95**.
- Concurrent title mutations converged to the committed winner and
  simultaneous reorders preserved a unique `0..24` permutation
  (Diary 0027).
- "The default mutation retry contract is unusually valuable: the warm
  offline create and update settled without application queue
  infrastructure and exactly one marker committed" (Diary 0027).
- "Server errors named the function, request id, classification, source
  file, and line, which materially shortened diagnosis" (Diary 0028).
- The lessons section asked directly for parity: "a mutation promise
  should embody retry and exactly-once settlement" (Diary 0027).

Two caveats keep this honest. Convex's retry is silent: the diaries
recorded no evidence artifact of how many attempts a settled mutation
consumed. And the neighboring arms show the failure mode Snapback must
not copy: SpacetimeDB delivered intentional reducer rejections as a
generic `InternalError` with the useful capacity diagnostic buried in
logs (Diary 0030) — recorded there as a DX complaint against correct
server behavior ("the server behavior was correct, but expected domain
refusal felt like a crash at the call site") and as a lesson Snapback
is told to improve on, not as a scored defect.

## What Snapback does today

Everything in this section was verified against current main (the
`40ca18b9` review-loop working tree; first verified at the `ba752a14`
era, with the load-bearing code claims re-checked at `40ca18b9` in
this revision), not against the diaries' frozen commits.

### The two-lane conflict model

Snapback deliberately has two different conflict mechanisms, owned by
two different documents.

**Lane 1 — authorization reservation (LLP 0059, Accepted).** Every
authorization-protected write reserves a snapshot-bound authority pair
before its durable transaction. If the pair goes stale, the operation
fails *before any durable effect* with `SNAPBACK_AUTH_RESERVATION_STALE`
as HTTP 409 carrying the closed details `{retryable: true,
retryStrategy: "short-jitter", effectCommitted: false}`. LLP 0059 pins
that "a one-shot Ibex handler is never rerun merely because the
reservation became stale" — re-entry is the client's job.

**Lane 2 — commit-time read-set validation (LLP 0003, Draft).** JS
mutation reads are captured server-side; declarative host-plan
mutations that depend on an earlier client observation carry an
explicit `readSet` baseline (a deliberate version-match CAS, LLP 0003's
E3 decision — server-captured reads would be a no-op there because the
deciding read happened on the client). At commit, any invalidated
dependency rejects the whole mutation with
`SNAPBACK_MUTATION_CONFLICT`. The captured-read path
(`crates/snapback/src/storage.rs`, `captured_conflict`) attaches machine-readable
details: the failing dependency (`table`/`id`/`expected`/`actual`), the
full captured read set, and `retryPolicy: "reject"`; the explicit
`readSet` path shares the code and dependency detail but not yet the
`retryPolicy` field (LLP 0066's earlier audit, still true).

A third, smaller lane matters for races: declared unique indexes. Two
racing inserts resolve at the constraint — exactly one wins and every
loser receives the typed `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`
(`guide/backend/mutations.md`).

One rejection channel belongs in this inventory even though it is not
a conflict mechanism: declarative host-plan mutations can author their
own rejection codes — `get(..., {elseError})` and
`guard(..., elseError)` (`packages/snapback-codegen/define.mjs`) — and
storage emits those codes verbatim as structured handler diagnostics
(`crates/snapback/src/storage.rs`, the `Get`/`Guard` step failures). That is a stable
machine-readable app-authored code, not a declared failure set:
nothing closes the code union per operation or projects it into
generated client types (LLP 0066's audit — "there is no generated,
closed error union per operation"). Section (b) below builds on this
distinction.

### What the 2026-07-28 remediation fixed, and that it held

The original calibration arms are recorded honestly in the diaries:
Diary 0028's Snapback chat arm authored a bounded retry loop and wrote
"application code should not have to invent this retry loop for an
ordinary two-actor append"; Diary 0027's todo arm observed the
two-stage sequence — `SNAPBACK_AUTH_RESERVATION_STALE`, then, on replay
with the original baseline, `SNAPBACK_MUTATION_CONFLICT` — and
concluded "application code must understand two different 409 paths to
surface one user-visible conflict."

The remediation (SB-004,
`demos/backend-bakeoff/reports/remediation-1-report.md`) moved the
retry into the standard clients. On current main, verified in
`packages/snapback-client/index.mjs`:

- The mutation path retries **only** the exact closed refusal — code
  `SNAPBACK_AUTH_RESERVATION_STALE` with `retryable: true`,
  `retryStrategy: "short-jitter"`, and `effectCommitted: false` —
  never a missing fact, a different status, or anything that may have
  committed.
- The loop is bounded and configurable: default 40 attempts with
  20–80 ms uniform jitter (`reservationRetryMaxAttempts`,
  `reservationRetryJitterMilliseconds`; `1` disables).
- Every retry is pinned to the first attempt's authority/carrier
  generation; logout, user switch, or bearer replacement fails the
  operation stale rather than replaying predecessor intent as the
  successor. This rule exists because independent review of the
  remediation caught a cross-user replay hazard and a Swift
  action-replay hazard before freeze; Swift automatic replay is
  mutation-only
  (`demos/backend-bakeoff/reports/remediation-1-report.md`; pinned by
  `ClientBehaviorTests.swift`'s action-never-retries test).
- Retries are observable: a bounded diagnostic ring records
  `SNAPBACK_AUTH_RESERVATION_RETRY_SCHEDULED` / `_SETTLED` /
  `_EXHAUSTED` entries, exposed via `reservationRetryDiagnostics()` and
  `onReservationRetryDiagnostic`
  (`packages/snapback-client/reservation-retry.test.mjs` covers the
  contract).

The guide now teaches this as the paved contract and explicitly forbids
application loops (`guide/backend/mutations.md`: "Do not add an
application retry loop"). The remediation reruns confirmed the outcome
— "ordinary concurrent calls settle without app loops" (Diary 0028),
"Direct `Promise.allSettled` barriers each expose a client-owned
effect-free retry and end with one committed result plus one ordinary
`SNAPBACK_MUTATION_CONFLICT`" (Diary 0027) — and Diary 0039's rerun is
the strongest evidence the fix held, in absence-of-regression form:
all seven Snapback arms passed 40/40 checks and none of the rerun's
fifteen prioritized pain points concerns conflicts or retries. Stated
honestly, the rerun exercised little genuine two-actor contention —
its named proofs (Relay's invalid-move rollback and commit-version
evidence, Split's atomic multi-row commits) are single-actor
atomicity checks, and its scope note excludes load and latency — so
what it establishes is that no conflict-shaped pain resurfaced, not
that contention was re-measured. (Pagination staying correct across a
concurrent insert is Diary 0028's chat arm, from the remediation era,
not a rerun check.)

So on current main, an application author handles:

**(a) The demonstrated two-actor append: nothing.** On Diary 0028's
protected chat path — an authenticated handler that reads and patches
`channels.nextSequence` under an authorization reservation — the
default client absorbs the reservation contention, the losing
invocation replays against fresh state, both appends commit exactly
once, and the attempt history is available as client-side evidence.
That is the demonstrated case, not a universal: JS mutation reads are
server-captured automatically (`guide/backend/mutations.md`), so an
intervening relevant write can surface `SNAPBACK_MUTATION_CONFLICT`
with no client-supplied `readSet` — the explicit CAS baseline is one
road to that code, not the only one. When it does surface it is a real
domain signal the guide says to reconcile, never blind-retry. The
current state per write class:

- **Protected JS mutation (captured reads).** Reservation contention
  is absorbed by the default client before any durable effect;
  commit-time captured-read validation can still reject with
  `SNAPBACK_MUTATION_CONFLICT` carrying the dependency,
  `capturedReads`, and `retryPolicy: "reject"` details.
- **Unprotected JS mutation (captured reads).** No reservation
  serialization; the captured-read commit gate is the only conflict
  check, and its loser sees the same typed conflict with no client
  absorption.
- **Declarative mutation with explicit `readSet`.** A deliberate CAS;
  the loser sees `SNAPBACK_MUTATION_CONFLICT` with the dependency
  detail but not yet the `retryPolicy` field.
- **Unconditional write (no read dependencies).** Nothing to
  invalidate at commit (the reservation lane still applies if
  protected); nothing conflict-shaped surfaces and the last writer's
  version wins.
- **Racing inserts on a unique index.** Exactly one winner; every
  loser receives `SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION`.

How often server-captured reads reach commit-time conflict in ordinary
operation — rather than being serialized away by reservation
contention first — is a named empirical question (open question 6),
not something this document can assert.

**(b) A domain-constraint race such as capacity: real work, with a
shape problem.** Enforcement itself is natural — Diary 0030: "Capacity
enforcement fit naturally in one authoritative mutation. Two
simultaneous final-seat claims produced one success and one rejection."
The problem is the loser's surface, and it has to be stated per lane,
separating three concepts often grouped as "domain-typed rejection":
a stable machine-readable application code, a declaration-closed
per-operation failure set, and a generated TypeScript error/result
union. In the JS/Ibex lane a handler that throws surfaces
`SNAPBACK_HANDLER_FAILED`: `handler_envelope_code` in `crates/snapback/src/runtime.rs`
maps handler-envelope codes through a closed `SNAPBACK_*` allowlist and
collapses everything else — its own test uses a code literally named
`MADE_UP_BY_HANDLER` — to the generic code, keeping the thrown message
only as `details.message`. This is a deliberate boundary (apps must not
mint `SNAPBACK_*` codes). The host-plan lane has the first concept:
`elseError`/`guard` codes travel verbatim (see the inventory above),
though a count-shaped capacity invariant outgrows that step vocabulary
today (`Get`/`Guard` over bound rows and arguments; no aggregate step),
which is why the bakeoff arms authored capacity in the JS lane. No
lane has the second or third concept. The paved alternatives are:
declare a unique index when the invariant is key-shaped (typed loser);
author the check as a host-plan `guard(..., elseError)` when the
invariant is expressible there; or model the rejection as data in an
LLP 0108 result-contract union — a shape like
`{status: "rejected", reason: "capacity_full"}` is illustrative, not
shipped, and the nearest shipped relative is Dispatch's closed
*completion* union `{completed: false} | {completed: true, id,
trigger}` (Diary 0038), which proves the closed-union projection
pipeline rather than rejections-as-data. Diary 0030's capacity-loser
complaint stands on current main for the JS lane.

**(c) Action failure vs mutation failure: two shapes.** Verified in
`crates/snapback/src/server.rs` and `crates/snapback/src/local.rs`: the mutation route returns
`Result<Json<MutationResponse>, ApiError>` — a failed mutation rejects
with an error envelope that still carries its terminal receipt — while
the action route returns HTTP 200 with
`FunctionResponse<FunctionRunResult>`, folding handler failure into
`{ok: false, diagnostic}` (a shape inherited from LLP 0017's admin
function-runner envelope). The standard client therefore throws for
mutation failures and resolves for action failures, and application
code must check `.ok` on one call class only. Diary 0030 recorded
exactly this at the *remediated* commit, so the 2026-07-28 fixes did
not touch it. LLP 0094's schema-closure audit already lists the action
output as an open envelope family — a named, unclosed gap.

The split is not only a promise-shape inconsistency; the two failure
kinds mean different things. A rejected mutation committed nothing. An
action is not a transaction: `ctx.runMutation(...)` is not a
transaction boundary for the enclosing action (LLP 0028), and
LLP 0047's limit semantics defer to that contract — mutations an
action already committed before a failure or kill stand, and external
effects may have happened ambiguously. A unified rejection shape that
made a failed action look like a failed atomic mutation would *lose*
the partial-effect signal — exactly the class of change LLP 0115's
constraint 1 (no evidence regression) exists to catch — and it is why
the default clients never automatically replay actions (the Swift
client pins this with its action-never-retries test).

### The 409 taxonomy as a whole

`status_for_established_diagnostic_code` (`crates/snapback/src/server.rs`) maps a
large family — reservation staleness, mutation conflict, unique
violation, action generation conflict, migration and seed conflicts,
membership invariants, dozens of codes in all — to HTTP 409, with codes
authoritative and statuses advisory. That rule's stated home is
LLP 0092's HTTP status mapping ("codes are authoritative; statuses
advisory"); LLP 0094's refusal-code registry practices it without
stating it — an adoption question for the wire-contract owners. The
*taught* app contract (`guide/backend/mutations.md`) reduces the
concurrency subset to three verbs: let the client absorb `RESERVATION_STALE`,
reconcile `MUTATION_CONFLICT`, treat `UNIQUE_CONSTRAINT_VIOLATION` as
the domain duplicate. That is coherent, but it lives in prose and in
two default clients; a raw-HTTP or third-party protocol client
(LLP 0093's audience) re-inherits the full taxonomy.

### Burst-path performance

The numbers that indicted the retry loop were: Snapback two-client
twenty-message burst **4,889.57 ms median / 7,465.152 ms p95**
("includes the bounded effect-free reservation retry, so it is both
performance and ergonomics evidence") versus Convex **179.0 ms /
250.5 ms** (Diary 0028). Two facts complicate the comfortable reading
that the remediation fixed this. First, the 2026-07-29 external Linux
package run still measured "a roughly 20.9-second median" for the same
burst, and the diary explicitly says "this needs profiling rather than
being hidden by the overall pass." (Post-remediation status is a
supported inference, not a diary statement: the entry is dated after
the freeze and its 14 PASS / 1 GAP / 0 FAIL profile matches the
remediated result, not the original 13/1/1, but the diary records
neither a commit nor whether an application loop was present.) Second,
no current-main measurement exists: the Diary 0032–0039 rerun measured
correctness, not chat-burst
latency, and the frozen bakeoff performance receipts carry a known
machine-profile defect (`issues/20260729-bakeoff-performance-machine-
profile.md`). Current-main burst behavior is therefore **unknown**, and
the adjacent primitive gap is still recorded: Campfire's send derives
its sequence by scanning the room, and the rerun notes a production
chat "would need a contention-safe sequence allocation" (Diary 0034;
SB-008 deferred this in the remediation ledger).

## How they differ and what agents preferred

Convex makes contention invisible: one failure vocabulary, no
app-visible conflict for ordinary writes, and — in the one measured
bakeoff arm — fast bursts. Snapback makes
contention *visible and evidence-bearing*: closed refusal details,
receipts on rejected mutations, a client-side attempt ring, and a CAS
lane whose losses mean something.

The diaries' preference signal is more discriminating than "Convex
won." Agents disliked visibility exactly when it was mechanical — the
reservation loop, the two-409 sequence, the generic capacity failure —
and praised it when it was semantic: "The stale-read-set conflict test
was particularly crisp … easier to interpret than a provider-specific
last-write-wins convention" (Diary 0029). The remediation's design
followed that split precisely — it automated only the provably
effect-free mechanical refusal and kept every semantic outcome visible
— and the accepted result "matches the competitor outcome … while
keeping Snapback's stricter rule that only exact, effect-free
reservation refusals can replay" (Diary 0028). What is left of the
preference gap is the failure-shape inconsistency, the missing
declared domain-rejection surface, and the burst numbers.

## Option space

No final call is made here; these are the paths for what remains open.

**Option 1 — Unified app-visible conflict taxonomy.** Define one
app-facing conflict signal (one code, or one closed class) carrying a
machine-readable `cause` detail (`reservation-stale`, `read-set`,
`unique-key`, …) instead of asking apps to know N distinct 409 codes.
The distinct codes carry real evidence value — they distinguish
"no effect, safe to replay" from "effect refused for a reason you must
reconcile," and acceptance suites assert them exactly — so the
simplification must keep the precise code in the diagnostic/receipt
layer and change only the *contract apps are taught to branch on*.
What exists today is narrower than a de facto collapse: the default
clients remove one mechanical member (the reservation-stale refusal)
from the app-visible taxonomy and synthesize no common conflict class
— `SNAPBACK_MUTATION_CONFLICT` and
`SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION` remain distinct app-visible
errors. So the work is choosing and specifying the actual abstraction
— a wire-level member, an SDK error superclass with a discriminated
`cause`, a helper predicate, or a generated operation failure union,
each with different compatibility and evidence consequences — for
protocol clients too (LLP 0093/0094 territory) rather than leaving it
as guide prose.

**Option 2 — Domain-typed rejections as a first-class authoring
surface.** Let a handler declare failure variants
(`capacity_full`) beside its result contract, so a domain rejection
reaches every client as typed data instead of
`SNAPBACK_HANDLER_FAILED`. This is the direct fix for Diary 0030 and
the analog of Convex's `ConvexError`, but done declaration-first: the
variant set becomes part of the generated contract and the TypeScript
flow (LLP 0117's territory — a declared failure union is only useful
if it reaches client types), and the runtime allowlist stays closed
because declared variants are app data, never minted `SNAPBACK_*`
codes. The carrier is itself a design choice with at least three
shapes: extend the existing host-plan `elseError` mechanism to JS
declarations (one app-code channel across both lanes); carry declared
variants in the existing error envelope plus a generated,
operation-scoped application-code union; or add a distinct envelope
member. In section (b)'s three-concept split, this option supplies the
second and third concepts on top of the code channel the host-plan
lane already has. LLP 0108 is the natural owner; its result-union
machinery already proves the projection pipeline works. The main
design questions are throw-shaped versus return-shaped authoring,
which carrier, and how a typed rejection interacts with the atomic
no-commit rule.

**Option 3 — Resolve the action/mutation failure-shape split.** A
family of materially distinct paths, not one migration:

- **3a — Migrate the action route to rejection.** Actions reject with
  a structured diagnostic envelope like mutations, retaining the
  complete `FunctionRunResult` evidence inside the error envelope.
  Rejection is the already-documented mutation semantics; note that
  the guide's "the action error remains a structured diagnostic
  envelope" is authoring posture (throw rather than launder failure
  into fake success), not a statement about the route's
  200-`{ok:false}` transport, so it supports the posture but not
  specifically this wire change. LLP 0094 owns the wire change and
  already flags the action output as an unclosed family; the cost is
  a breaking client change (every `.ok` check in existing arms), so
  it likely needs a negotiated envelope version rather than an
  in-place flip.
- **3b — Migrate mutations toward settlement.** Mutations resolve a
  discriminated settlement union instead of throwing — the inverse
  unification, with the same blast-radius question in the other
  direction.
- **3c — Client-only normalization.** Keep both wire shapes and let
  the generated clients normalize them into one settled surface. No
  wire break; raw-HTTP and third-party protocol clients (LLP 0093's
  audience) keep the split.
- **3d — A shared client-level result abstraction.** A common
  `Result`/error superclass or helper predicate across both call
  classes, without changing either route or the per-operation
  generated surface.
- **3e — Status quo, better taught.** Keep the split as a deliberate
  semantic marker and invest in generated helpers and guidance. Given
  the remediation's success, this is a real option with the lowest
  migration risk, not merely an absence of action.

Rejection-as-success-data through LLP 0108 result unions (option 2's
territory) is complementary to all five. One constraint cuts across
every path: mutations and actions genuinely differ in failure
semantics — a rejected mutation committed nothing, while a failed
action may stand on committed nested mutations and ambiguous external
effects (LLP 0028; LLP 0047) — so any unified surface must preserve
the partial-effect distinction rather than implying shared atomicity.

**Option 4 — Automatic retry as a declared, evidenced contract.**
Snapback's answer to Convex's *silent* server-side retry: keep retries
out of app code but make them visible in evidence. Pieces that exist
today: the client ring (attempts, jitter, outcome), `clientMutationId`
exactly-once identity (LLP 0043), and LLP 0066's four-concern
decomposition (failure eligibility / retry schedule / delivery
evidence / terminal settlement — idempotency is LLP 0043's separate
concern, already covered by the previous piece). Pieces
that do not: any server-side receipt of how many attempts a settled
write consumed (the ring is client-custody only), a declared per-app or
per-function policy surface, and an answer to LLP 0003's still-open
Draft question — its own text contemplates "retry the deterministic
handler against fresh state" server-side, which LLP 0059 currently
forbids for reservation staleness and nothing implements for read-set
conflict. A deliberate contrast with Convex is available here: retries
visible in receipts, invisible in application code.

**Option 5 — Contention performance as a product surface.** Profile
the burst path before designing anything: the 0028 numbers are stale,
the post-remediation Linux number (20.9 s) is alarming but from one
uncontrolled host, and current main has no measurement — the reruns
dropped burst timing and the frozen receipts carry the machine-profile
defect. The work is a normalized-profile burst benchmark (the bakeoff
final report already lists "make the fast path actually fast" as
improvement 7), then the primitives the profile implicates: per-write
reservation cost under same-room contention, jitter tuning, and a
contention-safe sequence-allocation primitive so append-heavy apps stop
scanning to derive order (Diary 0034; deferred SB-008).

Run against LLP 0115's governing constraint 1 — closing a DX gap must
not silently discard the corresponding evidence — each option carries
a named evidence obligation:

- **Option 1** must keep the exact diagnostic code, refusal details,
  and retry eligibility in the diagnostic/receipt layer while
  collapsing only the taught branching contract; a `cause` that hid
  the precise code would be a regression.
- **Option 2** must not let a declared variant drop the structured
  diagnostic detail or the terminal receipt a rejected mutation
  carries today; typed data is additive, not a replacement.
- **Option 3** must preserve the partial-effect/ambiguity signal that
  distinguishes action failure from atomic mutation rejection; 3a must
  also keep the full `FunctionRunResult` evidence, and 3c/3d must keep
  raw-protocol observability honest about the underlying shapes.
- **Option 4** must keep attempt custody explicit — a server-side
  retry that erased the client ring's attempt history or weakened
  authority-generation pinning would trade evidence for ergonomics,
  and LLP 0003's deterministic re-execution carries new determinism
  obligations before it may exist at all.
- **Option 5** adds evidence (normalized burst receipts) and risks
  none.

Options 1–3 are mostly independent; option 5 is the prerequisite for
any performance claim in a future rerun. Sequencing and relative value
among them is LLP 0115's call (its open question 6), not this
document's.

## Findings

1. The original two loudest complaints — the application-authored
   reservation retry loop (Diary 0028) and the two-409-paths-per-
   conflict experience (Diary 0027) — were fixed in the 2026-07-28
   remediation (client-owned effect-free retry, JS + Swift), and the
   fix held through the 2026-07-30 rerun in absence-of-regression
   form: 40/40 checks across seven arms and no conflict pain in Diary
   0039's fifteen prioritized items, though the rerun ran few direct
   contention exercises.
2. The current-main retry contract is code-verified: default clients
   retry only the exact closed `SNAPBACK_AUTH_RESERVATION_STALE`
   refusal (`retryable`/`short-jitter`/`effectCommitted:false`), 40
   attempts, 20–80 ms jitter, authority-generation-pinned, with an
   observable diagnostic ring (`packages/snapback-client/index.mjs`,
   `guide/backend/mutations.md`).
3. `SNAPBACK_MUTATION_CONFLICT` on current main is a semantic signal,
   not noise: it reaches apps only via deliberate CAS baselines or
   captured-read invalidation, carries dependency details and (on the
   captured path) `retryPolicy: "reject"`, and agents rated its
   evidence above last-write-wins alternatives (Diary 0029).
4. JS/Ibex handlers lack a declared, closed, per-operation rejection
   union that reaches generated client types: `handler_envelope_code`
   (`crates/snapback/src/runtime.rs`) collapses every non-allowlisted handler-thrown
   code to `SNAPBACK_HANDLER_FAILED`. The host-plan lane already emits
   app-authored `elseError`/`guard` codes verbatim, but no lane has a
   declaration-closed failure set or a generated failure union. The
   paved alternatives are unique indexes (typed), host-plan
   `elseError`/`guard` where expressible, and result-union
   rejections-as-data (LLP 0108). Diary 0030's capacity-loser
   complaint stands for the JS lane.
5. The action/mutation failure-shape split is structural and current:
   actions settle HTTP 200 `{ok:false, diagnostic}`
   (`FunctionRunResult`, `crates/snapback/src/local.rs`), mutations reject with a
   receipt-carrying error envelope (`crates/snapback/src/server.rs`); LLP 0094 lists
   the action output as an open envelope family. Also observed at the
   remediated commit, so the remediation did not address it. The
   shapes differ in semantics, not just style: a rejected mutation
   committed nothing, while a failed action may stand on committed
   nested mutations and ambiguous external effects (LLP 0028;
   LLP 0047), so unification must not imply shared atomicity.
6. Burst performance is unmeasured on current main. Last data: 4,889.57
   ms median / 7,465 ms p95 (pre-remediation macOS, Diary 0028) and
   ~20.9 s median (the external Linux run — post-remediation by
   supported inference, same diary, explicitly flagged "needs
   profiling"). The rerun measured no burst latency, and the frozen
   receipts have a machine-profile defect.
7. LLP 0115 schedules none of the remaining items as CV work: its
   retired-gaps list correctly excludes conflict ergonomics from the
   fixed set, and no CV item covers failure-shape unification,
   domain-typed rejections, or burst profiling. But the plan already
   names exactly this cluster: its v0.4 open question 6 records the
   unowned remainder, citing this document, pending the author's
   absorb-as-CV-16/CV-17-versus-delegate decision. The ground is
   tracked, not scheduled.

## Confidence

High confidence: the remediation history and its persistence (the two
remediation rerun records, Diaries 0027 and 0028, plus the 2026-07-30
seven-arm rerun's silence); the current-main
client retry contract, conflict emission details, handler-code
allowlist, and route shapes (all read directly from code this session);
the guide's taught contract. Medium confidence: the claim that
captured-read conflicts are rare in ordinary JS-handler operation
(inferred from the staging choreography and diary observations, not
from a measurement — open question 6). Low confidence: anything about
current burst latency (finding 6 — deliberately marked unknown), and
the Convex
general background beyond what the diaries recorded, which is stated at
my knowledge cutoff and against the pinned bakeoff versions rather than
re-verified upstream.

## Open questions

1. Should the app-visible conflict contract be one signal with cause
   detail (option 1), and if so, is it specified in LLP 0094's envelope
   or as a client-conformance rule in LLP 0095?
2. Throw-shaped or return-shaped domain rejections (option 2), and can
   a declared failure variant share the result contract's projection
   and hashing machinery without weakening the no-commit atomicity
   rule?
3. Which of option 3's paths wins — and for the wire-changing ones,
   does the action envelope migration ride LLP 0093's protocol
   negotiation or a versioned route, and what evidence must remain
   available when an action fails after a nested mutation or external
   effect has already occurred?
4. Does LLP 0003's contemplated server-side deterministic re-execution
   ever become worth its determinism obligations, or is the settled
   division (client replays effect-free refusals; semantic conflicts
   always surface) the permanent answer? LLP 0003 is still Draft with
   this question open.
5. What does the normalized burst profile attribute the tail to —
   reservation acquisition, retry jitter, sequence-scan reads, or
   commit serialization — and does the answer change option 5's
   primitive list?
6. Under which execution and reservation profiles can server-captured
   JS reads reach commit-time conflict without first being serialized
   by reservation contention, and how often does that happen in
   ordinary operation? (Empirical; the Confidence section's
   medium-confidence rarity claim awaits it.)

## Relationship to LLP 0115 and owning documents

LLP 0115 governs sequencing; this document feeds it evidence. The
conflict-ergonomics complaints are deliberately *absent* from 0115's
retired-gaps list (they were fixed before the rerun, so the rerun had
nothing to retire) and equally absent from its work items — the closest
neighbors are CV-6 (result contracts as paved default, the natural
carrier for option 2's authoring surface) and CV-9 (transactional
one-off scheduling, the `runAfter`-class primitive; its owner
LLP 0070's attempt policy is adjacent to option 4's retry-evidence
design). The plan's v0.4 open question 6 already names this document's
remainder cluster for author adjudication — absorb as new CV-16/CV-17
items or delegate to the owning documents. If any option here
graduates to work, it enters 0115's frame through that decision with a
named owner rather than being folded silently into an existing item.

Owning documents, confirmed this session: **LLP 0059** (Accepted) owns
reservation semantics and the effect-free retry contract, including the
2026-07-26 revision that made contention an explicit retryable 409;
**LLP 0003** (Draft) owns read-set validation, the E3 client-baseline
CAS decision, and the open automatic-retry question; **LLP 0094** owns
wire envelopes and already records the action-output gap; **LLP 0108**
owns result contracts, the base for rejections-as-data; **LLP 0043**
owns client mutation identity/idempotency; **LLP 0066** (research)
holds the retry-policy decomposition option 4 builds on; **LLP 0070**
(Draft) owns attempt policy for durable background work; **LLP 0092**
states the codes-authoritative/statuses-advisory rule; **LLP 0028**
(Accepted; with LLP 0047's limit-semantics deferral) owns the
actions-are-not-transactions contract option 3 must respect. Per
0115's governing constraint 3, substantive design for any option lands
in those documents (or a new owned Spec), not here.
