# LLP 0086: Course corrections from the 2026-07 prior-art passes

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Deployment, Auth, Sync, Realtime, Storage, Competitive analysis
**Author:** Charlie Cheever / Claude
**Date:** 2026-07-23
**Related:** LLP 0001, LLP 0009, LLP 0010, LLP 0011, LLP 0013, LLP 0014, LLP 0018, LLP 0022, LLP 0024, LLP 0033, LLP 0037, LLP 0040, LLP 0053, LLP 0068, LLP 0070, LLP 0074, LLP 0076, LLP 0082, LLP 0083, LLP 0084, LLP 0085, ENG-25387

## Summary

The 2026-07-23 research batch — [LLP 0082](./0082-instantdb.research.md)
(InstantDB), [LLP 0083](./0083-cloudflare-do-d1-prior-art.research.md)
(Cloudflare DO/D1 + Rivet), [LLP 0084](./0084-triplit-ditto.research.md)
(Triplit/Ditto), [LLP 0085](./0085-jazz.research.md) (Jazz), and the LLP 0001
survey extension — validated Snapback's load-bearing bets (server-authoritative
LWW, the ephemeral lane, DO-per-app isolation, MIT) and surfaced a bounded set
of changes worth making. This plan turns those findings into work items with
owners, evidence, and exit criteria, in the same shape
[LLP 0079](./0079-serverpod-course-corrections.plan.md) used for the Serverpod
research.

Two constraints govern everything below. First, no item changes a ratified
decision; items either add capabilities, refresh stale facts, or record a
deliberate evaluation with a decision gate. Second, the evidence base (LLP
0082–0085) is Draft and unreviewed; the items marked review-gated should not
be committed to until their evidence documents pass `llp-review`.

## Status board

| Item | Title | Owner LLP(s) | State |
| --- | --- | --- | --- |
| CC-1 | Agent provisioning surface (remote MCP + platform API) | 0010, 0024 | Proposed (review-gated) |
| CC-2 | Facets/Dynamic Workers evaluation spike + LLP 0014 refresh | 0014, 0018, 0009, 0070 | Elaborated as LLP 0087 |
| CC-3 | Revocation-eviction as a proven differentiator | 0053, 0074 | Proposed |
| CC-4 | Permission pushdown as a design requirement; auth paved-path adoptions | 0011 | Proposed |
| CC-5 | Streams comparison into bounded streamed actions | 0076 | Proposed |
| CC-6 | Positioning batch | 0074 | Proposed |
| CC-7 | Record history/branching exploration | new RFC | Proposed (review-gated) |

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
a remote MCP surface (and/or platform API) whose tools cover create-app,
push-schema, push-permissions, and read-capability-manifest, honoring
[LLP 0024](./0024-agent-operating-surface.spec.md)'s operating-surface
contract and [LLP 0010](./0010-agent-dx-and-acceptance.spec.md)'s acceptance
bar. Include the smaller absorptions that ride along: docs served as
`.md`-suffixed URLs and a skills package.

**Exit.** An agent with only credentials and the MCP endpoint can provision
a working app end-to-end, demonstrated by an acceptance gate; LLP 0010/0024
revised to specify the surface.

### CC-2. Durable Object Facets / Dynamic Workers — evaluation spike and LLP 0014 refresh (from LLP 0083)

**Evidence.** Cloudflare shipped Worker Loader (runtime code loading, open
beta for paid accounts 2026-03-24) and DO Facets (beta, 2026-04): a
supervisor DO can load tenant-supplied code at runtime as child facets, each
with its own isolated SQLite database; Dynamic Workflows (2026-05) extends
the pattern to durable execution (LLP 0083 §Dynamic Workers). Two LLP 0014
platform facts are stale as a result (tracked as ENG-25387).

**Why this is urgent-shaped.** Snapback's current hosted model
([LLP 0040](./0040-cloudflare-narrow-proof.rfc.md); `cloudflare/`) compiles
the app bundle into the deployed Workers at deploy time (esbuild alias
`snapback-app` → `app/<name>.app.js`) across three per-app Worker services
(gateway, handler isolate, action handler), so **app creation and code
update on Cloudflare are wrangler deploy cycles, not data operations** —
unlike the local target, where apps are data the host loads. Facets are the
platform-native version of the data-operation model: one deployed Snapback
platform, per-app code loaded at runtime into a per-app facet with isolated
SQLite. If the isolation and economics hold, this collapses the hosted
control plane and closes the local/hosted authoring asymmetry; if Snapback
ignores it, the same primitive lowers the barrier for anyone else to build
per-tenant backend hosting.

