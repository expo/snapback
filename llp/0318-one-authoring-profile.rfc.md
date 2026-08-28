# LLP 0318: One authoring profile

**Type:** RFC
**Status:** Withdrawn
**Systems:** Developer experience, Code generation, Guide, React/Expo,
Testing, Templates, Agent experience
**Author:** Charlie Cheever / Claude
**Date:** 2026-08-27
**Revised:** 2026-08-27 (b — **Withdrawn** by the author after round 1 of
`llp-super-refine`; see Withdrawal below. Both families returned NOT READY
(codex 7 MATERIAL / grok 3 MATERIAL) and the defects are not revisable without
replacing the proposal.) 2026-08-27 (a — Draft → Review at llp-super-refine
loop start, the one authorized transition)
**Related:** LLP 0252, LLP 0253, LLP 0310, LLP 0246, LLP 0304, LLP 0198,
LLP 0186, LLP 0127, LLP 0259, LLP 0319, LLP 0321, LLP 0323

## Withdrawal (2026-08-27)

The proposal cannot be adopted on the evidence it offers, and the
evidence it needs is already specified elsewhere. LLP 0252 D7 — Accepted
— requires a four-lane matrix over three workload families at
preregistered N>=3 with second-model-family evidence before any
default-profile change, and states that "the explicit profile remains
the published default initially." §5 proposed a second N=1 Clique run.

The document's primary ergonomic exhibit was also wrong:
`guide/getting-started/your-first-backend.md` carries a section titled
"Legacy compatibility: bundled handler modules" calling the
`source`/`exportName` split "the compatibility lane, not the paved path
for new work," and `handler` is already in both `JS_QUERY_SPEC_FIELDS`
and `JS_MUTATION_SPEC_FIELDS`. The paved explicit form is inline and far
closer to familiar than §1.4 claimed.

Codex additionally found the profiles differ semantically, not just in
spelling — familiar's `defineTable` unconditionally adds `.sync()`,
`useQuery` returns data-or-undefined and throws where `useSnapbackQuery`
returns a `QueryState`, `useMutation` is settled-only — so convergence is
not an alias migration; and that flipping the `authoringProfile`
omission default would silently reinterpret existing source, which
LLP 0304 forbids.

**What to do instead:** land LLP 0310.000's paved-loop repair, then run
LLP 0252 D7's wave. Both already exist. This RFC adds only the
observation that the one Clique data point was confounded by a Metro
restart that recooked binding identity, which belongs as a note on
LLP 0310, not a new document.

This document is retained unrevised as the record of the proposal and
its refutation. The reviews are the durable artifact:
[codex](./reviews/0318-one-authoring-profile.codex.md) /
[grok](./reviews/0318-one-authoring-profile.grok.md) for the
authoring-surface cluster,
[codex](./reviews/0322-tiered-diagnostic-codes.codex.md) /
[grok](./reviews/0322-tiered-diagnostic-codes.grok.md) for the
size-and-hygiene cluster, with the run journal at
[`0318-one-authoring-profile.run.md`](./reviews/0318-one-authoring-profile.run.md).

Everything below is the original text as reviewed. Its claims were not
corrected; several are false and are enumerated above.

## Summary

Snapback ships two authoring profiles. `snapback-explicit-v1` is the
default; `snapback-familiar-ts-v1` is marked experimental and the guide
actively steers agents away from it. The most recent cross-backend
benchmark inverts that ranking: the familiar lane completed every
milestone and the explicit lane did not.

This RFC proposes converging on **one** authoring profile, shaped like
familiar, with the explicit profile's broader vocabulary reachable from
inside it. It does not propose deleting capability. It proposes that
there stop being two spellings of the same app.

The claim this document makes is about *cost*, not about a proven
ergonomic win. N=1 lane evidence cannot license "familiar is better."
It can license "we are paying for two surfaces and defaulting to the one
that lost the only head-to-head we ran."

Confidence in the direction is **0.7**. The least certain part is
whether the declarative vocabulary (routes, cron, search/vector,
mutation plans) has a natural familiar-profile spelling, or whether
convergence quietly forces those features into a second-class position.
§4 treats that as the load-bearing open question.

