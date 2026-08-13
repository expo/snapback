# UNIONFIX report

Date: 2026-08-12  
Merge reconstructed: `c6a8be9699e6a8ca5b8f89eed14316588a963945`  
Integration parent: `4b0673397c8b38c51cb6737fee064a3ebb50aa01`  
Media parent: `5190b7cce006e8ff1bdbc1beebeb73b7d984ffb9`

## Reconstruction

### `scripts/check-package-test-inventory.mjs`

The integration parent declares 262 tests. The media parent declares 256.
Their set union contains 263 tests: 255 entries are shared, seven occur only
on the integration side, and one occurs only on the media side. The final
inventory has no duplicate entry, no registered-but-absent file, and no
on-disk test absent from its package scripts.

| Package inventory | Integration | Media | Union | Integration-only entries | Media-only entries |
| --- | ---: | ---: | ---: | --- | --- |
| `snapback-maturity-records` | 2 | 2 | 2 | — | — |
| `@expo/snapback-runtime-darwin-arm64` | 1 | 1 | 1 | — | — |
| `@expo/snapback-runtime-linux-x64` | 1 | 1 | 1 | — | — |
| `@expo/snapback-sidecar` | 1 | 1 | 1 | — | — |
| `create-snapback-app` | 1 | 1 | 1 | — | — |
| `@expo/snapback-cli` | 23 | 22 | 23 | `generate-check.test.mjs` | — |
| `@expo/snapback-vite` | 3 | 3 | 3 | — | — |
| `@expo/snapback-client` | 63 | 62 | 63 | `reference-kind.test.mjs` | — |
| `@expo/snapback-hosted-supervisor` | 12 | 12 | 12 | — | — |
| `@expo/snapback-publication-authority` | 4 | 4 | 4 | — | — |
| `@expo/snapback-react` | 19 | 19 | 19 | — | — |
| `@expo/snapback-expo` | 9 | 9 | 9 | — | — |
| `@expo/snapback-app-cli` | 11 | 11 | 11 | — | — |
| `@expo/snapback-codegen` | 60 | 56 | 61 | `client-lifecycle.test.mjs`; `handler-graph-parity.test.mjs`; `handler-runtime-profile.test.mjs`; `semantic-generation-golden.test.mjs`; `semantic-generation-rotation.test.mjs` | `media-field-authoring.test.mjs` |
| `@expo/snapback-contract` | 41 | 41 | 41 | — | — |
| `snapback-admin-ui` | 11 | 11 | 11 | — | — |
| **Total** | **262** | **256** | **263** | **7** | **1** |

The changelog retains all parent-side blocks in commit chronology:

1. `255 -> 257` — LLP 0237 rollout 1.
2. `257 -> 258` — LLP 0237 rollout 2.
3. `258 -> 260` — LLP 0241 rollout 1.
4. `260 -> 262` — LLP 0238 rollout 1.
5. `262 -> 263` — LLP 0244 media projection, committed after the integration-side blocks.

`expectedTotal` is 263.

### `packages/snapback-codegen/package.json`

The final manifest preserves every field from both parents. The media parent
has no file/export entry absent from the integration parent. The following
integration-only publication entries are restored:

- `files`: `client-lifecycle.d.mts`, `client-lifecycle.mjs`,
  `handler-runtime-profile.d.mts`, `handler-runtime-profile.mjs`, and
  `semantic-generation.mjs` (45 union entries; 40 shared).
- `exports`: `./handler-runtime-profile` and `./client-lifecycle` (22 union
  entries; 20 shared).

Command union, with every command present exactly once:

| Script | Shared commands | Integration-only | Media-only | Final union |
| --- | ---: | --- | --- | ---: |
| `pretest` | 1: `node generated-mutation-ir.test.mjs` | `node client-lifecycle.test.mjs` | `node media-field-authoring.test.mjs` | 3 |
| `test` | 55 | `node handler-runtime-profile.test.mjs`; `node handler-graph-parity.test.mjs`; `node semantic-generation-golden.test.mjs`; `node semantic-generation-rotation.test.mjs` | — | 59 |

The canonicalizer fix at integration-parent head `4b0673397c8b` adds its exact
TypeScript-IbexModule regression to `semantic-generation-golden.test.mjs`.
That test was already named by the integration parent's chain and remains in
the final union.

The on-disk `packages/snapback-codegen/*.test.mjs` set has 61 entries and is
identical to the final codegen inventory: zero missing and zero extra.

Mechanical comparison result:

```text
EXACT_UNION_PASS inventories=263 codegen-tests=61 package-files=45 package-exports=22 pretest-commands=3 test-commands=59
```

## Verification tails

### `node scripts/check-package-test-inventory.mjs`

Exit 0 — PASS. Verbatim tail:

```text
[package-test-inventory] @expo/snapback-codegen: 61
[package-test-inventory] @expo/snapback-contract: 41
[package-test-inventory] snapback-admin-ui: 11
[package-test-inventory] PASS: 263 declared test files
```

### `node scripts/check-inventories.mjs`

The package-test audit is PASS at 263. The exact aggregate command exits 1
because the out-of-scope generated guide reference corpus is stale; the
charter permits touching neither those guide files nor their registry. The
failure list contains no `package-test` failure.

Verbatim package-test audit result from the same exported runner:

```text
[check-inventories] package-test PASS: 263 package tests
[check-inventories] unrelated failures: guide-manifest
```

Verbatim tail from the exact aggregate command:

```text
[symbol-registry] guide/reference/expo-snapback-expo--supervised-environment.md: stale
[symbol-registry] guide/reference/expo-snapback-cli--verify.md: stale
[symbol-registry] guide/reference/expo-snapback-codegen--ctx.md: stale
[symbol-registry] guide/reference/registry.json: stale
  registration step: fix any guide source errors, run node scripts/generate-guide-manifest.mjs, and commit both generated guide projections
```

### `env -u FORCE_COLOR npm test --workspace @expo/snapback-codegen`

Exit 0 — PASS. The restored pretest and test commands all executed. Verbatim
tail:

```text
app-descriptor.test.mjs: all cases passed
app-inspection.test.mjs: all cases passed
remote-service-publication.test.mjs: all cases passed
data-tier-corpus.test.mjs: 37 cases verified; builder-parity assertions passed
✔ auth v1 cross-language crypto vectors remain exact (2.597917ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 9.033333
codegen review surface: cold cache, tamper, legacy, custody, failure atomicity, and summaries verified
```

No commit was created.
