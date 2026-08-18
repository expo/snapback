# LLP 0187: Agent discoverability — routing over coverage

**Type:** RFC
**Status:** Accepted
**Systems:** Guide, Developer experience, CLI, Packaging, Code generation,
Diagnostics
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-05
**Revised:** 2026-08-06 (f — implementation record: T2's first slice and
T4's in-repo remainder LANDED at `f9b38422e` — guidePointer remediations on
both policy diagnostics with a manifest-anchor integrity test, and
orientation READMEs for the five remaining bare published packages with the
funnel test in the local proof; the plain-join advisory was ticketed rather
than shipped after a 112-source falsification pass met OQ3's fear —
`issues/closed/20260806-plain-join-advisory-detector.md`. The T4 funnel trio for
the CLI itself had landed earlier at `11fe8342c`.) 2026-08-06 (e — Accepted by author ruling at revision (d); the super-refine run record in llp/reviews/0186-agent-authoring-efficiency-program.run.md holds the verdict history, incl. that revision (d) was unreviewed)
**Revised:** 2026-08-10 (h — T2's plain-join advisory landed after the
ticketed AST-plus-schema proof supplied the missing positive fixture while
retaining the 112-source zero-candidate corpus boundary; OQ3 is resolved.)
2026-08-09 (g — OQ4 resolved by LLP 0061's tiered-projection amendment:
bounded entry artifacts, per-section flats, and a labeled roughly 2.5 MiB
whole-corpus bulk export.)
**Related:** LLP 0016, LLP 0061, LLP 0146, LLP 0176, LLP 0177, LLP 0178, LLP
0179, LLP 0184, LLP 0186

## Summary

The 2026-08-04/05 bakeoffs (diaries 0057–0060: one chess-backend arm
consuming the published npm packages, and three messaging arms working
in-repo, benchmarked against Convex) produced strong, replicated evidence
about why Snapback loses head-to-head comparisons: **in the one scored
comparison, the losing dimensions are almost entirely discoverability and
packaging, not capability.** (The quantified timing and scores are the
relay-room bakeoff's alone; what replicated across arms is the misses
themselves, not the measurement — LLP 0186's W1 instrument is what turns
this into causal accounting.) Three concurrent in-repo agent arms each
independently
failed to find features that exist, work, and are documented — and then
either hand-rolled worse replacements or recorded confident, wrong claims
that the capability does not exist.

The diagnosis this RFC defends: these are **routing failures, not coverage
failures**. Every replicated miss happened with the maximum possible
documentation surface available — inside the repo, with the full guide, the
capability index, and the LLP corpus greppable. Writing more pages will not
fix a failure mode in which existing, accurate pages are never reached.

**Dating note (2026-08-06 reconciliation):** hours after the bakeoffs, the
2026-08-05 guide sweep (`213607235`) landed the concrete cross-links and
aliases T1 below derives from these misses, closing the three
discoverability tickets. The evidence sections therefore describe the
corpus *as the arms found it*; per-item current state is noted inline.
What remains live in this RFC is the diagnosis, the conventions that make
such fixes mandatory and regression-proof, and the techniques not yet
built. Status facts here are dated snapshots, not live state — the fleet
landed T5 mid-review, hours after this RFC sequenced it as future work;
the cited tickets are the source of truth.

