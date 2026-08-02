# LLP 0147 super-refine journal

## Authorization

Charlie Cheever directed the loop on 2026-08-01: "Do an /llp-super-refine on
0147." The target is the successor RFC that LLP 0145 §D-D commissioned, authored
earlier the same day and untracked in the working tree at loop start.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as much
> as, not the same as, "there are no flaws in this."

The target is a Draft RFC, so it may leave decisions open — but every open item
must be named as open rather than smuggled past the reader as settled, and every
factual claim about the codebase or the corpus must be true.

Loop mechanics as in the 0116–0146 journals: dual-family rounds (fresh
non-author Fable subagent contexts; Codex via codex-cli `codex exec`, read-only
sandbox), mutually blind on 0147 artifacts, SHA-pinned targets and instruction
capsules, verify-then-fix passes between rounds, delta-scoped later rounds in
which each family sees only its own prior artifact. The loop cannot advance the
target beyond Draft; adjudication is the author's.

**Author self-verification** runs alongside each round: reviewer findings are
checked against the tree before they are applied, and the author's own
pre-verification pass runs concurrently with the reviews.

## Round 1 — 2026-08-01

Instruction capsule SHA-256 (shared by both families):
`d05c9bca226b508106b9571aac0c9e2e813b4cc5355a6fe59a1508296ae1cf8d`

Target SHA-256 (v0.1, 828 lines):
`2156eca984980d2614d2ba2796fb25e2f4f87498bb6f72edae276ba312b5726a`

Repo revision at review start: `main` `67628399`; the target and its siblings
untracked.

**Blindness note.** Both families were instructed not to read `llp/reviews/`
artifacts concerning LLP 0147. The Codex transcript (18,912 lines) was searched
afterwards: the only occurrence of that path is the reviewer's own statement of
intent to exclude it (line 176). Blindness held. The Fable subagent recorded the
same exclusion in its artifact.

### Round 1 results

**Both families NOT READY.** Codex returned two BLOCKING, two MATERIAL, and two
DETAIL; Fable returned eight findings, two MATERIAL and six DETAIL, and
explicitly recorded "no BLOCKING findings."

**Convergent findings.** Independently and blind, both families found:

- **The settled-mutation replay defect** (Codex BLOCKING-1, Fable F1). The
  shipped mutation route consults the client-mutation settlement cache
  *before* selecting a function, and on a hit re-releases the committed output
  and records a receipt with no generation comparison at all
  (`src/local.rs:10933-10981`; `validate_expected_generation` is reached only on
  a cache miss at `:10984`). v0.1's D4 asserted the comparison happens "before
  … acknowledgement, receipt creation, or mutation effects" without
  qualification, and gate 12 inherited the overstatement as an ambiguous
  fixture expectation. The author pass found this independently.
- **The retry-class authority gap** (Codex MATERIAL-2, Fable F4). The
  `idempotent` class required "a declared idempotency mechanism" that no
  document defined and no artifact carried.
- **The missing target-capability generation-failure family** (Codex
  MATERIAL-1, Fable F6). D3's fail-closed guard against a target lacking the
  argument/result contract capabilities had no entry in the failure list and so
  no negative fixture, since gate 7 tests exactly the listed families.
- **The envelope-floor gate gap** (Codex DETAIL-2, Fable F8) and the Related
  header omissions (Codex suggestion, Fable F7; also found by the author pass).

**The material divergence, and the reason the loop was worth running.**

**Codex found BLOCKING-2, which Fable's strengths section had passed over.**
`try_live_delta_fanout` copies committed storage rows straight into the wire
frame — `row: op.row.clone()` (`src/local.rs:19551-19562`), serialized at
`:19594` — with no `validate_handler_result` anywhere in `:19497-19684`, while
the full re-run path validates at `:23055-23060`. Fable's review had inspected
the egress seam and concluded "the D3 boundary table is true for the arms Micro
targets," citing the snapshot, mutation, and action paths — all correct, and all
of them the paths that *do* validate.

