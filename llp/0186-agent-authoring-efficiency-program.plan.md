# LLP 0186: Agent authoring efficiency program

**Type:** Plan
**Status:** Accepted
**Systems:** Developer experience, Competitive evaluation, Documentation,
Error handling, Code generation, Packaging, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-05
**Revised:** 2026-08-06 (e — Accepted by author ruling at revision (d); the super-refine run record in llp/reviews/0186-agent-authoring-efficiency-program.run.md holds the verdict history, incl. that revision (d) was unreviewed)
**Revised:** 2026-08-06 (f — amendment adding a worked-example tier to W2's Rosetta section, scoped separately from the vocabulary-alias tier; see the dated amendment)
**Revised:** 2026-08-06 (g — revision of the (f) amendment after one `llp-review` round, two independent families instructed to prioritize generative feedback over compliance nitpicking: `llp/reviews/0186-agent-authoring-efficiency-program.claude.md` and `.gpt-5.md`, round 4. Both reviews converged on the same three defects — an evidence/concept-list mismatch, a closed four-demo source list two of the four concepts can't actually satisfy, and an OQ6 left as a named risk rather than a mechanism — plus the GPT-family review found a fourth, more serious one: the (f) revision's own worked "structural difference" example for Supabase RLS was itself wrong in exactly the way the tier exists to prevent. This revision fixes that bug, replaces the four-card list with a quick-map-plus-deep-journeys shape prioritized by an explicit evidence rubric, opens the source pool beyond the four originally named demos, and answers OQ6 with a generated-projection mechanism instead of naming it as unresolved.)
**Revised:** 2026-08-07 (h — implementation record: see the dated amendment. All five (g) journeys shipped; `/llms.txt` found already landed by unrelated fleet work with a phasing defect, now corrected.)
**Revised:** 2026-08-07 (i — implementation record: the W2 published authoring skill shipped as `skills/snapback-authoring/SKILL.md`, with its embedded Rosetta projection checked against the canonical records by `scripts/check-rosetta.mjs`; see the dated amendment. Its paired-lane success test remains gated on the W1 instrument.)
**Revised:** 2026-08-07 (j — W2 golden-path scaffold shipped v1 as the `expo-chat` template in `snapback new`; see the dated amendment paragraph.)
**Revised:** 2026-08-07 (k — the `create-snapback-app` ecosystem entry point named by W2 now exists in-repo as a thin wrapper package delegating to the `snapback new` scaffold mechanism; npm publication rides the next promotion. See the dated amendment paragraph.)
**Revised:** 2026-08-08 (l — Run 5 action-economy amendment: tool/action
multiplicity becomes a first-class W1 measurement and W5 sequencing target;
proof composition stays with LLP 0146 D2, and the new 0193–0197 documents
receive the implementation and publication work rather than creating a second
orchestrator.)
**Revised:** 2026-08-09 (m — failure-to-recovery trace amendment: W1 lane
reports gain a per-episode carrier-class trace; see the dated amendment.
Adopted from the LLP 0207 dissolution.)
**Revised:** 2026-08-09 (n — reconciled W2 with LLP 0061's implemented
tiered-projection disposition: bounded entry artifacts first, per-section
flats next, and the roughly 2.5 MiB whole-corpus export last.)
**Related:** LLP 0061 (agent-first guide), LLP 0130 (Convex parity standing
decisions), LLP 0146 (agentic authoring affordances), LLP 0176 (Expo
messaging golden-path program), LLP 0178 (generate-time authoring
diagnostics), LLP 0179 (AppDescriptor and surfaces), LLP 0181
(zero-configuration Expo), LLP 0184 (agent-accessible control plane), LLP
0187 (agent discoverability — the companion RFC from the same evidence
base), LLP 0193 (errors-as-docs completeness), LLP 0194 (generated API
reference), LLP 0195 (public documentation and training surface), LLP 0196
(template and recipe portfolio), LLP 0197 (benchmark publication standard)

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
  (`issues/closed/20260805-local-source-package-closure-needs-contract-override.md`);
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
   (`issues/closed/20260805-local-source-package-closure-needs-contract-override.md`).
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
  the convention find the corpus instead of nothing. The implemented LLP 0061
  disposition lists the capability index (about 50 KiB under its current
  enforced 51 KiB budget) and surface map (about 12 KiB under 16 KiB) first,
  then per-section flat projections, and the roughly 2.5 MiB whole-corpus flat
  last as an explicit bulk export
  (`issues/closed/20260806-guide-flat-projection-oversize.md`).
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
crates/snapback/build.rs, verify-local-proof, bootstrap receipt reuse, and the kit's
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

### W5 — Action economy and proof orchestration (measurement and sequencing owned here)

Run 5 changes the optimization target. The skill-equipped Snapback lane used
131 tool calls against Convex's 39 while completing each call with less wall
time and fewer tokens on average. That single run does not establish a causal
decomposition, but it does establish an observable multiplicity: Snapback
required many more discovery, authoring, and proof actions after framework
defects had largely left the path. Correction-loop count alone can no longer
represent the remaining cost.

W5 adds two measurement layers to W1:

1. **Raw harness facts:** tool calls; input, output, and cache-read tokens when
   the harness exposes them; and non-null orientation, authoring, verification,
   and diagnosis phase times where the transcript supports the boundary.
2. **Semantic action facts:** guide/reference lookups, package-source reads,
   binary-string excavation, authored file edits, process launches, proof
   commands, and retries. Raw tool calls are useful within one pinned harness
   but are gameable by command bundling; the product goal is fewer user-visible
   decisions and operations, not cosmetically larger shell invocations.

The implementation remains delegated to existing owners:

- LLP 0193 makes failure recovery one action when a refusal can carry the
  answer.
- LLP 0194 eliminates signature-driven package-source reads through one
  build-bound symbol authority and budgeted projections.
- LLP 0196 makes templates proof-bearing and exposes one template-level proof
  entry point backed by LLP 0146 D2's `snapback verify`; it does not mint a
  second verifier or receipt.
- LLP 0195 owns pre-install public retrieval and the longer-horizon training
  surface.
- LLP 0197 owns which of these facts a public comparison must disclose.

The immediate product bar is **zero package-source reads and zero binary-string
excavation in a cold benchmark lane**. A provisional engineering target of at
most 70 raw tool calls for the skill-equipped messaging lane is useful for
sizing work because it would approach 1.2x of Run 5's Convex token total at
Run 5's observed Snapback tokens-per-call. It is explicitly not a release
ratchet or magnitude claim until the N>=3 calibration confirms the action
distribution and W1 chooses a non-gameable tolerance.

W5 also commissions one bounded skill experiment after the harness records
cache-read tokens: compare today's complete authoring skill with a small router
that progressively loads only the task's assets/offline/sessions/native cards.
The experiment decides whether prompt replay is material; prose size is not
reduced on intuition alone.

## Sequencing and ownership

| Wave | Owner | This Plan's role |
|---|---|---|
| W0 plumbing | existing tickets / 0176 G0 / 0181 | sequence as one wave, define exit |
| W1 benchmark | **this Plan** | build and operate |
| W2 context injection | **this Plan** (guide rows land under 0061 conventions) | build and operate |
| W3 errors | 0146 (D7), 0178 (V1), diagnostic tickets | prioritization ask + the per-error bar |
| W4 edit loop | existing tickets | prioritization ask |
| W5 action economy | **this Plan** for measurement; 0146 D2 and 0193–0196 for mechanisms | sequence, measure, and prevent a second proof owner |
| Golden path, descriptor, zero-config, catalog | 0176, 0179, 0181, 0184 | consume; re-measure via W1 as gates land |

W0 and W1 are parallel and first: W0 (now reduced to the qualified npm
promotion and the verifying cold run) because it dominates the measured
gap, W1 because every later claim of improvement needs the instrument.
W2's skill can ship immediately after W0 (it should teach the fixed
paths, not the workarounds). W1 re-runs are the falsification checkpoint
for everything else: if a wave lands and the lane doesn't get cheaper,
the model in this Plan is wrong somewhere and the diary for that run
should say where.

