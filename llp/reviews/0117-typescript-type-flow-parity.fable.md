# LLP 0117 review — Fable family


## Round 1 — 2026-07-30

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent
**Effort:** session-inherited
**Date:** 2026-07-30
**Redacted:** no
**Method:** fresh non-author subagent context, read-only review of the
working tree at commit 40ca18b9, mutually blind (no llp/reviews/
artifacts for LLPs 0116–0125 read)
**Target SHA-256:** `72f18aebddeb24644938241533aaf60134e267b76af34bd8fef4dc0a62b1658a`
**Instruction SHA-256:** `30c38e1a8f68e1684dc5373f8651842526556e278804dcffad9a78e2d216292e`
**Status:** completed

## 1. Overall assessment

This is a strong research document, close to the bar. Its code claims are
almost uniformly accurate — I re-verified every cited file:line on the
40ca18b9 tree and nearly all check out exactly, including several
non-obvious structural findings (the dead `resultOnly` flag, the two-lane
validator structure, the total absence of args ingress validation). The
four-mechanism decomposition (a)–(d) is genuinely clarifying, the option
space is honestly explored including the constraint-violating competitor
shape (B), and the Convex provenance discipline (background vs
diary-observed, with an explicit Confidence section) is exactly what the
series needs.

It falls short of "no flaws" on three material points: a pattern of
diary-quote misattribution (three quotes are real but sourced to the wrong
diary or section), an unmeasured quantitative causal claim about the Relay
148 → 224 delta that props up Option E's expected yield without being named
as an empirical question, and a technical mischaracterization inside Option
C ("in bare `.mjs` the only inference source is handler behavior") that both
overstates one of C's costs and hides a real F↔C composition. All three are
fixable in one small revision without touching any conclusion.

## 2. Strengths

- **Code grounding is excellent** (§What Snapback does today, §Findings,
  §Confidence). Verified against the tree: the closed primitive map and
  gate (`packages/snapback-codegen/index.mjs:3300`, map at 3309–3315,
  admitting exactly `string`/`boolean`/`number`/`unknown`/`object`); its
  application at schema fields (index.mjs:681, `SCHEMA_INVALID_VALIDATOR`),
  args (index.mjs:1242, `FUNCTION_INVALID_VALIDATOR`), legacy results
  (index.mjs:1251), and ephemeral scope/value (index.mjs:2607, 2614); the
  `resultOnly` flag written at define.mjs:228/239/249/273/282 with zero
  readers repo-wide; the separate `resultContract` lane (define.mjs:1711 →
  `effectiveResultContract`, result-contracts.mjs:473); the info-severity
  degraded diagnostic (index.mjs:1954–1956) vs the warning-severity
  provider diagnostic (provider-introspection.mjs:621, 633); the 4 MiB
  ceiling and egress validator (src/result_contract.rs:15, 19) with the
  buffered-effects @ref; args crossing as pre-serialized JSON
  (src/handler_wire.rs:93–96) with no ingress validation anywhere in
  `src/`; the artifact list with no handler-facing types (index.mjs:2428);
  and the JSDoc self-typing precedent (index.mjs:5870–5876). Finding 3's
  "lane merge, not a flag flip" is a real discovery, already credited by
  LLP 0115's v0.4 header.
- **Finding 4 is the document's best insight** (§Findings): CV-4a as "an
  evidence addition disguised as a DX item" is verified (no
  `validate_handler_result` counterpart for args exists) and consistent
  with LLP 0115's CV-4a text (0115 lines 336–341). It reframes the
  no-evidence-regression constraint as pointing *toward* the DX fix.
- **Option B is handled with unusual honesty** (§Option space B): analyzed
  seriously as the competitor's shape, with the compiler-version-in-the-
  hash and inference-unsoundness costs correctly identified, and correctly
  scored as a re-litigation of LLP 0108 rather than an increment.
