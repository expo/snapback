# Grok review — LLP 0253 r2 (delta)

**Reviewer family:** Grok
**Provider / runtime:** Grok 4.6 in Grok Build (interactive session)
**Date:** 2026-08-13
**Redacted:** no
**Method:** independent delta review of r2 against the two r1 NOT READY
artifacts and against the cwd code. This session did not author LLP 0253.
This is not a mutually-blind review: both r1 reviews were read, as
required for a closure check. Focus is (a) whether each r1 MATERIAL is
actually closed by the r2 text, and (b) defects introduced by the r2
revisions themselves.

- **Target under review:** `llp/0253-familiar-profile-v1-api.spec.md`,
  43,633 bytes, SHA-256
  `a0bceb70448406c734122f673f115646fb881424e0fa00a6731e5355088be2dd`.
  Status: Draft, revision r2. Hash and byte count verified on disk
  before the verdict.
- **Governing law read in full:**
  `llp/0252-convex-familiar-authoring-profile.rfc.md` (SHA-256
  `0ec9e231c652d55bf06cb16b6f7eb53e042673509043ad029f40d77514bea46f`;
  on-disk **Status: Review**, r5 header still marks r5 unreviewed).
- **r1 artifacts read:**
  `llp/reviews/0253-familiar-profile-v1-api.codex.md` (7 MATERIAL),
  `llp/reviews/0253-familiar-profile-v1-api.grok.md` (5 MATERIAL).
- **Code checked (r2 claims and lowering targets):**
  `packages/snapback-codegen/define.mjs` (JS query result admission
  3625–3632, mutation/action 4349–4354 / 4400–4405, `v.array` 551–561,
  `results.records` 586–618, `results.value` 624–627),
  `packages/snapback-codegen/declaration-suggestion.mjs`
  (`topLevelContract` 922–978, `resultDeclarationSource` 1019–1021),
  `packages/snapback-codegen/semantic-generation.mjs`
  (`canonicalGenerationJson` 45–61, `semanticOperation` 222–248,
  `buildSemanticGenerationInputs` 307–343, `semanticId` 399),
  `packages/snapback-codegen/index.mjs` (`IDENT` 197, name validation
  3386–3394, TS member emission 13508, `export function ${fn.name}`
  11942–11949 / 12869, definition-bundle facade 15097 / esbuild
  14814–14821, string-export extraction proven by
  `identifier-validation.test.mjs` 96–108),
  `packages/snapback-codegen/contract-emitter.mjs` (`pascal` 16–19),
  `packages/snapback-codegen/result-contracts.mjs` 851–866,
  `packages/snapback-react/implementation.mjs`
  (`queryStateForConnection` 444–480, blocked classification 325–361,
  mid-subscription denial 992–1016),
  `packages/snapback-react/index.d.mts` (QueryState 151–157,
  SnapbackConnection 130–138),
  `packages/snapback-harness/ctx-bootstrap.js` (action mode 862–867,
  981–1030, 1053–1188),
  `src/manifest.rs` 2240–2278.

---

# Delta review — LLP 0253 r2

## Overall assessment

r2 is a real revision, not a mention-pass. The kind partition, the
decoupled normalized builder, default-omitted `authoringProfile`,
export-classified discovery, and the `status × freshness × connection`
projection are written as design, not as TODOs. Several r1 MATERIAL
items are actually closed.

It is not ready. Three r2 repairs are themselves defective against the
code they claim to bind: the S4.3 query table is still not a total
function and one listed success row cannot land on `results.records`;
the new S5.2 preimage still drops 0252-required behavior-bearing facts;
and the S4.4 “every effectful host operation is unreachable” close of
the undeclared-effect hole is false of the shipped action ctx. Each
would produce a wrong adapter, a false equivalence witness, or a
D2/Acceptance 3 hole.

## r1 MATERIAL closure

