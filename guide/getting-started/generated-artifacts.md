---
title: Generated artifact custody and review
id: getting-started.generated-artifacts
order: 3
audience: agent-first
capabilities: [backend.codegen]
authorities: [llp/0010-agent-dx-and-acceptance.spec.md, llp/0012-headless-integration-contract.spec.md, llp/0021-contract-exact-integration-hardening.plan.md, llp/0037-schema-source-of-truth.decision.md, llp/0041-packaged-dev-loop.rfc.md, llp/0252-convex-familiar-authoring-profile.rfc.md, llp/0253-familiar-profile-v1-api.spec.md, packages/snapback-codegen/review-surface.mjs, packages/snapback-codegen/review-manifest.schema.json, packages/snapback-codegen/codegen-policy.schema.json, packages/snapback-codegen/familiar.mjs, packages/snapback-codegen/index.mjs, packages/snapback-codegen/semantic-generation.mjs, schemas/normalized-definition.v1.schema.json]
examples: [packages/snapback-codegen/review-surface.test.mjs, packages/snapback-codegen/familiar-phase-a.test.mjs, packages/snapback-codegen/familiar-phase-b.test.mjs, tests/fixtures/familiar-todo, tests/fixtures/familiar-todo-explicit, packages/snapback-codegen/contract-output-mode.test.mjs, packages/snapback-cli/templates/react, demos/todo-v2/snapback/codegen.policy.json]
status: current
targets: [all]
maturity: shipped
reviewed: 2026-08-13
reviewed-authorities-digest: sha256:9b290526df1e485e0c4a2818c3b4f4a0d3060a88b5526911e8faeac8e0de8163
---

# Generated artifact custody and review

Codegen separates reviewable source control state from regenerable build
output. One complete input hash names one complete generated graph; every file
in that graph has a SHA-256 digest and byte count.

## Know what belongs in source control

There are exactly three custody classes:

- `review-manifest`: `snapback/generated/artifacts.json`. Commit this file. It
  is the deterministic review projection for the whole graph.
- `consumer-committed`: a projection that a source-only consumer or CI policy
  explicitly needs. Commit only the paths listed in `committedProjections` in
  `snapback/codegen.policy.json`, and add matching negations to the app's
  `.gitignore`. The closed policy record uses
  `schemaVersion: "snapback.codegen-policy.v1"`.
- `regenerable-cache`: every other generated projection. These bytes live
  under `.snapback/codegen-cache/<inputsHash>/` and are ignored.

Snapback's maintained demos, including the backend bakeoff, use this
manifest-only policy. Existing external repositories may retain a committed
legacy `generated/` tree while they migrate; that compatibility is deliberately
limited to pre-v2 manifests and explicitly declared `consumer-committed`
projections. It is not an exception for new repository-owned demos. The admin
UI's separately generated bindings remain under their existing dedicated
generator and CI gate because they are not a Snapback backend graph.

<!-- since: 0.1.21 -->

## Choose Exact metadata output explicitly

Ordinary React, Expo, and headless generation is Contract-neutral. It still
emits `contract-data.manifest.json`, generated function references, callable
modules under `generated/contract/`, and `contract/runtime-links.ts`; none of
those imports Exact. It omits only rendered modules that import an `@exact/*`
package, currently the `.contract-meta.ts` sidecars.

If the project compiles `.contract` files against those sidecars, opt in with a
committed `snapback/codegen.policy.json`:

```json fragment reason="minimal codegen policy; applications preserve any existing committed projections"
{
  "schemaVersion": "snapback.codegen-policy.v1",
  "committedProjections": [],
  "contractMetadata": "exact"
}
```

Keep any existing `committedProjections` instead of replacing them. Commit the
policy and regenerate. The policy is part of the complete input hash, so its
Exact-enabled graph has a different freshness identity and artifact inventory
from the neutral graph. Installing `@exact/contract` does not enable the output
implicitly; package-presence probing would make generation irreproducible.

For published Snapback 0.1.20 and earlier, an npm-only app that does **not**
consume Contract can temporarily keep the unavailable Exact sidecars out of a
broad TypeScript program:

```json fragment reason="temporary tsconfig mitigation for published generators before explicit output selection"
{
  "exclude": ["snapback/generated/contract"]
}
```

