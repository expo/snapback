# Grok review — LLP 0253

**Reviewer family:** Grok
**Provider / runtime:** Grok 4.6 in Grok Build (interactive session)
**Date:** 2026-08-13
**Redacted:** no
**Method:** independent mutually-blind design review against the cwd
worktree; not a capsule review. This session did not author LLP 0253.

- **Target under review:** `llp/0253-familiar-profile-v1-api.spec.md`,
  30,813 bytes, SHA-256
  `5e5ac50defb321da7f9ead1edf6b31cc927798978fd841e7bd7797e26d059d16`.
  Status: Draft. Hash and byte count verified on disk before the verdict.
- **Governing law read in full:**
  `llp/0252-convex-familiar-authoring-profile.rfc.md` (56,862 bytes,
  SHA-256 `0ec9e231c652d55bf06cb16b6f7eb53e042673509043ad029f40d77514bea46f`;
  on-disk **Status: Review**, r5 header still marks r5 unreviewed).
- **Blindness disclosure:** no other 0253 review was read. 0252 review
  artifacts were not consulted for this verdict.
- **Code checked (cited claims and lowering targets):**
  `packages/snapback-codegen/index.mjs`,
  `packages/snapback-codegen/define.mjs`,
  `packages/snapback-codegen/semantic-generation.mjs`,
  `packages/snapback-codegen/typescript-profile.mjs`,
  `packages/snapback-codegen/client-lifecycle.mjs`,
  `packages/snapback-codegen/declaration-suggestion.mjs`,
  `packages/snapback-harness/ctx-bootstrap.js`,
  `packages/snapback-react/index.d.mts`,
  `packages/snapback-react/implementation.mjs`,
  `packages/snapback-client/index.d.mts`,
  `packages/snapback-client/reference-kinds.mjs`,
  `packages/snapback-client/diagnostic-error.mjs`,
  `packages/snapback-client/canonical-client-value.mjs`,
  `src/manifest.rs`.

---

# Review — LLP 0253: Convex-familiar profile v1 API spec

## Overall assessment

The spec is the right *kind* of document: it binds 0252's experiment to
today's codegen, handler, and React grammar, and it honestly names several
divergences from 0252's illustrations (auth spelling, `returns`→`result`,
shipped hook/verb names, `useQueryState` as an identity re-export). The
r5 pins are present in the text: `ctx.runMutation` only, skip as
`Args | "skip" | typeof skip` over one sentinel, callback-`withIndex` as
total no-drop sugar.

It is not ready to implement. Four defects would produce a wrong adapter,
a false equivalence witness, or a D4-violating alias. They are not
editorial. Each has a concrete familiar app that fails.

Ground-truth items 1–8 and 10–11 match the cited code. Item 9 overstates
what `compatibilityAliases` actually records.

## Strengths

- **r5 action seam (S4.4)** matches the shipped action ctx: string
  `runMutation` host op, no `runQuery`, reads `readonlyDenied` in action
  mode (`ctx-bootstrap.js` 862–867, 981–987). The always-throw
  `runQuery` stub is the right refusal shape.
- **r5 withIndex (S4.5)** is the correct lowering: canonical
  `withIndex` is name-only (`ctx-bootstrap.js` 636); a recorder that
  replays `eq/in/lt/lte/gt/gte` and throws on unknown/escape is
  implementable and is the only honest sugar.
- **r5 skip (S6.2)** correctly keeps one owner (the exported `skip`
  symbol at `index.d.mts` 205) and treats `"skip"` as familiar-only
  spelling.
- **Auth verbatim (S4.2)** is the right divergence. `AUTH_REQUIREMENTS`
  is `public | optional-user | authenticated` (`define.mjs` 55, 232). A
  `required-user` synonym would be a second spelling of one fact.
- **`useQueryState` identity re-export (S6.5)** is the right D4 reading.
  Reshaping onto `{data,status,freshness,diagnostic,refresh}` would be
  the forbidden second cache. The shipped union is
  `{data,status,error,connection,freshness,retention}` (`index.d.mts`
  151–157).
- **`client.query` / shipped hook names** are correctly pinned against
  `index.d.mts` 1629 and 1776–1787 and against the single shipped
  `compatibilityAliases` row (`client-lifecycle.mjs` 227–232).
- **S5.4 no-branch gate** and **S5.3 profile admission before transport**
  match D1. Store keys will not rotate merely from extra ref fields:
  `canonicalReactStoreKeyV1` hashes a closed 8-field subset
  (`canonical-client-value.mjs` 218–228).

