# LLP 0186: Agent authoring efficiency program

**Type:** Plan
**Status:** Review
**Systems:** Developer experience, Competitive evaluation, Documentation,
Error handling, Code generation, Packaging, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-05
**Revised:** 2026-08-06 (d — round-3 reconciliation: mid-loop landings (T5 fence 8b821028a) + verified round-3 findings; revision (d) itself is unreviewed)
**Related:** LLP 0061 (agent-first guide), LLP 0130 (Convex parity standing
decisions), LLP 0146 (agentic authoring affordances), LLP 0176 (Expo
messaging golden-path program), LLP 0178 (generate-time authoring
diagnostics), LLP 0179 (AppDescriptor and surfaces), LLP 0181
(zero-configuration Expo), LLP 0184 (agent-accessible control plane), LLP
0187 (agent discoverability — the companion RFC from the same evidence
base)

## Summary

Snapback should be the cheapest backend for a coding agent to build a real
application on — measured in wall-clock time and tokens against Convex,
Supabase, PocketBase, and hand-rolled Postgres — and today it is measurably
not. The 2026-08-05 paired bakeoffs
(`diaries/0058-relay-room-expo-backend-bakeoff.diary.md` and
`diaries/0059-tandem-expo-messaging-bakeoff.diary.md`; each bakeoff ran
its own agent and scripts — within relay-room, one agent ran both lanes
back-to-back) put the same WhatsApp-shaped brief through
Snapback and Convex. The instrumented lane pair is the relay-room
diary's: **26m03s on Snapback vs 11m15s on Convex**, biased in Snapback's
favor because Snapback-only orientation reading was excluded from the
clock; Tandem replicated the friction pattern qualitatively and recorded
no lane timing.

The central finding of this Plan is that the gap is **not primarily an LLM
training-data problem**. Itemized, the dominant frictions behind the 2.3x
loss are pre-product plumbing, misleading diagnostics, and
shipped-but-undiscovered capability — enumerable, mostly cheap, and
already largely ticketed (a qualitative attribution from the diaries'
friction inventories — the relay-room clock was not causally itemized;
building the instrument that can itemize it is W1's job). Once
past setup, Snapback's semantics *saved* agent work relative to Convex
(ephemeral typing, platform offline, typed assets); the relay-room
diary's mature-hypothetical scoring flips the winner, and the Tandem
diary's qualitative verdict splits the same way (Convex faster to a
conventional live app, Snapback clearer on ephemeral and offline
semantics). Training data is real but its
near-term substitute is context injection: putting the right knowledge in
front of the agent at zero search cost.

This Plan owns two things no existing document owns — a **repeatable
competitive benchmark with a regression ratchet**, and an **external
context-injection surface** (published agent skill, llms.txt, competitor
vocabulary aliases, scaffold template) — and sequences the in-flight
companion programs (0176/0178/0179/0181, 0146's author-ratified D1–D3
tranche, 0184 — mostly still `Review`; this Plan makes prioritization asks
to those owners and, except where an item is explicitly gated — the W2
scaffold on LLP 0176 G2 / 0179 S1 — does not depend on their acceptance)
by benchmark impact. It deliberately re-owns none of their mechanisms.

**Relation to LLP 0187 (authored concurrently, same evidence base):** 0187
owns the discoverability diagnosis and the in-corpus routing conventions —
decision-point cross-links, Snapback-internal vocabulary bridging, the
standing miss-to-eval regression rule. This Plan owns the external
artifacts: the benchmark, the published authoring skill, `/llms.txt`, the
competitor-vocabulary rosetta, and the scaffold template. Where the two
touch, 0187 states the rule and this Plan ships the artifact; the initial
retrieval-eval cases named by 0187 T7 land once, under this Plan's W2,
which is their single landing owner.

## Evidence: where agent time and tokens actually went

All claims below are sourced from `diaries/0058-relay-room-expo-backend-
bakeoff.diary.md`, `diaries/0059-tandem-expo-messaging-bakeoff.diary.md`,
and the tickets they filed under `issues/2026080*.md`.

