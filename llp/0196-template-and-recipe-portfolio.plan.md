# LLP 0196: Template and recipe portfolio

**Type:** Plan
**Status:** Accepted
**Systems:** Templates, CLI, Guide, Testing, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-08
**Revised:** 2026-08-21 (LLP 0294 OQ5 records `prove` as the only done-oracle and `npm test` as the unwrapped `acceptance.mjs` debug path.)
**Revised:** 2026-08-08 (Accepted by Charlie Cheever — author ruling in session; final review binding per llp/reviews/0193-*.run.md close-out: 0194 dual-READY at r8, the others accepted with the enumerated r9 tail.) 2026-08-08 (r9, round-7 fix: the exit-criterion half of the rule-10 correction actually applied — the r8 header claimed it but the r8 edit silently missed this site (wrapping mismatch; caught by both round-7 reviewers); holdout now uses rule 10's full aid scope with 0197 D4 owning publication timing.) 2026-08-08 (r8, round-6 fixes: stale 0197 "rules 4a/4b" pointer corrected to rule 10; holdout adopts rule 10's full aid scope and "substantially implemented" test incl. OQ3.) 2026-08-08 (r7, author-merge: Charlie's action-economy
revision — T0 completes the existing chat starter before portfolio breadth;
every template exposes one proof command delegating to LLP 0146 D2's
`snapback verify`; the headless-simulator recipe becomes an executable
carrier kit registered under the verify profile; exit criteria add
zero-source-read and semantic-action measures; OQ3 holdout/starter
eligibility — merged onto the r6 review spine, keeping the two-gate T5
split, capability-surface wording, and template-assisted labeling.) 2026-08-08 (r5, this document: no body change this round.) 2026-08-08 (r4) — round-3 fixes: 0194 verify-config declaration path + scope ordering; 0197 aid symmetry beyond templates, no cross-vendor numbers in the history narrative, success counts on ratio charts, Related enumerated; slug-precision citations (0193); 0196 N=1 caveat. 2026-08-08 (r2) — r2 applies the full round-1 revision set that r1 header claimed but (reviser error, caught by the round-2 delta reviews) did not contain: capability-surface wording, T5 two-gate split, template-assisted labeling + held-out-brief rule. 2026-08-08 (r1) — super-refine round-1 revision against the
dual-family cluster reviews (llp/reviews/0193-*.{claude,gpt-5}.md):
unretained/incorrect quantitative claims corrected to retained-artifact
citations; see the review artifacts for the concern ledger.
**Related:** LLP 0146 (D2 verify owner), LLP 0176 (messaging golden
path), LLP 0179 (AppDescriptor and surfaces), LLP 0186 (W2/W5), LLP 0194
(generated API reference), LLP 0195 (public examples projection), LLP
0197 (benchmark publication), diaries 0068-0069, benchmarks/briefs/

## Summary