| r1 finding | Closed by r2 text? |
| --- | --- |
| Codex 1 — 0252 claimed Accepted | **Closed** as a truthfulness defect. Related line no longer says Accepted. Residual process tension is MINOR. |
| Codex 2 / Grok 2 — cross-profile witness (names, `graphRecords`, `operationId`) | **Architecture closed.** Names admitted as `IDENT.IDENT`; explicit spelling via string export names; preimage is no longer `semanticInput` minus two keys; `graphRecords`/`behavior`/`operationId` are out by name. Residual field-closure holes are Finding 2. |
| Codex 3 — plans and secrets omitted | **Named close.** `secrets` and `plan` are in the enumerated preimage. Residual omissions (`stream`, `runtime`, …) are Finding 2. |
| Codex 4 / Grok 1 — kind-blind `returns` | **Kind partition closed.** Query list vs mutation/action single-value matches `define.mjs` 3625–3632 / 4349–4354 / 4400–4405 and `topLevelContract` 922–978. Query-table totality and the `records` bounds row are **not** closed (Finding 1). 0245 `returns:` patch key is specified. |
| Codex 5 — effects disappear, fetch remains | **Mentioned, not closed.** Stubs cover `fetch` / `fetchStream` / push only. Finding 3. |
| Codex 6 — missing disposition table | **Closed.** Appendix A is a real four-disposition seed. Residual `outgrewIr` is MINOR. |
| Codex 7 — `compatibilityAliases` overstated | **Closed.** Ground truth 9 is corrected to one row; Phase C adds the rest as data. |
| Grok 3 — S6.2 vs QueryState | **Closed.** Projection requires `connection = 'live'` for data; transport-held `freshness: 'current'` is `undefined`; mid-subscription denial is `undefined`; Phase C names the two r1 scenarios. |
| Grok 4 — S2 helper contradiction | **Closed.** Classification is by exports; helpers are admitted; nested function exports refuse. |
| Grok 5 — S1.2 identity rotation | **Closed.** Default-omission is implementable against `canonicalGenerationJson` (see S1.2 check below). |

r1 MINOR items 6–13 (Grok) and Codex 8 are addressed in r2 text
(aliases, mixing/`routes.mjs`, `_generated/server` bootstrap, D7
scaffold-writes-policy, `retainable`, `effects` := declared ceiling,
ground-truth `db` vs facade). Residual notes are below.

## Strengths of r2

- **S1.2 default-omission is the right identity rule and matches the
  hasher.** `canonicalGenerationJson`
  (`semantic-generation.mjs` 45–61) emits every own enumerable key and
  **throws** on `undefined`. `semanticId` hashes that object whole
  (399). Adding `authoringProfile` only when the value is not
  `snapback-explicit-v1` (0253:143–151) keeps every existing explicit
  `semanticInput` byte-identical. Emitting the key as `undefined` would
  not. D1’s two-profile distinction still holds: familiar generations
  carry the field.
- **S6.2 now implements D4 against the shipped union.**
  `queryStateForConnection` (implementation.mjs 467–479) keeps `data`
  and `freshness: 'current'` on non-`live` connections and only demotes
  **status**. r2’s predicate (`status ∈ {ready, refreshing}` ∧
  `freshness = 'current'` ∧ `connection = 'live'`) is the only reading
  that does not present last-authoritative rows as live `Result`.
  Connection `error`/`closed` (447–465) and authenticated
  mid-subscription denial (992–1016) are pinned to `undefined`, not
  throw. That is the r1 failure mode, actually repaired.
- **String export names are extraction-feasible.** The definition
  facade does `import * as definitions` + `Object.keys`
  (`index.mjs` 15097). `identifier-validation.test.mjs` 96–108 already
  drives `export { q as '../evil' }` through esbuild IIFE into
  `IDENT.test` (3386–3394). Admitting `IDENT.IDENT` is a validation +
  emission change, not a new bundle protocol.
- **S2 export classification, S4.2 auth verbatim, S4.5 no-drop
  `withIndex`, S6.5 identity re-export, r5 skip / `runMutation`-only
  seam (as a *stated* pin), Appendix A, and the 0245 `returns:`
  renderer obligation** are sound and honestly disclosed.

## Findings

### 1. MATERIAL, IN-DELTA — S4.3 query table is still not a total lowering, and one listed success row is unimplementable against `results.records`

r2 replaced the kind-blind map with a kind-indexed table and put
`v.doc | v.null` / bare `v.object` on the query refuse set. The kind
split itself is correct:

| Kind | Admitted `result:` | Evidence |
| --- | --- | --- |
| Query / LiveQuery | `documents` / `records` / legacy `v.object` | `define.mjs` 3625–3632; `result-contracts.mjs` 857–861; `topLevelContract` 926–978 |
| Mutation / Action | `document` / `value` | `define.mjs` 4349–4354, 4400–4405 |

The mutation/action side is a total partition (bare `v.doc(t)` vs any
other doc-containing shape vs pure values). The **query** side is not.

