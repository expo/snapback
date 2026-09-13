# LLP 0086: Course corrections from the 2026-07 prior-art passes

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Deployment, Auth, Sync, Realtime, Storage, Competitive analysis
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Revised:** 2026-08-03 (v0.5 — status flip declined at the author's decision sitting #2, "accept all that verify" (`issues/20260803-author-decision-sitting-2.md`): the honest verification found genuinely open work items, so the Plan stays Draft. Concretely: CC-1's build half is Open/Blocked on LLP 0089 review plus the LLP 0082 evidence gate (`issues/shelved/20260723-0086-cc1-provisioning-build.md`; no provisioning surface exists in code per the 2026-08-01 sweep), CC-2's Phase 0 spike is still executing under LLP 0087, CC-7's acceptance waits on the LLP 0085 gate and LLP 0088's own review, and CC-6's positioning batch remains publication-gated. The author's intent is recorded here: promote this Plan to Implemented once those remaining items close.) 2026-07-23 (v0.1 — round-1 review revision: governing constraints made operational, CC-2 condensed under LLP 0087's authority, Dynamic Workflows split out as CC-2b, CC-8 documentation batch and the evidence-disposition ledger added, CC-1 dependency chain stated, CC-6 licensing wording corrected. v0.2 — post-READY editorial pass after round 2 (Fable READY, Codex NOT READY; applied unreviewed): CC-1 operation set aligned with LLP 0087 Phase 2 and "working app" defined, publication gate extended to LLP 0001-sourced and compound claims, CC-4 pushdown scope bounded and guest-auth decision checklist added, CC-8 rows classified citation-vs-decision-bearing, CC-7 gains LLP 0007, CC-5/CC-3/CC-2b citation and status wording fixes. v0.3 — 2026-07-23 execution close-out: status board reconciled to execution results, execution note added, CC-6 marker provenance corrected (mesh marker lives in LLP 0084), LLP 0088/0089 referenced. v0.4 — 2026-07-23 CC-3 probe close-out: probe ran (data-dependent revocation evicts live, rule revocation reconnect-only), decision rule fired, LLP 0074 claim narrowed, LLP 0082 corrected)
**Related:** LLP 0000, LLP 0001, LLP 0003, LLP 0007, LLP 0008, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0014, LLP 0018, LLP 0019, LLP 0024, LLP 0028, LLP 0033, LLP 0037, LLP 0040, LLP 0053, LLP 0060, LLP 0068, LLP 0070, LLP 0074, LLP 0076, LLP 0079, LLP 0082, LLP 0083, LLP 0084, LLP 0085, LLP 0087, ENG-25387

## Summary

The 2026-07-23 research batch — [LLP 0082](./0082-instantdb.research.md)
(InstantDB), [LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)
(Cloudflare DO/D1 + Rivet), [LLP 0084](./0084-triplit-ditto.research.md)
(Triplit/Ditto), [LLP 0085](./0085-jazz.research.md) (Jazz), and the LLP 0001
survey extension — validated Snapback's load-bearing bets (server-authoritative
LWW, the ephemeral lane, DO-per-app isolation, MIT) and surfaced a bounded set
of changes worth making. This plan converts those findings into work items with
owning documents, evidence, and exit criteria, in the same shape
[LLP 0079](./0079-serverpod-course-corrections.plan.md) used for the Serverpod
research. The [disposition ledger](#evidence-disposition-ledger) at the end
accounts for every actionable pointer in the research batch — as a work item, a
watch item, an already-landed change, or a named no-action — so nothing is
dropped silently.

Accountable executors, issue keys, and time boxes are assigned when an item
enters the normal LLP 0032-style docket path; this plan fixes each item's
scope, kind, size, dependencies, and exit criteria so that assignment is
mechanical.

## Governing constraints

**1. Ratification.** No item in this plan changes a ratified decision. Items
add capabilities, refresh stale facts, or record deliberate evaluations behind
decision gates. One item's evidence bears on a ratified one-way door — CC-2
touches [LLP 0014](./0014-cloudflare-strategy.rfc.md)'s door 2 (bundle loading
is deploy-time, never runtime eval) — and there the door is re-examined only
through the owning document's recorded path: LLP 0014's premise-change
annotation (2026-07-23) holds the decision in force until LLP 0014 itself
re-ratifies or reaffirms it on Gate 0 evidence, per
[LLP 0087](./0087-facets-hosted-adoption.plan.md) §Ratification posture. This
plan neither performs nor presumes that re-ratification. App-data ownership is
not in question anywhere: every CC-2 topology keeps app rows, the version
counter, and the journal in the coordinator DO's SQLite, with facet-local
SQLite carrying scratch and role-local state only (LLP 0087, door 1).