**Dating note (2026-08-06 reconciliation):** the bakeoff runs and this
Plan's first draft predate the 2026-08-05 evening landing wave (notably
`213607235`, `aa7f01497`, `8ce5ca33e`, `25ac99bcf`), which resolved several
of the defects cited below the same day the runs surfaced them. Each item
carries its status as of 2026-08-06. Resolved items remain evidence — the
benchmark measured the product as the agents found it — but the waves in
this Plan sequence only what is still open, and the W0 exit is not met
until the fixes are *demonstrated from published packages*, which no run
has yet done. Status facts here are dated snapshots, not live state: the
fleet has repeatedly landed this Plan's items within hours of a revision
(the fence in item 5 landed mid-review); the cited tickets are the
source of truth.

### The measured gap is pre-product plumbing

Convex reached a phone-reachable backend with **one command and zero code
corrections** (`convex dev --configure new --once`). The Snapback lane
needed, before product code ran live:

- a local package-closure repair — `file:` installs of
  `@expo/snapback-client`/`-react` still resolve the unpublished
  `@expo/snapback-contract` from npm and fail without a manual override
  (`issues/20260805-local-source-package-closure-needs-contract-override.md`);
- runtime bootstrap plus three codegen correction rounds;
- a managed dev-loop defect at measurement time — `snapback dev` could not
  parse the native `load`'s two-document JSON success output and aborted with
  a misleading `SNAPBACK_DEV_SERVER_LOAD_FAILED`, forcing the agent to
  diagnose against the raw binary and hand-write a custom launcher
  (`issues/closed/20260805-managed-dev-multi-json-load.md`, resolved
  2026-08-05) — diary 0058 calls
  this "the biggest Snapback detour";
- manual load/reset steps the Convex lane had no analogue of.

Diary 0059 independently hit an **unwinnable state**: in dev mode the
client HTTP surface always resolves anonymous, so no `authorize()` owner
can ever satisfy the asset-upload ownership check; the first upload dies
with a bare TUS 403 and the only in-app resolution was rebuilding the demo
into sessions mode with a 138-line trusted-local token broker
(`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`).
Tandem captured the 403 directly; relay-room independently corroborated
the same authority boundary without a device 403 receipt — it is the
single highest-signal defect in the set.

### Three friction classes dominate agent cost

1. **Errors that misdescribe their cause.** The managed-loop failure
   points at JSON parsing rather than the wrapper's single-envelope
   assumption; the upload 403 names no ownership rule;
   `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` SHA-256-hashed the
   offending field *path*, so the author brute-forced which field was
   extra — resolved 2026-08-05: violations now carry the legible bounded
   path in `details.path`
   (`issues/closed/20260805-result-contract-violation-hashes-field-path.md`).
   Each forces manual bisection — the most token-expensive activity an
   agent performs.
2. **Type/runtime disagreements.** The generated caller type said a plan
   arg was optional; runtime refused with `SNAPBACK_ARG_MISSING`; the
   agent's workaround was a schema redesign into two mutations
   (`issues/20260805-declarative-optional-arg-plan-missing.md`, still
   open). The React upload hook returned `unknown` instead of the task
   types the client package already ships — resolved 2026-08-05,
   `aa7f01497`
   (`issues/closed/20260805-react-asset-upload-task-types.md`). When a
   passing typecheck stops being a trustworthy done-signal, agents
   compensate with runtime probing everywhere.
3. **Shipped-but-undiscovered capability.** All three messaging arms
   failed to find `defineRelationalQuery`/`defineMaintainedProjection`
   (hand-wrote JS joins) and the generated admin console (hand-rolled
   `curl` debugging), and one of the three missed `useSnapbackPresence`
   through the ephemeral/presence vocabulary split (hand-wired
   `subscribeEphemeral`) — see
   `issues/closed/20260805-relational-query-undiscovered-by-messaging-
   bakeoffs.md`, `issues/closed/20260805-admin-console-undiscovered-by-
   expo-bakeoffs.md`, and `issues/closed/20260805-guide-gap-ephemeral-
   presence-hook-naming.md`; all three were closed by the 2026-08-05 guide
   sweep (`213607235`), and LLP 0187 owns the conventions that keep such
   fixes from regressing. The failure mode is vocabulary: agents grep in
   the language of the workload ("ephemeral", "join", "dashboard") or of a
   competitor, and the capability is named in another register. Every miss
   is paid twice — once to build the feature, once per build to
   not-find it.