## Findings

### 1. MATERIAL — S4.3 `returns` lowering is kind-blind and unimplementable against the real `results.*` partition

S4.3 (0253:264–274) is specified as one total map from familiar `v.*`
shapes to canonical `result:` contracts. The shipped constructors are
**kind-partitioned**:

| Lowering target | Query / LiveQuery (`define.mjs` 3625–3632) | Mutation / Action (`define.mjs` 4349–4354, 4400–4405) |
| --- | --- | --- |
| `results.documents` / `results.records` / legacy row `v.object` | admitted | refused |
| `results.document` / `results.value` | refused | admitted |

The existing LLP 0245 inverter already knows this (`declaration-suggestion.mjs`
`topLevelContract`, 922–978): a query must return an **array** (or a
1-tuple that becomes `results.records(..., {minItems:1, maxItems:1})`);
a non-array query return is
`SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED`. A mutation point-read
becomes `results.document` / `results.value`.

S4.3 ignores that partition:

- `v.doc(table)` → `results.document(table)` is legal only on
  mutation/action. A query `get` cannot take it.
- `v.array(v.doc(table))` → `results.documents(table)` is legal only on
  query. A mutation cannot take it.
- `v.object({...})` → `results.records` / `results.value` “per canonical
  rules” names two incompatible targets. `results.records` is a **list**
  contract (`define.mjs` 586–618, optional `minItems`/`maxItems`).
  `results.value` is refused on queries. The only honest single-record
  query form in the shipped analyzer is
  `results.records(v.object(...), {minItems:1, maxItems:1})` from a
  1-tuple return, not a bare object.
- “any other pure value validator (`v.string()`, `v.id(t)`, `v.union`, …)
  → `results.value(validator)`” is refused on every query.

OQ1 only asks whether `v.object` fits `records` vs `value`. It does not
admit the kind partition the code already enforces.

**Failure — Convex-shaped point read (authorization-adjacent):**

```ts
export const get = query({
  args: { id: v.id("todos") },
  returns: v.union(v.doc("todos"), v.null()),
  auth: "authenticated",
  reads: ["todos"],
  handler: async (ctx, { id }) => ctx.db.get("todos", id),
});
```

S4.3 sends this to `results.value(...)`. `jsQueryDef` rejects that
result. `results.records` will not accept a `doc|null` union
(`define.mjs` 589–598 requires object / `v.doc` / union of those). There
is **no** canonical JS query contract for “one document or null”. The
adapter must either refuse the most common familiar get (crushing the
CRUD lane), change the canonical result grammar (not an adapter), or
silently wrap the value in a list contract (cardinality lie).

**Failure — cardinality drop:** `returns: v.object({ title: v.string() })`
on a query, lowered through the legacy `v.object` row validator or
unbounded `results.records`, becomes “array of those rows”. The handler
that returns one object then fails the contract, or the contract accepts
an array the handler never meant. That is a silent semantic change, not
a total lowering.

**Failure — 0245 patch key:** missing familiar `returns` is the one
suggestion-backed key (0253:283–287). `resultDeclarationSource` emits
`result: ${expression}` (`declaration-suggestion.mjs` 1019–1021) and
discovery looks for `objectMember(spec, 'result')` (258). A familiar
module would receive a `result:` patch, which S4.1 would then refuse as
`SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED`, while `returns` is still
missing. Generation cannot activate. The suggestion path as cited does
not work until the patch key and the missing-key detector are
familiar-aware.

**Resolve:** replace S4.3 with a **kind-indexed** total function that
mirrors `topLevelContract` + the constructor asserts; put
`v.doc | v.null` and bare `v.object` / `v.doc` on queries in the
unlowerable set *or* propose a canonical grammar extension (owned
outside this adapter) before claiming totality; pin the 0245 patch as
`returns:` and teach discovery to see that key. Golden vectors must
include `get` and a single-object query, not only the 0252 list/create
examples.

### 2. MATERIAL — S5.2 preimage makes 0252 Acceptance 1 unsatisfiable (and drops secrets)

S2 rule 2 (0253:151–157) fixes familiar identity as
`todos.ts` + `list` → operation name `todos.list`, functionId
`"<appId>:todos.list"`. Explicit identity remains a single IDENT
export (`index.mjs` 197, 3392–3394): `list` → `"<appId>:list"`. There
is no familiar spelling that emits a flat name (every function module
contributes exactly one `.` separator) and no explicit spelling that
admits a dot.