**2026-08-08 (W1):** the benchmark instrument is formalized under
`benchmarks/` (methodology, brief corpus incl. the equal-proof-bar
messaging variant, the proven lane prompt templates, and run records
carrying the 0058/0065/0066/0068 series; standing baseline
`benchmarks/records/2026-08-07-messaging-0113.md` — skill-web 1.59x wall
/ 2.00x tokens vs Convex on 0.1.13).

**2026-08-08 (Run 5, npm 0.1.15):** skill-web completed in 19m00s,
201,268 tokens, and 131 tool calls; Convex completed in 10m18s, 89,793
tokens, and 39 tool calls. Snapback's absolute result was its best in the
series, while the control was also its best; the 1.84x wall / 2.24x token
ratios are N=1 existence evidence, not a magnitude claim. The record did not
retain input/output/cache splits or a causal phase decomposition, so later
documents must not convert its qualitative orientation diagnosis into a
numeric fraction.

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
6. Cold published-consumer lanes perform zero package-source reads and zero
   binary-string excavation; signature and remediation questions resolve from
   generated references, diagnostics, or template-owned code.
7. W1 records raw tool calls and the W5 semantic action classes. An action-count
   ratchet is calibrated only after N>=3; until then the Run 5-derived 70-call
   figure is a sizing target, not a claim or release gate.

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
- **OQ6 — Rosetta page maintenance authority (answered by the (g)
  amendment below; residual noted there).** Who keeps the worked examples
  in sync with guide drift? Answer: a canonical per-concept record that
  the page, feature-page backlinks, and retrieval-eval seeds are
  generated or checked from, with the guide owner responsible for
  Snapback-side accuracy and the W1 benchmark owner responsible for
  competitor-version pins and scheduled drift checks. The residual risk —
  competitor API drift between scheduled checks — is accepted as
  unavoidable and disclosed on every card, not hidden.
