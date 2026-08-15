# LLP 0253: Convex-familiar profile v1 — API and adapter specification

**Type:** Spec
**Status:** Draft
**Systems:** Developer experience, Authoring, Application data API, TypeScript,
Code generation, React, Client integration, Packaging, Documentation, Testing
**Author:** Claude (Fable 5) / Charlie Cheever
**Date:** 2026-08-13
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
LLP 0127, LLP 0130, LLP 0037, LLP 0203

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
   `.mts` file except `schema.ts` is scanned: a file is a **function
   module** iff at least one of its named exports is a familiar function
   value (`query(...)`, `mutation(...)`, `action(...)`); otherwise it is a
   **helper module**, admitted under the existing LLP 0237 bounded-graph
   rules with no further constraint. A function module whose other named
   exports are not familiar function values refuses
   (`SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED`) — mixing functions and
   exported helpers in one module is the one shape the classifier cannot
   attribute, so it is refused rather than guessed.
2. **Subdirectories may hold helper modules** (they are reached only by
   import, under the same bounded-graph admission). Function modules must
   be top-level: if any imported module below the top level exports a
   familiar function value, generation refuses
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
| `@expo/snapback/server` | `defineSchema`, `defineTable`, and `defineAssetUpload` from the canonical define module; the familiar `query`, `mutation`, `action` constructors (S4) from `@expo/snapback-codegen/familiar` |
| `@expo/snapback/values` | `v` (the existing canonical validator grammar, unchanged) |
| `@expo/snapback/react` | the familiar React entrypoint `@expo/snapback-react/familiar` (S6) |

Rationale: LLP 0252 OQ1 recommends the umbrella because import coherence is
part of the learned surface; the round-4 Grok pin requires the familiar
React aliases to live in an entrypoint withdrawal can delete whole. Both
are satisfied: the umbrella owns no implementation — every symbol lives in
an existing package under a `familiar`-named module that can be removed
with the umbrella. Publication inventory cost is one extra package and is
recorded in the LLP 0252 D7 maintenance ledger.

### S3.2 Generated local modules

- `generated/server.{mjs,d.ts}` re-exports `query`, `mutation`, `action`
  bound to the application's schema types (typed `ctx.db`, typed
  `v.doc`/`v.id` table names). It exists so the learned import
  `import { query, mutation } from "./generated/server"` works verbatim
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
asserts no production source under `src/`, `packages/snapback-client`,
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
`defineConfig`, `defineEphemeral`/`ephemeral`, `definePushSeam`,
`defineAuth` — disposition 4 in the familiar *function-module* grammar
(stable refusals routing to the explicit profile or the D5 extension
vocabulary). `defineAssetUpload` is disposition 1 as a top-level Familiar
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
`requiredCapabilities`) — 1 (shared verbatim).

## Status

Draft, r3. Review history: r1 — both families NOT READY (12 MATERIAL,
`llp/reviews/0253-familiar-profile-v1-api.{codex,grok}.md`); r2 — repairs
confirmed for 10 of 12, both families NOT READY on delta with 8 in-delta
MATERIALs (~6 distinct; grok-r2 artifact + codex delta); r3 — closes
every r2-delta MATERIAL as summarized in the revision note.
Implementation (S8 Phase A/B) proceeds against r3 under LLP 0252's law;
MATERIAL findings against r3 text revise before the affected phase lands.


## Amendment — 2026-08-13 (ratified)

LLP 0255 S3.5's proposed amendment to this document — table builder
`.data(...)` is admitted as shared schema vocabulary (disposition 1) in
both profiles with LLP 0255 S1.1's closed key matrix; `.sync()` is
unchanged for non-data tables, refuses as authored on `.data` tables,
and the familiar profile's automatic call is tagged
`source:"profile-default"` — was ratified by the author on 2026-08-13
after the LLP 0255 super-refine loop closed (run journal:
`llp/reviews/0255-tiny-data-surface-v1-api.run.md`). The normative
amendment text lives in LLP 0255 S3.5 and applies to this document as
law; implementation lands with the LLP 0254 phase that consumes it.