S5.2 then puts `operationId` in the normalized per-operation record
(0253:359–361) and defines the preimage as “existing `semanticInput`
minus `behavior` and `authoringProfile`” with
`excludedFields: ["behavior", "authoringProfile"]` (0253:354–365).

`semanticOperation` already carries `operationId` and `operation`
(`semantic-generation.mjs` 222–248). `semanticInput` also carries
`graphRecords` (307–324, 293–294) — handler graphs with
`canonicalExecutableAstDigest`. Those are not in `excludedFields`.

0252 Acceptance 1 / 0253 Acceptance 3 require a dual-profile todo
fixture with **equal** `normalizedContractId` for the intended-equal
facts and **distinct** LLP 0241 identities.

**Failure — names:** idiomatic explicit `list` vs familiar `todos.list`
produce different `operationId`s. If `operationId` enters the hash,
`normalizedContractId` cannot match. 0252 Terminology lists operation
kind, delivery, retention, secrets, capability/runtime — **not**
nominal name — as the behavior-bearing closure. 0252 D2 says
`api.todos.list` is a generated *alias* over a nominal reference, “not
… new operation identities.” S2 makes the path the identity anyway, then
hashes it.

**Failure — graphs:** a TS module tree under `_generated/` vs
`functions.mjs` cannot have equal `graphRecords`. Including them makes
the witness a restatement of executable identity, which S5.2 just
excluded `behavior` to avoid.

**Failure — secrets:** 0252 Terminology requires secrets to enter
`normalizedContractId`. `semanticOperation` has no `uses` field
(`semantic-generation.mjs` 222–248) even though the function
implementation identity hashes `uses` (`index.mjs` 9508). Copying
`semanticInput` minus two fields **inherits** that omission. Two
actions that differ only in `uses: ["STRIPE_KEY"]` would compare equal.
That is a silent drop of a named behavior-bearing fact.

**Resolve:** freeze an enumerated normalized field list that is *not*
“semanticInput minus two keys.” Exclude `operationId` / `operation` /
`graphRecords` (keep them as aliases / executable witnesses). Include
`uses`/secrets, `stream`, and any other manifest fact 0252 names.
State how the dual-profile fixture is allowed to differ in names
without failing the witness. OQ2 cannot remain a maybe-encoding after
S2 has already committed `"<appId>:todos.list"` as the stored id.

### 3. MATERIAL — S6.2 projection does not implement D4 against the shipped QueryState grammar

S6.2 (0253:430–446) maps only `{status, freshness}` and then *claims*
“authority transitions and transport loss surface through
`pending`/`blocked`/freshness-downgrade and therefore project to
`undefined`.” That claim is false of `queryStateForConnection` and of
authorization-denial publication.

Shipped union (`index.d.mts` 151–157): `refreshing` may carry
`freshness: 'current'`; `ready` is not the only current-data state.
`queryStateForConnection` (`implementation.mjs` 444–480):

- `connection !== 'live'` with a ready/refreshing snapshot keeps
  `data` and keeps `freshness` (often `'current'`), and only demotes
  **status** to `'refreshing'`.
- `connection === 'error'|'closed'` becomes `status: 'error'`
  (447–465).

S6.2 row `refreshing` + `current` → `data`. So a disconnect or poll
with last-authoritative rows is presented as `Result`.

D4 requires “transient transport loss without current authority →
`undefined`” and describes the alias as *online* authoritative
convenience. The spec’s own prose agrees, then the table contradicts
both.

**Failure — transport loss presented as current:**

1. Familiar `useQuery(api.todos.list, {})` returns the live array.
2. The socket drops. Canonical state:
   `{status:'refreshing', freshness:'current', connection:'disconnected', data: rows}`.
3. Familiar `useQuery` still returns `rows`.
4. The UI / agent treats them as live current data and mutates from
   them. That is the stale-as-current class D4 exists to forbid.

A `connection === 'error'` blip instead **throws**
`SnapbackDiagnosticError` during render (S6.2 error row), unmounting
the tree through the documented boundary — also not D4’s `undefined`.

**Failure — mid-subscription revocation throws:**

D4: a continuing subscription that loses authority enters a stable
unavailable state (`undefined`); a fresh one-shot surfaces the typed
refusal. Only *anonymous* + `authenticated` ref + 401/403
`SNAPBACK_AUTH_REQUIRED` becomes `blocked` (`implementation.mjs`
335–361, 998–1006). A bearer/custody transition for a previously
authenticated user is published as `status: 'error'` (992–1016), with
an explicit comment that this is a renderable denial on the error
axis. S6.2 throws. The continuing subscription does not go
`undefined`.