- **OQ7 — Action-count normalization.** Which semantic action boundaries are
  stable enough across harnesses to ratchet without rewarding command
  bundling? Run 5 establishes raw-call multiplicity inside one harness. W1
  must calibrate the normalized classes before action count can gate anything.

## Amendment (2026-08-06): W2 Rosetta section — worked-example tier

The accepted W2 text scopes the "Rosetta section" as vocabulary
aliases: single competitor-vocabulary strings (`Convex useQuery`,
`Supabase RLS`) added to the `guide/capabilities.md` Aliases column and
mirrored as `guide/retrieval-eval.md` seed cases, per LLP 0187 T1's
outward-facing convention. That closes a **discoverability** gap — a
competitor-vocabulary grep now lands on the right page — but not a
**translation** gap: landing on the page still leaves the agent to
compose the Snapback-shaped implementation from prose, which is exactly
the "compose from prose" cost this Plan's own W2 scaffold reasoning
says agents pay dearly for ("agents are far cheaper editing a working
example than composing from prose"). This amendment adds a worked-example
tier to W2, additive to and independent of the alias tier — neither
blocks the other, and the alias tier should ship regardless of this
tier's pace.

**Revision note (g).** The initial (f) text below was revised after one
`llp-review` round (two independent families instructed to be generative,
not just find compliance defects — `llp/reviews/0186-agent-authoring-efficiency-program.claude.md`
and `.gpt-5.md`, round 4). Both reviews independently verified the same
three defects by reading the same files (the concept list's stated
evidence didn't match its content; two of the four named demos don't
contain what was claimed; the tier deferred its own evidence base's
highest-signal defect to a later pass), and the GPT-family review found a
fourth, more serious one: the (f) text's own worked example for Supabase
RLS was itself wrong, in exactly the way this tier exists to prevent. The
text below is the corrected version; the (f) text and both full reviews
remain on record for what changed and why.

**Format.** Not four symbol-substitution cards. One guide page,
`guide/recipes/coming-from-convex-and-supabase.md` (filed under Recipes,
matching the existing "topic — distilled from demo" shape of
`recipes/presence-cursors.md` and `recipes/hidden-hands.md`, rather than
Getting Started — both reviews independently questioned the original
placement), structured as:

- A **quick map**: one-line routes needing no code pairing — Convex
  dashboard / Supabase Studio → the `snapback dev`-printed admin console
  URL; `convex dev` / Supabase local dev → the generate/dev/verify loop;
  schema and indexes → `defineSchema`; seed functions / SQL seed →
  versioned seed and reset; offline cache → retained-query and outbox
  guarantees.
- A small number of **deep worked journeys**: each a complete,
  minimal-but-real slice (every required file, not just the terminal
  hook/call), pinned to a competitor version and retrieval date, ending
  with one verification command or behavioral oracle and a link to the
  authoritative Snapback feature page for depth. Each journey states
  where it is *not* equivalent rather than forcing a translation.

**Source pool.** Not the closed four-demo list the (f) text named — two
of those four demos do not actually contain the joins or presence-hook
code claimed (verified independently by both reviews: joins only exist
in `demos/competitive-checkpoint`, already what
`guide/backend/relational-queries.md` transcludes; the presence *hook*
lives in `demos/messaging-snapback/src/lib/useTyping.ts`, not
`demos/cursors-web`, which has only the schema-side ephemeral
declaration). The rule instead: any CI-exercised canonical source,
preferring the smallest current golden-path witness; a small pinned
fixture under `benchmarks/fixtures/rosetta/` is the fallback only where
no witness exists yet.

One source deserves a named preference over transcribing competitor
documentation: **`demos/partiful-matrix` already contains real,
CI-verified competitor-side code for the same app.**
`surfaces/react/src/provider.ts`'s `createMatrixProvider` switches one
React app (`App.tsx`) between `createSnapbackProvider`,
`createConvexDirectProvider` (`convex-direct.ts`), and
`createSupabaseDirectProvider` (`supabase-direct.ts`) — three backends
implementing the identical `MatrixProvider` interface for the identical
events/RSVP/wall app, built for LLP 0063's comparative-fairness leg and
exercised by acceptance tests per backend (`acceptance/results/*.json`).
Where a journey's competitor side already exists here, use it in place
of a transcribed-from-docs snippet: it is real, tested code rather than
a claim about what the competitor's docs say, which removes half of
OQ6's drift risk for that entry outright. `demos/partiful-matrix` is the
preferred source for the reactive-query journey below; check it first
for any future journey before transcribing from external documentation.

**Deep worked journeys**, in evidence-honest priority order (both
reviews converged on this ranking independently; the (f) list's
console-3/3 evidence dropped and no-evidence RLS/queries added is not
repeated):

1. **Protected live CRUD, end to end** — schema, index, live query,
   mutation, codegen, provider, `useSnapbackQuery` /
   `useSnapbackMutation`, session custody, and the *complete* protected-
   data slice: explicit function `auth`, no client-supplied owner
   argument, the `eq('ownerId', authUserId())` predicate as the actual
   security boundary (source: `demos/card-game/snapback/functions.mjs`,
   `demos/card-game/tests/acceptance/authority-scope.mjs`), a supporting
   index, and `authScopeField` named correctly as declaring the live
   matcher's principal field for disjoint-subscription reasoning — **not**
   as an injected filter (`guide/auth/sessions-and-principals.md`,
   "Queries are scoped by the server, not by arguments"). Includes a
   two-principal negative proof, not a rename claim. This corrects the
   (f) text's own bug.
2. **Reading related data without hand-writing the wrong join** —
   Convex and Supabase are documented separately (JS-side traversal plus
   indexed lookups vs. foreign-key-derived nested selection with join
   modifiers; they are not one source concept) feeding one Snapback
   decision tree: bounded two-source `defineRelationalQuery`, a durable
   `defineMaintainedProjection`, or an explicit JS fallback. Source:
   `demos/competitive-checkpoint/snapback/functions.mjs`.
3. **Upload and attach an Expo image under ordinary session custody** —
   the item LLP 0186's own evidence section calls "the single
   highest-signal defect in the set" (the dev-mode anonymous-upload wall;
   forced a full app rebuild into sessions mode in one diary), promoted
   into this wave rather than deferred, since it is the highest
   cost-to-agent item in the entire evidence base, not merely a
   replicated miss. Source: the Expo ImagePicker-to-Blob recipe in
   `guide/backend/assets.md`.