That exclusion hides neutral bindings too, so it is mitigation for older
published generators, not the desired steady state. After upgrading to a
closure with explicit output selection, regenerate without the opt-in and
remove the exclusion; broad `tsc --noEmit` and lint should include the generated
TypeScript normally.

## Regenerate one complete graph

```sh
snapback generate snapback
snapback generate snapback --json
```

The human result inventories tables, operations by kind, live and ephemeral
counts, file custody, warnings, and degraded result types. A degraded result
links the authored export or schema field to the generated type and gives an
exact remediation. `--json` returns the same deterministic summary and structured
diagnostics.

<!-- since: 0.1.21 -->

Run `snapback generate snapback --check --json` when you need the complete
ordinary checker without replacing generated bytes. It discovers and
evaluates definitions, admits handlers and target capabilities, checks
contracts, renders and inventories the full temporary candidate, and then
discards that candidate before publication. Ordinary generation shares that
path and differs only at the final complete-graph publication step.

Successful generation and preflight include
`handler-runtime-profile.v1.json` in the candidate inventory. Its review record
uses logical kind `handler-runtime-profile` and consumer
`developer-tooling`. See the [handler runtime profile](../backend/handler-runtime.md)
for module, syntax, global, target, diagnostic, and per-operation selection
fields.

Generation writes a temporary complete graph, digests it, atomically publishes
the hash-addressed cache, verifies it, then atomically materializes
`snapback/generated/` for import compatibility. A hard generation or write
failure leaves the previously serveable graph intact.

## Consume through the manifest

The packaged dev loop, runtime load, release builder, app CLI, Vite lifecycle,
Contract validation, and CI resolve generated files through `artifacts.json`.
A missing or tampered cache produces `SNAPBACK_CODEGEN_CACHE_INVALID`; run
`snapback generate snapback` to reconstruct it. Only a digest-matching
`consumer-committed` projection may be read without the cache. Codegen never
serves an unverified materialized cache projection as a stale fallback.

A release closes over the verified cache graph, not whatever files happen to
remain in `generated/`. CI regenerates from a cold cache, verifies every
digest, and diffs the review manifest plus explicitly committed consumer
projections.

## Inspect the normalized definition and source profile

Every generated graph contains `normalized-definition.v1.json`. It projects
the canonical application schema and operation contracts without app address,
source profile, handler behavior, or source-graph custody. Use its
`normalizedContractId` to compare complete contract facts and its
`normalizedSchemaId` for the schema-only migration closure. Both identities
also appear in `artifacts.json` and the immutable generation envelope.

The schema and function manifests and `app.descriptor.json` record the resolved
`authoringProfile`. Omitting the optional `codegen.policy.json` key is exactly
`"snapback-explicit-v1"`; that default spelling is deliberately absent from
the semantic-identity preimage. `"snapback-familiar-ts-v1"` is the other
versioned policy value, used by the familiar source adapter as that phased
surface becomes available.

### Diagnose SNAPBACK_CODEGEN_AUTHORING_PROFILE_INVALID

This refusal means `codegen.policy.json` supplied an `authoringProfile` other
than `"snapback-explicit-v1"` or `"snapback-familiar-ts-v1"`. Correct the
closed policy record and regenerate. Codegen leaves the previously generated
graph untouched when policy validation fails.

<!-- since: 0.1.21 -->

## Author with the familiar TypeScript profile

Select `"snapback-familiar-ts-v1"` only in `codegen.policy.json`. A familiar
backend has a required top-level `schema.ts`, top-level function modules such
as `todos.ts`, optional helper modules, and generated imports under
`_generated/`. On a clean checkout, codegen synthesizes `_generated/server`
and `_generated/api` before it evaluates definitions, so imports from those
modules work on the first generation.

The constructors are `query`, `mutation`, and `action`. Every function must
declare `args`, `returns`, `auth`, and `handler`. Queries also declare `reads`;
mutations declare `reads` and `writes`; actions may declare `secrets`. Query
delivery defaults to live and accepts only `"live"` or `"read"`. The complete
working source is the [familiar todo fixture](repo:tests/fixtures/familiar-todo),
and its [explicit twin](repo:tests/fixtures/familiar-todo-explicit) demonstrates
the equivalent string-export spelling.