The proposal is a ranked program of routing techniques — facts placed at the
decision point, diagnostics that teach, forced capability lookups, an
out-of-repo discovery funnel, published-closure truthfulness, a smaller
search space, and a miss-to-eval regression loop — most of which lands as
scoped work inside existing owners (LLP 0061, 0178, 0179, 0184, 0176, and
LLP 0186's context-injection wave). This document owns the cross-cutting
diagnosis, the ranking, and the standing miss-to-eval regression rule,
and it carries the evidence and requirements for decision-point
cross-linking with intra-corpus vocabulary bridging, the CLI/package
documentation funnel, and the published-closure fence — each of which
lands as a scoped amendment to LLP 0061, which owns the resulting
conventions, contracts, and carriers (T1/T4/T5; the fence already has —
`8b821028a`, 2026-08-06).

**Relation to LLP 0186 (authored concurrently, same evidence base):** 0186
is the *efficiency program* — it owns the repeatable competitive benchmark
and the external context-injection surface (published authoring skill,
`/llms.txt`, competitor-vocabulary "rosetta" aliases, golden-path scaffold
template). This RFC is the *discoverability diagnosis and in-corpus routing
conventions*. Where the two touch, 0186 owns the artifact and this RFC owns
the rule: 0186's W2 ships the alias rows and retrieval-eval cases; this
RFC's T1/T7 state the conventions that make such fixes mandatory and
regression-proof for every future miss.

## Motivation: the evidence

The three messaging arms (Relay Room, Tandem, messaging-snapback) ran
concurrently in separate worktrees without inter-agent communication —
diary 0060, which orchestrated the messaging-snapback/Convex pair, records
discovering the other two as unrelated concurrent sessions mid-run, so the
isolation was observed rather than protocolized — and misses that
replicated across all three are structural, not one agent having a bad
day.

### What was missed

- **Admin console — missed 3/3.** All three arms debugged with raw host-op
  calls, `curl`, and hand-written verification scripts. The console is
  shipped, documented (`guide/operating/admin-console.md`), and its URL is
  printed on every native server boot (`crates/snapback/src/cli.rs`, the
  `admin console:` banner) — at least one arm had that line on screen via an
  `stdio: 'inherit'` launcher and still never used it
  (`issues/closed/20260805-admin-console-undiscovered-by-expo-bakeoffs.md`).
  At bakeoff time `guide/clients/react-expo.md` — the page these arms
  actually lived in — contained zero mentions of the console. (Landed
  since: the sweep added a "when something breaks" console pointer to that
  page.)
- **`defineRelationalQuery` — missed 3/3.** All three arms needed plain
  joins (conversation membership, message ⋈ sender) and all three dropped
  straight to `defineJsLiveQuery` with hand-written joins. One diary recorded
  the miss as a *positive finding* — praising the "declarative-vs-JS split"
  for joins "the declarative plan vocabulary can't express," which is false
  for plain joins
  (`issues/closed/20260805-relational-query-undiscovered-by-messaging-bakeoffs.md`).
  A bakeoff artifact now asserts a capability gap that does not exist.
  (Landed since: `guide/backend/queries.md` routes plain joins to
  `defineRelationalQuery` before the first `defineJsLiveQuery` example.)
- **`useSnapbackPresence` — missed 1/3, via a vocabulary split.** Two arms
  found the hook and praised it; the third grepped `useSnapbackEphemeral`
  and `subscribeEphemeral` — the schema-side vocabulary — found only the raw
  client method, concluded "there is no React hook (confirmed by grep, not
  assumption)," and hand-wired the raw subscription. At bakeoff time the
  hook appeared in `guide/clients/react.md` and never in
  `guide/realtime/ephemeral-state.md`
  (`issues/closed/20260805-guide-gap-ephemeral-presence-hook-naming.md`). The agent
  did the right thing methodologically and still got a wrong answer,
  because the corpus's two vocabularies never bridged. (Landed since: the
  ephemeral page now names the hook and the wrong-but-reasonable grep
  target.)
- **Expo asset upload — correct facts in the wrong places, 3/3.** The
  authorization rule and the native URI→body recipe were each individually
  documented, but never together at the point a public-upload Expo author
  needs them; all three arms hit the same 403 wall from three directions and
  built three different workarounds
  (`issues/20260805-expo-asset-upload-guide-gap.md`,
  `issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`).
  (Landed since: the sweep shipped a unified Expo asset recipe; the
  still-open guide-gap ticket tracks the residue.)
- **Published-closure drift (external arm).** The one arm outside the repo
  (Chessfield, diary 0057, npm `0.1.8`) authored against `ctx.refuse` and
  `custody: 'anonymous-public'` — both marked shipped and current, both
  absent from the published package — and worked around them with patterns
  the guide separately names as anti-patterns
  (`issues/closed/20260804-guide-gap-published-closure-drift.md` —
  resolved 2026-08-06 by the T5 fence, `8b821028a`). The diary's
  framing: "for an agent, whose entire model of the system is the text, it
  is the specific failure the agent-first framing exists to prevent."