4. **Ephemeral/presence** — Supabase's own docs steer high-frequency
   cursor-style state toward Broadcast, not Presence (meant for
   slower-changing state); the journey therefore separates "typing/online
   state" (→ `useSnapbackPresence`, `demos/messaging-snapback/src/lib/useTyping.ts`)
   from cursor-like workloads (→ ephemeral collections,
   `demos/cursors-web/snapback/schema.mjs`) rather than treating Supabase
   Presence as the universal source for both.
5. **Reactive queries** (`Convex useQuery` → `useSnapbackQuery`) — no
   miss evidence, but foundational; prefer the real dual-backend source
   named above (`demos/partiful-matrix`'s `convex-direct.ts` next to its
   `provider.ts` Snapback arm) over a transcribed Convex snippet.

Each journey uses the stable card shape: source intent and literal
search phrases; "use this translation when…" decision rule; the pinned
competitor snippet or source (version and retrieval date recorded);
the smallest complete Snapback slice; structural differences and
guarantees gained or lost; "not equivalent when…" boundaries and named
capability GAPs; one verification command or behavioral oracle; links to
the authoritative Snapback feature pages. One sentence of structural
difference — the (f) text's shape — is enough for the reactive-query
journey; it is not enough for auth, joins, or media, which get the fuller
block.