This matters more than an ordinary miss, because D3 is the document's central
decision and its entire content is *ship no client-side validator, because every
client-bound payload crosses an authoritative server seam*. A hole in that seam
is not a defense-in-depth miss for Micro; it is a correctness bug.

The reachability argument holds: `effectiveResultContract` returns an authored
contract before it ever consults the HostPlan default
(`packages/snapback-codegen/result-contracts.mjs:594-596`), so a live query with
a `records` contract narrower than its table gets a validated snapshot and then
a delta carrying a row the contract excludes. And it is a **shipped violation of
LLP 0108**, which requires that "query and live-query output is validated before
snapshot/live publication, cache insertion, or transport serialization"
(`llp/0108:440-443`) — not merely an RFC overreach. Filed as
`issues/20260801-live-delta-frames-bypass-result-contract-validation.md`.

**Fable found F2, which Codex did not:** `SNAPBACK_CAPABILITY_UNAVAILABLE`, which
v0.1 described as "reserved for genuinely dynamic target mismatches," does not
exist anywhere in the codebase. Repo-wide it occurs in exactly two files — LLP
0145 line 1757, where the slip originates, and LLP 0147. The registered code is
`SNAPBACK_CAPABILITY_UNSUPPORTED` (`src/local.rs:3593, 3603, 4112, 4623`). The
document had a rule against exactly this three hundred lines earlier: "this RFC
does not mint names without the code-table owner."

### Orchestrator correction to a reviewer's framing

Codex framed BLOCKING-1 as a live conflict between two authorities requiring
adjudication — "amend LLP 0108/0043 and prove old clients can still acknowledge
and garbage-collect settlements" — citing LLP 0108's `ExpectedOperationV1`
retained-settlement passage (`llp/0108:449-469`).

That passage is **exactly the slice LLP 0108 §B removed.** Its §"Final author
reconciliation after round 3" is declared normative and superseding, and it says
`ExpectedOperationV1` and tuple carriage through replay "are removed from this
implementation slice," and that "existing mutation settlement identity, lookup
order, acknowledgement, retention, replay, and garbage collection remain exactly
as governed by LLP 0043" (`llp/0108:700-712`). Neither `ExpectedOperationV1` nor
`SNAPBACK_MUTATION_RESULT_CONTRACT_STALE` has any implementation in the tree.

So there is no conflict to adjudicate. LLP 0043 already governs settlement
recovery; D4 governs fresh admission; the RFC's job was to say so. The
resolution is materially narrower than the one proposed, and no companion
amendment is needed.

> **Correction, round 2.** The paragraph above is wrong, and v0.2 carried the
> error into D4. LLP 0108 §B removes only the *0108* half of the conflict. LLP
> 0012 §Call-time generation binding independently states the same unconditional
> ordering (`llp/0012:881-884`) and disagrees with both LLP 0043 and the shipped
> code. Codex's round-1 instinct that an amendment was needed was right; only its
> choice of which document to amend was wrong. Round 2 charged this as BLOCKING
> and v0.3 commissions the dated LLP 0012 clarification. Left standing here as
> the record of an orchestrator over-correction, which is the failure mode this
> loop kept finding.

### Round-1 dispositions

All findings from both families applied in **v0.2** (970 lines, +17.1%, inside
the ~20% growth budget). Substantively:

- D4 gained the settled-replay carve-out with the LLP 0108 §B / LLP 0043
  authority argument, and the decision that **Micro v1 mutations carry no
  `clientMutationId`** — which answers Fable's F4 open question in the body
  rather than leaving it open, and retires the `idempotent` retry class rather
  than inventing a declaration source for it. Gate 12 rescoped to fresh
  admissions, with the replay interleaving named as the re-scoping a later
  settlement-adopting composition must do.