### What routed correctly — the control group

The same diaries record discovery working, which identifies the channels
worth investing in:

- **The capability index, when consulted.** Chessfield answered
  existence questions ("durable queue? cron?") "in under a minute each" from
  GAP rows. The index has accurate rows for the admin console and relational
  queries — it works when consulted; the messaging arms did not consult it
  for those two.
- **Diagnostics that name the failing concept.** Relay Room's first codegen
  rounds caught three authoring mistakes with no source-reading, because the
  diagnostics named concepts. By contrast, every diagnostic that named only
  the symptom (the `v.array()` table-field refusal, the hashed field path in
  `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION`, `SNAPBACK_ARG_MISSING` on an
  omitted optional argument) sent an agent into `crates/snapback/src/` or into a workaround.
- **Redundant entry steering.** The AGENTS.md ↔ `guide/index.md` "stop
  reading this, go there" split, stated in both documents, was called "the
  single most useful thing in the first five minutes."
- **Accurate type declarations**, which rescued at least one wrong mental
  model (`.rows` vs `.current` on a started live-query handle).

### The scoreboard consequence

Relay Room's scored comparison lost to Convex 84–86 overall, with DX/docs at
55 vs 95 and operations/maturity at 62 vs 96 — those two dimensions are the
entire margin. The same diary's "hypothetical mature Snapback" comparison
wins 97–96 (`diaries/0058-relay-room-expo-backend-bakeoff.diary.md`).
Discoverability is not a polish item; in the one scored comparison it is
the entire margin.

## Diagnosis

1. **Routing, not coverage.** The replicated misses all had accurate pages
   and accurate capability-index rows. The failure is that nothing on the
   path the agent actually walked pointed at them.
2. **Surface-area tax.** Relay Room's diary describes the mechanism (the
   ten-subsystems formulation here is this RFC's gloss, not a quotation):
   an agent already holding many subsystems will not exhaustively search
   one more. Snapback's
   vocabulary richness (declarative / JS / relational / ephemeral / assets)
   converts to discoverability debt at a roughly linear rate — Convex needs
   fewer discoveries because it has one primitive. Therefore *facts at the
   decision point* beat *completeness of the corpus*.
3. **Passive channels lose.** A stdout banner printed at every boot was on
   an agent's screen and changed nothing. Channels that interrupt the wrong
   action (a diagnostic, a refusal with a pointer) teach; channels that
   merely emit do not.
4. **Agents discover by grep, so vocabulary is an API.** The presence miss
   was a grep for the wrong-but-reasonable symbol name. The strings an agent
   will plausibly search for are part of the discovery surface and must be
   engineered like one.
5. **The out-of-repo funnel is nearly empty, and every in-repo failure is
   its best case.** `@expo/snapback-cli` ships no README and no docs
   subcommand; CLI help surfaces the guide only through the `mcp`
   subcommand's one-line description, with no top-level documentation
   pointer; `snapback new` scaffolds a template (8–14 files, depending on
   template) containing zero orientation markdown; package-README guide
   references are
   repo-relative paths that do not resolve outside a checkout. The retrieval
   eval (`guide/retrieval-eval.md`) has only ever run from inside a
   checkout. External users get a strictly worse surface than the one that
   already failed 3/3.

## Design: the technique program, ranked by leverage

### T1 — Cross-link at the moment of wrong choice; engineer grep targets

*Owner: guide corpus (LLP 0061 conventions). Status: the one-time sweep
below LANDED 2026-08-05 (`213607235`, closing the three discoverability
tickets); the live T1 work is the conventions amendment that makes the
pattern mandatory for every future page.*

Rule: **every "hard way" the guide teaches must name its paved
alternative at the point of choice.** Concretely (landed by the sweep on
the pages it touched; retained as the worked examples the convention
generalizes):