**Routing.** The alias tier's existing rows (`clients.react` →
`Convex useQuery`; `auth.scoped-queries` → `Supabase RLS`, both verified
in `guide/capabilities.md`) point to the canonical feature page
(`clients/react.md`, `auth/sessions-and-principals.md`), not this page —
so the (f) text's implicit assumption that the alias tier already routes
here was wrong. Fix: add an explicit "Coming from Convex/Supabase?"
pointer at the decision point on each canonical feature page this touches,
linking to the matching journey here; keep the capability-index alias
itself pointed at the canonical feature page, not redirected to the
comparison page.

**Non-goals.** Not a feature-parity claim and not a marketing comparison.
Where Snapback has no equivalent for a Convex/Supabase primitive already
tracked as a capability-index GAP row (generic joins beyond the bounded
relational-query shapes, ANN search maturity), the page says so plainly
instead of forcing a translation. The page is local-target-only, like
every Snapback destination it currently names, and does not imply hosted
parity.

**OQ6 mechanism.** One small canonical record per journey/quick-map entry
(id, competitor provider/version/source, competitor fixture path where
one exists, Snapback sources, capabilities, `lastVerified`/`reviewBy`
dates) that the hub page, feature-page backlinks, and retrieval-eval
seeds are generated or checked from, rather than four independently
hand-maintained artifacts that can drift from each other. Authority
split: the guide owner owns Snapback-side accuracy and page publication
(the existing `source=`/Freshness convention in `guide/conventions.md`
already gives mechanical protection against a renamed or removed
Snapback primitive, for free, once the record lists its Snapback sources
in the page's `authorities:`/`examples:` frontmatter); the W1 benchmark
owner owns competitor-version pins and a scheduled (not per-PR) drift
check comparing the recorded competitor source against its current
version, failing closed and filing a review item on drift — mirroring how
Rust's `rustdoc` doctests turn example drift into a build failure rather
than a documentation claim. A card whose watcher receipt is stale or
currently drifted is not published. This resolves OQ6 to a residual,
disclosed risk (competitor API drift between scheduled checks) rather
than an open question.

**Sequencing.** Same W2 lane as the published authoring skill — ships
right after W0, since it is cheap and reuses existing demo code, and
does not wait on the full-projection `/llms.txt` or the golden-path
scaffold. The skill should embed the generated compact projection of
each record rather than independently drafting its own translations of
the same concepts, so the two cannot drift apart. Build a small proof
first — journeys 1 and 3 above — and run both evals below before
expanding to the rest.

**Success test — two layers, not one.** *Retrieval*: given competitor
vocabulary, the agent reaches the exact journey or its feature-page
backlink within the existing tool budget (widening LLP 0187 T7's
standing rule: a fixed discoverability miss must add a retrieval-eval
case proving this, not just that some page loaded). *Construction*: the
agent completes the journey's own task and passes its oracle — the auth
journey proves cross-principal denial, the presence journey proves
expiry without a durable-version advance, the joins journey proves the
bounded primitive was chosen when its shape fits, the media journey
proves a real app-path upload. "Named the right primitive" is necessary
but not sufficient; a cold benchmark lane (LLP 0186 W1) given a brief
phrased in Convex/Supabase vocabulary reaching for the right primitive
without extra guide search is a discriminating signal only in
combination with the construction check, not on its own — an agent that
follows a journey's link into the authoritative feature page for more
depth is succeeding, not failing, so "zero further navigation" is not
the bar.

## Amendment (2026-08-07): W2 implementation record

**Rosetta tier: all five (g) journeys shipped.** `guide/recipes/coming-from-convex-and-supabase.md`
now carries the Quick map plus all five deep worked journeys named in the (g) revision —
protected-live-crud, expo-media-upload, relational-queries, ephemeral-presence, and
reactive-queries — landed in two batches (`3d7f6eb40`: the first two, as the "small proof" the
(g) revision's own sequencing called for; `1a4463d76`: the remaining three). The OQ6 mechanism
(`scripts/check-rosetta.mjs`, wired into `check-guide.mjs`) validates all five records against
`guide/capabilities.md`'s aliases, hub-page anchors, and feature-page backlinks; `check-guide.mjs`,
`check-rosetta.mjs`, and `ref-check` are green at both landing commits. Feature-page backlinks
landed on `auth/sessions-and-principals.md`, `backend/queries.md`, `clients/react.md` (extended
in place for both `protected-live-crud` and `reactive-queries` rather than duplicated),
`backend/assets.md`, `backend/relational-queries.md`, and `realtime/ephemeral-state.md`. Six new
capability aliases and five new `guide/retrieval-eval.md` seed cases (10–14) landed alongside.
The reactive-queries journey uses `demos/partiful-matrix`'s real, CI-exercised dual-backend
implementation (`surfaces/react/src/provider.ts` / `convex-direct.ts`, driven by
`tests/acceptance/convex-realtime-web.mjs`, which records each provider file's content hash) as
its "if a snippet isn't enough" pointer — real competitor-side code, not a transcribed fragment,
for the one journey where that source happens to exist.

**Authoring skill: shipped (2026-08-07).** `skills/snapback-authoring/SKILL.md` is the published
Snapback authoring skill for app-building agents (Claude Code / Codex / Cursor discover it through
the `scripts/sync-agent-skills` mirrors — `.claude/skills`, `.agents/skills`, `.cursor/skills`,
`.pi/skills`, `.opencode/skills` — which are whole-directory symlinks to `skills/`, so the real
directory needs no sync-script change). It front-loads the five W2 items: the golden path
(install → schema → codegen → dev → first query → first upload), seven top traps re-verified
against main on 2026-08-07 (traps already fixed by W0/W3 landings — the anonymous-upload wall,
the optional-arg contradiction, TUS CORS, the published offline-retention gate — were deliberately
excluded rather than carried stale), the `snapback verify` done-oracle with its partial-claim
honesty, the guide locations (`/_snapback/guide`, `/llms.txt`, capability-index-first,
`snapback mcp` vs `mcp-control`), and a compact projection of all five Rosetta records between
`<!-- rosetta:begin/end -->` markers. Per this amendment's sequencing rule the projection is
checked, not hand-trusted: `scripts/check-rosetta.mjs` now fails if the skill block is missing a
record's id, title, hub-anchor link, or any record alias, or if the skill names a journey no
record backs — so the skill and the guide cannot drift apart. The skill's discriminating success
test (paired lanes on the same brief, with and without the skill, measuring orientation cost and
Snapback-attributable correction loops) remains gated on the W1 instrument and has **not** been
run; shipping the skill claims availability, not measured value.

**Same-day review pass (2026-08-07).** A post-landing review corrected four defects in the shipped
page. (1) The reactive-queries journey's Snapback snippet was `demos/partiful-matrix`'s
harness-local hook (`@partitime/snapback-react`, `provider`/`userId`/`authority` parameters)
presented as the canonical shape — exactly the wrong-shape translation this tier exists to
prevent; replaced with the canonical `useSnapbackQuery(ref, args)` snippet from
`packages/snapback-react/exact-result-types.fixture.ts` (the same source `clients/react.md`
pins), with partiful-matrix repositioned as the dual-backend seam pointer only. (2) The
media-upload journey's backend snippets came from the codegen authoring test (PDF media types,
an `avatarUpload` the client snippet never referenced); replaced with
`demos/expo-golden-path-fixture`'s own `messages` schema field and `messageImageUpload` intent,
making the slice one coherent demo whose intent accepts images and visibly declares
`location: 'strip'`. (3) The ephemeral journey overstated the expiry-model contrast ("expires by
its declared `ttlMs` lease — not a side effect of the transport noticing a disconnect");
`realtime/ephemeral-state.md` itself states disconnect normally emits remove deltas with TTL as
the backstop, so the paragraph was rewritten to match, and the false "reconnects within that
window sees its own stale entry" claim (wrong for connection-keyed collections) was dropped.
(4) `reviewed-commit: HEAD` was pinned, per the convention that `HEAD` is permitted only in the
landing change. The two affected rosetta records' `snapbackSources` were updated to match.

**`/llms.txt`: found already shipped, phasing defect corrected.** Contrary to this Plan's own W2
text above ("there is no `/llms.txt`"), unrelated fleet work had already landed a working
`GET /llms.txt` route (`crates/snapback/src/server.rs`, `served_llms_txt`, covered by
`crates/snapback/tests/served_guide_v1.rs` and `crates/snapback/tests/route_policy_v1.rs`) by the time this amendment was
written — the Plan's text was stale, not the repository. The shipped version, however, did not
match this Plan's own phasing: it listed the complete flat single-file projection
(`/_snapback/guide/flat.md`, 857 KB and growing) as its *first* link, ahead of the capability
index, exactly the "pull the whole oversized corpus first" behavior W2's two-stage design exists
to prevent — `issues/closed/20260806-guide-flat-projection-oversize.md` was then open, so the
oversize condition this ordering risked was real. Corrected in `crates/snapback/src/server.rs`'s `LLMS_TXT`
constant to lead with the capability index and list the flat projection last, labeled as a large
explicit fallback; `guide/index.md`'s description updated to match. The existing test only asserts
substring presence of both links, not order, so no test needed to change; both still pass.
**Projection tiering completed (2026-08-09):** LLP 0061 now makes the bounded
capability-index + surface-map pair the honest one-request entry tier, offers
one generated flat per top-level section, and retains the roughly 2.5 MiB
whole-corpus flat as a labeled bulk export. `/llms.txt` advertises that order.

**Golden-path scaffold: shipped v1 (2026-08-07).** With its stated gate satisfied (LLP 0176
G2+G3 completed 2026-08-06; LLP 0179 S1 shipped), the scaffold landed as a third template in the
existing `snapback new` mechanism rather than a separate `create-snapback-app` tool:
`snapback new <name> --template expo-chat`
(`packages/snapback-cli/templates/expo-chat/`). It carries the LLP 0176 conversation surface as
runnable code derived from `demos/expo-golden-path-fixture`: a `messages` table with an image
`assetRef` field, the `messageImageUpload` intent (strip + required variant), public live queries,
the generated `conversation` surface (reads, bound `sendText` mutation, the composed `send`
command with optional image upload, typing presence, the raw asset lane), seeded personas, and an
Expo/React Native chat screen driving everything through `useSurface` — plus the starter
acceptance pair (`acceptance.mjs` live receipt, `acceptance.static.mjs` coherence) and an
`AGENTS.md` funnel per LLP 0187 T4. It deliberately omits the fixture's G2/G3 emit probes and
witness reporting, and the inbox/memberships/reactions/replies breadth (staleness fix
2026-08-10, found by the LLP 0223 review loop: the shipped template now declares
`auth: { mode: 'sessions' }` in its schema — the dev-auth-profile description below is
historical v1 prose; the fixture
remains the full sessions-mode surface). CI coverage: `packages/snapback-cli/package.test.mjs`
scaffolds the template, runs codegen over it (asserting zero degraded results and that the
`conversation` surface generates), and executes its static acceptance; the live acceptance was
verified against a real runtime at landing time. The out-of-repo packaged proof
(`scripts/snapback-package-cold-install.mjs`) does not yet exercise this template — ticketed as a
follow-on (`issues/20260807-expo-chat-template-cold-install-coverage.md`). With the authoring
skill shipped the same day (revision (i) above), every W2 lane now has a landed artifact; the
skill's paired-lane success test remains gated on the W1 instrument.

**Ecosystem scaffold entry point: in-repo (2026-08-07).** The `create-snapback-app` package this
Plan names (`packages/create-snapback-app/`) now exists, so the ecosystem-standard invocations —
`npm create snapback-app my-chat`, `npx create-snapback-app my-chat`, and the bun/pnpm
equivalents — resolve to the same scaffold once published. It is deliberately a thin wrapper,
not a second scaffolder: one file parses `<target-dir>`/`--template` (default `expo-chat`),
calls `scaffoldApp` from `@expo/snapback-cli` programmatically, derives `--help`'s template list
from the CLI's packaged template directory via the new `listTemplates()` export, and prints the
template's next steps (`cd` / `bun install` / `bun run dev`). Its package suite asserts
file-list-identical output against `snapback new` for `expo-chat` and `react`, the CLI-owned
`SNAPBACK_NEW_TEMPLATE_UNKNOWN`/`SNAPBACK_NEW_NAME_REQUIRED` refusals, and registry-derived
help; it is registered in the canonical package-test inventory, the local-proof rung set, and
the README funnel. **Not yet published:** the package is outside the qualified ten-package
closure (`scripts/snapback-publish-core.mjs` `PACKAGE_INVENTORY`); adding it there requires the
promotion lane's receipts, so publication is ticketed for the next promotion sweep
(`issues/20260807-create-snapback-app-publication.md`, alongside the expo-chat cold-install
ticket above).

## Amendment (2026-08-09): W1/W5 failure-to-recovery traces

Adopted from the LLP 0207 super-refine close-out (that Plan was withdrawn
and its live pieces dissolved to their owners; the dual-family review
record under `llp/reviews/0207-*` is the provenance). W1 lane reports
gain a **failure-to-recovery trace**: for every costly episode — the
threshold defined in the run-record schema before the first measured run
— the report records the first failed action, its carrier class
(`SNAPBACK_*` refusal · compiler/codegen diagnostic · bare not-found ·
silent discovery miss · other), semantic actions until recovery, and the
recovery outcome. The schema also tags W5's existing semantic-action
classes (guide/reference lookups, orientation reads) so reorientation
cost is observable without a failed action. This is a run-record schema
plus post-run annotation — no runtime telemetry — and it exists to
answer, with evidence instead of intuition, which failure presentations
(wrong-name guesses, serialized validation cycles, mid-session
rediscovery, stale-name episodes) actually cost sessions before any
mechanism aimed at them is commissioned. Mechanism proposals that would
have consumed these traces are recorded in LLP 0207's close-out and in
`issues/20260809-*-proposal.md`; none is commissioned by this amendment.