**2. Evidence review gates.** The evidence base (LLP 0082–0085) is Draft and
unreviewed. "Passes review" means, operationally: at least one independent
LLP 0005 review artifact from a non-authoring model family exists under
`llp/reviews/` for the document, and the author has dispositioned every
blocking finding (the document's status transition records this). Two gate
dimensions apply, deliberately distinct:

- **Commitment gates** — the plan's largest commitments (CC-1, CC-7) do not
  start until their evidence documents (LLP 0082, LLP 0085) pass review.
- **Publication gates** — externally visible competitive claims (CC-3's claim
  text, CC-6's batch) do not publish until the supporting evidence passes
  review *or* the claim is re-established by fresh empirical verification
  (CC-3's probe is exactly that). Drafting may begin speculatively; publishing
  may not. This gate covers LLP 0001-sourced claims too — LLP 0001 is likewise
  Draft — so CC-6's fragile-suppliers argument and boundary markers publish
  only once the LLP 0001 synthesis sections they rest on are reviewed or the
  claims are re-verified against primary sources. A compound claim publishes
  only when every factual component has cleared its gate; each published claim
  carries its own source set, evidence-class label, and checked date.

CC-2 is deliberately not review-gated, on two grounds: its load-bearing
platform facts were independently re-verified into LLP 0014 with dated
provenance (the ENG-25387 refresh, LLP 0014 Revised 2026-07-23), so CC-2 no
longer rests on the unreviewed LLP 0083 for facts; and all commitment is
deferred behind LLP 0087's gates plus the LLP 0014 re-ratification above —
only the information-buying Phase 0 is authorized today.

## Status board

| Item | Title | Kind | Size | Owning doc(s) | State |
| --- | --- | --- | --- | --- | --- |
| CC-1 | Agent provisioning surface (remote MCP + platform API) | Spec + build | L | 0089 (new), 0010, 0024 | Spec drafted (LLP 0089, 2026-07-23, author-directed early start); build blocked on spec review + 0082 gate |
| CC-2 | Facets/Dynamic Workers evaluation + LLP 0014 refresh | Evaluation spike | — | 0014, 0087 | Steps 1+1b done (GA determination 2026-07-23: still open beta — prohibition binding); Phase 0 spike executing under LLP 0087 |
| CC-2b | Dynamic Workflows as LLP 0070 hosted-profile candidate | Assessment | S | 0070 | Done 2026-07-23 (verdict: blocked-on, five named facts) |
| CC-3 | Revocation-eviction as a proven differentiator | Verification + probe | M | 0053, 0074, 0082 | Done 2026-07-23 (probe: data-dependent revocation evicts live ~32 ms, rule revocation reconnect-only; claim narrowed per decision rule, landed in LLP 0074, publication gated) |
| CC-4 | Permission pushdown requirement; auth paved-path design amendments | Design amendment | S | 0011 | Landed 2026-07-23 (LLP 0011 dated addendum) |
| CC-5 | Streams comparison into bounded streamed actions | Design comparison | S | 0076 | Landed 2026-07-23 (four dispositions recorded) |
| CC-6 | Positioning batch | Positioning | S | 0074 | Drafted 2026-07-23 in LLP 0074; publication gated |
| CC-7 | Record history/branching exploration | RFC exploration | M | 0088 (new), 0008, 0007 | RFC drafted (LLP 0088, 2026-07-23, author-directed early start); acceptance waits on 0085 gate + own review |
| CC-8 | Documentation absorption batch | Doc batch | S | 0003, 0007, 0008, 0011, 0013, 0028, 0037, 0000 | Landed 2026-07-23, all 13 rows (row 1's LLP 0024 half rides LLP 0089) |

## Work items

### CC-1. Agent provisioning surface (from LLP 0082)

**Evidence.** InstantDB ships a hosted remote MCP server with OAuth whose
tools create apps and push schema/permissions, plus a programmatic platform
API — an agent goes from nothing to a provisioned, permissioned backend with
no human dashboard session (LLP 0082 §Agent-first DX). Encore reached the
same conclusion from product evolution (LLP 0001 §Encore). This is the
highest-leverage product gap against the competitor closest to Snapback's
surface.

**Work.** Specify and build the reachable-from-anywhere provisioning path:
a provisioning surface whose operations cover create-app, push-schema,
push-permissions, push-code (function/artifact publication, with version
selection and rollback — matching the create / push-code / roll-back set
LLP 0087 Phase 2 requires of this contract, along with its
artifact-provenance and schema/code-compatibility requirements), and
read-capability-manifest, honoring
[LLP 0024](./0024-agent-operating-surface.spec.md)'s operating-surface
contract and [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)'s acceptance
bar. The surface spec must expose the schema-lockdown toggle (CC-8.1's
safety feature) and must decide the projection order (remote MCP first,
platform HTTP API first, or both behind one spec — open question 1) before
implementation starts. Include the smaller absorptions that ride along: docs
served as `.md`-suffixed URLs, and a skills package.

**Scope and dependencies (stated, not implied):**

- **The LLP 0024 revision is a scope extension, not a reinterpretation.**
  LLP 0024 today explicitly does not own hosted control planes, billing,
  tenants, or project lifecycle (LLP 0024 §What this spec owns). CC-1 either
  extends LLP 0024's scope into project lifecycle by reviewed amendment or
  places the provisioning contract in a new owning document; LLP 0087
  Phase 2 consumes whichever contract results.
- **Hosted authority prerequisites.** LLP 0024's dated amendment (2026-07-16)
  refuses hosted operations pending
  [LLP 0060](./0060-hosted-auth-security.rfc.md)'s target-authored
  deployment contract and LLP 0019 F8's durable audit log, with the
  applicable LLP 0011 service-principal work riding along. Those are
  prerequisites for the *hosted* half of CC-1, exactly as LLP 0087 Phase 2
  lists them.
- **Target scope.** The exit criterion runs first on the local /
  trusted-local target, where apps are already data. Hosted end-to-end
  provisioning depends on the hosted authoring model and is delivered in
  coordination with LLP 0087 Phase 2's apps-as-data control plane; an
  interim wrangler-automation path behind the same surface is acceptable
  only if marked pre-contract and non-public, per LLP 0087's Phase 2
  fallback rules.

**Exit.** (1) An agent with only credentials and the surface endpoint can
provision a working app end-to-end on the local/trusted-local target —
"working" meaning schema, permissions, and function code are all loaded and
at least one generated function invocation succeeds — demonstrated by an
acceptance gate; the hosted equivalent lands with LLP 0087 Phase 2. (2) LLP 0010/0024 (or the new contract document) revised to
specify the surface, with the scope extension explicitly reviewed.
(3) Docs reachable as `.md`-suffixed URLs, verified by a fetch check in the
acceptance gate. (4) A skills package installable into an agent's skill
discovery path, exercised by at least one acceptance scenario.

### CC-2. Durable Object Facets / Dynamic Workers — evaluation and LLP 0014 refresh (from LLP 0083)

**Evidence.** Cloudflare shipped Worker Loader (runtime code loading) and DO
Facets: a supervisor DO can load tenant-supplied code at runtime as child
facets, each with its own isolated SQLite database; Dynamic Workflows
extends the pattern to durable execution (LLP 0083 §Dynamic Workers). Two
LLP 0014 platform facts went stale as a result (tracked as ENG-25387).

**Why this is urgent-shaped.** Snapback's current hosted model
([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md); `targets/cloudflare/`) compiles
the app bundle into the deployed Workers at deploy time (esbuild alias
`snapback-app` → `app/<name>.app.js`) across two or three per-app Worker
services — gateway and handler isolate for the notes proof; All Aboard adds
a third, separate action handler — so **app creation and code update on
Cloudflare are wrangler deploy cycles, not data operations**, unlike the
local target, where apps are data the host loads. Facets are the
platform-native version of the data-operation model: one deployed Snapback
platform, per-app code loaded at runtime into per-app facets. If the
isolation and economics hold, this collapses the hosted control plane and
closes the local/hosted authoring asymmetry; if Snapback ignores it, the
same primitive lowers the barrier for anyone else to build per-tenant
backend hosting.

**Work and state.** This item is elaborated into a full staged adoption
plan, [LLP 0087](./0087-facets-hosted-adoption.plan.md), which is the sole
detailed authority for the spike specification, topology candidates,
phases, and gates; this plan keeps only the summary and the authorization
boundary to avoid divergent copies.

1. **Done** — the ENG-25387 LLP 0014 platform-fact refresh landed (LLP 0014
   Revised 2026-07-23: dynamic-code fact, storage-billing enforcement,
   write/read price asymmetry in the cost model, door-2 premise-change
   annotation). Residue: close ENG-25387, and LLP 0087 Phase 0 step 1b's
   follow-up (fold the published Dynamic Workers pricing and a dated GA
   determination into LLP 0014).
2. **Executing** — the time-boxed spike is LLP 0087 Phase 0 (first local
   results are in `targets/cloudflare/spike-facets/`; the LLP 0009 isolation
   review, real-platform measurements, and facet-migration semantics remain
   open there).

**Decision gate.** After the spike, LLP 0014 records one of: adopt facets
for the next hosted profile; keep the hand-built per-app deploy; or hybrid.
The beta prohibition — no hosted rearchitecture starts while facets are
beta — binds until LLP 0014 records a dated GA determination (the platform's
current docs carry no beta caveats; LLP 0087 Phase 0 step 1b is the
follow-up that settles this in LLP 0014, and no external platform-status
claim affects the gate until recorded there). Adoption beyond Phase 0
additionally requires LLP 0014's door-2 re-ratification (governing
constraint 1). Lock-in accounting (Worker Loader is proprietary; `workerd`
parity now partially demonstrated by the local spike; Rivet optionality per
LLP 0083) goes into the decision alongside
[LLP 0033](./0033-license-posture.decision.md)'s openness stance.

**Exit.** ENG-25387 closed; LLP 0014 carries the pricing facts, the dated
GA determination, and the gate decision; LLP 0087's Gate 0 receipt recorded.

### CC-2b. Dynamic Workflows as the LLP 0070 hosted-profile candidate (from LLP 0083)

**Work.** A bounded assessment — separate from the facets spike, since it
answers a different question against a Draft RFC: whether Dynamic Workflows
can carry [LLP 0070](./0070-durable-background-work.rfc.md)'s hosted
profile (same conformance suite, different substrate). Day-scale time box;
no implementation.

**Exit.** A dated candidate-assessment note in LLP 0070 (in its
target-profile material, creating a hosted-profile subsection if needed):
viable / not-viable / blocked-on (with the blocking facts named).
Any adoption decision belongs to LLP 0070's own review cadence.

### CC-3. Revocation-eviction as a proven differentiator (from LLP 0082, 0084)

**Evidence.** Snapback has a ratified authorization-invalidation contract
([LLP 0053](./0053-authorization-invalidation.rfc.md)); InstantDB is
publicly silent on revocation eviction (LLP 0082 §Permissions); the one peer
that shipped a comparable protocol — Triplit — is dead, with its design
readable in a frozen repo (LLP 0084 §Triplit).

**Work.**

1. Confirm LLP 0053's contract is implemented and acceptance-tested on the
   named targets: the local (Ibex-hosted) target, and the Cloudflare target.
   On Cloudflare the expected result today is a **recorded capability gap**,
   not a pass — LLP 0053 records (open question 3) that the Cloudflare
   coordinator currently has no auth machinery — and the item's output there is an
   honest statement of which targets the differentiator claim covers.
2. A design read of Triplit's server-driven eviction protocol against
   LLP 0053 — read for design, not reuse (AGPL).
3. An empirical probe app on InstantDB answering whether permission
   revocation evicts already-synced rows. The probe **preregisters** its
   observable (what row state in what client store constitutes
   evicted/not-evicted) and its timing threshold before running, so
   ambiguous cache behavior cannot be interpreted after the fact.
4. The resulting one-paragraph claim goes to LLP 0074, carrying LLP 0074's
   evidence-class labels and subject to the publication gate (governing
   constraint 2).

**Exit.** Acceptance evidence (and the per-target coverage statement)
linked from LLP 0053; probe results recorded in LLP 0082's open questions
— **including the failure branch**: if the probe shows Instant does evict,
the LLP 0074 claim is withdrawn or narrowed and LLP 0082 §Permissions'
inference is corrected; claim text landed in LLP 0074 only in the success
branch.

### CC-4. Permission pushdown as a design requirement; auth paved-path design amendments (from LLP 0082)

**Kind.** Design amendment — this item revises
[LLP 0011](./0011-auth-and-permissions.rfc.md) only. It does not ship guest
auth; the amendment must scope the later implementation so it can be
docketed separately.

**Evidence.** InstantDB evaluates CEL permissions post-query on the live
path, flagged pushdown as needed in 2024, and had not verifiably shipped it
by mid-2026 (LLP 0082 §Permissions). Pushdown-compatibility is a property a
permission language gets by early design and cannot cheaply retrofit.

**Work.** Add to LLP 0011: (1) a named requirement —
**pushdown-compilability**: the permission language must remain compilable
into query plans — with the current evaluation strategy documented against
it. The requirement is scoped to row-visibility / sync-filter rules;
function-level authorization checks and LLP 0011's existing treatment of
opaque rules (a rule that defeats analysis makes its query non-syncable)
are untouched unless deliberately re-ratified, and the amendment must name
the behavior class for a rule that cannot be pushed down (reject,
online-only, or bounded post-filtering). Any future permission-language
implementation spec must cite this named requirement (that citation is the
checkable carry-forward). (2) Guest auth
with account claiming as a paved-path feature (Instant's best onboarding
idea), specified to the point where implementation is docketable — at
minimum deciding: guest principal stability and identity continuity across
claiming, proof of claim, existing-account collision and linking behavior,
concurrent or replayed claims, session rotation at claim time, audit
events, interaction with LLP 0053 invalidation, and failure atomicity.
(3) An
onboarding-ergonomics note keeping fail-closed defaults while making the
first rule trivial to write — default-allow is the one Instant choice
explicitly rejected, and the rejection is stated with its cost
acknowledged.

**Exit.** LLP 0011 revised with the three items, each as a dated amendment;
the pushdown requirement exists under a stable name that implementation
specs can cite. The S sizing covers the amendment text; item 2's checklist
acknowledges that guest-auth design depth is the bulk of it.

### CC-5. Streams comparison into bounded streamed actions (from LLP 0082)

**Evidence.** InstantDB Streams: storage-backed, offset-resumable,
single-writer channels for LLM token UX, rules default-closed (LLP 0082
§Ephemeral state) — a shipped external answer to the seam
[LLP 0076](./0076-bounded-streamed-actions.rfc.md) is designing.

**Work.** A comparison subsection in LLP 0076 positioning its design against
Instant's (resumability model, writer discipline, authorization defaults,
retention), adopting or explicitly rejecting each property. LLP 0076 is an
active Draft that has been through a multi-round review; the subsection
lands as a clearly additive, dated revision — no change to the contract
text that converged through review — and LLP 0076's own review cadence
decides whether the addition needs a focused re-review before acceptance.

**Exit.** LLP 0076 revised; divergences are named decisions.

### CC-6. Positioning batch (from LLP 0082, 0084, 0001)

**Work, all landing in [LLP 0074](./0074-convex-competitive-strategy.rfc.md)
or its successor competitive material, each claim carrying LLP 0074's
evidence-class label (matrix-observed / doc-confirmed / hypothesis) and,
for vendor facts, a checked date:**

- The competitive triangle: *Convex-grade functions, Instant-grade sync
  surface, physically isolated like neither — and MIT-licensed end to end:
  fully open like Instant (Apache-2.0), more permissively and more
  completely open than Convex's FSL source-available backend.* (The
  licensing distinction is load-bearing per LLP 0074 §Summary: Convex is
  self-hostable source-available, so the differentiator is license terms
  and completeness of what is open, not open-vs-closed.)
- The fragile-suppliers argument (LLP 0001 synthesis §8; Triplit's silent
  death as the terminal case): institutional durability as a stated,
  rational selection criterion.
- Two boundary markers promoted into competitive material alongside the
  SpacetimeDB marker — the SpacetimeDB and Nakama/Colyseus markers already
  recorded in LLP 0001's synthesis, the mesh marker recorded in LLP 0084
  (which places it alongside them; provenance corrected 2026-07-23): *not a
  mesh database* (Ditto's segment; LLP 0084) and *not a tick-rate game
  server* (Nakama/Colyseus; LLP 0001). CC-6's work is promotion, not
  creation.
- Benchmark-as-content: agents building the same app on Snapback across
  models, published as a series (Instant's self-refreshing format,
  LLP 0082) — plays to the acceptance-suite strength.

**Exit.** LLP 0074 (or successor competitive material) carries all four,
with evidence-class labels; publication follows governing constraint 2's
publication gate.

### CC-7. Record history and branching — exploration (from LLP 0085)

**Evidence.** Deep per-record history and branch/merge are the one thing
classic Jazz's users demonstrably loved that survived its rewrite (LLP 0085
§Jazz v2). Snapback has partial ingredients, in two distinct categories:
Snapback-owned machinery (LLP 0008's changesets and bounded change
journal) and provider-owned capability (DO PITR / bookmarkable versions,
which LLP 0083 records as a property of Cloudflare's SRS to preserve on
the wire — not an existing Snapback history API). No product surface
exists. This is the only *unabsorbed* demand signal the research surfaced
(guest-auth demand is absorbed by CC-4).

**Work.** An RFC-level exploration of whether to expose record history
and/or branching as API, scoped against LLP 0008's retention rule and
bounded change-log stance (unbounded history with no GC story is a named
Jazz failure mode, not a feature to import). The RFC must decompose the
product into separately-costed recommendations — history reads, retained
losing versions, branch creation, merge policy, GC/retention,
authorization, and **target portability** (what works from Snapback-owned
machinery everywhere vs. what leans on provider PITR) — rather than
treating "history and/or branching" as one product.

**Exit.** A new RFC exists with per-capability recommendations, or a
decision not to pursue is recorded as a dated amendment to LLP 0008 with
the demand evidence acknowledged. Either outcome states whether
[LLP 0007](./0007-storage-portability.spec.md)'s portable storage contract
changes — an explicit no-change conclusion counts, since LLP 0085 names
LLP 0007 as a co-owner of this evaluation.

### CC-8. Documentation absorption batch (from LLP 0082–0085)

**Work.** The research batch's remaining small absorptions, LLP 0079
SC-3-style: each is a one-paragraph dated revision to its owning LLP,
docs-only, landable independently. Sweep:

1. **Schema lockdown against rogue agents** (Instant's `attrs`
   create-rules) as a named safety feature of the schema surface →
   [LLP 0037](./0037-schema-source-of-truth.decision.md) and LLP 0024
   (coordinates with CC-1's surface spec, which must expose the lockdown
   toggle).
2. **Output-gate vocabulary** ("synchronous inside, gated at the
   boundary") for per-target durability claims, and
   **keep bookmarkable versions on the wire** (D1 Sessions API as copyable
   prior art) → [LLP 0007](./0007-storage-portability.spec.md) /
   [LLP 0008](./0008-local-first-sync-and-realtime.rfc.md).
3. **Treat platform alarms as lossy** (single alarm, six retries, silent
   drop; durable schedule table stays authoritative) →
   [LLP 0028](./0028-cron-scheduled-execution.rfc.md) / LLP 0070.
4. **Partyserver posture** — wrap, parallel, or ignore, recorded as a
   deliberate decision with its hibernation bounds noted →
   [LLP 0013](./0013-ephemeral-realtime-state.rfc.md).
5. **Epoch-scoped uniqueness / version-skew seam design** (no continuous
   global uniqueness, no same-version Worker↔DO assumption) →
   [LLP 0003](./0003-local-code-hosting-and-storage-core.rfc.md).
6. **Client-writable broadcast state without permissions** (the Agents SDK
   model) recorded as a named anti-pattern → LLP 0011.
7. **Triplit's compatibility-classified schema pushes** (client refuses
   connect on incompatible schema) compared against the schema evolution
   story → LLP 0037.
8. **Convergent permission language citation** (Triplit's claims-matched
   roles + per-operation filters, server-evaluated; plus Jazz's
   "authorization baked into data structures is hard to evolve" epitaph)
   as independent validation of LLP 0011's server-evaluated, revisable
   stance → LLP 0011.
9. **Ditto's read-time-derivation guidance** as the citable
   from-inside-the-camp source for keeping semantic merge out of the sync
   core → LLP 0008.
10. **Cite the retreats** — Jazz's 2026-04-18 trilogy and Electric's pivot
    post as primary-source evidence in rationale sections → LLP 0008 /
    LLP 0011 (CC-6 carries the competitive-material half).
11. **Cambria-style lens migrations** noted as prior art for
    schema-evolution across deployed clients → LLP 0037.
12. **Query-scoped cache vs declared sync contract** — record the ceremony
    budget: Snapback's stronger contract must not cost more ceremony than
    it buys → LLP 0008.
13. **Offline-boundary naming** — name the "works with no server, ever"
    segment Snapback deliberately does not serve, alongside the existing
    non-goal markers → [LLP 0000](./0000-snapback.explainer.md) (CC-6
    carries the competitive-material half).

**Row classes and discipline.** Rows divide into two classes with different
exits. *Citation/rationale absorptions* (rows 6, 8, 9, 10, 11, 12) add
evidence to rationale text and land directly as dated revisions.
*Decision-bearing amendments* (rows 1–5, 7, 13) touch normative text or
record a posture decision, several in Accepted documents (LLP 0013, 0028,
0037, 0003, 0007); these follow the owning document's dated-amendment
convention and its author-ratification path — "one paragraph" describes the
expected size, not an exemption from that path. Joint-owner rows name the
receiving document per assertion: row 2's vocabulary lands in LLP 0007 with
the wire-format half cross-referenced from LLP 0008; row 3's
schedule-table-stays-authoritative statement lands in LLP 0028 with LLP
0070 cross-referenced; row 10's retreat citations land in each named
rationale section. Row 1 is not independent: it sequences with CC-1, whose
surface spec carries the lockdown-toggle requirement.

**Exit.** Each row landed as a dated revision in its owning LLP (through
the owning ratification path for decision-bearing rows), or its row here
annotated with a dated, named no-action rationale. No row may be closed
silently.

## Evidence-disposition ledger

Every actionable pointer in LLP 0082–0085's "What to learn" sections (plus
the LLP 0001 synthesis items this plan uses), with its disposition. Rows
marked *covered* cite where the existing corpus already holds the point.

