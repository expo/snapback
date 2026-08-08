# LLP 0194 execution: canonical symbol registry + generated API reference

**Status:** Open — native/Rust projections implemented locally; published ctx declaration remains
**Impact:** 5
**Urgency:** 4
**Ease:** 2
**Confidence:** 4
**Systems:** Guide, Documentation, Client packages, Types, Build, CLI
**Date:** 2026-08-08
**Related:** LLP 0194 (governing RFC, Review at r8/r9), LLP 0198 P1,
diaries 0068/0069, issues/20260808-ctx-db-verbs-undocumented.md,
issues/20260808-headless-args-shape-guide-snippet.md,
issues/20260808-verify-config-authoring-guide-anchor.md

Execute LLP 0194's design: (1) a build-bound canonical symbol registry
emitted by a TypeScript-compiler-API build step over the published
packages' `.d.mts` declarations (`@expo/snapback-client`,
`snapback-react`, `snapback-expo`, `@expo/snapback-cli/verify`), with
value-space runtime export parity + type-space non-runtime kinds
(Acceptance 1 as revised in r8); (2) generated size-bounded Markdown
under `guide/reference/` + compact index, committed in the
`generate-guide-manifest` pipeline and checked like the flat guide;
(3) budgeted exact-symbol lookup via `snapback guide <exact-symbol>`
and the docs-only MCP surface; (4) serving under
`/_snapback/guide/reference/` + `/llms.txt` listing; (5) the cold
signature-task acceptance suite (zero package-source reads / zero
binary-string excavation). OQ2 (ctx declaration placement): lane
proposes, orchestrator ratifies, author can override.

## 2026-08-08 execution log

### Landed in this lane

- `scripts/generate-symbol-registry.mjs` now uses the TypeScript compiler API
  to traverse 40 typed public modules across the four LLP 0194 package scopes.
  The one committed registry, `guide/reference/registry.json`, contains 845
  top-level symbols: 366 runtime values and 479 explicit type-only records.
  Every record carries an `npm:<module>#<export>` stable identity, complete
  declaration text, overload/member groups, doc text/tags, source spans,
  runtime names/conditions, kind, and build-bound closure status.
- Two-way parity imports every applicable runtime entry. It caught and this
  lane repaired one real gap: the client root exported
  `rqsRetentionIneligibilityReason` at runtime without declaring it. The
  generated registry now passes exact value-space parity; type-space records
  remain explicitly exempt. The root `@expo/snapback-expo` declaration checks
  `import`/`default`; its `require` condition intentionally selects the config
  plugin, a different surface with typed `./app.plugin` and `./config-plugin`
  subpaths, and the exclusion plus reason is recorded in module metadata.
- The registry generates a compact index and 40 lossless per-module Markdown
  pages with stable anchors. The hard measured budgets are 256 KiB per module
  (the client root is about 208 KiB), 32 KiB for the compact index, and 16 KiB
  per exact lookup. `generate-guide-manifest.mjs` regenerates registry and
  Markdown first; `check-guide` and inventory audit run the parity/staleness
  check. The Guide manifest now has 106 pages plus a hash- and byte-bound
  `reference.symbol-registry` resource, and its content identity includes the
  registry bytes.
- The package-owned CLI intercepts exact `snapback guide <symbol|module>` hits
  from the bound registry, preserves native Markdown search for fuzzy misses,
  and emits either one exact member/symbol or a bounded module/symbol slice.
  Truncated answers list the exact signature/member ranges omitted and the
  next command; JSON and text answers carry Guide content/build identity and
  registry source identity. CLI help, packaging, and the maintained test
  inventory include this seam.
- Intent pages now join headless client, verify config, React fact types, and
  handler `ctx.db` teaching to the generated reference identities. The
  temporary `guide/reference/ctx-db-bootstrap.md` is explicitly non-registry,
  states the shipped generated verb/read-write split, and names its retirement
  trigger.
- `tests/generated-api-reference-v1.mjs` answers all five cold questions using
  a reader fenced to `guide/reference/`: headless args nesting, the
  `authClientProtocol: 1` + `custody: 'anonymous-public'` pair, `VerifyConfig`,
  React hook fact types, and `ctx.db` verbs. It reads five reference artifacts,
  no package source, and no binary bytes. `check-guide` runs it.

### OQ2 placement proposal — ratification requested

Publish the generic type-only handler context from
`@expo/snapback-codegen/ctx`, owned by a new
`packages/snapback-codegen/ctx.d.mts`. Codegen already owns handler authoring,
schema-derived generated data models, and the current exact `Generated*`
context declarations; putting the generic base there avoids making the
transport client or a framework binding authoritative for server handler
types.

Sketch:

- export schema-parameterized `QueryBuilder`, `QueryDatabase`,
  `MutationDatabase`, `QueryContext`, and `MutationContext` types from the
  type-only `./ctx` package subpath;
- parameterize them with generated row/index/insert/patch and table-admission
  maps, preserving the query/read-write split;
