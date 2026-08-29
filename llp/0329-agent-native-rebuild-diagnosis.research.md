# LLP 0329: Agent-native rebuild diagnosis

**Type:** Research
**Status:** Draft
**Systems:** Authoring surface, Code generation, Client, Sync, Authorization,
Developer experience, Agent experience, Guide, Packaging
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-28
**Related:** LLP 0000, LLP 0080, LLP 0110, LLP 0120, LLP 0129, LLP 0138,
LLP 0145, LLP 0155, LLP 0189, LLP 0201, LLP 0225, LLP 0252, LLP 0259,
LLP 0310, LLP 0314, LLP 0317, LLP 0318, LLP 0319, LLP 0320, LLP 0322,
LLP 0323, LLP 0329.000, LLP 0329.004, LLP 0329.012, LLP 0329.013,
LLP 0329.014, LLP 0329.016,
`benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md`,
`guide/sync/offline-and-retention.md`, `guide/eval-runs/2026-08-21/`,
Diary 0114

## Summary

This document answers a founder question asked on 2026-08-28: *Snapback is decent
but not great. If we started over from scratch on an agent-native scale-to-zero
backend, what would be the same, what would be different, and what matters most?*

It is a diagnosis, not a proposal. It authorizes no subsystem, no deletion, and no
status transition. The design responses it prompted are recorded separately in
[LLP 0329.000](./0329.000-three-family-design-sketches.research.md); the constraint
that most complicates them is [LLP 0329.004](./0329.004-composition-expressiveness-constraint.research.md).

The central claim:

> **Capability is a function of authoring form, and the mapping is invisible at the
> authoring site.**

Retention, live delivery, and offline replay are properties an author obtains by
choosing a spelling, and the consequence of that choice appears far from where it
was made. The vocabulary sprawl, the declared-fact ceremony, the client's size, and
the one reproduced security failure are all downstream of that single property.

## Evidence

### The scoreboard

`benchmarks/runs/2026-08-27-clique-published-0129-matrix/record.md` (4 models × 5
backends, milestones M1–M8, web-only, published 0.1.29) is the honest competitive
record. M7 ran in no lane, so 7/8 was the practical ceiling.

| Backend | Best lane | Independent deep runs | Self-rated holistic |
|---|---|---|---|
| convex | 7/8 (sol and grok) | 2 | 74–79 |
| supabase | 7/8 (sol) | 1 | 44–74 |
| pocketbase | 7/8 (sol) | 1 | 61–74 |
| snapback-explicit | 7/8 (sol) | 1 | 61 |
| snapback-familiar | 2/8 | 0 | 44–54 |

Snapback reaches the same ceiling. The `sol-snapback-explicit` lane sealed 7/8 at
2026-08-28T04:35Z after 8 h 46 m, with M8 green at 4 h 24 m of continuous milestone
wall. Read the placement honestly in both directions: the record's §6 names a
broken O5 scale-log fixture and a shared-`storagePartition` harness artifact that
depressed Snapback lanes, and the §6 realtime discount is itself marked
**provisional** pending LLP 0317 O14's real-browser arm. What survives those
caveats is not a capability verdict but a *cost* one — and the agents' own holistic
self-ratings, which rank Snapback below convex, supabase, and pocketbase.

LLP 0317 states the gap precisely: the lanes "exposed the difference between
*eventual completion* and a one-shot paved authoring loop." It inventories the
distinct correction causes across all eight Snapback lanes and clusters them into
six priority bundles.

Diary 0114 supplies the two readings that matter more than the scores:

- **The friction that costs milestones is behavioral, not syntactic.** Familiar
  removed authoring syntax friction and still finished worse; the losses were
  realtime custody, dev-loop stability, and media limits.
- **"PocketBase repeatedly topped the greens… the model spent its effort on product
  code, not backend wiring."**

### The mechanism