Each top-level module becomes an API namespace: `todos.ts` exporting `list`
defines the canonical operation name `todos.list` and generated reference
`api.todos.list`. Explicit modules spell the same canonical name with an
ES2022 string export such as `export { listImpl as "todos.list" }`. Generated
references in both profiles hydrate `authoringProfile` from the descriptor's
single app-level fact, derive query `delivery` from the nominal reference kind,
and supply the default `retention` fact at binding time. Only non-default
retention is serialized per reference. `normalized-definition.v1.json`
deliberately excludes the source profile so equivalent definitions can compare
equal without erasing the profile from semantic and generation identity.

Familiar query/mutation handlers use the canonical context. The callback form
of `withIndex` accepts only one `eq`/`in`/`lt`/`lte`/`gt`/`gte` chain and
replays every recorded predicate. Familiar actions expose only `auth`,
`runtime`, `secrets`, `refuse`, `isDirectHuman`, generated-reference
`runMutation`, and refusing `runQuery`/`fetch`/`fetchStream` stubs. Use the
explicit profile for other action host effects or declarative plans.

### Diagnose familiar profile refusals

| Code | Repair |
| --- | --- |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPLICIT_SOURCE_PRESENT` | Remove `schema.mjs`, `functions.mjs`, and `routes.mjs`, or select the explicit profile. |
| `SNAPBACK_CODEGEN_EXPLICIT_FAMILIAR_SOURCE_PRESENT` | Remove `schema.ts` and top-level familiar imports, or select the familiar profile. |
| `SNAPBACK_CODEGEN_FAMILIAR_MODULE_PATH_UNSUPPORTED` | Keep function modules at the backend root; nested modules are helpers only. |
| `SNAPBACK_CODEGEN_FAMILIAR_RESERVED_MODULE_UNSUPPORTED` | Move `crons.ts`/`http.ts` behavior to the explicit `defineCron`/`defineRoutes` vocabulary. |
| `SNAPBACK_CODEGEN_FAMILIAR_EXPORT_UNSUPPORTED` | Export only familiar function values from a function module; move exported helpers to a helper module. |
| `SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED` | Remove the named unsupported key or follow its diagnostic route to the explicit profile. |
| `SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING` | Add the exact canonical `auth` value: `"public"`, `"optional-user"`, or `"authenticated"`. |
| `SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE` | Use the diagnostic's shape-specific list/value route; for a missing declaration, review the generated LLP 0245 suggestion. |
| `SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID` | Use `"live"` or `"read"`. |
| `SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED` | Return one canonical chained range expression from the callback. |
| `SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED` | Use an explicit-profile action when action-to-query composition is required. |
| `SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED` | Pass the generated `api.module.mutation` reference, never a string or reconstructed object. |
| `SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED` | Use the explicit profile for `fetch` or `fetchStream`. |
| `SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC` | Use a static two-member reference such as `api.todos.create`; computed or escaping API access is not admitted. |
| `SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION` | Rename operations whose dotted/camel spellings produce the same generated local binding. |
| `SNAPBACK_CLIENT_REFERENCE_PROFILE_MISMATCH` | Pass a reference generated for the client alias's admitted profile, or use a canonical client verb that accepts both profiles. |

Vite rewrites relative imports beneath a `generated` or
`generated-<target-profile>` directory to the verified cache file. This covers
the React/client API import and Contract's generated descriptor and
`runtime-links` imports without changing their author-friendly source spelling.
Node scripts do not have a bundler hook, so they call
`resolveGeneratedArtifact(generatedRoot, artifactPath)` before reading JSON or
dynamically importing a generated module.

## Review a codegen change

Review `artifacts.json` beside the source change. Its stable summary shows the
surface-size change, while `files` shows the content digest, logical kind,
custody, consumer, and regeneration command for every projection. Identical
inputs produce byte-identical review manifests and summaries.

If a consumer truly cannot regenerate, declare its exact projection path in
`snapback/codegen.policy.json`; do not commit the whole graph. Re-run codegen and
the review manifest will record the new custody.

## Anti-patterns

- **Do not import arbitrary files from an unverified cache path.** Resolve
  through the review manifest.
- **Do not hand-edit `generated/` or `.snapback/codegen-cache/`.** Regenerate;
  digest verification treats edits as tampering.
- **Do not add the whole generated tree to `committedProjections`.**
  Custody is a narrow consumer need, not a way to restore noisy diffs.
- **Do not fall back to stale materialized projections after a cache error.**
  Regenerate or fail closed.