- D3's third boundary renamed **client-publication egress** (Codex's
  suggestion, adopted: an application value can reach a subscriber without ever
  being a handler return value), its universality claim replaced with what the
  code actually does, and closing the delta gap made a precondition of D3 rather
  than a follow-on. Gate 11a records the gate as currently **red**; gate 11b
  requires enumerating every client-bound publication path so the next hole is
  found by enumeration rather than by a reviewer; Phase B sequences the
  server-side fix.
- Gate 7a added for the target contract-capability refusal; 15a added for the
  adversarial envelope floor; the graduation preamble now defines "applicable"
  so a dev-only profile cannot read the sessions gates out of scope; D6 gained a
  `facts.activeGeneration` mismatch policy; D4's enumeration restored the
  authorized-lease query; `SNAPBACK_CAPABILITY_UNSUPPORTED` substituted;
  Related extended with LLP 0010/0043/0115/0127.
- OQ8 rewritten (the envelope floor is decided; the question is only whether a
  later revision may narrow it); OQ10 added for the delta-fix choice.

**Residue carried out of round 1, not applied:** LLP 0145 line 1757 carries the
same fabricated `SNAPBACK_CAPABILITY_UNAVAILABLE`. LLP 0145 is Charlie-adjudicated
and closed; correcting it is a one-line dated note that belongs to the author,
not to this loop.

## Round 2 — 2026-08-01

Instruction capsule SHA-256 (shared, family-conditioned blindness clause):
`bc89a587ce0ba8368225dc95379b838cdb424c6e35632bdee1602a5c946924a4`

Target SHA-256 (v0.2, 970 lines):
`4380d0f338321b878a98c3a6aa91f120788d53cc8c5364670f8ba77e17ab496c`

Delta-scoped: each family could read its own prior artifact and not the other's,
and neither could read this journal. Verified for Codex against its 17,072-line
transcript — the only occurrences of the fable path are the capsule's own
prohibition text and the target's Revised header. The Fable subagent recorded
the same exclusion.

### Round 2 results

**Both families NOT READY, and — the notable fact — entirely on defects the
v0.2 revision itself introduced.** Every round-1 finding was verified resolved
by both families independently. Codex returned one BLOCKING, two MATERIAL, three
DETAIL; Fable returned two MATERIAL and three DETAIL. Both labelled most of
their findings v0.2 regressions.

**Convergent, blind:**

- **Gate 11a's positive arm foreclosed OQ10's third option.** v0.2 required that
  a contract-valid change "still deltas," while D3 and OQ10 both held open
  "refuses in favor of a validated replacement" as a candidate fix. Fable put the
  point sharply: under the RFC's own rule that gates are fixed so a follow-on
  Plan "cannot silently change the contract," either OQ10 was fake-open or the
  gate would have to be quietly reworded at fix time. The orchestrator had
  written the same contradiction into the companion ticket's acceptance section.
- **LLP 0090 missing from Related** after OQ10 began load-bearing on it.

**Codex's BLOCKING, which Fable rated only a non-blocking suggestion — and
Codex was right.** v0.2's D4 declared "there is no conflict to adjudicate."
That was an orchestrator over-correction. LLP 0108 §B does defer to LLP 0043,
but **LLP 0012 §Call-time generation binding still states its rule
unconditionally**: an unequal asserted pair "refuses before handler,
acknowledgement, receipt, or mutation effects" (`llp/0012:881-884`), with no
settlement carve-out — while LLP 0043 states the opposite ordering, "before
selecting an active mutation function, the server … looks up the exact
`(clientMutationId, …)` identity. A hit republishes the stored result without
handler dispatch … A miss then uses ordinary active-function selection"
(`llp/0043:286-296`). The shipped code follows LLP 0043. So v0.2 fixed one half
of a two-half conflict and announced the whole thing settled.

Fable's round-1 review had flagged the LLP 0012 half in passing — "may warrant a
dated 0012 clarification too" — and the orchestrator did not carry it into v0.2.
The finding is fairly charged twice over.