- **The counter-ledger is fair** (§How they differ): the four
  inference-cannot-replicate advantages (egress enforcement, reviewable
  drift, language-neutral projection, vocabulary precision) are each
  code- or LLP-anchored, and the per-boundary-vs-total-volume framing
  (matrix tied at 2,196 vs 2,176, Diary 0039 lines 199–200) is the right
  lens for why agents preferred Convex despite the tie.
- **Decision hygiene is clean** (§Relationship to LLP 0115): ownership of
  every option is stated, E and F are explicitly offered as candidate
  additions rather than adopted, and the G ordering dependency is framed
  as input to 0115 OQ3, not a call.
- **Provenance structure** (§What Convex does, §Confidence): the
  three-tier confidence split (code-verified / diary-reported /
  background) is exactly the discipline the capsule asks for, and the
  Convex API shapes are correctly labeled general background.

## 3. Concerns

**C1. MATERIAL — Three diary quotes are misattributed.** All three exist
near-verbatim in the rerun corpus, but not where the document says:

- "Convex infers more, Snapback proves more" is attributed to Diary 0033
  (§How they differ). It appears nowhere in Diary 0033; it is Diary 0039's
  executive-table Relay Board row (diaries/0039, line 22). Diary 0033's own
  closest framing is "Convex remains more concise … Snapback remains
  stronger at emitted evidence and commit-version proof" (0033:199–201).
- "validates and types the split vector" is attributed to Diary 0036
  (§What Convex does). Diary 0036 never says this; its wording is
  "Convex's `v.array(v.object(...))` remains materially better at this
  boundary" (0036:101–102). The quoted phrase is Diary 0039 §5, lines
  141–142.
- "slight Convex edge from typed nested mutation input" is placed in
  "Diary 0039 §5"; the phrase is the executive-table row (0039:25, worded
  "Convex slight edge…"); §5 itself says "a slight Convex win" (0039:147).

No conclusion changes, but in a research document whose method is precise
provenance — and in a series whose v0.4 integration explicitly fixed a
same-shaped misattribution (CV-7, Campfire→Relay) — three wrong citations
is a pattern, not noise. Resolve: correct all three source pointers.

**C2. MATERIAL — The Relay 148 → 224 decomposition is asserted, not
measured, and not named as empirical.** The Summary and §How they differ
attribute the delta wholly to "closing its composite result contract," and
Option E's benefit case sharpens this to growth "dominated by respelling
nested stored-document and system fields the schema already declares."
Diary 0033 actually gives two causes and no decomposition: "largely because
the exact nested result contract is verbose *and* the guide's inline
profile steered this app away from a shared sibling reader helper"
(0033:41–46). The schema-respellable fraction of the measured bulk is
precisely what gates Option E's expected yield and the stated A+E-then-C
bridge test (§Composition), yet it appears neither in §Confidence's
diary-reported list as a derived claim nor in §Open questions as an
empirical question — and it is cheaply measurable from the rerun app
sources before any implementation. Resolve: restate the delta with the
diary's dual-cause wording (the helper half is 0118's, which the document
already says), and add an open question: "what fraction of the measured
contract bulk is schema-referencable (E-compressible) vs computed?"

**C3. MATERIAL — Option C misstates the inference-source space and misses
the F↔C interaction.** "In bare `.mjs` the only inference source is handler
behavior, which is forbidden" (§Option C) is incorrect: TypeScript's
`checkJs`/`allowJs` performs *static* inference over plain JavaScript
source with no JSDoc and no execution — a returned object literal infers a
precise shape. The real limitation is inference *quality*: with untyped
`ctx`/`args`, fields derived from reads infer as `any`. But Option F's
generated `handler-context.d.ts` fixes exactly that — meaning F enables C
over the existing `.mjs` surface, under the same LLP 0108
dev-time-assist-vs-authority clarification C already requires, with no TS
authoring lane at all. As written, the document both overstates a cost of C
("quietly implies a TS or JSDoc authoring surface anyway") and builds Open
question 5 on that overstatement, while §Composition treats C and F as
independent. Resolve: correct the claim, add the F-enables-C composition,
and recast OQ5 as "does proposal quality without a TS authoring lane
suffice once F's context types exist?" — which is also a better-shaped
empirical question.

