**Reviewer family:** Claude
**Provider / runtime:** claude-code session (Claude Fable 5)
**Date:** 2026-07-09
**Redacted:** No — full local repository access; `.agent-local-secrets.md` was
not read.
**Method:** Interactive fresh-session review; this session did not author
LLP 0051 (the draft names Claude as co-author from another session, so this is
the same-family fresh-session leg of the LLP 0005 loop, run alongside an
independent GPT-5/Codex review). Verification-driven: ~35 of the draft's
factual claims were checked against `src/`, `packages/`, `schemas/`, `tests/`,
`demos/`, and the LLP corpus, directly and via three read-only search
subagents. The GPT-5 review ran concurrently; its blocking finding (the Ibex
deterministic-member asymmetry) was independently re-verified here before
inclusion and is credited where it originated. Review of the working-tree
draft as of 2026-07-09, before revision.

# Review: LLP 0051 — The language-neutral data tier

## Overall assessment

This is a good RFC proposing the right thing, and its central analysis
survives adversarial checking: the three declared gaps (Parity clients,
non-JS clients, Cloudflare handler updates) really do share the
"handlers are JS strings" root, and the machinery the design leans on —
the schema-versioned `HostPlan`/`ValueExpr` IR, the single
`dispatch_host_call` seam, the DK-7 schema pipeline, the twin harness —
exists as claimed, mostly at the exact lines cited. The re-litigation of
LLP 0020's demotion is done honestly (it answers that plan's recorded
open question rather than silently contradicting a constraint), and the
hard lines it keeps — no client-side JS engine, no interpreter-in-WASM,
server-authoritative sync unchanged, LLP 0034 §7 fence honored — are the
right ones.

It should not be accepted as drafted. One load-bearing Context claim is
false (the ambient-determinism story on Ibex), one acceptance gate is
unsatisfiable as written (all-aboard's mutations cannot express in the
proposed IR profile), and D2 needs to engage the LLP 0032 DK-1/E3
decision it is effectively extending — a decision that is itself still
pending ratification. All are fixable by revision; none undermine the
direction.

## Strengths

- **The Context section is unusually well-grounded.** Spot-checks land:
  `FunctionRuntime`/`MutationPlan`/`ValueExpr` (`src/manifest.rs:361-371,
  774-815`), `optimistic_replay: false` (`:1033`), frozen `runtime.now` /
  fresh UUIDv7 `runtime.id` (`src/runtime.rs:537,556`,
  `src/storage.rs:2305`), the ~5,200× DK-3 figure (`llp/0008:230`), the
  DK-9 revisit trigger quoted almost verbatim (`llp/0008:422-424`), the
  LLP 0020 demotion text and open question (`llp/0020:97-102, 488-489`),
  the LLP 0014 platform facts at the exact cited lines, the envelope
  strictness divergence documented at `envelope.mjs:8-15`, and codegen's
  valet-trap header (`packages/snapback-codegen/index.mjs:3-5`).
- **D7's core claim is true and verified:** `execute_mutation` evaluates
  plans natively inside one SQLite transaction with read-set validation
  in the same tx (`src/storage.rs:557-580`). "The host executor *is* the
  lowering" is accurate today, not aspirational.
- **The D1 mechanism has an in-repo precedent the draft doesn't even
  claim:** cron invocations already construct the runtime with a
  *supplied* clock (`now_ms: run.due_at_ms`, `src/runtime.rs:384`), so
  "answers come from outside the handler" is proven plumbing, not a new
  idea. `HostCallTraceEntry` (`src/runtime.rs:852-859`) is, as the draft
  says, the same seam already recording answers.
- **The tier-ladder posture is honest.** IR for the 80%, JS/WASM above
  it, fail-closed codegen, `live_replace` as the fallback for
  unanalyzable filters, capability flags gating every Parity claim on
  the replay corpus — the design consistently prefers honest fallback
  over silent approximation, matching the repo's established style.
- **The Cloudflare section draws the right line** between runtime IR
  interpretation (data, permitted) and the rejected interpreter-in-WASM
  path (`llp/0014:452-455`), and correctly notes deploy-time-only WASM
  bindings. The pre-emptive "cite both to prevent conflation" note is
  good hygiene.
- **Increment 1 (D4) is real and cheap.** The live kinds are confirmed
  absent from `schemas/` while `demos/_kit/client.mjs:734-777`
  string-dispatches them; single-sourcing them extends an existing,
  proven mechanism (`tests/artifact_schemas_v0.rs`, `snapback-schemagen`)
  rather than inventing one. Declining to carve a `snapback-protocol`
  crate yet is the right restraint for a single-crate repo.

## Concerns