**Codex-only, also confirmed: gate 15a collided with LLP 0095.** v0.2's
adversarial envelope gate required "invalid … live-frame discriminants" to
surface a structured error, while gate 16 imports LLP 0095's tolerance floor,
which requires that "unknown envelope kinds are skipped, never fatal"
(`llp/0095:315-320`, fixture `negative.unknown_kind.skipped`). No single
implementation could satisfy both, and treating unknown kinds as fatal would
regress protocol evolution.

**Fable-only, also confirmed:** §Motivation's LLP 0108 bullet still asserted the
unqualified egress universality D3 spends three paragraphs retracting — the one
place the D3 rewrite had not propagated, while the sibling generation bullet in
the same list *was* qualified. And D6's new facts-mismatch rationale overstated
the risk: in sessions mode fresh admission compares generations before
execution, so a mid-request rollout still yields a value computed by the
artifact the client compiled against.

### Round-2 dispositions

All findings from both families applied in **v0.3** (1031 lines). D4 now states
the conflict on all three referents and commissions a dated LLP 0012
clarification on acceptance, in the pattern D3 already uses for LLP 0114 — the
amendment is not landed, because 0147 is Draft and the commissioning pattern is
the document's own. Gate 11a's positive arm is fix-neutral (delta *or* validated
replacement) and the ticket matches. Gate 15a and D3's floor are narrowed to
malformed *known* frame kinds. Retry policy is restated as derived from the
closed operation kind. D6's rationale is corrected and now carries the
indeterminate-outcome class for effectful operations plus the
no-duplicate-effect composition with D4. Gate 12's speculative future fixture
became the reconciliation obligation it implies. §Motivation, §Costs, gate 11b's
enumeration anchor, and Related are fixed.

**Growth accounting.** v0.1 828 → v0.2 970 (+17.1%) → v0.3 1031 (+24.5% over
v0.1), past the ~20% guideline. About 40 of those lines are the two Revised
entries the convention requires. Round 3's capsule makes displacement binding:
any proposed change must state what it replaces.

## Round 3 — 2026-08-01

Instruction capsule SHA-256: `84f555a976cc459df834189110460d5ec2fc26cc67b50e2f4fd3b2d6b3e4699f`
(The round-3 capsule made displacement binding and directed scrutiny at v0.3's
own corrections.)

Target SHA-256 (v0.3, 1031 lines):
`07f915fc2510a45ad38722f8bab06d722235f1935e3b7af85679a1880c428c7e`

### Round 3 results

**Split verdict — Fable READY (with one MATERIAL to apply), Codex NOT READY on
one BLOCKING — and the two are the same defect,** found independently, blind,
by different routes. Every round-2 finding was verified resolved by both
families. Neither family found any other v0.3 regression of consequence.

The defect: v0.3's D6 rule that a successful response whose
`facts.activeGeneration` differs from the request generation is suppressed and
reported with **indeterminate-outcome** semantics.

- **Codex** showed the classification is simply false. For a mutation the server
  commits and records the outcome *before* it reads generation facts
  (`src/local.rs:11227-11300`, `src/server.rs:18822-18851`). "May have
  committed" misreports durable truth: it did commit. Its counterexample then
  showed the rule causes the harm it claims to prevent — the application
  regenerates against the successor generation, as a rotation requires, and a
  hand retry is freshly admitted with no `clientMutationId` to deduplicate it.
- **Fable** attacked the same clause's safety absolute from the other side:
  generation identity is content-derived with no deployment nonce
  (`src/local.rs:158-175`), so an operator rollback to the byte-identical prior
  artifact re-admits the stale client's retry. Both interleavings are but-for
  caused by the suppression.

Fable also recorded an unusually honest provenance note: **the defective clause
implemented its own round-2 suggestion.** A family proposed the absolute, the
orchestrator adopted it verbatim, and the same family caught it one round later.
That is the loop working, and it is the third consecutive round in which the
blocking defect was introduced by the previous round's fix.

