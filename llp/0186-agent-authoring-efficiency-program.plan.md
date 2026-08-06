# LLP 0186: Agent authoring efficiency program

**Type:** Plan
**Status:** Draft
**Systems:** Developer experience, Competitive evaluation, Documentation,
Error handling, Code generation, Packaging, Client integration, Testing
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-05
**Related:** LLP 0061 (agent-first guide), LLP 0130 (Convex parity standing
decisions), LLP 0146 (agentic authoring affordances), LLP 0176 (Expo
messaging golden-path program), LLP 0178 (generate-time authoring
diagnostics), LLP 0179 (AppDescriptor and surfaces), LLP 0181
(zero-configuration Expo), LLP 0184 (agent-accessible control plane)

## Summary

Snapback should be the cheapest backend for a coding agent to build a real
application on — measured in wall-clock time and tokens against Convex,
Supabase, PocketBase, and hand-rolled Postgres — and today it is measurably
not. The 2026-08-05 paired bakeoffs (diaries 0058 and 0059) put the same
WhatsApp-shaped brief through Snapback and Convex with the same agent
harness: **26m03s on Snapback vs 11m15s on Convex**, with the split biased
in Snapback's favor because Snapback-only orientation reading was excluded
from the clock.

The central finding of this Plan is that the gap is **not primarily an LLM
training-data problem**. Decomposed, almost all of the 2.3x loss is
pre-product plumbing, misleading diagnostics, and shipped-but-undiscovered
capability — enumerable, mostly cheap, and already largely ticketed. Once
past setup, Snapback's semantics *saved* agent work relative to Convex
(ephemeral typing, platform offline, typed assets), and both diaries'
mature-state scoring flips the winner. Training data is real but its
near-term substitute is context injection: putting the right knowledge in
front of the agent at zero search cost.

This Plan owns two things no existing document owns — a **repeatable
competitive benchmark with a regression ratchet**, and an **external
context-injection surface** (published agent skill, llms.txt, competitor
vocabulary aliases, scaffold template) — and sequences the already-ratified
programs (0176/0178/0179/0181, 0146 D-tranche, 0184) by benchmark impact.
It deliberately re-owns none of their mechanisms.

## Evidence: where agent time and tokens actually went

All claims below are sourced from `diaries/0058-relay-room-expo-backend-
bakeoff.diary.md`, `diaries/0059-tandem-expo-messaging-bakeoff.diary.md`,
and the open tickets they filed under `issues/2026080*.md`.

### The measured gap is pre-product plumbing

Convex reached a phone-reachable backend with **one command and zero code
corrections** (`convex dev --configure new --once`). The Snapback lane
needed, before product code ran live:

- a local package-closure repair — `file:` installs of
  `@expo/snapback-client`/`-react` still resolve the unpublished
  `@expo/snapback-contract` from npm and fail without a manual override
  (`issues/20260805-local-source-package-closure-needs-contract-override.md`);
- runtime bootstrap plus three codegen correction rounds;
- a broken managed dev loop — `snapback dev` cannot parse the native
  `load`'s two-document JSON success output and aborts with a misleading
  `SNAPBACK_DEV_SERVER_LOAD_FAILED`, forcing the agent to diagnose against
  the raw binary and hand-write a custom launcher
  (`issues/20260805-managed-dev-multi-json-load.md`) — diary 0058 calls
  this "the biggest Snapback detour";
- manual load/reset steps the Convex lane had no analogue of.

Diary 0059 independently hit an **unwinnable state**: in dev mode the
client HTTP surface always resolves anonymous, so no `authorize()` owner
can ever satisfy the asset-upload ownership check; the first upload dies
with a bare TUS 403 and the only in-app resolution was rebuilding the demo
into sessions mode with a 138-line trusted-local token broker
(`issues/closed/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`).
Both diaries hit this wall independently — it is the single
highest-signal defect in the set.

### Three friction classes dominate agent cost