The measurement diaries repeatedly rank knowledge placement:
**scaffold beats guide beats package source** (every lane's
knowledge-source ladder ends in package source; the scaffold is
unanimously the cheapest). Knowledge moved into template defaults
(0.1.15's sessions mode, offline registration, upload wiring) produced
the largest improvement of any release whose changes were
knowledge-placement rather than defect fixes — bare lane 41m32s→29m35s
(diaries 0068/0069 — a single N=1 step inside the series' demonstrated
±30% variance, used here as plan motivation, not as a publishable
claim; the larger 80m→41m step at 0.1.13 came from the seven-defect
fix layer, a different mechanism). This Plan extends the portfolio
along the measured demand: two new templates exercising the capability
surfaces of the committed benchmark briefs, proof machinery registered by default, and the recipe
list the diaries priced.

## Program

**T0 — complete the existing Expo chat starter.** Before adding
portfolio breadth, absorb the common messaging work every measured lane
still authors: memberships/DM-vs-group shape, reply pointers, reactions,
and the labeled test persona switcher, with acceptance profiles covering
each. This may be a small set of reusable feature modules rather than
one monolithic template. It uses the existing LLP 0176/0179 primitives
and owners; it does not infer new auth or surface semantics from the
word `chat`.

**T1 — CRUD-dashboard template** (`--template crud-dashboard`),
exercising the same capability surface as `benchmarks/briefs/crud.md`
(not authored against the brief document): tables/list/detail/edit shapes, relational
query profile in the default path, sessions default, acceptance suite +
**registered verify profile** included. Most agent tasks are CRUD-shaped;
this becomes the default recommendation for generic briefs. LLP 0197's
aid-disclosure and holdout rules prevent this brief pairing from
standing alone as a public generalization claim.

**T2 — media-feed template** (`--template media-feed`), exercising the
same capability surface as `briefs/media.md`: typed upload intents with renditions in the main
path, delivery-profile selection demonstrated (the strict-vs-public
lesson), infinite-scroll list over retained queries.

**T3 — proof-by-default across all templates:** every template ships a
registered `snapback.verify.config.mjs` (run-5's skill lane registered
profiles by hand; the done-oracle should be non-vacuous from scaffold),
and the expo templates ship web platform + deps (the two-run web-deps
papercut, ticketed 2026-08-08 — absorbed here). Every template also
exposes one ordinary proof command (for example `bun run prove`) that
delegates to LLP 0146 D2's `snapback verify`, retains its receipt
identity and `next[]`, and adds no second verifier, receipt format, or
product-completeness claim.

**T4 — recipes and executable carrier kits.** Guide sections keep
CI-verified explanation, but the headless-simulator path is executable:
one bounded command/helper owns simulator boot/install/launch, scheme
approval, Expo Go onboarding dismissal, deep-link drive, screenshots,
backend-stop offline relaunch, cleanup, and artifact paths. Its evidence
is registered under T3's verify profile rather than becoming a parallel
proof system. The remaining recipe order is real-auth sign-in beyond
test personas, the offline supervisor-origin lane (ticketed), and
verify-config authoring (ticketed). Recipes graduate into template code
whenever a template naturally exercises them — the ladder says code
placement beats prose.

**T5 — template freshness, two gates:** (a) pre-release and blocking:
templates cold-install and pass their suites against the exact
*candidate staged tarballs* during release qualification, so a release
cannot ship with a template failing against its own closure; (b)
post-release canary: the same suites re-run against the *published*
registry closure, alerting (not blocking) on drift the staging
environment cannot see, with the release owner holding
rollback/fix-forward escalation. Neither alone suffices.

## Sequencing

T3 first (papercut absorption + verify-by-default — small), then T0 so
the already-published starter stops making every messaging lane rebuild
common breadth. T1 and T2 follow; T4 executable paths land alongside the
first template that exercises them. T5 joins the release checklist when
T1 lands.

## Exit criteria

- A cold agent given a CRUD or media brief scaffolds the matching
  template and reaches all proofs with zero template-gap loops.
- `snapback verify` is non-vacuous on every fresh scaffold, and the
  template-level proof command produces the same LLP 0146 D2 receipt a
  direct invocation would.
- Cold template lanes perform zero package-source reads and zero
  binary-string excavation.
- W1 records semantic actions before and after T0/T3/T4; success means
  fewer discovery and proof operations, not a shell-command bundling
  trick.
- The next benchmark run on the CRUD brief uses T1 with no template-gap
  loops — measured and labeled as a **template-assisted scenario**.
  Templates deliberately cover benchmark-brief capability surfaces, so
  aid-assisted results are never published as general
  authoring-efficiency claims: portfolio-level claims require success
  on a predeclared holdout brief not substantially implemented by ANY
  vendor-authored aid — template, T0 feature module, recipe, published
  example, or skill content — and competitor lanes get the symmetric
  accelerator policy (LLP 0197 rule 10 governs; 0197 D4 owns
  publication timing).

## Open questions

- OQ1: Template count discipline — the portfolio should stay small
  (three app templates + recipes); additions require a measured brief.
- OQ2: Whether `create-snapback-app` grows an interactive template
  picker or stays flag-driven (agents prefer flags; humans may not).
- OQ3: Holdout selection and aid eligibility for public comparisons.
  LLP 0197 rule 10 owns the disclosure rule and the "substantially
  implemented" test across ALL vendor-authored aids; this Plan must
  supply at least one workload that passes that test.