**C4. DETAIL — Split figure qualifier dropped once.** §How they differ says
Split "grew 379 → 427 lines"; Diary 0036:113–114 counts "authored Snapback
source plus acceptance." Finding 2 carries the qualifier correctly; the
prose mention should too.

**C5. DETAIL — One Convex claim escapes the Confidence taxonomy.** "Convex
validates declared args at runtime" (§What Snapback does today, repeated in
Finding 4) is neither in the §Confidence background list nor
diary-evidenced (the diaries show Convex arms passing, not invalid-payload
refusal). It is true as background, but the document's own discipline says
to enumerate it. Resolve: add it to the background list.

**C6. DETAIL — Value-expression IR characterization is loose.** Option A
describes the host-plan IR as "operat[ing] over scalar arg references";
`src/value_expr.rs` also carries `ValueExpr::Args` (whole args object) and
path lookups that can yield non-scalar JSON (value_expr.rs:121–128). The
named interaction risk stands either way; the parenthetical should not
claim scalars-only.

**C7. DETAIL — "Diary 0022" is ambiguous in this repo.** Two diaries share
the number (0022-backend-bakeoff, 0022-catalog-lens). The quoted phrase
pins the intended one (0022-backend-bakeoff:76–77), but the citation should
name it.

## 4. Suggestions

- Cite the existing `argsContractHash` (index.mjs:1942;
  src/manifest.rs:3069–3070) in Option A: an argument-contract identity
  carrier already flows through the manifest with no runtime consumer,
  which slightly strengthens the "most plumbing is reusable prior art"
  case and connects to 0115's "argument-contract carrier" language.
- Consider one line on a schema-derived *default* contract (contract
  minted from declared reads/table for pure stored-row functions — declared
  facts, not handler inspection, so invariant-clean) and why it is
  low-yield given `results.documents(...)` is already the cheap spelling;
  it is the one invariant-compatible point in the space between D and G
  that a reader may wonder about.
- Option F's "optional check nobody runs helps nobody" point could name
  the concrete slot (local proof vs acceptance rung) as its own small open
  question rather than leaving it in the cost paragraph.
- The Summary's "148 → 224" parenthetical will be quoted out of context by
  later documents; after the C2 fix, make the Summary sentence carry the
  "part of" framing so the series index inherits the accurate version.

## 5. Open questions

- Are the rerun workout app sources available in-tree or in a pinned
  checkout for the C2 measurement? I could not find a relay-board source
  under `demos/`; if the sources live outside the repo, the decomposition
  question should say where.
- Does Diary 0036's observation that codegen emits "exactly one warning"
  for the degraded splits argument mean the authoring-time experience
  surfaces nothing at all (the warning being provider-side only)? The
  document implies this (§What Snapback does today, "loud downstream") but
  a one-line confirmation of what the authoring loop actually shows would
  sharpen the CV-6/G analysis.
- Is the `resultOnly` flag worth deleting (or wiring) as a trivial cleanup
  ticket independent of CV-4a, so the dead metadata stops suggesting a
  policy that does not exist?

## 6. Verdict

**NOT READY** — strictly against the stated bar. The document's code
grounding, option space, constraint analysis, and decision hygiene are at
or above the bar; C1 (citation misattributions), C2 (unmeasured causal
decomposition presented as fact where it gates Option E's case), and C3 (a
technically wrong claim inside Option C that suppresses a real F↔C
composition and mis-shapes OQ5) are pre-empirical flaws — none requires
running anything to fix, so "as much as we can without writing code" has
not quite been exhausted. All are small; none threatens a finding or the
constraint scoring. One revision should clear the bar.

## 7. Recommended next step

Author applies a v0.2 revision fixing C1 (three citation pointers), C2
(dual-cause wording plus the new decomposition empirical question), and C3
(static-JS inference correction, F↔C composition note, OQ5 recast), plus
the C4–C7 details at will — then a short round 2 delta review. No
re-review of the code-verified claims is needed; they held.