| Finding (source) | Disposition |
| --- | --- |
| Guest auth with account claiming (0082) | CC-4 |
| Durable resumable stream primitive (0082) | CC-5 |
| Remote MCP + platform API; `.md` docs; skills package (0082) | CC-1 |
| Schema lockdown against rogue agents (0082) | CC-8.1 |
| Benchmark-as-content (0082) | CC-6 |
| Default-deny vs default-allow as deliberate decision (0082) | CC-4 |
| Query-scoped-cache ceremony budget (0082) | CC-8.12 |
| Shared EAV substrate — avoid (0082) | Covered: standing refusal (below); LLP 0018 already per-app |
| Post-query-only permission filtering — avoid (0082) | CC-4 (pushdown requirement) |
| Unspecified revocation semantics — avoid (0082) | CC-3 |
| Facets / Dynamic Workflows evaluation (0083) | CC-2 (LLP 0087) / CC-2b |
| Output-gate vocabulary + bookmarkable versions (0083) | CC-8.2 |
| Platform alarms are lossy (0083) | CC-8.3 |
| Partyserver posture (0083) | CC-8.4 |
| Rivet as eventual second hosted target (0083) | Watch item |
| Epoch-scoped uniqueness / version skew (0083) | CC-8.5 |
| Chatty row-at-a-time writes vs 1000× write pricing (0083) | Landed: LLP 0014's 2026-07-23 refresh carries the cost-model note |
| Agents SDK client-writable broadcast anti-pattern (0083) | CC-8.6 |
| Mine Triplit's frozen corpus — eviction protocol (0084) | CC-3 |
| Triplit compatibility-classified schema pushes (0084) | CC-8.7 |
| Convergent permission language citation (0084) | CC-8.8 |
| Ditto read-time-derivation guidance (0084) | CC-8.9 |
| How Snapback talks about offline (0084) | CC-6 + CC-8.13 |
| Fragile-supplier durability argument (0084, 0001 §8) | CC-6 |
| Server-free authorization evaluation — avoid (0084) | Covered: LLP 0011's server-evaluated stance; validation cited via CC-8.8 |
| Cite the Jazz/Electric retreats (0085) | CC-8.10 (+ CC-6) |
| Row-history and branching evaluation (0085) | CC-7 |
| Compiled client-side policy bundle (0085) | Watch item |
| Cambria lens migrations (0085) | CC-8.11 |
| Optional E2EE as encrypted columns, if demand materializes (0085) | Watch item |
| Authorization baked into data structures — avoid (0085) | Covered: LLP 0011 revisability; epitaph cited via CC-8.8 |
| Unbounded history without GC — avoid (0085) | Covered: LLP 0008 retention rule; CC-7 scopes against it |
| Presence over a persistence primitive — avoid (0085) | Covered: LLP 0013's ephemeral lane is ratified |

