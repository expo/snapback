# LLP 0118 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `3e1e2ce6951490156dafca4ae8bf6034a6f70c78762b6dc8bb806b0aff625d97`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is the most rigorously verified analysis document I have reviewed in
this repository. I spot-checked every load-bearing factual claim against the
tree and the diaries, and every one held: the extractor's refusal codes,
message text, marker format, and one-entry runtime-module emission
(`packages/snapback-codegen/inline-handlers.mjs:497,513,547`); the
dependency-graph-free v1 implementation-identity fields
(`packages/snapback-codegen/index.mjs:4156-4178`); the definitions-side
closed-graph refusal codes (`index.mjs:7078-7093`); the no-eval VM
constructor and all four constructor-walk probes
(`src/runtime.rs:514,614,3014-3017`); the LLP 0010 single-file legacy-profile
quote (llp/0010 line 403); the 0108 round-3 reconciliation and superseded
bundling bounds; and every diary quote and line/byte count (Diaries 0022,
0032, 0033, 0036, 0039 — all verbatim). The Confidence section's three-way
provenance classification is honest and matches what the document actually
does. The history recovery ("Snapback never had open imports") and the
two-tier observation (Finding 3) are genuine analytical contributions.

Against the stated bar, however, the document falls short in one specific,
knowable place: its analysis of the lead option's execution shape — the
document's self-identified "first design decision the follow-on must make"
(OQ1) — is built on a warm-VM-pool model that LLP 0009 retired on
2026-07-27, three days before authoring. That fact was reachable by reading
(no code needs to run), it sits in an owning LLP the document cites for the
"four-VM bound," and it materially re-weights the group-bundle vs.
resolve-and-splice trade. Pre-empirical analysis was therefore not
exhausted on the document's central novel question. Two further material
gaps in option-space completeness (a missing staging option; unstated
cross-front interactions with LLP 0120/CV-8) are independently fixable in
the same revision.

Per the capsule, I did not hold decision-freeness, absence of
implementation detail, or properly named empirical questions against the
document.

## 2. Strengths

- **§What Snapback does today** — the code-verified contract reconstruction
  is precise and, on checking, entirely accurate: closed globals set,
  `SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER` as "the refusal that forces
  duplication," the adversarial-closure scan coverage (alias, computed,
  destructured reflection paths — verified at
  `inline-handlers.mjs:86-99,163-235`), the marker domain string, and the
  per-operation module emission all match the shipped code exactly.
- **§What Snapback does today, implementation-identity paragraph** — the
  "no dependency-graph field, therefore every sharing option is a v2 hash
  format" derivation is code-verified and correct
  (`index.mjs:4156-4178`), and it does real work organizing the option
  space (Finding 4).
- **§Why it is this way** and **§The legacy registry it replaced** — the
  historical recovery is the document's best material: LLP 0010's
  "imports are rejected before emission" quote is real (line 403), the
  sharing-unit framing (one file per app → one expression per operation)
  is accurate, and the conclusion that "just allow imports" is not a
  revert to anything Snapback ever shipped defuses a bad argument before
  anyone makes it.
- **Finding 3 (two-tier)** — verified: the definitions-side resolver with
  fail-closed refusal codes ships at `index.mjs:7066-7137`, so the claim
  that option 1's admission machinery "has a working sibling in the same
  codebase" is true and well-chosen.
- **Options 3 and 4** — the security-vs-evidence separation is honest and
  unusually clear-headed: the document concedes the runtime backstop does
  most of the *security* work and locates the closure's distinctive value
  at the evidence tier (Finding 6), rather than dismissing open imports
  with security theater.
- **Finding 9** — the Campfire→Relay Board re-attribution is correct
  (Diary 0034 contains no helper/duplication mention; Diary 0033:193-195
  is the primary source), and LLP 0115 v0.4 has already absorbed it,
  crediting this document — evidence the research layer is doing its job.
- **§Confidence** — the code-verified / diary-reported / general-knowledge
  partition is exactly the provenance discipline the capsule asks for, and
  the Convex material is consistently labeled and hedged.

## 3. Concerns