1. **Errors that misdescribe their cause.** The managed-loop failure
   points at JSON parsing rather than the wrapper's single-envelope
   assumption; the upload 403 names no ownership rule;
   `SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION` SHA-256-hashes the
   offending field *path*, so the author brute-forces which field is extra
   (`issues/20260805-result-contract-violation-hashes-field-path.md`).
   Each forces manual bisection — the most token-expensive activity an
   agent performs.
2. **Type/runtime disagreements.** The generated caller type said a plan
   arg was optional; runtime refused with `SNAPBACK_ARG_MISSING`; the
   agent's workaround was a schema redesign into two mutations
   (`issues/20260805-declarative-optional-arg-plan-missing.md`). The React
   upload hook returns `unknown` instead of the task types the client
   package already ships
   (`issues/20260805-react-asset-upload-task-types.md`). When a passing
   typecheck stops being a trustworthy done-signal, agents compensate with
   runtime probing everywhere.
3. **Shipped-but-undiscovered capability.** Three independent bakeoffs
   each failed to find `defineRelationalQuery`/`defineMaintainedProjection`
   (hand-wrote JS joins), the generated admin console (hand-rolled `curl`
   debugging), and `useSnapbackPresence` (hand-wired `subscribeEphemeral`)
   — see `issues/20260805-relational-query-undiscovered-by-messaging-
   bakeoffs.md`, `issues/20260805-admin-console-undiscovered-by-expo-
   bakeoffs.md`, and `issues/20260805-guide-gap-ephemeral-presence-hook-
   naming.md`. The failure mode is vocabulary: agents grep in the language
   of the workload ("ephemeral", "join", "dashboard") or of a competitor,
   and the capability is named in another register. Every miss is paid
   twice — once to build the feature, once per build to not-find it.

A fourth class is distinctly agent-shaped: **edit-loop taxes**. Editing a
doc comment changes generated artifact identity and wedges the local store
behind `SNAPBACK_AUTH_STARTUP_ARTIFACT_MISMATCH` with no successor
migration (`issues/20260805-doc-comment-artifact-mismatch-no-successor-
migration.md`); a dirty checkout bypasses the prepared binary and pays
Cargo startup on every acceptance run; ordinary Metro HMR after codegen
throws `SNAPBACK_REACT_REFERENCE_INVALID`
(`issues/20260803-react-hmr-reference-invalid.md`). Humans edit-restart
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

The cheap, already-ticketed fixes that dominate the measured gap. All are
repairs to existing behavior, owned by their tickets; this Plan only
sequences them as one wave:

1. Managed dev loop parses multi-document native load output
   (`20260805-managed-dev-multi-json-load.md`) — blocks step one of every
   fresh build.
2. Publish a coherent `@expo/snapback-*` closure to npm `latest`
   (`20260803-first-npm-latest-promotion.md`) so install is one command
   with no `file:` + overrides ceremony.
3. Resolve the dev-mode asset-upload anonymous-caller wall
   (`20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md`) —
   whether by a first-party dev identity path (LLP 0176 G0's dev-session
   primitive) or a scoped dev-mode ownership rule is the owning program's
   call; this Plan requires only that a fresh Expo app can complete an
   in-app upload without hand-building a broker.
4. Print the admin console launch command in `snapback dev` readiness
   output (adopted into LLP 0181's boot diagnostics; cheapest fix in the
   set against the dimension diary 0058 scored 62 vs 96).
5. Version-fence guide pages against the published closure
   (`20260804-guide-gap-published-closure-drift.md`) — the ticket traces
   three of one arm's four largest time sinks to the guide teaching
   primitives the installed packages don't contain.

Exit: a cold agent on a fresh checkout-free machine reaches a live,
phone-reachable backend from published packages with zero corrections not
caused by its own authoring mistakes.

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
  a tolerance fails the release gate, like a performance benchmark.
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
  first query → first upload), the top traps from the bakeoff corpus,
  the done-oracle (`snapback verify` once LLP 0146 D2 ships), and where
  the guide lives. Success test: an agent with the skill avoids every W0
  detour on the messaging brief.