## 1. Evidence

### 1.1 The benchmark

[LLP 0310](./0310-published-0127-clique-dx-friction.research.md) records
the 2026-08-25 Clique run against published 0.1.27, four cold lanes,
milestones M1–M3:

| Lane | M1 | M2 | M3 |
|---|---|---|---|
| Snapback explicit | green | capability-failure | blocked |
| Snapback familiar | green | green | green |
| Convex 1.45.0 | green | green | suite pass; typing choreo fail |
| Supabase 2.112.4 | green | green | green |

LLP 0310 is explicit that this is N=1 calibration evidence under
LLP 0201 D5 and not a magnitude claim. This RFC inherits that limit.
The explicit lane died on `SNAPBACK_APP_BINDING_IDENTITY_MISMATCH` after
a legal additive schema successor — a paved-loop defect owned by
[LLP 0310.000](./0310.000-successor-identity-and-paved-loop-repair.rfc.md),
not a property of the explicit *vocabulary*. So the run is not clean
evidence that explicit authoring is worse; it is evidence that the
default lane is where the unrepaired paved-loop cost lands.

That distinction matters for sequencing (§5) and is the reason this RFC
does not claim the benchmark settles the question.

### 1.2 The steering

- `guide/start/mental-model.md` closes with a stop-fence: "Familiar
  `query()` / `useQuery` (the TypeScript `schema.ts` profile) is an
  experimental, non-default surface. If you are writing either without an
  explicit brief, return to the generated references and the
  `useSnapback*` hooks."
- `guide/backend/familiar-profile.md` is titled "Familiar TypeScript
  profile (Experimental, non-default)" and carries `maturity: partial`.
- `guide/capabilities.md` row `backend.familiar-profile-v1` is
  `partial`, `targets: local`.

A cold agent reading the LLP 0259 first-read budget is therefore routed
to explicit by construction.

### 1.3 The duplication

Two profiles are visible at every layer:

| Layer | Explicit | Familiar |
|---|---|---|
| Schema | `snapback/schema.mjs` | `snapback/schema.ts` |
| Functions | `functions.mjs` declaring into `handlers.mjs` | top-level modules; exports become `api.todos.*` |
| React | `useSnapbackQuery` / `useSnapbackMutation` (`packages/snapback-react/implementation.mjs`) | `useQuery` / `useMutation` / `useAction` (`packages/snapback-react/familiar.mjs`) |
| Codegen | `snapback-explicit-v1` | `snapback-familiar-ts-v1` |
| Guide | most of `guide/backend/` | `guide/backend/familiar-profile.md` |

`guide/backend/familiar-profile.md` states that mixing the two is a
typed refusal, so this is not one surface with two entry points — it is
two closed worlds selected by `authoringProfile` in
`snapback/codegen.policy.json`.

### 1.4 The indirection the explicit profile requires

From `demos/todo/snapback/functions.mjs`:

```js
export const setCompleted = defineJsMutation({
  args: { id: v.string(), completed: v.boolean() },
  source: 'handlers.mjs',
  exportName: 'setCompleted',
  reads: ['todos'],
  writes: ['todos'],
});
```

and from `demos/todo/snapback/handlers.mjs`:

```js
globalThis.__snapbackHandlers = {
  async setCompleted(ctx, args) { /* ... */ },
};
```

A function is declared in one file and implemented in another, bound by
a string pair (`source`, `exportName`), in a module that has no exports
and instead assigns a global. Familiar's "a module's exports become
`api.<module>.*`" removes all four of those moving parts. This is the
sharpest single ergonomic difference between the profiles and it is
independent of the benchmark.

## 2. Proposal

**One profile.** The surviving surface is familiar-shaped:

1. Top-level TypeScript (or JavaScript) modules under `snapback/`.
   Exported function values become `api.<module>.<export>`.
2. `schema.ts` / `schema.mjs` keeps the shared
   `defineSchema`/`defineTable`/`v` vocabulary — that half is already
   common to both profiles.