**C1. BLOCKING-FOR-BAR — Option 1's execution-shape analysis (and OQ1)
rest on a retired warm-pool model.**
LLP 0009 §"DK-4 retired — upstream Ibex owner-thread contract
(2026-07-27)" retires warm VM reuse entirely: current upstream Ibex binds
evaluation and destruction to the creating OS thread, the local capability
honestly reports `vmLifecycle: "fresh-per-invocation"`, and
`src/warm_vm.rs:16-34` ships `WarmVmPool` as an explicit no-op
(`enabled()` returns `false`), with an `@ref` to that section at
`src/warm_vm.rs:10-11`. The document does not mention this anywhere. It
instead treats 0108's superseded text as the live constraint set: cost (b)
says the group-bundle model exists "to preserve LLP 0009's four-VM bound"
(no live four-VM bound exists in current 0009 — it belonged to the
retired DK-4 as-built section, marked "Historical / retired 2026-07-27");
cost (c) says "the DK-4 benchmark gate … must pass before advertisement"
(DK-4 is retired, not pending); the resolve-and-splice paragraph claims to
keep "the shipped … warm-pool model untouched" and to reopen "0108's
warm-pool-key question"; Finding 7 makes "one warm-pool key … per source
graph" half of option 1's headline hidden cost; OQ1 inherits all of this.
Under the actual shipped lifecycle the trade flips in a way the document
never analyzes: with fresh-per-invocation VMs, a group bundle means every
invocation re-evaluates every co-resident handler's bytes, while
resolve-and-splice means each invocation evaluates only its own
operation's closure — and splice's "duplicated bytes in generated
artifacts" become a *per-invocation evaluation cost*, a runtime-tier cost
that LLP 0115 constraint 4 (which governs evidence-graph volume) does not
bless, contra the document's framing. The document's splice lean happens
to survive, but for partly wrong reasons, and the pool-key half of its
stated trade is currently vacuous (though it may return if upstream Ibex
pins owner threads — the retirement is explicitly conditioned on the
owner-thread contract).
*Resolution:* revise option 1's costs (b)/(c), the resolve-and-splice risk
paragraph, Finding 7, and OQ1 to analyze both lifecycles — the shipped
fresh-per-invocation reality and the conditional future where pooling
returns; reframe DK-4 as retired-and-needing-respecification rather than
pending; and name the new empirical question (per-invocation evaluation
latency and memory as a function of bundle size and helper duplication).