A fourth class is distinctly agent-shaped: **edit-loop taxes**. Editing a
doc comment changes generated artifact identity and wedges the local store
behind `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` with no successor
migration (`issues/20260805-doc-comment-artifact-mismatch-no-successor-
migration.md`, still open); a dirty checkout bypassed the prepared binary
and paid Cargo startup on every acceptance run (resolved 2026-08-05, see
W4); ordinary Metro HMR after codegen threw
`SNAPBACK_REACT_REFERENCE_INVALID` — resolved 2026-08-05 via an atomic
binding handoff, `8ce5ca33e`
(`issues/closed/20260803-react-hmr-reference-invalid.md`). Humans edit-restart
occasionally; agents do it tens of times per feature, so anything
per-iteration compounds harder for agents than any single blocker.

### What must not change

Once past the plumbing, Snapback won on product semantics in both diaries:
typing was one ephemeral declaration versus Convex's durable table, two
indexes, scheduled expiry, nonce guard, and client keepalive; offline was
a platform contract with honest freshness/retention facts versus an
app-owned cache shim with offline sends disabled; typed assets carried
more policy and closed Convex's orphan window. Diary 0058's
mature-hypothetical scoring flips the result (Snapback 97, Convex 96)
and locates the deficit precisely: "most of the deductions today are
implementation/packaging maturity." **Softening the declarative, typed,
evidence-heavy core to imitate Convex is an explicit non-goal.**

## Cost model

An agent's cost to ship a feature is roughly:

```
cost ≈ orientation + Σ per-iteration (author + verify + diagnose) + N_iterations × loop_tax
```

- *Orientation* is bounded by context injection and retrieval quality
  (guide, skill, digest — LLP 0146 D3, LLP 0061).
- *Diagnose* is bounded by error quality: a refusal that names the rule
  and the fix costs one iteration; one that misdescribes its cause costs
  a bisection session. The bakeoffs contain the controlled experiment:
  codegen's three concept-naming diagnostics were absorbed at near-zero
  cost in the same run where the managed-loop and 403 errors each cost a
  detour. The delta between those two experiences is the DX gap.
- *N_iterations* is driven up by type/runtime disagreements (the agent
  loses its cheap done-signal) and *loop_tax* by the edit-loop defects.
- Training-data familiarity mostly shows up as lower orientation cost and
  fewer authoring mistakes for incumbents. It cannot be fixed on model
  timescales, but injected context (skills, scaffolds, error-carried
  remediation) is read at full attention and substitutes for it.

The program below attacks each term.

## Program

### W0 — Unblock the benchmark's first fifteen minutes (days)

The cheap, already-ticketed fixes that dominated the measured gap. All are
repairs to existing behavior, owned by their tickets; this Plan only
sequences them as one wave. Reconciled 2026-08-06: three of the five
landed on 2026-08-05, but the wave — and its exit — is not done, because
none of the fixes has yet reached the *published* closure an external
agent installs.

1. **Landed 2026-08-05.** Managed dev loop parses multi-document native
   load output (`issues/closed/20260805-managed-dev-multi-json-load.md`,
   `f8a7a1596`) — was blocking step one of every fresh build.
2. **Open — the wave capstone.** Publish a *qualified, source-current*
   `@expo/snapback-*` closure to npm `latest`
   (`issues/20260803-first-npm-latest-promotion.md`). Precision matters
   here: `0.1.8` has been on `latest` since 2026-08-01 via the
   fast-path publication (LLP 0041), so install is already one command —
   but that closure predates the current surface (the Chessfield arm
   authored against documented primitives absent from it), and the local
   `file:` path still needs a manual contract override
   (`issues/20260805-local-source-package-closure-needs-contract-override.md`).
   The open work is the first promotion under the qualification bar that
   makes the published closure current and coherent.