- **Rosetta section / vocabulary aliases:** "coming from Convex
  `useQuery` → `useSnapbackQuery`; Supabase RLS → auth profiles;
  presence/typing → `useSnapbackPresence`; joins → relational query
  profile." Add the same aliases as retrieval synonyms in
  `guide/capabilities.md` rows and as cases in `guide/retrieval-eval.md`,
  seeded from the three-for-three discoverability misses.
- **`/llms.txt`** served beside the guide endpoints, pointing at
  `flat.md` and the capability index, so agents that probe the
  convention find the corpus instead of nothing.
- **Golden-path scaffold:** a `create-snapback-app` template carrying the
  LLP 0176 conversation surface as runnable, CI-verified code. Agents are
  far cheaper editing a working example than composing from prose, and
  published templates/examples are also what enters the next training
  cut. (Relation: LLP 0062's generated-app CLI; the template is a
  consumer of 0176's gates, not a fork of them.)

### W3 — Errors as the primary docs channel (sequencing ask)

An agent reads an error message at full attention; it reads the guide
with whatever budget remains. This Plan asks the owning documents to pull
two items forward:

- **LLP 0146 D7** (typed remediations carried by refusals) from Wave 3
  into the next tranche, and **LLP 0178 V1** (generate-time optional-arg
  contradiction — the exact bakeoff defect) as the first diagnostics
  slice, per 0178's own recommendation.
- Repair the three named diagnostic-quality defects: result-contract
  violations name the field path in clear text, `v.array()` table-field
  refusals name the `v.json()` fix, and function `auth` omission gets a
  diagnostic instead of silently widening to `optional-user`
  (`issues/20260805-function-auth-omission-default.md`).

The bar, stated once here and testable per-error: **every `SNAPBACK_*`
refusal an authoring agent can trigger names the violated rule and either
the fix or a guide anchor.** New refusal codes that cannot meet the bar
should say why in review.

### W4 — Edit-loop tax elimination (sequencing ask)

Per-iteration costs, weighted by how many times an agent iterates:

- Doc-comment/artifact identity: either exclude non-semantic trivia from
  function-bundle identity or ship the successor-migration path so a
  comment edit never costs a manual local-store rollover
  (`20260805-doc-comment-artifact-mismatch-no-successor-migration.md`).
- Codegen → HMR: a new generated reference meeting an old mounted
  provider binding must resolve or fail with a typed, recoverable signal,
  not an uncaught throw (`20260803-react-hmr-reference-invalid.md`).
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
- Monorepo/nested-app frictions from the bakeoffs
  (`20260805-headless-app-nested-demo-root.md`,
  `20260805-eas-nested-app-git-root-monorepo-archive.md`).

## Sequencing and ownership

| Wave | Owner | This Plan's role |
|---|---|---|
| W0 plumbing | existing tickets / 0176 G0 / 0181 | sequence as one wave, define exit |
| W1 benchmark | **this Plan** | build and operate |
| W2 context injection | **this Plan** (guide rows land under 0061 conventions) | build and operate |
| W3 errors | 0146 (D7), 0178 (V1), diagnostic tickets | prioritization ask + the per-error bar |
| W4 edit loop | existing tickets | prioritization ask |
| Golden path, descriptor, zero-config, catalog | 0176, 0179, 0181, 0184 | consume; re-measure via W1 as gates land |

W0 and W1 are parallel and first: W0 because it dominates the measured
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
   ≤ 2 per run, from ~11 (0058) and ~4 heavy (0059).
4. Zero shipped-but-undiscovered capability misses on benchmark runs —
   measured by `guide/retrieval-eval.md` cases and confirmed by run
   diaries.
5. Every agent-triggerable refusal meets the W3 bar, enforced by review
   convention and spot-checked by benchmark diaries.

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
