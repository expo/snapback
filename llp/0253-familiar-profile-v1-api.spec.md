# LLP 0253: Convex-familiar profile v1 — API and adapter specification

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Authoring, Application data API, TypeScript,
Code generation, React, Client integration, Packaging, Documentation, Testing
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-13
**Revised:** 2026-08-21 (LLP 0295 D0.3 decision packet: new S9 records the
authoring-profile product contract for the Familiar side — one-pass clean
generation and phase parity as normative contract, the S4.3 partition pinned
against the current lowering's divergences, entrypoint/export reachability
parity including the ephemeral re-export amendment to S3.1/S3.2, feature
parity by class, profile-switch suggestion rules, template-scoped profile
choice — and the W3 vertical contract fixture catalogue. Adopted per
LLP 0295; author may revise.)
**Revised:** 2026-08-21 (qualification reconciliation: the Guide stopped
claiming direct object/nullable-document query values from lowering evidence
alone and temporarily paved a singleton relational array. This records the
shipped-evidence ceiling that the document-result parity implementation and
packed vertical fixture in the next note subsequently lift; it was not a
change to S4.3's target lowering.)
**Revised:** 2026-08-21 (document-result parity implementation: the effective
result-contract gate now admits LLP 0108 `document`/`value` carriers for Query
and LiveQuery exactly as the runtime does; unsupported mutation/action
document composites retain the earliest stable refusal with its Explicit
rewrite; the packed vertical fixture binds Guide retrieval,
clean and refused regeneration, typechecking, runtime validation, and
headless one-shot/live plus React projection)
**Revised:** 2026-08-16 (publication-closure clarification: the Experimental
native custody package is an optional config-plugin add-on, not an umbrella
dependency or re-export; LLP 0041 owns its thirteen-package publication row)
**Revised:** 2026-08-15 (removed the LLP 0255 amendment after the author
selected LLP 0254 D10 Withdraw; Familiar remains an independent profile)
**Revised:** 2026-08-15 (auth-hooks amendment, LLP 0258 Phase 0: S6.1's
closed export list gains the ordinary auth hook re-exports — see S6.1)
**Revised:** 2026-08-15 (r4: unified both authoring profiles on the canonical
`snapback/generated/` artifact directory; retired `_generated/` as a hard
diagnostic including symlinks and imports; centralized the one-segment or
`IDENT.IDENT` operation grammar across codegen and the canonical client;
replaced dotted ESM aliases in client-consumed output with namespace access;
and bound both-profile descriptor admission plus the Expo 57 Metro/Hermes
parse gate into cross-package contract tests. r5, scalar-query amendment:
LLP 0108 now admits the canonical single-value query carrier, so every exact
Familiar `v.*` query result outside the existing row-shaped translations
lowers to `results.value`; Familiar `useQuery` projects the authored value.)
**Revised:** 2026-08-15 (explicit-asset amendment: `defineAssetUpload` is a
Familiar top-level constructor; `<module>.<export>` names use the shared
operation grammar and project into both canonical asset intents and the
Familiar generated API namespace. A real MP4 upload/readback acceptance binds
the claim).
**Revised:** 2026-08-15 (LLP 0258 amendment: Familiar auth-program custody is
the inspectable `durable-required` profile default; the adapter refuses
`volatile-explicit` and shares the explicit external-session seam.)
**Revised:** 2026-08-13 (r3: dual delta-review repairs — the S4.3 query
lowering is a true partition (bounded record arrays pinned to
`{minItems: 0, maxItems}` as exact translation; record-union and 1-tuple
rows added; explicit refusal catch-all for every unlisted shape); the S5.2
preimage completed (`stream`, `sequences`, `boundedSkew`,
`standardPattern`, `authorityProfileDependence`, authored `runtime`,
canonical four-kind `operationKind`; app-level `authorityProfile` and
`assetUploadIntents`) plus a fail-closed per-field include/exclude
decision rule so future canonical fields cannot silently escape the
witness; the identity guarantee narrowed to `semanticId` (bundle and
generation ids rotate ordinarily with the new artifact, disclosed); the
S4.4 action facade is a positively enumerated own-property table
(`streamAttempt`/`stream`/`realtime`/push absent, not merely unstubbed)
and the `api`-reference composition seam gets a specified custody-bound
capture before inline extraction (the shipped lift refuses free
identifiers); the S6.2 split classifies **all** subscription-delivered
authorization denials as stable unavailability with a structural
disjointness proof instead of an underivable per-event provenance;
name-emission sweep specified (bracket access, string re-exports, safe
local bindings, pascal-collision refusal); Appendix A gains `outgrewIr`;
explicit-side mixing pinned as a static scan. r2 2026-08-13: first-round
repairs (kind partition, decoupled normalized builder, dotted names +
string export names, default-omission, export-classified discovery,
totalized `useQuery` projection, host-effect stubs, disposition appendix);
r1 2026-08-13. Reviews: r1 + r2-delta artifacts under
`llp/reviews/0253-familiar-profile-v1-api.*`; both families NOT READY on
r1 and r2; every r2-delta MATERIAL is addressed in r3.)
**Related:** LLP 0252, LLP 0237, LLP 0238, LLP 0241, LLP 0242, LLP 0245,
LLP 0246, LLP 0247, LLP 0248, LLP 0249, LLP 0218, LLP 0225, LLP 0108,
LLP 0127, LLP 0130, LLP 0037, LLP 0203, LLP 0258, LLP 0275, LLP 0295,
`issues/20260821-authoring-profile-vertical-contract-fixtures.md`

## Summary

LLP 0252 authorizes a bounded experiment: a second, Convex-familiar
TypeScript authoring profile (`snapback-familiar-ts-v1`) lowered by a
codegen front-end adapter into the same canonical definition, artifact
pipeline, runtime, and client core as the existing explicit profile. (The
author's 2026-08-13 build directive ratified the r5 pins and accepted the
RFC; the acceptance status change lands with this Spec.) This Spec fixes
the concrete v1 API of that profile against the code that exists today:
the exact source grammar, the file-discovery and lowering rules, the
normalized projection (`NormalizedApplicationDefinitionV1`,
`normalizedContractId`, `normalizedSchemaId`), the complete adapter
disposition table (Appendix A), the familiar React entrypoint, the
refusal-code family, and the build phasing. Where LLP 0252's illustrative
examples and the shipped code disagree, this Spec names the divergence and
pins the v1 resolution; LLP 0252's design rules (D1–D8) remain the
governing law.

## Ground truth this Spec binds to

Verified against main (`fa3eb2b7c` era); corrections from the r1 reviews
incorporated:

1. Codegen discovery is hardcoded to `<backendDir>/schema.mjs` +
   `functions.mjs` (+ optional `routes.mjs`); there is no directory scan and
   no module namespacing. `functionId = "<appId>:<name>"`, and the name
   grammar is a single identifier — dotted names are rejected at validation
   and would be emitted as unquoted TypeScript members. The Rust manifest
   lookup is name-agnostic (`function.name == name || function.id == name`).
2. Definition modules are `.mjs`-only; TypeScript admission
   (LLP 0246 `bounded-handler-typescript-v1`) currently covers handler
   modules only (`loadHandlerSource` → `transformTypeScriptHandler`).
3. The canonical authored vocabulary lives in
   `@expo/snapback-codegen/define`: `defineSchema`/`defineTable` (with
   chainable `.index()`, `.sync()`, etc.), `v` (including `v.doc`,
   `v.principal`, `v.id`), the query/mutation/action constructor families.
   Key sets are closed by `assertKnownSpecFields`
   (`SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN`).
4. The canonical egress contract space is **kind-partitioned**: JS queries
   admit `results.documents`, `results.records`, the legacy row `v.object`
   form, and the LLP 0108 single-value `results.document`/`results.value`
   forms; mutations/actions admit `results.document` or `results.value`.
   LLP 0245's `topLevelContract` encodes the same partition, and its
   suggestion renderer emits `result:` source. The key `returns:` on
   `defineMutation`/`defineAction` is the *plan return expression*.
5. The canonical auth enum is `public | optional-user | authenticated`
   (`AUTH_REQUIREMENTS`); there is no `required-user` value.
6. `withIndex` in the handler query builder is name-only
   (`ctx-bootstrap.js`); filters are chained `eq/in/lt/lte/gt/gte` calls
   with bounded bindings, `order`, `take`, `collect`/`first`.
7. The action context has `runMutation(name, args)` (host op
   `action.runMutation`) and no `runQuery`. Its `db` property is present
   but every method throws (`readonlyDenied`); only the generated
   TypeScript type omits it. Action contexts also expose `fetch`,
   `fetchStream`, and push host operations.
8. A versioned semantic projection exists: `semantic-generation.mjs` —
   `semanticInput` (`snapback.semantic-identity.v1`), hashed whole into
   `semanticId`. Its per-operation `semanticOperation(...)` records carry
   `operationId`, `operation`, and `behavior` (canonical runtime AST) but
   **no `uses`/secrets field**; `semanticInput` also carries
   `graphRecords` (source-graph custody with AST digests).
9. The shipped React surface is `SnapbackProvider`, `useSnapbackQuery`
   (state union `pending | blocked | ready | refreshing | error | skipped`
   with axes `data/error/connection/freshness/retention` — and
   `queryStateForConnection` keeps `data` with `freshness: 'current'`
   while demoting `status` to `refreshing` on transport loss, and turns
   `connection: 'error' | 'closed'` into `status: 'error'`),
   `useSnapbackMutation` / `useSnapbackSettledMutation` (settled-only
   `queue: false` projection exists), `useSnapbackCommand`,
   `useSnapbackPresence`, the `skip` registered symbol, and
   `SnapbackDiagnosticError`. Only anonymous-custody 401/403
   `SNAPBACK_AUTH_REQUIRED` denials become the stable `blocked` state;
   an authenticated user's mid-subscription denial is published as
   `status: 'error'` today. The LLP 0238 renames are recorded in
   `compatibilityAliases` as exactly **one** row
   (`useSnapbackQuery` → `useSnapbackLiveQuery`); the shipped one-shot
   verbs are `client.query` and `client.run`.
10. Generated function references carry `kind` (`__snapbackReferenceKind`)
    and `authRequirement` but not `retention`, `delivery`, or any
    authoring-profile fact. Runtime ref admission exists
    (`assertClientReferenceKind`) and runs before transport.
11. Per-app codegen configuration is `<backendDir>/codegen.policy.json`,
    exact-key validated, not part of semantic identity today.

## S1. Profile selection and identity

### S1.1 Selection

The authoring profile is declared in `codegen.policy.json`:

```json
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": ["functions.manifest.json", "schema.manifest.json"],
  "authoringProfile": "snapback-familiar-ts-v1"
}
```

- `authoringProfile` is optional; omission means `snapback-explicit-v1`.
- Allowed values are exactly `snapback-explicit-v1` and
  `snapback-familiar-ts-v1`; any other value refuses with
  `SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID`.
- The policy file is the only selection point. The codegen CLI never grows
  a profile flag; LLP 0252 D7's "scaffold flag" is satisfied by scaffolding
  tools *writing* `codegen.policy.json`, not by a generation-time override.
- **No selectable-but-absent state:** a generation selecting
  `snapback-familiar-ts-v1` must always reach either the S4 adapter or a
  stable refusal — Phase A's policy admission and Phase B's adapter land
  together on main, so the intermediate state (familiar selectable, no
  adapter, explicit source silently labeled familiar) never exists there.
- **Mixing detection is symmetric and covers every explicit entry module.**
  Under the familiar profile, the presence of `functions.mjs`,
  `schema.mjs`, or `routes.mjs` in the backend dir refuses with
  `SNAPBACK_CODEGEN_FAMILIAR_EXPLICIT_SOURCE_PRESENT`. Under the explicit
  profile, the presence of `schema.ts` or of any top-level module that
  imports the familiar constructor entrypoints (`@expo/snapback/server`,
  `@expo/snapback-codegen/familiar`) refuses with
  `SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT` — detected by a
  static AST scan of import specifiers, never by evaluating familiar
  source under the wrong profile. Leftover source from the other profile
  is a refusal, never silently inert.

### S1.2 Identity (no fleet-wide rotation)

- The authoring-profile fact enters **semantic identity by
  default-omission**: `buildSemanticGenerationInputs` adds an
  `authoringProfile` field to `semanticInput` **only when the profile is
  not `snapback-explicit-v1`**. Every existing explicit application's
  `semanticId` preimage is byte-identical before and after this lands —
  introducing the field rotates no semantic identity (the LLP 0241
  rotation in LLP 0252 D8 is a consequence of *migration*, not of this
  Spec landing). `bundleId` and therefore `generationId` **do** rotate on
  the first regenerate, because `normalized-definition.v1.json` is a new
  generated member and bundle identity hashes generated members — that is
  the ordinary LLP 0241 consequence of any emitter change, disclosed here
  so it is never mistaken for a semantic rotation. Familiar generations
  carry the field, so the two profiles always have distinct `semanticId`
  even at equal normalized definitions (D1).
- The profile fact is recorded in `schema.manifest.json`,
  `functions.manifest.json`, `app.descriptor.json` (explicit apps record
  `snapback-explicit-v1` in these *manifests* — manifest fields are not
  identity preimages), and on every generated function reference (S5.3).
- The profile fact is **excluded** from
  `NormalizedApplicationDefinitionV1` so cross-profile equivalence stays
  computable (LLP 0252 Phase 0.6).

## S2. Familiar source layout and discovery

Under `snapback-familiar-ts-v1`, the backend directory contains:

```
snapback/
  schema.ts            (required; default-exports defineSchema(...))
  <module>.ts          (top-level .ts/.mts modules: function or helper)
  seed.json            (optional, unchanged)
  codegen.policy.json  (profile selection, committed projections)
  generated/           (codegen output; never authored)
```

Rules:

1. **Classification is by exports, not by path.** Every top-level `.ts` or
   `.mts` file except `schema.ts` is scanned: a file is a **function/intent
   module** iff at least one named export is a familiar authored value
   (`query(...)`, `mutation(...)`, `action(...)`, or
   `defineAssetUpload(...)`); otherwise it is a **helper module**, admitted
   under the existing LLP 0237 bounded-graph rules with no further constraint.
   A function/intent module whose other named exports are not familiar
   authored values refuses
   (`SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED`) — mixing functions and
   exported helpers in one module is the one shape the classifier cannot
   attribute, so it is refused rather than guessed.
2. **Subdirectories may hold helper modules** (they are reached only by
   import, under the same bounded-graph admission). Function/intent modules
   must be top-level: if any imported module below the top level exports a
   familiar authored value, generation refuses
   (`SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED`) — a nested
   function can never be silently inert. `crons.ts` and `http.ts` at the
   top level are reserved Convex-shaped names that refuse with
   `SNAPBACK_CODEGEN_FAMILIAR_RESERVED_MODULE_UNSUPPORTED` routing to the
   explicit profile (`defineCron` / `defineRoutes`), so a copied Convex
   layout fails loudly (LLP 0252 D6).
3. **Module → namespace.** `todos.ts` exporting `list` yields the
   canonical operation name `todos.list`, functionId
   `"<appId>:todos.list"`, and the generated reference `api.todos.list`.
   See S5.2 for the name-grammar extension this requires.
4. **TypeScript definition modules.** Familiar definition modules run
   through the same pinned LLP 0246 profile (syntax erasure, pinned
   compiler identity) *before* the existing esbuild definition bundle; the
   TS identity tuple additionally enters the definition-graph hash inputs
   for familiar generations. The bundler's fail-closed import policy is
   unchanged; the familiar import allowlist adds `@expo/snapback/server`
   and `@expo/snapback/values` (S3.1) plus the generated-local
   `./generated/server` specifier.
5. **First-generation bootstrap.** Because the learned import
   `from "./generated/server"` must work on a clean checkout, generation
   synthesizes the `generated/server.{mjs,d.ts}` module (S3.2) **before**
   definition evaluation when it is absent or stale; the definition bundle
   resolves against the synthesized file. A missing `generated/` is never
   a refusal for the first generate.
6. **Inline handlers.** Familiar `handler:` closures are inline by design;
   the existing `extractInlineHandlers` lift applies after TS erasure, so
   handler custody, source maps, and the bounded handler graph work
   identically to the explicit JS-handler forms.
7. **Output.** Both profiles write exactly one graph to `generated/`.
   `_generated/` is a retired spelling: a directory, symlink, or Familiar
   import using it refuses with a stable explanatory diagnostic. A symlink
   compatibility bridge is forbidden because it creates two watcher-visible
   paths for one graph. The Familiar artifact set adds `server.{mjs,d.ts}`
   and the familiar-shaped `api.{mjs,d.ts}` namespace projection (S5.1).

## S3. Package shape (resolves LLP 0252 OQ1)

### S3.1 The umbrella package

A new, thin, deletable package `@expo/snapback` (npm), marked
`Experimental` in capability/package metadata:

| Entry | Re-exports |
| --- | --- |
| `@expo/snapback/server` | `defineSchema`, `defineTable`, `defineAssetUpload`, `defineEphemeral`, and the `ephemeral` collection-builder namespace from the canonical define module (the ephemeral pair added 2026-08-21 per S9.1 R4 — same canonical objects, no second owner); the familiar `query`, `mutation`, `action` constructors (S4) from `@expo/snapback-codegen/familiar` |
| `@expo/snapback/values` | `v` (the existing canonical validator grammar, unchanged) |
| `@expo/snapback/react` | the familiar React entrypoint `@expo/snapback-react/familiar` (S6) |

Rationale: LLP 0252 OQ1 recommends the umbrella because import coherence is
part of the learned surface; the round-4 Grok pin requires the familiar
React aliases to live in an entrypoint withdrawal can delete whole. Both
are satisfied: the umbrella owns no implementation — every symbol lives in
an existing package under a `familiar`-named module that can be removed
with the umbrella. Publication inventory cost is one extra package and is
recorded in the LLP 0252 D7 maintenance ledger.

**2026-08-16 publication-closure clarification.**
`@expo/snapback-expo-custody` joins LLP 0041's qualified publication inventory
as a separate Experimental package, but it does not join this umbrella's
dependency or re-export closure. Native custody is an optional Expo add-on
whose config plugin must be listed by the application; making it an umbrella
dependency would violate this section's thin, implementation-free package
definition and would make native build configuration an implicit effect of a
familiar-authoring import.

### S3.2 Generated local modules

- `generated/server.{mjs,d.ts}` re-exports `query`, `mutation`, `action`,
  `defineAssetUpload`, `defineEphemeral`, and the `ephemeral`
  collection-builder namespace (the ephemeral pair added 2026-08-21 per
  S9.1 R4)
  bound to the application's schema types (typed `ctx.db`, typed
  `v.doc`/`v.id` table names). It exists so the learned import
  `import { query, mutation, defineAssetUpload } from "./generated/server"`
  works verbatim
  and carries app-typed generics; it contains no logic beyond typed
  re-export, and S2 rule 5 governs its bootstrap.