3. **Landed 2026-08-05.** The dev-mode asset-upload anonymous-caller wall
   is closed
   (`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`):
   LLP 0176 G0's dev-session primitive (`snapback session mint`,
   `1b12f939c`) plus the paved guide path give a fresh Expo app an in-app
   upload without a hand-built broker, per the G0 exit receipt
   (`25ac99bcf`).
4. **Landed 2026-08-05.** The managed dev loop's readiness output emits
   the admin console launch command (adopted into LLP 0181's boot
   diagnostics; pinned by `packages/snapback-cli/expo-dev-loop.test.mjs`).
   Cheapest fix in the set against the dimension diary 0058 scored
   62 vs 96.
5. **Landed 2026-08-06** (`8b821028a` — `guide/published-closure.json`,
   the `since:`/`unreleased:` frontmatter contract, the `check-guide.mjs`
   consistency join and its test;
   `issues/closed/20260804-guide-gap-published-closure-drift.md`). The
   ticket traced three of one arm's four largest time sinks to the guide
   teaching primitives the installed packages don't contain. The fence
   landed as exactly the LLP 0061 amendment LLP 0187 T5 prescribed —
   hours after this Plan sequenced it as open, mid-review.

Exit (unchanged, and not yet met): a cold agent on a fresh, checkout-free
machine reaches a live, phone-reachable backend from published packages
with zero corrections not caused by its own authoring mistakes. The
landed items make this *plausible from source*; only item 2 plus a
verifying cold run make it *true from npm*.

### W1 — Competitive benchmark and ratchet (owned here)