- The `defineJsLiveQuery` teaching content states, before the first worked
  example: "if this handler is a plain join, `defineRelationalQuery`
  expresses it declaratively" — with the honest boundary (aggregation and
  self-joins are not expressible today, LLP 0177).
- `guide/realtime/ephemeral-state.md` names `useSnapbackPresence` (and the
  React pages name the ephemeral schema vocabulary back). Vocabulary splits
  between a feature's schema side and client side are treated as defects.
- `guide/clients/react-expo.md` carries a "when something breaks" pointer
  to the admin console (the react and headless client pages still lack
  it — a named residual below, for the convention to force).
- Intent-bearing recipes cover both halves of a problem on one page where
  the halves strand the author separately (the asset-upload rule: a
  blob-only recipe still strands the author at authorization).

Grep-target engineering: capability-index **Aliases** and page headings must
include the literal strings an agent would plausibly search for —
`useSnapbackEphemeral`, "join", "dashboard", "console", "typing indicator" —
not only the vocabulary Snapback happens to prefer. A miss caused by a
reasonable grep that returned nothing is a guide defect with a mechanical
fix: add the string. (Competitor-vocabulary aliases — "Convex `useQuery` →
`useSnapbackQuery`", "Supabase RLS → auth profiles" — are the same idea
aimed outward; LLP 0186 W2 owns shipping those rows. This RFC's rule covers
Snapback's *own* vocabulary splits, which no rosetta table catches.)

With the sweep landed, T1's proposal reduces to the **conventions
amendment** to LLP 0061: anti-pattern sections gain a required "paved
alternative" link, the alias column's charter expands to grep vocabulary,
and a vocabulary split between a feature's schema side and client side is
classified as a guide defect. Without the amendment, the sweep is a
one-off that the next feature quietly fails to repeat. Known residuals
the amendment must catch (present as of 2026-08-06):
`guide/realtime/live-queries.md` carries a `defineJsLiveQuery` worked
example with no relational pointer; the react and headless client pages
still lack the console pointer the react-expo page gained; and the
`useSnapbackEphemeral` wrong-guess literal appears in page prose but not
yet in the capability index's alias row.

### T2 — Diagnostics as the router (delegated to LLP 0178)

*Owner: LLP 0178 (Accepted 2026-08-06, `0f61dfb0f`). V1 plus the guidePointer
wiring on both policy diagnostics landed first (`f9b38422e`). The plain-join
advisory landed 2026-08-10 after the strict equivalence proof requested by
`issues/closed/20260806-plain-join-advisory-detector.md`; see OQ3's resolved
disposition below.*

The bakeoffs contain a natural experiment: concept-naming diagnostics taught
three fixes for free; symptom-naming diagnostics caused three source-reading
expeditions. LLP 0178's advisory lane with `guidePointer` remediations is
the mechanical form of T1 — "you are about to hand-roll X; Snapback has X"
delivered at generate time, where it cannot be skipped. The relational-query
miss is the canonical advisory candidate: a JS live-query handler whose body
is a plain join is statically recognizable often enough for a conservative
advisory. This RFC ranks 0178 acceptance and its first advisory batch as the
second-highest-leverage discoverability investment.

### T3 — Make the existence lookup structural (delegated to LLP 0184)

*Owner: LLP 0184. This RFC adds priority to its deferred items.*

The capability index answers existence questions in under a minute when
consulted, and the misses show consultation is unreliable when optional.
LLP 0184's entry ritual (`snapback agent setup` → `controls list --intent`)
and its deferred Phase 1 items 4–5 (served, queryable catalog; generated
guide tables replacing hand counts — which drifted once, 28/39 vs 30/41,
were corrected by hand, and by 2026-08-06 had drifted again: the served
host-op set is 36 while the page still says thirty, the live
demonstration that hand counts cannot keep up) are the structural form
of "check the index first." Finish them.

### T4 — Build the out-of-repo funnel before it is tested for real

*Owner: split — LLP 0061 owns guide distribution (it already names the
packaged CLI and a `snapback guide` command as the future carrier), so
the funnel items below are proposed as scoped amendments to 0061's
distribution section, with this RFC contributing the evidence and
priority; the published skill, `/llms.txt`, and scaffold template are
owned by LLP 0186 W2; the external eval is already specified by LLP 0184
Phase 5 and LLP 0176 G4.*

Proposed into LLP 0061's distribution section:

- READMEs on every published `@expo/snapback-*` package — orientation, not
  export inventories — whose documentation links resolve outside a checkout
  (served-guide URL shape + `snapback mcp`). (Landed: the CLI README at
  `11fe8342c`; the remaining five bare packages at `f9b38422e`, with
  `scripts/package-readme-funnel.test.mjs` keeping README presence and
  checkout-independent links a local-proof invariant.)
- The `snapback guide` subcommand 0061 already names as the carrier,
  extended with query support against the embedded guide (the bytes
  already ship in the runtime binary via `build.rs`), and CLI `help`
  output that names the documentation channels. (This RFC previously
  floated `snapback docs` as a name; 0061's `snapback guide` wins — one
  owner, one name.) Today the only help-surface mention of the guide is
  the `mcp` subcommand's description.
- `snapback new` scaffold output gains a consumer-facing AGENTS.md carrying
  the entry steering ("check the capability index first") and next-steps
  text. Scaffold-time is the one moment Snapback controls what lands in a
  first-time agent's context. (The richer golden-path template itself is
  LLP 0186 W2's `create-snapback-app` deliverable; this item is the
  minimal orientation floor for the existing scaffold, and merges into that
  template when it ships.)