**C2. MATERIAL — the option space misses the defining-module-only sharing
slice.**
Between option 1 (full bounded module graph) and option 2 (a novel
`defineHelper` primitive) sits a genuinely distinct staging point the
document never names: admit ordinary top-level `const`/function helper
declarations *in the same authored functions file*, statically validate
them under the existing self-containment and adversarial rules, and splice
them into consuming operations' runtime modules. No resolver, no
filesystem or path semantics in identity, no novel declaration idiom —
it is exactly the JS an agent writes first (Diary 0033's "shared sibling
reader helper"), and it restores precisely the legacy sharing unit (one
file per app) whose loss the document's own history section identifies,
minus the registry wiring Diary 0022 complained about. Both primary
duplication instances are same-file (Streak Lab's query and mutation;
Relay Board's view and summary), so CV-7's exit criterion ("Streak Lab's
calendar helper written once and used by both its query and mutation") is
satisfiable by this slice alone, at a fraction of option 1's mechanism.
0108's superseded text even gestures at it ("They may reference lexical
constants, local helper functions, and admitted static ECMAScript
imports"). Its v2 identity story is option-2-shaped (named helper-hash
edges, no paths) under option-1 semantics — which also shows OQ1 is not
the first design decision: "how much graph do you need at all
(same-file vs. multi-file)" is prior to "group-bundle vs. splice."
*Resolution:* add it as a named option or an explicit staged slice of
option 1, with its own cost/benefit/identity analysis and its effect on
OQ1's framing and on CV-7's sequencing.

**C3. MATERIAL — unstated interactions with LLP 0120 / CV-8, including a
missing dissolution path for one of the two motivating instances.**
The document's OQ4 correctly notes that option 7 (stdlib) would remove the
Streak Lab civil-date instance and "change the urgency evidence under
CV-7." The exactly parallel observation for the *other* motivating
instance is absent: LLP 0115 CV-8 and LLP 0120 name Relay's `boardView`
(one parent + N declared child collections) and `boardSummary` (bounded
grouped counts) as candidate declarative shapes (llp/0120 lines ~202-205;
llp/0115 lines ~454-455) — precisely the operations whose duplicated
indexed reads this document uses as its second primary evidence. If CV-8
lands, that instance dissolves with no helper mechanism at all. Both
motivating instances therefore have non-CV-7 dissolution paths, and the
document analyzes only one, leaving the urgency evidence half-examined.
Relatedly, sub-operation composition (sharing logic by extracting a
callable admitted operation — a mechanism Convex itself exposes as part of
its composition story, and which 0120 discusses as "composition of
already-admitted nodes") never appears in this document's option space,
even to be scoped out to 0120.
*Resolution:* an interaction paragraph (and an OQ4 extension) covering the
CV-8 dissolution parallel, plus one or two sentences naming
operation-level composition and drawing the scope boundary with 0120.

**C4. DETAIL — Finding 9 is stale against the tree it ships in.**
At commit 40ca18b9, LLP 0115 v0.4 has already applied the re-attribution,
crediting this document ("v0.4 correction from LLP 0118," llp/0115 lines
414-417); only LLP 0108 (line 793) still names Campfire. Finding 9's
present-tense "LLP 0115 CV-7 … name[s] 'Campfire's indexed-read helpers'"
is no longer true. *Resolution:* one sentence — 0115 has absorbed the
correction; 0108 still owes it.

**C5. DETAIL — "helper pressure grows with app size, so the measured gap
is a floor" is an unlabeled extrapolation.**
Plausible, but nothing in the diaries measures helper pressure vs. app
size; as written it is asserted as fact in an otherwise
provenance-disciplined document. *Resolution:* mark it as an expectation
or a named empirical question.

**C6. DETAIL — "The invariants survive by construction" (option 1
benefits) overstates a design whose review loop ended dual NOT READY.**
The specification *intends* invariant preservation; the loop that would
have confirmed the construction closed did not converge. The document
says exactly this elsewhere ("reviewed-but-unclosed"). *Resolution:*
soften to "as specified, the invariants are preserved by design; the
review loop did not confirm closure."

**C7. DETAIL — the definitions-side resolver characterization misses two
refinements that bear on the option analysis.**
The shipped resolver is esbuild-*hosted*: Snapback's admission rules run
as fail-closed `onResolve`/`onLoad` plugins that seize all resolution
(`index.mjs:7066-7137`). This strengthens the document's own point (the
disciplined-bundler hybrid option 3 gestures at already ships on the
definitions side, further de-risking option 1's machinery) and slightly
blurs option 3's "resolution semantics belong to the bundler" dichotomy —
the real axis is who owns the resolution decisions, not whose binary
hosts them. Also, "bare specifiers … fail closed" has a Snapback-owned
allowlist exception (`DEFINITION_PACKAGE_IMPORTS`, `index.mjs:7088`).
*Resolution:* a clause for each.

## 4. Suggestions

- ALLOWED_GLOBALS has exactly 31 entries (`inline-handlers.mjs:15-47`);
  "~32" is fine, but the exact count is free.
- When citing "Diary 0022," cite the slug: `diaries/` contains both
  `0022-backend-bakeoff.diary.md` (the quoted one) and
  `0022-catalog-lens.diary.md` — a numbering collision the bare citation
  inherits.
- The marker replacement's concrete shape
  (`({__snapbackInlineHandlerMarker:"<sha256>"})`,
  `inline-handlers.mjs:530`) is worth stating; a follow-on implementer
  will want it.
- §What Convex does could name Convex's function-level composition
  surface (`ctx.runQuery`-family, components) as general background even
  if only to scope it out — a document titled "Handler composition"
  reconstructing Convex's model without it reads as incomplete on the
  Convex side too (see C3 for the Snapback-side analog).
- Option 5 could note that identical-subtree detection is trivially
  buildable on the existing `canonicalAst` output while *near*-identical
  detection is a real research increment — the current "identical (and
  near-identical)" phrasing prices them the same.

## 5. Open questions

1. Does any hosted profile (LLP 0099 lane, DO executor) retain a live
   warm-VM model that keeps the group-bundle analysis operative for
   non-local targets? I verified only the local target's
   fresh-per-invocation posture; the revision for C1 should check.
2. How likely is the DK-4 retirement condition (upstream Ibex
   owner-thread affinity) to be lifted, and on what horizon? If pooling
   plausibly returns, the both-lifecycles analysis is mandatory rather
   than conservative.
3. Diary 0033 says the *guide's* inline profile steered the agent away
   from a sibling helper — absent that steering, would agents write
   same-file helpers naturally? This bears on option 2's muscle-memory
   risk and on C2's slice being the idiom-matching answer.

## 6. Verdict

**NOT READY** — strictly against the stated bar. The factual
reconstruction is excellent and fully verified, but the analysis of the
document's own central design question (OQ1) rests on a warm-pool/DK-4
model that the owning LLP retired before authoring — a documented,
readable fact whose absorption requires no empirical work — and the
option space omits a distinct staging option and a motivating-evidence
interaction that pre-empirical analysis can and should supply. C1 alone
crosses the bar; C2 and C3 should ride the same revision.

## 7. Recommended next step

One revision pass: (a) absorb LLP 0009's DK-4 retirement and the
fresh-per-invocation lifecycle into option 1's costs, the
resolve-and-splice paragraph, Finding 7, and OQ1, analyzing both the
shipped lifecycle and the conditional return of pooling, and naming the
per-invocation evaluation-cost empirical question; (b) add the
defining-module-only sharing slice as a named option/stage with its own
identity story; (c) add the CV-8/LLP 0120 interaction paragraph and the
operation-composition scope boundary; (d) apply C4–C7 and the
suggestions as one-liners. The document's structure, verification layer,
and findings otherwise stand; a delta re-review of the revised sections
should suffice for round 2.