**Resolve:** make the projection table total over the *real* axes
`status × freshness × connection × reason`, not the RFC’s schematic
rows. At minimum: non-`live` connection with no live current authority
→ `undefined`; mid-subscription authorization denials that are not
error-class contract failures → `undefined` + the `useQueryState`
diagnostic; keep throw for sealed/contract/handler failures. Add
adversarial Phase C tests for disconnect and for authenticated→denied
while the hook is mounted. Retract the sentence that transport loss
and authority transitions already fall out of the current rows.

### 4. MATERIAL — S2 discovery rules make shared helpers either refused or contradictory (0252 Acceptance 6)

S2 rule 1 (0253:142–150): every top-level `.ts`/`.mts` except
`schema.ts` and `_generated/` **is** a function module; subdirectories
refuse `SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED`.

S2 rule 3 (0253:158–165): every named export of a function module must
be a familiar function; a file is a function module **iff** it exports
at least one familiar function; helper modules (no familiar exports)
are admitted under LLP 0237.

Those rules cannot be true together.

**Failure — shared helper:**

`snapback/helpers.ts` exporting `requireOwner`:

- Rule 1 classifies it as a function module → `requireOwner` is not
  `query`/`mutation`/`action` → `SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED`.
- Rule 3 classifies it as a helper → admitted.

`snapback/lib/helpers.ts` (the Convex-shaped layout) is refused by
rule 1’s subdirectory ban.

Same-file unexported helpers survive, but Acceptance 6 (“normal `.ts`
helper composition”) is the shared-module case. An implementer who
implements rule 1 first ships a helper-hostile adapter; one who
implements rule 3 first ships a different product than rule 1
describes.

**Resolve:** drop “every top-level file is a function module.” Pin
classification as: reserved names refuse; a file is a function module
iff it exports at least one familiar function value; files that export
none are helpers under 0237; decide explicitly whether `lib/` is a v1
exception or stays refused. Add a dual-module helper fixture to Phase B.

### 5. MATERIAL — S1.2 adds `authoringProfile` to `semanticInput` without pinning default-omission (fleet-wide identity rotation)

S1.2 (0253:113–117) puts a new `authoringProfile` field on the
`semanticInput` object built by `buildSemanticGenerationInputs`
(`semantic-generation.mjs` 307–343). `semanticId` is
`generationDomainHash(GENERATION_HASH_DOMAINS.semanticId, semanticInput)`
(399). `canonicalGenerationJson` includes every own enumerable key
(45–61).

If Phase A always emits `authoringProfile: "snapback-explicit-v1"` for
existing apps, **every** current `semanticId` / `generationId` rotates
on the first generate after landing, before any familiar app exists.
0252 D1 wants the profile in semantic identity so the *two profiles*
differ. 0252 D8 describes rotation as a consequence of **profile
migration**, not of introducing the field. The spec does not say
“omit the key when the value is the historical default.”

**Failure:** a production explicit app regenerates after Phase A. Same
source, same contracts, new `semanticId`. Subscriptions, activation
fences, and custody records treat it as a new generation. That is an
unstated identity break.

**Resolve:** pin default-omission (`authoringProfile` absent ⇔
`snapback-explicit-v1`) so existing hashes stay byte-identical, *or*
name a one-time identity-schema bump with 0241 activation consequences
and a migration note. Do not land “add the field” as an unmarked
preimage change.

## MINOR findings

### 6. MINOR — Ground truth #9 overstates `compatibilityAliases`

0253:67–73 lists planned aliases
`useSnapbackLiveQuery`, `useSnapbackMutationDispatch`,
`useSnapbackMutationStatus`, `useSnapbackTask`, `client.read`.
`client-lifecycle.mjs` 227–232 records **only**
`useSnapbackQuery` → `useSnapbackLiveQuery`. S6.3’s claim that JSDoc
renames “flow through data, not prose” is true only for that one row.
The other 0238 names are still prose.

### 7. MINOR — On-disk 0252 is not Accepted

0253:16 and the header treat LLP 0252 as Accepted law. The file on
disk is `**Status:** Review` and the r5 header still says r5 is
unreviewed. Provenance should match the governing document, or 0252’s
status must be updated in the same program.

### 8. MINOR — S4.1 closed key set does not pin `retainable` / `requires` (assurance)