- `generated/api.{mjs,d.ts}` exports the namespaced `api` object (S5.1).

## S4. Familiar server grammar and lowering

### S4.1 Constructors

`query(spec)`, `mutation(spec)`, `action(spec)` are authored-value
constructors in `@expo/snapback-codegen/familiar` (evaluated in the same
capability-empty definition VM as the explicit constructors; same framed
normalization). The v1 key matrix:

| Key | `query` | `mutation` | `action` | Lowering target |
| --- | --- | --- | --- | --- |
| `args` | required | required | required | canonical `args` validators (identical grammar) |
| `returns` | required | required | required | canonical `result:` contract via the kind-partitioned S4.3 lowering |
| `auth` | required | required | required | canonical `auth` enum, verbatim (S4.2) |
| `reads` | required | required (`[]` legal) | forbidden | JS-form `reads` table list |
| `writes` | forbidden | required | forbidden | JS-form `writes` table list |
| `delivery` | optional, `"live"` (default) \| `"read"` | forbidden | forbidden | constructor choice: `"live"` → JS live-query form; `"read"` → JS one-shot query form |
| `secrets` | forbidden in v1 | forbidden in v1 | optional | canonical action `uses` |
| `handler` | required | required | required | inline-lifted bounded handler graph |
| `refusals`, `trackedRefusals` | optional | optional | optional | canonical vocabulary, unchanged (disposition 1) |
| `retainable` | optional (extension key) | forbidden | forbidden | canonical `retainable` fact, unchanged — D5 retention consumed via canonical hooks |
| `authScopeField` | optional (extension key) | forbidden | forbidden | canonical authority-scope fact, unchanged |