- make generated `api.d.ts` import, instantiate, and re-export that owner
  rather than redeclare the generic contract;
- add the module to the LLP 0194 registry as type-only (no runtime parity),
  delete/convert the bootstrap page, and fail CI if codegen and the published
  module define the same stable context identity instead of one importing the
  other.

The orchestrator should ratify the package/subpath name and whether a
types-only export condition without an empty runtime module is acceptable to
the publication tooling.

### Remaining Rust/native work (not changed by instruction)

HTTP serving needs no new route: `build.rs` already embeds the recursive Guide
tree and `src/server.rs` already serves arbitrary embedded paths through
`/_snapback/guide/{*path}`, so the new Markdown and registry will be available
in the next Rust build. No Rust build was run in this lane.

The remaining native work is exact and bounded:

1. In `src/server.rs::LLMS_TXT`, add direct links for
   `/_snapback/guide/reference/index.md` and
   `/_snapback/guide/reference/registry.json`; extend
   `tests/served_guide_v1.rs::memory_server_serves_root_llms_txt_with_guide_identity`
   to require both. Until then they are reachable through the Guide/flat
   index but not named directly in `/llms.txt`.
2. In `src/guide_mcp.rs::resource_catalog`, ingest manifest `resources` whose
   `projections.mcp` flag is enabled and expose the registry at
   `snapback-guide://reference/registry`. Add a bounded symbol resource
   template such as `snapback-guide://symbol/{name}{?slice}` that uses the
   embedded registry's 16 KiB rules and returns the same identity/truncation
   schema as the package CLI. Update both the unit test in that module and
   `tests/guide_mcp_v1.rs` from `page_count + 2` to the manifest-derived
   resource/template inventory. Only then flip the manifest resource's
   `mcp` projection flag to true.
3. In `src/cli.rs`, deserialize the embedded registry before
   `search_guide_sections`, add parsed `--slice <n>` support to the native
   `guide` command, and mirror the package lookup schema/budget so a cold npm
   install with only the co-installed native binary does not depend on a
   checkout-side `guide/` directory. Preserve the current section search as
   the non-exact fallback and add exact/sliced cases beside the existing
   `render_guide_command` tests.

The registry resource therefore honestly declares `http: true`, `mcp: false`,
and `llms: false` in this landing rather than claiming Rust projections that
were forbidden here.

### Acceptance status

1. **PASS.** Two-way parity is exact for 40 modules; type-space exemptions are
   explicit, and the one discovered client declaration gap was repaired.
2. **BOOTSTRAP PASS / target incomplete.** The fenced page passes Guide checks
   and has a retirement trigger. The proposed `@expo/snapback-codegen/ctx`
   declaration, generated instantiation, and duplicate-owner CI still need a
   ratified follow-up.
3. **PASS.** The five-question cold suite is reference-only by construction
   and passed.
4. **PASS for the package CLI seam.** Exact member/symbol and bounded module
   slices are identity-bearing and name elisions/next slices. Native installed
   parity and the MCP template remain the Rust work above.
5. **PARTIAL.** Registry Markdown, package CLI, and the four intent joins use
   the same stable identities. Native MCP, native CLI, diagnostics, and LLP
   0195 public projection cannot complete the cross-surface identity proof in
   this no-Rust/no-LLP-edit lane.

### Verification

All requested in-scope gates passed under Node 24.18.0:

- `node scripts/check-guide.mjs` — PASS (106 pages, 1,084 snippets; 62
  warning-only pre-existing freshness notices);
- `node scripts/check-inventories.mjs` — PASS (238 package tests, 25 demos,
  281 publication leaves, 106 Guide pages);
- `node scripts/generate-symbol-registry.mjs --check` — PASS (40 modules, 845
  symbols, exact runtime parity);
- `node tests/generated-api-reference-v1.mjs` — PASS (five fenced reference
  reads);
- `node packages/snapback-cli/reference-lookup.test.mjs` — PASS;
- `node packages/snapback-cli/cli-help.test.mjs` — PASS;
- `node packages/snapback-client/export-parity.test.mjs` — PASS (250 client
  declarations across 31 typed export entries);
- `scripts/check-generated-artifacts` — PASS after the ignored demo caches
  were materialized; no tracked demo output changed;
- `git diff --check` — PASS.

An additional non-required `node scripts/check-package-export-types.mjs`
probe failed on a pre-existing surface outside LLP 0194's verify-only CLI
scope: `@expo/snapback-cli/expo-dev` has runtime exports
`admittedBrowserExchangeOrigin` and `startBootstrapExchange` missing from its
declaration. This lane did not broaden into that unrelated declaration repair.
No Cargo command and no server were run.

## 2026-08-08 deferred native/Rust execution log

This entry supersedes the earlier log's **Remaining Rust/native work** list;
that list accurately described the handoff before this deferred lane ran.

### Implemented in this worktree

- The recursive Guide embed now requires `reference/index.md` and
  `reference/registry.json`, and the existing closed wildcard route serves the
  exact embedded bytes under `/_snapback/guide/reference/`. `/llms.txt` now
  directly advertises both the compact API index and canonical registry.
