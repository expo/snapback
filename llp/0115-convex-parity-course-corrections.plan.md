# LLP 0115: Convex-parity course corrections

**Type:** Plan
**Status:** Accepted
**Systems:** Competitive evaluation, Developer experience, Authoring, Application data API, Code generation, Runtime, Bootstrap, Packaging, Search, Relational queries, Scheduled work, Client integration, Documentation, Testing
**Author:** Charlie Cheever / Claude (Fable 5)
**Date:** 2026-07-30
**Revised:** 2026-08-08 (CV-4b union-of-literals carve-out: stored
string-literal unions landed under LLP 0004/0007 per LLP 0191 §5 and OQ5's
schema-quick-win sequencing; the row's Spec commission for stored arrays and
objects is unchanged and no new authoring grammar was introduced.) 2026-08-03 (CV-8 move-6 snapshot-batch landing: the contributor
local target now supports the Experimental `snapshot_batch_v1` profile with
LLP 0157 plan identity, exact `sbsb1`, one-snapshot execution, sealed tuples,
coordinated resume, and cursor-free-first-page live replacement; the separate
sequence capability remains support-false pending its full qualification);
2026-08-03 (OQ7/product-breadth execution fact: LLP 0132 is
Implemented for the experimental local SQLite target with retained macOS and
independent Linux/Fly filled-partition qualification. Exact k-NN is the shipped
base; hosted/Postgres/live and ANN remain closed, so this does not widen the
Plan's fixed CV board or claim a hosted breadth tranche.) 2026-08-02 (CV-8 move-6 publication reconciliation: the local
handler-tier `ctx.sequence.allocate` substrate, order bounds, and A6 evidence
landed, and the combined checkpoint adds generated `AllocateSequence` plus
mutation-atomic lane-Q withholding. `sequence_allocation_v1` remains
unpublished and support-false pending complete LLP 0135 §5.1 qualification.
LLP 0157 §D8 unblocks 3a
snapshot-batch execution and confirms LLP 0135 owns its cursor grammar);
2026-08-02 (CV-8 piece-2 implementation: LLP 0134's maturity
process machinery is now executable — exhaustive Rust authority, canonical
Rust/codegen parity, closed grandfather eligibility, per-route soak records,
promotion/demotion schemas, and candidate-parent/staged-tree/history gates.
`inline_handler_v1` has the first honest local soak observation; the intended
relation/activity pair is blocked by a newly witnessed source-carrier digest
regression (filed, not papered over). No capability has been promoted, and LLP
0134's implementation record retains the pre-first-promotion comment-digest
circularity as an explicit design correction rather than a false completed
check.) 2026-08-02 (CV-17 / Move-1 type-flow implementation: result-side
app schema references expand through the existing document contract/hash;
generated handler, helper-boundary, and read/write context types consume the
schema/function artifacts; the A2 arm and seeded checkJs mismatch close the
pilot. CV-4b stored structured fields remains Open, and LLP 0157 composition
shapes remain deferred while that Spec is Draft.) 2026-08-02 (CV-9 implementation reconciliation: current main's
Wave-1 C2 slice is confirmed as the honest `runAfter`-class surface, not merely
an enqueue stub. A file-backed crash/reopen witness now closes its remaining
attempt-ledger evidence gap: stored lease expiry receipts attempt 1, advances
attempt/fence, rejects stale publication, and persists attempt-2 success. No
`ctx.scheduler` alias or new production vocabulary was needed; LLP 0070's
broader profile remains unclaimed.) 2026-08-06 (OQ5 board update: the locally provable closure shipped —
npm `latest` = 0.1.9 on all nine `@expo/snapback-*` packages, fast-path per
LLP 0041; hosted claims remain separately gated.) 2026-08-02 (decision-sitting propagation: OQ5 is reaffirmed and
carried into its owners — the locally provable npm closure follows LLP 0074's
parallel gate and LLP 0134's maturity bar, independently of hosted work;
source: `issues/20260802-author-decision-packet.md`). 2026-07-31 (§Sequencing 5 rerun-arm prep EXECUTED: the
Campfire React query-group arm landed in-repo at `demos/campfire` — the
Diary 0025/0034 Campfire contract rebuilt so every product read renders
through the LLP 0114 React surface over a registered LLP 0112 generated
group (`/rooms/:roomId`), with retained acceptance pinning the consumption
(no `fallbackToLive`, rendered registered-boot provenance, a structural pin
against headless-client use, live-delta re-renders); item 5's dated note
records that the React-surface measurement requirement is now satisfiable.
Measurement prep only — no capability claim, classification, or watch-item
change. The codegen/served-admission register-eligibility seam found en
route is issues/20260731-0112-register-eligibility-js-param-seam.md.)
2026-07-31 (decision 9's scope migration EXECUTED in-repo,
LLP 0130 SD-6 lane: every workspace package renamed to the terminal
`@expo/snapback-*` names (publishing nine plus the private/image-bound
members — the workspace-coherence decision and rationale are recorded in
LLP 0041's dated 2026-07-31 revision, the lead packaging owner), and the
proof system migrated as lineage: v4 lease/issue-request generation with
the terminal name table while v2/v3 keep validating recorded
`@ccheever/snapback-*` artifacts, `scopePreset`-keyed ledger validation
(`identity` terminal / `ccheever` recorded legacy), an explicit
`PACKAGE_NAME_LINEAGE` map, the cold-install preset moved to the direct
`@expo/snapback-cli@latest` root, the GitHub proof repository slug moved
to `expo/snapback` for terminal-generation evidence, generated artifacts
rotated under the renamed emitters, and the guide's authoring-loop
alias-mapping prose rewritten to the one-identity terminal state. The
frozen partiful step5 evidence still validates under the legacy
generation (pinned by test). Registry publication under the terminal
names and slice 5-rebuild (CV-1's exit) remain the open follow-ons —
the migration deliberately precedes them per SD-6. LLP 0113 carries the
co-amendment for the authority wire schemas.)
2026-07-31 (v0.9, CV-9 first slice landed: wave-1 lane C2
delivers LLP 0070's `runAfter` slice — transactional `ctx.jobs.enqueue`
inside the mutation commit, fenced claims with append-only attempt
receipts, the injected-clock jobs drain, the generated declared
job-status live query, and the experimental `jobs_one_off_v1`
capability facts; CV-9's row and §CV-9's dated tracking note carry the
detail. 0070 stays Draft; the claim boundary stands.)
2026-07-31 (v0.8, wave-1 program-state refresh: the six
commissioned Specs are all Accepted under LLP 0130 SD-4 — LLP 0131
(CV-4a+CV-5 unified argument grammar), LLP 0132 (vector search), LLP
0133 (local settlement), LLP 0134 (CV-8 piece 2 stable promotion),
LLP 0135 (move 6 sequence-primitive + 3a designs), LLP 0136 (CV-11
design half) — and the in-branch code lanes landed on main: C1
helper slice `4d72c407` (CV-7), C3 receipt lane `63dacde2`/`5ac77b8d`
(CV-3, CV-15), C4 types sweep `1f475864` (CV-1 gap 4), CV-13 guide
rewrite `5592c8ba`, C5 offline Phase 0 `2a7bf058`..`b53c28fd`. Board
rows updated; design tickets for move 6 and CV-8 piece 2 closed.)
2026-07-31 (slice 5-types swept: CV-1 named gap 4's
`types`-condition sweep executed in-branch (`move5-types-sweep`,
pending landing) — 51 declarations + conditions across all seven
publishing packages, and `scripts/check-package-export-types.mjs`
added to the local proof as the structural regression gate; the gap
4 text and CV-1's board row carry the dated status.) 2026-07-31 (CV-3 and CV-15 executed in-branch, pending
landing on main — persisted `snapback.runtime-readiness.v1` receipt with
digest-recompute consumption across doctor/bootstrap/harness/proof, the
shared `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID` code in LLP 0010's
registry, all four kit rungs covered, the 0123 strict-Host precondition
resolved as a documented posture-neutral-by-process-isolation finding
with a pinned regression test, and the `unpinned` label split into
`pinned-binary-dirty-checkout`/`unpinned-binary`; see the rows' and
sections' dated landing notes.)
2026-07-31 (standing-decisions pointer: LLP 0130 records
the author's pre-adjudicated conditional rules for this plan's
mid-flight gates — SD-1 covers OQ3/decision 5's completion, SD-2 the
CV-8 piece-3 aggregate choice, SD-3 answers OQ4, SD-4 the
commissioned-document acceptances, SD-6 the decision-9 migration
timing — plus the escalation reservations.)
2026-07-31 (v0.7, lockstep round-1 fixes: round 1 of the
{0115 v0.6, 0129 v0.2} lockstep super-refine returned NOT READY from
both families for this Plan (artifacts
`reviews/0115-0129-lockstep.fable.md`,
`reviews/0115-0129-lockstep.codex.md`). Board truth restored against
the tree (Fable B1 / Codex blocking 1–2): CV-2 landed at `814acd77`
(`snapback runtime-qualify` create/destroy gate,
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED`, the rsync-mtime
missed-relink root cause confirmed and fixed at source,
`verify-local-proof`'s blind spot closed, LLP 0010's dated landing
note, ticket closed) and CV-10 at `c57ef9cd` (canonical-digest
recheck + storage normalization + the LLP 0073 pin, ticket closed) —
both ancestors of v0.6's own landing commit; both rows and work items
now carry dated landing notes, CV-2's Work/Exit are conformed to
LLP 0010's landed contract (exact-VM create/destroy is the behavioral
gate; the no-eval constructor admits no trivial execution beyond
creation; the persisted digest-bound receipt is CV-3's), and
Tranche A's residue is restated as CV-3, the open kit-rungs ticket,
and CV-1. The board-wide staleness sweep the round recommended was run:
every remaining Open row was re-verified against issues/,
issues/closed/, and the fleet's last-day log — CV-13's guide-gap
ticket is still open, LLP 0110 is still Review and LLP 0070 still
Draft, and no other commit in the staleness window touches a board
row; one adjacent execution fact recorded at OQ7: LLP 0044's revival
revision (decision 8) landed 2026-07-31 as `14bd5ddb`. Decision 9's
record corrected by dated erratum (Fable B2/M1/D1, Codex material 3):
the "zero public packages" premise was false when recorded —
`npm view @snapback/cli version` returns `3.0.1`, a live unrelated
public package (last published 2026-03-27; probed 2026-07-31),
consistent with CV-1's "squatted" and with LLP 0041's 2026-07-21
probe, so the org release request is a dispute with lower odds, not a
free release; the request is re-tensed to *to be filed* (an author
npm-account to-do — no filing evidence exists in the tree); the
repository-transfer leg is complete (`origin` is
`github.com/expo/snapback.git`, 2026-07-31); decision substance
unchanged. Codex's round-1 reconciliation of carried inconsistency 4
("a held org can contain zero public packages") is refuted by the
same live probe. CV-8 piece 2's mandatory, startable
stable-promotion design gains its execution tracker
(`issues/20260731-cv8-piece2-stable-promotion-design.md`, Codex
material 4); decision 8's float-pinning rider is restored (Fable D2)
— with one attribution correction: the portable-exactness subquestion
lives in 0124 OQ3, not OQ2, per 0124's own list and 0127's decision
docket; CV-14's exit is made falsifiable (Fable D3). Per the
LLP 0063-style delegation, this revision was agent-executed under the
author's 2026-07-31 direction.)
2026-07-30 (v0.6, decisions recorded: the author
adjudicated all ten LLP 0127-routed decisions on 2026-07-30; open
question 8's registry records each as DECIDED. In place: OQ5 answered
by decision 1 (LLP 0074's parallel gate; 0111 to be amended), OQ3 by
decision 5 (post-A+E deferral confirmed with a recorded provisional
lean), OQ6 by decision 7 (absorb/delegate split confirmed;
enqueue-receipt association owner = LLP 0070), OQ7 by decision 8
(LLP 0044 revived; vector Spec beside 0073; parallel start under 0074
— the §Sequencing-1 carve-out un-gates). Every v0.5 "pending
decision N" marking is resolved: CV-16/CV-17 confirmed, the 0094/0095
and wide-409 delegations and the burst-profiling rerun precondition
confirmed (decision 7); CV-1's custody path decided (decision 4: the
admin surface folds into the CLI, the acceptance helpers are published
as a real package); move 2's first slice admits context-readers
(decision 6); move 6's shipping order fixed (decision 3: sequence
primitive, then 3a). The successor Plan's number is pinned: v0.5 said
"number unassigned"; it landed as LLP 0129
(llp/0129-local-first-program.plan.md — 0128 was taken by a concurrent
doc). New in CV-1/move 5's orbit per decision 9: the terminal npm
scope is @expo/snapback-*, the scope migration lands before the
starter/GA front door, and slice 5-rebuild is sequenced after or with
that migration. Decision 10 (settle-time trust: server re-derivation
default) lands with LLP 0129's settlement Spec. Per the LLP 0063-style
delegation, this revision was agent-executed under the author's
2026-07-30 direction.)
2026-07-30 (v0.5, LLP 0127 absorption: the six-move structure
of the now-Accepted synthesis RFC (LLP 0127, Review → Accepted 2026-07-30)
is recorded as the board's coherence layer, following 0127 §Sequencing's
own absorption points — a new §The move layer, a Move column on the status
board, and per-item refinements from the series' verified findings (CV-7
same-file-first with the v0.4 group-bundle claim superseded; CV-8
piece-2-gates-piece-3 on the 0113 route plus the move 6 frame; CV-9 named
as slice 3-jobs with its ticket riders; CV-6 strictness sequenced
post-A+E; CV-1 split into slices 5-types/5-rebuild). Proposed additions
recorded pending 0127 decision 7: CV-16 (rejection unions), CV-17
(typed-interior pilot), the 0094/0095 wire-shape and wide-409 delegation,
and burst profiling as a rerun precondition. The §Sequencing-1
product-breadth carve-out is recorded pending decision 8; the reactive
watch item carries move 4's 1a pre-registration per 0127 §Sequencing 7;
the local-first program is cross-referenced as a successor Plan in
concurrent drafting, number unassigned at revision time, pending
decision 2. Open questions 3–7 gain their 0127 routings and a new
registry (open question 8) indexes the ten routed decisions — every one
individually open as of this revision: accepting 0127 accepted the
synthesis direction, not any individual decision, and nothing in this
revision decides one. Status facts verified: LLP 0116–0125 and LLP 0126
are Active post-review-program; LLP 0110 remains in Review. Per the
LLP 0063-style delegation, this revision was agent-executed under the
author's 2026-07-30 direction.)
2026-07-30 (v0.4, research-series integration: LLP 0116–0125
adopted as this plan's analysis layer — the status board gains a per-item
Analysis column and §Analysis layer defines the division of labor; verified
corrections applied: CV-7's indexed-read duplication evidence re-attributed
to Relay Board (Diary 0033, was Campfire), CV-4's enforcement mechanism
tightened (closed primitive map is the sole enforcement; the builders'
`resultOnly` flag is dead metadata), the client subpath-export
types-condition defect added to CV-1's named gaps; new open questions 6–7
frame the series-identified unowned remainders and the product-breadth
scope boundary for author adjudication.) 2026-07-30 (v0.3, Codex pre-implementation review corrections —
verbatim review in `reviews/0115-convex-parity-course-corrections.codex.md`,
13 findings, all verified claims spot-checked: CV-1's evidence corrected
(seven Snapback arms, not fourteen; the admin client is Dispatch-specific,
not every-arm — the same correction applies to the LLP 0041 amendment);
CV-5 re-scoped from one-emitter wiring to schema-export-plus-carrier
alignment (`defineSearchQuery` authors `query: v.json()`, the client
hand-authors the AST interfaces, and no Rust search schema is exported);
the earlier v0.2 publication-state correction is versioned here. The
review's structural findings — LLP 0063 delegation authority, falsifiable
exits and a post-D rerun, the second exact closure before any
published-channel rerun, the receipt-authority definition, ingress
validation as a trust-boundary prerequisite, CV-7's accepted-but-unclosed
findings, the CV-8 five-way split, the CV-9 capability cutline, and the
CV-10 tamper-safe recheck shape — are recorded in the artifact and await
author adjudication before the tranches start.) 2026-07-30 (v0.2, delegated-owner coverage audit: every work item
was checked against what its owning documents and the current code actually
contain. Major corrections — CV-1 gains LLP 0041 as lead owner plus two named
unpublished-artifact gaps and the 0111-vs-0074 npm-gating conflict; CV-3's
"different evidence" claim corrected (the three tools already share one probe
module, one code registry, and one recovery record — the gap is a persisted
receipt and rung coverage); CV-4 split into an arguments-first slice and a
larger stored-fields design, with the overbroad `v.json()` claim narrowed;
CV-6 reframed (the repair-explaining diagnostic already ships at
`severity: 'info'`); CV-7 redirected to revive LLP 0108's superseded
Bounded-static-bundling design rather than start fresh; CV-8 corrected — the
LLP 0113 path terminates at experimental maturity by design, and the aggregate
shapes are Non-goals of both 0110 and 0080, so the third-profile decision is
the load-bearing half; CV-9 reassigned from LLP 0028 to LLP 0070, whose Draft
already specifies transactional one-off enqueue; CV-10 reclassified from spec
amendment to code fix — the content digests actually agree and a
representation-sensitive struct equality is what fails; CV-12 split into
range-filter design vs. already-roadmapped target execution. Open questions 1
and 2 recorded as answered; a new npm-channel-gating question added; the rerun
checkpoint gains a React-surface measurement requirement.)
**Related:** LLP 0004, LLP 0009, LLP 0010, LLP 0028, LLP 0030, LLP 0031, LLP 0035, LLP 0041, LLP 0044, LLP 0046, LLP 0053, LLP 0061, LLP 0062, LLP 0070, LLP 0073, LLP 0074, LLP 0076, LLP 0079, LLP 0080, LLP 0086, LLP 0094, LLP 0095, LLP 0101, LLP 0102, LLP 0108, LLP 0110, LLP 0111, LLP 0112, LLP 0113, LLP 0114, LLP 0116, LLP 0117, LLP 0118, LLP 0119, LLP 0120, LLP 0121, LLP 0122, LLP 0123, LLP 0124, LLP 0125, LLP 0126, LLP 0127, LLP 0129, LLP 0130, Diary 0032–0039

## Summary

The 2026-07-30 current-main rerun of the seven-app Snapback × Convex matrix
(Diary 0039, evidence commit `45d2455d` over Snapback revision `01e94173`)
scored roughly **55/45 in Convex's favor** — four slight Convex wins, one large
Snapback win (ephemeral presence), and two near ties. That is a major
improvement over the first bakeoff, because current main already shipped the
gaps that dominated the earlier result: indexed full-text search, colocated
inline handlers, exact recursive result contracts, indexed
range/order/take pagination, table-scoped relation IDs, and manifest-only
generated custody.

This Plan sequences the work that closes the remaining gap. The diary's own
recommended order is adopted as the tranche structure:

**external install/runtime qualification → structured inputs and helper
composition → aggregate/children/scheduling primitives → live and broader
portable search → guide/review polish.**

The target is not to clone Convex. Per LLP 0074, the target is to make the
parts users feel immediately — a boring first hour, natural input typing,
reactive defaults, composable scheduling — competitive, while preserving the
properties the rerun confirmed as real differentiators: first-class ephemeral
state, fail-closed evidence boundaries, deterministic acceptance, and explicit
authority/capability contracts. Every work item below carries the constraint
that closing a DX gap must not silently discard the corresponding evidence.

A v0.2 coverage audit checked each work item against its owning documents and
the current code. Its headline: the diary's pains fall into three buckets —
(1) already designed or even shipped, needing execution, wiring, or a severity
decision (most of CV-5/6/7, CV-9's semantics via LLP 0070, CV-12's targets);
(2) genuine design holes no current document covers (stored structured fields,
an aggregate profile, live search, range filters, admin-client/test-helper
publication, VM-qualification receipts); and (3) contradictions between
owners that need an author decision before execution (the 0111-vs-0074 npm
default-channel gate; LLP 0113's inability to mint stable maturity).

v0.5 absorbs LLP 0127 (RFC, Accepted 2026-07-30), which synthesized the
analysis layer into six moves and proposed this plan's absorption points
in its own §Sequencing. The moves become the board's coherence layer
(§The move layer); the tranches, owners, and exit are unchanged. The
absorption carried one load-bearing caveat throughout v0.5: 0127's ten
routed author decisions remained individually open. v0.6 closes it —
the author adjudicated all ten on 2026-07-30 (registry: open
question 8), and every "pending decision N" marking below is resolved
in place.

## Governing constraints

1. **No evidence regression.** The rerun's Snapback wins — Cursor Garden's
   zero-durable-amplification presence, commit-version proofs, capability
   nonclaims, named fail-closed diagnostics — are load-bearing. A work item
   that improves ergonomics by weakening an evidence boundary is out of scope.
2. **Honest capability claims only.** Search stays declared non-live until a
   real reactive implementation exists (CV-11); hosted/offline/native-FTS
   targets stay nonclaims until they have their own evidence (CV-12). This is
   LLP 0073's existing posture and it held up well in the rerun.
3. **Owning documents stay owners.** This Plan does not respecify inline
   handlers (LLP 0108), relational profiles (LLP 0080/0110), search
   (LLP 0073), scheduling (LLP 0028/0070), or packaging/publication
   (LLP 0041/0062/0111/0113). Each work item names its owner; substantive
   design lands there (or in a new owned Spec), not here.
4. **The evidence graph is not the problem.** The rerun measured Snapback's
   full generated graph at ~7× Convex's lines, but authored size is tied and
   committed custody is now *smaller* than Convex's committed generated tree.
   The goal is fast generation, good semantic diffs, and consumers never
   needing to read internal projections — not shrinking the graph.

## Analysis layer (v0.4)

The Convex-parity research series (LLP 0116 overview; LLP 0117–0125 by
front) is this plan's analysis layer. The division of labor is explicit:
this Plan owns program state — sequencing, the status board, exit
criteria, and the author decisions in §Open questions — while each series
document owns the deep Convex/Snapback comparison and the multi-path
option space for its front, and makes no decisions. When work on an item
starts, the implementer reads that item's analysis document first (the
status board's Analysis column); substantive design still lands in the
owning documents per governing constraint 3. The series documents are
thinking records, not owners, and this plan does not restate their
option spaces. Scope stays bounded: the series' product-breadth front
(LLP 0124, file storage and vector search) sits outside this plan's
seven-app frame and is handled as open question 7 rather than absorbed.

## The move layer (v0.5)

LLP 0127 (RFC, Accepted 2026-07-30) synthesized the research series and
the local-first deep-dive (LLP 0126, Active) into six moves — few
mechanisms, many fronts — and proposed, in its §Sequencing, exactly how
this plan absorbs them. v0.5 records that structure as the board's
coherence layer: the moves map onto the existing tranches rather than
replacing them, each CV item keeps its owner and analysis pointer, and
the move names the mechanism a CV item shares with its siblings.

**Absorption caveat, resolved (v0.6).** Accepting 0127 accepted the
synthesis direction; the ten author decisions its §Open questions
routed ("0127 decision N" below) remained individually open through
v0.5. On 2026-07-30 the author adjudicated all ten. Open question 8 is
the registry of record; the decision-gated markings in this section
and below are resolved in place, each naming its decision.

| Move (0127) | Shared mechanism | On this board | Beyond this board |
| --- | --- | --- | --- |
| 1 — Contracts reference; nothing respells | one declared-contract vocabulary; composite contracts reference declared shapes | Tranche B: CV-4a/4b, CV-5, CV-6; CV-16/CV-17 (confirmed, 0127 decision 7) | grammar/E-placement proposals adjudicated in the CV-4 Spec's own loop |
| 2 — The closed graph grows; custody does not shrink | same-file helper slice, splice emission, v2 named-content hash | Tranche C: CV-7 (stdlib + drift diagnostic as complements) | first-slice scope decided (0127 decision 6: context-readers admitted; declared reads/writes stay evidence) |
| 3 — Deterministic re-execution is one substrate | closed content-addressed handlers re-executed with receipts | Tranche C: CV-9 (0127 slice 3-jobs, startable now) | displaced-in-space half (option A, option D's two parallel ladders, the five owner-landings) = LLP 0129 (shape confirmed, 0127 decision 2); settle-time trust decided (decision 10: server re-derivation default; settlement Spec under 0129) |
| 4 — Liveness is a property of facts, not a fee on functions | proven push kept; felt cost removed at the client surface and search | Tranche D: CV-11, with CV-10/CV-12a/12b riding as specified | watch-item 1a pre-registration (§Watch items); flicker-diagnosis lane in LLP 0053 |
| 5 — One sealed artifact, actually adopted | sealed self-qualifying runtime pair; published closure actually used | Tranche A: CV-1 (slices 5-types/5-rebuild), CV-2 (slice 5-qual), CV-3; Tranche E: CV-13, CV-15 | sealed-artifact components under their owners (LLP 0041, 0010, 0030/0031, 0009) — cross-references, not work items |
| 6 — Bounded profiles are the unit of everything | one declared bounded-shape grammar for reads, aggregates, admission | Tranche C: CV-8 (sequence-primitive + 3a design passes ride its frame; order decided — 0127 decision 3: sequence primitive, then 3a) | profile grammar doubles as the successor Plan's proposed replica-admission vocabulary (0126 OQ4 — a proposal, not a dependency) |

CV-14 is claimed by no move and rides its custody trigger exactly as
before. The couplings are 0127's, recorded here rather than re-derived
(0127 §The composition map): move 2 is hard prerequisite ground for
move 3; move 5's sealed pair is move 3's desktop carrier and the
execution-identity tuple's runtime-identity element; move 1's grammar
carries move 3's receipts and move 4's typed consumption; the
move 6 → move 4 line is a shared principle, not a dependency — no
shared descriptor artifact exists yet.

**Startable now with no decision made** (0127's closing accounting):
move 1's CV-4a+CV-5 slice; move 2's capability-free-only cut (the full
1a slice waits on decision 6); slice 3-jobs (0121 OQ2 decided inside
it); move 4's live-search design pass and the React-surface rerun arm;
slices 5-qual and 5-types; move 6's sequence-primitive and 3a design
passes (shipping order is decision 3's call). Blocked, honestly:
decision 1 blocks move 5's packaging-shape exits and the rerun's
published-channel mode; decision 4 blocks slice 5-rebuild and with it
CV-1's exit; decision 2 gates the successor Plan's displaced-in-space
half; decision 3 gates when move 6's surface stops being bypassable;
decision 6 bounds how much of move 2's first slice exists; decisions 7
and 8 gate confirmations and the breadth starts, no move slice;
decision 9 gates nothing until the author elects to pay it; decision 10
joins decision 2 on the successor program's exit.

**v0.6: the blocked list clears.** All ten decisions were adjudicated
2026-07-30 (registry: open question 8). Decision 1 un-gates move 5's
packaging-shape exits and the rerun's published-channel mode; decision
4 un-gates slice 5-rebuild and with it CV-1's exit (now sequenced
after or with decision 9's scope migration); decision 2 gives the
successor program — LLP 0129 — its authority; decision 3 fixes
move 6's shipping order (sequence primitive, then 3a); decision 6
admits context-readers into move 2's first slice; decisions 7 and 8
confirm the absorptions, delegations, and breadth starts; decision 9
is elected and scheduled (the `@expo/snapback-*` scope migration lands
before the starter/GA front door); decision 10 lands with LLP 0129's
settlement Spec.

**Delegations and successor pointers (confirmed, v0.6).**

- *The local-first successor Plan* (0127 §Sequencing 5; confirmed by
  0127 decision 2). The local-first program — move 3's staging
  (option A, then option D's two parallel platform ladders) plus the
  five owner-landings, with 0126 option F as a proposed cheap rider —
  gets its own sequencing document rather than a tranche here: this
  board deliberately contains no offline item, and widening it would
  couple two programs with different exit criteria. The successor Plan
  landed as **LLP 0129** (`llp/0129-local-first-program.plan.md`;
  0128 was taken by a concurrent doc), pinning the cross-reference
  v0.5 carried by role. Decision 2 (2026-07-30) confirmed its shape,
  authority, and first arm — the JS/React browser arm — and the
  two-parallel-ladder staging with IR-rung-first resourcing; option C
  (client mutators) is NOT admitted and sits behind a named trigger:
  admit only if the IR rung proves insufficient for browser-side write
  expressiveness after measurement. This gives LLP 0074's
  graduation-path claim its consumer instead of a restatement.
- *The 0094/0095 delegation* (0127 §Sequencing 3; confirmed by 0127
  decision 7, 2026-07-30). The action/mutation wire-shape choice among 0125's
  option-3 paths (preserving the partial-effect distinction) and the
  wide-409 unified app-visible conflict taxonomy (0125 option 1/OQ1)
  are delegated to LLP 0094/0095 for dated decisions — recorded here,
  tracked there.
- *Burst profiling* (same proposal; confirmed by decision 7): a rerun
  precondition (§Sequencing item 5), not a CV item.
- *Product breadth* (0127 §Sequencing 4; decided by 0127 decision 8).
  Scope stays fixed here; the owner starts proceed under LLP 0074 in
  parallel with Tranche A per the §Sequencing item 1 carve-out, now
  un-gated: LLP 0044 is revived (not superseded), and the vector
  design gets a new owned Spec beside LLP 0073 — 0073 stays the FTS
  owner, the vector Spec copies its staged-admission pattern, and
  exact k-NN is the base profile first, with ANN admitted later as a
  separate capability with proved-superset translation — see open
  question 7. **Executed 2026-08-03:** LLP 0132 is Implemented for the
  experimental local SQLite target, with the A5 Guide row and macOS plus
  independent Linux/Fly filled-partition receipts. Hosted/Postgres/live remain
  support-false and the ANN doors remain unopened. This is an adjacent
  execution fact, not a new CV board item; this Plan's scope stays fixed.

## Retired gaps — do not re-litigate

The first bakeoff's highest-profile complaints are fixed on current main and
must not be carried into new backlogs (Diary 0039 §What current main fixed):

- full-text search (shipped, used by the Pantry arm: schema-level index,
  `defineSearchQuery`, portable AST, rank/highlights/cursors);
- declaration/handler duplication (inline form shipped, used by five arms);
- unknown computed outputs (exact recursive result contracts shipped);
- committed generated-tree explosion (manifest-only custody shipped);
- shared pagination (indexed range/order/take path, used by Campfire);
- cron inspection ambiguity (authenticated admin inspection matches guide);
- binary/checkout identity mismatch (both identify the same commit).

Relational composition is *partly* improved — branded IDs and a narrow stable
relational query exist — and the remainder is CV-8, not a rediscovery.

## Status board

| Item | Title | Tranche | Move | Owning doc(s) | Analysis | Size | State |
| --- | --- | --- | --- | --- | --- | --- | --- |
| CV-1 | Public package/starter loop proven from a clean repo | A (P0) | 5 | 0041 (lead), 0111, 0114; 0074 gate | 0122 | L | Open; custody decided (decision 4: CLI-fold + published helpers) and OQ5 decided (decision 1: 0074's parallel gate); slice 5-rebuild un-blocked, sequenced after/with decision 9's scope migration; slice 5-types LANDED 2026-07-31 (`1f475864`: 51 hand-authored declarations across 10 publishing packages + the three-phase `check:export-types` gate wired into the proof; named gap 4 closed); decision-9 scope migration EXECUTED in-repo 2026-07-31 (SD-6 lane: workspace renamed to terminal `@expo/snapback-*`, proof system migrated as lineage — v4 lease generation, `scopePreset`-keyed ledger validation, `PACKAGE_NAME_LINEAGE`, terminal cold-install preset, `expo/snapback` proof slug — see this doc's dated Revised entry and LLP 0041/0113; registry publication under terminal names + slice 5-rebuild remain the exit's open follow-ons); EXIT SATISFIED 2026-08-01 — all nine `@expo/snapback-*` published at 0.1.7 (candidate ledger `demos/partiful-matrix/acceptance/evidence/terminal-package-publication-0.1.7-fdd49db8.json`) and slice 5-rebuild proven by public-package-proof run 30692108019: external cold-install of the complete terminal closure from the public registry by immutable version, green on darwin-arm64 + linux-x64 with the aggregate proof |
| CV-2 | Bootstrap qualifies the real handler VM | A (P0) | 5 | 0010 | 0123 | M | Landed 2026-07-30 (`814acd77`: `snapback runtime-qualify` create/destroy gate + relink invalidation + regression fixture; ticket closed; residue = persisted receipt → CV-3, kit rungs → issues/20260730-kit-rungs-skip-handler-vm-qualification.md) |
| CV-3 | Persisted runtime readiness receipt across doctor/bootstrap/harness | A (P0) | 5 | 0010, 0030, 0031 | 0123 | M | Landed 2026-07-31 (`63dacde2` + `5ac77b8d`: `snapback.runtime-readiness.v1` receipt beside the binary; digest-recompute consumption; kept-target probe + verify-local-proof issue it; doctor read-only served-binary check; all four kit rungs covered; `SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`; kit-rungs ticket closed; posture-neutrality finding + test per 0123) |
| CV-4a | Structured collection validators for arguments | B (P1) | 1 | LLP 0131 + 0004 alignment | 0117 | M | Design accepted 2026-07-31 (LLP 0131 under SD-4 — one argument grammar carrying CV-4a and CV-5 together); implementation LANDED 2026-07-31 (wave-1 lane C6): one argument grammar admitting the full 0108 vocabulary, FunctionArgsContractV1 carried beside resultContract with the v2 recomputed witness, `validate_function_args` ingress seam on every fresh lane with bounded RFC 6901 pointers, app-wide `args_contract_v1`; exits proved by the split-ledger fixture (valid vector commits, `/splits/2/amountCents` refusal, no partial write) |
| CV-4b | Structured collection stored fields | B (P1) | 1 | new Spec + 0004/0007/0081 | 0117 | L | Open for arrays and objects (the Spec commission is unchanged). **2026-08-09: the typed-atomic slice is carved out as LLP 0211** (Review; super-refine delta-converged, pre-existing clean ×2 both families, final tail unreviewed) — plain-data structured values as canonical-JSON TEXT, interior opaque, implementation in flight under author direction; 0211 §Proposed amendment offers this row a Phase A (atomic, 0211) / Phase B (interior queries as portable declared projections, demand-gated) reframe — recorded here as proposed, not adopted; the indexable-structure commission stays open. The union-of-string-literals slice is carved out and LANDED 2026-08-08 under LLP 0004's dated stored-literal-union alignment plus LLP 0007's closed-string-domain amendment, per LLP 0191 §5 / OQ5's schema-quick-win sequencing: `FieldType::Enum`, a `TEXT` column, a central fail-closed write-path domain check, generated literal-union types, and one conservative-applier narrowing rule. It introduces no new physical representation, no element/containment vocabulary, and no index or matcher change — which is why it did not need the Spec the array/object half still does |
| CV-5 | Typed search AST: schema export + carrier alignment | B (P1) | 1 | 0073, 0037, LLP 0131 | 0117 | M | Design accepted 2026-07-31 (folded into LLP 0131's unified grammar — the 0108 recursive vocabulary at args positions); implementation LANDED 2026-07-31 (wave-1 lane C6): `search.request.schema.json` exported + drift-gated; `defineSearchQuery` carries the PlatformSchemaRef node replacing `v.json()`; generated client/provider/operation-schema carriers derive from the export; shared accept/reject corpus (`search.request.fixtures-v1.json`) agrees across Rust serde, the exported schema, embedded expansions, generated types, and published typings; no `unknown` remains at the search argument boundary; client search pin generated with coded skew refusal |
| CV-6 | Precise mutation results as the paved default | B (P1) | 1 | 0108 amendment, guide | 0117 | S | Open (OQ3 answered — decision 5: deferral confirmed, provisional lean recorded; sequenced post-A+E) |
| CV-7 | Helper reuse via revived bounded static bundling | C (P1) | 2 | 0108 follow-on | 0118 | L | Landed 2026-07-31 (`4d72c407`: full option-1a same-file slice — context-readers admitted per 0127 decision 6, splice emission, v2 named-helper-content hash, cross-helper adversarial fixtures, spliced-bytes capability rescan; ticket issues/20260730-move2-capability-free-helper-cut.md; benchmark receipts against LLP 0035's baseline still open) |
| CV-8 | Relational shapes: promote what exists, decide aggregates | C (P1) | 6 | 0110, 0080, 0113 | 0120 | L | In flight (0110 in Review, re-verified 2026-07-31; decision 3: sequence primitive first, then 3a; stable-promotion design LANDED as LLP 0134, Accepted 2026-07-31 under SD-4; **promotion machinery LANDED 2026-08-02** with an `inline_handler_v1` day-one observation and real-id promotion/demotion acceptance; the intended relation/activity soak is blocked by filed carrier drift; no capability promoted; LLP 0134 records one pre-first-promotion digest-domain correction; sequence-primitive + 3a design passes LANDED as Accepted LLP 0135; **sequence substrate checkpoint LANDED 2026-08-02** with declared scope-bearing `ctx.sequence.allocate`, atomic replay-safe counters, UTF-8 order bounds, A6 evidence, generated `AllocateSequence`, and mutation-atomic lane-Q withholding, while `sequence_allocation_v1` remains unpublished/support-false pending full §5.1 qualification; **3a snapshot-batch LANDED 2026-08-03** on the contributor local target with codegen/host LLP 0157 identity parity, one pinned snapshot, exact `sbsb1`, sealed coordinated pages, and cursor-free-first-page `live_replace`; hosted/public-package publication remains a nonclaim) |
| CV-9 | Transactional one-off scheduling (`runAfter`-class) | C (P1) | 3 | 0070 (primary) + 0028 test-seam amendment | 0121 | M | LANDED 2026-08-02: Wave-1 C2 (`e25ab2a3`, `804782a1`) already shipped the honest action-callee `runAfter` class — transactional delayed `ctx.jobs.enqueue`, rollback-schedules-nothing, fenced attempt receipts, injected-clock drain, declared status query, and experimental `jobs_one_off_v1`. The erg-01 reconciliation adds the missing file-backed crash/reopen witness: attempt 1 survives close/reopen, expires with `SNAPBACK_JOB_LEASE_EXPIRED`, attempt 2 advances the fence and succeeds, and the stale attempt cannot publish. No `ctx.scheduler` alias or production change; LLP 0070's complete profile stays unclaimed. Dispatch-arm rerun remains program measurement, not a primitive gap |
| CV-10 | Numeric normalization at the search source/recheck boundary | D (P1) | 4 (rider) | code fix (`crates/snapback/src/search/sqlite.rs`, `crates/snapback/src/storage.rs`) + one-line 0073 pin | — | S | Landed 2026-07-30 (`c57ef9cd`: canonical-digest recheck + storage normalization + 0073 pin; ticket closed) |
| CV-11 | Live/re-executing search story | D (P1) | 4 | 0073 + 0112/0114 | 0119 | L | Design half landed 2026-07-31 (LLP 0136, Accepted under SD-4: coarse re-execution on invalidation, non-auth-scoped v1, table-scoped ceilings, offer-gated negotiation); implementation + the 0114 rerun-arm prep remain open |
| CV-12a | Portable range filters | D (P1) | 4 (rider) | 0073 (new design) | — | M | Open |
| CV-12b | Search target expansion | D (P2) | 4 (rider) | 0073 §adapter sequence; PG blocked on LLP 0046 | 0124 | M | Open (roadmap exists; execution only) |
| CV-13 | Inline handlers primary in "Your first backend" | E (P2) | 5 | guide (0061) | 0122 | S | Landed 2026-07-31 (first-backend page rewritten inline-primary, legacy split moved to a labeled compatibility section; guide checks green; ticket closed) |
| CV-14 | Semantic review summary for dense manifests | E (P2) | — | custody owner (confirm at start; 0062 family) | — | M | Open (claimed by no move; rides its custody trigger) |
| CV-15 | Resolve `unpinned` harness wording for exact binaries | E (P2) | 5 | 0010 harness | 0123 | S | Landed 2026-07-31 (`5ac77b8d`; split: `pinned-binary-dirty-checkout` for exact clean-built binaries compared against a dirty checkout, `unpinned-binary` for binaries whose own stamp is dirty/unknown; kit README updated) |
| CV-16 | Declaration-closed rejection unions as result-contract variants | B (P1) | 1 | 0108 family (0125 option 2) | 0125 | M | Confirmed (0127 decision 7, 2026-07-30) |
| CV-17 | Typed-interior pilot (0117 option F) | B (P1) | 1 | 0108 clarification + codegen | 0117 | S | LANDED 2026-08-02 (`d9ebc2b1`, G-02): generated `GeneratedHandler` and manifest-derived `ctx.db`/helper-boundary types preserve query-read versus mutation-write capability; A2 checkJs is green and a seeded handler/result mismatch fails at typecheck; checker consumes the declared effective contract and never mints one. Result-side `v.doc(table)` expands through the existing document witness/hash; args and stored fields still refuse. Composition/query-graph result types remain deferred to Draft LLP 0157 |
| PB-8 | Portable exact vector search (decision 8; administratively tracked outside the parity tranches) | Outside | product breadth | 0132, 0073 | 0124 | L | LANDED 2026-08-02: experimental local `vector_search_v1` with `v.vector`, declared exact indexes and query/client carriers, synchronous SQLite maintenance, public/owner partitions, pinned `l2sq`/`dot` arithmetic and per-target conversion witnesses, stable bounded refusals, corruption quarantine, and the filled 1,536 × 43,690 scale receipt. Hosted targets, ANN/approximate search, embedding computation, live/offline search, pagination, cosine, and membership visibility remain nonclaims |

## Work items

### Tranche A — P0: make external adoption and runtime readiness boring

The rerun's largest first-hour confidence cost was not authoring — it was the
framework/runtime edge: a native-artifact incident where link and server
launch both passed while `ex_hermes_create_no_eval()` refused the first
application function, plus checkout-relative imports into the Snapback source
tree. Convex's biggest structural advantage ("installed, coherent product
loop") lives here, and no authoring improvement matters if the first hour is
untrustworthy.

#### CV-1. Prove the public external package/starter loop

**Evidence.** All seven Snapback rerun arms import codegen, clients, and the
acceptance test helpers through paths into a sibling Snapback checkout and
invoke its binary directly, and Dispatch's acceptance additionally imports
the admin client (Diary 0039 P0-1; Diary 0038 §External consumption).
Convex's arms install from the public ecosystem.

**What the owners already cover.** The load-bearing owner is **LLP 0041**
(packaged dev loop): it enumerates the nine-package public closure
(runtime binaries, CLI, codegen, client, and friends under the
`@ccheever/snapback-*` aliases — `@snapback/*` is squatted on the public
registry), the publication state machine and lease authority, repository-free
tarball cold installs, fresh-machine registry installs, and a comparator
receipt that runs a real product fixture with semantic checks. LLP 0111
incorporates that closure by reference and adds the packaged-CLI product
journey from a clean temporary project; LLP 0114 adds the React starter with a
packed cold-install gate. Publication state (corrected 2026-07-30 against
0041's own headers — the v0.2 audit's "never fired" claim was wrong): the
eight-package `0.1.0` closure has been public under `latest` since 2026-07-26
with a ledger-bound publication receipt, and the nine-package `0.1.1`
candidate promotion is in active flight as of 2026-07-29 (propagation-barrier
epochs; no completed promotion claimed). The rerun arms nevertheless consumed
none of it — the matrix ran on sibling-checkout imports three days after the
closure went public, which sharpens P0-1 from "publish" to "make the
published closure actually usable and used."

**Named gaps the owners do not cover.** (1) The **admin client**
(`packages/snapback-admin-client`) is inventoried by 0041 but excluded from
the nine-package closure; Dispatch's acceptance imports it for authenticated
cron inspection, so any arm proving the admin surface externally needed a
decision among: add it to the closure, fold it into the client/CLI, or
endorse the served `/_snapback/admin/client.mjs` path. Resolved (0127
decision 4, 2026-07-30): the admin surface **folds into the CLI** —
command-shaped, outside app graphs — and the served path remains the
documented external-tooling fallback. (2) The **acceptance test
helpers**
(`demos/_kit/server-process.mjs`, `demos/_kit/harness.mjs` — server lifecycle
and vacuous-pass-guarded checks) are published by no document; the
publish-vs-fold-vs-endorse-vendoring call is resolved (decision 4): they
are **published as a real package**. With both custody calls made, this
item's exit is satisfiable. (3) A **sequencing conflict**: LLP 0111 serializes
default-channel (`latest`) promotion behind the full hosted Fly qualification
journey, while LLP 0074 makes npm publication a parallel gate independent of
hosted milestones. Exact-version candidate-tag installs are available
pre-hosted under 0111 steps 1–2, but a pinned candidate tag is not the boring
default install P0-1 describes. This was open question 5; decision 1
(2026-07-30) resolved it — 0074's parallel gate governs, and LLP 0111 is
to be amended (see the answered OQ5). (4) A **types-condition defect** in the
published client (new in v0.4): the `./online` subpath export ships
without a `types` condition — the gap three bakeoff arms hit
independently — and the `./rqs*` subpaths share the pattern; LLP 0122
verified it unfixed on current main. Any external rebuild consuming
those subpaths inherits it. *Status 2026-07-31: SWEPT in-branch
(`move5-types-sweep`, pending landing), full-closure scope — 51 new
declarations plus first-position `types` conditions across all seven
publishing packages (client 7, vite 4, cli 6, app-cli 1, codegen 7,
contract 18, hosted-supervisor 8), publish `files` coverage, and a
structural regression gate (`scripts/check-package-export-types.mjs`
in the local proof: export-map audit + nodenext consumer-fixture
compile + declared-vs-runtime export parity over all 60 published
subpaths). The parity phase also caught and fixed drift in the
pre-existing declarations (client root/app-data, codegen define,
vite root). This named gap closes when the branch lands.*

**Work.** Complete the in-flight nine-package promotion under 0041's own
gates; close the two artifact gaps; then rebuild at least one full workout
arm in a clean external repository from published artifacts only, and give the
matrix harness an install-from-published-channel mode so future runs exercise
the public path.

**v0.5 (0127 move 5).** 0127 names this item's halves as separate
workstreams so the block stays visible instead of averaging into a
bundle: *slice 5-types* — the `types`-condition sweep closing named
gap 4 and exit clause 4 — is startable today; *slice 5-rebuild* — the
external workout-arm rebuild — is blocked on the admin-client/
test-helper custody decision (named gaps 1–2, now 0127 decision 4,
open), and its default-channel half on OQ5 (0127 decision 1, open).
The starter-as-front-door and the other cheap coherence moves 0127
lists under 0122's analysis proceed under the owners (LLP 0041/0114/
0061), with this plan holding cross-references only.

**v0.6 (decisions 1, 4, 9).** The blocks clear. Custody (decision 4):
CLI-fold plus published helpers, as recorded in the named gaps above.
Channel (decision 1): LLP 0074's parallel gate governs; LLP 0111 is to
be amended to decouple the local closure's default channel from hosted
qualification, and hosted capability stays a candidate-tag nonclaim
until the hosted journey lands. Naming (decision 9): the terminal npm
scope is **`@expo/snapback-*`** — the repository has moved to the
expo/snapback GitHub org (transfer completed 2026-07-31; `origin` is
`github.com/expo/snapback.git`), publicly committing Snapback as an
Expo product. Erratum, v0.7 (2026-07-31): the v0.6 parenthetical "the
scope currently has zero public packages" was false when recorded — a
registry scope-search miss. `npm view @snapback/cli version` returns
`3.0.1`, a live unrelated public package (created 2026-01-14, last
published 2026-03-27), matching LLP 0041's 2026-07-21 probe and this
item's own "squatted" evidence above. The `@snapback` org release
request is therefore a *dispute* against a scope with a live
unrelated package — lower odds than a free release — and it has not
been filed: it is **to be filed**, an author npm-account action on
the author's to-do list. It remains a free option in exactly the
sense that nothing gates on it, and if granted it becomes
deprecation-stub aliases pointing at the `@expo` names, never a
second migration; the decision's substance is unchanged. The scope
migration is a proof-system migration — protocol name table, schema
consts, cold-install preset, ledger lineage — scheduled before the
starter/GA front-door moment. Sequencing note, not a new decision:
slice 5-rebuild runs after or with the scope migration so the
external-rebuild proof binds the terminal name, not the throwaway
alias.

**Exit.** (1) At least one full workout arm (Campfire or Streak Lab) rebuilt
in a clean external repository using only published artifacts — including its
acceptance's test-helper needs; the admin-client proof rides Dispatch or a
separate fixture — acceptance green. (2) The
matrix harness gains a published-channel mode. (3) No checkout-relative
import remains in that arm's authored code. (4) Every published-package
subpath the arm consumes resolves with type declarations (the
`./online`/`./rqs*` defect closed). The genuinely new content here is
the workout-arm-level external rebuild and the harness mode; the fixture- and
starter-level clean-install proofs already exist in 0041/0111/0114 and are
credited, not duplicated.

#### CV-2. Qualify the real handler VM during bootstrap

**Evidence.** Before the landing, bootstrap's smoke built the binary,
launched it with `DYLD_*` scrubbed, and dyld-loaded `hermesvm.framework` —
but never executed JavaScript or created a VM; the handler VM was created
only at first invocation (`RuntimeGuard::create` →
`ex_hermes_create_no_eval()`), which is where the rerun's incident surfaced
(`issues/closed/20260730-bootstrap-smoke-does-not-create-armed-handler-vm.md`,
closed at the landing). VM creation is a behavioral/ABI coherence contract
between the statically compiled glue and the dynamically loaded framework
that symbol resolution does not test. The plausible root cause v0.1 named
for the stale state — bootstrap's `rsync -a` artifact copy preserving
source mtimes, defeating cargo's mtime-based `rerun-if-changed` so the
stale binary never relinks — was confirmed during the landing and fixed at
the source.

**Work — LANDED (2026-07-30, `814acd77`), conformed to the landed
mechanism in v0.7.** The LLP 0010 bootstrap contract now includes the
qualification: `snapback runtime-qualify` creates and destroys the exact
restricted no-eval handler VM `RuntimeGuard::create` uses
(`ex_hermes_create_no_eval`) twice and prints a
`snapback.runtime-qualify.v1` verdict; `scripts/runtime-link-smoke.mjs`
runs it against the just-linked binary with loader overrides scrubbed, so
`SNAPBACK_IBEX_RUNTIME_LINK_OK` now implies armed handler-VM readiness and
the reproduced incident state fails with the new stable
`SNAPBACK_IBEX_RUNTIME_VM_CREATE_FAILED` in LLP 0010's registry. Two v0.1
clauses are conformed against the landed owner text rather than carried as
residue. (1) "Execute at least one trivial function through it" is
absorbed: LLP 0010's landing note records that the no-eval constructor
admits no trivial execution beyond creation — creation is the incident's
exact failure point, and exact-VM create/destroy is the behavioral gate.
(2) "Bind binary and framework digests into a single readiness receipt" is
re-scoped: the qualification verdict rides the
`snapback.runtime-recovery.v1` record beside the framework digests and
binary identity, and the *persisted* digest-bound receipt is CV-3's, where
its custody and invalidation semantics were always specified. The
invalidation half landed here as v0.1 demanded: the rsync-mtime root cause
was closed at the source (the artifact copy no longer preserves source
mtimes for changed files, so a framework refresh always relinks before
qualification runs), and `scripts/verify-local-proof` now qualifies its
freshly built binary directly, closing its `SNAPBACK_BOOTSTRAP_CHECK=0`
blind spot. The receipt prior art v0.1 named (the recovery record's
captured digests, `packages/snapback-runtime-linux-x64/`
`artifact-attestation.mjs`, `bench_runtime_create_us`) now feeds CV-3.

**Exit — satisfied at the landing, as conformed above.** The regression
fixture (`tests/runtime_link_smoke_v0.mjs`) proves a launchable but
VM-refusing binary is never `LINK_OK`: the reproduced mismatched-framework
state fails with the named code instead of passing. The qualification
verdict binds to the recovery record's framework digests and binary
identity, and a post-landing framework swap relinks before qualification
via the mtime fix. Residue, tracked where it belongs: the persisted
digest-bound receipt and cross-tool digest comparison are CV-3; the demo
harness's `configured`/`prebuilt`/`reused` rungs remain presence +
`/health`-identity gates
(`issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md`). With CV-2
landed, Tranche A's remaining critical path is CV-3 plus CV-1.

#### CV-3. A persisted readiness receipt across doctor, bootstrap, and harness

**Evidence, corrected from v0.1.** The three tools already share more than
the diary implied: one probe module (`scripts/runtime-link-smoke.mjs`), one
diagnostic registry (LLP 0010's `SNAPBACK_*` codes), and one
`snapback.runtime-recovery.v1` record. What differs is evidence *strategy*,
and what is missing is *persistence*: doctor builds a fresh disposable target
(proving the checkout can produce a good binary — structurally blind to a
stale served binary, and documented in LLP 0010 as deliberate); bootstrap
builds the kept target (proving the served binary only if cargo actually
relinks); the harness runs the probe only on its `cargo` rung — the
`prebuilt`, `configured`, and reused-server rungs are presence-check and
`/health`-identity only, and `scripts/verify-local-proof` disables the smoke
by default (`SNAPBACK_BOOTSTRAP_CHECK=0`). Nothing persists a receipt, and
nothing compares the digests that are already being captured.

**Work.** Build the persisted readiness receipt — CV-3's own deliverable,
seeded by CV-2's landed qualification — into the shared artifact all three tools trust
and re-verify: defined location and custody, digest-coherence comparison, and
— the hard part — invalidation semantics when the framework changes after
issuance. Extend coverage to the harness's `prebuilt`/`configured`/reused
rungs and to `verify-local-proof`'s default path. Extend the existing shared
vocabulary with the CV-2 codes rather than inventing a parallel one. Owners:
LLP 0010, plus LLP 0030 (server-process ownership) and LLP 0031 (server
binary identity on `/health`) for the harness surfaces.

**v0.7 note (CV-2 landed).** CV-2's landing (`814acd77`) already closed
`verify-local-proof`'s `SNAPBACK_BOOTSTRAP_CHECK=0` blind spot — it
qualifies its freshly built binary directly — and left the harness's
`configured`/`prebuilt`/`reused` rungs as this item's rung-coverage
residue, tracked with a direction sketch in
`issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md`. What remains
here is the persisted receipt itself — location, custody, digest-coherence
comparison, invalidation semantics — and rung convergence on it.

**Exit.** Doctor detects the CV-2 fixture's incoherence read-only against the
*served* binary and names the recovery; every harness rung and
`verify-local-proof` refuse to run acceptance against a runtime whose receipt
is absent, stale, or incoherent, with the same code.

**Landing note (2026-07-31, in-branch, pending landing on main).** Executed
per the exit. The receipt is `snapback.runtime-readiness.v1` at
`<binary>.runtime-readiness.json` (custody by colocation: it shares the
binary's lifecycle), binding binary sha256 + root-relative Hermes artifact
digests (the exact `producerInputs.nativeArtifacts` candidate set, now one
shared function) + build identity + the `snapback.runtime-qualify.v1`
verdict; consumption always recomputes both digest sides, so binary rebuild
and framework refresh invalidate with no bookkeeping and a receipt is never
issued for a failed qualification. Issuers: the runtime-link probe on every
kept target (bootstrap smoke, kit `cargo` rung) and `verify-local-proof`
(pre-doctor and post-final-build). Consumers, one shared code
(`SNAPBACK_IBEX_RUNTIME_RECEIPT_INVALID`, LLP 0010 registry): doctor's new
read-only served-binary section; kit `configured`/`prebuilt` rungs
(verify → live re-qualify self-heal → refuse with the CV-2 code when the
binary cannot qualify; prebuilt falls back to `cargo`, configured is a hard
coded error); kit `reused` rung (binds `/health` identity to a coherent
local receipt or refuses reuse — a running process cannot be re-qualified in
place, and its recovery record says so). The 0123-gated precondition
resolved as a documented finding: the landed CV-2 subcommand shape is
posture-neutral by process isolation (LLP 0123 dated note 2026-07-31;
regression `crates/snapback/tests/runtime_qualify_posture_v0.rs`; the standing
first-VM-only-Enforce fact goes to LLP 0009's owners via
`issues/20260731-first-vm-only-strict-host-context.md`). Acceptance:
`tests/runtime_readiness_receipt_v0.mjs`, receipt fixtures in
`tests/runtime_link_smoke_v0.mjs`, rung coverage in
`demos/_kit/tests/server-process-lifecycle.mjs`;
`issues/closed/20260730-kit-rungs-skip-handler-vm-qualification.md` closed at this
landing. Residue, tracked honestly: the packaged `snapback doctor`/`dev`
surfaces still consume only the recovery record, not the receipt (they ship
with the packaged-runtime attestation of LLP 0041, which remains that
lane's owner).

### Tranche B — P1: finish input and search type fidelity

#### CV-4. Structured collection validators (split: arguments, then storage)

**Evidence, narrowed from v0.1.** Convex's `v.array(v.object(...))` validates
and types Split Ledger's split vector at the mutation boundary. On current
main the sole enforcement is the schema compiler's closed primitive map,
which rejects `v.array` and `v.union` fail-closed at argument and
stored-field boundaries (`FUNCTION_INVALID_VALIDATOR` /
`SCHEMA_INVALID_VALIDATOR`); the builders' `resultOnly` flag is dead
metadata and the result lane validates through a disjoint path — a v0.4
precision fix, code-verified in LLP 0117, to this item's earlier
"constructed result-only" framing. The `v.json()` escape hatch is already
loud (`PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED`). Notably, nested
`v.object` **arguments already work end-to-end** — typed descriptors and a
closed JSON Schema with `additionalProperties: false` — so the input gap is
specifically arrays and unions, not structured inputs generally. Neither
LLP 0004 (which constrains the vocabulary but designs only the scalar slice)
nor LLP 0108 (result-side only) specifies the extension: this is a genuine
spec hole needing a new owned Spec, with a dated-alignment amendment to
LLP 0004 — the same pattern 0108/0080/0081 used (this answers open
question 1).

**CV-4a — arguments (ship first).** Most plumbing exists on the result side
(vocabulary spellings, recursive Rust validation in `result_contract.rs`,
type/schema projection, JCS hashing, bounds). The genuinely new piece is a
runtime **ingress** validation seam: today args are typed by codegen and
plan-time expression typing, but no server-side per-invocation args-shape
validation exists even for scalars, and CV-4a's fail-closed exit requires
one. Exit: Split Ledger's split vector expressed as
`v.array(v.object(...))` without `v.json()`; generated client types match;
invalid nested payloads refuse server-side with a precise path-carrying
diagnostic.

**CV-4b — stored fields (separate, larger).** Storing arrays needs a
`FieldType` extension, a SQLite/Postgres representation decision under
LLP 0004's portability rules and LLP 0007, index/`arrayContains`/live-matcher
semantics, and LLP 0081 migration interaction. None of this is de-risked by
0108. Exit: Pantry's structured stored fields expressed natively with defined
index and sync behavior.

**Union-of-literals carve-out, landed 2026-08-08.** The four costs above are
array/object costs. A stored union of string literals pays none of them: it is
a `TEXT` column identical to `v.string()`, string-like for every filter, order,
index, and matcher, with no element vocabulary to design. LLP 0191 §5 classes
closed stored domains as a schema-fidelity quick win and its OQ5 ruling
sequences the §5 quick-wins ahead of the owner-Specs, so that slice landed
under LLP 0004's dated stored-literal-union alignment and LLP 0007's
closed-string-domain amendment rather than waiting here. Spelling is the
existing `v.union([v.literal('a'), v.literal('b')])` — no second grammar — so
0127 move 1's one-grammar proposal stays entirely unadjudicated and this row's
Spec commission is unchanged. Arrays, objects, `arrayContains`, structured
indexing, and sync semantics remain exactly as scoped above.

**v0.5 (0127 move 1).** Three proposals now ride the new Spec, each
pending its own adjudication in that Spec's loop — recorded here,
decided nowhere yet: one grammar spanning arguments, stored fields,
results, and failure variants rather than an argument-lane subset
(0117 OQ1; 0127 proposes one grammar — "the two-lane structure was the
bug, not a feature"); schema-referencing contract nodes
(`v.doc(...)`-class, 0117 option E/OQ2) placed in the CV-4 Spec —
expansion into the same frozen, hashed contracts that ship today, zero
inference; and the ingress seam framed as an evidence *addition* (0117
option A/finding 4), consistent with this item's v0.2 finding that no
server-side args validation exists even for scalars. The CV-4a + CV-5
slice is startable today per 0127's closing accounting.

#### CV-5. Type the portable search query AST (schema export + carrier alignment)

**Evidence, corrected in v0.3 (Codex review finding 6, code-verified).** The
v0.2 "one-emitter wiring" framing was wrong. The `unknown` is honest
projection, not an emitter fallback: `defineSearchQuery` itself authors
`query: v.json()`, and the contract projection faithfully emits what was
declared. The Rust types derive `JsonSchema`, but `crates/snapback/src/schema_export.rs`
exports no search schema, and the generated client's `SearchQueryAstV1`/
`SearchRequestV1` interfaces are hand-authored special cases rather than
derived from a shared artifact. So the exported, drift-gated schema CV-5
needs does not exist yet.

**Work.** Export one Rust-owned search request schema through the existing
schema-export lane; carry a schema reference or closed descriptor through the
operation contract and provider projection (replacing the authored
`v.json()`); align the hand-authored client declarations with the exported
artifact; and resolve LLP 0073 open question 12 (is the provider projection
a byte-for-byte carrier or a Contract-owned surface). Prove accepted and
rejected AST fixtures agree across Rust deserialization, the exported
schema, introspection, and generated client types. This should be sequenced
as the first conformance fixture for CV-4a's argument-contract carrier — or
explicitly justify a separate path.

**Exit.** One exported, drift-gated search request schema; introspection,
operation contract, and generated client types all derive from or verify
against it; accepted/rejected AST fixtures agree across all carriers; no
`unknown` remains at the search argument boundary.

**v0.5 (0127 move 1).** The first-conformance-fixture sequencing is
confirmed, with one carrier clarification absorbed from 0117 §CV-5:
`argsContractHash` witnesses the extended descriptor; it is not itself
a carrier.

#### CV-6. Make precise mutation results the paved default

**Evidence, corrected from v0.1.** The repair-explaining diagnostic is not
future work — it ships today: codegen emits
`SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED` with a remediation that
interpolates the actual table name. It ships at `severity: 'info'` (the
full mechanism re-verified on current main in LLP 0117), which is
exactly why two real apps (Cursor's `updateNote`, Pantry's `addRecipe`)
shipped degraded contracts anyway. LLP 0108 specifies the degraded-unknown
contract and the diagnostic but no strictness mechanism.

**Work.** This is a severity/policy item, not a mechanism item: raise the
diagnostic's visibility, resolve open question 3 (loud degradation vs.
refusal behind a per-app strictness toggle — an LLP 0108 amendment either
way), put the exact form first in the guide, and fix the two offenders. One
boundary to respect: a *fully* field-level paste-ready suggested contract
would require inspecting handler behavior, which 0108's
no-inference-from-source invariants forbid — the suggestion stays at the
template level already shipped, and that is enough.

**Exit.** A newly authored mutation without a result contract produces a
diagnostic that is hard to ignore (severity per OQ3's resolution); the two
known offenders carry exact contracts in the next rerun.

**v0.5 (0127 move 1; §Sequencing 2).** Strictness is sequenced after
the merged grammar and reference nodes land, per 0117's ordering
dependency — strictness before cheapness raises the tax on the surface
agents already dislike. The decision itself is OQ3, routed as 0127
decision 5 — decided in v0.6: the deferral is confirmed, with a
recorded provisional lean (refusal behind a per-app toggle, default-on
for new apps, default-off for existing), explicitly subject to the
rerun's severity-causality measurement; see open question 3.

#### CV-16. Declaration-closed rejection unions (confirmed, 0127 decision 7)

**Provenance.** Absorbed from open question 6 cluster (a) per 0127
§Sequencing 3; 0127 decision 7 (2026-07-30) confirmed the
absorb/delegate split, making this a confirmed CV item.

**Evidence.** App-thrown domain codes collapse to
`SNAPBACK_HANDLER_FAILED` through the JS lane's closed allowlist, while
the host-plan `elseError`/`guard` channel already emits app-authored
codes verbatim (LLP 0125 finding 4) — the asymmetry is the gap.

**Work.** Declaration-closed rejection unions as result-contract
variants riding the CV-4-era grammar work (0125 option 2): declared
failure variants in the same contract vocabulary, with the generated
failure union reaching client types. Owner: the LLP 0108 family;
substantive design lands there. The adjacent remainders are
deliberately not here: the action/mutation wire-shape choice and the
wide-409 taxonomy are delegated to LLP 0094/0095 (§The move layer,
confirmed by the same decision 7).

**Exit.** An app-declared rejection code thrown in a JS-lane handler
reaches the client typed, without widening the undeclared-failure
collapse; the declared union appears in the generated client types.

#### CV-17. Typed-interior pilot (confirmed, 0127 decision 7)

**Provenance.** Absorbed from open question 6 cluster (b)'s
interior-typing half per 0127 §Sequencing 3; confirmed by 0127
decision 7 (2026-07-30).

**Evidence.** Contract/handler mismatch is a runtime discovery today;
0117 verified a generated per-app typed builder module viable on the
current surface — checker consuming, never minting, the contract.

**Work.** A small pilot of 0117 option F: generate the handler-facing
type surface from the declared artifacts so the interior is typed and
mismatch is a dev-time squiggle, plus the dated LLP 0108 clarification
that contract-*checking* is not the inference 0108 forbids (0117 OQ4).

**Exit.** One workout arm's handlers get interior types derived from
their declared contracts; a seeded contract/handler mismatch surfaces
at typecheck time, with no change to contract authority or hashing.

### Tranche C — P1: generalize composition without losing evidence

#### CV-7. Helper reuse: revive 0108's bounded static bundling

**Evidence.** LLP 0108 v1 deliberately narrowed inline handlers to statically
self-contained expressions ("no imported or sibling helper … no transitive
source graph"), which reproduces the diary's duplication by design:
Streak Lab's calendar helper (Diary 0032) and Relay Board's indexed-read
helpers (Diary 0033). (v0.4 correction from LLP 0118: earlier drafts
attributed the indexed-read duplication to Campfire, but Diary 0034
records none; LLP 0108 carries the same misattribution and should be
corrected on its next revision.) But the design
for the fix already exists *inside 0108*: the superseded "Bounded static
bundling" section specifies literal-relative-ESM-only resolution from the
canonical app root, bounds (64 files / depth 16 / 512 KiB source / 256 KiB
bundle), per-edge byte digests, a closed pure-initializer grammar, capability
rescan of final bundled bytes, and a warm-pool benchmark gate. It was demoted
to research because the review loop timed out at NOT READY, not because the
design was rejected.

**Work.** Revive and close those sections as the 0108 follow-on rather than
designing from scratch. One consequence the follow-on must own
explicitly: the v1 content hash carries no dependency graph, so helper
reuse forces a v2 hash format — 0127 absorbs 0118's verified shape: a
list of named helper-content hashes, no paths, no graph encoding, with
exact per-operation invalidation. A v0.5 correction supersedes the
v0.4 claim that shared helpers effectively require the group-bundle
model: both motivating diary instances are same-file (0118 finding 10,
absorbed via 0127 §Sequencing 2), so the first mechanism is the
same-file lexical slice (0118 option 1a) with resolve-and-splice
emission, which dominates the superseded group-bundle under the
shipped fresh-per-invocation lifecycle (0118 finding 7); the
warm-pool-key/DK-4 phrasing is retired-era, and the follow-on absorbs
that text. Decision order: graph scope first (same-file), then
emission (splice). The 2026-07-28 adversarial-closure rules
(alias/destructuring/computed-access refusals) are re-proved at file
scope, and the benchmark is respecified as per-invocation evaluation
latency and memory against LLP 0035's ~3.9 ms baseline. The
non-negotiable invariants are unchanged: closed content-addressed
graph, no `Function.prototype.toString()` capture, no runtime
inference, no ambient checkout access.

**v0.5 scope bound (0127 move 2).** The slice as specified admits
context-reader helpers — required to satisfy both diary instances —
which is the helper-class cutline, 0127 decision 6, open; a
capability-free-only cut is startable today but covers only the
Streak Lab instance, which the pinned civil-date/money stdlib
complement independently dissolves. The stdlib and the exact-duplicate
drift diagnostic land regardless as independent complements
(0118 options 7 and 5); multi-file bounded imports (option 1 proper)
wait for measured pressure the seven small apps do not yet show
(0118 OQ6). Per 0127 §Sequencing 2 the same-file slice satisfies this
item's exit as written, which bears on its L sizing.

**v0.6 (0127 decision 6, decided).** The cutline is decided:
context-reader helpers ARE admitted in the first mechanism — the full
0118 option 1a same-file slice, covering Relay Board's indexed-read
helpers as well as Streak Lab's — and declared reads/writes REMAIN
evidence (basis: 'declared'), not enforced ceilings; ceiling
enforcement is sequenced as its own later decision, decoupled from the
helper slice. The capability-free-only qualifier on the startable cut
is obsolete.

**Exit.** Streak Lab's calendar helper written once and used by both its
query and mutation, with the module graph still closed and content-addressed,
and the 0108 refusal properties preserved under its adversarial fixtures
extended to cross-module cases. (Under the 1a slice, "cross-module"
reads as the helper crossing operation-module boundaries at splice
time — no authored multi-file graph is implied.)

#### CV-8. Relational shapes: promote what exists, decide aggregates

**Evidence, corrected from v0.1.** Two findings change this item. First, the
LLP 0113 qualification/publication path **terminates at experimental
maturity by design**: maturity is a static code-owned constant, publication
CAS never touches it, and 0113 states "promotion to stable requires a later
ratified design and evidence." v0.1's "drive through 0113 to stable" named
machinery that does not exist. Second, the aggregate shapes that dominate
both cited apps are **Non-goals of both relational documents**:
`bounded-children.v1` admits exactly one parent table and one bounded child
page per invocation (no second child collection, no aggregates, no grouping),
and LLP 0080's callable plans are two-source unique-join only with
aggregation excluded. Relay's `boardView` (one parent + three child
fan-outs + in-handler assembly) and `boardSummary` (per-column counts), and
Split's four-table ledger derivation, remain imperative even after full
promotion. `write-with-activity.v1` does fit Relay's card-patch+audit shape —
but Relay's `moveCard` computes its sequence counter via a range collect the
point-operation-only plan refuses (a live instance of 0110's own open
question 4), the first publication admits `existing-owner.v1` authority only
(anonymous arms refuse with `SNAPBACK_ACTIVITY_AUTHORITY_UNPROVENANCED`), and
adoption requires owner fields, scope-incarnation stamps with reviewed
backfill, and the ten provenance fields.

**Work.** Three separable pieces. (1) Finish what exists: complete LLP 0110's
review to Accepted with its same-landing amendments, close its publication
gates, and execute the 0113 path — yielding honest *experimental* maturity
with acknowledgment-gated runtime support. (2) Author the stable-promotion
design 0113 requires (a ratified code-and-document maturity change with its
own evidence bar) — this document does not exist and must be written before
"stable" can be claimed by anything. (3) The load-bearing half: decide the
aggregate question in LLP 0080's frame — specify a third bounded aggregate
profile covering the Relay/Split shapes (multi-child fan-out with
snapshot-consistent assembly, bounded grouped counts, bounded multi-table
derivation), or endorse the imperative handler pattern as the paved answer
with its evidence story. Do not widen the stable surface by inference.

**Exit.** Relay Board and Split Ledger rebuilt on promoted profiles where the
profiles fit (with the auth/provenance adoption cost stated, or the arms
given real owner scope), on the third profile or the endorsed imperative
pattern where they do not; no experimental capability claimed; the
sequence-counter and aggregate limitations either lifted by design or
documented as refusals.

**v0.5 (0127 move 6; §Sequencing 2).** Piece 2 gates piece 3 on the
LLP 0113 route (0120 finding 9): a new profile terminates at
experimental until the stable-promotion design exists — unless the
author rules LLP 0080's direct-to-stable act still available, which is
part of 0127 decision 3, open. For piece 3's frame, 0127 proposes a
demand-ordered ladder, smallest first: the sequence-allocation
primitive as its own small owned design (0120 OQ2 — it should not wait
for the aggregate decision; Relay's `moveCard` counter and 0125's
burst contention both implicate it), snapshot-batch composition of
admitted bounded nodes (0120 option 3a) for the `boardView` shape,
aggregates only with explicit result-semantics and noninterference
contracts (0120 finding 8 — a count can disclose rows it does not
return), and enforced cumulative examined-entry budgets (option 2a,
never the diagnostic-only 2b) as the honest general tier. The
sequence-primitive and 3a composite design passes ride this item's
frame and are startable now; their shipping order is 0127 decision 3,
open. The same profile grammar is 0127's proposed answer to 0126 OQ4
(the successor Plan's replica-admission vocabulary) — a proposal, not
a dependency. Substantive design lands in LLP 0080 (its OQ7),
LLP 0110, LLP 0113, and the new primitive design — not here.

**v0.6 (0127 decision 3, decided).** The shipping order is fixed: the
sequence-allocation primitive ships first, then the 3a snapshot-batch
composite; the contracted-aggregate profile decision is deferred until
3a usage evidence exists. Maturity route: LLP 0113's qualification
route is the default for new profiles, with piece 2's missing
stable-promotion design written as part of move 6; LLP 0080-style
direct-to-stable stays reserved for surfaces with witnessed shipped
implementations predating the rule.

**v0.7 (tracking).** Piece 2's stable-promotion design — mandatory on
the default 0113 route, authorable now, and excluded by the move 6
ticket as "beyond this ticket's two design passes" — has its
execution tracker: `issues/20260731-cv8-piece2-stable-promotion-design.md`.

#### CV-9. Transactional one-off scheduling

**Evidence, corrected from v0.1.** The design for this primitive is not
missing — it is **LLP 0070 (durable background work, Draft)**, which v0.1
and the diary both failed to cite. 0070 specifies `ctx.jobs.enqueue` with
"validation and insertion occur in the same database transaction as the
mutation's ordinary writes; if that transaction rolls back, no job exists" —
verbatim the rollback exit criterion — plus `availableAt` delays
(`runAfter`-equivalent), attempt policy, idempotency keys, and its own
receipt family (immutable job + append-only attempts). This answers open
question 2: one-off work gets 0070's receipt family, not the cron ledger,
whose identity model (`jobName`/nominal slot/schedule hash/definition
generation) structurally rejects runtime-created entries. 0028 and 0070
already cross-reference each other on exactly this boundary. 0070 is Draft
and unimplemented, and its claim boundary explicitly bars shipping this as a
cron sweep in the meantime.

**Work.** Implement the `runAfter` case as the first slice of LLP 0070's
`durable-work-single-process-sqlite-v1` profile (default queue,
`availableAt = now + delay`, transactional enqueue, host-plan action callee),
which simultaneously gives 0070 the executable evidence its Draft status
needs. Add the one thing 0070 lacks and 0028 has: a deterministic
forced-drive test seam — amend 0028's manual-tick/disable pattern into a
sibling injected-clock `jobs` drain so acceptance never sleeps. Name the
callee-class decision explicitly: whether Dispatch's one-off action→mutation
shape fits 0070 v1's generated-host-plan-action admission or needs the later
broader-action capability.

**Exit.** The Dispatch arm's one-off path uses the new primitive; a
rolled-back mutation provably schedules nothing (0070's own first acceptance
bullet); an injected-clock forced drain claims due one-off jobs with receipts
in the job/attempt ledger, giving one-off work a deterministic seam
equivalent to — not literally identical to — the cron run ledger's.

**v0.5 (0127 move 3; §Sequencing 2).** This item is 0127's *slice
3-jobs*, startable now with the callee-class decision (0121 OQ2) made
inside it. The paved-default-queue conditional and the
inspection-surface question travel with the slice ticket (0121's own
proposal); 0127 proposes answering inspection with a generated
*declared* job-status query carrying an ordinary contract (a move 1
rider), not an ambient system table, and binding the enqueue to its
producing write — the job row carries producer `mutationId` and
`snapshotVersion`, or the mutation receipt embeds its enqueues
(0121 option 3). The receipt-association owner (0121 OQ4: LLP 0070,
the 0108 family, or a new owned Spec) was part of 0127 decision 7 — a
landing choice the slice does not wait on. Hosted one-off
stays blocked-on per 0070; exactly-once is not claimed
(0121 finding 11).

**v0.6 (0127 decision 7, decided).** The enqueue-receipt association
shape is owned by LLP 0070, with its wire projection flowing to
LLP 0094 like every other receipt — 0121 OQ4 resolved.

**v0.9 (tracking, 2026-07-31 — lane C2 landing).** The first
slice landed with the wave-1 C2 lane
(`issues/20260730-move3-jobs-slice-0070.md` §Execution record):
transactional `ctx.jobs.enqueue` inside the mutation's SQLite commit,
the paved default queue, fenced claims with append-only attempt
receipts, the injected-clock `POST /_snapback/api/jobs/drain` seam
(set-based, bounded waves, synchronous receipts), the callee-class
decision (declared actions of both runtime forms — the Dispatch shape
fits), both option-3 association halves (job-side producer facts;
bounded `enqueues` on confirmed mutation receipts), the generated
declared job-status live query, and the experimental
`jobs_one_off_v1` capability facts. Both exit criteria are pinned by
Rust tests (rollback-schedules-nothing; the forced drain claims due
jobs exactly once with receipts). 0070 remains Draft — its claim
boundary stands. (The enqueue-association spec text, first recorded in
the dated 2026-07-31 amendment note, was absorbed into 0070's body as
§First slice as shipped on 2026-08-01; the note is tombstoned.)
The Dispatch arm's one-off path (the diary-visible half of the exit)
ports at the successor rerun per §Sequencing 5.

**2026-08-02 implementation reconciliation.** Commits `e25ab2a3` and
`804782a1`, the current jobs code, and the external/in-tree evidence were
rechecked against LLP 0070's shipped-first-slice contract. The implementation
already provides the author-facing `runAfter` class through
`ctx.jobs.enqueue(action, args, { delayMs, maxAttempts, ... })`; adding a
parallel `ctx.scheduler` spelling would duplicate the owned vocabulary rather
than close a capability gap. The only honest remainder was crash/reopen
evidence beyond the existing in-memory stale-fence test. The new file-backed
fixture closes that remainder by dropping the sole SQLite connection with
attempt 1 unfinished, reopening, reclaiming only at lease expiry, verifying
the first attempt's `lease_expired` / `SNAPBACK_JOB_LEASE_EXPIRED` receipt and
strictly greater successor fence, rejecting the stale publication, and
finishing attempt 2 to the exact terminal ledger. The broader LLP 0070
acceptance corpus and capability tuple remain outside CV-9's landed slice.

### Tranche D — P1: mature portable search

#### CV-10. Fix numeric normalization at the search source/recheck boundary

**Evidence, reclassified from v0.1.** The audit traced the mechanism, and it
is not a digest-canonicalization defect: both sides compute RFC 8785
canonical digests that **agree** (integral `5` and `5.0` both spell `"5"`).
What failed — fixed at the landing; v0.7 note below — was a
representation-sensitive full struct equality
(`source != authoritative`, `crates/snapback/src/search/sqlite.rs:1731` at the pre-fix
revision `01e94173`) between the
in-memory insert-path document (which keeps serde_json integer `Number(5)`
because `normalize_json_value` validates without normalizing) and the
SQLite-reloaded authoritative row (`Number(5.0)`). The
`SNAPBACK_SEARCH_INDEX_CORRUPT` message — "failed its authoritative digest
recheck" — is wrong about its own trigger. The comparison is also an
implementation strengthening beyond 0073's specified version+partition+
predicate recheck. A nasty asymmetry: patch-maintained rows reload through
SQLite on both sides and pass, so a "corrupt" row silently heals on its first
patch — only insert/seed-maintained rows reproduce.

**Work.** A code fix, not a spec amendment: compare canonical bytes/digests
at the release recheck, and/or normalize integral Reals to their SQLite
round-trip form in `normalize_json_value` at write time (the latter also
fixes the latent storage-layer asymmetry for any other subsystem comparing
in-memory vs. reloaded documents). Correct the diagnostic message. Ride along
a one-sentence LLP 0073 pin ("stored/filter scalar bytes at the
source-content and recheck boundary use RFC 8785 number spelling") to close
the residual spec silence.

**Exit.** A regression fixture with Real-typed integral search fields on the
**insert/seed** path (the only reproducing path) passes; the Pantry arm's
original schema no longer produces corruption; no legitimate accepted value
is refused.

**v0.7 landing note (2026-07-30, `c57ef9cd`).** Landed exactly as
reclassified: storage admission normalizes Real values to their round-trip
f64 form, and the release recheck compares RFC 8785 canonical content
digests (stored record vs. its own digest vs. the authoritative
derivation), releasing the authoritative derivation — legacy integral
spellings heal; genuine tamper and drift still fail closed. The diagnostic
message is corrected, the regression tests cover the insert/seed path, and
the one-sentence LLP 0073 pin landed in its §Authorization and result
release. The ticket is closed
(`issues/closed/20260730-search-real-integral-digest-corruption.md`).

#### CV-11. A live/re-execution story for search

**Evidence.** LLP 0073 excludes live search four separate ways (the generated
function is `Query` not `LiveQuery`; subscriptions refuse with
`SNAPBACK_FUNCTION_NOT_LIVE`; Non-goals; implementation-state nonclaims) and
contains no reactive design — this is a genuine design hole, not deferred
implementation. 0073 does pin the gate: a live path must earn independent
capability ids or the exact v1 target corpus before advertisement, and the
`SNAPBACK_FUNCTION_NOT_LIVE` refusal is a pinned contract until then.

**Work.** Design reactive search in LLP 0073's frame, composing with the live
query and query-group surfaces (LLP 0112/0114) rather than inventing a
parallel channel. Until it ships, the non-live declaration stays exactly as
is — no simulated reactivity, no capability drift.

**Exit.** Either a shipped live-search path under its own capability id with
the same rank/highlight/cursor contract and an eviction/invalidation evidence
story, or a dated LLP 0073 decision recording why non-live remains the claim.

**v0.5 (0127 move 4).** For the 0073-frame design pass, 0127 proposes
coarse re-execution on invalidation under its own capability id (0119
option 4): per-index subscription/concurrency budgets, first-page-only
liveness as the plausible v1, and option 5's posting-delta precision
as a later refinement of the same delivery model, not a rival. That
the remainder is composition rather than invention is the option's
hypothesis, to be proven by the design itself. The design pass is
startable now and lands alongside the rerun arm that consumes the 0114
React surface and a registered 0112 group (§Sequencing item 5). The
claim posture is unchanged: `full_text_search_v1` stays non-live and
says so until the path ships.

#### CV-12. Filters and targets (split: design vs. execution)

**CV-12a — range filters (new design).** 0073 excludes ranges with no gate
and no design; only null tests are queued. Adding them is real spec work
inside 0073's constraints: a new operator vocabulary means a new parser
profile and semantic index version (0073's version-binding rule), an
anchor/work-ceiling story (complement scans are deliberately inexpressible),
and cursor query-core hash changes. Exit: Pantry's numeric filter expressed
portably with the version-binding consequences handled.

**CV-12b — target expansion (execution of an existing roadmap).** 0073
already contains the staged adapter sequence: hosted SQLite may claim v1
after its own runtime/authorization evidence; PostgreSQL is an explicit GAP
until the store seam lands (**blocked on Draft LLP 0046** — a dependency
v0.1 failed to name); accelerators only as separate capabilities with
proved-superset translation; offline reserved. Exit: each new target lands
with its own acceptance evidence; claims continue to match exactly what
acceptance proves.

### Tranche E — P2: guide and review polish

#### CV-13. Make inline handlers primary in "Your first backend"

The intent-specific pages are current, but the getting-started page still
front-loads legacy `handlers.mjs`
(`issues/20260730-guide-gap-first-backend-front-loads-legacy-handlers.md`).
Rewrite the first-backend path around the inline form per LLP 0061's
conventions. **Exit:** guide checks green; the legacy form documented as the
compatibility lane it is.

#### CV-14. Semantic review of dense manifests

Manifest-only custody fixed source-control volume, but a reviewer facing an
85 KiB `artifacts.json` diff needs a concise semantic change summary
(operations added/removed, contracts changed, capabilities moved) over the raw
JSON (Diary 0039 P2-14). Confirm the custody owner (LLP 0062 family) when this
starts. **Exit (made falsifiable in v0.7):** against a seeded manifest-diff
fixture containing at least one operation added, one operation removed, one
result-contract hash change, and one capability fact moved, the summary
names every seeded change with its kind and misses none — fixture-checked,
not reader-judged; run over the matrix's real review-manifest diff, it
emits the same change classes without the reviewer opening the raw JSON.
Any seeded change class absent from the summary fails the check.

#### CV-15. Resolve `unpinned` harness wording

The harness labeled an explicitly configured exact binary `unpinned` even
though commit evidence was exact (Diary 0039 P2-15). Rename or split the label
so exact-but-explicitly-configured provenance is not misread as weak.
**Exit:** the label distinguishes the cases; harness docs updated.

**Landing note (2026-07-31, in-branch, pending landing on main).** Split in
`demos/_kit/server-process.mjs` `classifyBinaryIdentity`:
`pinned-binary-dirty-checkout` (the binary's own stamp is a clean exact
build of the agreed commit — exact commit evidence — and only the comparing
checkout is dirty or of unknown dirtiness: the Diary 0039 P2-15 case) versus
`unpinned-binary` (the binary's own stamp is dirty or unknown, so *its*
bytes are not pinned). Kit README and lifecycle-suite expectations updated;
the prebuilt rung's `verified`-only admission is unchanged.

## Sequencing

1. **Tranche A first, and alone.** External install and runtime readiness gate
   the credibility of everything else; the diary ranks them P0 and they are
   also prerequisites for running future matrix arms against published
   artifacts. CV-2 landed 2026-07-30 (`814acd77`) carrying its invalidation
   half, so the CV-2 → CV-3 ordering (the qualification exists before the
   tools converge on its receipt) is already half-executed: Tranche A's
   remaining critical path is CV-3 — the persisted receipt plus rung
   coverage, including the open kit-rungs ticket — and CV-1. CV-1's custody
   calls are made (decision 4), its
   default-channel exit is un-gated (decision 1; the answered open
   question 5), and slice 5-rebuild is sequenced after or with
   decision 9's `@expo/snapback-*` scope migration so the
   external-rebuild proof binds the terminal name. The carve-out is
   confirmed by 0127 decision 8 (0127 §Sequencing 4): the
   product-breadth owner starts of open question 7 — reviving LLP 0044
   (decision 8: revive, not supersede) and minting the vector-search
   Spec beside LLP 0073 — proceed under LLP 0074's umbrella in
   parallel with Tranche A, because the blocked app classes do not
   wait on the parity tranches; they sit outside the parity tranches and
   exit either way. The `PB-8` board row is an administrative completion
   record only, so "alone" continues to bind the parity work itself.
2. **Tranches B and C in parallel after A.** They touch different owners.
   CV-4a ships before CV-4b. Within C, CV-8's piece 1 continues immediately —
   LLP 0110 is already in Review — while piece 2 (the stable-promotion
   design) and piece 3 (the aggregate decision) are authorable now; CV-9
   rides LLP 0070's first implementation slice. Decision 7 confirmed
   CV-16 and CV-17; they ride Tranche B's grammar work. Piece 3's
   shipping order is decided (decision 3): the sequence primitive
   first, then 3a, with the contracted-aggregate profile decision
   deferred until 3a usage evidence exists.
3. **Tranche D after CV-5.** CV-10 landed (`c57ef9cd`, 2026-07-31);
   CV-11/CV-12a build on the typed AST; CV-12b executes 0073's roadmap as its
   gates (LLP 0046 for PostgreSQL) clear.
4. **Tranche E is continuous.** CV-13 and CV-15 are small and may land
   immediately; CV-14 rides the next custody change.
5. **Rerun checkpoint.** After Tranches A–C land, rerun the seven-app matrix
   by the Diary 0032–0039 method (same contracts, both backends, aggregate
   serial verification) and write the successor diary — with one measurement
   correction: the existing method drives the provider's headless client, so
   it cannot observe the LLP 0112/0114 React/query-group gains at all. At
   least one arm (Campfire is natural) must consume the 0114 React surface
   and a 0112 registered group, or the plan's watch trigger on the reactive
   boundary is unmeasurable. Tranche D/E completion is not gated on the
   rerun, but the rerun is the plan's measurement, not an optional extra.
   v0.5 (0127 §Measurement): two rerun preconditions ride this
   checkpoint — a normalized-profile burst benchmark before any
   performance claim (0125 option 5; the §Sequencing-3 disposition,
   confirmed by 0127 decision 7), and, for the local-first
   hardening claim whose program lives in LLP 0129, option
   A's diary-grade offline acceptance on the JS/React arm (0126's
   evidence gate; the arm is confirmed by 0127 decision 2).
   0127's proposal for open question 4 —
   offline/cold-boot scoring as a new dimension on existing arms — is
   recorded at that question, answered by LLP 0130 SD-3 (2026-07-31).
   2026-07-31: the React-surface measurement requirement is SATISFIABLE —
   the Campfire arm exists in-repo (`demos/campfire`), consuming the 0114
   React surface and the registered 0112 group `/rooms/:roomId`, with the
   retained acceptance `demos/campfire/acceptance/results/react-arm.v1.json`
   pinning both consumptions (the suite fails if the arm leaves the React
   surface or loses registered boot). Measurement prep only; the rerun
   itself, its burst-benchmark and offline-acceptance preconditions, and
   the watch trigger's scoring remain open.

## Exit criterion for the plan

The plan is done when a full matrix rerun shows:

- the four "slight Convex edge" arms (Streak Lab, Campfire, Split Ledger,
  Pantry Search) each become a near tie or a Snapback win on the diary's own
  scoring frame, with the specific mechanism named (CV-4/6/7 for authoring,
  CV-8 for aggregates, CV-9 for Dispatch's one-off path, CV-11/12 for search);
- Cursor Garden's decisive win and every evidence property in §Governing
  constraints are preserved;
- the rerun's Snapback arms build from the published channel (CV-1), and no
  first-hour runtime incident class from Diary 0039 recurs (CV-2/3); and
- the successor diary's recommendation paragraph no longer needs the clause
  "still exposes framework/runtime edges."

An honest 50/50 with intact differentiators satisfies this Plan; the
larger strategic frame (hosted profiles, commercial surface, Expo
distribution) remains LLP 0074's and is not re-scored here. The
local-first program's exit deliberately does not live here either: per
0127 §Sequencing 5 (successor-Plan shape confirmed by 0127 decision 2;
the program is LLP 0129),
widening this board would couple two programs with different exit
criteria; the programs share substrate — moves 2, 5, and 6 — and this
plan holds the cross-reference (§The move layer).

## Watch items (no action now)

- **Reactive-by-default queries.** Convex's deepest structural advantage is
  that ordinary queries are reactive without a separate live classification.
  Snapback's explicit live boundary is a deliberate evidence choice
  (LLP 0074), and the newest surfaces reinforce it (a route with one ordinary
  `Query` child loses register-group generation entirely, per LLP 0112).
  LLP 0112/0114 close the *subscription-glue and typed-consumption* half of
  the Campfire-style DX loss — and register-mode boot consistency is arguably
  better than Convex's default — but they deliberately leave the
  classification itself and server-side authoring explicitness untouched
  (those belong to CV-4/6/7 and CV-11). Revisit only if the rerun — measured
  through the React surface per §Sequencing item 5 — still scores the
  boundary itself as a loss after CV-11 and the query-group surface ship.
  v0.5 (0127 §Sequencing 7): this watch item now carries move 4's
  pre-registered answer. If the trigger fires, 0127 pre-registers
  option 1a — one authored kind with split callable/subscribable
  capability facts, scoped per target — on its stated mechanism
  assumption: the subscribable fact is minted from a declaration
  (0127's assumed home is the function's manifest-entry capability
  fact), never classified from plan shape. The pre-registration is
  0127's own judgment, informed by — not selected by — 0119 finding 6;
  accepting it is an author call, the trigger condition is unchanged,
  and no owner changes until it fires.
- **Graph generation speed and consumer-facing projections.** The 7× generated
  graph is fine while generation is fast and consumers never read internals;
  watch for either assumption failing.
- **Convex anonymous local mode maturing out of beta** — the port-coordination
  friction noted in the rerun is the one operational edge Convex still shows
  locally; if it disappears, Tranche A's bar rises.

## Open questions

1. **CV-4 spec placement — ANSWERED (v0.2).** New numbered Spec plus a
   dated-alignment amendment to LLP 0004, per the 0108/0080/0081 precedent
   and 0004's own split-into-Spec status note.
2. **CV-9 receipt semantics — ANSWERED (v0.2).** LLP 0070's receipt family
   (immutable job + append-only attempts), not the cron run ledger, whose
   identity model rejects runtime-created entries.
3. **CV-6 strictness — ANSWERED (v0.6, 0127 decision 5).** The
   post-A+E deferral is confirmed: the strictness call lands after
   move 1's A+E land, per 0117's ordering dependency. The author's
   provisional lean is recorded — refusal behind a per-app strictness
   toggle, default-on for new apps and default-off for existing ones —
   explicitly subject to the rerun's severity-causality measurement
   before the LLP 0108 amendment lands. (v0.5 routed this as 0127
   decision 5, then open.) LLP 0130 SD-1 pre-adjudicates the
   completion: enact the recorded lean when move 1's A+E land;
   escalate only if the severity-causality measurement contradicts it.
4. **Rerun scope — ANSWERED (2026-07-31, LLP 0130 SD-3).** Decided
   outright: the seven contracts run unchanged for diary-to-diary
   comparability; §Sequencing item 5's React-surface measurement is
   included; the local-first offline dimension (LLP 0129 §Measurement)
   folds into the same rerun; an eighth contract targeting structured
   inputs plus one-off scheduling is added only if moves 1 and 3 have
   landed by rerun time. (The question, for the record: reuse the
   seven contracts unchanged, or add an eighth targeting the new
   surfaces at the cost of diary-to-diary comparability? v0.5
   recorded 0127 §Sequencing 6's proposed answer — seven unchanged,
   offline/cold-boot scoring as a new dimension on existing arms per
   0126 finding 1, at most one product-breadth contract once open
   question 7's owners ship something scoreable — on record and
   undecided; SD-3 decides the composition.)
5. **npm default-channel gating — ANSWERED (v0.6, 0127 decision 1).**
   LLP 0074's parallel gate is adopted: LLP 0111 is to be amended to
   decouple the local closure's default channel from hosted
   qualification, and hosted capability stays a nonclaim —
   exact-version candidate-tag installs only — until the hosted
   journey lands. This un-blocks CV-1's default-channel exit, move 5's
   packaging-shape exits, and the rerun's published-channel mode. (The
   conflict, for the record: 0111 serialized `latest` promotion of the
   nine-package closure behind the full hosted Fly journey while 0074
   made npm publication a parallel gate; the eight-package `0.1.0`
   closure had already reached `latest` on 2026-07-26, the day before
   0111's gate was written. v0.5 routed this as 0127 decision 1, then
   open.)

   **Reaffirmed and propagated 2026-08-02.** The author decision sitting
   confirms that the locally provable nine-package surface promotes on LLP
   0134's maturity bar under the LLP 0074 parallel gate. Hosted work remains
   independently gated and cannot borrow a capability claim from that
   promotion. Source: `issues/20260802-author-decision-packet.md`.
6. **Unowned remainders from the research series — ANSWERED (v0.6,
   0127 decision 7).** The §Sequencing-3 absorb/delegate split is
   confirmed exactly as v0.5 recorded it: cluster (a)'s rejection
   unions are absorbed as CV-16 (riding the CV-4-era grammar; owner
   the LLP 0108 family, 0125 option 2) and cluster (b)'s
   typed-interior pilot as CV-17 (0117 option F), both in Tranche B;
   the action/mutation wire-shape choice (partial-effect distinction
   preserved) and 0125's wide-409 remainder, the unified app-visible
   conflict taxonomy (0125 option 1/OQ1), are delegated to
   LLP 0094/0095 for dated decisions; burst profiling is a rerun
   precondition, not a CV item; cluster (b)'s return-inference half is
   answered by move 1's declaration compression (option E, riding the
   CV-4 Spec) rather than a CV item, with infer-then-freeze (C) as
   0117's named bridge only if post-A+E measurement still scores bulk
   as decisive. The decision also names the enqueue-receipt
   association owner: LLP 0070, with its wire projection flowing to
   LLP 0094 like every other receipt (0121 OQ4 resolved). The
   CV-16/CV-17 rows and the related §Sequencing amendments are no
   longer marked proposed.
7. **Product-breadth scope boundary — ANSWERED (v0.6, 0127
   decision 8).** The first branch, as v0.5 recorded 0127's proposal:
   this plan's scope stays fixed (no breadth tranche), and the owner
   starts proceed now under LLP 0074's umbrella in parallel with
   Tranche A (the §Sequencing item 1 carve-out, now un-gated).
   Specifics decided: LLP 0044 is **revived**, not superseded, as the
   file-storage owner (0124 OQ1 resolved toward revival; local store
   first with the object-store seam designed and the
   delivery-authorization axis held open per 0124 OQ7); the vector
   design lands in a **new owned Spec beside LLP 0073** — 0073 stays
   the FTS owner, and the vector Spec copies its staged-admission
   pattern; **exact k-NN is the base profile first**, with ANN
   admitted later as a separate capability with proved-superset
   translation (resolving 0124 OQ3's reserved order). Rider, restored
   v0.7 (0127 §Sequencing 4 required "the float-pinning question
   named either way, 0124 OQ2/OQ3"): the portable-exactness pinning
   strategy for float distance arithmetic — 0124 OQ3's named
   subquestion; the FTS integer-scoring precedent does not transfer —
   is undecided and rides the vector Spec. Execution fact, recorded
   in the v0.7 board sweep: LLP 0044's revival revision landed
   2026-07-31 (`14bd5ddb`), executing this decision's revive call.
   Second execution fact, 2026-08-03: LLP 0132 is Implemented for the
   experimental local SQLite target. The exact D=1,536 × 43,690 corpus passes
   both the local macOS carrier and an independent Linux/Fly carrier; the A5
   Guide row is shipped locally. No hosted/Postgres/live capability or ANN
   accelerator is claimed, so decision 8's successor door remains closed.
8. **The ten 0127-routed author decisions (new in v0.5) — ALL TEN
   DECIDED (v0.6, 2026-07-30).** LLP 0127's acceptance accepted the
   synthesis direction; the author adjudicated the ten routed
   decisions themselves on 2026-07-30. LLP 0130 (2026-07-31) now
   governs the mid-flight gates these decisions leave open — standing
   decisions with escalation reservations. The registry of record:
   1. *npm channel gate* — DECIDED: LLP 0074's parallel gate adopted;
      LLP 0111 to be amended to decouple the local closure's default
      channel from hosted qualification; hosted capability stays a
      candidate-tag nonclaim until the hosted journey lands (= OQ5).
   2. *Local-first program* — DECIDED: successor-Plan shape confirmed
      as LLP 0129; the JS/React browser arm is the first carrier;
      two-parallel-ladder staging with IR-rung-first resourcing
      confirmed; option C (client mutators) NOT admitted, held behind
      a named trigger — admit only if the IR rung proves insufficient
      for browser-side write expressiveness after measurement.
   3. *Aggregates* — DECIDED: the sequence-allocation primitive ships
      first, then 3a snapshot-batch; the contracted-aggregate profile
      decision is deferred until 3a usage evidence exists. Maturity
      route: 0113's qualification route is the default for new
      profiles, with the missing stable-promotion design written as
      part of move 6; 0080-style direct-to-stable is reserved for
      surfaces with witnessed shipped implementations predating the
      rule.
   4. *Custody* — DECIDED: the admin surface folds into the CLI
      (command-shaped, out of app graphs; the served path remains the
      documented external-tooling fallback); the acceptance test
      helpers are published as a real package.
   5. *CV-6 strictness* — DECIDED: the post-A+E deferral is
      confirmed; provisional lean recorded (refusal behind a per-app
      toggle, default-on for new apps, default-off for existing),
      explicitly subject to the rerun's severity-causality
      measurement (= OQ3).
   6. *Helper cutline* — DECIDED: context-reader helpers are admitted
      in the first mechanism; declared reads/writes remain evidence
      (basis: 'declared'), not enforced ceilings; ceiling enforcement
      is sequenced as its own later decision, decoupled from the
      helper slice.
   7. *OQ6 delegation + receipt owner* — DECIDED: the §Sequencing-3
      absorb/delegate split is confirmed (CV-16 rejection unions and
      CV-17 typed-interior pilot confirmed as CV items; the 0094/0095
      wire-shape and wide-409 delegations confirmed; burst profiling
      confirmed as a rerun precondition); the enqueue-receipt
      association shape is owned by LLP 0070, with its wire
      projection flowing to LLP 0094 like every other receipt
      (= OQ6).
   8. *Product breadth* — DECIDED: LLP 0044 is revived, not
      superseded; the vector design lives in a new owned Spec beside
      LLP 0073 (0073 stays the FTS owner; the vector Spec copies its
      staged-admission pattern); the parallel start under LLP 0074 is
      confirmed — the §Sequencing-1 carve-out un-gates; exact k-NN is
      the base profile first, ANN admitted later as a separate
      capability with proved-superset translation (= OQ7). Rider,
      restored v0.7 per 0127 §Sequencing 4 ("the float-pinning
      question named either way, 0124 OQ2/OQ3"): the
      portable-exactness pinning strategy for float distance
      arithmetic (0124 OQ3's named subquestion — the FTS
      integer-scoring precedent does not transfer) rides the vector
      Spec, named and undecided.
   9. *Naming* — DECIDED: the terminal npm scope is
      `@expo/snapback-*` — the repository has moved to the
      expo/snapback GitHub org (transfer completed 2026-07-31),
      publicly committing Snapback as an Expo product. Premise
      erratum, v0.7 (2026-07-31): as recorded in v0.6 this entry said
      the `@snapback` scope "currently has zero public packages" and
      that the org release request "is filed in parallel"; both were
      false when recorded. `@snapback/cli@3.0.1` is a live unrelated
      public package (last published 2026-03-27; probed 2026-07-31) —
      the "zero" premise was a registry scope-search miss that
      contradicted CV-1's own "squatted" evidence and LLP 0041's
      2026-07-21 probe — so the org release request is a *dispute*
      with lower odds, not a free release; and no request has been
      filed: it is **to be filed**, an author npm-account action on
      the author's to-do list. The decision's substance is unchanged:
      nothing gates on the request, and if granted it becomes
      deprecation-stub aliases pointing at `@expo` names, never a
      second migration. The scope migration is a proof-system
      migration (protocol name table, schema consts, cold-install
      preset, ledger lineage), scheduled before the starter/GA
      front-door moment. Sequencing note, not a new decision: slice
      5-rebuild runs after or with the scope migration so the proof
      binds the terminal name, not the throwaway alias.
   10. *Settle-time trust* — DECIDED: server re-derivation is the
       default for client-captured `now`/ids at settlement;
       client-captured values are carried in receipts as labeled
       claims, never authority; bounded-skew acceptance only as
       per-field declared opt-in; owned by a new settlement Spec
       under LLP 0129's program.

   Every decision-gated element in this plan named its number; this
   revision resolves those markers in place.