3. `query` / `mutation` / `action` constructors, with the full
   declarative vocabulary reachable as options rather than as a
   different profile (see [LLP 0319](./0319-one-query-constructor.rfc.md),
   which does the constructor-count work this RFC depends on).
4. React exposes one hook family. The `useSnapback*` names either become
   the family or become aliases; §4 OQ3 holds that choice open.
5. `authoringProfile` in `snapback/codegen.policy.json` remains, but as a
   *legacy pin* rather than a fork in the road.

**Explicit becomes a compatibility mode, then a tombstone.** It is not
deleted at convergence. It is frozen: no new vocabulary, no new guide
pages, no new templates.

## 3. What this does not do

- **It does not delete the declarative vocabulary.** Mutation plans,
  `defineRoutes`, `defineCron`, search/vector queries, and the analyzable
  HostPlan subset are capability, not profile. They must survive the
  convergence with a familiar-profile spelling. If they cannot, this RFC
  is wrong and should be withdrawn.
- **It does not make Convex compatibility a target claim.** LLP 0252
  already ruled the familiar profile is a source adapter over Snapback's
  canonical owners, not a second backend. Convergence does not change
  that; it removes the adapter's "alternative" framing.
- **It does not repair the paved loop.** LLP 0310.000 owns that. If the
  successor-identity defect is unfixed, converging simply moves the
  failure onto the surviving lane.
- **It does not claim a measured ergonomic win.** See §1.1.

## 4. Open questions

- **OQ1 — Does the declarative vocabulary have a familiar spelling?**
  The load-bearing question. `guide/backend/familiar-profile.md`
  currently justifies the explicit default precisely by "declarative
  plans, routes, cron, search/vector, and effectful actions." A
  convergence that demotes those is a capability regression wearing an
  ergonomics costume. Needs a worked design, not an assertion.
- **OQ2 — Does authority/visibility declaration survive?** The explicit
  profile's `authScopeField`, `.visibility({...})`, and the
  `authorization-review.json` projection are how LLP 0304's agent-safe
  schema posture is enforced. Familiar must carry the same facts or the
  safety story weakens. Related: LLP 0246 handler-module custody.
- **OQ3 — Hook naming.** One family, but which names? `useQuery` reads
  better and matches the ecosystem; `useSnapbackQuery` is unambiguous in
  a file that also imports React Query or Convex. A wrong choice here is
  cheap to change and should not block the rest.
- **OQ4 — Migration for existing apps.** Every demo under `demos/`, the
  templates under `packages/snapback-cli/templates/`, and the fixtures
  under `tests/fixtures/` are explicit-profile. Is there a codemod, or is
  the answer "explicit keeps working, new work is familiar"?
- **OQ5 — Does convergence need to wait for LLP 0310.000?** §5 assumes
  yes. Argue it.

## 5. Sequencing

1. LLP 0310.000 lands the successor-identity repair. Until then, the
   default lane's failure mode is unrepaired and any profile comparison
   is confounded.
2. Rerun the Clique matrix with both lanes on the repaired loop. If
   explicit still loses on authoring cost with the paved-loop defect
   removed, the evidence for convergence is real rather than inherited.
3. Resolve OQ1 with a worked design for the declarative vocabulary.
4. Only then flip the default and re-title the guide pages.

Steps 1–3 are cheap relative to the convergence itself, and step 2 is
the difference between this RFC being evidence-backed and being a
plausible story. Do not skip it.

## 6. Cost if adopted

Roughly: one codegen profile retired, one React hook family retired,
`guide/backend/familiar-profile.md` folded into the main backend pages,
the LLP 0259 stop-fence deleted, and the demo/template/fixture corpus
migrated. The migration is the bulk of it and is mechanical but wide.

## 7. Cost if not adopted

Every subsequent surface change is authored twice, documented twice,
tested twice, and diagnosed twice, and the LLP 0259 first-read budget
keeps spending itself explaining that there are two ways to do this.
LLP 0127's stated aesthetic — "few mechanisms, many fronts" — is not
compatible with two authoring profiles as a steady state.