**Listed row that cannot land.** S4.3 (0253:305):
`v.array(v.object({...}))` → `results.records({...})`, “carrying
`minItems`/`maxItems` when authored.”

- Familiar `v.array` accepts **only** `{maxItems}`
  (`define.mjs` 551–561). There is no authored `minItems`.
- `results.records` treats any bound as a pair and requires
  **both** `minItems` and `maxItems` as safe integers
  (`define.mjs` 602–611). `{maxItems: 50}` alone throws.

Concrete familiar query:

```ts
export const page = query({
  args: {},
  returns: v.array(v.object({ title: v.string() }), { maxItems: 50 }),
  auth: "authenticated",
  reads: ["todos"],
  handler: async (ctx) => ctx.db.query("todos").take(50).collect(),
});
```

An implementer who follows the table calls
`results.records(v.object(...), { maxItems: 50 })` and the constructor
refuses. Synthesizing `minItems: 0` is the honest lowering (`v.array`
has no lower bound) but is a new fact the spec does not pin — and
“never approximates” (0253:327) forbids inventing it. Refusing the
shape would also be honest, but then the row is wrong.

**Unlisted query shapes.** The query table’s catch-all is “any
non-array shape” (0253:308). These arrays have no row:

- `v.array(v.string())`, `v.array(v.id(t))`, `v.array(v.union(...))`
  of non-records, nested arrays;
- `v.array(v.union([v.object(...), v.object(...)]))` (the constructor
  **does** admit a union of closed records — `define.mjs` 589–598 —
  and `topLevelContract` would invert it to `results.records`);
- `v.tuple([v.doc(t)])`. `topLevelContract` 939–947 explicitly
  admits a 1-tuple of `v.doc` *or* `v.object` and emits
  `results.records(..., {minItems:1, maxItems:1})`. r2 claims to
  match those rules (0253:296–298) and then lists only
  `v.tuple([v.object({...})])`.

`v.array(v.string())` cannot go to `results.records` (not
object/doc/union-of-those) and cannot go to `results.value`
(queries refuse it). The only lawful destination is
`SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE`. The spec does not
say that. An implementer who “helps” will either crash at
`jsQueryDef` or wrap a scalar list as records (cardinality/shape lie)
— the r1 failure class, reintroduced inside the query table.

**Resolve:** make the query table a total function over `v.*` with an
explicit “any other shape → refuse” row. Pin
`v.array(v.object(...), {maxItems: N})` →
`results.records(..., {minItems: 0, maxItems: N})` (synthetic
`minItems: 0` is not a dropped fact) **or** refuse bounded
object-arrays. Add `v.tuple([v.doc(t)])` and `v.array(v.union` of
closed records) as success rows if the claim to match
`topLevelContract` stands. Keep the `get` / scalar-query refusal;
that part is honest.

### 2. MATERIAL, IN-DELTA — S5.2’s new enumerated preimage still drops 0252-required behavior-bearing facts

r2 correctly abandoned “`semanticInput` minus two keys.” The new
builder, the `excludedFields` list, and putting `secrets`/`plan` in
are the right shape. The enumeration is still not the Terminology
closure (0252:187–193): *all* behavior-bearing fields enter;
exclusions are each named.

**In the per-operation row (0253:447–454), missing with no named
exclusion:**

| Fact | Why it must enter | Where it lives today |
| --- | --- | --- |
| `stream` | Grok r1 resolve named it; two actions that differ only in `stream: true` are not the same contract | function manifest `index.mjs` 4815, 9510, 9519; **not** in `semanticOperation` 222–248 |
| `runtime` (LLP 0249 authored profile) | 0252 Terminology lists “capability/runtime profiles” | Appendix A disposition 4 for familiar; the witness is for **both** profiles (0253:481–482) |
| `delivery` | 0252 names it; S4.6 makes it constructor-choosing | not listed. Plausible encoding is canonical `operationKind` (`Query` vs `LiveQuery`) + `syncabilityClass` (`jsQueryDef` 3653). **Neither enum is pinned.** If `operationKind` is the familiar constructor name `query`, live vs `delivery: "read"` collide. |
| `sequences`, `boundedSkew` | mutation contract facts; disposition 4 for familiar, live on explicit JS/plan mutations | `index.mjs` 4791, 9511–9512 |

**In the application block (0253:443–446), missing:**

- `authorityProfile` — sibling of `schema` in `semanticInput`
  (`semantic-generation.mjs` 326–328), not inside `schema`.