`guide/sync/offline-and-retention.md` states that a live query cold-retains on the
JS arm only when **all** hold: it is a declarative `defineLiveQuery` over one table
(`defineJsLiveQuery` handlers are "never eligible — an opaque handler cannot carry
the closed-inputs proof"); it declares `auth: 'public'`; and its plan reads no
membership, `authUserId()`, time, or randomness inputs.

So offline support requires a query to be public, single-table, declarative, and
time-independent. The canonical local-first application — a private conversation —
falls outside the default path and needs the separate `retainable: true` +
`AuthorizedLease` mechanism. The guide names two dead ends "the maze invites."

Four consequences follow, each independently attested:

1. **Vocabulary sprawl.** `packages/snapback-codegen/define.mjs` exports 140 names,
   of which 31 are `define*` constructors and 13 are query flavors
   (LLP 0319 §1). `guide/reference/published-symbols.json` tracks 4,248 published
   symbol identities and `registry.json` 1,461 symbols across 56 modules at 5.16 MB
   (LLP 0323 §1). Measured 2026-08-28: 3,934 distinct `SNAPBACK_*` codes appear in
   `crates/` and `packages/`.
2. **Declared facts.** `reads:`, `writes:`, `retainable`, `authorityIndependent`
   are properties a compiler could derive from a closed plan. They are authored
   because the handler alternative is opaque.
3. **A reproduced security failure.** LLP 0310 P18: a lane set conversations,
   members, and messages to `public-read` and recorded in its own diary that this
   was "not a production ACL." Under LLP 0310's pit-of-success standard that row
   was re-dispositioned from out-of-bar to snapback-defect. `auth: 'public'` is the
   predicate that unlocks retention, so the system rewarded the insecure choice.
   **The offline design and the security failure are the same defect.**
4. **It resists late repair.** LLP 0320 proposed lifting JS handlers into the plan
   IR and was withdrawn: HostPlan mutations are unconditional sequences against a
   client-supplied baseline while JS handlers validate across a read-to-commit
   window, so "translation can change race outcomes," and functions that fail to
   lift "lose capability rather than just performance."

### The 2026-08-27 convergence attempt

Four simplification RFCs — [0318](./0318-one-authoring-profile.rfc.md) (one
authoring profile), [0319](./0319-one-query-constructor.rfc.md) (one query
constructor), [0320](./0320-plan-ir-as-compiler-output.rfc.md) (plan IR as compiler
output), [0323](./0323-tiered-public-surface.rfc.md) (a tiered public surface) —
were all **Withdrawn** after round 1 of `llp-super-refine`, each because review
found its premise false rather than its direction wrong.

This is the process working as designed, and it is also the finding: the corpus can
detect that it has sprawled and cannot converge from where it stands. A from-scratch
design gets to make these choices once, at the substrate, instead of retrofitting
them onto a surface that has already grown two profiles and thirteen query flavors
around the older shape.

### Where complexity actually accumulated

Measured on `main` at `3e9320c0f`, 2026-08-28.

Rust: 16 crates, ~742k lines. `snapback-kernel` 226k, `snapback-engine` 125k,
`snapback-server` 110k — the top three are 62%.

JS: 20 packages, ~537k lines. `snapback-client` 120k, `snapback-codegen` 90k,
`snapback-cli` 77k, `snapback-contract` 42k, `snapback-react` 30k,
`snapback-expo` 12k.

**The client is the complexity sink, not the server.** `snapback-client` plus the
seven client-arm packages (contract, react, expo, vite, admin-client,
expo-custody, expo-dev-identity — ~92k combined) is roughly 212k lines, the same
order as the entire kernel. Under DK-9 the client store is "a result cache + cursor/
epoch state + outbox, never a relational replica"
([LLP 0008](./0008-local-first-sync-and-realtime.rfc.md) §Decision DK-9). A
212k-line client is not that. Retention classes, authorized leases, custody, and
completeness witnesses are client-side machinery implementing a capability matrix
with holes — so the bifurcation sprawls the implementation, not only the API names.

Churn across 6,725 commits since 2026-06-25:

- `guide/reference` is the highest-churn path by roughly 5×: 19,938 file-touches.
  It is generated. 1,645 tracked generated files (`snapback/generated/`,
  `guide/reference/`, `schemas/`) are 8.2% of tracked bytes but dominate churn.
- 1,496 `fix` commits (22%). Excluding generated collateral the top product hotspot
  is `packages/snapback-client` at 746 fix-touches — matching LLP 0317's ranking of
  authority and reactive causality as the costliest debugging cluster.
- Commit mix: `docs` 1,645 > `fix` 1,473 > `feat` 671.
- 185 scripts, 49 of them checks or gates.

### Retrieval cost

The 2026-08-21 runs under `guide/eval-runs/` are all PASSes, and the passing agents
reached the correct page in 7, 11, and 12 tool calls of a 15-call budget — before
doing any work. One spent five calls recovering from an uninstalled `snapback
guide` command. `scripts/check-retrieval-eval.mjs` covered 73 cases as of the
2026-08-21 record, under a standing rule (LLP 0061 §5, LLP 0186 W2) that every
replicated discoverability miss must add a seed case that would have caught it.

Two of those seeds are the diagnosis in miniature. Case 4 fails a plan that
"hand-writes the join in `defineJsLiveQuery`" — a case that exists to stop agents
falling into the capability-losing form. Case 10 fails a plan that "claims
`authScopeField` alone enforces the filter" instead of restating the `authUserId()`
predicate. Both are documentation compensating for a surface that made the wrong
thing natural.

### Distribution weight

LLP 0314 measures the shipped Darwin 0.1.27 runtime at ~187 MB unpacked / ~52 MB
tarball, Linux at ~248 MB / ~70 MB, carrying 241k symbols and ~20 MB of embedded
guide with no fat LTO. Install weight is the first moment a user experiences
"scale to zero," and the measured idle profile it should be advertising — zero disk
writes, no measurable CPU over 120 s, ~13 MiB resident
([LLP 0035](./0035-local-target-benchmarks.research.md) §Idle cost) — is genuinely
excellent and structurally unrelated.

## Findings

**F1 — capability-by-authoring-form is the root defect.** Confidence: high. Four
independent attestations (the eligibility rules as written, LLP 0320's withdrawal,
LLP 0310 P18, the 13-flavor inventory), and three model families independently
reached the same conclusion in LLP 0329.000.

**F2 — the offline design and the P18 security failure are one defect.** Confidence:
high. `auth: 'public'` is simultaneously a visibility declaration and a retention
predicate. An agent that widens visibility to obtain a capability is behaving
rationally.

**F3 — the client is where the defect is paid for.** Confidence: high on the
measurement, medium-high on the attribution. ~212k lines of client and 746
client fix-touches; the attribution to the capability matrix rests on what that
code implements (retention classes, leases, custody, witnesses) rather than on a
controlled comparison.

**F4 — the corpus already identified the direction and could not land it.**
Confidence: high. LLP 0155 states "copy Zero's outcomes, not its architecture" and
its move 1 is bounded-plan-node composition as the primary read surface; the
2026-08-27 batch shows convergence failing as a retrofit. This is a sequencing
problem, not a missing insight.

**F5 — surface size is a measured tax on the agent author, not an aesthetic
concern.** Confidence: medium-high. 7–12 of 15 tool calls to retrieval, and an eval
corpus that must grow monotonically with the surface. The inference that a
monotonically growing eval indicates excess vocabulary is [inferred], not measured.

**F6 — what is loved should survive.** Confidence: high. Diagnostic precision is
praised repeatedly across diaries ("the platform told me exactly what was wrong
every time", Diary 0114); the diaries defend ceremony that "caught real category
errors"; the measured idle profile and the benchmark/diary loop are assets. The
problem with diagnostics is cardinality, not quality.

## Non-claims

- This does not claim a 0.1.29 capability ceiling. The record's §6 fairness caveats
  and LLP 0317's provisional O14 status stand.
- This does not claim the familiar profile is worse or better than explicit. LLP 0252
  D7's four-lane matrix at preregistered N≥3 is the standard, and it has not run.
- This does not authorize deleting any subsystem named above.
- The correction-loop and time-to-green figures are single-run observations under
  LLP 0201 D5 calibration rules, not magnitude claims.

## Open questions

1. Can an analyzable read language be made expressive enough to be the *only*
   language? This is prior to every design in LLP 0329.000 and is the subject of
   [LLP 0329.004](./0329.004-composition-expressiveness-constraint.research.md).
   [LLP 0329.012](./0329.012-bound-carrying-algebra-as-the-only-language.research.md)
   argues yes, if the restriction is computational class rather than operator
   poverty, and proposes a bound-carrying algebra; it is research, not a
   ratification.
   [LLP 0329.013](./0329.013-one-read-language-proposals.research.md),
   written blind to it in the same hour, independently answers yes on the
   same diagnosis, decomposes which capability actually forces restriction
   (only local prediction), maps the complete Clique census to a general
   closed algebra, and records the two documents' four disagreements.
   [LLP 0329.014](./0329.014-bounded-data-programs-panel-synthesis.research.md)
   records a three-family, three-round discussion that converged on bounded
   data programs — real control flow between typed bounded reads, a static
   certificate as the gate, the execution trace as the closure — and relates
   all three to the measured 0329.005–0329.011 series.
2. Is row-rule authorization affordable when pushed into query plans? All three
   sketches depend on it; none has evidence.
3. Does the authoritative request and transaction path need an embedded JS engine
   at all?
4. What is the offline revocation contract, stated once rather than accumulated?