Delegated:

- The published consumer-installable authoring skill and served `/llms.txt`
  — LLP 0186 W2.
- Running the cold-agent retrieval eval **from outside the repo** against
  published packages only — LLP 0184 Phase 5 and LLP 0176 G4; neither has
  run. Until one does, every discoverability claim is untested in the
  configuration real users get.

### T5 — Guide truthfulness against the published closure

*Owner: LLP 0061 — LANDED 2026-08-06 (`8b821028a`), mid-review, as
exactly the amendment this RFC prescribed.*

`since:` (or `unreleased: true`) frontmatter on guide content, joined by
`scripts/check-guide.mjs` against the checked-in
`guide/published-closure.json`, rendering an unreleased banner when a
page teaches primitives the installable artifact lacks. This was the
Chessfield failure class; the receipt is the closed ticket
(`issues/closed/20260804-guide-gap-published-closure-drift.md`), the
0061 implementation note, and `scripts/guide-published-closure.test.mjs`.
(It landed as a 0061 amendment, not as a convention this RFC holds — see
Non-goals; retained here as the worked example of the pattern.)

### T6 — Shrink the number of discovery events (delegated to LLP 0176/0179)

*Owner: LLP 0176 umbrella and LLP 0179.* Richness converts to
discoverability debt linearly, so composed golden-path surfaces and the
generated `AppDescriptor` reduce the count of "did I find the right
primitive?" questions rather than making each one easier. This RFC adds the
discoverability framing to their motivation; their design stands on its own.

### T7 — Every replicated miss becomes a retrieval-eval seed intent

*Owner: this RFC owns the standing rule; the initial cases below are the
same ones LLP 0186 W2 seeds, and they land once, under 0186 W2 — the
single landing owner — while the rule that every future replicated miss
must produce such a case lives here.*

The diary → guide-gap ticket loop (LLP 0016, LLP 0061 §5) produced this
document's evidence and is working. Close the loop: when a miss is fixed,
add a seed intent that would have caught it, so the fix cannot silently
regress. Initial additions:

- "Show a user's conversation list (membership join)" → must route to
  `guide/backend/relational-queries.md`, must not reach
  `defineJsLiveQuery`.
- "Add a typing indicator" → must route to `useSnapbackPresence` from
  either vocabulary entry point.
- "A mutation is misbehaving — inspect what it read and wrote" → must route
  to the admin console page.
- "Upload a photo from an Expo app without login" → must route to the
  unified asset recipe and state the authorization rule.