**Work.**
1. Land the ENG-25387 LLP 0014 revision (stale facts + the write/read price
   asymmetry in the cost model) — no evaluation needed, just truth.
2. A time-boxed spike: run an existing proof app (notes or All Aboard) as a
   facet child under a supervisor DO, behind the existing local/remote
   acceptance suites. The spike must answer, with measurements:
   - **Isolation** ([LLP 0009](./0009-code-execution-security.rfc.md)
     review): what a facet actually isolates (isolate boundary, bindings
     envelope, outbound-fetch control), and whether the current deliberate
     gateway/handler/action-handler service split — slow action fetches
     must not block the coordinator — can be reproduced inside the facet
     model or must remain separate services.
   - **Storage semantics per facet:** SQLite limits, PITR, alarms,
     hibernation behavior.
   - **Economics:** cold start added by runtime loading; how facet duration
     and storage are billed (unknown in the research pass — must be
     measured/asked, not assumed).
   - **Lifecycle:** facet class versioning and migration semantics,
     including interaction with the `exports`-based DO migration model and
     its no-gradual-deploy constraint.
   - **Beta risk:** what breaks, what is undocumented, GA signals.
3. Separately assess Dynamic Workflows as the
   [LLP 0070](./0070-durable-background-work.rfc.md) hosted profile
   candidate — same conformance suite, different substrate.

**Elaboration.** This item is now expanded into a full staged adoption plan,
[LLP 0087](./0087-facets-hosted-adoption.plan.md); the spike below is its
Phase 0 and the decision gate below is its Gate 0.

**Decision gate.** After the spike, LLP 0014 records one of: adopt facets
for the next hosted profile; keep the hand-built per-app deploy; or hybrid
(facets for app code, retained service split for actions). No hosted
rearchitecture starts while facets are beta — the spike buys information,
not commitment. Lock-in accounting (Worker Loader is proprietary; `workerd`
parity unknown) goes into the decision alongside
[LLP 0033](./0033-license-posture.decision.md)'s openness stance and the
Rivet optionality noted in LLP 0083.

**Exit.** ENG-25387 closed; spike findings and the gate decision recorded in
LLP 0014; LLP 0070 hosted-profile note updated.

### CC-3. Revocation-eviction as a proven differentiator (from LLP 0082, 0084)

**Evidence.** Snapback has a ratified authorization-invalidation contract
([LLP 0053](./0053-authorization-invalidation.rfc.md)); InstantDB is
publicly silent on revocation eviction (LLP 0082 §Permissions); the one peer
that shipped a comparable protocol — Triplit — is dead, with its design
readable in a frozen repo (LLP 0084 §Triplit).

**Work.** (1) Confirm LLP 0053's contract is implemented and
acceptance-tested on the current targets (it is a differentiator only while
provably true). (2) A design read of Triplit's server-driven eviction
protocol against LLP 0053 — read for design, not reuse (AGPL). (3) An
empirical probe app on InstantDB answering whether permission revocation
evicts already-synced rows, so competitive claims rest on observation, not
their docs' silence. (4) The resulting one-paragraph claim goes to LLP 0074.

**Exit.** Acceptance evidence linked from LLP 0053; probe results recorded
in LLP 0082's open questions; claim text in LLP 0074.

### CC-4. Permission pushdown as a design requirement; auth paved-path adoptions (from LLP 0082)

**Evidence.** InstantDB evaluates CEL permissions post-query on the live
path, flagged pushdown as needed in 2024, and had not verifiably shipped it
by mid-2026 (LLP 0082 §Permissions). Pushdown-compatibility is a property a
permission language gets by early design and cannot cheaply retrofit.