- asset-upload intents — `semanticInput.assets`
  (`semantic-generation.mjs` 330), distinct from `schema.assets`.

`secrets` and `plan` being in does **not** make the witness
0252-complete. Concrete collision: two explicit actions equal on the
listed fields, one with `stream: true` (`index.mjs` 4815), hash
equal. That is the Codex r1 #3 class, unfixed by the r2 list.

Name equality via `export { listImpl as "todos.list" }` is a valid
close of the *name* half of Codex 2 / Grok 2 **if** Phase B’s quoting
sweep is real (MINOR 5). It does not excuse an incomplete preimage.

**Resolve:** freeze the preimage as a checklist against the function
manifest + `semanticInput` top-level (not against
`semanticOperation`, which is the thing Ground truth 8 says is
missing `uses`). Include `stream`, authored `runtime`, a pinned
delivery encoding (canonical `Query`/`LiveQuery` plus
`syncabilityClass`, or a named `delivery` field), `sequences`,
`boundedSkew`, `authorityProfile`, and asset intents — or name each
omission in `excludedFields` with a reason that survives 0252
Terminology. Golden vectors must include a `stream` pair and a
`delivery: "read"` vs default-live pair.

### 3. MATERIAL, IN-DELTA — S4.4’s undeclared-effect close is false of the shipped action ctx

Codex r1 #5: familiar actions receive effectful ctx with no `effects`
key. r2’s repair (0253:357–365, revision note) stubs `ctx.fetch`,
`ctx.fetchStream`, and push, then concludes “every effectful host
operation is unreachable, [so] effect declarations are never needed”
and puts `effects` at disposition 4.

The shipped action ctx (`ctx-bootstrap.js` 981–1188) also attaches,
in action mode only:

| Host op | Lines | Stubbed by S4.4? |
| --- | --- | --- |
| `ctx.fetch` / `ctx.fetchStream` | 1028–1053 | yes |
| `ctx.push.send` / `audience` | 1004–1016 | yes |
| `ctx.realtime.hasFreshClient` | 990–994 | **no** |
| `ctx.streamAttempt.start/settle` | 1175–1181 | **no** |
| `ctx.stream.emit` | 1185–1188 | **no** |

S4.4 says the facade is “allowlist-built” and then lists the deltas
(runMutation ref form, three stubs, `db` absent). It never enumerates
the positive own-property set. The natural wrap-and-override
implementation — start from the canonical action ctx, replace the
listed keys, delete `db` — leaves `realtime`, `streamAttempt`, and
`stream` live.

Concrete familiar action that then executes an undeclared host
effect:

```ts
export const poke = action({
  args: { principalId: v.string() },
  returns: v.null(),
  auth: "authenticated",
  handler: async (ctx, { principalId }) => {
    await ctx.realtime.hasFreshClient({ principalId });
    ctx.stream.emit({ ok: true });
    return null;
  },
});
```

That is D2 / Acceptance 3 (0252:353–367, 957–962): effect facts
cannot disappear, and are never inferred. Disposition 4 is only
lawful if the operations are actually unreachable.

**Resolve:** publish the complete facade allowlist as own-property
names (auth / runtime / refuse / isDirectHuman / runMutation / the
stubs / whatever else is intentional). Stub or omit `realtime`,
`streamAttempt`, and `stream` with
`SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED`. Phase B own-property
tests must fail if any unlisted host op is enumerable. Until that
list is in the spec, the r2 sentence “every effectful host operation
is unreachable” is false.

### 4. MINOR, PRE-EXISTING — on-disk 0252 is still Review

r2 no longer writes “LLP 0252 (Accepted)”. The summary (0253:31–33)
says a 2026-08-13 build directive accepted the RFC and that the
status change “lands with this Spec.” The file on disk is still
`**Status:** Review` with “r5 is unreviewed” (0252:4, 10, 1069).
Not a false present-tense claim about the file; still a provenance
mismatch until 0252’s header moves in the same program.

### 5. MINOR, IN-DELTA — dotted-name emission is broader than “quote TypeScript members”

String-export extraction works (see Strengths). Rust lookup is
name-agnostic (`manifest.rs` 2240–2244). Filenames
`${fn.name}.query.ts` (`index.mjs` 13678) are safe for `IDENT.IDENT`
(`todos.list.query.ts` is not a traversal).

Quoting is not sufficient at these sites:

- `export function ${fn.name}(` — `index.mjs` 11942–11949.
  `export function "todos.list"(` is a syntax error. The rewrite is
  `export { impl as "todos.list" }` (or an equivalent quoted binding),
  not quotes around a declaration name.