`JS_QUERY_SPEC_FIELDS` includes `retainable`, `requires`,
`authorityIndependent`, `fieldBoundary` (`define.mjs` 130–133).
`authoredFunctionAuth` treats `requires` as auth-assurance, not target
capabilities (228–244). S4.1’s pinned matrix omits them; the “notably
unsupported” list names `capabilities`/`runtime` but not these.

A familiar live query cannot declare `retainable: true` unless Phase 0
adds a disposition-1 key. D5’s “use the canonical hook for retention”
then has nothing to retain. Pin `retainable` (and assurance `requires`)
as optional disposition-1 keys, or say outright that familiar v1
operations are never retainable and that the messaging lane must use
the explicit profile for retained reads.

### 9. MINOR — S1.1 mixing detection misses `routes.mjs`

Familiar discovery refuses `functions.mjs` / `schema.mjs` (0253:106–110)
and reserved `crons.ts`/`http.ts`. Explicit still optionally loads
`routes.mjs` (`index.mjs` 1964–1967). A familiar app with a leftover
`routes.mjs` would not generate routes and would not refuse. Fail closed
on any explicit entry module, not only the two named files.

Explicit-profile leftover `todos.ts` is also ignored unless `schema.ts`
exists (the symmetric rule is conditioned on `schema.ts`). Prefer:
explicit refuses any top-level familiar function module, not only when
`schema.ts` is present.

### 10. MINOR — First-generation `./_generated/server` is unspecified

S2.4 / S3.2 make `import { query, mutation } from "./_generated/server"`
the learned value import. The definition bundler resolves relative
specifiers to real files (`index.mjs` 14880–14891). A first generate
has no such file. Pin a bootstrap order: emit an untyped stub (re-export
of `@expo/snapback-codegen/familiar`) before definition evaluation.

### 11. MINOR — Dotted names are runtime-legal, emit-illegal; OQ2 is real

Rust lookup is `function.name == name || function.id == name` with only
a non-empty check (`manifest.rs` 2240–2278). Dots work at runtime.
Codegen IDENT and the comment at `index.mjs` 3386–3392 are the wall:
names are interpolated into `export function ${name}(`, unquoted type
members, and `${name}.query.ts`. OQ2 is the right audit. It cannot
remain open *and* have S2 commit `"<appId>:todos.list"` as the stored
id (see finding 2).

### 12. MINOR — D7 scaffold flag vs S1.1 “no CLI flag”

0252 D7: selected by “scaffold flag or configuration.” S1.1: policy
file is the only selection point, “no CLI flag.” Compatible if the
scaffold writes `codegen.policy.json` and codegen never grows a
`--profile` override. Say that. As written it reads as a silent
narrowing of D7.

### 13. MINOR — `effects` row dropped from the familiar matrix without naming the mapping

0252 D2 lists `effects` as “declared when used.” JS handlers have no
`effects` key; `computeEffectCeiling` uses `declaredReads`/`declaredWrites`
and marks JS `basis: 'declared'`. S4.1’s omission is faithful to the
code but should say so (effects := declared reach / computed ceiling),
so Phase 0 does not invent an authored `effects:` key or mark a
canonical field uncovered.

## Deliberate divergences (question d)

| Divergence | Sound? | Honestly disclosed? |
| --- | --- | --- |
| Auth enum verbatim, not `required-user` | Yes. One fact, one spelling (0203 P6). | Yes, S4.2. |
| Familiar `returns:` → canonical `result:` | The *seam* is sound and necessary (`returns` is the plan-return key on `defineMutation`/`defineAction`, `define.mjs` 4275, 4457). The *table* is not (finding 1). | The collision is disclosed; implementability is not. |
| Shipped hook names (`useSnapbackQuery`, `useSnapbackSettledMutation`, `useSnapbackCommand`) | Yes. | Yes, ground truth #9 / S6. |
| `useQueryState` identity re-export of the canonical full-state hook | Yes. A reshape would be a second cache. | Yes, S6.5. |
| `client.query` instead of `client.read` | Yes. `query` is shipped (`index.d.mts` 1629); `read` is not. | Yes, S6.5. |

## r5 pins

All three are in the spec and match the shipped code. They are not the
reason for NOT READY. The defects are S4.3 totality, S5.2 preimage,
S6.2 projection vs real QueryState, S2 helper rules, and the unstated
semanticInput rotation.

## Recommended next step

Revise 0253 in Draft. Do not start Phase B lowering until findings 1–5
are closed in the spec text. Findings 6–13 can land in the same
revision.

VERDICT: NOT READY