- `src/guide_mcp.rs` derives its static resource inventory from manifest pages
  plus every manifest resource whose `projections.mcp` flag is true. It exposes
  the registry at `snapback-guide://reference/registry` and advertises the
  bounded `snapback-guide://symbol/{name}{?slice}` resource template.
- `src/guide_reference.rs` is the single native exact-lookup implementation
  shared by CLI and MCP. It verifies the embedded manifest SHA-256 and source
  digest bindings before parsing the registry, mirrors
  `snapback.guide-symbol-lookup.v1`, applies the registry/16 KiB budget, and
  emits the same member, symbol-slice, module-slice, elision, next-slice, and
  identity fields as `packages/snapback-cli/reference-lookup.mjs`.
- `snapback guide <exact-symbol|module> [--slice <n>] [--json]` now performs
  exact registry lookup before Markdown section search. Non-exact queries keep
  the prior fuzzy section-search behavior. The package CLI preserves `--json`
  when a cold install has no checkout registry and delegates to the native
  carrier.
- Package and Rust tests consume
  `tests/fixtures/guide-symbol-lookup-v1.json` for the same exact member,
  sliced symbol, sliced module, and fuzzy-fallback cases.
- The manifest resource now truthfully declares `http: true`, `mcp: true`, and
  `llms: true`; the manifest, flat Guide, registry, and 41 Markdown reference
  projections were regenerated. Current inventory: 106 Guide pages, 1,092
  snippets, 40 registry modules, and 847 symbols.

### Acceptance 4/5 status after the native work

4. **PASS across package CLI, native CLI, and MCP.** Exact/member results and
   requested symbol/module slices carry the same schema and Guide/registry
   identity, remain at or below 16 KiB, and name elisions plus the next command.
5. **PASS for the implemented Guide reference surfaces; overall RFC acceptance
   remains PARTIAL.** Generated Markdown, HTTP, package CLI, native CLI, and MCP
   resolve the same stable registry identities. The published `ctx`
   declaration/duplicate-owner retirement, diagnostic joins, and LLP 0195
   public projection remain outside this deferred Rust lane.

### Verification

Passed:

- `cargo build --locked` — PASS (only existing Ibex/linker warnings).
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --locked --lib guide_`
  — PASS, 11 focused unit tests.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --locked --test guide_mcp_v1`
  — PASS, native stdio MCP integration.
- `DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --locked --test served_guide_v1 -- --skip cli_memory_server_serves_the_build_bound_flat_guide`
  — PASS, four in-memory route/bytes/identity tests.
- `volta run --node 24.18.0 node scripts/generate-guide-manifest.mjs` — PASS
  after the standard ignored demo caches were materialized.
- `volta run --node 24.18.0 node scripts/check-guide.mjs` — PASS (106 pages,
  1,092 snippets; 62 warning-only existing freshness notices).
- `volta run --node 24.18.0 node scripts/generate-symbol-registry.mjs --check`
  — PASS (40 modules, 847 symbols, exact runtime parity).
- `volta run --node 24.18.0 node packages/snapback-cli/reference-lookup.test.mjs`
  — PASS.
- `node scripts/check-inventories.mjs` — PASS (238 package tests, 25 demos,
  281 publication leaves, 106 Guide pages / 1,092 snippets).
- `scripts/check-generated-artifacts` — PASS after `bun install --frozen-lockfile`
  restored the locked root dependencies and ignored demo caches.
- `./ref-check --verbose` — PASS (199 LLP docs, 4,152 refs, zero errors or
  unchecked refs).
- `git diff --check` and focused `rustfmt --check` — PASS.
- Rebuilt-binary smoke: native exact JSON, requested symbol slice, manifest
  registry resource, symbol resource template, and MCP exact member — PASS.

Sandbox-blocked loopback witness:

```sh
readiness_dir=$(mktemp -d /tmp/snapback-0194-readiness.XXXXXX)
DYLD_FRAMEWORK_PATH="$PWD/vendor/ibex/ios/Frameworks" target/debug/snapback --port 0 --memory --ready-file "$readiness_dir/ready.json"
```

This failed before readiness with
`failed to bind Snapback server to 127.0.0.1:0: Operation not permitted (os error 1)`.
The orchestrator must run the remaining loopback test outside this sandbox:

```sh
DYLD_FRAMEWORK_PATH=$PWD/vendor/ibex/ios/Frameworks cargo test --locked --test served_guide_v1 cli_memory_server_serves_the_build_bound_flat_guide
```

Nothing else remains in the deferred native scope. No git commit was attempted;
the sandbox does not permit git-metadata writes.

## Author ruling — 2026-08-08

OQ2 RATIFIED (Charlie, in session): `@expo/snapback-codegen/ctx` owns
the ctx declaration source, types-only export condition accepted.
Implementation lane launched: ctx.d.mts under snapback-codegen,
registry inclusion as type-only kinds, bootstrap page retirement per
Acceptance 2, CI duplicate-ownership rejection.