The last two rows are documented as Snapback extension keys (D5), not
Convex-familiar vocabulary. Every other canonical authored key has its v1
disposition in **Appendix A**, which is normative: a key with no
disposition row refuses (`SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED`
naming the key, the profile, and the route). The Phase A generated
completeness gate proves Appendix A (and its generated successor over the
canonical definition schema) covers every canonical field, fail-closed
(LLP 0252 D2).

### S4.2 Auth vocabulary (divergence from the 0252 example, pinned)

Familiar `auth` accepts exactly the canonical closed enum:
`"public" | "optional-user" | "authenticated"`. LLP 0252 D2's illustrative
`auth: "required-user"` is **not** adopted: introducing a synonym would
give one fact two spellings across profiles (LLP 0203 P6). There is no
public-by-omission: a missing `auth` refuses
(`SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING`), never suggestion-backed.

### S4.3 `returns` lowering (kind-partitioned, refusing)

Familiar `returns:` takes the `v.*` grammar and lowers onto the canonical
egress contract space **per operation kind**, matching the shipped
partition (Ground truth 4) and LLP 0245's `topLevelContract` rules:

**Queries.** Familiar preserves the canonical row contracts for the five
already-row-shaped cases and uses LLP 0108's single-value carrier for every
other exact validator:

| Familiar `returns` | Canonical `result:` |
| --- | --- |
| `v.array(v.doc(t))` (no bounds) | `results.documents(t)` |
| `v.array(v.object({...}))` (no bounds) | `results.records({...})` |
| `v.array(v.object({...}), {maxItems})` | `results.records({...}, {minItems: 0, maxItems})` — the pair is the **exact translation** of the authored bound (`v.array`'s `maxItems` means length ∈ [0, maxItems]; the canonical constructor requires both members), not an approximation |
| `v.array(v.union(...))` where every union arm is a closed record validator | `results.records(union)` (the canonical constructor admits record unions) |
| 1-tuple `v.tuple([v.object({...})])` | `results.records(..., {minItems: 1, maxItems: 1})` |
| every other exact `v.*` shape — including `v.object({...})`, `v.doc(t)`, `v.union([v.doc(t), v.null()])`, scalars, bounded document arrays, scalar/id arrays, and other tuples | `results.value(validator)`; the handler returns the authored value directly and Familiar consumers receive that value |

The adapter does not invent a second query grammar: this catch-all is the
canonical `results.value` query contract admitted by LLP 0108. Query/live
transport uses exactly one internal row for it, but that carrier is not exposed
as a one-element Familiar result.

**Mutations and actions (single-valued results):**

| Familiar `returns` | Canonical `result:` |
| --- | --- |
| `v.doc(t)` | `results.document(t)` |
| any pure value validator (scalars, `v.id(t)`, `v.null()`, `v.object`, `v.array` of values, unions of values) | `results.value(validator)` |
| any doc-containing shape other than bare `v.doc(t)` | refuse `SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE`, route to explicit `result:` |

The lowering is a committed pure function with golden vectors per row,
including the refusal rows; it never approximates. The canonical
plan-return key (`returns:` in the explicit mutation/action grammar) is
unreachable from the familiar profile.

**Vertical receipt (2026-08-21).**
`scripts/familiar-vdoc-vertical-contract.mjs` packs the native runtime, CLI,
Contract, codegen, client, React, and Familiar umbrella packages, installs
them as materialized dependencies in a fresh external app, retrieves this
spelling from the build-bound Guide with point-query vocabulary, and proves one
clean generation of the fixture in
`tests/fixtures/familiar-vdoc-vertical/`. The same receipt
typechecks exact bare/nullable/document/list projections, runs the generated
bare and nullable query plus mutation/action contracts in the native runtime,
observes the nullable point result through the headless one-shot client,
headless live handles/callbacks (present, absent, and delete transition), and
Familiar React `useQuery`. After a successful generation it also introduces
each unsupported mutation/action document array through the CLI regeneration
path and proves the prior complete artifacts and function manifest remain
byte-identical with no invalid function admitted. Independent clean refusals
still prove
`SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` before `artifacts.json` with
the supported explicit-grammar rewrite. This is the LLP 0295 vertical
integration receipt; the lowering and result-contract suites remain the
mechanism owners.

**LLP 0245 integration.** A missing familiar `returns` is the one
suggestion-backed key (with addition-only `reads`/`writes` patches). The
familiar constructors get their own `RESULT_BUILDERS` entries whose
renderer emits **`returns:` source in the familiar `v.*` grammar** — never
`result:` (which S4.1 would refuse). Generation refuses activation until
accepted source carries the declaration (LLP 0252 D2).

### S4.4 Handler contexts

- **Query/mutation handlers** receive the existing canonical ctx (typed by
  the published ctx module instantiated with the app schema): `ctx.db`,
  `ctx.auth`, `ctx.runtime`, etc. Effect facts derive exactly as for the
  canonical JS-handler forms: `computeEffectCeiling` over the declared
  `reads`/`writes` with `basis: 'declared'` — the same declared-not-
  inferred posture as the explicit profile (Appendix A row `effects`).
- **Action handlers** receive a generated, profile-owned facade (part of
  the bundled handler graph — no runtime branch) built **positively**: the
  facade is a fresh frozen object whose own-property set is exactly this
  enumerated table, never a wrap-and-override of the canonical ctx:

  | Own property | Behavior |
  | --- | --- |
  | `auth`, `runtime`, `secrets`, `refuse`, `isDirectHuman` | forwarded to the canonical action ctx, verbatim |
  | `runMutation` | familiar composition seam (below) |
  | `runQuery` | always-throwing stub `SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED` naming the r5 pin's route (a separately owned host-op RFC) |
  | `fetch`, `fetchStream` | always-throwing stubs `SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED` routing to the explicit profile / LLP 0249 |

  Everything else on the canonical action ctx — `db`, `run`, `cron`,
  `assets`, `jobs`, `realtime`, `streamAttempt`, `stream`, push — is
  **absent as an own property**. Phase B's test asserts own-property-set
  *equality* with this table (not merely the presence of stubs), which is
  what makes "every effectful host operation is unreachable" a proved
  claim rather than an enumeration of known holes: **v1 familiar actions
  are composition-plus-compute**, effect declarations are never needed and
  never inferred, and the `effects` key is disposition 4 with this facade
  as its enforcement (LLP 0252 D2/Acceptance 3). If the familiar lane
  measurably loses for lacking outbound or streaming actions, that is D7
  component evidence, not license to widen v1.

  **The composition seam and generated-reference capture.** The learned
  spelling is `ctx.runMutation(api.x.y, args)` with `api` imported from
  `./generated/api`. The shipped inline-handler lift refuses free
  top-level identifiers (`SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER`), so an
  imported `api` binding cannot flow into the extracted handler graph
  unspecified. The familiar adapter therefore performs **custody-bound
  reference capture before inline extraction**: member expressions rooted
  at the module's `./generated/api` import binding are statically
  resolved to their nominal operation names and rewritten to generated
  frozen marker literals. The marker digest is the deterministic
  capability-empty bootstrap API projection's content digest — not the
  final `api.mjs` bytes, which themselves derive from handler identity
  and would make the digest self-referential with no guaranteed fixed
  point (Phase B implementation finding). The digest still rotates with
  the captured namespace, and markers additionally carry closure-private
  nominality (a module-private `WeakSet`), so reconstructed lookalike
  objects refuse even with a matching digest.
  Any dynamic or unresolvable access rooted at that binding refuses
  (`SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC`). At runtime,
  `ctx.runMutation` accepts exactly those generated markers, extracts the
  nominal name, and forwards to the existing `action.runMutation` host
  op; raw strings and foreign objects refuse
  (`SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED`).

### S4.5 Callback `withIndex` lowering (r5 pin, no-drop gate)

The familiar `ctx.db` is the canonical builder wrapped by the same
generated facade, admitting both spellings:

- `withIndex(name)` — canonical passthrough.
- `withIndex(name, (q) => q.eq(f, x).lt(g, y)…)` — the callback runs
  immediately against a recorder whose only methods are the canonical
  chained-filter set (`eq`, `in`, `lt`, `lte`, `gt`, `gte`); each recorded
  predicate is replayed as a canonical chained filter call on the builder
  the facade returns. The lowering is total by construction: every method
  call either becomes exactly one canonical filter or throws
  `SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED` (unknown method, non-chained
  usage, or a `q` escaping the callback). Nothing recordable can be
  dropped, and canonical bounds and index-field validation apply unchanged
  because the facade emits ordinary canonical calls.
- The Phase B adversarial no-drop test authors a range-predicate callback
  and proves the predicate narrows results (a dropped owner filter would
  be an authorization defect — LLP 0252 D2).

### S4.6 Delivery

`delivery` defaults to `"live"` (frozen in `snapback-familiar-ts-v1`):
the operation lowers to the canonical JS live-query form and inherits its
proven-liveness admission — an unprovable live query refuses, never polls
(LLP 0252 D3, Acceptance 4). `delivery: "read"` lowers to the canonical
one-shot JS query form. No other value (refuse:
`SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID`). Because the profile is
live-by-default, familiar `defineTable` tables default to sync-enabled
(the versioned profile default; Appendix A row `.sync()`), so the ordinary
familiar table is live-capable without ceremony. Generated JSDoc for a
`"read"` query routes to the shipped one-shot verb `client.query` (S6.5).

### Explicit asset intents — 2026-08-15

`defineAssetUpload(spec)` is admitted as a top-level Familiar authored-value
constructor and re-exported by the umbrella and generated server entrypoints.
A module `media.ts` exporting `videoUpload` lowers to the canonical asset
intent name `media.videoUpload`. The name uses the same shared
`IDENT.IDENT` operation-name grammar as Familiar functions, and generated
`api.media.videoUpload` is the identical nominal reference stored at
`app.api.assets["media.videoUpload"]`.

The `defineAssetUpload` policy object is canonical and unchanged: media types,
byte bounds, auth, authorization, delivery, reference access, image/video
location policy, variants, callbacks, and receipts retain their existing
owners and refusals. In particular, a Familiar video intent declares
`accept.mediaTypes: ["video/mp4"]` and `video.location`; it does not overload
the derived image-only `v.assetRef()` default. This is an authoring projection,
not a second asset runtime. A profile may not make an explicit-profile asset
capability unreachable without specifying a sanctioned escape and a stable
diagnostic route.

## S5. Normalized projection and generated references

### S5.1 The `api` namespace

`generated/api.mjs` exports `api` with one property per module, one per
export: `api.todos.list`, deep-frozen, backed by the same
`FunctionReference` records the explicit profile emits (nominal ids, not
string paths — LLP 0252 D2). Group/ephemeral/asset members keep their
canonical homes; v1 familiar apps reach them through the D5 extension
vocabulary.

### S5.2 Operation names and `NormalizedApplicationDefinitionV1`

**Dotted canonical names (resolves r1 OQ2).** The canonical operation-name
grammar extends to admit names of the form `IDENT.IDENT` (exactly one
dot) for every profile, alongside the existing single-IDENT names:

- one shared definition in `@expo/snapback-contract/operation-name` admits
  the dotted form for codegen and the canonical client. A conformance table
  enumerates accepted and refused spellings, so a name that generates is
  callable and profile-specific client leaf allowlists cannot drift.
- Client-consumed JavaScript exports only plain identifiers. Dotted operations
  remain addressable through the generated namespace (`api.todos.list` for
  Familiar, `api["todos.list"]` / `app.api.queries["todos.list"]` for the
  canonical descriptor). Generated type members use quoted object keys where
  legal; no client-consumed ESM export clause carries a string alias. The
  Expo 57 package closure runs its shipped Metro/Hermes transformer over every
  emitted `.mjs` for both profiles.
- The **explicit profile can spell dotted names via ES2022 string export
  names**: `export { listImpl as "todos.list" }` in `functions.mjs`. This
  is a small explicit-grammar extension owned by this Spec; it is what
  makes (a) the dual-profile fixture equal on names, and (b) D8 migration
  **name-preserving in both directions** — operation identity survives a
  profile migration, which LLP 0252 D8's retained-fence rule needs.

**The normalized projection is its own builder, not `semanticInput`.**
`NormalizedApplicationDefinitionV1`
(`NORMALIZED_DEFINITION_SCHEMA_VERSION =
'snapback.normalized-application-definition.v1'`) is constructed by a new
committed builder in `semantic-generation.mjs` reading the same canonical
records that feed `buildSemanticGenerationInputs` — it shares field
semantics with `semanticInput` but is computed independently, so landing
it changes no existing identity (`semanticId` preimages are untouched;
see S1.2).

Preimage, enumerated:

- **Application:** the schema block as in `semanticInput.schema` (tables,
  indexes, auth, authProgram, api, assets, pushSeam, strictDeclarations,
  requiredCapabilities, ephemeral collections, portability flags), plus
  the top-level `authorityProfile`, `assetUploadIntents`, routes,
  memberships, migrations, and retention blocks.
- **Per operation** (sorted by operation name):
  `{operationName, operationKind (the canonical four-kind enum —
  Query | LiveQuery | Mutation | Action — so the delivery fact is always
  distinguishable), args, result, authority {authRequirement,
  authorizationDependence, authorityIndependent, authorityCreating,
  fieldBoundary, authorityProfileDependence}, reads, writes, effects (the
  derived effect ceiling), capabilities, apiExposure, refusals,
  trackedRefusals, syncabilityClass, retention {retainable,
  retentionClass}, secrets (the sorted canonical `uses` list), stream,
  sequences, boundedSkew, standardPattern, runtime (the authored
  LLP 0249 runtime-profile fact when present; null otherwise), plan (the
  declarative plan AST for plan-backed operations; null for handler-backed
  operations)}`. `secrets` and `plan` are **in** the preimage —
  LLP 0252's Terminology rule requires them, and `semanticOperation`
  omits `uses` today (Ground truth 8), which is why the normalized record
  is built from the canonical definition, not copied from
  `semanticOperation`.
- **Completeness by construction.** The builder derives its field
  coverage from the canonical decorated-function record: every canonical
  per-operation and per-application field must appear in a committed
  include/exclude decision list (the include set above; the named
  exclusions below), and generation **refuses** if a canonical field is
  absent from both — so a future canonical field cannot silently escape
  the witness (the same fail-closed posture as the Appendix A gate).
- **Excluded, each named in the artifact's `excludedFields`:**
  - `behavior` for handler-backed operations (handler implementation —
    witnessed by `executableId`; the *contract* of a handler-backed
    operation is its args/result/authority/reach/effects row above);
  - `graphRecords` (source-graph custody — witnessed by
    `executableId`/`evidenceId`; including it would make the witness a
    restatement of executable identity);
  - `authoringProfile` (a semantic-identity input, S1.2);
  - `appId` (address-scoped custody; operations key by `operationName`,
    not `functionId`, so two deployments of the same definition witness
    equal).

  A plan-backed and a handler-backed authoring of "the same" operation are
  **not** normalized-equal (the plan is contract-bearing; the handler's
  plan field is null). That is honest: D8 already classifies
  plan→handler conversion as a behavior-preserving *candidate* with a
  manual-review marker, never a witnessed equivalence.
- `normalizedContractId` = domain-separated SHA-256 over the RFC 8785/JCS
  canonicalization (new domain string in `GENERATION_HASH_DOMAINS`).
- `normalizedSchemaId` = the same construction over the application block's
  schema subset only; preimage frozen at Phase A with its own golden
  vectors (the data-migration closure witness).
- Emitted as `normalized-definition.v1.json` in the generated dir for both
  profiles, with both ids; the ids also enter the generation envelope.
  Golden vectors: committed fixture apps in both profiles with
  byte-expected artifacts and id values.

### S5.3 Reference profile fact and brand

Every hydrated `FunctionReference` carries `authoringProfile`,
`retention`, and `delivery` facts at runtime, plus a type-level phantom
`__snapbackAuthoringProfile` alongside the existing
`__snapbackReferenceKind`. Their serialization is byte-frugal (a Phase C
metrology measurement showed naive per-ref serialization costs ~85 bytes ×
every reference in every app bundle):

- `authoringProfile` is serialized **once** at the descriptor/app level
  (D1's one-profile-per-app rule makes per-ref copies pure redundancy);
  binding hydration stamps the app profile onto every reference as an own
  property, so runtime admission still reads `ref.authoringProfile`.
- `delivery` is **derived, never serialized**: the nominal kind already
  distinguishes `LiveQuery` from `Query`; hydration derives the fact.
- `retention` is serialized per-ref **only when non-default**
  (`retainable: true`); hydration supplies the default otherwise.

Familiar client aliases admit references via the existing
`assertClientReferenceKind` pattern extended with profile admission —
refusing `SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH` before any resource
or transport work (LLP 0252 Acceptance 2). Canonical hooks and verbs
accept both profiles (the sanctioned reverse direction, D1/D5).

`AppDescriptorV1.authoringProfile` is a required closed-union field on current
generated descriptors, not an emitter-only annotation. Expo admission validates
exactly the two S1 values when the field is present and retains one explicit
legacy descriptor shape without the field; no unknown value is tolerated. The
Expo/codegen cross-package gate freshly generates and admits one descriptor
from each profile at the same package version, preventing the current emitter
and admission schema from drifting independently.

### S5.4 The no-branch gate

A Phase A structural gate (extending the generated-artifact check family)
asserts no production source under `crates/snapback/src/`, `packages/snapback-client`,
`packages/snapback-react`, or the harness glue reads `authoringProfile` to
select behavior — allowlisting exactly the sanctioned sites: adapter
front-ends, emitters, diagnostics/custody records, migration tooling, and
the client profile-admission refusal (which refuses before admission and
never changes admitted behavior — LLP 0252 D1).

## S6. Familiar React entrypoint

New module `@expo/snapback-react/familiar` (exports-map entry; deletable
whole). It creates no cache, transport, outbox, auth coordinator, or task
owner (Phase C proof), and introduces no error type.

### S6.1 Exports

`SnapbackProvider` (re-export of the existing component — same name, same
object), `useQuery`, `useMutation`, `useAction`, `useQueryState`, `skip`,
and type exports for the branded ref aliases.

Dated amendment (2026-08-15, LLP 0258 Phase 0): the closed list additionally
admits the ordinary auth hooks as re-exports — `useCurrentPrincipal` and
`useAuth`, aliases of the canonical `useSnapbackCurrentPrincipal` and
`useSnapbackAuth` (same objects; Familiar constructs no cache, coordinator,
or client — LLP 0258 D6). Exact names remain subject to LLP 0258's Phase 1
API review, and the re-exports ship only when the canonical hooks ship;
until then the v1 export surface is unchanged.

### S6.2 `useQuery`

`useQuery(ref, args | "skip" | typeof skip): Result | undefined`

- Admits only familiar-branded live-capable query references (type +
  runtime, S5.3).
- The string `"skip"` lowers to the canonical `skip` symbol before the
  canonical hook is called (one owner, two spellings — r5 pin).
- Implemented as a projection over the shipped canonical hook
  (`useSnapbackQuery` today; the module binds through one internal alias
  so the LLP 0238 rename lands in exactly one place). The projection is
  total over the shipped `status × freshness × connection` space:

  **Data is returned iff `status ∈ {ready, refreshing}` ∧
  `freshness = 'current'` ∧ `connection = 'live'`.** Everything else:

| Shipped state | Familiar `useQuery` |
| --- | --- |
| `ready`/`refreshing`, freshness `current`, connection `live` | `data` |
| `ready`/`refreshing`, freshness `current`, connection **not** `live` (transport loss holding last-current data) | `undefined` — data that is no longer live-maintained is not knowably current (D4's stale-as-current exclusion) |
| `ready`/`refreshing`, freshness `retained` or `snapshot` | `undefined` |
| `pending`, `skipped` | `undefined` |
| `blocked` (`authentication-required`) | `undefined` + development routing diagnostic naming `useQueryState` |
| `error` whose diagnostic is **connection/transport-class** (the shipped `connection: 'error' | 'closed'` demotion) or **any authorization denial** | `undefined` + development routing diagnostic — D4: transport loss and denied/revoked authority on a continuing subscription are stable unavailability, not error-class |
| `error` whose diagnostic is any other error-class fact — typed application refusals, sealed refusals, contract/validation failures, handler faults | throw `SnapbackDiagnosticError` rebuilt from `state.error` during render (documented error boundary) |

  The error split is a **committed closed code-class table** in the
  familiar entry (reviewed against the diagnostics registry), and it is
  derivable from the projected state alone: the shipped `QueryState.error`
  carries no event provenance (the implementation observes
  `authorization_denied` and discards it), and handler-level permission
  refusals share `SNAPBACK_AUTH_PERMISSION_DENIED` with authority
  transitions — so this Spec does **not** attempt to distinguish "why" a
  subscription-delivered authorization denial happened. **All**
  authorization-denial codes on the continuing-subscription path project
  to `undefined`; the classification needs only the code. This is safe
  against misclassifying application errors because the code spaces are
  structurally disjoint: app-declared refusal codes must not start with
  `SNAPBACK_`, and Phase C's test asserts the auth-denial code set is
  disjoint from every code the table classifies as throwing. A fresh
  one-shot call of the same operation still surfaces the typed refusal
  (that path is `client.query`/`client.run`, not this hook) — the D4
  continuing-subscription vs fresh-call distinction is preserved.
  There is no `optimistic` freshness value in the shipped union; optimistic
  data never reaches this hook because the familiar entry never passes
  optimistic options.
- Phase C lands tests for the two review-named scenarios: socket drop
  while mounted (must go `undefined`, not keep serving rows, not throw),
  and authenticated→denied while mounted (must go `undefined` with the
  routing diagnostic, not throw).
- Post-throw temporal semantics: while the canonical state remains a
  throwing `error` class, re-renders rethrow; when it leaves that class,
  the next render returns per the table and the documented boundary-reset
  guidance applies.

### S6.3 `useMutation`

`useMutation(ref): (args) => Promise<Result>` — a projection over the
shipped settled-only path (`useSnapbackSettledMutation` semantics:
`queue: false` at dispatch, LLP 0218). Resolves only with the validated
authoritative result; offline, protocol, application, and
result-validation failures reject with `SnapbackDiagnosticError` — offline
before any durable custody (the shipped `queue: false` path takes no
custody; Phase C verifies the offline rejection is the typed error and
hardens it if it is not). Queued outcomes are structurally impossible
(the shipped `SNAPBACK_REACT_QUEUE_FALSE_VIOLATED` guard). The generated
JSDoc and the offline refusal route to the canonical offline lifecycle
(today `useSnapbackMutation` + `useSnapbackOutbox().mutationStatus`).
Phase C adds the missing rename rows (mutation dispatch/status, task, and
the one-shot read verb) to `compatibilityAliases` in
`client-lifecycle.mjs` as data, so the routes follow the LLP 0238 renames
mechanically — today that table has one row (Ground truth 9), and this
Spec's routing claim is made true by adding the rows, not by asserting
them.

### S6.4 `useAction`

`useAction(ref): (args) => Promise<Result>` — call-time one-shot over the
shipped `client.run(ref, {args})` through the provider's client; owns no
task state; rejections are the canonical typed error. Command workflows
remain `useSnapbackCommand` (D5 extension vocabulary).

### S6.5 `useQueryState` and the `delivery:"read"` route

`useQueryState` is a re-export of the canonical full-state hook — the
same function object, returning the shipped canonical state union verbatim
(`{data, status, error, connection, freshness, retention}` members).
LLP 0252 D4's five-field `{data,status,freshness,diagnostic,refresh}`
description is schematic; the normative rule this Spec pins is: **the
complete canonical state grammar, by identity, no reshape** — a reshape
would be exactly the "subtly different cache" D4 forbids. (`diagnostic`
is spelled `error` in the shipped grammar; `refresh` does not exist on the
shipped state and its addition belongs to the LLP 0238 owner, not this
profile.)

`delivery: "read"` queries: no v1 hook consumes them; generated JSDoc
routes to the shipped one-shot verb `client.query` (LLP 0252's
`client.read` name is not shipped; the Phase C `compatibilityAliases` rows
carry the route forward when the rename lands). The familiar refs for
read-queries type-reject `useQuery` (not live-capable).

## S7. Refusal codes (v1 family)

New stable codes (registry-regenerated, guide-anchored; family
`SNAPBACK_CODEGEN_FAMILIAR_*` for generation-time, `SNAPBACK_FAMILIAR_*`
for bundled-facade runtime, client family for admission):

| Code | Site |
| --- | --- |
| `SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID` | policy validation |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPLICIT_SOURCE_PRESENT` | discovery (mixing, familiar side) |
| `SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT` | discovery (mixing, explicit side) |
| `SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED` | nested function module |
| `SNAPBACK_CODEGEN_FAMILIAR_RESERVED_MODULE_UNSUPPORTED` | `crons.ts` / `http.ts` |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED` | mixed exports in a function module |
| `SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED` | closed key matrix / Appendix A disposition 4 |
| `SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING` | required auth omitted |
| `SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` | S4.3 lowering |
| `SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID` | S4.6 |
| `SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED` | S4.5 facade |
| `SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED` | S4.4 stub |
| `SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED` | S4.4 facade |
| `SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED` | S4.4 fetch/fetchStream stubs |
| `SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC` | S4.4 reference capture |
| `SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION` | S5.2 emission sweep (pascal/binding collisions) |
| `SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH` | client profile admission |

## S8. Build phasing (maps LLP 0252 Phases 0–2)

- **Phase A (0252 Phase 0):** `NormalizedApplicationDefinitionV1` builder
  + `normalizedContractId`/`normalizedSchemaId` + golden vectors; the
  generated per-field disposition table (Appendix A's machine successor)
  with its fail-closed completeness gate; policy key + default-omitted
  semantic-identity input (with a proof that no existing `semanticId`
  changes); the no-branch gate. All landable before any familiar source
  parses.
- **Phase B (0252 Phase 1):** dotted-name admission + the full
  name-emission sweep (quoted object members where legal, bracket property
  access, namespace projection instead of client-facing string re-exports,
  deterministic safe local bindings for generated declarations, string-alias-
  aware inline attribution, and pascal-case collision detection refusing
  `SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION`) + string export names;
  discovery + TS definition modules + familiar
  constructors + lowerings (S4) + `generated/server`/`api` emission +
  reference facts + refusal codes + the equivalence proof: the todo app
  authored in both profiles with equal `normalizedContractId` for the
  intended-equal facts (names included, via string export names) and
  distinct LLP 0241 identities, plus adversarial divergence tests (auth,
  reach, secrets, plan, delivery, unsupported keys, no-drop withIndex,
  facade own-property surface).
- **Phase C (0252 Phase 2):** `@expo/snapback-react/familiar` (S6) +
  umbrella package + brand admission + error-class table + no-second-owner
  proofs + `compatibilityAliases` rows + the dated cross-reference
  amendments to LLP 0127, LLP 0130, LLP 0238 in the same landing (0252
  Acceptance 11).
- Phase 3 (templates, migration command, stop-date backstop, dual
  qualification) follows under LLP 0252 D7/D8 and is out of this Spec's
  v1 build scope except where S5 artifacts already serve it.

## S9. Authoring-profile product contract and vertical fixture catalogue (LLP 0295 D0.3, 2026-08-21)

This section is the Familiar half of the LLP 0295 D0.3 decision packet:
what the Familiar profile promises **beyond surface vocabulary**. The
Explicit half — which authored facts are policy versus derivable
repetition — is recorded in LLP 0275's 2026-08-21 amendment; the RFC-level
product contract for both profiles is cross-referenced in LLP 0252.
Status of every ruling below: **Adopted per LLP 0295; the author may
revise.** No default-profile change is made or implied; that decision
remains gated on the N≥3 wave (LLP 0252 D7, LLP 0295 R3).

### S9.1 Contract rulings

**R1 — One-pass clean generation and phase parity are contract, not
quality-of-implementation.** A valid Familiar application on a clean
checkout reaches a complete generation in **one** `snapback generate`
invocation: S2 rule 5's bootstrap obligation includes resolving
schema-derived document types (`v.doc`) in the same invocation, never via
a schema-only pre-pass the author must discover. Phase parity: any
authoring shape the adapter/codegen admits is admitted by runtime result
validation with the same effective contract; otherwise codegen refuses
before emitting artifacts. A result that generates and then fails only at
the runtime result-contract layer is a defect against this Spec. The
confirmed divergences (clean-checkout `v.doc` bootstrap; mutation document
result passing codegen then failing the runtime contract) are
implementation defects tracked in
`issues/20260820-familiar-vdoc-generation-runtime-parity.md`, gated by
fixtures VCF-F-G1 and VCF-F-M1.

**R2 — The supported handler dialect and module path are S2/S4, completely
and first-read-projectably.** The v1 dialect is the bounded LLP 0237/0246
graph with the S4 constructors, the S4.4 contexts, and the S4.5 builder
facade; top-level function/intent modules with subdirectory helper modules
per S2. The contract adds two obligations: (a) the complete dialect
boundary is projectable on the first-read path as one table — allowed
form, refused familiar-looking form, supported rewrite, and when Explicit
is the better profile
(`issues/20260820-guide-gap-familiar-handler-dialect.md`); and (b) every
familiar-looking-but-unsupported form refuses at the **earliest capable
layer** with exactly one supported rewrite, and never emits an artifact a
later layer rejects. Dynamic computed access, captured top-level
constants, out-of-graph imports, and clock-dependent visibility are the
replicated violations the negative fixtures (VCF-F-D1..D4) bind.

**R3 — The S4.3 result-kind partition is normative at every layer.** The
r5 table — five row-shaped translations plus the `results.value` catch-all
— is the one partition the Guide, generated types, adapter lowering,
runtime admission, and client projection all describe. In particular,
`v.union([v.doc(t), v.null()])` and closed `v.object({...})` point/value
results are **supported** through `results.value`, exactly as
`guide/backend/familiar-profile.md` promises. On current source the
adapter lowering already emits `results.value` for the nullable point
shape; the remaining divergence for that shape sits in the generated-type,
runtime-admission, and client-projection layers, and a value-object live
query still fails at runtime with
`SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID` (Diary 0105; LLP 0295's
current-source run). Those per-layer disagreements are implementation
defects against this Spec, not contract — W3 must attribute each to the
layer that still disagrees rather than reopening the green lowering
function. The guide keeps the S4.3 promise; until
the closure lands, the singleton-relational-array form may be documented
as an interim workaround, never promoted to the contract. Fixtures
VCF-F-Q6 and VCF-F-Q7 gate the closure; generated-runtime equivalence for
every partition row is gated by the full VCF-F-Q*/M* set.

**R4 — Entrypoint/export parity: a claimed capability is importable or
its refusal names the import.** Any capability the profile claims —
Appendix A disposition 1 or 2, or a D5 extension the Familiar docs name —
must be importable from an **advertised Familiar entrypoint**
(`@expo/snapback/server`, `/values`, `/react`, or the generated local
modules), or
every path that reaches it must refuse with a stable diagnostic naming the
exact supported import. Buildable-but-unexported (capability reachable
only by discovering lower-level public type declarations) is a contract
violation (LLP 0295 Objective 7). Concrete amendment: because schema-level
`ephemeral` declarations are disposition 1 (Appendix A), the canonical
ephemeral declaration vocabulary — both `defineEphemeral` **and** the
`ephemeral` collection-builder namespace, since a collection cannot be
authored without both — joins the closed re-export lists of
S3.1 `@expo/snapback/server` and S3.2 `generated/server` (amended in
place, 2026-08-21) — same canonical
objects, no second owner, no new runtime surface. Fixture VCF-F-E1 gates
it. An export-parity check landing with Phase C (the package/entrypoint
phase) asserts the advertised-entrypoint
closure covers every disposition-1/2 constructor the docs name.

**R5 — Feature parity is reachability parity, not constructor parity.**
For ephemeral, assets, membership, and sequences the promise is: every
capability reachable in the Explicit profile is (a) nameable from
Familiar, (b) reachable through a sanctioned, documented escape to the
canonical vocabulary, or (c) refused with a stable route to the Explicit
spelling — never silently absent and never reachable only by source
inspection. Per capability today: **ephemeral** — (a) after R4's
re-export; **assets** — (a) via `defineAssetUpload` (explicit-asset
amendment); **membership/authority** — (a): the schema authority
vocabulary is shared verbatim across profiles (Appendix A), so there is
exactly one spelling of membership resource identity. Pinned parallel to
R3: `resourceField: "_id"` on the resource table (self-resource) and the
required resource-id field on a child table are the contract — the engine
already admits them — and a generated-type layer that rejects `"_id"` as
outside the authored field union is a defect against this Spec, not
contract; fixture VCF-F-MB1 is the receipt
(`issues/20260821-authoring-profile-vertical-contract-fixtures.md`); **sequences** — (c): disposition 4
stands, and parity means the refusal and its route are stable and
first-read-discoverable (VCF-F-SQ1), not that Familiar gains the
constructor.

**R6 — When the generator suggests switching profiles.** The generator
suggests a profile switch only at stable refusal sites: a disposition-4
refusal names the Explicit spelling (or the owning-RFC route) as it does
today, and that is the entire v1 suggestion surface. The generator never
suggests Explicit→Familiar in v1 (no evidence base before the D7/N≥3
wave), never suggests a switch on success, and never suggests a
whole-application profile migration — that remains the authored D8
command. Repeated same-class refusals in one generation may be grouped
into one advisory naming the shared route (LLP 0295 scorecard), which
changes presentation, not the suggestion rule.

**R7 — Profile choice may vary by client stack/template without a
semantic fork.** Templates and client stacks may pin different profiles
(for example Familiar for a React/Vite template, Explicit for a headless
or acceptance-heavy template). This is template selection, not a semantic
fork, because four existing mechanisms hold: one profile per application
(LLP 0252 D1), one `NormalizedApplicationDefinitionV1` with the profile
fact excluded (S1.2/S5.2), the S5.4 no-branch gate below normalization,
and name-preserving bidirectional migration (S5.2/D8). A template's
profile pin is recorded template metadata, never an implied capability or
semantics difference. This is also the recommendation for LLP 0295 open
question 2: Familiar is **not** required to reach constructor-level
feature parity; templates may choose profiles by workload while R5's
reachability parity and the one normalized definition are preserved.

### S9.2 W3 vertical contract fixture catalogue

Every fixture follows LLP 0295's six-step vertical shape: (1) first-read
Guide retrieval with the diary's plausible wrong vocabulary; (2) import +
typecheck from the advertised profile entrypoint; (3) clean one-pass
generation, or pre-output refusal with one supported rewrite; (4) runtime
acceptance of exactly the generated result/authority contract; (5)
headless and framework client projection preserving nullability, identity,
and lifecycle meaning; (6) one negative case reaching a stable diagnostic
naming the semantic fact and repair. Rows marked "steps 1–3 + 6" are
pure refusal-path fixtures whose semantic fact is the refusal itself;
steps 4–5 lawfully do not apply to them. Fixtures run from packed external
packages, are cheap enough for affected-scope use, and bind semantic facts
and advertised entrypoints — never internal lowering syntax (LLP 0295
Risk 8). Where a Familiar/Explicit pair below marks a shared semantic
fact, the pair must witness the same normalized contract for the
intended-equal facts. R6 (profile-switch suggestions) deliberately has no
fixture of its own: it is a diagnostic-content rule, and every
disposition-4 refusal fixture below (VCF-F-N1, VCF-F-D4, VCF-F-SQ1)
asserts in its step 6 that the refusal names the Explicit route and that
no switch suggestion appears on any fixture's success path — adding a
separate fixture would duplicate those assertions.

**Familiar coherence lane — one fixture per supported result kind plus
the parity/dialect cases:**

| Fixture | Path under test (S4.3 row / capability) | Step-6 negative |
| --- | --- | --- |
| VCF-F-G1 | clean-checkout one-pass generation of an app whose functions use `v.doc` results (R1) | `v.doc("missingTable")` refuses naming the unknown table pre-output |
| VCF-F-Q1 | query `v.array(v.doc(t))` → `results.documents` | doc array of undeclared table refuses |
| VCF-F-Q2 | query `v.array(v.object({...}))` → `results.records` | runtime row with an extra undeclared field rejects at the contract |
| VCF-F-Q3 | query bounded `v.array(v.object, {maxItems})` → bounded `results.records` | over-bound runtime result rejects with the contract diagnostic |
| VCF-F-Q4 | query `v.array(v.union(record arms))` → record-union `results.records` | runtime row matching no union arm rejects at the contract |
| VCF-F-Q5 | query 1-tuple `v.tuple([v.object({...})])` → `{minItems:1, maxItems:1}` | empty runtime result rejects |
| VCF-F-Q6 | point query `v.union([v.doc(t), v.null()])` → `results.value` end to end (R3: lowering is already green on current source; this fixture gates the generated-type, runtime-admission, and client layers) | handler returning a wrong-table doc rejects at the contract |
| VCF-F-Q7 | live query closed `v.object({...})` → `results.value` (R3 confirmed divergence) | extra undeclared field rejects |
| VCF-F-Q8 | scalar value query (e.g. `v.number()` count) → `results.value` | wrong-type return rejects |
| VCF-F-M1 | mutation `returns: v.doc(t)` → `results.document` executes end to end (R1 runtime parity) | handler returning a partial object rejects |
| VCF-F-M2 | mutation value result `v.id(t)` → `results.value` | foreign-table id rejects |
| VCF-F-N1 | mutation doc-containing non-bare `returns` refuses `SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` with the explicit route (steps 1–3 + 6 only) | the fixture is the negative |
| VCF-F-A1 | action value result composing `ctx.runMutation(api.x.y, args)` | raw-string ref refuses `SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED` |
| VCF-F-D1 | dialect boundary: the supported rewrite of dynamic computed access — static/destructured access or the value passed through `args` — authored end to end | the `array[i]` dynamic-access form refuses pre-output naming exactly that rewrite |
| VCF-F-D2 | dialect boundary: the same helper authored as a bounded-graph helper module per S2 and imported into the handler graph, end to end | an out-of-graph helper import refuses naming the S2 helper-module path as the one rewrite |
| VCF-F-D3 | dialect boundary: the constant's value inlined or passed through `args`, end to end | a captured top-level constant refuses (the free-identifier family) naming exactly that rewrite |
| VCF-F-D4 | dialect boundary: clock-dependent visibility (`Date.now`) refuses pre-output with the single supported rewrite — the Explicit profile's temporal vocabulary (`boundedSkew`/`standardPattern` route, disposition 4) (steps 1–3 + 6) | the fixture is the negative |
| VCF-F-E1 | ephemeral declaration authored via `defineEphemeral` + `ephemeral` collection builder imported from the advertised entrypoints (S3.1/S3.2), membership-backed typing, presence roundtrip (R4) | an import via the retired `_generated/` spelling gets the S2 rule 7 retired-spelling diagnostic naming the supported specifier |
| VCF-F-AS1 | `defineAssetUpload` MP4 intent upload/readback via `api.media.videoUpload` (recasts the existing acceptance with steps 1 and 6) | oversized/wrong-media upload refuses per policy |
| VCF-F-MB1 | membership visibility with `resourceField: "_id"` (resource table) and child resource-id field, enforced through `ctx.db` (R5) | non-member read hides the row; misspelled resource field refuses at generation |
| VCF-F-SQ1 | sequence allocation attempt refuses with the stable disposition-4 route to Explicit (steps 1–3 + 6) | the fixture is the negative |

**Explicit economy lane — one fixture per advertised Explicit path; the
plan-derived rows are the LLP 0275 D3 receipts:**

| Fixture | Path under test | Step-6 negative |
| --- | --- | --- |
| VCF-E-Q1 | live query `results.documents` | wrong-table rows reject |
| VCF-E-Q2 | query `results.records` | non-conforming record rejects |
| VCF-E-Q3 | point query `results.document` | wrong-table doc rejects |
| VCF-E-Q4 | scalar query `results.value` | wrong-type value rejects |
| VCF-E-M1 | mutation `results.document` | partial document rejects |
| VCF-E-M2 | mutation `results.value` | wrong-type value rejects |
| VCF-E-P1 | plan `returnBinding` of a typed insert with **no authored `result:`** — plan-derived `v.id(t)` contract (LLP 0275 D3) | conflicting authored `result:` fails generation |
| VCF-E-P2 | plan `returnChangedCount`, plan-derived integer contract | conflicting authored contract fails generation |
| VCF-E-P3 | plan `returnDocument(table, id)`, plan-derived document contract | underivable `returnExpr` stays `unknown`/authored, never widened |
| VCF-E-P4 | closed declarative plan's table dependency set derived from the plan with no duplicate authored transcription (LLP 0295 W3 dependency-fact derivation; LLP 0275 D8 class 2) | a conflicting authored dependency declaration fails generation |
| VCF-E-L1 | recurring fixed lifecycle wiring supplied by template scaffolding (LLP 0295 W3; LLP 0275 P5/P7): scaffold → install → generate → dev → prove with zero hand-authored lifecycle ceremony | a template with a missing scaffolded lifecycle stage fails the cold-install gate with the stage named (LLP 0275 D6) |
| VCF-E-MB1 | membership/authority visibility declaration — same semantic fact as VCF-F-MB1; the pair proves one shared spelling across profiles | non-member read hides the row |
| VCF-E-E1 | ephemeral collection declaration and presence roundtrip | undeclared-collection use refuses |
| VCF-E-AS1 | asset upload intent policy and authorized readback | policy-violating upload refuses |
| VCF-E-SQ1 | sequence allocation (the positive twin of VCF-F-SQ1's route) | exhausted/invalid allocation gets the stable diagnostic |

VCF-E-P1..P4 gate the LLP 0275 D3 (and dependency-derivation) closure when
it lands; until then the
authored-contract spellings of those paths are the advertised path and the
fixtures run in authored form with the plan-derived form added at closure.
VCF-E-L1 is the recurring-lifecycle-scaffolding receipt LLP 0295 W3 names
for the Explicit economy lane; it binds the LLP 0275 D6 cold-install
closure, not a new lifecycle mechanism (D0.1/W1 own lifecycle design).
`issues/20260821-authoring-profile-vertical-contract-fixtures.md` is the
execution ticket and carries the lane checklists.

## Acceptance for this Spec

1. Every S4 lowering and S6.2 projection row has a committed test; the
   S4.3 and S4.5 lowerings have golden vectors (including refusal rows)
   and adversarial no-drop proofs; the S4.4 facade has own-property tests.
2. The Phase A disposition completeness gate enumerates every canonical
   definition field with one of the four LLP 0252 dispositions and fails
   closed on any uncovered field; Appendix A is its authored seed.
3. The dual-profile todo fixture proves normalized equivalence (names
   included) and identity separation (LLP 0252 Acceptance 1), and a
   landing-time proof shows no existing explicit `semanticId` rotated
   (bundle/generation ids rotate ordinarily with the new artifact; the
   proof binds to the semantic preimage only).
4. No production behavior branch on `authoringProfile` outside the S5.4
   allowlist (LLP 0252 Acceptance 2).
5. All new codes appear in the regenerated diagnostics registry with guide
   anchors; the S6.2 error-class table is committed data reviewed against
   the registry.

## Open questions

1. **Bounded doc-array returns** — whether `results.documents` should gain
   an optional bound (canonical-grammar RFC territory) so
   `v.array(v.doc(t), {maxItems})` stops refusing; v1 refuses honestly.
2. **Scalar query results (resolved 2026-08-15)** — LLP 0108 owns the
   canonical single-value query carrier; S4.3 lowers the Convex-`get` shape
   and other exact `v.*` values onto it.
3. **Offline typed rejection** — whether today's `queue: false` transport
   failure already surfaces as `SnapbackDiagnosticError` pre-custody
   (S6.3); Phase C verifies and hardens.

## Appendix A — v1 disposition table for canonical authored keys

Dispositions per LLP 0252 D1: **1 direct**, **2 profile default**,
**3 reviewed suggestion**, **4 unsupported (stable refusal + route)**.
This table is the authored seed of the Phase A generated gate; the
generated table over the canonical definition schema is normative once it
lands, and must fail closed on any field absent from both.

**Function-spec keys (union of the canonical closed key sets):**

| Canonical key | v1 familiar disposition |
| --- | --- |
| `args` | 1 — `args` |
| `result` | 1 — from familiar `returns` (S4.3) |
| plan-return `returns` | 4 — unreachable; explicit profile route |
| `auth` | 1 — verbatim enum; omission refuses (never inferred) |
| `reads` / `writes` (JS forms) | 1 — `reads`/`writes`; absence suggestion-backed (disposition 3, addition-only) |
| `source` / `exportName` / `js` | 2 — supplied by the adapter (inline-handler lift); not authored |
| `handler` | 1 — inline handler |
| `refusals` / `trackedRefusals` | 1 — verbatim |
| `retainable` | 1 — optional extension key (S4.1) |
| `authScopeField` | 1 — optional extension key (S4.1) |
| `defaultLive` | 2 — derived from `delivery` (S4.6); not authored |
| `table` / `filter` / `order` / `limit` / `index` / `membership` (declarative query keys) | 4 — declarative plan queries; explicit profile route |
| `plan` (mutation/action) | 4 — declarative plans; explicit profile route |
| `stream` | 4 — explicit profile route |
| `sequences` | 4 — explicit profile route (LLP 0252 D2 pin) |
| `uses` | 1 — from familiar `secrets` (actions only) |
| `effects` (LLP 0249 key) | 4 — unreachable by construction (S4.4 stubs); LLP 0249 route |
| `runtime` (LLP 0249 key) | 4 — LLP 0249 route |
| `requires` (auth assurance) | 4 — explicit profile route |
| `authorityIndependent` / `authorityCreating` | 2 — profile defaults (`false`); non-default requires explicit profile |
| `authorizationDependence` | 2 — derived as for canonical JS forms |
| `fieldBoundary` | 4 — explicit profile route |
| `boundedSkew` | 4 — explicit profile route |
| `standardPattern` | 4 — explicit profile route |
| `publicInline` | 4 — explicit profile route |
| `outgrewIr` | 4 — explicit profile route (JS-mutation escape marker; the familiar grammar has no IR form to outgrow) |

**Constructor families:** `query`/`mutation`/`action` lower to the JS
query (live or one-shot) / JS mutation / action forms (disposition 1 via
S4). `defineSearchQuery`, `defineVectorQuery`, `defineLiveSearchQuery`,
`defineBoundedChildrenQuery`, `defineSnapshotBatchQuery`,
`defineRelationalQuery`, `defineJobStatusQuery`, `definePushLedgerQuery`,
`defineWriteWithActivity`, `defineCron`, `defineRoutes`, `defineCommand`,
`defineSurface`, `defineMaintainedProjection`,
`defineConfig`, `definePushSeam`,
`defineAuth` — disposition 4 in the familiar *function-module* grammar
(stable refusals routing to the explicit profile or the D5 extension
vocabulary). `defineEphemeral` and the `ephemeral` collection builder are
disposition 1 as **schema-declaration vocabulary** (shared verbatim,
consumed by the schema-level `ephemeral` option and re-exported from the
advertised entrypoints per S9.1 R4, 2026-08-21); they remain disposition 4
as function-module authored-value exports. `defineAssetUpload` is
disposition 1 as a top-level Familiar
module export under the explicit-asset amendment above;
`defineSchema`/`defineTable`/`v`/`allow` are disposition 1 (shared,
verbatim).

**Table-builder methods:** `.index()` — 1 (the S4.5 target). `.sync()` —
2 (profile default **on**, per S4.6 live-by-default; an authored
`.sync()` call is admitted verbatim). `.searchIndex()` / `.vectorIndex()`
/ `.searchLiveLimits()` — 4 (their consuming query forms are
disposition 4). `.history()` / `.permissionBacking()` / `.membership()` /
`.authorityProfile()` / `.visibility()` / `.assetSharing()` /
`.memberOf()` / `.hasRole()` — 1 (schema authority vocabulary is shared
verbatim; D5 keeps Snapback authority first-class). Schema-level
`defineSchema` options (`ephemeral`, `auth`, `authProgram`,
`requiredCapabilities`) — 1 (shared verbatim; the LLP 0214 §22 fields
carry the dispositions in the Auth-program paragraph below).

**Auth-program fields:** `version`, `mechanisms`, `providers`,
`assuranceRequirements`, `recoveryPolicy`, `guestPolicy`, `secretReferences`, and
`verifiedProvisioning` are disposition 1 through the shared auth extension.
`custody` is disposition 2: Familiar supplies `durable-required` and refuses
`volatile-explicit`. `externalSessionEntry` is disposition 1 through the same
explicit advanced-session extension. Both profiles then consume the one
normalized auth-program record; no runtime profile branch is introduced.

## Status

Draft, r3. Review history: r1 — both families NOT READY (12 MATERIAL,
`llp/reviews/0253-familiar-profile-v1-api.{codex,grok}.md`); r2 — repairs
confirmed for 10 of 12, both families NOT READY on delta with 8 in-delta
MATERIALs (~6 distinct; grok-r2 artifact + codex delta); r3 — closes
every r2-delta MATERIAL as summarized in the revision note.
Implementation (S8 Phase A/B) proceeds against r3 under LLP 0252's law;
MATERIAL findings against r3 text revise before the affected phase lands.