## Sequencing

- **Now:** CC-2's residue (ENG-25387 closure; LLP 0087 Phase 0 step 1b) —
  the spike itself is already executing under LLP 0087; CC-4 item 1
  (pushdown requirement — hardest to retrofit); CC-8 (docs-only; rows
  independent except CC-8.1, which sequences with CC-1).
- **Next:** CC-4 items 2–3 (the guest-auth and onboarding amendments ride
  the same LLP 0011 revision cycle but are not time-sensitive the way
  item 1 is), CC-2b (bounded, day-scale), CC-3 (mostly verification and
  reading; claim publication gated), CC-5 (rides LLP 0076's active
  design).
- **Commitment-gated:** CC-1 and CC-7 wait for `llp-review` over their
  evidence documents (LLP 0082, 0085) per governing constraint 2. CC-1
  additionally coordinates its hosted half with LLP 0087 Phase 2.
- **Opportunistic:** CC-6 drafting can land with other LLP 0074 work;
  publication follows the publication gate.

## Standing refusals (re-affirmed, not new)

The research strengthened, and this plan does not reopen: no CRDTs outside
[LLP 0068](./0068-collaborative-document-convergence.rfc.md)'s document
profile; no E2EE as foundation (Evolu/classic-Jazz corner); no mesh or
serverless-peer operation (Ditto's segment); no shared multi-tenant data
substrate (Instant's EAV pathology). Each now has a citable prior-art
grounding in LLP 0082–0085 and LLP 0001.

## Watch items (no action now)

- Rivet as an eventual second hosted target (LLP 0083) — evaluate against a
  concrete trigger only.
- InstantDB "Bring Your Own Postgres" and server functions; the ~$11M
  Series A confirmation (LLP 0082).
- Jazz v2 leaving alpha; its compiled client-side policy bundle vs LLP 0053
  (LLP 0085).
- Hosted-privacy demand materializing → study E2EE-as-encrypted-columns on
  the server-authoritative base (Jazz v2's landing spot), not the Evolu
  corner (LLP 0085).
- Cloudflare DO relocation shipping (placement permanence, LLP 0083).
- TanStack DB's collection/live-query API shapes as the emerging client
  convention (LLP 0001 §TanStack DB).
- Triplit corpus adoption/fork activity (LLP 0084).

## Open questions

1. Does CC-1 ship as remote MCP first, platform HTTP API first, or both
   behind one surface spec? (Decided in CC-1's surface spec before
   implementation; the options are constrained by LLP 0024's authority
   matrix.)
2. Who owns the CC-2/LLP 0087 Phase 0 spike's remaining legs, and what is
   the isolation-review time box? (It touches LLP 0009 security review
   capacity, not just Cloudflare work.)
3. Should CC-7's exploration be scoped to history-read-only first (cheap,
   portable from LLP 0008's own machinery) with branching deferred? The
   decomposition requirement in CC-7 makes this answerable inside the RFC.
4. Where does the CC-1 provisioning contract live — an extended LLP 0024 or
   a new document? (LLP 0087 Phase 2 consumes the answer.)

## Execution note (2026-07-23)

By the author's direction, execution of this plan started 2026-07-23,
tracked as filesystem tickets under `issues/20260723-0086-*` (marker
`llp-0086-execution`). Two items started ahead of their evidence-review
commitment gates — CC-1's spec half (LLP 0089) and CC-7's exploration RFC
(LLP 0088) — as recorded author decisions; their acceptance still waits on
the gates, which are unchanged, as are all publication gates. Findings of
record from execution: the dated GA determination in LLP 0014 keeps the
beta prohibition binding (explicit changelog statements still say open
beta as of 2026-07-23); the Triplit design read (LLP 0084) confirmed
convergence on server-recomputation and mandatory resnapshot while finding
LLP 0053 strictly stronger on delivery obligations, lease-bounded offline
clients, and retain/quarantine semantics; ENG-25387 was already closed.
CC-3's InstantDB probe ran later the same day once credentials arrived
(preregistration committed first): data-dependent revocation evicts live
(~32 ms server push), rule revocation produces no live traffic and is
filtered only on reconnect — so the preregistered decision rule fired and
the LLP 0074 claim was **narrowed**, not unblocked as stated; LLP 0082
§Permissions carries the correction and
`tests/probes/instant-eviction-20260723/` the receipts.

## Status

Draft. Written 2026-07-23 to convert the LLP 0082–0085 research (plus the
LLP 0001 survey batch) into an actionable program without changing any
ratified decision. Two multi-family review rounds same day (artifacts under
`llp/reviews/`): round 1 Fable NOT READY / Codex NOT READY, revised; round
2 Fable READY / Codex NOT READY, followed by the v0.2 post-READY editorial
pass absorbing both reviewers' remaining concerns (applied unreviewed).
Items become real work through the normal LLP 0032-style docket path; this
plan should be revised as items land, are rejected, or as the review-gated
evidence documents pass or fail review.