Formalize the bakeoff into a repeatable instrument. Diary 0058 could not
report token counts ("this Codex surface did not expose a per-lane token
meter") — so today we cannot even state the metric we want to compete on.

- **Fixed brief corpus:** start with the WhatsApp-shaped messaging brief
  (three prior runs make it the calibrated baseline); add one CRUD-shaped
  and one media-heavy brief so wins don't overfit to chat.
- **Lanes:** Snapback, Convex, Supabase, PocketBase, raw
  Postgres+Express. Same agent harness, same model, cold context, no
  human steering.
- **Metrics per lane:** wall-clock (existing), **input+output tokens**
  (run lanes through a harness that exposes usage accounting),
  correction-loop count, hand-authored line count, and the rubric scores
  diary 0058 established. Adopt whatever setup/ceremony metric LLP 0176's
  open question settles rather than inventing a competitor.
- **Ratchet:** record per-release results under `benchmarks/`; a
  regression in Snapback time-to-first-live-backend or token count beyond
  a tolerance fails the release gate, like a performance benchmark. The
  ratchet starts measurement-only: it becomes release-gating only after a
  calibration phase resolves OQ1/OQ2 (pinned model/epoch, repetition
  count, variance treatment, tolerance, run cost) — until then a breach
  is a report, not a block.
- **Fairness rules:** carry the diaries' caveats forward — auth parity
  labeled explicitly, offline/durability guarantees scored rather than
  line counts alone, so the ratchet never rewards omitting guarantees.
- **Publication gate:** do not publish comparative numbers until W0 lands
  and Snapback's own lane is not losing on self-inflicted plumbing.

### W2 — Context injection surface (owned here)

The training-data workaround. Today the guide serves well
(`/_snapback/guide`, `snapback mcp`), but there is no `/llms.txt`, no
published agent skill for Snapback *app-builders* (repo `skills/` is
internal LLP tooling only), and no competitor-vocabulary indexing.

- **Published Snapback authoring skill** for Claude Code / Codex / Cursor
  that front-loads: the golden path (install → schema → codegen → dev →
  first query → first upload), the top traps from the bakeoff corpus, the
  done-oracle (`snapback verify` — 0146's D2/D3 first tranche is
  implemented in `packages/snapback-cli/verify.mjs`), and where the guide
  lives. Success test (discriminating): paired lanes on the same brief,
  same harness, with and without the skill — the skill lane must show
  materially lower orientation cost and fewer Snapback-attributable
  correction loops. (A bare "avoids the W0 detours" test cannot
  distinguish skill value from the W0 product fixes themselves.)
- **Rosetta section / vocabulary aliases:** "coming from Convex
  `useQuery` → `useSnapbackQuery`; Supabase RLS → auth profiles;
  presence/typing → `useSnapbackPresence`; joins → relational query
  profile." Add the same aliases as retrieval synonyms in
  `guide/capabilities.md` rows and as cases in `guide/retrieval-eval.md`,
  seeded from the replicated discoverability misses (console and
  relational query 3/3, presence 1/3). This is the outward-facing
  competitor-vocabulary half; LLP 0187 T1 owns the inward rule for
  Snapback's own vocabulary splits, and the initial eval cases land once,
  here.
- **`/llms.txt`** served beside the guide endpoints, so agents that probe
  the convention find the corpus instead of nothing. Two stages:
  an index-only `/llms.txt` (pointing at the capability index, which
  holds 0061's enforced 40 KiB budget) ships right after W0; pointing at
  a whole-surface flat projection waits on LLP 0061's diet/tier
  amendment, because `guide/guide-flat.generated.md` (~727 KB at this
  writing, and growing) has outgrown 0061's one-request reading premise
  (`issues/20260806-guide-flat-projection-oversize.md`).
- **Golden-path scaffold:** a `create-snapback-app` template carrying the
  LLP 0176 conversation surface as runnable, CI-verified code. Agents are
  far cheaper editing a working example than composing from prose, and
  published templates/examples are also what enters the next training
  cut. (Relation: LLP 0062's generated-app CLI; the template is a
  consumer of 0176's gates, not a fork of them.) W2 therefore has three
  lanes: the skill, aliases, and index-only `/llms.txt` ship right after
  W0; the full-projection `/llms.txt` completes when 0061's projection
  lands; the scaffold waits on LLP 0176 G2 / LLP 0179 S1.

### W3 — Errors as the primary docs channel (sequencing ask)

An agent reads an error message at full attention; it reads the guide
with whatever budget remains. This Plan asks the owning documents to pull
two items forward:

- **LLP 0146 D7** (typed remediations carried by refusals) from its Wave
  2 slot into the next *implemented* tranche (D1–D3 are the ratified,
  built tranche; D7 itself is not yet ratified — this is a prioritization
  ask to 0146's author sitting, not a dependency). **LLP 0178 V1**
  (generate-time optional-arg contradiction — the exact bakeoff defect)
  landed 2026-08-05 (`f3c7d9fbb`), exactly per 0178's own
  first-slice recommendation.
- Repair the remaining named diagnostic-quality defects: `v.array()`
  table-field refusals name the `v.json()` fix
  (`issues/20260805-guide-gap-table-array-field-validator.md`), and
  function `auth` omission gets a diagnostic instead of silently widening
  to `optional-user`
  (`issues/20260805-function-auth-omission-default.md`). (The third —
  result-contract violations naming the field path in clear text — landed
  2026-08-05; see the evidence section.)

The bar, stated once here and testable per-error: **every `SNAPBACK_*`
refusal an authoring agent can trigger names the violated rule and either
the fix or a guide anchor.** New refusal codes that cannot meet the bar
should say why in review.

### W4 — Edit-loop tax elimination (sequencing ask)

Per-iteration costs, weighted by how many times an agent iterates:

- **Open — the remaining W4 item.** Doc-comment/artifact identity: either
  exclude non-semantic trivia from function-bundle identity or ship the
  successor-migration path so a comment edit never costs a manual
  local-store rollover
  (`20260805-doc-comment-artifact-mismatch-no-successor-migration.md`).
- Codegen → HMR: LANDED 2026-08-05 (`8ce5ca33e`) — generation splits now
  recover through an atomic binding handoff instead of an uncaught throw
  (`issues/closed/20260803-react-hmr-reference-invalid.md`).
- Acceptance runs on a dirty checkout reuse the prepared binary rather
  than paying Cargo cost per run: LANDED 2026-08-05 — the build-identity
  dirtiness fact is now scoped to the runtime binary's input set (shared
  pathspec definition in `scripts/runtime-build-inputs.txt`, read by
  build.rs, verify-local-proof, bootstrap receipt reuse, and the kit's
  expected-identity probes), so demo/doc edits no longer flip a
  `rerun-if-env-changed` input or forfeit the prebuilt rung
  (`issues/closed/20260805-whole-tree-dirty-flag-forces-runtime-rebuild.md`).
  Residue: a *commit* of unrelated files still rotates the baked
  `SNAPBACK_BUILD_GIT_COMMIT` (HEAD) and recompiles the identity crates
  once per commit; pinning the commit fact to the input set's last
  touching commit is a possible follow-on.
- Monorepo/nested-app frictions from the bakeoffs: LANDED 2026-08-05
  (`86e95f350` — marker-walk root resolution and out-of-checkout EAS
  staging; `issues/closed/20260805-headless-app-nested-demo-root.md`,
  `issues/closed/20260805-eas-nested-app-git-root-monorepo-archive.md`).

## Sequencing and ownership

| Wave | Owner | This Plan's role |
|---|---|---|
| W0 plumbing | existing tickets / 0176 G0 / 0181 | sequence as one wave, define exit |
| W1 benchmark | **this Plan** | build and operate |
| W2 context injection | **this Plan** (guide rows land under 0061 conventions) | build and operate |
| W3 errors | 0146 (D7), 0178 (V1), diagnostic tickets | prioritization ask + the per-error bar |
| W4 edit loop | existing tickets | prioritization ask |
| Golden path, descriptor, zero-config, catalog | 0176, 0179, 0181, 0184 | consume; re-measure via W1 as gates land |

W0 and W1 are parallel and first: W0 (now reduced to the qualified npm
promotion and the verifying cold run) because it dominates the measured
gap, W1 because every later claim of improvement needs the instrument.
W2's skill can ship immediately after W0 (it should teach the fixed
paths, not the workarounds). W1 re-runs are the falsification checkpoint
for everything else: if a wave lands and the lane doesn't get cheaper,
the model in this Plan is wrong somewhere and the diary for that run
should say where.

## Measurable outcomes

1. Snapback wall-clock on the messaging brief within 1.2x of the best
   competitor lane, from the current 2.3x.
2. Token counts recorded per lane per release; Snapback lane
   non-regressing under the ratchet.
3. Correction loops attributable to Snapback (not agent authoring error)
   ≤ 2 per run. The prior-run figures (~11 for 0058, ~4 heavy for 0059)
   are reconstructions from qualitative diary text, not recorded counts;
   W1's first instrumented run defines the attribution rule and records
   the binding baseline.
4. Zero shipped-but-undiscovered capability misses on benchmark runs —
   measured by `guide/retrieval-eval.md` cases and confirmed by run
   diaries.
5. The W3 bar holds across the refusal surface: enforced going forward by
   review convention, audited against an enumerated `SNAPBACK_*` refusal
   inventory (the diagnostics and catalog surfaces LLP 0178/0184 are
   building) rather than asserted as an unverifiable universal, and
   spot-checked in practice by benchmark diaries.

## Open questions

- **OQ1 — Token metering mechanics.** Which agent harness exposes
  trustworthy per-lane usage (Claude Code session accounting, Codex
  surface, or a wrapping proxy), and is cross-model token comparison ever
  fair, or does the ratchet pin one model per benchmark epoch?
- **OQ2 — Ratchet tolerance and cadence.** Agent runs are
  nondeterministic; how many repetitions per lane make the ratchet stable
  enough to gate a release without making it too expensive to run?
  (Minisforum lane lesson: measure N≥8 before blaming a commit.)
- **OQ3 — Skill distribution.** Where does the published authoring skill
  live (npm alongside the client closure, a skills registry, in
  `create-snapback-app` output) and how does it version against the
  closure so it never teaches drifted primitives (same fence as W0.5)?
- **OQ4 — Supabase/PocketBase/Postgres lane briefs.** The messaging brief
  advantages realtime-native platforms; which additional briefs keep
  those lanes representative rather than strawmen?
- **OQ5 — Public benchmark ethics.** When results are published, what
  disclosure (harness, model, briefs, fairness rules, raw diaries) makes
  the comparison credible rather than vendor-benchmark noise?