### Round-3 dispositions

v0.4 goes past both families' minimum. Rather than choosing between Codex's two
offered resolutions ("publish the still-valid result" or "return a
deployment-transition diagnostic that preserves the outcome fact"), D6 now
**inverts the rule to publish**, on the ground both families' own evidence
supports: the value is known-good — fresh admission proved the handler ran under
the client's artifact, and the commit is confirmed — so suppression is both a
lie and the thing that creates the retry incentive. The blank-and-resnapshot
half survives for live state, since subsequent frames come from the successor
artifact, and the stale-artifact signal is explicitly not a retry hint.

Gate 12 gains the executable late-rollout fixture Codex specified, including the
honest converse that a post-regeneration retry duplicates. Both Codex DETAILs
applied — the envelope floor now distinguishes an absent/non-string frame `kind`
(malformed, fatal) from a valid unknown string kind (skip-tolerant), and the
commissioned LLP 0012 landing also corrects the stale mutation-envelope source
comment at `src/manifest.rs:5681-5683`, which no reviewer had previously
connected to the amendment. Both Fable DETAILs applied. Both families'
compaction/deadline suggestions adopted; the revision history was compressed and
the per-round detail moved here, recovering the growth budget.

## Round 4 — 2026-08-01

Instruction capsule SHA-256: `48396a9d52eaad71a4a66f773797b8fee349e8b82c992c4e2d279cca72e90f63`
Target SHA-256 (v0.4, 1031 lines):
`d18213a8d8c2322635e37c5b07fefd46b0d7966e067905ce7b82faa9c4c292d7`

### Round 4 results

**Fable READY (two DETAIL). Codex NOT READY on a BLOCKING — and the BLOCKING is
right.** This is the round that justifies running two families.

v0.4's inversion rested on a premise: that a deployment could rotate between a
mutation's commit and its response-facts read, so a success envelope could carry
successor facts. **That interleaving is forbidden by the shipped protocol.**

- Sessions activation is an admission barrier. The transition owner closes new
  admission and blocks until `in_flight == 0`
  (`src/auth/admission.rs:639-667`).
- The request's admission lease is retained through the response body's final
  sink — `RetainedAdmissionBody { _admission, … }`
  (`src/server.rs:9611-9620`).
- The facts read happens *inside* that admission and re-validates it first:
  `authority.validate_admission("mutation generation facts")`
  (`src/server.rs:18838-18841`), and the same on the query route
  (`src/server.rs:17735-17738`).
- LLP 0058 states it normatively: the transition owner "closes new admission and
  waits for every predecessor finite invocation and retained HTTP response body
  to drain" before publishing the successor generation
  (`llp/0058-…-staged-auth-mode-protocol.spec.md:911-916`).

So a conforming sessions server cannot deliver successor facts on a predecessor
success. v0.4's D6 rule, its rationale, and gate 12's fixture all described an
unreachable scenario.

**Why Fable missed it, and the lesson.** The Fable review verified the two-lock
seam between commit and facts and called it "a deterministic interposition
seam." That is true — the seam exists. What it did not check is whether
*activation* can interpose there. Verifying that a code seam exists is not the
same as verifying that the scenario reaching it is reachable. The round-5
capsule carries that calibration to the Fable family explicitly.

**Convergent, blind:** both families found that a deployment transition cannot
resnapshot. Codex rated it MATERIAL ("an automatic resnapshot loop using the
immutable G1 registry cannot succeed"); Fable rated it DETAIL, arriving via the
rationale clause ("a still-stale resubscribe surfaces its generation refusal
until the application regenerates"). Both are right; v0.5 takes the stronger
form.

### Round-4 dispositions

v0.5 adopts Codex's resolution option 1, which the review itself called strongly
preferable — preserve LLP 0058 quiescence rather than propose overlapping
activation. D6 now says a facts mismatch on a success envelope is a **protocol
violation, not a deployment race**: publish nothing, structured protocol
diagnostic, no outcome claim; real deployment transitions reach the client
through refusal at fresh admission and through subscription retirement. A second
bullet states that a deployment transition blanks, signals, and **stays
unreadable** until the application regenerates. Gate 12's late-rollout arm is
replaced by LLP 0058's no-overtake property plus a separately labelled defensive
protocol-error fixture with fabricated facts; gate 18 is split along the same
line and scoped to predecessor *live state as current*; D6's first bullet no
longer lumps deployment transition with the resnapshot cases; §Runtime contract
restates the comparison as a defensive check. LLP 0058 added to Related.

**Note on the asymmetric-stop rule.** Charlie's standing rule says that when one
family returns READY on two consecutive revisions while the other returns NOT
READY on both, the loop should stop and escalate rather than keep iterating.
That condition is now met on its face (Fable READY on v0.3 and v0.4; Codex NOT
READY on both). The rule exists to stop *detail-demand* spirals, and this is not
one: each Codex NOT READY has been an orchestrator-verified factual defect, and
round 4's was the most consequential finding of the loop. One further round runs
on the corrected revision; if it does not converge, the loop stops and reports
regardless.

## Round 5 — 2026-08-01

Instruction capsule SHA-256: `ef509d7ab6470221d76749d62daf908b06f3530ed0a242ca0608c8ecbb498d16`
Target SHA-256 (v0.5, 1050 lines):
`9fc8db29d849a63c1b7dd42eb31709193ac781a0f8fb2fd9d911ec1199e4c859`

### Round 5 results

**Fable READY with one MATERIAL. Codex NOT READY on a BLOCKING. They are the
same defect at two severities**, found blind — the second round running in which
the families converged on one finding and disagreed only about how hard it bites.

Both confirmed the v0.5 repair itself. Fable verified the whole chain
independently — the LLP 0058 quotation verbatim (`llp/0058:913-915`), the drain
loop (`src/auth/admission.rs:661-676`), the counted root living inside the
response body (`src/server.rs:9611-9638`), and facts read inside the request's
admission on **all four** facts-bearing carriers, including the authorized-lease
route, which computes facts in the *same* lock acquisition as its
generation-validated capture (`src/server.rs:18234-18243`) — and probed the
quiescence-timeout, detached-action, read-lane, identity-equal-redeploy, and
mid-flight-staging interleavings without finding a counterexample. Codex
verified the same and added that dev, v1-dev, and mixed tuples are rejected
rather than admitted.

**The convergent defect: v0.5's repair was true but stated universally.** A
settlement replay is a conforming sessions success whose facts may legitimately
differ, because LLP 0043's lookup precedes generation comparison
(`src/local.rs:10933-10984`) and the route then reads current facts
(`src/server.rs:18838-18851`). Codex gave the non-racy execution: G1 commits a
settlement; G2 activates completely; a G2-admitted replay asserting G1 hits the
cache and returns the stored result with G2 facts, barrier fully respected.
Micro v1 cannot make that request — which is why the fix is a scoping clause,
not a policy change. Codex rated it BLOCKING, Fable DETAIL; the orchestrator
took the higher severity, because a falsely universal claim about server
behavior is the class that blocked every round of this loop.

**Fable-only, and a regression class worth naming.** v0.5's recovery-window
absolutes ("until the application regenerates") ignore a second exit: an
operator rollback re-activating the byte-identical predecessor re-admits the
stale client, because generation identity is content-derived with no deployment
nonce (`src/local.rs:158-167`). This loop had *already established* that
interleaving in round 3 — and the v0.5 rewrite deleted every trace of it along
with the wrong text around it. A correction can drop a previously-verified fact
as collateral.

**Codex-only.** LLP 0012 has successful sessions calls echo the fact
(`llp/0012:890-891`), so v0.5's "compares any returned" would let *omission*
through — the defensive check must require the fact in a sessions composition.

### Round-5 dispositions

All applied in **v0.6** (1062 lines). D6's classification scoped to this
profile's fresh admissions with the settlement exception named and routed to
D4's commissioned LLP 0012 clarification; gate 12's closing sentence now
re-scopes "this gate **and D6's classification**." The refusal window given both
exits. D6 now makes the one fresh subscribe LLP 0095's T-RESYNC requires —
"recovery is identical for every reason and an unknown reason must not change
the transition" (`llp/0095:237-241`) — before stopping, and names
`SNAPBACK_UNKNOWN_FUNCTION` as the removed-function channel. §Runtime contract
requires the sessions fact; gate 12's defensive fixture covers absent as well as
unequal facts, and seeds from the existing admission/retained-body tests.
Duplicated no-overtake prose collapsed to a cross-reference.

Round 6 runs on v0.6 and is announced to both families as the **final round**,
with an author recommendation requested in each verdict.

## Round 6 — 2026-08-01 (final round)

Instruction capsule SHA-256: `c472e0557c65aba941485b72ad87e95721e0b1c652c1500e43f22b36856a2ff6`
Target SHA-256 (v0.6, 1062 lines):
`a8d534eab5d598a14e4c1de7ff67e2baa61f026ba2062853456499c1ba8cd8ab`

Announced to both families as the final round, with an author recommendation
requested in each verdict.

### Round 6 results — CONVERGED

**Dual-family READY on v0.6.** One DETAIL each, disjoint, both applied without
re-review as both families explicitly recommended.

- **Codex:** the Cloudflare exclusion said the arm "advertises
  `live_subscriptions` and nothing else" — false of
  `capability.manifest.cloudflare-do-sqlite-v8.all-aboard.json:17-21`, which
  also advertises `bounded_response_stream_v1` and `cron`. The decision is
  unaffected (neither manifest advertises both contract capabilities; neither
  supports sessions), but the READY bar requires corpus claims to be literally
  true. Restated as "none advertises both `args_contract_v1` and
  `result_contract_v1`."
- **Fable:** D6's first bullet pointed "two bullets down" at a bullet six down.
  Replaced with a named pointer, and "cannot resnapshot" softened to "cannot
  complete a resnapshot" so it no longer reads against the mandated single
  attempt.
- Codex's precision suggestion also applied: "generation identity is
  content-derived" became codegen deterministically regenerating the asserted
  identity fields, preserving LLP 0058's distinction between deterministic
  derivation and receiver-computed content-address proof.

Both families independently re-derived the v0.6 exceptions and could not
falsify them. Fable, carrying the round-5 calibration, audited *unreachability*
as well as reachability and added a strength no prior round had: the quiescence
**timeout** path aborts the transition (`src/auth/admission.rs:678-689`) rather
than proceeding over live predecessors, so the barrier fails closed even in the
pathological interleaving. It also verified fresh that D4's commissioned comment
correction targets a genuinely false comment, and that the sibling
`FunctionCallRequest` comment is unconditional but *true* — queries and actions
have no settlement path — "so the commission is scoped exactly right."

### Disposition

**Status promoted Draft to Review** on the converged revision, which is the only
transition this skill authorizes. The three DETAIL edits landed as **v0.7** and
are unreviewed by design; both families said that was warranted.

**Acceptance obligations both families named**, to land as one coordinated set:

1. D4's dated **LLP 0012** clarification scoping call-time generation binding to
   fresh admission, preserving LLP 0043's settlement-first lookup, and stating
   what a replay returns for generation facts and for a removed function —
   **together with** the `src/manifest.rs:5681-5683` mutation-envelope comment
   correction, which restates the same false universal ordering.
2. D3's dated **LLP 0114** Micro-projection amendment, before any Micro React
   byte or behavior claim.

Neither family treats gate 11a's red status as an acceptance blocker: the RFC
sequences the delta-lane server fix into Phase B and blocks only live-selecting
*graduation* on it.

## Loop retrospective

Six rounds, twelve reviews, all real. Verdict trajectory: r1 both NOT READY,
r2 both NOT READY, r3 Fable READY / Codex NOT READY, r4 same split, r5 same
split, r6 **both READY**.

**Four consecutive rounds were blocked by defects the previous round's fix
introduced.** That is the loop's defining fact and its main lesson. The
orchestrator over-corrected three times in the same neighborhood — declaring a
half-resolved spec conflict fully resolved (v0.2), misclassifying a confirmed
commit as indeterminate (v0.3), and then inverting a policy on an interleaving
the shipped protocol forbids (v0.4). Each was caught, and each fix's *own* new
claim was tested in the next round. A single-family loop would have shipped at
least two of them.

**The two families found different things, and the divergence carried the loop.**

- **Codex found what Fable's READY passed over, twice.** Round 1's unvalidated
  `live_delta` path — a hole in the exact seam D3's whole decision rests on,
  while Fable's strengths section had checked the three paths that *do*
  validate. Round 4's LLP 0058 quiescence barrier, which invalidated a decision
  Fable had verified anchor by anchor and passed. The round-4 finding is the
  single most valuable result of the loop: Fable confirmed the code seam existed
  and called it "a deterministic interposition seam," but never asked whether
  activation could interpose *there*. **Verifying that a seam exists is not
  verifying that the scenario reaching it is reachable** — that lesson went back
  into the round-5 capsule as an explicit calibration, and round 6's Fable
  review used it to add the fail-closed timeout result.
- **Fable found what Codex missed or under-rated.** The fabricated
  `SNAPBACK_CAPABILITY_UNAVAILABLE` (round 1) — a code name that exists nowhere
  in the tree, presented as "reserved," in a document that forbade exactly that
  three hundred lines earlier. The operator-rollback exit (round 5), which
  restored knowledge this loop had itself established in round 3 and the v0.5
  rewrite had deleted as collateral. And two honest self-corrections: it flagged
  the LLP 0012 half of the settlement conflict in round 1 as a passing note the
  orchestrator failed to carry, and in round 3 it recorded that the clause it was
  charging as a defect *implemented its own round-2 suggestion*.
- **Convergent, blind, in every round from 1 to 5.** The settlement-replay
  ordering, the retry-class authority gap, the missing target-capability failure
  family, gate 11a's foreclosure of its own open question, the LLP 0090
  omission, the resnapshot impossibility, and finally the settlement-replay
  scoping — which Codex rated BLOCKING and Fable DETAIL on the same revision.

**Codex confabulates LLP filenames; its line numbers and quotations are exact.**
Recorded in rounds 1 and 4 without repair. Every finding was checked against the
real file before application; none was invalidated by the wrong slug.

**One defect was found in shipped code and ticketed**, not in the document:
`issues/20260801-live-delta-frames-bypass-result-contract-validation.md` — live
delta frames publish storage rows without result-contract validation, violating
LLP 0108's requirement that live-query output be validated before transport
serialization. Found by Codex and by the author pre-verification pass
independently, in round 1.

**Residue for the author.** LLP 0145 line 1757 carries the same fabricated
`SNAPBACK_CAPABILITY_UNAVAILABLE` that round 1 removed from 0147. LLP 0145 is
Charlie-adjudicated and closed; correcting it is a one-line dated note that
belongs to the author, not to this loop.

**Growth.** 828 to 1079 lines (+30%), over the ~20% guideline. About 60 lines are
the seven Revised entries the convention requires; the body grew roughly 23%.
The round-3 capsule made displacement binding and later rounds were largely
net-neutral, but the budget was still exceeded. Both families noted the revision
history as the obvious place to recover it in a future editorial pass.