- `export const ${name} = app.api.${kind}.${name}` — `index.mjs` 12869.
  Both the binding and the member access must change
  (`app.api.queries["todos.list"]`).
- `descriptors.${fn.name}` — `index.mjs` 11943. Unquoted, this is
  nested `descriptors.todos.list`, not a dotted key.
- `pascal("todos.list")` → `TodosList` (`contract-emitter.mjs` 16–19),
  colliding with `todosList` / `todos_list`. Provider introspection
  already refuses some pascal collisions
  (`PROVIDER_INTROSPECTION_BINDING_TYPE_COLLISION`); the familiar
  name-grammar extension needs the same gate on the function
  namespace.

Phase B’s “quoting sweep” is the right obligation; the spec should
name declaration-form rewrite and a pascal-collision refusal so the
sweep does not stop at interface members (`index.mjs` 13508).

### 6. MINOR, IN-DELTA — S6.2 error-class table is promised, not enumerated

The two r1 scenarios are pinned (socket drop → `undefined`;
authenticated→denied → `undefined`). D4’s “implementations choose
nothing” still needs the closed code-class table in the spec, not
only “reviewed against the registry in Phase C” (0253:552–557).
Mid-subscription denial can arrive with `connection` still live
(implementation.mjs 1013), so the split cannot be inferred from the
connection axis alone. Not MATERIAL: the required outcomes are
written; the code list is missing.

### 7. MINOR, IN-DELTA — Appendix A seed misses `outgrewIr`

`defineJsMutation` admits `outgrewIr` (`define.mjs` 4356–4368).
Appendix A has no row. The Phase A generated gate is the backstop
(0253:700–703); add the seed row (disposition 4, JS-tier marker,
explicit-profile route) so the authored table is not already missing
a closed constructor key.

### 8. MINOR, IN-DELTA — explicit-side mixing detection is underspecified

S1.1 (0253:136–138) refuses any top-level module that “exports a
familiar function value” under the explicit profile. Explicit
evaluation does not load familiar constructors. Say whether this is
an AST/brand scan or a second, capability-empty evaluation. Not a
semantic hole if they pick either; it is an implementer fork.

## r2 claims checked against code (requested sites)

| r2 claim | Code | Result |
| --- | --- | --- |
| S4.3 kind-partitioned lowering | `define.mjs` 3625–3632, 4349–4354, 4400–4405; `topLevelContract` 922–978 | Kind split **true**. Query table **not** total; bounded `records` row **unimplementable**. |
| 0245 familiar `returns:` patch | `resultDeclarationSource` still emits `result:` (1019–1021) | Spec correctly obligates a new familiar renderer. Not a present-tense lie. |
| S5.2 decoupled preimage; secrets/plan in; graphs/behavior out | `semanticOperation` 222–248 has no `uses`; `semanticInput` 324 carries `graphRecords`; implementation identity hashes `uses` (`index.mjs` 9508) | Architecture **true**. Field list **incomplete** (Finding 2). |
| S1.2 default-omission | `canonicalGenerationJson` 45–61; `semanticId` 399 | **True** if the key is absent, not `undefined`/`null`. |
| Dotted names + string exports | `IDENT` 197; reject at 3392–3394; facade 15097; test 96–108; emit 11942, 12869, 13508 | Extraction **feasible**. Emission **not** “just quote members” (MINOR 5). |
| S6.2 projection | `queryStateForConnection` 444–480; blocked 325–361; denial 992–1016; QueryState 151–157 | **True** of r2 text. Closes Grok r1 #3. |
| S4.4 facade vs action ctx | `ctx-bootstrap.js` 862–867, 981–1188 | `runMutation` / no `runQuery` / throwing `db` **true**. “Every effectful op unreachable” **false** (Finding 3). |

## r5 pins

Still present and still match the shipped code: `ctx.runMutation`
only (host op `action.runMutation`, 985–987), skip as
`Args | "skip" | typeof skip` over one sentinel, callback-`withIndex`
as total no-drop sugar. They are not the reason for NOT READY.

## Recommended next step

Revise 0253 in Draft. Do not start Phase B lowering or treat
Acceptance 3’s dual-profile witness as specified until Findings 1–3
are closed in the spec text (query-table totality + `records` bounds;
preimage checklist; complete action-facade allowlist). Findings 4–8
can land in the same revision.

VERDICT: NOT READY