**Work.** Add to [LLP 0011](./0011-auth-and-permissions.rfc.md): (1) a named
requirement that the permission language remain compilable into query plans
(pushdown), with the current evaluation strategy documented against it;
(2) guest auth with account claiming as a paved-path feature (Instant's best
onboarding idea); (3) an onboarding-ergonomics note keeping fail-closed
defaults while making the first rule trivial to write — default-allow is the
one Instant choice explicitly rejected, and the rejection should be stated
with its cost acknowledged.

**Exit.** LLP 0011 revised with the three items; pushdown requirement
carried into any permission-language implementation spec.

### CC-5. Streams comparison into bounded streamed actions (from LLP 0082)

**Evidence.** InstantDB Streams: storage-backed, offset-resumable,
single-writer channels for LLM token UX, rules default-closed (LLP 0082
§Ephemeral state) — a shipped external answer to the seam
[LLP 0076](./0076-bounded-streamed-actions.rfc.md) is designing.

**Work.** A comparison subsection in LLP 0076 positioning its design against
Instant's (resumability model, writer discipline, authorization defaults,
retention), adopting or explicitly rejecting each property.

**Exit.** LLP 0076 revised; divergences are named decisions.

### CC-6. Positioning batch (from LLP 0082, 0084, 0001)

**Work, all landing in [LLP 0074](./0074-convex-competitive-strategy.rfc.md)
or its successors:**
- The competitive triangle: *Convex-grade functions, Instant-grade sync
  surface, open like both, physically isolated like neither.*
- The fragile-suppliers argument (LLP 0001 synthesis §8; Triplit's silent
  death as the terminal case): institutional durability as a stated,
  rational selection criterion.
- Two boundary markers alongside the existing SpacetimeDB one: *not a mesh
  database* (Ditto's segment; LLP 0084) and *not a tick-rate game server*
  (Nakama/Colyseus; LLP 0001).
- Benchmark-as-content: agents building the same app on Snapback across
  models, published as a series (Instant's self-refreshing format,
  LLP 0082) — plays to the acceptance-suite strength.

**Exit.** LLP 0074 (or successor competitive material) carries all four.

### CC-7. Record history and branching — exploration (from LLP 0085)

**Evidence.** Deep per-record history and branch/merge are the one thing
classic Jazz's users demonstrably loved that survived its rewrite (LLP 0085
§Jazz v2); Snapback has partial ingredients (LLP 0008 changesets,
bookmarkable versions per LLP 0083's SRS/PITR reading) but no product
surface. This is the only place the research surfaced *demand* Snapback does
not address.

**Work.** An RFC-level exploration: whether to expose record history and/or
branching as API, scoped against LLP 0008's retention rule and bounded
change-log stance (unbounded history with no GC story is a named Jazz
failure mode, not a feature to import).

**Exit.** A new RFC exists with a recommendation, or a recorded decision not
to pursue with the demand evidence acknowledged.

## Sequencing

- **Now:** CC-2 step 1 (ENG-25387 fact refresh — pure truth maintenance) and
  CC-4 item 1 (pushdown requirement — hardest to retrofit). These are the
  time-sensitive pair.
- **Next:** CC-2's spike (information-buying, beta-gated), CC-3 (cheap,
  mostly verification and reading), CC-5 (rides LLP 0076's active design).
- **Review-gated:** CC-1 and CC-7 are the largest commitments and should
  wait for `llp-review` over their evidence documents (LLP 0082, 0085);
  CC-6 can land opportunistically with other LLP 0074 work.

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
- Cloudflare DO relocation shipping (placement permanence, LLP 0083).
- TanStack DB's collection/live-query API shapes as the emerging client
  convention (LLP 0001 §TanStack DB).
- Triplit corpus adoption/fork activity (LLP 0084).

## Open questions

1. Does CC-1 ship as remote MCP first, platform HTTP API first, or both
   behind one surface spec?
2. Who owns the CC-2 spike, and what is its time box? (It touches LLP 0009
   security review capacity, not just Cloudflare work.)
3. Should CC-7's exploration be scoped to history-read-only first (cheap,
   PITR-adjacent) with branching deferred?

## Status

Draft. Written 2026-07-23 to convert the LLP 0082–0085 research (plus the
LLP 0001 survey batch) into an actionable program without changing any
ratified decision. Items become real work through the normal LLP 0032-style
docket path; this plan should be revised as items land, are rejected, or as
the review-gated evidence documents pass or fail review.