- **major — The "banned on both engines" determinism claim is false on
  Ibex, and D1 stands on it.** (Flagged first by the GPT-5 review;
  re-verified here.) The runtime denial is asymmetric *by design* in v1:
  the V8 strip denies `Date.now`/`Math.random`/zero-arg `new Date()` at
  runtime, while Ibex still exposes them and relies on the LLP 0009
  *codegen* ban — pinned as a declared engine fact by
  `tests/workerd_twin_v0.rs:271-325` ("existing watchdog tests depend on
  handler-visible `Date.now`") and recorded in `llp/0048:370-373`. The
  Ibex runtime denial covers allowlist *globals* only
  (`src/runtime.rs:1421-1495` reads `bannedEverywhere.globals`; the
  `members` list is enforced only by the V8 strip). So "the environment
  simply has no random source to leak" is true on workerd and false on
  the canonical local engine. **Resolve by:** correcting the Context
  bullet, and either making Increment 2 include closing the Ibex
  member gap or explicitly scoping JS-tier ledger fidelity to
  codegen-clean handlers with the declared asymmetry called out. Note
  the closure must be scoped to the deterministic tier
  (queries/mutations): the tests that depend on handler-visible
  `Date.now` are *action*-class wall-clock busy-waits
  (`tests/action_watchdog_v0.rs:56-57`), which a frozen
  `ctx.runtime.now` can never drive — actions are outside D1's scope
  and should keep today's surface. IR and WASM tiers are unaffected —
  one more argument for them.
- **major — Increment 3's demo gate is unsatisfiable under the drafted
  profile.** All three all-aboard mutations loop: clear-table via
  query-all-then-delete-each (`demos/all-aboard/snapback/handlers.mjs:
  468-470, 497-499, 538-540`), insert-per-element over an
  arbitrary-length `departures` array (`:500-517`), and per-pattern
  patches (unrollable, but only because `PATTERN_IDS` is a compile-time
  constant). The proposed step set (`Get`/`Guard`/`Let` + Insert/Patch/
  Delete) has no iteration and no set-oriented operation, so "the todo
  and all-aboard demo mutations express entirely in IR" cannot pass.
  Meanwhile todo-v2 *already* expresses every mutation as a plan
  (`demos/todo-v2/snapback/functions.mjs:47-84`) — the gate as written
  is simultaneously too hard (all-aboard) and already met (todo-v2).
  **Resolve by:** either extending D2 with closed set-oriented steps —
  `DeleteWhere { table, filter }` and an insert-per-array-element form
  (bounded by input size, statically analyzable per step; clear-and-
  replace is arguably *the* canonical feed-app mutation) — or re-scoping
  the gate to todo/todo-v2 and naming all-aboard's snapshot mutations as
  the honest JS-tier examples. Related: the pinned function library
  lacks `round` (and `floor`/`ceil`) while every all-aboard clamp uses
  `Math.round`.
- **major — D2 extends a decision that is still pending ratification,
  without saying so.** LLP 0032's DK-1/E3 leg decided **Option A**
  (client-supplied baseline is the host-plan isolation mechanism *by
  design*) on 2026-07-02, explicitly recording Option B — the very
  `Get`+`Guard` shape D2 proposes — as a future extension with named
  costs: "a precondition language, portability, codegen, diagnostics"
  (`llp/0032:552-571`). The RFC cites LLP 0003's Option B text but not
  the E3 decision, which is "pending Charlie's ratification nod." Two
  consequences: (a) the RFC should say it is deliberately paying
  Option B's four named costs and why now; (b) the E3 rationale comment
  at `src/storage.rs:570-579` — whose premise is that plans are
  *unconditional* write sequences — becomes false the day `Get` lands
  and must be updated with the code. Sequencing question: does D2's
  acceptance want the E3 nod first, or does accepting this RFC subsume
  it? Also: LLP 0032 is absent from the Related list despite Q1
  proposing its docket as the governance venue.
- **major — "Replay" covers three different read semantics and the rule
  is never stated.** Ledger replay pins `{ids, now, principal}` but DB
  reads are (correctly) never ledgered — so LLP 0043 queue replay
  re-reads fresh server state (rebase semantics), corpus replay reads
  pinned initial rows (exact-output semantics), and client overlay
  evaluation reads the retained cache (approximation; the server result
  supersedes). The design handles each correctly in its own section,
  but a reader of D1 alone can take "replayable" to mean bit-exact
  reproduction, and D6's "idempotent and convergent by construction"
  edges toward implying client/server agreement. **Resolve by:** one
  paragraph in D1 stating the rule (answers are ledgered; reads
  re-evaluate against the executing tier's current view) and a D6
  sentence on the divergence story: a locally-evaluated `Guard` may
  pass/fail differently than the server's — what does the UI show
  between optimistic overlay and authoritative failure?
- **minor — D8 overstates the MCP catalog.** No code emits an MCP
  catalog today; `dryRunSupported` is a *designed* per-entry field in
  LLP 0024's pinned entry shape (`llp/0024:401`) and LLP 0042 (Draft,
  `llp/0042:78-81`). "The generated MCP catalog already carries…"
  should be "the designed catalog entry shape carries…".
- **minor — misplaced citations.** (1) The live kinds are hand-written
  in `src/local.rs` (`LiveUpdate` with a `String` kind, `:357-363`;
  construction at `:1037/:3161/:3257`) and `src/ephemeral.rs`
  (`:776/:2564`), with the socket *client* enum in `src/server.rs:2254`
  — not "hand-written serde in `src/server.rs`". Substance unaffected.
  (2) LLP 0003's injectable-ids text is at `:374-375`, not `:376-377`.
  (3) The capitalized Online/Parity vocabulary is defined in
  LLP 0012:332-335 (the adapter reports it via
  `SNAPBACK_CONTRACT_CAPABILITY_CLASS`); LLP 0008 uses only lowercase
  descriptive phrases. (4) The allowlist framing "survivor probe on
  Ibex, harness strip on V8" is loose — both legs run survivor probes
  (`strip.mjs:273-277` throws `SNAPBACK_V8_GLOBAL_STRIP_INCOMPLETE`);
  the real split is deny-stubs-for-globals (Ibex) vs strip (V8), with
  members V8-only per the first concern.
- **minor — D3's `cpu_budget: Enforced` teaser is dishonest at target
  granularity.** (GPT-5 finding, verified.) Resource-limit rows are
  per-target: local `cpu_budget` is `Missing` (`src/manifest.rs:
  1076-1079`) and local query/mutation `wall_clock_timeout` is *also*
  Missing (only `action_wall_clock_timeout` is Enforced). While
  `IbexModule` handlers remain supported locally — which this RFC
  guarantees — the target row cannot flip to Enforced because one
  artifact class has fuel. **Resolve by:** per-artifact-class limit
  reporting (a `WasmModule`-scoped row) or rewording to "WASM
  invocations gain enforceable fuel/memory caps; target rows stay
  honest."
- **minor — "host-op table" collides with an existing name.**
  `src/host_ops.rs` is the LLP 0024 *operating surface* (`app.inspect`,
  `app.reset`, … over `POST /_snapback/api/host-ops`) — a different
  seam from the handler ctx host-call op set in `dispatch_host_call`
  (`src/runtime.rs:880-909`) that D3 means. Name the D3 seam "the ctx
  host-call op set" to prevent conflation.
- **minor — the corpus infrastructure D5/Increments lean on is designed,
  not built.** `tests/conformance/` holds exactly one file, the twin's
  JS handler corpus; no `$NOW`/`$ID` placeholder exists anywhere under
  `tests/`. LLP 0010 specifies the machine-readable corpus; nothing
  implements it yet. Increment 2's "twin corpus cases" work today;
  Increment 3's "corpus profile cases" quietly includes standing up the
  LLP 0010 case format/runner — say so, or stage profile cases through
  the twin harness first.
- **minor — WASM determinism needs a named strict profile.** "Same bytes
  eliminate cross-engine semantic drift" holds for core WASM modulo NaN
  payload bits, and only if nondeterministic features (threads,
  relaxed-SIMD, WASI clocks/random) are excluded. Pin: feature
  allowlist, NaN canonicalization at the host boundary, trap → typed
  error mapping — as D5 corpus cases.
- **minor — ledger mechanics underspecified.** Exclude `runtime.log`
  (diagnostics, per the twin's existing strip); cap ledger length as an
  LLP 0047-style declared limit (a JS handler can call `runtime.id()`
  in a loop); and specify the auth entry as the resolved auth context
  plus LLP 0043's fingerprint, aligned with LLP 0039's `AuthContext`
  shape and its `SNAPBACK_AUTH_STALE_RESULT`-class mismatch diagnostics
  (GPT-5 finding; verified against `llp/0043:131-136`).

## Suggestions

- Cite the cron supplied-clock precedent (`src/runtime.rs:384`) in D1 —
  it turns "new mode" into "second consumer of existing plumbing."
- Version the data tier explicitly: an IR-profile/ledger-format version
  pinned in manifests, ledgers, and corpus cases, so pre-extension
  ledgers replay correctly after `ValueExpr` grows (GPT-5's
  `dataTierProfile` suggestion; fits DK-7's schema-versioning habit).
- Enumerate D5 rejection-case classes: malformed plan, unsupported
  expression form, ledger exhaustion/overrun, auth-fingerprint
  mismatch, stale artifact hash, plan-size/depth over limit.
- State plan resource bounds in D2 (max steps, expression depth, plan
  byte size) — they're what makes "runtime-updatable data on CF" safe
  to claim, and they're corpus-pinnable.
- Add LLP 0032 (DK-1/E3, docket venue) and LLP 0039 (AuthContext) to
  Related; cite LLP 0012 for the Online/Parity class vocabulary.
- In D6, say plainly that widget refresh-time reads mean *local IR
  query evaluation over the retained cache* — it's the one place the
  RFC quietly commits to client-side query (not just mutation)
  evaluation, and it deserves its own sentence.

## Open questions

- Does D2's acceptance subsume LLP 0032 E3's pending ratification, or
  should E3 be ratified first? (Process, but it decides whether
  `Get`/`Guard` is "extension" or "reversal.")
- Where do WASM bytes live operationally — artifact storage trust,
  signing, per-target binding manifest? (D3 names the storage model but
  not the trust chain; GPT-5 raised the same.)
- What is the client-side story when a locally-evaluated `Guard` and
  the server disagree — overlay rollback UX, error surfacing, retry?
- Which ledger fields cross the wire (LLP 0043 M2 pins `{generatedIds,
  now}`) vs. stay server-side (principal fingerprint, trace)? A table
  would settle it.

## Recommended next step

Revise and stay `Draft`. The direction is right and most of the draft
survives verification, but the Ibex-determinism correction, the
demo-gate rewrite (with or without set-oriented steps), the LLP 0032
E3 engagement, and the replay-semantics rule are each load-bearing
enough to want the revised text re-read — by the author and ideally one
more cross-family pass — before `Accepted`. The Exact-side counterpart
(0329 r3 per §Relationship) should be revised in the same pass so the
two documents don't skew.

---

<!-- Orchestration note (2026-07-09, second round): the session that ran this
review loop authored the r2 revision and is therefore disqualified as an
independent reviewer for this round (LLP 0005 rule). It launched the
fresh-context Fable agent below as the in-family independent leg, alongside a
second codex round (dated section in the .gpt-5.md artifact) — the same
pattern the Exact 0329 loop used. The agent's final message follows verbatim,
including its own provenance header. After both rounds were received, the r3
revision was applied at the author's explicit request ("revise as you think
appropriate"). -->

# Re-review (r2): LLP 0051 — The language-neutral data tier

**Reviewer family:** Claude
**Provider / runtime:** claude-code session (Claude Fable 5), fresh context — this session did not author LLP 0051, its r2 revision, or any revision of Exact LLP 0329.
**Date:** 2026-07-09
**Redacted:** No — full read access to this repository and the sibling Exact checkout; `.agent-local-secrets.md` was not read in either repo.
**Method:** Re-review of the r2 working-tree draft (810 lines, revised 2026-07-09) against: both round-1 artifacts (`llp/reviews/0051-*.{claude,gpt-5}.md`), the Exact-side companion at r4 (`/Users/ccheever/projects/exact/llp/0329-snapback-language-neutral-data-tier.rfc.md`) and all dated sections of its two review artifacts (`exact/llp/reviews/0329-*.{codex,fable}.md`, including both "Adversarial review of r3" sections), and direct source verification of every r2 change plus the gate-(b) corpus: `demos/all-aboard/snapback/handlers.mjs` (full transcription analysis of the three mutations), `demos/todo{,-v2}/snapback/`, `src/manifest.rs`, `src/storage.rs`, `src/runtime.rs`, `packages/snapback-harness/allowlist.json` + `workerd/strip.mjs`, `packages/snapback-codegen/index.mjs`, `tests/{workerd_twin_v0,action_watchdog_v0}.rs`, `tests/conformance/`, `schemas/`, and the cited passages of LLPs 0003, 0008, 0010, 0012, 0014, 0020, 0024, 0032, 0039, 0042, 0043, 0047. Claims below marked "verified" were checked directly this session; "inference" is labeled where used.

## Overall assessment

r2 is a conscientious revision: I verified each round-1 finding against the new text and the repository, and all but one are correctly and completely applied — several (the E3 engagement, the reads-are-never-ledgered rule, the per-artifact-class limit rows) are now among the strongest passages in the document. The design spine — promote the IR, ledger the ctx answers, WASM above, schemas below, corpus as the contract — survives a second adversarial pass intact, and nothing in this review challenges the direction.

Two things keep r2 from being the revision to accept.

First, **it is out of lockstep with its companion.** Exact LLP 0329 moved to r4 *after* 0051 r2 was written, and r4 made a structural decision 0051 does not reflect: the Contract mutation grammar was demoted from committed work to an evidence-gated option, with the typed `define.mjs` builder as the first-class authoring surface until a falsifiable trigger fires (0329 r4 §Summary, §Increments "Option track"). 0051 r2 still leads its Summary, its D2 "front-end fix," and its D8 agent story with Contract source, and its §Relationship section describes 0329 as an r2 awaiting corrections that r3/r4 already applied. Every one of these must change for the pair to be readable as one design.

Second, **the rewritten Increment 3 gate (b) is still unsatisfiable — the r2 fix was necessary but not sufficient.** The set-oriented steps (`DeleteWhere`/`InsertEach`) were the right addition, and they do rescue the clear-and-replace *cores* of the all-aboard mutations. But I performed the transcription analysis independently (details under New concerns, N1): of the three mutations, only `resetFeed` expresses entirely in the drafted profile. `applyLiveFeedSnapshot` contains a conditional write the profile *permanently excludes by its own text*, and both it and `applyFeedTick` return computed objects that no drafted `ReturnValue` or `ValueExpr` form can build. This is the same finding the 0329 r3 adversarial round reached by experiment and that r4 explicitly proposes as a flow-back to 0051's gates (b)/(c) — my independent check confirms the flow-back is correct and must be taken.

Both problems are reconciliation-plus-one-gate-rewrite work, not redesign. The r2 document is close.

## Round-1 concerns: resolution check

1. **Ibex deterministic-member asymmetry (round-1 blocking/major) — resolved.** Verified end to end: the Context bullet now states the asymmetry correctly; `src/runtime.rs:1421-1435` reads only `bannedEverywhere.globals` from the allowlist (members not consumed on Ibex); `bannedEverywhere.members = ["Date.now", "Math.random"]` exists in `packages/snapback-harness/allowlist.json`; the twin pin `deterministic_member_denial_is_a_declared_engine_fact` exists at `tests/workerd_twin_v0.rs:278`; the busy-wait tests are action-class (`tests/action_watchdog_v0.rs:56-57,62-63,86`), so scoping the closure to queries/mutations is sound; and no demo query/mutation handler touches `Date.now`/`Math.random` (grep over `demos/*/snapback/*.mjs` returns nothing; all-aboard uses `nowMs(ctx)` = `ctx.runtime.now()`, `handlers.mjs:43-45`) — so Increment 2's blast-radius claim ("watchdog tests stay untouched") is verified, not asserted. One residual nit, N7 below: zero-arg `Date` is not in the `members` list and cannot be — the V8 strip denies it via a separate constructor wrapper (`workerd/strip.mjs:94-115`), so Increment 2's "single-sourced from the `members` list" is one mechanism short.
2. **Unsatisfiable all-aboard IR gate (round-1 major) — partially resolved; the residual error is the headline of this review.** r2 did what round 1 asked: added closed set-oriented steps and rewrote the gate in three parts. But round 1's own analysis was incomplete — it treated the pattern loops as unrollable and did not press on the `hasOwnProperty` conditional or the return values — and the r2 gate inherited that gap. See N1. (Fairness note: r2 followed the round-1 advice faithfully; the advice was wrong in a way only the 0329 transcription experiment, run later the same day, exposed.)
3. **LLP 0032 DK-1/E3 unengaged (round-1 major) — resolved, well.** The D2 bullet now cites the E3 decision at its exact location (verified `llp/0032:552-571`: Option A decided 2026-07-02 "pending Charlie's ratification nod"; Option B recorded as future extension with precisely the four costs 0051 quotes), states that accepting this RFC "should be read as ratifying-and-extending E3, not reopening it" (answering round 1's process question explicitly), and carries the implementation note that the `src/storage.rs` rationale comment must be updated when `Get` lands — verified accurate: the comment at `src/storage.rs:570-579` reasons from plans being "an unconditional write sequence," which `Get` falsifies. LLP 0032 was added to Related.
4. **Reads-are-never-ledgered rule unstated (round-1 major) — resolved.** D1 now carries the rule as its own bullet with the three-replay-semantics breakdown (queue rebase / corpus exact / overlay approximation), D6 carries the divergence honesty ("derived is not clairvoyant"), and Q10 carries the presentation question. 0329 r4 §Context quotes the rule by name — the pair now agrees on it.
5. **D3 `cpu_budget` honesty (round-1 minor, GPT-5 major) — resolved.** The text now proposes artifact-class-granular rows and keeps the target row `Missing`. Verified against `src/manifest.rs:1063-1080`: `wall_clock_timeout` Missing, `action_wall_clock_timeout` Enforced, `cpu_budget` Missing — the "same honesty pattern as today's per-class wall-clock rows" claim is accurate.
6. **D4 scope too narrow for the non-JS-client claim (GPT-5 major) — resolved.** The new inventory bullet names grants, receipts, HTTP envelopes, and ephemeral frames, correctly notes `diagnostic.schema.json` is already committed (verified in `schemas/`), and gates the "non-JS client is unblocked" claim on the full surface. The live kinds remain confirmed absent from `schemas/` (verified directory listing).
7. **Corpus infrastructure designed-not-built (round-1 minor) — resolved.** D5's "Status honesty" bullet is accurate: `tests/conformance/` contains exactly `twin-corpus.handlers.js` (verified), no `$NOW`/`$ID:` placeholder exists under `tests/` (verified), the placeholder table is designed at `llp/0010:598` (verified), and the twin-harness staging bridge is stated in both D5 and Increment 3.
8. **Round-1 minors — all resolved; spot-verified.** Citations now land where r2 puts them: `LiveUpdate` at `src/local.rs:357-363`, `LiveSocketClientMessage` at `src/server.rs:2254`, the envelope strictness note at `envelope.mjs:8-15`, string dispatch at `demos/_kit/client.mjs:734-777`, injectable-ids at `llp/0003:374-375`, Online/Parity at `llp/0012:332-335`, `dryRunSupported` at `llp/0024:401` and `llp/0042:78-81` with the "designed, not generated today" wording fixed, the cron supplied clock at `src/runtime.rs:384`, frozen `runtime.now`/fresh `runtime.id` at `src/runtime.rs:537,556`. "Ctx host-call op set" naming is used and explicitly disambiguated from `src/host_ops.rs`. The WASM strict profile, ledger mechanics (including the `runtime.log` exclusion, which matches the code comment at `src/runtime.rs:538-543`), plan bounds, shared data-tier version, and rejection-class enumeration are all present. The auth-ledger shape matches LLP 0039's `AuthContext` (`llp/0039:81`) plus LLP 0043's fingerprint and `SNAPBACK_AUTH_STALE_RESULT` (`llp/0043:97,135-136`) — verified.

No r2 fix introduced a factual error that I could find; the one revision-introduced problem is that the rewritten gate (b) re-asserts an expressibility claim the added steps do not achieve (N1).

## Cross-repo consistency with Exact LLP 0329 r4

0051 r2 and 0329 r4 are **inconsistent**, in one direction: 0329 r4 moved after 0051 r2 and 0051 has not caught up. What must change in 0051, precisely:

1. **§Relationship to Exact LLP 0329 (0051:650-672) is stale and must be rewritten.** It describes 0329 as "(r2)," lists two corrections that "flow from this document back to it," and closes with "On acceptance, Exact 0329 takes an r3 with those corrections." Verified against the companion: r3 applied both corrections and r4 went further — the grammar tranche (E1–E3) is now an *evidence-gated option* with a falsifiable trigger (0329 §Increments, "Option track": a measured grammar-vs-builder authoring comparison, or Design-Mode data-branch body editing shipping), the committed track is E4–E6 plus corpus consumption, and the crosswalk table (0329 §Context) is the authority map. The rewritten section should state the committed/option split, note that corrections now flow *toward 0051* (the transcription findings), and drop the completed instruction.
2. **D2's "front-end fix" (0051:294-305) leads with the wrong front-end.** It presents Contract source as the fix, with the builder as the fallback ("Apps not using Contract keep the `define.mjs` builder"). 0329 r4 §Summary inverts this on review evidence: "The first-class authoring surface for the extended IR is the typed `define.mjs` builder … (which the real corpus needs: the all-aboard unrolls are a `.map()` in the builder and a wall of near-identical statements in any grammar)." 0051 must restate D2's promotion story with the builder as the shipped, first-class front-end (it is also 0051's own Increment 3 deliverable, `:700`) and the Contract grammar as the 0329-owned option, keeping the example as illustration of the option. The promotion argument does not weaken — "fix the ergonomics with a real front-end" is *more* true of the surface that exists and authored todo-v2.
3. **Summary move 1 (0051:60-64)** — "With a Contract-source front-end (Exact-side, LLP 0329) and a modestly richer expression set, the IR becomes the primary artifact" — same inversion; same fix.
4. **D8's agent story (0051:611-614) contradicts 0329 E6.** 0051: "Agents author against a closed grammar (Contract front-end, Exact-side) with spanned compile errors." 0329 r4 E6: "Agents author against the typed builder today — the shipped surface the whole existing demo corpus was authored on … Whether a Contract grammar measurably improves agent authoring is the E-1 trigger's question, not this section's premise." 0051 must adopt the r4 posture — this is exactly the unevidenced claim the adversarial rounds unwound.
5. **Increment 3 gates (b)/(c) (0051:703-711) must absorb the transcription flow-back — with one precision correction to the flow-back itself.** 0329 r4 proposes: todo-class CRUD as the Contract-source gate (option-track), "all-aboard's clear-and-replace mutations … the builder-authored IR gate for the set-oriented steps," and `applyLiveFeedSnapshot` as the honest "outgrew the IR" negative exemplar (0329 §Increments precondition; EQ6 tracks the flow-back). My independent verification (N1) confirms the finding and adds a caution: even the r4 phrasing is loose, because only `resetFeed` expresses *entirely* in IR — `applyFeedTick` fails on missing-row defaulting and its computed return even with builder metaprogramming. The re-scoped gate (b) should say precisely: `resetFeed` expresses entirely in IR (builder-authored — it exercises the unroll, `DeleteWhere`, and a `Literal` object return), and the `DeleteWhere`+`InsertEach` cores of `applyLiveFeedSnapshot` (including the `round`/`min`/`max` clamp idiom) land as corpus cases. Gate (c) should name `applyLiveFeedSnapshot` as the negative exemplar — a real in-corpus mutation — replacing the invented "cross-row aggregation" example. `applyFeedTick` should be classified explicitly: JS-tier today; IR-expressible only if two named profile-growth candidates land through Q1 governance (Get-missing semantics with defaulting, expression-valued returns).
6. **Snapback-owned questions 0329 r4 raises that 0051 lacks.** (a) *`Get` on a missing row*: 0329 EQ7 calls this "an open question shared with 0051 (EQ7)" — but 0051 r2 has no such question, and D2's own "guarded update becomes Get → Guard → Patch" is undefined without it (what does `Guard` test when the row is absent — typed error at `Get`, null binding with defined field-access-on-null, or a default clause?). Snapback owns step semantics; 0051 must either decide it in D2 or add the question. Verified load-bearing: `handlers.mjs:456-457,461` (`(state && state.tickCount) …`, `(tick && tick.delays) || {}`) and even todo's `setCompleted` (`if (!todo) return 0`, `demos/todo/snapback/handlers.mjs:27-33`) hang on it. (b) *Non-identifier field keys* (0329 EQ8): 0051 D2's field-access description (`Binding("row").field`, 0051:311-313) is silent on whether the IR admits keys like `delays["sb-local"]` (`PATTERN_IDS` are all hyphenated, `handlers.mjs:11`). Since the IR is serde data, a field-access node naturally carries an arbitrary field-name string — 0051 should say so explicitly, which makes hyphenated keys builder-reachable and confines EQ8 to grammar spelling (Exact-side). (c) *Filtered-read guards*: 0329 E1 names them a known out-of-profile class ("uniqueness, quotas, membership-by-non-id-key … a bounded `Exists`/`Count` read form is 0051's to consider (Q4-adjacent)"); 0051's tier ladder says the IR covers "guards" (0051:375-377) without this carve-out. One sentence in "Where the IR ends" plus a Q4 note.
7. **Q2 (0051:753-756) is answered and should widen.** 0329 E3 *commits* consumption by reference ("This resolves 0051 Q2 from the Exact side: one corpus, two consumers, no vendored fork") — 0051 can record the resolution. And 0329 EQ4 identifies the missing half: the committed profile schema, bounds, and library list must ride the same channel, with a provisional-pinned-checkout story if grammar work ever lands before the durable mechanism. That artifact is snapback's to publish; Q2's scope should include it.
8. **D6/Increment 5 should adopt E5's committed acceptance discipline.** 0051 D6 says derived overlays "replac[e] hand-written per-app reducers for the tier" (0051:541-542); 0329 r4 E5 — reflecting its codex round's C5 — commits to "reducers stay first-class; derived overlays are the generated default," gated on *passing the adapter's existing reducer regression suite (duplicate-reapply, reconcile-failure)*, with app reducers always able to override. 0051's Increment 5 gate should name the same suite; Q10 should cite E5's now-specified receipts contract (pending→confirmed|failed, `rollbackReason` carrying typed guard codes, per-mutation overlay-class identification) instead of pointing at "LLP 0329's DataProvider tiers" as if unspecified.
9. **Minor skews:** Q5's "where the Contract front-end is the producer" (0051:769-770) is now conditional on the option; D5's rejection/case enumeration could name the E3 divergence-table pin pairs (`==`, template number formatting) among its case classes, since E3 gates each table row "on the snapback corpus case existing first" — those cases are 0051's to host.

**From the 0329 review rounds, problems that land on the Snapback side** (beyond the flow-back): codex-r3 C1 challenges 0051's own headline — "the 80% mutation" is asserted, not measured (see N3); codex-r3 C4's cross-repo pinning concern becomes 0051's Q2-widening (item 7); codex-r3 C6's "pays on shipped surfaces" sequencing check is worth one sentence in 0051's Increments (1–4 pass it; 5–6 are the ones it disciplines). Nothing in either 0329 round undermines a 0051 design commitment — the damage is confined to framing, gates, and unpinned semantics.

## New concerns

**N1 — blocking (for Increment 3 as drafted) — Gate (b) is still unsatisfiable, and D2's justification bullet mischaracterizes its own evidence.** Verified by full transcription analysis of `demos/all-aboard/snapback/handlers.mjs` against the r2 profile (`Get`/`Guard`/`Let`/`DeleteWhere`/`InsertEach` + `Insert`/`Patch`/`Delete`; expressions: arithmetic incl. `%`, comparison, logical, coalescing, ternary, string templates, data-field access, pinned library; `ReturnValue ∈ {Literal, Binding, Document, ChangedCount}` at `src/manifest.rs:799-805`; `ValueExpr` extension list at 0051:309-318):

- `resetFeed` (:533-549): **expresses entirely** — six builder-unrolled `Patch` steps with `RuntimeNow`, `DeleteWhere` with empty filter, one `Patch`, `ReturnValue::Literal({tickIndex: 0})` (constant object — `Literal(Value)` covers it). This is the true set-oriented acceptance case.
- `applyFeedTick` (:448-481): **does not express**, on three independent axes. (i) Missing-row defaulting: `(state && state.tickCount) ? … : 1` (:456) and `(tick && tick.delays) || {}` (:461) require `Get`-on-missing semantics that neither D2 nor any open question defines (cross-repo item 6a). (ii) The computed object return `{ tickIndex: nextIndex, note: (tick && tick.note) || '' }` (:480) is inexpressible: no `ReturnValue` form takes an expression, and the extended `ValueExpr` set has no object/record constructor — see N2. (iii) Minor: `Number.isInteger` (:457) and `Number(…)` coercion (:464) have no library equivalent (droppable as defensiveness only where the schema types the column). The bracket access `delays[patternId]` with hyphenated keys is *not* a blocker for the IR/builder path (the IR-as-data can carry arbitrary field-name strings — but 0051 must say so, item 6b). The `%`-modulo and `max` clamp (:458) express fine — the r2 library additions were correct.
- `applyLiveFeedSnapshot` (:483-531): **does not express, permanently.** The `hasOwnProperty` skip (:491) — patch only the patterns present in the args object — is a conditional write, i.e., data-dependent control flow that D2's own text excludes from the profile "permanently" (0051:339-341). There is no emulation that preserves behavior: a `Patch` guarded by a ternary over values still writes `observedAt` unconditionally (different write-set, different `live_delta` footprint), and the profile has no `hasKey`/`in` operator anyway. The `touched` accumulator (:488,495) and the computed return (:526-530) compound it. Its `InsertEach` core (:500-517) *does* express (clamp idiom via `round`/`min`/`max`, defaults via `||`, templates for the synthesized id) modulo the value model — which is exactly why it belongs in the corpus as fragments while the mutation as a whole is the negative exemplar.
- The returns are not decorative: `refreshFeed` propagates them as the action's result (`return await ctx.runMutation(…)`, :556,:560,:571), so the return shapes are app-visible API; a transcription that changes them is an app change, not an expression of the mutation.
- Additionally, D2's set-oriented justification bullet (0051:320-341) says "All three all-aboard mutations are clear-and-replace snapshot appliers: delete every row in a table, insert one row per element of an array argument (`…handlers.mjs:463-517`)." Verified false as a characterization: only `applyLiveFeedSnapshot` inserts per element; `applyFeedTick` and `resetFeed` delete-and-patch, inserting nothing; and the cited span includes the conditional patch loop the profile excludes. The bullet's conclusion (the steps are needed and well-shaped) stands; its premise needs the honest wording.

*What resolves it:* the re-scoped gates in cross-repo item 5, the Get-missing decision (item 6a), the explicit field-name-string statement (item 6b), and D2's justification bullet corrected to "the all-aboard mutations all contain a clear-and-replace core (clear `liveDepartures`, insert per element of an args array) that is unexpressible in any per-row IR" — which is true.

**N2 — major — `ReturnValue` growth is missing from the D2 extension, and it binds more than the gate.** The D2 extension enumerates `ValueExpr` growth and step growth but never touches `ReturnValue` (`src/manifest.rs:799-805`; serializer at `packages/snapback-codegen/index.mjs:1027-1034`). A mutation returning a computed summary — `{ tickIndex, note }`, `{ source, patterns, note }`, or even `{ id, createdAt }` — cannot be written in the extended profile: `Literal` is constants-only, `Binding` returns one bound value, and there is no record-constructor expression to `Let`-bind. Two of the three all-aboard mutations hit this today. Either add an expression-valued return (`ReturnValue::Expr(ValueExpr)`) plus a closed record/array-constructor `ValueExpr` form — each a bounded, analyzable, Q1-governable addition — or state plainly in "Where the IR ends" that computed-shape returns are a named out-of-profile class (with the JS-tier escape), and keep it off the gate. Silence is the only wrong option: as drafted, D2 implies the extension reaches mutations it cannot finish.

**N3 — major — "the 80% mutation" is a slogan carrying a load the document never weighs.** Raised by the 0329 codex adversarial round (its C1) against the pair; verified applicable here: 0051 uses "the 80% mutation" as D2's sizing claim (0051:62, 288-292, 375) with no measurement. The honest in-repo evidence, from this review's own classification: of the eleven durable demo mutations examined (todo ×3, todo-v2 ×5, all-aboard ×3), nine express entirely in the extended profile (todo-v2's five are shipped plans today, `demos/todo-v2/snapback/functions.mjs:47-84`; todo's three reshape onto `Patch`+`ChangedCount` exactly as todo-v2 demonstrates; `resetFeed` per N1), one is conditionally expressible pending two named growth candidates (`applyFeedTick`), one is permanently JS-tier (`applyLiveFeedSnapshot`). That is genuinely favorable — but it should appear *as a table* (covered now / covered after named growth / JS-WASM-tier, per mutation), in D2 or an appendix, so the number is evidence rather than vibes, and so profile-growth pressure (Q1) has a denominator. *Severity note:* the tier ladder makes the design safe even if the ratio disappoints; this is an evidence-honesty requirement, not a design flaw.

**N4 — minor — the pinned library has no type-coercion functions, and `v.json()` args make that a real gap.** `applyLiveFeedSnapshot` takes `delays: v.json()` and `departures: v.optional(v.json())` (`demos/all-aboard/snapback/functions.mjs:132-140`) and sanitizes every field with `String(…)`/`Number(…)` (:502-513) — for untyped JSON args this is load-bearing input hygiene, not droppable defensiveness. An `InsertEach` over `v.json()` input with no `number()`/`string()`/`bool()` in the library either inserts unsanitized values or fails schema validation where the JS handler coerced. Name coercion functions as Q1 growth candidates (they are exactly the "corpus-demand-driven" case), or note that `v.json()`-fed `InsertEach` is out of profile until they land.

**N5 — minor — the flow-back's own looseness will re-create the gate bug if adopted verbatim.** Covered in cross-repo item 5; recorded here because it is a *new* hazard created by the reconciliation itself: 0329 r4's phrase "all-aboard's clear-and-replace mutations are the builder-authored IR gate" reads as "the three mutations express, builder-authored," which N1 shows is false for two of them. 0051's r3 should word the gate in terms of `resetFeed` plus corpus fragments, and (courtesy, not obligation) the 0329 precondition text could be tightened in the same pass.

**N6 — minor — D5 should own the divergence-table pin cases.** 0329 E3 (committed half) requires every divergence-table row to ship with "a pair of corpus/CI cases pinning both behaviors," gated on the snapback case existing first — starting with `==` and template number formatting. Those cases live in 0051's corpus, but D5's enumeration (profile cases, rejection classes) does not name them. One line in D5 closes it.

**N7 — minor — Increment 2's "single-sourced from the allowlist `members` list" is one mechanism short.** Verified: `bannedEverywhere.members = ["Date.now", "Math.random"]`; zero-arg `Date` denial on V8 is a separate constructor wrapper (`packages/snapback-harness/workerd/strip.mjs:94-115`, ENG-23588), not a members entry — it cannot be one, since it is call/construct behavior rather than a member path. The Ibex closure needs the same two mechanisms (member deny-stubs from the list, plus the Date-constructor rule); say so, or the implementation will "complete" the list and miss the constructor.

## Suggestions

- When flipping D2's front-end framing (cross-repo item 2), keep the Contract example — it is good exposition — but caption it as the option's surface and add the one sentence of builder reality: the all-aboard unroll is `PATTERN_IDS.map(...)` in the builder; metaprogramming is a feature the authoring tier gets for free.
- Fold the N3 classification table into D2 or an appendix; this review's eleven-mutation classification can seed it. Consider re-titling "the 80% mutation" to "the common mutation" with the table as the measured claim.
- Adopt 0329's "increments must pay on shipped surfaces" check as one sentence in §Increments — 1–4 pass it today (schemas, ledger, IR + demos, dry-run); it usefully disciplines 5–6.
- In D1, when specifying the ledger, carry Q7's wire-split answer (already written in prose: `{generatedIds, now}` cross the wire; auth context/fingerprint and trace stay server-side) into the promised table — it is answerable now by the document's own admission.
- Q8 (plan inspectability): 0329 E6's dry-run surface and agent story strengthen the "inspectable" proposal — an agent loop over `mutationDryRun` wants to read the plan it is simulating. Worth one cross-reference when Q8 is decided.
- For the `Get`-missing decision (item 6a), note that the corpus already contains the deciding evidence: todo's `setCompleted`/`deleteTodo` want soft-missing (return 0), all-aboard wants defaulting, and 0329's `completeTodo` example wants a guardable binding. A null-binding rule with corpus-pinned field-access-on-null semantics (plus `coalesce`) covers all three; an error-on-missing rule covers none without a fallback clause. That asymmetry is most of the answer.

## Recommended next step

Revise to r3 now, in the same pass and spirit as 0329's r4, and keep Status `Draft`. The r3 work list is bounded and mostly mechanical: rewrite §Relationship around the r4 committed/option split; flip Summary-move-1, D2's front-end paragraph, and D8's agent premise to builder-first with the grammar as the evidence-gated option; re-scope Increment 3's gates (b)/(c) per N1/N5 (with the D2 justification bullet corrected); decide or docket `Get`-missing semantics, the field-name-string statement, filtered-read guards, and `ReturnValue`/record-constructor growth (N2); record Q2's resolution and widen it to the profile/bounds artifact; adopt the reducer-regression gate into Increment 5 and cite E5 from Q10; and take the small items (N3 table, N4, N6, N7). Because the design spine is unchanged and has now survived two independent verification passes, I do not think r3 needs another full cross-family round: a focused confirmation read of the changed sections — the gates, §Relationship, and the D2 framing — by one reviewer, plus the author's check that the 0329 precondition text and 0051's gate wording finally say the same thing, would satisfy LLP 0005 proportionately. After that, the pair should move toward `Accepted` **together** — the 0329 fable round's rule that "neither document should advance alone" has been vindicated twice today, and this review is the second time.