Once T4's external fixture exists, each seed runs in both fixtures
(in-checkout and external).

## Sequencing and priority

1. **T1** (the conventions amendment — the one-time sweep landed
   2026-08-05) and **T7** (eval seeds, landing under 0186 W2) — cheapest,
   lock in the replicated-miss fixes against regression, no design risk.
2. **T2/T3** — accept LLP 0178; finish LLP 0184 Phase 1 items 4–5 (the
   served catalog and generated guide tables) plus the Phase 5
   external-eval slice T4 depends on. The rest of 0184's control-plane
   program (mutation controls, mediated secrets) proceeds on its own
   merits — it is not a discoverability priority and this RFC does not
   rank it.
3. **T4** — strategically most urgent: the bakeoffs measured the best case,
   and LLP 0176 G4 will fail without it. Should land alongside the first
   *qualified, source-current* npm promotion
   (`issues/20260803-first-npm-latest-promotion.md` — `0.1.8` has been on
   `latest` since 2026-08-01 via the fast path; the open work is the
   qualified promotion of the current surface) and LLP 0186's W2 wave,
   which carries the delegated half.
4. **T5** — LANDED 2026-08-06 (`8b821028a`), ahead of this sequencing.
5. **T6** — proceeds on LLP 0176's own schedule.

## Non-goals

- Owning any of the guide's structure, frontmatter contract, distribution
  carriers, or the capability index — LLP 0061 owns these. Where this RFC
  touches them (T1 conventions, T4 funnel, T5 closure fence), the change
  is proposed as a scoped 0061 amendment, not held here.
- Specifying diagnostic taxonomy or remediation shapes (LLP 0178 owns).
- Specifying the control catalog, entry ritual, or MCP surfaces (LLP 0184
  owns).
- The golden-path authoring surfaces themselves (LLP 0176/0179 own).
- The competitive benchmark/ratchet and the external context-injection
  artifacts — published skill, `/llms.txt`, rosetta aliases, scaffold
  template (LLP 0186 owns).
- Fixing the individual defects the bakeoffs found (each has its own ticket
  under `issues/`); this RFC addresses why they went unfound.

## Open questions

1. **Should T1's "paved alternative" links be checkable?** A convention that
   every anti-pattern section links at least one capability id could be
   enforced by `check-guide.mjs`; the risk is mechanical link-stuffing that
   dilutes the signal the conventions warn about.
2. **Should the consumer-installable skill (LLP 0186 W2) be generated from
   the guide manifest** rather than hand-authored, so it cannot drift from
   the corpus it points into? Raised here because drift-proofing is this
   RFC's concern; the skill itself is 0186's.
3. **Advisory precision bar for T2's join detector. Resolved 2026-08-10:**
   require a complete equivalence proof across both the inline handler AST and
   admitted schema facts. The shipped rule recognizes only an argument-free,
   explicitly public, two-table left join with an admitted root index, one
   exact unique joined-index lookup, compatible required key types, a closed
   required-scalar/literal projection, relational missing-row behavior, and an
   identical result contract. Any branch, helper, write, aggregation,
   self-join, extra access, transform, optional join key, wider index, or
   contract difference stays silent. The advisory remains warning-only and
   cannot change admission.
4. **Does `guide-flat.generated.md` need a diet or a tier? Resolved
   2026-08-09: tier.** It had already outgrown LLP 0061's one-request premise
   on 2026-08-06 and is now roughly 2.5 MiB. LLP 0061 makes the capability
   index (about 50 KiB under its current enforced 51 KiB budget) plus surface
   map (about 12 KiB under 16 KiB) the bounded entry tier, generates one flat
   per top-level section, and keeps the whole-corpus flat as a labeled bulk
   export. Disposition and resolution:
   `issues/closed/20260806-guide-flat-projection-oversize.md`; LLP 0186 W2's
   `/llms.txt` consumes the result.
5. **Is a passive-channel audit worth it?** The admin-console banner
   evidence suggests auditing other print-and-hope channels (boot output,
   scaffold success payloads) and either upgrading them to interrupting
   channels or not counting them as discovery surface.
