# LLP 0140 review — Codex family


## Round 1 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (`-c model_reasoning_effort="ultra"`)
**Session ID:** `019fbe6f-6887-74c0-836a-4e6aa616734d`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner, `-s read-only` sandbox, network reachable (rolldown.rs, oxc.rs, npmjs.com, docs.rs fetched); mutually blind — barred from `llp/reviews/` and from any path containing `super-refine`; target = the uncommitted working-tree draft, SHA-pinned
**Target SHA-256:** `cf707efa41fc1cc44b60f3c9f2efc18779d7979d474ffd850cfdb8d6054fc324`
**Instruction SHA-256:** `caf069d01f9859847b8def8b93cc5c8bb89cbb94c54a5be8deb8ec8c11a4487c`
**Status:** completed

## Verbatim review

Target SHA-256: `cf707efa41fc1cc44b60f3c9f2efc18779d7979d474ffd850cfdb8d6054fc324` — **MATCHED** the expected hash.  
Review date: **2026-08-01**

Method note: I read the target in full; opened every inventory-table surface; inspected the codegen entry point, its delegated inline-handler implementation, graph reader/resolver, relevant tests and manifests; ran a binary-safe repository search for direct Acorn, esbuild, and TypeScript compiler-API uses; and checked every cited LLP anchor plus LLP 0108, which governs an omitted affected contract. I checked current primary Rolldown/Oxc documentation and package metadata. I did not install or execute the candidate packages or reproduce the size measurements, so undocumented cross-platform determinism and source-span behavior remain marked uncertain. I did not read review artifacts or any file whose name contains `super-refine`, and I made no edits.

## 1. Overall assessment

The convergence direction is technically plausible and the staged/rollback shape is thoughtful. Rolldown supports controlled programmatic in-memory generation, and Oxc supports the required parsing and TypeScript lowering primitives.

The Plan is nevertheless not ready. Its current census omits an identity- and security-bearing TypeScript `TypeChecker` path; Stage 1 would delete TypeScript without replacing that path. The Rolldown admission design also omits current behaviors and defaults that can reopen ambient configuration or change execution, including `import.meta`, automatic `tsconfig` discovery, the transformed inline-handler entry, and `require` polyfilling. Finally, the stated gates are not bound to a non-vacuous proof inventory and would leave several governing diagnostic, stale-output, identity, and package-closure contracts unproven.

VERDICT: NOT READY

## 2. Strengths

- The architecture draws the right authority boundary: Oxc for syntax facts, Rolldown for the controlled graph, and Vite only for product-representative application builds. It correctly forbids definition codegen from loading user Vite configuration or plugins. `llp/0140-vite-rolldown-oxc-convergence.plan.md:140-155`

- Every surface that is actually listed has an accurate current-role description. Examples include the definition bundler at `packages/snapback-codegen/index.mjs:7736-7846`; browser closure at `packages/snapback-client/browser-closure.test.mjs:14-28`; cold-install browser proof at `scripts/snapback-package-cold-install.mjs:2345-2355`; Cloudflare identity at `cloudflare/scripts/generate-deployment-identity.mjs:53-70`; Miniflare bundling at `cloudflare/test/harness.mjs:123-157`; syntax-only contract metadata at `scripts/check-contract-meta.mjs:6-72`; Competitive Checkpoint at `demos/competitive-checkpoint/surfaces/react-expo/scripts/bundle-runtime.mjs:5-20`; and Signal Desk at `demos/signal-desk/tests/react-query-group.mjs:220-232`.

- All cited governing anchors exist, and their headline uses are accurate. Static inspection is correctly treated as defense in depth rather than the capability boundary (`llp/0009-code-execution-security.rfc.md:788-799`); graph/value identity matches the generated-artifact contract (`llp/0010-agent-dx-and-acceptance.spec.md:372-396`); the controlled-stock-bundler distinction is preserved (`llp/0118-handler-composition-and-helper-reuse.research.md:668-702`); and the stale-output constraint is accurately summarized (`llp/0030-managed-snapback-vite-dev.rfc.md:603-654`).

- The dual-run oracle compares graph identity, evaluated values, artifacts, and diagnostics rather than transient bundle bytes. That is the correct semantic boundary. The evaluator subprocess gate and the refusal to ship two runtime-selected toolchains are also strong. `llp/0140-vite-rolldown-oxc-convergence.plan.md:224-227,248-264,342-355`

- The upstream building blocks are real. Rolldown documents in-memory `bundle.generate()` and IIFE output; its plugin API exposes resolver/loader hooks and module graph inspection. Oxc documents ESTree-compatible JavaScript ASTs, TS-ESTree TypeScript ASTs, and TypeScript transformation without type checking. [Rolldown programmatic API](https://rolldown.rs/guide/getting-started), [Rolldown module graph API](https://rolldown.rs/reference/Interface.PluginContext), [oxc-parser package](https://www.npmjs.com/package/oxc-parser), [Oxc TypeScript transformer](https://oxc.rs/docs/guide/usage/transformer/typescript)

## 3. Concerns

### 1. BLOCKING — The census and Stage 1 omit the identity-bearing inline-handler compiler path

**Evidence checked:** The inventory attributes TypeScript scanning to `packages/snapback-codegen/index.mjs`, and Stage 1 names only the “TypeScript unsupported-source scanner” before deleting TypeScript. `llp/0140-vite-rolldown-oxc-convergence.plan.md:85,171-174,235-243`

The delegated `packages/snapback-codegen/inline-handlers.mjs` directly imports TypeScript at line 1. It creates a `Program` and `TypeChecker` at `:494-515`, uses symbol binding to distinguish locals, same-file helpers, imports, and top-level bindings at `:293-446`, and enforces reflective/dynamic-code rules using resolved symbols. This is not replaceable by a node-shape projection alone.

It also defines identity:

- TypeScript numeric `SyntaxKind` values and token text form `canonicalAst` at `packages/snapback-codegen/inline-handlers.mjs:449-457`.
- That encoding feeds helper content hashes at `:460-477` and marker tokens at `:805-829`.
- The transformed source is passed only to the functions bundler at `packages/snapback-codegen/index.mjs:603-625`.
- Canonical handler/helper values then feed v1/v2 `implementationHash` at `packages/snapback-codegen/index.mjs:4769-4823`.

An Oxc AST rewrite will therefore rotate marker tokens, helper hashes, implementation hashes, and artifacts unless it reproduces the TypeScript encoding byte-for-byte or introduces a deliberate versioned identity migration. LLP 0108 makes same-file symbol resolution, deterministic splicing, and v1/v2 identity normative. `llp/0108-inline-handlers-and-result-contracts.spec.md:665-699,855-905,923-956`

The documented `oxc-parser` API provides an AST and visitor, not an equivalent TypeScript `Program`/`TypeChecker` symbol service. Building a Snapback-owned lexical resolver is possible, but the Plan does not name that work.

The census also omits `scripts/check-package-export-types.mjs`, which dynamically loads TypeScript at `:77` and uses `createProgram`, `getTypeChecker`, alias resolution, and `SymbolFlags.Value` at `:210-234`. This is genuinely type-semantic and should be explicitly retained, not silently discovered after the Plan declares the current census.

The Acorn work is similarly more enumerable than “JavaScript scans”: streamed-response inference (`index.mjs:4976-5031`), syntax/capability diagnostics (`:5075-5383`), static-result refusal (`:5661-5729`), protected-query call-graph analysis (`:5760-6257`), exported-definition spans (`:7423-7462`), and schema-field spans (`:7465-7518`). A normal `rg` search also misses `inline-handlers.mjs` because it contains a literal NUL; the Stage-0 census must be binary-safe.

**Resolution criterion:** Add separate inventory entries for `inline-handlers.mjs` and `check-package-export-types.mjs`; add LLP 0108 as a governing document; enumerate each Acorn/TypeScript responsibility; define the replacement lexical-binding algorithm or retain TypeScript explicitly; preserve the original-source/transformed-entry split; and gate byte-identical marker tokens, canonical AST encodings, helper hashes, v1/v2 implementation hashes, splice output, diagnostics, and artifacts. If identity must rotate, specify a versioned migration and rollout rather than treating it as parser parity.

### 2. BLOCKING — The Rolldown admission boundary omits unsafe defaults and current fail-closed behavior

**Evidence checked:** The Plan requires “explicit options” but does not prescribe a complete closed-boundary configuration. `llp/0140-vite-rolldown-oxc-convergence.plan.md:149-155,176-198`

Current Rolldown defaults conflict with the intended contract:

- `tsconfig: true` discovers configuration and can apply `baseUrl`, path mappings, and transformation settings. That is ambient filesystem/configuration authority unless the config is capability-read and identity-covered. [Rolldown `tsconfig`](https://rolldown.rs/reference/InputOptions.tsconfig)
- `output.polyfillRequire` defaults to `true`, `output.codeSplitting` defaults to `true`, and current output defaults include DCE/comment behavior that must not be inherited accidentally. [Rolldown output options](https://rolldown.rs/reference/Interface.OutputOptions), [Rolldown code splitting](https://rolldown.rs/reference/OutputOptions.codeSplitting)
- Tree shaking defaults to enabled, although the Plan does correctly require disabling it. [Rolldown tree shaking](https://rolldown.rs/reference/InputOptions.treeshake)
- A plugin hook returning `null` delegates to Rolldown’s built-in behavior; every resolution path must therefore resolve or refuse rather than fall through.
- Rolldown currently lists `resolveImportMeta` as unsupported. [Rolldown plugin API](https://rolldown.rs/apis/plugin-api)

The existing implementation explicitly sets neutral platform, ES2022 IIFE, disabled tree shaking, in-memory output, no legal comments, and `import.meta` refusal. `packages/snapback-codegen/index.mjs:7736-7748` LLP 0010 also explicitly requires `import.meta` to fail closed. `llp/0010-agent-dx-and-acceptance.spec.md:372-376` Yet the Plan omits it from the plugin, fixture census, and acceptance matrix. `llp/0140-vite-rolldown-oxc-convergence.plan.md:182-198,220-223,315-317`

Other omitted current requirements are:

- Only functions receive the inline-handler-transformed entry while identity records authored bytes. `packages/snapback-codegen/index.mjs:603-625,7833-7838`
- Schema, functions, and routes are separate graphs and separate fresh evaluations, not one combined IIFE/context. `packages/snapback-codegen/index.mjs:617-645`
- `.cjs`/`.cts` always refuse; `.js`/`.ts` use nearest-package module format with lookup stopping at `node_modules`. `packages/snapback-codegen/index.mjs:7817-7838,8174-8199`
- LLP 0010 says “relative/file only,” while current code also admits absolute-local paths and an exact two-entry allowlist. The Plan adopts the latter but does not acknowledge or schedule resolution of that governing-text conflict. `llp/0010-agent-dx-and-acceptance.spec.md:372-376`; `llp/0118-handler-composition-and-helper-reuse.research.md:246-263`

**Resolution criterion:** Specify and verify a version-pinned option manifest equivalent to `tsconfig:false`, neutral platform, `treeshake:false`, ES2022 target, IIFE format, `codeSplitting:false`, `minify:false`, comments/legal comments disabled, `sourcemap:false`, `polyfillRequire:false`, experimental debug output disabled, no externals, and no resolver fallback. Require exactly one JavaScript chunk and no assets/maps per schema/functions/routes graph; preserve the transformed-functions entry overlay and intrinsic banner; AST-reject every `import.meta` form; name the exact allowlist and module-format rules; and add adversarial cases for user tsconfig/Vite config/plugins, URLs/protocols, virtual/NUL IDs, import attributes, dynamic edges, and all fallthrough paths.

### 3. BLOCKING — The stage gates are not executable, non-vacuous gates

**Evidence checked:** Stage 0 says to freeze a corpus, while later gates say “full proof” or “all tests pass,” but the Plan names no test command, fixture manifest, case count/digest, compatibility-report schema, or canonical-proof registration. `llp/0140-vite-rolldown-oxc-convergence.plan.md:215-231,245-264,283-305`

That conflicts with the governing rule that the canonical proof is an explicit inventory rather than a sample and that required suites cannot disappear through automatic skips. `llp/0010-agent-dx-and-acceptance.spec.md:746-761`

Passing every listed acceptance bullet would still leave unproven:

- the full structured diagnostic envelope and public/local custody, not merely normalized code/span parity (`llp/0010-agent-dx-and-acceptance.spec.md:312-328`);
- successful regeneration/load, failed-generation preservation of the previous complete artifact set, stale-state marking, generated-but-not-loaded state, and offline-push warnings (`llp/0030-managed-snapback-vite-dev.rfc.md:610-618`; `llp/0041-packaged-dev-loop.rfc.md:955-969`);
- NUL-safe length framing, strict evaluated-value refusals, caller `NODE_OPTIONS`/preload isolation, and Wasm/string-code denial (`llp/0010-agent-dx-and-acceptance.spec.md:380-434`);
- the exact optional-native tree shape: one empty opposite-platform edge at the CLI path and the opposite runtime absent everywhere else, rather than merely selecting the matching package (`llp/0041-packaged-dev-loop.rfc.md:420-430`);
- inline-handler/helper identity from Concern 1, `import.meta` and ambient configuration from Concern 2, and whether the new migration corpus actually ran without skips.

**Resolution criterion:** Name the executable commands and machine-readable manifests for each stage; require exact case IDs/count/digest, tool versions/options, and zero unapproved skips; register the corpus and compatibility report in the canonical proof; and add explicit acceptance rows for every contract above, including full diagnostic custody and Vite stale-state transitions.

### 4. MATERIAL — Oxc parser/span and TypeScript-lowering semantics are under-specified

**Evidence checked:** The JavaScript ESTree assumption holds, and TypeScript uses TS-ESTree with documented exceptions. Oxc also returns an AST alongside parse errors, so the Plan’s discard-on-any-error rule is necessary and implementable. `llp/0140-vite-rolldown-oxc-convergence.plan.md:157-174`; [oxc-parser](https://www.npmjs.com/package/oxc-parser)

However:

- `showSemanticErrors` defaults to `false`, `range` defaults to `false`, and `preserveParens` defaults to `true`. The Plan does not pin these or disposition semantic-error differences.
- Oxc’s native spans are UTF-8 byte offsets, while JavaScript/Acorn positions are ordinarily UTF-16 code units. Public NAPI documentation does not make every node/error conversion guarantee clear. Full-fidelity line/column parity is therefore uncertain, especially after non-BMP characters. [Oxc native `Span`](https://docs.rs/oxc/latest/oxc/span/struct.Span.html)
- TypeScript lowering without type checking is supported, but isolated-transform behavior for namespaces, decorators, enums, class fields, and import elision can differ depending on options and ambient tsconfig. [Oxc TypeScript caveats](https://oxc.rs/docs/guide/usage/transformer/typescript)

Malformed UTF-8 alone does not test valid multibyte offset fidelity. `llp/0140-vite-rolldown-oxc-convergence.plan.md:220-223`

**Resolution criterion:** Pin the parser adapter’s language/source type, `astType`, range, parenthesis, semantic-error, and recovery policies; define the canonical offset unit and conversion; freeze ASCII, BMP, emoji/non-BMP, combining-mark, tab, LF, and CRLF cases before errors and refused nodes; and specify the admitted TypeScript feature/transform matrix, including deliberate refusals or parity rules for namespaces, decorators, enums, class fields, and import elision.

### 5. MATERIAL — The size baseline is arithmetically correct but not reproducible

**Evidence checked:** All four displayed deltas are correct, and the rows support the limited conclusion that the combined candidate closure is smaller on the two shown tuples. `llp/0140-vite-rolldown-oxc-convergence.plan.md:110-134`

The document does not state:

- the command or checked-in receipt;
- package manager/version, OS/libc details, cache state, or registry endpoint;
- the exact wrapper and native-binding package list;
- lock/deduplication and optional-dependency selection;
- whether “Download” means tarball size, registry metadata, or actual transferred bytes;
- whether “Unpacked” means package metadata, apparent filesystem size, or allocated blocks.

The direct esbuild-versus-Rolldown claim at `:128` is not demonstrated by the combined rows. Also, the table calls Acorn 8.18.0 current while the repository manifest/lock currently resolve 8.17.0 (`packages/snapback-codegen/package.json:83`; `bun.lock:379`); that may be an intentional registry-resolution measurement, but its basis is unstated.

**Resolution criterion:** Add a reproducible command or immutable receipt containing every package/version/integrity and per-package compressed/apparent/allocated size, package-manager and platform facts, optional-dependency filtering, cache/transfer definition, raw sums, and isolated esbuild-versus-Rolldown rows. Explain the registry-versus-lock version basis.

## 4. Suggestions

- Make Stage 0 produce a CI-checked “toolchain authority ledger”: source file, imported package/API, role class, owning contract, intended disposition, permitted exception, and proof command. Generate it with a binary-safe parser/package-manifest walk rather than text grep.

- Use the Snapback-owned resolver/load ledger—not rendered chunk names or only surviving `OutputChunk.modules`—as the Cloudflare identity oracle. Rolldown’s `getModuleIds()`/`moduleParsed` metadata can independently cross-check that ledger. Exact parity remains empirical, but the API is sufficient in principle. [Rolldown `moduleParsed`](https://rolldown.rs/reference/Interface.FunctionPluginHooks)

- Add metamorphic tests: comments and harmless wrapper changes should preserve semantic identity; changing any admitted source byte, module-format manifest, or canonical evaluated value should change the appropriate freshness identity; changing one helper should affect only its reachable operations.

- Retain a generated compatibility receipt containing old/new tool versions, complete option manifests, corpus digest, graph/value/artifact comparison digests, diagnostic dispositions, platform, and timing/size measurements.

## 5. Open questions

1. Will inline-handler identity preserve the current TypeScript `SyntaxKind` encoding byte-for-byte, or intentionally move to a new identity version? What is the rollout rule?
2. What exact Oxc-based scope/binding implementation replaces `TypeChecker` helper and shadowing resolution?
3. What is the complete Rolldown input/output option manifest, including `tsconfig`, minification, comments, CJS polyfills, code splitting, debug output, and resolver fallthrough?
4. What is the authoritative admitted-specifier set, and how are `import.meta`, URL protocols, virtual IDs, attributes, `.cts/.cjs`, and package-scope ambiguity refused?
5. What exact offset unit does the parser adapter expose, and which Unicode/line-ending corpus proves it?
6. Will deployment identity come from the Snapback admission ledger or Rolldown output metadata, and how are parsed-but-eliminated modules, JSON, aliases, and package manifests handled?
7. Which concrete commands and manifests make every stage gate non-vacuous and part of the canonical proof?
8. Where is the raw size receipt, and what exactly do “download” and “unpacked” mean?

## 6. Readiness verdict

**NOT READY.**

Blocking list:

1. Stage 1 omits the TypeChecker-backed inline-handler/helper admission and identity authority, while directing implementation to delete TypeScript.
2. The Rolldown admission contract omits current security-critical behavior and defaults that can widen or alter the graph.
3. The acceptance stages are not tied to executable, non-vacuous proof inventories and would leave governing contracts unproven.

## Round 2 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra` (`-c model_reasoning_effort="ultra"`)
**Session ID:** `019fbe8b-aa84-7f40-b92d-3b17a28e709d`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed from round 1), `-s read-only` sandbox, network reachable; mutually blind — barred from `llp/reviews/` and from any path containing `super-refine`, and given no round-1 finding; ran probes against esbuild 0.28.1 and the repository-installed Rolldown 1.1.5, and could not execute Rolldown 1.2.1 / `oxc-parser` 0.142.0
**Target SHA-256:** `a54731feca22f1804d4a9e325de80c5fdc6a4a581778ae97ea75e8427105e04a`
**Instruction SHA-256:** `61ba1e85fc07385b511979a4e9110e4940a1ed26cb1c22005e621e5fbf87dde5`
**Status:** completed

## Verbatim review

Target SHA-256: `a54731feca22f1804d4a9e325de80c5fdc6a4a581778ae97ea75e8427105e04a` — **MATCHED** the expected hash.

Review date: 2026-08-01.

Method note: I read the target in full; every source named in its inventory; the current codegen bundler, parser scans, inline-handler symbol service, file-read/decode path, manifests, and lock; and the cited governing sections in LLP 0009, 0010, 0030, 0041, 0108, 0118, plus the omitted Cloudflare-governing LLP 0049. I performed a binary-safe repository census, recomputed the size arithmetic, and ran focused probes against esbuild 0.28.1 and the repository-installed Rolldown 1.1.5. I checked current primary Rolldown/Oxc documentation. I could not execute the proposed exact Rolldown 1.2.1 or `oxc-parser` 0.142.0 packages, or replay the registry size measurements because the promised raw receipt does not exist; those patch-specific claims are marked uncertain. I did not read anything under `llp/reviews/`, did not read any file whose name contains `super-refine`, and made no edits. I applied LLP 0005 review discipline in-chat only because the capsule forbids creating a review artifact.

## 1. Overall assessment

The direction is coherent and technically feasible. The manual first-party census is complete, the Plan correctly separates syntax parsing from type semantics, most governing constraints are accurately understood, and the proposed Snapback-owned resolver/load ledger is the right architectural authority.

The Plan is nevertheless not ready. Three direct contradictions are enough to block it:

- The claimed executable gates and receipt manifests are not actually named.
- D-1b cannot satisfy the unconditional download-size acceptance row.
- The migration is described as semantics-preserving while the matrix rejects import attributes that the current path accepts.

In addition, the newly added Rolldown and Oxc manifests are not actually pinned, D-1a lacks a complete behavioral oracle and compatibility rollout, cross-platform semantic equality is not tested, and Stage 2 removes rollback machinery before the Stage-4 public/package proof.

VERDICT: NOT READY

## 2. Strengths

The inventory is complete for current first-party direct esbuild, Acorn, and TypeScript compiler-API authority. I found no omitted source use.

| Inventory surface | Verified evidence |
| --- | --- |
| Production codegen | Imports the three tools and contains the six Acorn scans, syntax-only TS scan, and esbuild bundle path described in the Plan ([index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736)). |
| Inline handlers | Builds a single-file TypeScript `Program`/`TypeChecker`, performs symbol lookup, and derives the identity encoding described ([inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494), [inline-handlers.mjs:449](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:449)). |
| Export-types proof | Dynamically loads TypeScript and uses `createProgram`, the checker, aliases, and value flags ([check-package-export-types.mjs:77](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:77), [check-package-export-types.mjs:212](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:212)). |
| Contract-meta proof | Uses only syntax-level `createSourceFile` ([check-contract-meta.mjs:14](/Users/ccheever/projects/snapback/scripts/check-contract-meta.mjs:14)). |
| Browser closure | Runs an in-memory browser bundle and checks the emitted closure for builtins ([browser-closure.test.mjs:14](/Users/ccheever/projects/snapback/packages/snapback-client/browser-closure.test.mjs:14)). |
| Cold-install proof | Declares esbuild in the external proof app and emits an esbuild-based bundle script ([snapback-package-cold-install.mjs:2185](/Users/ccheever/projects/snapback/scripts/snapback-package-cold-install.mjs:2185), [snapback-package-cold-install.mjs:2345](/Users/ccheever/projects/snapback/scripts/snapback-package-cold-install.mjs:2345)). |
| Cloudflare identity | Uses esbuild `metafile.inputs` as its transitive input set ([generate-deployment-identity.mjs:52](/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:52)). |
| Miniflare harness | Owns the app/seed aliases and Worker bundle configuration claimed ([harness.mjs:123](/Users/ccheever/projects/snapback/cloudflare/test/harness.mjs:123)). |
| Competitive Checkpoint | Uses esbuild for the browser ESM runtime fixture ([bundle-runtime.mjs:5](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/surfaces/react-expo/scripts/bundle-runtime.mjs:5)). |
| Signal Desk | Bundles the real adapter acceptance surface ([react-query-group.mjs:220](/Users/ccheever/projects/snapback/demos/signal-desk/tests/react-query-group.mjs:220)). |

Other strengths:

- The six Acorn responsibilities and seventh TypeScript syntax scan are accurately enumerated ([0140:142](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:142)).
- The Plan correctly identifies TypeScript’s numeric `SyntaxKind` encoding as an identity concern, rather than pretending `oxc-parser` is a drop-in replacement ([0140:81](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:81)).
- It surfaces the LLP 0010 resolver-text conflict instead of silently inheriting it ([0140:108](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:108)).
- The parser-adapter boundary, separate graph/evaluation requirement, authored-versus-transformed source split, and capability-aware file reader are sound ([0140:279](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:279), [0140:348](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:348)).
- The semantic dual run compares graph identity, evaluated values, artifacts, and diagnostics rather than treating generated bundle bytes as the oracle ([0140:525](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:525)).
- Refusing to ship an automatic esbuild/Rolldown selector is the correct identity-safe rollback posture ([0140:671](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:671)).

## 3. Concerns

### 1. BLOCKING — The promised executable gates and manifests are absent

Evidence checked: The Plan says every stage names an executable command and machine-readable manifest ([0140:448](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:448)), but Stage 0 contains the literal placeholder `scripts/<census>.mjs` ([0140:487](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:487)); Stage 1 names an unspecified corpus runner ([0140:513](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:513)); Stage 2 names neither a command nor manifest ([0140:544](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:544)); and Stage 3 names nonexistent `cloudflare:accept` ([0140:571](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:571)), while the actual script is `cf:accept` ([package.json:22](/Users/ccheever/projects/snapback/package.json:22)). No acceptance row names the manifest it claims to name ([0140:600](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:600)).

Resolution criterion: Give every stage an exact command; every receipt an exact repository path and schema; and every matrix row a case ID and manifest entry. State how each command fails on a missing case, corpus-digest mismatch, or unapproved skip, and register all gates in `scripts/verify-local-proof`.

### 2. BLOCKING — The size acceptance criterion contradicts D-1b and the stated install shapes

Evidence checked: D-1b projects download regressions of 3,746,522 bytes on macOS and 4,284,445 bytes on Linux ([0140:214](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:214)), but acceptance unconditionally says headless and React downloads must not regress; only unpacked size is branched ([0140:659](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:659)). Moreover, the component table cannot establish either install-shape outcome: the Plan itself says React retains TypeScript and may already carry Rolldown through Vite ([0140:228](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:228)).

The isolated conclusion—only D-1a makes the displayed component set smaller—is supported, but the Linux unpacked arithmetic is wrong by 94 bytes:

- Candidate total should be `20,175,809 + 3,536,788 = 23,712,597`, not 23,712,503.
- D-1a should be `-12,032,734`, not `-12,032,828`.
- D-1b should be `+11,592,332`, not `+11,592,238`.

The measurement also cannot yet be replayed: the “binding” packages are unnamed, Linux does not specify GNU versus musl, and the versions/integrities/raw receipt are deferred to Stage 0 ([0140:179](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:179)).

Resolution criterion: Correct the arithmetic and publish the complete summand/receipt now: package names, versions, integrities, registry URLs, Linux image/libc, package-manager version, command, and cache policy. Define separate download and unpacked criteria for D-1a/D-1b and for headless/React resolved closures.

### 3. BLOCKING — Import attributes are a silent compatibility break

Evidence checked: The Plan calls this a non-semantic migration ([0140:37](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:37)), but places import attributes in the invalid corpus and fail-closed matrix ([0140:465](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:465), [0140:609](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:609)). The current universal esbuild resolver and JSON loader ignore `args.with` ([index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783)). An esbuild 0.28.1 probe successfully bundled a JSON import using `with { type: "json" }` and reported that attribute to `onResolve`.

Resolution criterion: Either preserve currently supported JSON attributes, or explicitly declare a compatibility-breaking admission tightening with its stable code, span, envelope, version/rollout policy, and exemption from old/new admission equality. Fixture both modern `with` syntax and legacy assertion syntax.

### 4. MATERIAL — The Rolldown manifest is not actually pinned

Evidence checked: Most named capabilities exist: `rolldown()` plus `bundle.generate()` provides in-memory output; resolver/load fallthrough can be prevented; IIFE, disabled tree shaking, disabled code splitting, sourcemap control, and TypeScript lowering are supported. The API requires explicit cleanup, while the newer `build()` API is experimental and writes by default ([Rolldown Bundler API](https://rolldown.rs/apis/bundler-api)).

The actual manifest remains incomplete:

- The prose requires ES2022 ([0140:373](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:373)), but omits `transform.target: "es2022"`; the documented default is `esnext` ([Rolldown transform options](https://rolldown.rs/reference/InputOptions.transform)).
- It omits exact input, `cwd`, plugin order, module-type/loader policy, TypeScript transform settings, banner, resolver settings, `checks` values, and normalized-options assertions.
- `output.legalComments` is deprecated in favor of `comments.legal` ([Rolldown OutputOptions](https://rolldown.rs/reference/Interface.OutputOptions)).
- The text says warning classes will be classified, but supplies no class table or unknown-warning policy ([0140:401](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:401)).
- Rolldown documents `require-call` but no `require-resolve` resolution kind. A local 1.1.5 probe left `require.resolve("./x")` verbatim and never invoked `resolveId` ([Rolldown plugin hooks](https://rolldown.rs/reference/Interface.FunctionPluginHooks)).
- `resolveId` receives source/importer/kind but no authored import-site position. The Plan does not explain how resolver refusals retain current authored spans.

Resolution criterion: Replace the prose table with the complete serializable `rolldown()` and `generate()` objects, including `transform.target`, loaders/module types, `checks`, `onLog`, banner, input, `cwd`, plugin order, empty transform/alias/inject surfaces, current comment option, output-count assertion, and `bundle.close()`. Assign `require.resolve` and import-site span capture to a parser-produced edge ledger rather than assuming resolver-hook coverage.

### 5. MATERIAL — The Oxc parser contract is internally contradictory and still default-dependent

Evidence checked: Oxc supports the required ESTree/TS-ESTree projections, sync/async parsing, `astType`, `range`, `preserveParens`, and semantic-error controls ([oxc-parser 0.142.0 documentation](https://www.npmjs.com/package/oxc-parser)). Pinning `preserveParens: false` is an important and correct insight because the current detector does not unwrap `ParenthesizedExpression` ([0140:297](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:297), [index.mjs:5157](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5157)).

But the “pinned” list omits `lang`, concrete `astType` values, a `showSemanticErrors` value, exact per-mode `sourceType`, and sync versus async API ([0140:294](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:294)). The handler policy still offers two alternatives without selecting one ([0140:318](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:318)).

The offset text also conflates native Oxc spans with the public Node result. Native spans are UTF-8 byte ranges, but the N-API `parseSync` implementation converts program, module-record, and error spans to UTF-16 before serializing them ([Oxc N-API source](https://docs.rs/oxc_parser_napi/latest/src/oxc_parser_napi/lib.rs.html)). Thus the assertion at [0140:309](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:309) conflicts with its own open question at [0140:695](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:695). Exact 0.142.0 behavior still needs a probe, especially if raw-transfer APIs are involved.

Malformed UTF-8 also remains an ingestion responsibility: Oxc receives a JavaScript string. The current fatal byte validation occurs before parsing ([file-read-capability.mjs:100](/Users/ccheever/projects/snapback/packages/snapback-codegen/file-read-capability.mjs:100)).

Resolution criterion: Provide a complete per-dialect call matrix covering API, filename, `lang`, `sourceType`, `astType`, `range`, `preserveParens`, `showSemanticErrors`, parse-error handling, and handler recovery precedence. State the empirically observed returned unit for every AST/module/error span surface and preserve fatal UTF-8 validation at byte ingestion.

### 6. MATERIAL — The future census checker can miss two known inventory entries

Evidence checked: The manual census is complete, but the proposed “parser and package-manifest walk” ([0140:459](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:459)) is not sufficient as described. It would not naturally see the esbuild import inside a generated template literal ([snapback-package-cold-install.mjs:2345](/Users/ccheever/projects/snapback/scripts/snapback-package-cold-install.mjs:2345)) or the filesystem-composed dynamic TypeScript module URL ([check-package-export-types.mjs:77](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:77)).

Resolution criterion: Specify recognizers for ordinary imports/requires, generated-source templates, constant-foldable filesystem/module URLs, spawned CLIs, package scripts, and package manifests. Add checker self-tests containing these exact exceptional forms and require every current inventory row to map to a ledger record.

### 7. MATERIAL — D-1a and scanner parity are less specified than the current implementation

Evidence checked: “Scope-tree construction” ([0140:243](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:243)) understates the existing symbol service. It performs cycle-safe const evaluation ([inline-handlers.mjs:132](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:132)), duplicate/helper/binding classification ([inline-handlers.mjs:293](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:293)), shadowed-global precedence ([inline-handlers.mjs:409](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:409)), lazy helper-graph construction, and deterministic source splicing. The acceptance matrix does not explicitly cover hoisting, block/function/`var` scope, destructuring bindings, overloads/duplicates, type-only and imported bindings, alias cycles, recursive helpers, or the exact helper edge set.

The seven scanner responsibilities are named, but several behavioral contracts remain implicit: issue deduplication and ordering, conservative parse-failure fallbacks, first-error-only TypeScript reporting, and masked textual fallback for protected-query scanning. D-1b’s “Zero admission risk” claim ([0140:248](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:248)) is therefore too broad; it removes risk only from replacing the inline-handler symbol service.

Resolution criterion: Before replacement, freeze a TypeScript-oracle transcript containing every identifier classification, computed-name result, helper edge, diagnostic/span, and emitted splice decision. Require candidate parity for that transcript, except for an explicitly versioned canonical-AST identity migration. Give every current scanner fallback/dedup behavior a named fixture.

### 8. MATERIAL — Native-package acceptance and rollback sequencing are unsafe

Evidence checked: The Plan applies LLP 0041’s “one empty opposite-platform edge” rule to Oxc/Rolldown ([0140:438](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:438)). That rule is specifically for Snapback’s two CLI runtime packages ([0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420)); Rolldown itself declares many platform bindings, including GNU and musl variants ([bun.lock:459](/Users/ccheever/projects/snapback/bun.lock:459)).

Stage 4 proves installation/generation on each host, but never compares parser projections, diagnostics, graph identities, evaluated values, or generated artifacts across the two native implementations ([0140:582](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:582)). Stage 2 nevertheless removes esbuild and the dual implementation before that proof ([0140:538](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:538)).

Resolution criterion: Preserve the CLI-runtime edge invariant separately; define the expected host binding and permitted omitted/empty foreign edges for Oxc and Rolldown; pin Linux libc; run the identical semantic corpus on both tuples and compare normalized digests. Retain a restorable old implementation until this proof passes, or prohibit Stage-2 publication/landing before Stage 4 and name the exact rollback source/package/lock point.

### 9. MATERIAL — Cloudflare deployment identity remains a load-bearing spike, not a closed gate

Evidence checked: The current identity generator hashes esbuild’s transitive `metafile.inputs` ([generate-deployment-identity.mjs:52](/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:52)). Rolldown exposes complete imported IDs after parsing and stable graph information at `buildEnd`, so it is suitable as a cross-check, not necessarily as the identity authority ([Rolldown PluginContext](https://rolldown.rs/reference/Interface.PluginContext)). The Plan’s Snapback-owned ledger is the right primary design, but it leaves parsed/eliminated modules, JSON, aliases, manifests, and synthetic IDs unresolved ([0140:691](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:691)).

It also omits the governing LLP 0049 freshness and self-output-exclusion gate ([0049:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997)).

Resolution criterion: Add an early, explicit spike that compares the Snapback ledger with the current esbuild input set over JSON, aliases, cycles, manifests, eliminated modules, and `\0rolldown/runtime.js`; pin the inclusion/exclusion algorithm and fixed-point rule; and add LLP 0049 to `Related` and governing constraints.

### 10. MATERIAL — Passing the listed matrix would still leave identity and diagnostics unproven

Evidence checked:

- D-1a requires only changed bytes plus a stated rollout rule ([0140:504](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:504), [0140:634](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:634)). LLP 0108 also makes predecessor/successor tuples, stale-reference behavior, and public/private custody normative ([0108:265](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:265)).
- The handler discussion identifies distinct `import`, `export`, and `with` diagnostics, but the matrix contains no exact mixed-error precedence cases ([0140:318](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:318)).
- Resolver-hook diagnostics lack a stated mechanism for recovering authored import-site spans.
- Stage 2 allows any semantic difference with an “explicit disposition” ([0140:544](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:544)), without restricting disposition classes. That could admit security, identity, custody, or diagnostic weakening while technically passing.

Resolution criterion: Add old/new client-server fixtures for query, live query, mutation, action, group, resume, replay, stale references, downgrade, and rollback; add exact handler `import`/`export`/`with` codes, spans, envelopes, and precedence; require parser-originated import-edge spans; and state that admission, identity, custody, and capability-boundary weakening are never permitted dispositions.

### 11. MATERIAL — Several governing citations are mis-anchored or incomplete

Evidence checked: The core citations are sound: LLP 0009 makes runtime enforcement authoritative ([0009:788](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:788)); LLP 0010 supports closed graph and identity ([0010:372](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:372)); LLP 0108 supports symbol-based helper closure and v2 identity ([0108:864](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:864)); and LLP 0118 supports a Snapback-owned policy hosted by a stock bundler ([0118:668](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:668)).

The weak points are:

- `0010#diagnostic-shape` does not by itself establish full public/local custody; the relevant dated text is [0010:819](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:819) and [0108:590](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:590).
- Generated-but-not-loaded is governed explicitly by LLP 0041 ([0041:955](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:955)), not only LLP 0030.
- The optional-native citation is overextended as described above.
- LLP 0049 is missing entirely.

Resolution criterion: Correct the anchors in constraints and acceptance, separate the CLI-runtime tree rule from third-party bindings, and add LLP 0049 as a governing related document.

## 4. Suggestions

- Store the Rolldown and Oxc option matrices as versioned JSON objects consumed by both production and tests; generate the LLP tables from those objects.
- Introduce a tool-agnostic “graph authority transcript” containing ordered resolve/read facts, byte digests, module-format inputs, and authored import spans. Both esbuild and Rolldown can emit it during dual-run, and Cloudflare can reuse it.
- Add metamorphic resolver tests: extension addition/removal, directory/index candidates, symlink retargeting, package-scope movement, alias spelling, and harmless wrapper changes.
- Define performance methodology now: host specification, warmup, sample count, percentile calculation, concurrency, and interaction between the 15% and 100-ms exceptions.
- Define a license allow/deny policy for Stage 4; “inspect licenses” currently has no pass/fail meaning.

## 5. Open questions

1. Which D-1 branch is selected, and—if D-1a—what exact old/new protocol compatibility and cleanup window governs the identity rotation?
2. Are JSON import attributes preserved or intentionally removed as a versioned compatibility change?
3. What are the exact complete Rolldown input/output objects, including target, module types, warning policy, parser/lowering settings, and lifecycle API?
4. What exact Oxc call matrix and returned offset unit does 0.142.0 produce on both supported native tuples?
5. Will `require.resolve` be rejected by the pre-bundle Oxc scan, given that current Rolldown documentation and the 1.1.5 probe provide no resolver hook for it?
6. What is the authoritative mechanism for mapping every resolution refusal back to the authored import-site span?
7. What are the exact headless and React package closures and acceptance thresholds under both D-1 branches?
8. Is Stage 2 allowed to land or publish before the two-platform Stage-4 semantic/package proof?
9. What exact ledger inclusion rule reproduces Cloudflare’s current deployment identity while excluding self-output and Rolldown synthetic modules?
10. Which handler recovery policy—dual parse or scoped recovery—is selected, and how are mixed-error precedence and TypeScript handlers handled?

## 6. Readiness verdict

**NOT READY.**

Hard blocking list:

- The stage commands and receipt manifests are not real executable gates.
- The size acceptance row is impossible under D-1b and unsupported for the two actual install shapes.
- Import attributes are silently changed from admitted to forbidden.

The remaining MATERIAL concerns—exact tool manifests, Oxc offset/options contract, census-proof mechanics, D-1a oracle and rollout, cross-platform equality, rollback sequencing, Cloudflare identity, governing anchors, and residual acceptance coverage—must also be closed before this document meets the stated LLP 0005 readiness bar.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

- **Confirmed:** the stage-gate command defect (`cf:accept`, not
  `cloudflare:accept`, at `package.json:22`), the unconditional download-size
  row contradicting the Plan's own D-1b projection, and the import-attribute
  compatibility break. The last was verified by probe: an esbuild 0.28.1 build
  of `import v from "./a.json" with { type: "json" }` bundles successfully and
  reports `args.with = {"type":"json"}` to `onResolve`, which the Snapback
  plugin ignores (`packages/snapback-codegen/index.mjs:7783`). v0.2 had placed
  import attributes in the invalid corpus and the fail-closed matrix; that is a
  silent admission tightening in a migration the Summary calls
  semantics-preserving.
- **Confirmed:** `LLP 0041`'s "one empty opposite-platform edge" rule
  (`llp/0041-packaged-dev-loop.rfc.md:420-430`) is scoped to Snapback's own CLI
  runtime packages, not to third-party native bindings; the
  generated-but-not-loaded state is governed at `llp/0041:955-957`; and the
  full public/local diagnostic custody profile is `llp/0010:819-836`, not
  `0010#diagnostic-shape` alone.
- **Confirmed:** `packages/snapback-codegen/file-read-capability.mjs:100`
  performs fatal UTF-8 validation at byte ingestion, before any parser sees a
  string.
- **REFUTED — the proposed Linux arithmetic correction.** Concern 2 asserts the
  candidate Linux unpacked total should be `23,712,597` and the deltas
  `-12,032,734` / `+11,592,332`. Re-measured against `registry.npmjs.org`
  (per-package `dist.unpackedSize`): `rolldown` 824,984 +
  `@rolldown/binding-linux-x64-gnu` 19,280,461 + `@oxc-project/types` 44,577 +
  `@rolldown/pluginutils` 25,693 = **20,175,715**. The defect is in the *row*
  (v0.2 printed 20,175,809); the stated **total of 23,712,503 and both delta
  columns were already correct**. Concern 2 correctly detected the internal
  inconsistency but repaired the wrong side of it. v0.3 corrects the row and
  leaves the totals and deltas unchanged. The two Linux download cells it did
  not flag are also wrong by ±300 and cancel; v0.3 corrects both.


## Round 3 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbea9-77a3-7d80-81bd-4f4b8c05df61`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, network reachable; mutually blind; ran esbuild 0.28.1 and exact Rolldown 1.2.1 probes and exercised Oxc through Rolldown’s embedded N-API path (could not load the standalone `oxc-parser` native wrapper, and could not cache the Linux binding tarballs)
**Target SHA-256:** `6da4672cb6827bf32e6545f09c8ebab64a39d1d56c47c8927bd2e01e72e61629`
**Instruction SHA-256:** `52cdfa6671ee1f14edde4f49e4899913b2a4c7a0f504233b95c130295da1fc4c`
**Status:** completed

## Verbatim review

Target SHA-256 (computed): `6da4672cb6827bf32e6545f09c8ebab64a39d1d56c47c8927bd2e01e72e61629`  
Hash status: **MATCHED** the expected hash.  
Date: **2026-08-01**

Method note: I read the complete target, every named inventory surface and relevant manifests, the definition bundler/evaluator and inline-handler implementation it delegates to, and every cited LLP section—including later normative reconciliations. I ran a binary-safe repository census, checked the size arithmetic and available package metadata, ran the esbuild 0.28.1 import-attribute probe, inspected exact Rolldown 1.2.1 and Oxc 0.142.0 package sources/typings, and ran exact Rolldown probes. Oxc behavior was exercised through Rolldown 1.2.1’s embedded exact Oxc N-API path; I could not independently load the standalone `oxc-parser` native wrapper, so equivalence of that packaging entry point remains narrowly uncertain. The Linux binding tarballs were not locally cached, so I could not independently reproduce their compressed byte counts. I did not read anything under `llp/reviews/`, did not read any filename containing `super-refine`, and made no repository edits.

## 1. Overall assessment

The migration architecture is feasible, the direct old-tool census is complete, the size argument is now honestly conditional on D-1, and much of the security-focused corpus design is strong. Exact probes support the basic one-IIFE Rolldown path, graph metadata, Oxc recovery table, offsets, import attributes, and TypeScript lowering assumptions.

The Plan is nevertheless not execution-ready. It relies on an identity protocol that governing LLP 0108 explicitly removed, contains a Rolldown option that fails under the pinned version, depends on Oxc “error classes” that the public API does not expose, and describes terminal gates that do not actually prove the post-removal package. Several material governing-text, decision, and census-scope defects remain as well.

VERDICT: NOT READY

## 2. Strengths

- The core direct-use census is complete. Binary-safe searches found exactly the seven listed esbuild execution surfaces, Acorn only in codegen, and the four listed TypeScript compiler-API surfaces. The table’s substantive role descriptions are accurate ([0140:155](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:155), [index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), [inline-handlers.mjs:1](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:1)).

- The scanner decomposition is faithful. The six Acorn responsibilities and seventh syntax-only TypeScript scan correspond to every current parser call, including the conservative parse-failure fallbacks and diagnostic ordering later captured by Stage 1 ([0140:171](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:171), [0140:666](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:666)).

- The admission-plugin requirements capture nearly all of the current esbuild path’s important behavior: descriptor-aware reads, authored-byte identity, package-scope facts, separate graphs/evaluations, transformed-functions-entry handling, controlled resolution, and in-memory IIFE output ([0140:452](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:452), [index.mjs:7698](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7698), [index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783)).

- The basic upstream architecture is real. Exact Rolldown 1.2.1 produced a single in-memory IIFE with `bundle.generate()`, no map or asset, accepted the decisive input/output options, exposed usable graph metadata, and closed cleanly. Oxc’s documented JS ESTree and TypeScript TS-ESTree projections support the adapter direction. [Rolldown’s programmatic API](https://rolldown.rs/apis/bundler-api) and the [Oxc 0.142.0 package documentation](https://www.npmjs.com/package/oxc-parser/v/0.142.0) support those capabilities.

- The baseline clearly distinguishes component-set estimates from final install-closure evidence. All displayed totals and D-1 deltas are arithmetically correct, and the conclusion—smaller only under D-1a, larger under D-1b—follows from the figures ([0140:208](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:208), [0140:247](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:247), [0140:263](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:263)).

- The acceptance design contains unusually good adversarial cases: detector agreement, non-BMP/span behavior, identity sensitivity, evaluator isolation, native cross-tuple equality, and zero-unapproved-skip checks ([0140:800](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:800), [0140:831](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:831), [0140:848](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:848), [0140:885](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:885)).

## 3. Concerns

### C1 — BLOCKING: The identity-rollout gate is built around machinery that LLP 0108 removed

Evidence checked: The Plan says LLP 0108 makes predecessor/successor tuples and stale-reference behavior normative ([0140:301](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:301)) and requires a migration across those tuples and multiple carriers ([0140:842](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:842)). LLP 0108’s later normative reconciliation explicitly supersedes contrary earlier text ([0108:656](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:656)) and removes `ExpectedOperationV1`, compatibility policies, predecessor execution windows, and tuple carriage ([0108:701](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:701)). LLP 0064 and LLP 0094 independently confirm the shipped whole-artifact/function-reference model ([0064:251](/Users/ccheever/projects/snapback/llp/0064-native-client-surfaces.rfc.md:251), [0094:973](/Users/ccheever/projects/snapback/llp/0094-wire-envelope-contract.spec.md:973)).

The identity inventory is also incomplete: `defineAssetUpload` authorizers use the same inline extraction pipeline ([inline-handlers.mjs:23](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:23)), and their canonical AST is hashed into `snapback.asset-intent-implementation.v1` ([index.mjs:2384](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:2384)). They are absent from the stated rotation carriers.

Resolution criterion: Replace the removed-tuple premise with an inventory of actual current identity producers, consumers, persisted references, and rollback paths. Specify migration behavior for both function and asset-intent identities. If predecessor/successor tuples are desired, identify them as new design owned by a governing LLP.

### C2 — BLOCKING: The pinned Rolldown manifest is invalid and still permits source-path debug output

Evidence checked: The required `comments.legal: 'none'` at [0140:494](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:494) is invalid in Rolldown 1.2.1: `comments.legal` is boolean; the deprecated `output.legalComments` accepts `'none'`. An exact probe produced an invalid-options warning followed by `InvalidArg`. The [exact v1.2.1 output option source](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.1/packages/rolldown/src/options/output-options.ts) confirms the types.

Moreover, “experimental/debug output disabled” at [0140:505](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:505) is not a pin. Rolldown 1.2.1 defaults `experimental.attachDebugInfo` to `simple`; exact output contained `//#region <module-id>` comments even with comments disabled. That can leak roots and destabilize bytes.

The assertion plan at [0140:507](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:507) also overstates normalized-option observability. In exact 1.2.1, the normalized input object exposed to `buildStart` omitted `tsconfig`, `treeshake`, `transform`, `external`, and `checks`; normalized output settings were visible later.

Resolution criterion: Include a literal, exact-version-valid manifest using `comments: { legal: false, … }` or `comments: false`, pin `experimental.attachDebugInfo: 'none'`, and fixture absence of source/debug markers. Validate the immutable input manifest in Snapback, assert only Rolldown’s observable normalized subset, and behavior-test the remaining load-bearing input settings.

### C3 — BLOCKING: The Oxc error-class gate cannot be implemented through the specified API

Evidence checked: The “pinned call matrix” names `parseAsync` ([0140:353](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:353)); `oxc-parser@0.142.0` exports `parseSync` and asynchronous `parse`, not `parseAsync`.

More importantly, the Plan requires an exhaustive disposition of every Oxc “error class” ([0140:431](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:431)). The exact `OxcError` API exposes severity, free-text message, labels, help text, and codeframe—no stable code, class, or discriminant. Therefore the Stage-1 gate cannot enumerate stable upstream classes as written. The measured recovery table itself checked out, as did `preserveParens` and UTF-16 offsets; the defect is the proposed classification mechanism, not those observations. See the [exact Oxc 0.142.0 package documentation](https://www.npmjs.com/package/oxc-parser/v/0.142.0).

Resolution criterion: Define finite Snapback-owned structural categories for deliberately mapped cases; treat every otherwise-unrecognized parser error as fatal. State whether any exact-version message matching is permitted and fixture it if so. Replace `parseAsync` with `parse`, and put the actual per-scanner values—including `showSemanticErrors`—in the Plan rather than leaving them as an execution-time open question.

### C4 — BLOCKING: The stated gates do not prove the final post-removal package

Evidence checked: The Plan claims every gate has an executable command and machine-readable manifest ([0140:603](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:603)). Stage 3 instead contains partly descriptive actions and no receipt path ([0140:757](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:757)); Stage 4 contains neither a command nor manifest ([0140:788](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:788)). The acceptance introduction says each row names its manifest, but the rows do not ([0140:797](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:797)).

More seriously, the two-tuple cold-install proof precedes removal of the dual implementation and esbuild dependency ([0140:772](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:772)). No explicit post-removal repack, clean install, semantic corpus, or browser/doctor proof follows. A passing execution can therefore prove one package closure and publish a different one.

Even after that is repaired, a finite corpus would still leave complete grammar equivalence, absence of every possible resolver escape, and future upstream versions unproven. Exact pins bound the version risk; seeded differential/property testing would materially reduce the first two.

Resolution criterion: Give every stage and matrix row exact commands, receipt paths, case IDs, corpus digests, and skip policy. Add a terminal post-removal pack-and-inspect plus both-tuple clean-install/generate/browser/doctor and semantic-equality run against the actual final package closure.

### C5 — MATERIAL: D-1 is still an unresolved architecture decision

Evidence checked: D-1 changes security ownership, identity migration, shipped dependency closure, and the sign of the size result ([0140:271](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:271)). The Plan acknowledges that it is the one question not answerable during ordinary execution ([0140:917](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:917)), yet supplies no branch-selection criterion beyond recording the choice at Stage 1.

Resolution criterion: Select D-1 before readiness, or define a hard pre-implementation decision artifact with owner, evidence requirements, security/maintenance/size criteria, and fallback. Under D-1a, its governing identity design must close C1 first.

### C6 — MATERIAL: Governing-text reconciliation is inaccurate and incomplete

Evidence checked:

- The Plan first adopts the as-built absolute-path/two-entry allowlist, then permits narrowing it ([0140:118](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:118)). Narrowing contradicts the “not a semantic rewrite” scope. The cited source range is wrong; the actual entries are `@expo/snapback-codegen/define` and `/standard-patterns` at [index.mjs:345](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:345), with resolution at [index.mjs:7793](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7793). Neither positive allowlist case is expressly required in Stage 0.

- The LLP 0041 anchors at [0140:107](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:107) and [0140:583](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:583) do not contain all the attributed requirements. Prior-artifact preservation is explicit in [0108:308](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:308); the quoted opposite-runtime rule appears in a different LLP 0041 section at [0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420).

- Stage 4’s fixed update list ([0140:780](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:780)) omits LLP 0040’s esbuild-based deployment-identity description ([0040:648](/Users/ccheever/projects/snapback/llp/0040-cloudflare-narrow-proof.rfc.md:648)) and LLP 0091’s normative Cloudflare amendment ([0091:799](/Users/ccheever/projects/snapback/llp/0091-rqs-token-and-wire-contract.spec.md:799)).

Resolution criterion: Preserve the as-built resolver unambiguously, name and fixture both allowlist entries, correct the anchors, and make governing-document reconciliation census-driven rather than an eight-document fixed list.

### C7 — MATERIAL: The broader authority-ledger scope is not reflected in the inventory

Evidence checked: The Plan requires the ledger to recognize `node:vm` and `Function` compilation authority ([0140:138](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:138)), but the table omits codegen’s production `node:vm` evaluator at [index.mjs:7612](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7612). Retained runtime/security probes also use these mechanisms. Manifests and spawned CLIs are declared in scope, yet the table does not represent the relevant dependency declarations, and the `check-package-export-types` row omits its `tsc` subprocess.

This does not invalidate the esbuild/Acorn/TypeScript API census—it is complete—but it makes the promised broader ledger and “empty unexplained set” ambiguous.

Resolution criterion: Either narrow the ledger explicitly to migration-owned parser/bundler/transform authority, or inventory and classify the retained evaluator, runtime probes, manifests, and CLI invocations and align the completion criterion with that broader scope.

### C8 — MINOR: The NUL explanation contains a direct ordering error

Evidence checked: The Plan says the NUL is at line 625 and `getTypeChecker` at line 515 occurs after it ([0140:128](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:128)). Line 515 is before line 625. Locally, ordinary `rg` and `grep` reported binary matches on both sides of the NUL; `rg -a` supplied exact lines. Binary-safe census tooling remains sensible, but the stated causal history was not reproduced.

Resolution criterion: Correct the line ordering and describe the observed binary-file behavior accurately while retaining the NUL-bearing self-test.

## 4. Suggestions

- Execute the toolchain convergence under D-1b first, then treat D-1a as a separately reviewed identity/security migration. That reduces simultaneous moving parts and lets real Rolldown/Oxc evidence inform whether removing TypeScript is worth owning a new binding resolver.

- Add seeded, shrinking differential fuzzing for parser projection, recovery/error precedence, import-edge extraction, and path/symlink resolver metamorphisms. Commit seeds and minimized regressions to the corpus.

- Treat the Snapback resolve/load ledger as deployment-identity authority and Rolldown metadata only as a cross-check, as the Plan already begins to do.

- Add LLP 0004’s root fail-closed codegen and handler-bundle contracts to the governing set ([0004:133](/Users/ccheever/projects/snapback/llp/0004-application-data-api.rfc.md:133)).

- Call the Stage-2 state “repository default, unreleasable” until the two-tuple terminal gate passes; that is clearer than “production” for a path forbidden from publication or serving.

## 5. Open questions

1. Which D-1 branch is selected, and what evidence justifies accepting its security, maintenance, identity, and package-size consequences?
2. Under D-1a, what actual current carriers consume function and asset-intent implementation identities, and how do stale references, downgrade, and rollback work without the removed tuple protocol?
3. What stable Snapback-owned parser categories replace the nonexistent Oxc error-class discriminant?
4. What is the exact valid Rolldown 1.2.1 manifest, including comment categories and `attachDebugInfo`, and which settings are proved behaviorally rather than through normalized options?
5. Is the resolver definitively preserving absolute-local imports and both `@expo/snapback-codegen/*` allowlist entries?
6. What exact post-removal commands and receipts prove that the final packed closure—not the transitional dual closure—works on both supported tuples?
7. Is the authority ledger limited to migration-owned syntax/build tools, or does it truly include all builtin-hosted compilation/evaluation authority?

## 6. Readiness verdict

VERDICT: NOT READY

Blocking list:

1. The identity-rotation design relies on a protocol LLP 0108 explicitly removed and omits asset-upload authorizer identity.
2. The pinned Rolldown manifest is invalid at 1.2.1 and fails to disable default source-path debug output.
3. The Oxc error-class disposition gate depends on an API discriminator that does not exist.
4. The stage gates do not prove the final post-removal package closure.
## Orchestrator verification (outside the verbatim body)

All four blocking items **confirmed** by independent check:

- `llp/0108-inline-handlers-and-result-contracts.spec.md:701-709` (§B, under the
  round-3 normative reconciliation at `:656`) does remove `ExpectedOperationV1`,
  compatibility notices, predecessor execution windows, and tuple carriage. v0.3
  had cited that machinery as normative for the D-1a rotation rollout. Refuted
  premise, corrected in v0.4.
- `packages/snapback-codegen/index.mjs:2384-2390` does hash a `canonicalAst`
  into `snapback.asset-intent-implementation.v1` for `defineAssetUpload`
  authorizers — a second identity carrier v0.3's constraint 5 never named.
- Probe: `comments: { legal: 'none' }` on Rolldown 1.2.1 fails
  (`Expected boolean but received "none"`); `CommentsOptions.legal` is
  `boolean` (`define-config-DSMNXceb.d.mts:342`). Both families found this
  independently.
- `oxc-parser@0.142.0` exports `parse` and `parseSync` — there is **no**
  `parseAsync`, which v0.3's call matrix named.
- Probe: default Rolldown IIFE output contains `//#endregion` debug markers,
  so "experimental/debug output disabled" needed the explicit
  `experimental.attachDebugInfo` pin.
- `packages/snapback-codegen/index.mjs:7612` is the production `node:vm`
  evaluator inside codegen, absent from the v0.3 table while the ledger spec
  claimed to recognize `node:vm`.

Also confirmed and applied: the LLP 0041 quote lives under
"Nine-package candidate promotion — 2026-07-28" (`:420-430`), not
`#runtime-distribution`; `llp/0040:648` and `llp/0091:799` carry Cloudflare
deployment-identity text the fixed Stage-4 list omitted.

**Separately measured while adjudicating:** bare top-level await under
`format: 'iife'` at Rolldown 1.2.1 is a hard
`[UNSUPPORTED_FEATURE] Top-level await is currently not supported with the
'iife' output format`. That closes v0.3's open question 6, which v0.4 now
states as fact.


## Round 4 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbec2-9bd1-70f1-8415-415eaa4e15f5`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact-version probes against `rolldown@1.2.1`, esbuild 0.28.1, and the Oxc implementation bundled in Rolldown; shell network was unavailable, so Linux native tarball bytes and standalone `oxc-parser` install behavior were not independently verified
**Target SHA-256:** `154cf6b5f1031d7b0ab977ce4b9755e09f7ba55b7b0a2488969e3a683bd7ae26`
**Instruction SHA-256:** `980472bfb402eaf39e9c79e2a1ac4a0c68c5fe2fa7bcfec763095c02d26f5513`
**Status:** completed

## Verbatim review

Computed target SHA-256: `154cf6b5f1031d7b0ab977ce4b9755e09f7ba55b7b0a2488969e3a683bd7ae26` — **MATCHED** the expected hash.

Review date: 2026-08-01.

Method note: I read the complete target; every named inventory surface; the current definition bundler, Acorn scanners, TypeScript scanners, inline-handler implementation, and delegated file-reading/identity code; and the cited sections of LLPs 0009, 0010, 0030, 0041, 0049, 0064, 0108, and 0118. I ran a binary-safe repository census for first-party esbuild, Acorn, TypeScript compiler, and builtin transform uses, excluding the forbidden paths and filenames. I inspected official Rolldown/Oxc documentation and ran local exact-version probes against `rolldown@1.2.1`, esbuild 0.28.1, and the exact `oxc-parser@0.142.0` implementation bundled in Rolldown’s utilities. I reproduced the macOS size table from cached npm tarballs and checked all Linux arithmetic. Shell network access was unavailable, so I could not independently fetch the Linux native tarballs or install the standalone `oxc-parser` package; Linux source byte values and standalone-package installation behavior remain unverified. I did not read anything under `llp/reviews/` or any file whose name contains `super-refine`.

## 1. Overall assessment

The migration is feasible, and most of this Plan is unusually strong. The first-party census is substantively complete; the governing anchors support the stated constraints; the Rolldown admission plugin closely accounts for the current esbuild-hosted behavior; the size conclusions are correctly conditioned on D-1; and most pinned-tool claims survived exact-version probing.

It is nevertheless not executable as written. The handler top-level-`await` policy creates a direct contradiction among current admission, the proposed fatal-error rule, and the Stage-1 parity gate. There are also material omissions around TypeScript type-only edges, Stage-3 evidence custody, and the claimed exhaustive admission proof. Finally, one newly stated “measured” Rolldown result was measured without the Plan’s pinned `minify: false` option and is factually wrong under the actual manifest.

VERDICT: NOT READY

## 2. Strengths

- The inventory is substantially complete. I found all seven direct esbuild execution surfaces named at [llp/0140…:184](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:184), exactly the six Acorn calls enumerated at [llp/0140…:198](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:198), and exactly the four first-party TypeScript compiler-API surfaces. The Plan also correctly distinguishes the `TypeChecker`-dependent inline-handler path from syntax-only uses.

- The governing anchors exist and support the attributed constraints. In particular, generated-artifact closure and diagnostic rules appear in [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330), static analysis as defense in depth in [LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774), Vite regeneration behavior in [LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603), package distribution in [LLP 0041:297](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:297), deployment freshness in [LLP 0049:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997), inline identity in [LLP 0108:855](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:855), and the current controlled-bundler shape in [LLP 0118:246](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:246).

- The admission-plugin requirements at [llp/0140…:536](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:536) capture nearly all load-bearing behavior in the existing bundler: synthetic facade, capability-aware reads, exact allowlist, local resolution, package-format manifests, graph identity, separate schema/functions/routes evaluation, functions-only transformed entry, IIFE/banner behavior, and diagnostic re-derivation. Those correspond to the current implementation beginning at [index.mjs:7679](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7679).

- Exact-tool feasibility is mostly confirmed. Rolldown supports controlled programmatic generation and explicit cleanup; the pinned settings can emit one in-memory IIFE with no maps, legal comments, or debug-region markers. Oxc provides the required ESTree/TS-ESTree projection, full UTF-16 offsets, and TypeScript parsing/lowering without type checking. See the official [Rolldown Bundler API](https://rolldown.rs/apis/bundler-api), [Rolldown options](https://rolldown.rs/reference/Interface.RolldownOptions), and [Oxc parser documentation](https://oxc.rs/docs/guide/usage/parser.html).

- The measured Oxc parser table at [llp/0140…:461](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:461) reproduced cell-for-cell. The parenthesis behavior, UTF-16 offset 18, `parse`/`parseSync` exports, and absence of a stable error code/class/discriminant also reproduced.

- The size basis at [llp/0140…:233](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:233) clearly separates tarball bytes, unpacked payload, filesystem allocation, and warm-cache transfer. The macOS cells reproduced exactly, every Linux total and D-1 delta is arithmetically correct, and the conclusion at [llp/0140…:274](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:274) follows from the displayed numbers.

- The Plan has strong identity and evaluator gates: real permission-denied subprocess execution at [llp/0140…:799](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:799), cross-tuple semantic equality at [llp/0140…:699](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:699), identity sensitivity at [llp/0140…:865](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:865), and a terminal proof against the actual post-removal package closure at [llp/0140…:885](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:885).

## 3. Concerns

### 1. BLOCKING — Handler top-level `await` has no satisfiable policy

**Evidence checked.** The current scanner explicitly parses closed scripts with `allowAwaitOutsideFunction: true` at [index.mjs:5090](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5090), and no later `AwaitExpression` rule rejects it. The Plan’s exact Oxc probe establishes that script-mode top-level `await` produces an error at [llp/0140…:461](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:461). The proposed adapter then makes every unmatched error fatal and forbids silently suppressing a categorized error at [llp/0140…:490](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:490).

That cannot satisfy the Stage-1 requirement for “no … admission regression in either direction” at [llp/0140…:790](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:790). The acceptance matrix nevertheless permits either continued admission or a new refusal at [llp/0140…:935](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:935), while Open Questions 5–6 leave the choice unresolved. Fixture absence would not reconcile a semantic contradiction.

**Resolution criterion.** Choose one implementable policy in the Plan now:

- preserve admission through a specifically defined nonfatal Oxc recovery category or another parse strategy, including `await`-as-identifier and HTML-comment parity; or
- declare a deliberate admission tightening with a stable code/span/envelope and rollout, and amend the “no semantic rewrite” premise plus the Stage-1 parity gate accordingly.

The gate, adapter rule, fixture oracle, and acceptance matrix must all require the same result.

### 2. MATERIAL — The Plan still requires an error-class mechanism it proves impossible

**Evidence checked.** The architecture correctly says `OxcError` has no stable class or discriminant and that a table keyed on every Oxc error class “is not implementable and must not be specified” at [llp/0140…:490](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:490). Exact 0.142.0 probing confirmed that shape.

Stage 1 still requires “the error-class disposition table” at [llp/0140…:768](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:768), and Open Question 4 again asks for every upstream error class and an undecided `showSemanticErrors` value at [llp/0140…:1051](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1051). The latter value was already normatively pinned to `true` at [llp/0140…:419](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:419).

**Resolution criterion.** Replace every remaining “error-class” requirement with a named finite Snapback structural-category manifest, the fatal-unmatched invariant, and any explicitly version-pinned message matches. Remove the already-answered `showSemanticErrors` question or name concrete scanner exceptions.

### 3. MATERIAL — The Oxc edge ledger lacks a runtime projection for TypeScript type-only edges

**Evidence checked.** The current catch-all resolver at [index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783) only receives edges surviving esbuild’s TypeScript lowering. Exact esbuild 0.28.1 did not invoke it for `import type` from a missing bare package. Exact Rolldown 1.2.1 behaved the same for:

- `import type { T } from "not-installed"`;
- `export type { T } from "not-installed"`; and
- a value import used only in a type position.

The runtime-value twin did invoke the resolver and refuse.

The proposed Oxc ledger is described as authoritative and carrying “every specifier” at [llp/0140…:632](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:632), but it does not distinguish authored syntactic specifiers from admitted runtime edges. “Import elision” is mentioned only generically at [llp/0140…:531](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:531), and the Stage-0 graph corpus at [llp/0140…:730](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:730) does not enumerate these forms. A naïve ledger would reject or hash dependencies that do not exist in the current runtime graph.

**Resolution criterion.** Define two explicit layers: an authored syntactic-specifier ledger for spans and diagnostics, and a projected runtime-edge ledger governing admission and identity. Specify how `import type`, `export type`, type queries, value imports used only as types, and TypeScript `import = require` forms project under `tsconfig: false`. Add missing/bare/outside-root type-only fixtures and runtime-value twins, asserting resolver calls, graph membership, and identity.

### 4. MATERIAL — Stage 0 classifies a known-invalid redeclaration as valid

**Evidence checked.** Under “Valid-side additions,” the Plan lists `let a; let a;` while simultaneously saying Acorn rejects it at [llp/0140…:739](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:739). Exact Acorn probing confirmed rejection. Current code maps that parse failure to `BUNDLE_HANDLER_PARSE_FAILED` at [index.mjs:5098](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5098).

Because Stage 0 freezes the oracle used by every subsequent gate, this is not harmless prose: the manifest can encode the wrong baseline verdict.

**Resolution criterion.** Move the redeclaration to the baseline-invalid corpus and pin its current code, source span, envelope, and precedence. Keep JSON attributes and currently accepted handler top-level `await` in the valid corpus unless concern 1 deliberately changes that contract.

### 5. MATERIAL — Stage 3 has no machine-readable gate despite the Plan requiring one

**Evidence checked.** The universal gate discipline says every stage names an executable command and a manifest containing IDs, counts, digest, versions, options, and zero unapproved skips at [llp/0140…:708](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:708). The acceptance matrix also says a row without a case ID in a stage manifest fails Stage 0 at [llp/0140…:914](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:914).

The Stage-3 gate at [llp/0140…:862](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:862) names several independent commands but no Stage-3 receipt path, orchestrating command, case inventory, corpus digest, or skip assertion. This leaves Cloudflare identity and the Vite/dev-state evidence without the custody promised elsewhere.

**Resolution criterion.** Add a Stage-3 orchestrating command and receipt path, with exact case IDs/counts, tool and option manifests, corpus digest, and zero-unapproved-skips assertion. Map the identity sensitivity leg, browser/package proofs, maintained-demo dispositions, and all Vite dev-state cases into it.

### 6. MATERIAL — “No widening, enumerated not sampled” overstates an undefined finite sweep

**Evidence checked.** The actual mechanism is a frozen corpus, a generated set “derived from Acorn’s early-error productions,” and seeded fuzzing at [llp/0140…:516](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:516). The acceptance row nevertheless calls this “enumerated not sampled” at [llp/0140…:940](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:940). No authoritative production list, generator algorithm/version, coverage mapping, or completeness rule is named. The omitted type-only edge family above is a concrete example of a meaningful axis outside the listed corpus.

A passing finite run would still leave unproven:

- admission equivalence outside the declared corpus and generator;
- combinations of parser recovery, early errors, and scanner rules not generated;
- behavior under future Rolldown/Oxc versions;
- performance outside the frozen workloads and measured hosts;
- unsupported platform tuples; and
- post-publication rollback effectiveness.

Those residual boundaries are normal for empirical tests, but the Plan should not label them exhaustive.

**Resolution criterion.** Define the authoritative negative-input sources and coverage mapping—such as the applicable Acorn parser suite, relevant Test262 negative syntax/early-error cases, and a versioned deterministic generator—or weaken the claim to bounded differential evidence. Record corpus sources, hashes, generator version, production/category coverage, fuzz seeds, and the residual nonclaim.

### 7. MATERIAL — The measured Rolldown statement-preservation claim used the wrong option set

**Evidence checked.** The manifest pins `output.minify: false` at [llp/0140…:577](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:577), but the measured caution claims that `treeshake: false` still eliminates an unused binding and turns `export const y = 2` directly into `exports.y = 2` at [llp/0140…:607](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:607).

With the full pinned 1.2.1 manifest, `const unused = 1; export const y = 2;` retained the unused declaration and emitted `const y = 2; … exports.y = y`. The claimed elimination occurs when `minify` is omitted and Rolldown inherits its default DCE-only minification. See the official [Rolldown minify option](https://rolldown.rs/reference/OutputOptions.minify).

The broader conclusion that transient bundle bytes are not the semantic oracle is reasonable; the stated measurement supporting it is not.

**Resolution criterion.** Re-run and record the probe using the complete versioned manifest, then rewrite the paragraph to the observed result. If source-statement preservation is intentionally not a contract, state and justify that normatively rather than deriving it from the invalid probe.

### 8. MINOR — One inventory row omits direct `tsc` authority

**Evidence checked.** The row at [llp/0140…:188](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188) describes only the compiler-API export-parity phase. The script also resolves the pinned `tsc` binary at [check-package-export-types.mjs:66](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:66) and directly compiles a synthetic external-consumer fixture at [check-package-export-types.mjs:176](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:176). Stage 0 explicitly says spawned CLIs belong in the ledger.

**Resolution criterion.** State that this script owns both consumer-fixture compilation through `tsc` and compiler-API export parity, classifying both as retained type-checking authority.

### 9. MINOR — D-1b’s selection criterion understates its costs

**Evidence checked.** D-1b explicitly leaves two parser stacks in the shipped package at [llp/0140…:313](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:313), yet the selection criterion says the size regression is “the only cost of D-1b” at [llp/0140…:355](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:355). Dual version custody, maintenance, security updates, and duplicated native/JS parsing behavior are also costs, even if D-1b is the lower-risk initial migration.

**Resolution criterion.** Replace “only cost” with “principal quantified cost” and require the D-1 artifact to record ownership and maintenance/version-custody consequences of retaining TypeScript.

## 4. Suggestions

- Generate scanner and bundler tests from one declarative admission matrix: syntax form × syntactic edge × runtime edge × expected diagnostic × identity membership. This would make the Oxc scanner and Rolldown plugin two consumers of one policy rather than independently maintained lists.

- Add paired fixtures for bare versus `node:` builtins. Current code distinguishes `node:fs` as `CODEGEN_AMBIENT_IMPORT_UNHASHABLE` at [index.mjs:7790](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7790) from bare `fs` as `CODEGEN_AMBIGUOUS_IMPORT` at [index.mjs:7793](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7793).

- Record the observed Rolldown graph-metadata caveat directly in the Stage-3 spike: `moduleParsed` and `getModuleIds()` omitted `\0rolldown/runtime.js` in the exact probe, while `OutputChunk.modules` included it. The Plan correctly leaves metadata sufficiency unresolved at [llp/0140…:1046](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1046).

- Make package manifests and direct dependency declarations explicit ledger records even where they do not merit separate inventory-table rows.

- Clarify what “served capability” means in the repository-default-but-unreleasable Stage-2 state at [llp/0140…:1028](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1028), and automate that release fence.

- Add a short post-publication rollback procedure: superseding package version, rebuild source revision, affected artifact/identity handling, and evidence rerun. The existing rollback policy is coherent before release but stops at a source/package/lock revision.

## 5. Open questions

1. Will handler top-level `await` remain admitted, or is this migration intentionally changing admission? What exact parser strategy or diagnostic implements that answer?

2. Which `showSemanticErrors: true` errors are structural mappings, which are fatal unmatched errors, and are any explicitly advisory/nonfatal?

3. What is the normative projection from Oxc’s authored TypeScript specifiers to the runtime graph used for admission and identity?

4. What exact corpus and generator justify the “enumerated” widening claim, and what residual language space is explicitly outside that claim?

5. What command and receipt carry Stage-3 case IDs, skip status, option manifests, and deployment/Vite evidence?

6. Which D-1 branch is selected, and—under D-1b—who owns long-term TypeScript/Oxc version coherence?

7. Which Rolldown metadata surface becomes authoritative for parsed-but-eliminated and synthetic modules after the Stage-3 spike?

8. How is the Stage-2 unreleasable state enforced, and what is the operational rollback after final removal and npm publication?

## 6. Readiness verdict

The technical direction is sound, but the Plan is not ready for execution.

Blocking list:

- **Formal blocker:** handler top-level `await` cannot simultaneously satisfy current admission, the fatal Oxc error rule, and the bidirectional Stage-1 parity gate.
- **Readiness-blocking material defects:** stale unimplementable error-class gates; no runtime projection for TypeScript type-only edges; a misclassified Stage-0 redeclaration oracle; missing Stage-3 manifest custody; an underspecified “enumerated” admission proof; and a false measured Rolldown result under the pinned option manifest.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

Re-probed independently against the sandbox at `rolldown@1.2.1`; **all
confirmed**:

- **Concern 7 is right and the earlier draft was wrong.** With the *complete*
  pinned manifest (`minify: false` included), `const unused = 1; export const
  y = 2;` emits `const unused = 1; const y = 2; … exports.y = y;` — the
  declaration is retained. The elimination the v0.4 caution reported appears
  only when `minify` is omitted and Rolldown inherits a DCE-only default. The
  caution is rewritten in v0.5 to the manifest-accurate result.
- **Concern 3 is right.** `import type { T } from "not-installed"` bundles
  cleanly at Rolldown 1.2.1 and `resolveId` is invoked **only** for the entry —
  never for the type-only specifier. A single "every specifier the parser saw"
  ledger would over-admit and over-hash; v0.5 splits it into an authored
  syntactic-specifier ledger (spans, diagnostics, `require.resolve`) and a
  projected runtime-edge ledger (admission, identity).
- **Concern 1 is right**, and v0.5 chooses the policy rather than deferring it:
  handler top-level `await` stays admitted via a named non-fatal structural
  category, not a mode switch to `sourceType: 'module'` (which would trade one
  preserved construct for two new divergences).
- Concerns 2, 4, 5, 6, 8, and 9 confirmed and applied.

**One fact found while adjudicating, which neither review reported:**
`experimental` is a Rolldown **input** option. Passing
`experimental.attachDebugInfo` under output options is rejected as an invalid
key — so v0.4's manifest row, though it named the right option, would not have
worked where it sat. v0.5 marks the row as an input option. The probe also
confirms `'none'` removes the `//#region` markers.


## Round 5 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbedd-05bc-7730-8173-082e787af4df`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact-version Rolldown 1.2.1 and Oxc 0.142.0 probes; the read-only environment prevented extracting the standalone Oxc native addon and prevented Linux/x64 and clean-publication proofs. The run reports that one delegated pass accidentally crossed the review-artifact boundary; that pass was discarded before its findings were received and the reference audit was rerun from scratch by a clean reviewer — recorded here rather than passed over.
**Target SHA-256:** `6f9108ed90eb3e20a01fab465283ce9ec77384f1f939b02379973b4f7e60ee2f`
**Instruction SHA-256:** `a418ffa23bb3bc993a88ea639a326fff62d089c793506b9a335edb826a2c8d95`
**Status:** completed

**Round-5 note:** an earlier round-5 launch was killed when the orchestrating process exited; it produced no output and is not recorded. This is a fresh run against the identical SHA-pinned target and capsule.

## Verbatim review

Computed target SHA-256: `6f9108ed90eb3e20a01fab465283ce9ec77384f1f939b02379973b4f7e60ee2f` — **matched the expected hash**.

Review date: 2026-08-01.

Method note: I read the complete target, every inventory-table surface, the codegen implementation and file-read capability, the explicitly cited governing LLP sections, package metadata, and relevant tests. I performed binary-safe repository searches for direct esbuild, Acorn, TypeScript compiler-API, generated-source, and builtin-transform uses. I also inspected official upstream documentation and executed exact-version Rolldown 1.2.1 and Oxc parser 0.142.0 probes where possible. The read-only environment prevented extracting the standalone Oxc native addon and prevented Linux/x64 and clean-publication proofs; parser probes instead used the exact 0.142.0 wrapper with the available Oxc binding. Excluded review artifacts and filenames containing `super-refine` were not used. One delegated pass reported accidentally crossing the review-artifact boundary; that pass was discarded before its findings were received, and the reference audit was rerun from scratch by a clean reviewer. No files were edited.

## 1. Overall assessment

The migration direction is sound, and this is unusually close to an executable Plan. The direct-use census is complete, the governing anchors mostly exist and support their paraphrases, the baseline arithmetic is correct, and the major Rolldown/Oxc capability assumptions held under exact-version probes. The Plan also takes identity, diagnostic custody, fail-closed resolution, native-package closure, and rollback much more seriously than a routine bundler migration usually does.

It is nevertheless not ready. The Stage-4 publication guard creates an impossible state transition. The parser migration does not yet specify the existing cross-dialect behavior of three Acorn-backed consumers, the resolver contract does not pin exact-file-only lookup, and the acceptance matrix contradicts the chosen top-level-`await` policy. Its resolved-closure size oracle is also incompatible with its own deduplication analysis. Finally, D-1 remains an unmade, non-empirical architecture decision, and governing-document updates are sequenced after independently landable code changes.

As written, a passing run would therefore not establish that admission, identity, diagnostic, and publication contracts all survived.

VERDICT: NOT READY

## 2. Strengths

- The repository census is complete at the file level. I found exactly the eleven execution surfaces listed in the inventory and no omitted first-party direct esbuild, Acorn, or TypeScript compiler-API use. The Plan correctly recognizes generated-source imports, computed module URLs, and builtin-hosted transforms as cases a simple import grep would miss ([LLP 0140:135](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:135), [LLP 0140:162](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:162), [LLP 0140:182](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:182)).

- The Plan correctly distinguishes syntax parsing from type-semantic authority. The TypeScript `Program`/`TypeChecker` use and canonical-AST identity exposure are real ([inline-handlers.mjs:449](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:449), [inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494)), and D-1 honestly prices both the security cost of replacing that service and the package-size cost of retaining it ([LLP 0140:298](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:298)).

- The core upstream feasibility assumptions hold. Exact probes produced an in-memory single-IIFE Rolldown build, controlled `resolveId`/`load`, one output chunk, absent sourcemaps, TypeScript lowering without type checking, and repeatable bytes on the tested host. The pinned `treeshake:false` plus `minify:false` behavior also matched the Plan. These capabilities agree with Rolldown’s [programmatic API](https://rolldown.rs/guide/getting-started), [plugin interface](https://rolldown.rs/reference/Interface.Plugin), and [output model](https://rolldown.rs/reference/Interface.OutputChunk).

- The Oxc claims about ESTree/TS-ESTree shapes, UTF-16 offsets, recovered programs, parentheses, and the lack of stable diagnostic discriminants reproduced under 0.142.0. The package documents the relevant parser options and AST model in the [exact npm release](https://www.npmjs.com/package/oxc-parser/v/0.142.0). The import-attribute probe also confirmed that esbuild 0.28.1 and Rolldown 1.2.1 admit both `with` and legacy `assert` forms, supporting the decision at [LLP 0140:720](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:720).

- The evidence architecture is strong: explicit manifests, zero-unapproved-skip assertions, semantic rather than bundle-byte oracles, a real denied evaluator, two supported tuples, and a terminal post-removal proof ([LLP 0140:775](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:775), [LLP 0140:872](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:872), [LLP 0140:963](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:963)). The residual nonclaim appropriately acknowledges that bounded differential testing is not grammar equivalence ([LLP 0140:554](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:554)).

- The component-size measurement basis is precise enough to reproduce from immutable registry versions, and all displayed sums and D-1 deltas are arithmetically correct ([LLP 0140:233](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:233), [LLP 0140:254](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:254), [LLP 0140:274](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:274)).

## 3. Concerns

### C1 — BLOCKING: the publication state machine has no legal transition

Evidence checked:

Stage 4 requires the “eventual public-registry proof” while the dual implementation still exists, because removal is permitted only afterward ([LLP 0140:955](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:955)). The publication guard simultaneously rejects any publication while the dual implementation exists or while the post-removal Stage-4 receipt is absent ([LLP 0140:1127](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1127)). That receipt is emitted only by the terminal post-removal proof ([LLP 0140:981](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:981)).

LLP 0041 requires publishing exact candidate versions under a non-default tag before registry re-download and clean public-registry installation can occur ([LLP 0041:394](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394), [LLP 0041:401](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:401), [LLP 0041:411](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:411)). Consequently:

1. The public proof cannot run before dual removal.
2. Dual removal is forbidden until that proof passes.
3. Candidate publication is forbidden until the receipt produced after both.

Resolution criterion: define separate pre-removal compatibility, post-removal local-package qualification, candidate-publication authorization, public-registry verification, and final-promotion states. Permit immutable non-default-tag candidate publication after the post-removal local proof, then issue the terminal Stage-4 receipt only after registry verification. Continue blocking `latest`, staged promotion, and served capability until that terminal receipt exists.

### C2 — MATERIAL: D-1 is still an unmade architecture decision

Evidence checked:

D-1 controls whether Snapback ships TypeScript or creates a new security-relevant binding resolver plus an identity migration. The Plan says the branch is an author decision ([LLP 0140:355](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:355)), recommends D-1b without selecting it ([LLP 0140:369](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:369)), and admits that this is the one open question not answerable during execution ([LLP 0140:1139](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1139)).

Under D-1a, the identity rollout and replacement symbol service remain future design work; under D-1b, the size conclusion and ongoing TypeScript identity/version custody change. Those are different plans, not merely two implementation tactics.

Resolution criterion: choose a branch before accepting LLP 0140. The cleanest resolution is the document’s own recommendation: make D-1b the scope of this migration and commission D-1a as a separate identity/security Plan. Alternatively, choose D-1a now and include its complete identity-carrier rollout, ownership, compatibility, and rollback design here.

### C3 — MATERIAL: the parser census and parity plan omit current cross-dialect behavior

Evidence checked:

The inventory says Acorn scans JavaScript while TypeScript’s AST scans TypeScript ([LLP 0140:186](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:186)). That is incomplete. Raw TypeScript handler source also reaches three Acorn consumers:

- stream inference, whose parse failure becomes a textual regex fallback ([index.mjs:4961](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4961), [index.mjs:4982](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4982));
- static query-result refusal, whose parse failure returns no findings ([index.mjs:1446](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1446), [index.mjs:5661](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5661));
- protected-query analysis, whose parse failure selects the masked legacy scanner ([index.mjs:1473](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1473), [index.mjs:5765](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5765)).

Moving TypeScript inputs to a successful Oxc TS parse can therefore change inferred capabilities, static-result refusals, and protected-query reachability even if the primary unsupported-source scanner remains equivalent. Stage 1 mentions fallbacks generically ([LLP 0140:844](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:844)), but the purported “pinned parser call matrix” does not actually provide per-consumer/per-dialect option values or current fallback semantics ([LLP 0140:411](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:411)).

The exact Oxc probe also falsified the blanket statement that `showSemanticErrors:false` suppresses the entire early-error family ([LLP 0140:424](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:424)): getter arity is reported with the option both off and on. The option does add a subset, including redeclarations and strict/module duplicate parameters. Current TypeScript’s `parseDiagnostics` accepts several of these before esbuild later refuses them ([index.mjs:5391](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5391)), so an Oxc refusal can change diagnostic phase, code, span, and custody even where final admission is unchanged.

Resolution criterion: add an actual per-consumer matrix containing filename extension, `lang`, `astType`, `sourceType`, `range`, semantic-error setting, current parser, current parse-failure behavior, candidate behavior, and permitted differences. Add `.ts` and `.mts` fixtures for comment-only versus real `fetchStream`, object-returning queries, and direct/aliased protected runtime calls. Run a current complete TS path versus pinned-Oxc differential for diagnostic as well as admission parity. Replace the blanket early-error claim with the measured option-sensitive subset.

### C4 — MATERIAL: exact-file-only resolution is not pinned or tested

Evidence checked:

The current resolver constructs exactly one candidate path and reads that exact path ([index.mjs:7802](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7802)). The capability reader requires that exact candidate to resolve to a regular file ([file-read-capability.mjs:34](/Users/ccheever/projects/snapback/packages/snapback-codegen/file-read-capability.mjs:34), [file-read-capability.mjs:61](/Users/ccheever/projects/snapback/packages/snapback-codegen/file-read-capability.mjs:61)). It does not probe extensions, directory indexes, `main`, or `exports`.

The proposed plugin forbids fallback into Rolldown’s resolver but does not forbid the Snapback-owned resolver from adding those lookup rules, and Stage 0 has no extensionless/directory-resolution fixture ([LLP 0140:574](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:574), [LLP 0140:799](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:799)). A widening implementation could therefore satisfy the prose.

Resolution criterion: state “one specifier maps to one exact candidate; no extension, directory-index, package-main, or package-exports probing.” Add invalid fixtures for `./helper`, `./dir`, `./dir/`, and package-like resolution beside explicit-extension valid twins, with stable diagnostic and identity assertions.

### C5 — MATERIAL: the top-level-`await` acceptance row contradicts the chosen policy

Evidence checked:

The architecture explicitly chooses continued admission of top-level `await` in handler scripts and says no new authored diagnostic is introduced ([LLP 0140:484](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:484)). Stage 0 also classifies it as valid ([LLP 0140:808](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:808)). The acceptance matrix nevertheless permits it either to remain admitted or to gain a named diagnostic ([LLP 0140:1013](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1013)).

Resolution criterion: require that handler top-level `await` remains admitted and is associated only with the internal non-fatal `top-level-await-in-script` category. A new authored refusal must fail the gate.

### C6 — MATERIAL: the D-1b resolved-closure size oracle is not supported by the baseline

Evidence checked:

The baseline is an isolated component-set calculation. The Plan correctly says a Vite application may already contain Rolldown and that React/headless resolved trees must be measured separately ([LLP 0140:290](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:290)). The acceptance matrix then says both resolved installation shapes regress under D-1b “by construction” and requires each resolved-closure delta to match the isolated component-set delta within 5% ([LLP 0140:1075](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1075)).

That does not follow. Existing React/Vite dependencies may deduplicate Rolldown, Oxc, or TypeScript, so the resolved delta can have a different magnitude or even sign while the package manifests are correct.

Resolution criterion: derive separate expected headless and React resolved-closure deltas from Stage-0 lock/tree receipts. Use the component table as an isolated decomposition, not a 5% oracle for both shapes. Do not predeclare the sign of a resolved delta until that shape’s before/after dependency graph establishes it.

### C7 — MATERIAL: documentation updates are staged after independently landable behavior changes

Evidence checked:

All LLP/Guide corrections are deferred to Stage 4 ([LLP 0140:969](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:969)), while Stages 1–3 may land independently ([LLP 0140:1113](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1113)). Repository policy requires documentation updates in the same commit as the behavior they describe ([AGENTS.md:128](/Users/ccheever/projects/snapback/AGENTS.md:128)).

This would knowingly leave stale governing text after intermediate landings, including LLP 0010’s resolver description ([LLP 0010:372](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:372)).

Resolution criterion: move each affected LLP and Guide amendment into the stage gate and landing commit that changes its surface. Keep Stage 4 as a terminal reconciliation/audit, not the first documentation update.

### C8 — MINOR: several governing citations are incomplete or inaccurate

Evidence checked:

- The Plan attributes preservation of the previous complete artifact set to LLP 0041 ([LLP 0140:108](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:108)), but LLP 0041 distinguishes generation failure and generated-but-not-loaded states without stating preservation ([LLP 0041:946](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:946)). Narrower preservation text exists in LLP 0010 and LLP 0108 ([LLP 0010:819](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:819), [LLP 0108:308](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:308)).
- The matrix cites only `LLP 0010#diagnostic-shape` for full custody ([LLP 0140:1041](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1041)), despite correctly explaining earlier that this anchor is insufficient.
- The wrong-platform omission rule belongs specifically to LLP 0041’s nine-package promotion section, not merely its runtime-distribution and acceptance sections.

Resolution criterion: cite the exact custody and preservation anchors, amend LLP 0041 if full Vite-state atomic preservation is meant to be normative there, and add the nine-package promotion anchor to constraint 7.

### C9 — MINOR: two exact-version upstream statements are literally wrong

Evidence checked:

- Oxc-parser does not “export exactly `parseSync` and `parse`” ([LLP 0140:411](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:411)); those are its parsing entry points, but the module also exports visitor utilities and enums.
- Supplying `experimental.attachDebugInfo` under output options is warned as an invalid option and ignored under Rolldown 1.2.1; it is not inherently a hard rejection as claimed ([LLP 0140:617](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:617)). It becomes fatal only if Snapback’s unknown-warning policy escalates it.

Resolution criterion: say “the parsing entry points are `parseSync` and `parse`; there is no `parseAsync`,” and describe misplaced `attachDebugInfo` as warned-and-ignored unless the configured warning policy refuses it. Add a behavior test for that escalation.

### C10 — MINOR: the identity metamorphic language is ambiguous

Evidence checked:

The matrix says comments preserve identity and then says any admitted source-byte change moves identity ([LLP 0140:1055](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1055)). Current graph identity hashes raw authored source bytes ([index.mjs:8202](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8202)), so an authored comment must move identity.

Resolution criterion: explicitly distinguish comments or wrappers introduced only in generated bundle bytes—which should not affect graph identity—from comments in authored source bytes, which must affect identity.

## 4. Suggestions

- Record the already-measured graph-metadata split in the Plan: parsed-but-eliminated modules appear in `moduleParsed`/`getModuleIds` but not `OutputChunk.moduleIds`, while `\0rolldown/runtime.js` shows the reverse. This strengthens the existing decision to make the Snapback resolve/load ledger authoritative.

- Make Stage 1 a three-oracle trace: current implementation, Oxc scanner with current bundler, and Oxc plus Rolldown. Compare normalized admission, diagnostics, graph events, and evaluated artifacts. This isolates parser-induced changes from bundler-induced changes.

- Generate the parser matrix, Rolldown option table, warning disposition, and corpus manifest from executable versioned data. The document already proposes this for Rolldown options; applying it consistently would prevent prose and gates from drifting.

- Preserve the residual evidence limits already stated at [LLP 0140:554](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:554). Even after the defects above are repaired, passing evidence will not prove grammar equivalence outside the frozen/generated corpus, future-version behavior, unsupported platforms, performance outside measured workloads, or actual post-publication rollback effectiveness.

## 5. Open questions

1. Is D-1b the chosen scope for LLP 0140, with D-1a split into a later identity/security migration, or is the author accepting D-1a now?

2. For every scanner and `.js`/`.mjs`/`.ts`/`.mts` dialect, what are the exact current parse-failure semantics and the required Oxc semantics?

3. Which machine-readable state authorizes immutable candidate publication, and which later state authorizes promotion and served capability?

4. Is exact-file-only lookup a permanent admission contract, including an explicit prohibition on extension and directory probing?

5. What are the independently measured headless and React resolved-closure size budgets under the selected D-1 branch?

6. In the identity matrix, does “comments preserve identity” refer only to bundler-emitted comments?

## 6. Readiness verdict

Not ready. The readiness-blocking list is:

- C1: impossible Stage-4 publication transition;
- C2: unresolved D-1 architecture branch;
- C3: unspecified cross-dialect parser semantics and incorrect semantic-error claim;
- C4: unpinned exact-file resolver behavior;
- C5: contradictory handler top-level-`await` gate;
- C6: invalid resolved-closure size oracle;
- C7: documentation sequencing contrary to repository policy.

C8–C10 are minor corrections and would not independently block readiness.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

**C1 confirmed — the deadlock is real.** `LLP 0041:392-412` requires publishing
immutable exact candidate versions under a non-default dist-tag *before* the
registry re-download and clean public-registry installs, while v0.5's guard
forbade any publication until the post-removal receipt existed and Stage 4
required the public proof before removal. No legal transition. v0.6 replaces the
boolean gate with the five-state machine (S1 pre-removal compatibility → S2
post-removal local qualification → S3 non-default-tag candidate publication →
S4 registry verification → S5 terminal), and names the guard's mechanical
predicate.

**C3 confirmed, including its falsification of a v0.5 claim.** v0.5 said
`showSemanticErrors: false` suppresses the *entire* early-error family. Probed
at 0.142.0: getter arity (`({ get x(a) {} })`) is reported with the option
**both off and on**; redeclaration and strict-mode legacy octal only with it on;
duplicate parameters in script mode neither way. It is a subset, not a blanket
switch, and v0.6 says so. The cross-dialect finding also holds: raw TypeScript
handler source reaches three Acorn consumers whose parse-failure fallbacks
(textual regex, no-findings, masked legacy scanner) would change behavior under
a *successful* Oxc TS parse.

**C4, C6, C7, C8, C9, C10 confirmed.** In particular `AGENTS.md:128` does
require doc updates to land with the code that motivated them, which v0.5's
"defer every amendment to Stage 4" contradicted; and `moduleGraphIdentity`
(`index.mjs:8202-8207`) hashes raw authored `bytes`, so an authored comment
*does* move graph identity — v0.5's metamorphic row had it backwards for that
domain.

**C5 is the same finding as the Fable family's C3**, reached independently.

**C2 (D-1 unmade) is not a defect this loop can close.** It is the author
decision the Plan gates on. v0.6 states explicitly that D-1 must be answered
before the document moves past Review, and the round-6 capsule tells reviewers
not to score an unmade author decision as a blocking defect.


## Round 6 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbefa-6d33-77c3-9bc4-82e710264f15`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact-version esbuild 0.28.1 and Rolldown 1.2.1 probes and exercised Oxc through Rolldown’s native 0.142.0 surface (the standalone wrapper’s binding was not unpacked under the read-only filesystem); could not execute Linux bindings or refetch every registry size cell
**Target SHA-256:** `5681147344cc5f036fc7648f75e5887c06fea2d01b393744a586d2a508cc2f0c`
**Instruction SHA-256:** `93f2d85bbe8e6f151a95d128c35410241895a02975d62ec95a37d34948544f26`
**Status:** completed

## Verbatim review

Computed target SHA-256: `5681147344cc5f036fc7648f75e5887c06fea2d01b393744a586d2a508cc2f0c` — **MATCHED** the expected hash.  
Review date: 2026-08-01

Method note: I read LLP 0140 in full; every source named in its inventory; the complete current parser scanners, inline-handler symbol service, definition bundler, file-read capability, graph identity, Cloudflare identity path, publication and promotion guards; and the cited sections of LLPs 0009, 0010, 0030, 0041, 0049, 0064, 0108, and 0118. I ran binary-safe first-party searches for direct esbuild, Acorn, TypeScript compiler-API, and builtin transform authority. I inspected official Rolldown/Oxc documentation and the exact cached esbuild 0.28.1, Rolldown 1.2.1, and `oxc-parser` 0.142.0 package typings; I executed exact-version esbuild/Rolldown probes. I could not execute the separately published `oxc-parser` native wrapper because its binding was not unpacked and the filesystem was read-only, but I inspected its exact tarball and ran the parser-behavior probes through Rolldown 1.2.1’s native Oxc 0.142.0 surface. I also could not execute the Linux native bindings or independently refetch every registry size cell. I did not read anything under `llp/reviews/` or any file whose name contains `super-refine`. No files were edited.

## 1. Overall assessment

The migration plan is unusually thorough. The first-party census is complete, the current codegen behavior is accurately decomposed, D-1 is honestly framed under both branches, most governing anchors are correct, the size arithmetic is sound, and nearly every load-bearing Rolldown/Oxc assumption held under exact-version probes.

The feasibility results are:

| Assumption | Result |
| --- | --- |
| Programmatic, in-memory, single-IIFE Rolldown output | Holds |
| Controlled resolver/load hooks and no-fallthrough policy | Holds |
| `treeshake: false`, TS/JSON lowering, comments/maps/debug suppression | Holds |
| Graph metadata availability | Holds, but is not independently sufficient; the proposed ledger/spike is necessary |
| ESTree/TS-ESTree projection and UTF-16 spans | Holds, with the standalone-wrapper caveat above |
| `import.meta` fatal escalation through `onLog` | Holds |
| Import-attribute semantic parity | **Wrong as specified** |

Three blocking defects remain:

1. Import attributes can change module-instance semantics under Rolldown while all named attribute fixtures pass.
2. Stage 4 specifies mutually incompatible removal/publication orders.
3. The terminal receipt is not mechanically bound to the exact closure it authorizes.

There is also a material coherence defect in the `showSemanticErrors` exception policy. A passing run as written would therefore not establish full semantic, publication, or admission parity.

Beyond those defects, passing the finite corpus would still leave grammar combinations outside the corpus/generator, unsupported platforms, future versions, unforeseen evaluator escapes outside the adversarial cases, external persisted identity references, and real post-promotion rollback unproven. Most of those honest limits are already acknowledged at [0140:638–645](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:638); the three blockers are not.

VERDICT: NOT READY

## 2. Strengths

- **The inventory is complete and correct.** I found exactly seven first-party source files directly importing esbuild, one importing Acorn, and four using the TypeScript compiler API. All are accounted for at [0140:188–218](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188). Representative implementation evidence includes [index.mjs:31–34](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), [inline-handlers.mjs:494–515](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494), and [check-package-export-types.mjs:210–245](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:210).

- Every remaining inventory row also matches its stated role: [browser-closure.test.mjs:14–39](/Users/ccheever/projects/snapback/packages/snapback-client/browser-closure.test.mjs:14), [snapback-package-cold-install.mjs:2185](/Users/ccheever/projects/snapback/scripts/snapback-package-cold-install.mjs:2185), [generate-deployment-identity.mjs:52–120](/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:52), [Cloudflare harness:123–157](/Users/ccheever/projects/snapback/cloudflare/test/harness.mjs:123), [check-contract-meta.mjs:10–73](/Users/ccheever/projects/snapback/scripts/check-contract-meta.mjs:10), [exact-package.mjs:163–173](/Users/ccheever/projects/snapback/packages/snapback-contract/exact-package.mjs:163), [bundle-runtime.mjs:5–20](/Users/ccheever/projects/snapback/demos/competitive-checkpoint/surfaces/react-expo/scripts/bundle-runtime.mjs:5), and [react-query-group.mjs:213–234](/Users/ccheever/projects/snapback/demos/signal-desk/tests/react-query-group.mjs:213). No omitted direct first-party authority was found.

- **The codegen behavior is genuinely enumerable.** The six Acorn responsibilities plus the TypeScript scanner at [0140:204–218](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204) match the actual call sites and fallbacks. The admission-plugin requirements capture descriptor-attested reads, exact-file resolution, separate schema/functions/routes graphs, authored-versus-transformed sources, package-scope manifests, diagnostics, facade serialization, and identity inputs; compare [0140:658–840](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:658) with [index.mjs:7698–7846](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7698) and [index.mjs:8174–8207](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8174).

- **The principal governing anchors hold.** Static scanning is correctly treated as defense in depth rather than the authority boundary at [LLP 0009:788–799](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:788). Closed-graph admission, canonical evaluated-value identity, stable diagnostics, and the isolated evaluator are supported at [LLP 0010:346–442](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:346). Cloudflare fixed-point freshness is accurately carried from [LLP 0049:997–1022](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997).

- **Most upstream assumptions were verified.** Exact Rolldown 1.2.1 probes produced one in-memory IIFE, stripped TypeScript without type checking, preserved unused declarations under the complete `treeshake: false`/`minify: false` manifest, emitted no maps/legal comments/debug regions under the pins, exposed the named graph hooks, and aborted generation when `EMPTY_IMPORT_META` was escalated through `onLog`. These agree with the official [Rolldown Bundler API](https://rolldown.rs/apis/bundler-api) and [treeshake reference](https://rolldown.rs/reference/InputOptions.treeshake). The Oxc recovery table, parenthesis behavior, error fields, and UTF-16 offsets also matched the Plan’s measurements; the upstream parser surface is documented at [Oxc Parser](https://oxc.rs/docs/guide/usage/parser).

- **D-1 is coherent under both branches.** The Plan accurately distinguishes syntax parsing from symbol resolution, names the current checker behaviors D-1a must replace, preserves D-1b as a legitimate shipped-closure outcome, and binds either branch to identity and size consequences at [0140:302–385](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:302). Leaving the branch undecided is not itself a defect.

- **The size table is reproducible enough for a Plan.** It states the registry source, date, package sets, exact versions, binding tuples, compressed/unpacked meanings, and glibc limitation at [0140:239–258](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239). Every displayed total and D-1 delta is arithmetically correct, and the conclusions properly distinguish isolated component totals from resolved headless/React closures at [0140:280–300](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:280).

- **The acceptance matrix is strong where specified.** It binds rows to case IDs, corpus digests, exact options, zero unapproved skips, cross-tuple equality, diagnostic custody, identity sensitivity, evaluator denial, and package closure evidence at [0140:1101–1227](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1101).

## 3. Concerns

### 3.1 BLOCKING — Import attributes change module-instance semantics

**Evidence checked:** The Plan says the current resolver ignores attributes and therefore requires both syntaxes to remain admitted at [0140:819–829](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:819). The fixtures only name one modern and one legacy singleton import at [0140:910–913](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:910), and the acceptance row checks admission only at [0140:1116–1117](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1116).

An exact probe imported the same JSON path twice:

```js
import a from "./a.json" with { type: "json" };
import b from "./a.json" assert { type: "json" };
globalThis.result = a === b;
```

esbuild 0.28.1 invoked resolver/load twice, with attribute maps `{type:"json"}` and `{}`, emitted two JSON objects, and produced `false`. Rolldown 1.2.1 invoked resolver/load once and produced `true`. Distinct modern maps likewise duplicate only under esbuild; identical maps deduplicate. JavaScript modules show the same divergence through top-level side effects.

This is structurally explainable: esbuild exposes attributes to plugin hooks, while Rolldown 1.2.1’s [`ResolveIdExtraOptions` contains only `custom`, `isEntry`, and `kind`](/Users/ccheever/.bun/install/cache/rolldown@1.2.1@@@1/dist/shared/define-config-DSMNXceb.d.mts:2835). Snapback’s current graph ledger is keyed only by real path at [index.mjs:7687–7731](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7687), and the proposed authored/runtime ledgers at [0140:785–804](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:785) do not carry normalized attributes.

Thus unchanged authored source can evaluate differently, while every explicitly required import-attribute fixture passes.

**Resolution criterion:** Specify attribute-sensitive runtime module identity and an implementable mechanism despite Rolldown’s resolver-hook blindness—such as an Oxc-driven synthetic-ID/source-rewrite layer. Carry normalized attributes in the authored and projected runtime ledgers, and add same-path fixtures covering identical, distinct, absent, and mixed `with`/`assert` maps, using both JSON object identity and JavaScript side effects. Alternatively, explicitly separate a versioned semantic narrowing from this migration and revise the “no semantic rewrite” contract.

### 3.2 BLOCKING — Stage 4 has mutually incompatible execution orders

**Evidence checked:** Stage 4 step 2 runs the “eventual public-registry proof” and cross-tuple equality before removing the dual implementation and esbuild, followed by a post-removal proof at [0140:1061–1074](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1061). The rollback prose repeats that removal cannot precede public proof at [0140:1244–1260](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1244).

The five-state table then says the opposite: remove the dual implementation, qualify locally, publish the candidate, and only then perform public-registry verification at [0140:1264–1270](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1264). The guard forbids any publication while the seam exists at [0140:1272–1281](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1272).

LLP 0041 requires local qualification, immutable candidate publication, registry re-download, public installs, and then promotion in that order at [LLP 0041:394–430](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394). The current publisher enforces a source-bound ledger and two platform receipts at [snapback-publish.mjs:352–417](/Users/ccheever/projects/snapback/scripts/snapback-publish.mjs:352). An immutable candidate published from the pre-removal closure cannot later be replaced with post-removal bytes under the same exact version.

**Resolution criterion:** Replace the conflicting prose with one S1–S5 sequence:

1. Run pre-removal dual/cross-tuple evidence locally.
2. Remove esbuild and the dual seam.
3. Repack and qualify the final tarballs locally on both tuples.
4. Publish those exact tarballs under the non-default tag.
5. Re-download and prove the public candidate closure.
6. Emit the terminal receipt.
7. Permit default-tag promotion and served capability.

### 3.3 BLOCKING — The terminal receipt is not bound to the closure it authorizes

**Evidence checked:** Stage manifests record cases, corpus digest, tools, and options at [0140:876–883](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:876). But the mechanical guard requires only a “valid” Stage-4 receipt whose corpus digest matches the frozen digest, plus manifest/seam file facts, at [0140:1272–1279](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1272).

No schema requires equality with the exact source SHA, candidate-ledger digest, lock digest, package version vector, final tarball/integrity digests, platform-receipt digests, codegen option manifest, or the precise post-removal closure. A stale but corpus-matching receipt could therefore authorize a later changed closure. The future-version rule at [0140:1222–1225](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1222) says to rerun evidence but does not mechanically invalidate the previous receipt.

That is weaker than LLP 0041’s source/tarball ledger binding at [LLP 0041:394–410](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394), clean-source freeze at [LLP 0041:432–436](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:432), and candidate-to-promotion lineage at [LLP 0041:652–657](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:652).

**Resolution criterion:** Define the terminal receipt schema and guard comparisons. Bind the receipt to the exact clean source SHA, candidate-ledger digest, package/version vector, final tarball and integrity digests, Bun lock digest, platform-receipt digests, codegen/Rolldown/Oxc/TypeScript versions and option manifests, corpus digest, and seam absence. Promotion must compare the receipt’s candidate-ledger digest with the ledger actually being promoted. Any relevant source, lock, option, version, or package-byte change must invalidate the receipt.

### 3.4 MATERIAL — `showSemanticErrors` provides an unbounded admission-narrowing waiver

**Evidence checked:** The Plan declares this migration non-semantic at [0140:37–41](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:37), but acknowledges that `showSemanticErrors: true` creates refusal classes no current path produces at [0140:584–588](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:584). Both differential gates exempt “declared `showSemanticErrors`” classes at [0140:616–636](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:616) and [0140:1130–1138](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1130), while the class list remains an execution-time open question at [0140:1297–1301](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1297).

As written, a current-valid/Oxc-invalid construct discovered during execution can be added to the declaration and the gate can pass. That conflicts with Stage 2’s explicit rule that admission weakening is never a permitted disposition at [0140:1007–1010](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1007).

**Resolution criterion:** State now that a permitted class must be proven to be refused by the current end-to-end pipeline with equivalent diagnostic custody. Any class currently admitted end to end, or any unmatched new class, must fail LLP 0140 unless handled as a separately reviewed and versioned admission change.

### 3.5 MINOR — The Vite acceptance row cites narrower sources than its claim

**Evidence checked:** The Plan correctly explains at [0140:108–119](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:108) that LLP 0030 and LLP 0041 do not state whole-artifact atomic preservation. Nevertheless, the matrix attributes that behavior only to those documents at [0140:1182–1185](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1182). The actual preservation text is at [LLP 0010:819–825](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:819) and [LLP 0108:299–309](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:299).

**Resolution criterion:** Add the LLP 0010 dated acceptance anchor and LLP 0108 identity/custody anchor to that matrix row; amend LLP 0041 separately if the behavior should become normative there.

### 3.6 MINOR — LLP 0118’s cited “today” text has stale package names

**Evidence checked:** LLP 0118 names `@snapback/codegen/*` at [LLP 0118:246–263](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:246), while current code uses `@expo/snapback-codegen/*` at [index.mjs:345–348](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:345). LLP 0140 itself uses the correct names at [0140:128–139](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:128), so the governing conclusion is sound but the corroborating anchor is not exact.

**Resolution criterion:** Flag this precise drift in the reconciliation list and update LLP 0118 with the stage that changes or reaffirms the resolver description.

## 4. Suggestions

- Replace “authorized roots” at [0140:668](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:668) with the literal current tuple `[backendDir, REPO_ROOT]` from [index.mjs:7701–7704](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7701), including how `REPO_ROOT` differs between source checkout and package installation.

- Spell out the module-format matrix: `.mjs`, `.mts`, and JSON bypass package-type classification; `.cjs`/`.cts` refuse; `.js`/`.ts` require the nearest pre-`node_modules` scope to declare `type: module` ([index.mjs:8174–8199](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8174)).

- Replace the conditional language at [0140:771–774](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:771): under Rolldown 1.2.1, calling the `onLog` default handler at error level does abort `generate()` with `EMPTY_IMPORT_META`. Keep the regression fixture.

- Change “no … discriminant” at [0140:590–593](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:590) to “no stable diagnostic-kind code, class, or discriminant.” `severity` is technically a discriminant, though not one suitable for structural classification.

- Prefix nested Rolldown options consistently—such as `output.comments`, `resolve.alias`, and `transform.inject`/`define`—to make the generated option-manifest mapping mechanically unambiguous.

- Extend the residual nonclaim to mention external persisted identity references and the finite nature of evaluator escape probes. These are not migration defects, but they are limits of what a passing corpus establishes.

## 5. Open questions

1. Does the author intend to preserve esbuild’s attribute-sensitive module instances, or make import attributes a separately versioned semantic change? If preserving them, which parser-to-synthetic-ID mechanism will be authoritative?

2. Which single Stage-4 sequence supersedes the contradictory prose, and at which state is each exact tarball created, qualified, published, re-downloaded, and promoted?

3. What exact terminal-receipt fields and guard comparisons bind promotion and served capability to the tested closure?

4. Are any `showSemanticErrors` refusals allowed when the current complete pipeline admits the construct? If so, why is that not a separate admission change?

5. Which D-1 branch will be selected before the Plan advances beyond Review? This remains a legitimate author decision, not a present readiness defect.

6. During the Stage-3 spike, how will package manifests, parsed-but-eliminated modules, attribute variants, and Rolldown synthetic IDs be reconciled between the Snapback ledger and upstream graph metadata?

## 6. Readiness verdict

**NOT READY.** Blocking list:

1. Import-attribute module-instance semantics are neither preserved nor tested.
2. Stage 4’s publication/removal ordering is contradictory and cannot be executed against immutable package versions as written.
3. The terminal receipt can authorize a closure other than the one proven.

The `showSemanticErrors` waiver is additionally material and must be closed under the stated readiness bar.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

**3.1 confirmed by independent probe — the most consequential finding of the
loop's late rounds.** Bundling

```js
import a from "./a.json" with { type: "json" };
import b from "./a.json" assert { type: "json" };
export const r = a === b;
```

esbuild 0.28.1 called `onResolve` twice (`{"type":"json"}` then `{}`), emitted
two JSON objects (`a_default`, `a_default2`), and yields `r === false`.
Rolldown 1.2.1 called `resolveId` once, emitted one object, and yields
`r === true`. Unchanged authored source evaluates differently across the swap
while every v0.6 admission fixture passes. v0.7 makes runtime module identity
the pair (resolved real path, normalized attribute map), assigns the authority
to the Oxc scan because Rolldown's `ResolveIdExtraOptions` cannot see
attributes, and fixtures identical/distinct/absent/mixed maps by object identity
and side-effect count.

**3.2 confirmed** — Stage 4's imperative step order and the S1–S5 table said
opposite things about when removal happens; the Fable-family round-6 review
independently flagged the same seam at MINOR severity. v0.7 rewrites Stage 4's
steps *as* S1–S5.

**3.3 confirmed** — a receipt bound only to the corpus digest could authorize a
later changed closure. v0.7 defines the receipt schema (source SHA,
candidate-ledger digest, version vector, tarball and integrity digests, lock
digest, platform receipts, tool versions and option manifests, corpus digest,
seam absence) and states that any relevant change invalidates it.

**3.4 confirmed** — the `showSemanticErrors` exemption was an open-ended waiver
that could be widened during execution to make the gate pass. v0.7 bounds it: a
class qualifies only if the *current end-to-end pipeline* already refuses it
with equivalent diagnostic custody.

**3.5 and 3.6 confirmed and applied**, including the LLP 0118 `@snapback/codegen`
versus `@expo/snapback-codegen` drift, now named in the reconciliation list.


## Round 7 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf14-2024-78b3-a6e0-9e95a97c9049`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact-version esbuild 0.28.1 and Rolldown 1.2.1 probes and consulted upstream issue tracking for resolver-attribute support
**Target SHA-256:** `2610d5fcade5a72edbe309da168cfe72588d718af2e4748c455ef0b322fdb77a`
**Instruction SHA-256:** `237fb4d538ab5cc20124c835b0b57ddedcfe565059a21eb8076287e4dd110a65`
**Status:** completed

## Verbatim review

# Independent review — LLP 0140, round 1

**Target SHA-256 computed:** `2610d5fcade5a72edbe309da168cfe72588d718af2e4748c455ef0b322fdb77a`  
**Expected hash:** same — **MATCHED**  
**Date:** 2026-08-01

**Method:** I read LLP 0140 in full; every source file named by its inventory; the codegen bundler, six Acorn scans, TypeScript scanner, inline-handler symbol service, package manifests, generated-source cases, and relevant lock data; and every cited governing LLP section. I ran a binary-safe first-party census, exact `esbuild@0.28.1` and cached `rolldown@1.2.1` probes, inspected their published typings/manifests, checked registry size data, and consulted official Rolldown/Oxc documentation. I did not read any content under `llp/reviews/`, did not read any filename containing `super-refine`, and made no edits. The standalone `oxc-parser@0.142.0` package could not be installed in the read-only/network-restricted shell; Rolldown’s bundled Oxc binding reproduced the stated getter, redeclaration, strict-octal, parentheses, and UTF-16-offset behavior, but I therefore treat the standalone wrapper-specific measurements as corroborated rather than independently proven. Linux compressed tarballs were unavailable locally, so their download-byte cells remain externally unverified; their unpacked metadata and all arithmetic checked out.

## 1. Overall assessment

The migration is feasible, the inventory is complete, the governing constraints are accurately cited, and the Plan has done unusually good work on security, identity, diagnostics, native-package custody, and bounded empirical evidence. D-1 is presented honestly and coherently under both branches; leaving that author decision open is not a defect.

The remaining problems are concentrated but load-bearing. Attribute-sensitive module identity is not yet implementably or semantically specified. Stage 1 can ship a native Oxc closure before its two-platform qualification. The S1–S5 publication state machine has contradictory entry conditions and no enforceable intermediate receipts. Several additional gate definitions still permit evidence to be waived or normalized without a closed rule.

VERDICT: NOT READY

## 2. Strengths

- **The first-party census is complete and accurate.** A binary-safe scan found no omitted direct esbuild, Acorn, or TypeScript compiler-API authority. The six Acorn calls are exactly at [index.mjs:4986](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4986), [index.mjs:5090](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5090), [index.mjs:5664](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5664), [index.mjs:5768](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5768), [index.mjs:7427](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7427), and [index.mjs:7469](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7469), matching the six responsibilities at [LLP 0140:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204). The TypeScript, generated-template, Cloudflare, browser-proof, and demo rows at [LLP 0140:190](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:190) also match their implementations.

- **The governing-anchor audit passes.** The cited constraints are supported by LLP 0009’s capability and bundle boundaries ([LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774), [LLP 0009:956](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:956)); LLP 0010’s diagnostic, graph, CI, and custody rules ([LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:312), [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330), [LLP 0010:746](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:746)); LLP 0030’s Vite state model ([LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603)); LLP 0041’s runtime distribution and candidate promotion ([LLP 0041:297](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:297), [LLP 0041:371](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:371)); LLP 0049’s fixed-point identity rule ([LLP 0049:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997)); LLP 0108’s inline-handler identity/custody rules ([LLP 0108:855](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:855)); and LLP 0118’s controlled-bundler precedent ([LLP 0118:668](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:668)). The Plan correctly discloses rather than conceals the stale or narrower governing text at [LLP 0140:108](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:108) and [LLP 0140:126](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:126).

- **The current codegen behavior is enumerated unusually well.** The admission-plugin requirements at [LLP 0140:672](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:672) cover the current capability-aware reader, exact-file resolution, package-format facts, graph/source custody, separate graph evaluations, transformed-entry/authored-byte split, fail-closed edge set, IIFE/banner, and diagnostic re-derivation found in [index.mjs:7679](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7679) through [index.mjs:8207](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8207). Apart from the attribute-realization defect below, I found no omitted current dependency.

- **The Plan caught the non-obvious TypeScript-to-Acorn paths.** The per-consumer matrix at [LLP 0140:423](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:423) accurately reflects the regex, empty-result, and masked-legacy fallbacks in current code. Requiring two-direction admission comparison, diagnostic comparison, and preservation of parse-failure fallbacks at [LLP 0140:616](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:616) and [LLP 0140:1003](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1003) is the right shape.

- **D-1 is intellectually honest.** The document correctly identifies the `TypeChecker` work in [inline-handlers.mjs:132](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:132), [inline-handlers.mjs:293](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:293), and [inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494), and does not mislabel it as parsing. The D-1a oracle and actual shipped-identity rollout requirements at [LLP 0140:304](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:304) are coherent; D-1b’s size and ongoing identity-custody costs are stated plainly.

- **The size table is sufficiently reproducible for a Plan.** It specifies registry tarball bytes versus `dist.unpackedSize`, versions, date, package sets, and platform bindings at [LLP 0140:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239), with Stage 0 supplying per-package receipts and a reproducer. All sums and D-1 deltas at [LLP 0140:260](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:260) and [LLP 0140:282](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:282) are correct. The conclusions—smaller only under D-1a, larger under D-1b, and resolved app closures requiring separate measurement—follow from the numbers.

- **The ordinary upstream capabilities hold.** Exact Rolldown supports in-memory `generate()`, explicit `close()`, IIFE output, disabled tree shaking/code splitting/minification/sourcemaps/comments, controlled plugins, and graph metadata. Its [programmatic API](https://rolldown.rs/apis/plugin-api) and [option reference](https://rolldown.rs/reference/Interface.RolldownOptions) support the proposed architecture. Oxc’s official package documentation supports `parse`/`parseSync`, JS ESTree and TS-ESTree projections, ranges, `preserveParens`, and `showSemanticErrors`; TypeScript transformation without type checking is also supported, subject to the feature distinctions the Plan already gates. The Plan properly treats deployment-identity metadata sufficiency as an empirical Stage-3 spike at [LLP 0140:1073](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1073), not as established fact.

## 3. Concerns

1. **BLOCKING — Attribute-sensitive module identity is neither closed nor implementably specified.**

   **Evidence checked:** The exact esbuild probe reproduced [LLP 0140:845](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:845): `with {type:"json"}` reaches the hook as `{type:"json"}`, legacy `assert` reaches it as `{}`, two module instances are emitted, and equality is false. Exact Rolldown 1.2.1 invokes its resolver once and emits one instance. Rolldown’s resolver lacks attributes and an import-site span; upstream tracks resolver attributes as unsupported in [rolldown/rolldown#819](https://github.com/rolldown/rolldown/issues/819). Oxc exposes the same `ImportDeclaration.attributes` shape for both spellings, with no syntax-form discriminator.

   The proposed key `(real path, normalized attribute map)` at [LLP 0140:870](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:870) therefore collapses the two spellings under ordinary semantic normalization. Preserving esbuild’s behavior requires deliberately mapping legacy `assert` to the empty hook map or adding a syntax-form discriminator derived from source text. Further, because Rolldown sees the same `(source, importer, kind)` at both sites, distinct synthetic IDs require a pre-resolution source rewrite or equivalent proxy mechanism; none is named. Finally, current persisted graph identity deduplicates by real path ([index.mjs:7687](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7687), [index.mjs:8202](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8202)), while the proposed pair-keyed ledger “owns identity” at [LLP 0140:819](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:819); the document does not say whether this new instance identity is execution-only or becomes a persisted graph-identity input.

   **Resolution criterion:** Specify the exact canonical key for key order, `with` versus `assert`, and absent versus empty; specify the source-span-based rewrite/proxy that gives every runtime occurrence a collision-free synthetic ID before Rolldown resolution; define load/cache and original-diagnostic-span recovery; and distinguish runtime module-instance identity from persisted Snapback graph identity. Probe all four combinations against Rolldown 1.2.1 and require object identity, side-effect count, graph identity, and rollback identity to match the esbuild baseline.

2. **BLOCKING — Stage 1 may ship a native Oxc closure before its required platform and package proof.**

   **Evidence checked:** Stage 1 switches production and removes Acorn at [LLP 0140:1017](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1017), but its gate at [LLP 0140:1022](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1022) is local codegen tests plus the corpus. The first two-tuple native-binding, repository-free install, and semantic-equality proof appears only in Stage 4 S1 at [LLP 0140:1117](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1117). Nevertheless, Oxc convergence “may ship” independently at [LLP 0140:1319](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1319), while the publication guard only activates when the definition bundler is Rolldown at [LLP 0140:1353](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1353).

   **Resolution criterion:** Either define Stage 1 as repository-only landing and mechanically prohibit package publication/served capability, or add a Stage-1 release gate covering final tarballs, both supported clean hosts, correct and foreign native-binding selection, cross-tuple parser/diagnostic/artifact equality, and LLP 0041 package custody. Under D-1a it must also cover the identity rollout.

3. **BLOCKING — The S1–S5 state machine has contradictory entry conditions and unenforced intermediate transitions.**

   **Evidence checked:** Stage 4 defines S1 as both-tuple cold installs plus semantic equality at [LLP 0140:1117](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1117), but the rollback table says S1 is reached merely when Stage 2 passes at [LLP 0140:1345](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1345). The table requires an “S2 receipt” before candidate publication, but gives no S1/S2 receipt path or schema. The guard tests bundler/seam/terminal-receipt facts, not S2 qualification; once the seam is simply removed, it explicitly permits non-default candidate publication at [LLP 0140:1353](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1353). The guard is also not an explicit prerequisite of the Stage-2 production switch.

   **Resolution criterion:** Establish one authoritative transition table; name and schema-validate S1 and S2 receipts; require S1’s two-tuple evidence before seam removal; bind S2 to source, lock, options, seam absence, final tarballs, and both platform receipts; require a valid S2 receipt before S3; and install/test the guard before or atomically with the Stage-2 production switch.

4. **MATERIAL — The supposedly exact published dependency closure can float.**

   **Evidence checked:** Rolldown 1.2.1 publishes `@rolldown/pluginutils: ^1.0.0`; `oxc-parser@0.142.0` publishes `@oxc-project/types: ^0.142.0`, while Rolldown separately pins the latter to `=0.142.0`. The size table prices pluginutils 1.0.1 and one types copy at [LLP 0140:251](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:251), the custody section calls the released closure exact at [LLP 0140:898](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:898), and the rerun rule names only Rolldown, Oxc, and TypeScript changes at [LLP 0140:1302](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1302). A later public install can therefore resolve a changed helper version or a second types copy without changing any named top-level tool version.

   **Resolution criterion:** Require an effective exact pin for every shipped helper contributing to the measured or executable closure, assert one permitted version/copy in both clean-install trees, include their versions and integrity in receipts, and expand the version-change rerun/guard rule to cover them.

5. **MATERIAL — The claimed facade and entry-filename pins are not present.**

   **Evidence checked:** The revision header says v0.7 pinned the facade ID at [LLP 0140:8](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:8), but the body states only “non-`\0`-prefixed reserved virtual id” and “entryFileNames pinned” at [LLP 0140:677](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:677). Neither literal value appears, and `output.entryFileNames` is absent from the purported generated manifest table at [LLP 0140:715](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:715).

   **Resolution criterion:** State the exact facade ID and `output.entryFileNames` value in the consumed manifest/table, show input/output option nesting literally, and define disjoint namespaces and collision checks for the facade, attribute-pair modules, user IDs, and Rolldown’s runtime ID.

6. **MATERIAL — The promised TypeScript negative source is absent from the acceptance obligation.**

   **Evidence checked:** The parser design expressly requires TypeScript 5.9.3 parser-error baselines at [LLP 0140:633](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:633). The acceptance sweep enumerates the frozen corpus, Acorn negatives, Test262, and fuzz/generator inputs, but omits the TypeScript baselines at [LLP 0140:1201](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1201).

   **Resolution criterion:** Add the pinned TypeScript baselines to the acceptance row and Stage-0/Stage-1 receipt schemas, including source hash, selection policy, case count, and coverage of every TypeScript-reaching consumer mode.

7. **MATERIAL — Diagnostic ordering and envelope parity can be waived despite being declared contractual.**

   **Evidence checked:** Stage 1 requires the same deduplication, ordering, first-error behavior, and full envelopes at [LLP 0140:1003](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1003). The acceptance matrix requires mixed-error code/span/ordering parity at [LLP 0140:1214](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1214) and full custody at [LLP 0140:1230](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1230). Stage 2 nevertheless permits generic `message-text` and `ordering` dispositions at [LLP 0140:1058](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1058).

   **Resolution criterion:** Define exactly which presentation-only text or ordering is non-contractual. Issue precedence, stable rendered messages, code/span, and public/local envelope fields must remain exact or undergo a separately reviewed diagnostic migration; they cannot be waived by an ordinary compatibility-report disposition.

8. **MATERIAL — “Normalized digests” are not defined tightly enough to be security or identity gates.**

   **Evidence checked:** Cross-tuple proof relies on normalized digests at [LLP 0140:923](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:923), [LLP 0140:1117](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1117), and [LLP 0140:1294](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1294), but no canonical projection states which fields may be removed or rewritten. An implementation could normalize away a code, span, custody field, graph member, identity input, or artifact difference.

   **Resolution criterion:** Define a versioned, fail-closed canonical projection per domain; enumerate every excluded field and permitted host-root substitution; reject unknown fields; require raw equality where portability is expected; and mutation-test that every load-bearing field affects its digest.

9. **MATERIAL — The terminal receipt’s source binding is potentially self-invalidating.**

   **Evidence checked:** The terminal receipt is emitted after public verification at [LLP 0140:1134](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1134), records a “clean source SHA,” and is invalidated by any source change at [LLP 0140:1365](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1365). Committing the tracked receipt, changing LLP 0140’s status, or finishing terminal documentation necessarily creates a later repository revision. The guard’s intended comparison is therefore ambiguous.

   **Resolution criterion:** Define the immutable candidate/source checkout separately from the proof-harness and attestation revision, explicitly permit the receipt/status-only commit, or define a closed source projection excluding receipts. State exactly what the guard compares against the current checkout and which later changes invalidate authorization.

## 4. Suggestions

- Preserve the current one-read-per-realpath snapshot behavior at [index.mjs:7717](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7717); multiple attribute-sensitive module instances must share the same authorized byte snapshot rather than reopening the file.

- Move the import-attribute rewrite into a Stage-0 feasibility spike. It is now the only upstream behavior requiring a Snapback-owned structural workaround rather than ordinary option/plugin configuration.

- Explicitly pin `logLevel` alongside `onLog`. Rolldown documents that filtered logs never reach `onLog`, so the unknown-warning policy should not depend on an inherited default.

- Generate the option table, state-transition table, receipt schemas, and digest projections from one versioned “migration proof capsule.” That would prevent prose, executable guards, and receipts from drifting independently.

- Preserve raw registry packuments, integrity values, and per-package tarball measurements in the Stage-0 receipt. The current table is reproducible, but an immutable source snapshot will make later registry changes distinguishable from arithmetic drift.

Even after the concerns are fixed, a passing run remains bounded evidence rather than proof of universal equivalence. It would not establish grammar equivalence outside the declared corpora/generator, every interaction among parser recovery and scanner rules, future-version behavior, unsupported platforms, rapid-edit Vite race behavior, post-publication rollback effectiveness, the quality of a D-1a security review, or Cloudflare graph correctness for arbitrary future module forms. The Plan already acknowledges most of these limits at [LLP 0140:649](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:649).

## 5. Open questions

1. What exact identity does legacy `assert` receive: an empty esbuild-compatible attribute map, a syntax-tagged map, or something else?
2. What source-rewrite/proxy mechanism makes attribute-distinct sites visible to Rolldown before resolution?
3. Does Stage 1 “ship” mean merge only, or publication/served capability?
4. What are the exact S1 and S2 receipt paths, schemas, and transition predicates?
5. Which fields may cross-tuple normalization remove or rewrite?
6. Which diagnostic message and ordering fields are contractual, and which are presentation-only?
7. How will exact helper versions be enforced for later public installs without relying on the repository lock?
8. What source revision does the terminal receipt attest, and how does the guard treat its own receipt commit?
9. What are the literal facade ID and `output.entryFileNames` values?
10. Which D-1 branch will be recorded at Stage 1? This remains a legitimate author decision and is not itself part of the NOT READY verdict.

## 6. Readiness verdict

VERDICT: NOT READY

Blocking list:

- Attribute-sensitive module identity lacks an exact normalization rule, pre-resolution realization mechanism, and persisted-identity treatment.
- Independently shippable Stage 1 bypasses Oxc’s required two-tuple/public-package qualification.
- The S1–S5 transition model is contradictory and lacks enforceable S1/S2 receipts before seam removal and candidate publication.

The material gate, custody, and reproducibility concerns above must also be closed before the document meets the stated READY bar.
## Orchestrator verification (outside the verbatim body)

All nine items confirmed by probe or file read; none refuted.

- **Concern 1** is the same gap the Fable family reached independently this
  round, and its extra observations are decisive: Rolldown's resolver sees the
  same `(source, importer, kind)` at both import sites, so no resolver-side rule
  can split them; and v0.7 never said whether instance identity was
  execution-only or a persisted graph-identity input. v0.8 states the
  normalization function (legacy `assert` → **empty** map, matching the measured
  esbuild delivery, so mixed spellings stay two instances), specifies the
  pre-resolution source-rewrite mechanism
  (`snapback:attr/<mapDigest>/<specifier>`), and separates execution-only
  instance identity from persisted `(label, bytes)` graph identity.
- **Concerns 2, 3** confirmed: Stage 1 could ship a native Oxc closure on local
  test evidence, and the v0.7 rollback table's entry conditions contradicted
  Stage 4's own definition of S1. v0.8 adds a Stage-1 release gate (or an
  extended guard predicate) and makes the transition table single-authoritative
  with named, schema-validated S1/S2 receipts.
- **Concerns 4–9** confirmed and applied: helper deps float under `^` ranges and
  now carry effective exact pins; the facade id and `output.entryFileNames` are
  literal values; the TypeScript baselines reach the acceptance row; the generic
  `ordering` disposition is removed (ordering, precedence, first-error behavior,
  and envelope fields are contractual); the canonical projection is defined as
  versioned and fail-closed with a mutation test; and the terminal receipt binds
  to the immutable candidate checkout under a closed source projection that
  excludes receipts and the status line, so a receipt-only commit no longer
  self-invalidates.


## Round 8 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf2f-4e36-7e61-9c07-271b8056727e`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact-version esbuild 0.28.1 probes across attributed edge families and a proxy probe of the proposed source rewrite; consulted npm registry metadata documentation
**Target SHA-256:** `6c5cf876d24ba6377949355bee3d4962951546492b7c6d5187d2c15b0cb7cc7d`
**Instruction SHA-256:** `4abed6df094aa39ce51f7168a2a966ca29e4ec913a86940ceabb15c4d1e80a41`
**Status:** completed

**Capsule note:** this round the capsule added a calibration instruction — judge the document as a Plan, not as an implementation; a named mechanism with a fixture behind it is sufficient specification, and demanding literal code or proofs only the migration can produce is out of scope.

## Verbatim review

Target SHA-256 computed: `6c5cf876d24ba6377949355bee3d4962951546492b7c6d5187d2c15b0cb7cc7d`  
Expected SHA-256: `6c5cf876d24ba6377949355bee3d4962951546492b7c6d5187d2c15b0cb7cc7d`  
Hash status: **MATCH**  
Date: **2026-08-01**

Method note: I read the complete target; every file named in its inventory; the codegen bundler, scanners, inline-handler symbol service, file-read capability, package manifests, authority checker, and release/promotion machinery; and every cited governing LLP section. I ran binary-safe repository searches for direct esbuild, Acorn, TypeScript compiler-API, `node:vm`, `Function`, and `node:module` transform authority. I ran behavioral probes against installed `esbuild@0.28.1` and an exact cached `rolldown@1.2.1`, and checked official Rolldown/Oxc API documentation and exact Rolldown package metadata. I could not install or execute `oxc-parser@0.142.0` in the read-only environment, nor independently refetch every npm tarball-size datum because shell DNS was unavailable; its exact recovery/error and UTF-16 measurements therefore remain independently uncertain, not assumed. I did not read anything under `llp/reviews/`, did not read any filename containing `super-refine`, and made no repository edits.

## 1. Overall assessment

This is a strong, unusually careful migration Plan. The inventory is complete, the governing citations hold, D-1 is represented honestly under both branches, the baseline arithmetic is correct, and Rolldown’s required programmatic path is feasible.

It is nevertheless not ready. The publication state machine conflicts with its governing release protocol and can authorize the external closure without Stage 3 evidence. Separately, the newly specified import-attribute rewrite does not close attributed re-export coverage or downstream diagnostic-location remapping. Stage 1’s optional independent release path is also not an executable gate despite the Plan’s stated gate standard.

These are missing contracts and transitions, not demands for implementation evidence.

VERDICT: NOT READY

## 2. Strengths

- **The first-party census is complete and its role descriptions are accurate.** Binary-safe searches found exactly the seven represented direct esbuild surfaces, the six enumerated Acorn responsibilities, and the four represented TypeScript compiler-API surfaces. The distinction between migration-owned authority and retained `node:vm`/`Function` or `stripTypeScriptTypes` authority is sound ([LLP 0140:158](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:158), [LLP 0140:188](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188), [LLP 0140:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204)). The load-bearing roles match the implementation: the controlled esbuild build begins at [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736), while the inline-handler checker is genuinely semantic at [inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494).

- **The governing anchors exist and support the Plan’s claims.** LLP 0010 requires structured no-silent-drop diagnostics, closed graph identity, and capability-empty evaluation ([LLP 0010:346](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:346), [LLP 0010:372](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:372), [LLP 0010:420](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:420)). LLP 0009 correctly treats static scanning as defense in depth rather than the authority boundary ([LLP 0009:788](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:788)). The cited Vite-state, Cloudflare-identity, package-custody, and inline-handler identity sections likewise substantiate the Plan’s constraints ([LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603), [LLP 0049:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997), [LLP 0108:855](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:855)).

- **The current codegen behavior is mostly captured at the right fidelity.** The Plan correctly preserves separate schema/functions/routes graphs, descriptor-based reads, exact-file resolution, module-format manifests, the intrinsic banner, structured error mapping, and isolated VM evaluation ([LLP 0140:672](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:672), [index.mjs:617](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:617), [index.mjs:7611](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7611), [index.mjs:7687](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7687), [index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783)).

- **D-1 is coherent under both branches.** D-1a names the actual binding-resolution, security, oracle, and identity-rotation burden; D-1b accurately retains TypeScript and inverts the size result without pretending the remaining Acorn migration is risk-free ([LLP 0140:304](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:304), [LLP 0140:326](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:326), [LLP 0140:352](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:352)). Leaving that author decision open is not a readiness defect.

- **Upstream feasibility is good.** An exact `rolldown@1.2.1` probe confirmed in-memory IIFE generation, controlled resolve/load hooks, `treeshake: false`, TypeScript lowering without checking, comment/debug-marker suppression, single-chunk output, and `close()`. The official API documents in-memory `generate()` and required cleanup, while the option references expose the pinned controls ([RolldownBuild](https://rolldown.rs/reference/Interface.RolldownBuild), [InputOptions](https://rolldown.rs/reference/Interface.InputOptions), [OutputOptions](https://rolldown.rs/reference/Interface.OutputOptions)). Rolldown exposes useful graph metadata, but not import attributes; the Plan correctly leaves Cloudflare sufficiency to an early Stage 3 spike rather than asserting it ([LLP 0140:1496](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1496)). Oxc’s official documentation supports JavaScript/TypeScript parsing and the general adapter direction ([Oxc parser documentation](https://oxc.rs/docs/guide/usage/parser)).

- **The size argument is honest and reproducible enough for a Plan.** All displayed totals and D-1 deltas are arithmetically correct; the measurement distinguishes tarball length from registry unpacked size, names platform tuples and bindings, and defers resolved-install conclusions to Stage 0 receipts ([LLP 0140:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239), [LLP 0140:280](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:280), [LLP 0140:1053](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1053)). The conclusions follow: D-1a is smaller; D-1b is a size regression.

- **The acceptance design is generally real rather than aspirational.** It requires case manifests, exact corpus digests, zero unapproved skips, a fail-closed canonical projection, cross-tuple equality, evaluator execution, and full diagnostic custody ([LLP 0140:967](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:967), [LLP 0140:1000](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1000), [LLP 0140:1261](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1261)). Its residual nonclaim is accurate: even a repaired passing run would not prove behavior outside the frozen corpus/generator, all recovery-rule combinations, future tool versions before rerun, unsupported platforms, real rollback effectiveness after publication, rapid-edit Vite races, or the quality of a D-1a security review ([LLP 0140:649](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:649)).

## 3. Concerns

### 1. BLOCKING — The publication state machine contradicts LLP 0041

**Evidence checked:** Stage 4 says S3 publishes only under a non-default tag and S5 then permits `latest`, promotion, and served capability ([LLP 0140:1217](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1217), [LLP 0140:1227](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1227)). The authoritative table and guard repeat that model ([LLP 0140:1441](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1441), [LLP 0140:1454](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1454)).

LLP 0041 explicitly records that first publication of a brand-new package name can establish `latest`, and requires treating that observed version as an already-promoted prior-vector member rather than as an unrecorded side effect ([LLP 0041:401](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:401), [LLP 0041:643](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:643)). The same governing document says the terminal `@expo/snapback-*` registry generation remains unpublished ([LLP 0041:1055](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:1055)). npm’s registry metadata specification likewise describes every package as having a `latest` tag ([npm registry metadata](https://github.com/npm/registry/blob/master/docs/responses/package-metadata.md)).

There is a second conflict: LLP 0041 permits capability publication only from the successful post-promotion ledger and both final `latest` cold receipts ([LLP 0041:594](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:594), [LLP 0041:652](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:652)). LLP 0140’s S5 instead permits served capability immediately after candidate-ledger verification, before that promotion and final-`latest` evidence.

**Why it matters:** Literal execution either deadlocks at the first terminal-name publication, tolerates an unacknowledged `latest` mutation, or serves capability before the governing post-promotion proof.

**Resolution criterion:** Reconcile S3–S5 with LLP 0041’s first-publish path: run and bind the prior-vector preflight, explicitly handle an automatically established `latest` as `alreadyAtNewVersion`, quarantine it without served authority, and distinguish “authorized to begin default-tag promotion” from “terminal post-promotion closure.” Served capability must require the post-promotion ledger and both final `latest` cold receipts.

### 2. BLOCKING — Stage 3 is absent from the external-authorization lineage

**Evidence checked:** The Plan says the S1–S5 table is the single authoritative transition rule ([LLP 0140:1438](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1438)). S1 requires Stage 2 plus cold-install evidence, but not a valid Stage 3 receipt ([LLP 0140:1443](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1443)). The terminal receipt binds numerous closure facts but no Stage 3 receipt digest or case-map lineage ([LLP 0140:1468](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1468)).

Stage 3 owns Cloudflare deployment identity, browser/package proofs, maintained demos, Vite-state cases, and its own machine-readable receipt ([LLP 0140:1157](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1157), [LLP 0140:1186](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1186)).

**Why it matters:** An implementation following the authoritative table can reach candidate publication and served authorization without mechanically proving the Cloudflare identity, browser-closure, maintained-demo, or Vite diagnostic-state contracts.

**Resolution criterion:** Make valid Stage 0, Stage 1, Stage 2, and Stage 3 receipts explicit predecessors of the release machine. Bind their digests and relevant case maps into the terminal receipt, and require the authority guard to reopen and validate that lineage.

### 3. MATERIAL — Attributed re-export and static-edge coverage is incomplete

**Evidence checked:** Exact `esbuild@0.28.1` probes showed that attributes are currently admitted on JavaScript and TypeScript binding imports, side-effect imports, named re-exports, and star re-exports, including arbitrary attribute keys. Distinct `with` maps for the same JS path caused two resolve/load operations and two top-level side effects; identical maps collapsed to one; present-versus-absent and `with`-versus-legacy-`assert` remained distinct, while legacy `assert` and absent collapsed.

The Plan’s normalization and rewrite mechanism is generic, and its JavaScript side-effect assertion provides partial coverage ([LLP 0140:903](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:903), [LLP 0140:924](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:924)). But its explicit valid corpus and acceptance rows name JSON import attributes, while re-exports are tested separately rather than in composition with attributes ([LLP 0140:1034](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1034), [LLP 0140:1270](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1270), [LLP 0140:1276](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1276)). Current esbuild resolution is catch-all and does not restrict attributes by syntax or extension ([index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783)).

**Why it matters:** A candidate can correctly rewrite attributed `ImportDeclaration`s yet miss attributed `ExportNamedDeclaration` or `ExportAllDeclaration` edges, pass all named rows, and silently merge module instances that are distinct today.

**Resolution criterion:** State that rewriting covers binding and side-effect imports, source-bearing named re-exports, star re-exports, and namespace re-exports across every currently admitted JS/TS/JSON extension. Fixture each edge family with identical, distinct, present/absent, and `with`/`assert` maps, asserting instance identity and side-effect/value behavior rather than only successful bundling.

### 4. MATERIAL — The length-changing rewrite lacks general diagnostic back-projection

**Evidence checked:** The proposed synthetic specifier changes source length and says the syntactic ledger recovers the authored import span ([LLP 0140:903](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:903)). That is sufficient for resolver-edge refusals, which the Plan already maps through the ledger ([LLP 0140:848](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:848)); it is not sufficient for a later Rolldown parse/link diagnostic located after the rewritten specifier. The acceptance contract nevertheless requires every JavaScript and TypeScript diagnostic to retain the original authored line and column ([LLP 0140:1319](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1319)).

In a proxy probe, a same-line top-level-await diagnostic after an attributed import moved from zero-based column 48 to 127 when the specifier was replaced with the proposed digest-bearing form. The Plan’s attribute and top-level-await fixtures are not composed, so both standalone rows could pass.

**Why it matters:** Stable codes and admission can survive while the public diagnostic span silently points into transformed source.

**Resolution criterion:** Name an internal edit-map/source-map or length-preserving indirection that maps every downstream Rolldown location—not only resolver errors—back to authored UTF-16 offsets. Add composed same-line post-attribute diagnostics for imports and re-exports over ASCII and non-BMP text. Output sourcemaps may remain disabled; the required map is internal diagnostic custody.

### 5. MATERIAL — Stage 1’s independent release alternative is not an executable gate

**Evidence checked:** The Plan says every gate names an executable command and machine-readable manifest ([LLP 0140:1000](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1000)). Stage 1 then allows either repository-only landing or an independent native-parser release, referring to a Stage-1 release receipt but naming no command, receipt path/schema, or guard fixture ([LLP 0140:1101](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1101)). The later mechanical predicate is defined only by the definition-bundler dependency and dual-run seam, with no native-parser or Stage-1-release-receipt condition ([LLP 0140:1454](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1454)).

**Why it matters:** Under the repository-only branch, the stated authoritative guard need not block publication of an Oxc-native closure. Under the release branch, there is no executable artifact that proves the two-host gate or authorizes release.

**Resolution criterion:** Either make Stage 1 unconditionally repository-only until the later two-tuple closure gate, with the authority predicate explicitly covering the Oxc native dependency independently of Rolldown, or define the independent release command, receipt, two-host lineage, guard validation, and bidirectional fixture.

## 4. Suggestions

- Change [LLP 0140:667](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:667) to say “Rolldown’s Oxc transformer supports TypeScript lowering.” `oxc-parser` parses; it does not itself lower TypeScript.

- Commit the exact-version upstream probes as a small normalized receipt-producing command. That would make the parser error table, offset-unit claim, option-placement hazards, and import-attribute behavior repeatable instead of leaving measured facts embedded only in prose.

- Record individual package rows—not only aggregate Rolldown/parser totals—in the promised Stage 0 size receipt. The present basis is reproducible, but component rows make registry drift easier to audit.

- Model release evidence as a receipt DAG whose nodes name predecessor receipt digests. That would naturally prevent both the missing Stage 3 lineage and ambiguity between candidate qualification, promotion authorization, and post-promotion served authority.

## 5. Open questions

1. How exactly will first publication of the terminal package names handle an automatically created `latest` tag without violating either the candidate-only stage or LLP 0041’s prior-vector rules?

2. Is S5 intended merely to remove LLP 0140’s additional migration block, or to constitute served-capability authority? If the former, where are LLP 0041’s post-promotion ledger and final `latest` cold receipts bound?

3. Will Stage 3 become an explicit predecessor of S1/S5, and which Stage 3 receipt digest and case-map facts enter the terminal receipt?

4. Which attributed static-edge syntaxes and admitted extensions are normative, and what mechanism maps all post-rewrite diagnostics back to authored offsets?

5. Will Stage 1 be repository-only, or independently releasable? What exact receipt and guard predicate authorizes the latter?

6. Which D-1 branch will the author select? This remains a legitimate pre-execution author decision, not a defect in this review.

7. What checked-in command will reproduce the exact `oxc-parser@0.142.0` recovery/error and UTF-16-offset measurements before they become migration oracles?

## 6. Readiness verdict

VERDICT: NOT READY

Blocking list:

- The S3–S5 publication machine conflicts with LLP 0041’s first-publication and post-promotion authority rules.
- External authorization does not mechanically depend on Stage 3 evidence.

Under the stated readiness bar, the attributed-edge coverage, diagnostic back-projection, and Stage 1 release-gate defects are also material and must be closed before READY.
## Orchestrator verification (outside the verbatim body)

All five items confirmed; none refuted.

- **Concern 1** is grounded in LLP 0041's own text: first publication of a
  brand-new package name can establish `latest`, and served capability is
  permitted only from the post-promotion ledger and both final `latest` cold
  receipts. v0.8's S5 permitted served capability immediately after
  candidate-ledger verification. v0.9 splits S5 (promotion-authorized) from a
  new **S6** (terminal, post-promotion), and adds the prior-vector preflight
  with `alreadyAtNewVersion` quarantine so a first-publish `latest` is
  acknowledged rather than either deadlocking or passing silently.
- **Concern 2** confirmed: the authoritative table required Stage 2 but not
  Stage 3, so an execution could reach candidate publication without
  mechanically proving Cloudflare identity, browser closure, maintained demos,
  or the Vite dev states. v0.9 makes Stage 0–3 receipts explicit S1
  predecessors and binds their digests and case maps into the terminal receipt.
- **Concern 3** confirmed by probe: attributes are admitted today on binding
  imports, side-effect imports, source-bearing named re-exports, star
  re-exports, and namespace re-exports, on JS/TS as well as JSON, with arbitrary
  keys. v0.8's rewrite fixtures named only JSON `import` declarations, so a
  candidate rewriting only `ImportDeclaration` would pass every row and silently
  merge distinct instances. v0.9 covers each edge family with its own fixtures,
  plus a non-`type: "json"` map on a JavaScript import.
- **Concern 4** confirmed and consequential: the synthetic specifier is longer
  than the authored one, so a later same-line diagnostic points into transformed
  source (measured, column 48 → 127). v0.9 adds an internal per-file edit map
  and requires back-projection of **every** downstream Rolldown location, with
  composed post-attribute diagnostic fixtures over ASCII and non-BMP text.
- **Concern 5** confirmed: the Stage-1 "independent release" alternative named
  no command, receipt, or fixture, and the guard predicate keyed only on the
  definition bundler. v0.9 removes the alternative — Stage 1 is unconditionally
  repository-only — and the freeze predicate now covers a native parser binding
  independently of Rolldown.
- All three suggestions adopted, including the correction that Rolldown's
  bundled Oxc **transformer** lowers TypeScript while `oxc-parser` only parses.


## Round 9 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf47-3180-7cc1-99dd-3ae1ad81cb1f`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Target SHA-256:** `7c2f6dad56a43d6db770fa322b55ba5edcd2cc970701d8c6e9e1621eddcc9dc2`
**Instruction SHA-256:** `4a05bd57f9055ef3a28de164a86d4e6ebb2937a7fe894f3c52e66b0fe9c95f11`
**Status:** completed

## Verbatim review

Target SHA-256 computed: `7c2f6dad56a43d6db770fa322b55ba5edcd2cc970701d8c6e9e1621eddcc9dc2`  
Expected SHA-256: `7c2f6dad56a43d6db770fa322b55ba5edcd2cc970701d8c6e9e1621eddcc9dc2`  
Hash match: **yes**  
Date: **2026-08-01**

Method note: I read LLP 0140 in full; inspected every file in its inventory; traced codegen through `index.mjs`, `inline-handlers.mjs`, the capability-aware reader, evaluator, package manifests, publication scripts, and proof scripts; ran binary-safe repository searches for direct first-party esbuild, Acorn, TypeScript compiler API, and builtin transform use; checked every governing-constraint anchor in LLPs 0009, 0010, 0030, 0041, 0049, 0108, and 0118; checked the size arithmetic and acceptance/state-machine logic; and consulted primary Rolldown/Oxc documentation. I did not read anything under `llp/reviews/`, did not read files matching the prohibited filename pattern, and made no edits. Exact `rolldown@1.2.1` and `oxc-parser@0.142.0` were not installed and package installation was unavailable in this read-only environment, so I could not independently rerun the exact-version Oxc error table or Rolldown half of the import-attribute probe. Those exact measurements remain uncertain, not contradicted; exact esbuild 0.28.1 and adjacent Rolldown 1.1.5 probes corroborated the import-attribute divergence.

## 1. Overall assessment

The migration direction is well planned, and most of the hard analytical work is unusually strong: the repository census is complete, governing constraints are cited accurately, current codegen behavior is understood in detail, D-1 is presented honestly under both branches, the size arithmetic is correct, and the proposed differential and two-platform evidence is substantive rather than ceremonial.

It is nevertheless not ready. Three contradictions in the release machinery would permit or invalidate states the Plan says must be impossible, and one uncomposed pair of length-changing transforms can silently break import-attribute behavior or authored diagnostics. These are execution defects in the Plan, not requests for implementation detail.

VERDICT: NOT READY

## 2. Strengths

- **The first-party inventory is complete and accurate.** I found all seven direct esbuild source surfaces, the sole Acorn import and its six consumers, and all TypeScript compiler API surfaces represented in the table at [LLP 0140:188](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188). Representative confirmations include codegen’s three tool imports and bundle call at [index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), the browser proof at [browser-closure.test.mjs:14](/Users/ccheever/projects/snapback/packages/snapback-client/browser-closure.test.mjs:14), Cloudflare identity discovery at [generate-deployment-identity.mjs:52](/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:52), and the Miniflare bundle at [harness.mjs:144](/Users/ccheever/projects/snapback/cloudflare/test/harness.mjs:144). I found no omitted first-party direct API surface.

- **The Acorn and TypeScript responsibility census is precise.** The six Acorn consumers listed at [LLP 0140:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204) match the code. The Plan also correctly distinguishes the syntax-only scan from the real TypeScript symbol service, whose const evaluation, binding classification, checker use, and identity production appear at [inline-handlers.mjs:132](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:132) and [inline-handlers.mjs:449](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:449).

- **The governing constraints are faithfully cited.** LLP 0009 really does distinguish static defense-in-depth from runtime authority at [LLP 0009:788](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:788); LLP 0010 establishes diagnostic, graph, evaluator, and custody requirements at [LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:312) and [LLP 0010:346](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:346); and the Vite, distribution, freshness, identity, and controlled-bundler anchors also exist and support the claims. The stale allowlist namespace in LLP 0118 is correctly acknowledged rather than silently relied upon at [LLP 0140:1285](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1285).

- **The proposed admission plugin covers the current esbuild-hosted contract well.** Current behavior includes separate graphs, controlled resolver/load hooks, exact-file resolution, package-scope manifests, module-format refusal, authored-byte graph identity, and a capability-empty evaluator at [index.mjs:603](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:603), [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736), [index.mjs:7783](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7783), and [index.mjs:8174](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8174). The plugin requirements at [LLP 0140:673](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:673) name all of those behaviors.

- **The tool capability assumptions are credible.** Current primary documentation confirms that Rolldown exposes an in-memory `generate()` API with explicit `close()` discipline, `codeSplitting: false`, `treeshake: false`, comment controls, and `tsconfig: false`; it also exposes plugin-context graph metadata. [RolldownBuild](https://rolldown.rs/reference/Interface.RolldownBuild), [`codeSplitting`](https://rolldown.rs/reference/OutputOptions.codeSplitting), [`treeshake`](https://rolldown.rs/reference/InputOptions.treeshake), [`tsconfig`](https://rolldown.rs/reference/InputOptions.tsconfig). Oxc documents ESTree-compatible JavaScript, TS-ESTree TypeScript, spans, `preserveParens`, and `showSemanticErrors`. [`oxc-parser`](https://www.npmjs.com/package/oxc-parser). Graph-metadata *sufficiency* remains uncertain, but the Plan correctly makes it an early Stage-3 spike rather than assuming it at [LLP 0140:1207](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1207).

- **The size argument is honest and reproducible at Plan level.** Package sets, versions, platform bindings, libc, measurement date, and download-versus-unpacked definitions are stated at [LLP 0140:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239). Every total and D-1 delta is arithmetically correct. The conclusions—that the direct bundler swap grows, D-1a shrinks the isolated set, D-1b grows it, and resolved application closures need separate measurement—follow from the numbers at [LLP 0140:276](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:276).

- **The acceptance matrix is otherwise a real gate.** It checks graph identity, evaluated values, artifacts, full diagnostic custody, evaluator capabilities, platform binding selection, final post-seam tarballs, and cross-tuple equality at [LLP 0140:1165](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1165) and [LLP 0140:1313](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1313). It also honestly states what passing cannot prove: grammar equivalence outside the corpus, untested recovery combinations, unsupported tuples, rapid-edit races, post-publication rollback effectiveness, broader performance, and D-1a review quality at [LLP 0140:649](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:649).

## 3. Concerns

### 1. BLOCKING — Served capability becomes mechanically legal at S5, before required S6 evidence

**Evidence checked:** LLP 0041 requires the capability carrier to name the post-promotion ledger at [LLP 0041:652](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:652). LLP 0140’s authoritative table agrees: S5 permits promotion but explicitly not served capability; S6 requires the post-promotion ledger and both final `latest` receipts at [LLP 0140:1492](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1492).

Three executable clauses contradict that rule:

- Stage 4 says S5’s `0140-stage4.json` permits served capability at [LLP 0140:1272](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1272).
- The acceptance predicate refuses serving only while that S5 receipt is absent at [LLP 0140:1435](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1435).
- The guard implements the same premature condition at [LLP 0140:1512](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1512).

The guard also says it rejects “any `latest` move” before S5, without expressing the first-publication exception that S3 explicitly needs at [LLP 0140:1495](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1495). Saying the table wins does not fix acceptance code specified from the contradictory predicate.

**Resolution criterion:** Define one six-state machine consistently across Stage 4, the acceptance matrix, guard logic, receipts, and completion. Give S5 a promotion-authorization receipt only. Require a distinct S6 artifact—or a clearly specified validated extension—binding the post-promotion ledger and both final `latest` cold receipts before any served-capability reference. Add fixtures for:

- S3 first publication establishing `latest` but remaining quarantined;
- S5 present/S6 absent refusing served capability;
- S6 complete permitting served capability.

### 2. BLOCKING — Stage 1’s repository-only native-parser freeze is not enforced

**Evidence checked:** Stage 1 switches production scans to Oxc at [LLP 0140:1130](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1130), then says that native closure may neither publish nor serve and claims the freeze predicate covers it independently of Rolldown at [LLP 0140:1144](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1144).

But the Plan installs the guard only before or atomically with the Stage-2 switch at [LLP 0140:1507](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1507). Its stated file triggers are Rolldown as definition bundler and the dual-run seam at [LLP 0140:1512](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1512); neither identifies the Stage-1 Oxc-plus-esbuild state. The current authority checker only validates versions at [check-toolchain-authority.mjs:69](/Users/ccheever/projects/snapback/scripts/check-toolchain-authority.mjs:69), and the publisher currently has no LLP-0140 freeze check at [snapback-publish.mjs:342](/Users/ccheever/projects/snapback/scripts/snapback-publish.mjs:342). Rollback prose also says Oxc may “ship independently,” conflicting with “unconditionally repository-only” at [LLP 0140:1457](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1457).

**Resolution criterion:** Install and wire the freeze guard before or atomically with the Stage-1 production switch. Its predicate must directly detect a migration-introduced native parser binding and block publication, promotion, and serving for every freeze-predicate package until the two-tuple release state is reached. Add an Oxc + esbuild + no-dual-seam deny fixture and clarify whether “ship” means merely “land repository-only.”

### 3. BLOCKING — Stage 4 invalidates the source-bound receipt it just created

**Evidence checked:** The sequence emits the receipt at S5 and then performs documentation reconciliation and Guide/proof work at [LLP 0140:1272](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1272). At least one edit is already known to be required: LLP 0010’s incorrect relative/file-only sentence is explicitly assigned to Stage 4 at [LLP 0140:135](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:135) and [LLP 0140:1290](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1290).

The receipt’s source projection excludes only `llp/receipts/**` and LLP 0140’s status line; any other source change invalidates it at [LLP 0140:1549](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1549). Re-emitting after the documentation change does not solve this unless the package closure is rebuilt and requalified from that changed source projection: the already-published immutable tarballs remain bound to the earlier source SHA.

**Resolution criterion:** Land every governing LLP and Guide change inside the immutable candidate checkout before S1/S2 package construction and qualification. Make the post-receipt audit read-only. If it discovers an edit, require a new source SHA, new immutable package version where applicable, and a complete qualification restart. Move the already-known LLP 0010 correction before candidate construction.

### 4. MATERIAL — The inline-handler and import-attribute transforms have no composition rule

**Evidence checked:** Codegen extracts inline handlers before bundling and passes a modified functions entry at [index.mjs:603](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:603). Inline extraction replaces authored expression ranges with length-changing marker expressions at [inline-handlers.mjs:826](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:826).

The Plan separately requires preserving that transformed functions entry at [LLP 0140:708](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:708), then applying Oxc-derived attributed-specifier rewrites and an authored-offset edit map at load time at [LLP 0140:911](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:911). It does not specify whether Oxc spans are applied before or after inline replacement, or how authored ↔ inline-marker ↔ attribute-rewrite maps compose. The named composition fixtures at [LLP 0140:953](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:953) compose attributes with diagnostics, but not with the pre-existing inline transformation.

**Resolution criterion:** State the transform order and the composed reverse mapping. Add a fixture with a length-changing inline handler, attributed imports/re-exports both before and after it, and a downstream Rolldown diagnostic. Assert module-instance semantics, exact rewritten specifiers, and original authored spans.

## 4. Suggestions

- Rename S5’s artifact to “promotion-authorization receipt” and reserve “terminal served-capability receipt” for S6.
- Correct “five explicit states” to six at [LLP 0140:1481](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1481).
- Spell the option-manifest row as `output.banner`, matching Rolldown’s option nesting, at [LLP 0140:748](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:748).
- Commit the exact-version Oxc error-class and Rolldown import-attribute probes as runnable Stage-0 cases with raw outputs. That would make the document’s measured claims independently reproducible without relying on prose.
- Use “land” for repository-only states and “publish/promote/serve” for release transitions; “ship” currently obscures which authority is intended.

## 5. Open questions

1. Which D-1 branch will be recorded at Stage 1? Leaving it open during review is not itself a defect; both branches are coherently described.
2. What exact artifact represents S6, and does `0140-stage4.json` remain immutable pre-promotion evidence or become a versioned post-promotion object?
3. Is Stage 1 categorically repository-only, or is an independent Oxc release intended? The present text says both.
4. Which transform runs first for the functions entry, and what object owns the composed offset map?
5. If Rolldown’s graph metadata cannot fully cross-check the Snapback ledger, what is Stage 3’s fail-closed fallback: ledger-only authority, an additional plugin hook, or retention of the esbuild identity surface?
6. Will the exact 1.2.1/0.142.0 probe scripts and outputs be part of the frozen Stage-0 corpus, including the Oxc UTF-16 offset claim and full parser error table?

## 6. Readiness verdict

VERDICT: NOT READY

Blocking list:

- S5 currently unlocks served capability before S6’s post-promotion evidence.
- Stage 1’s native-parser repository-only freeze has no operative guard.
- Stage 4’s documentation sequence invalidates its source-bound receipt.

The inline/attribute transform-composition concern is additionally material and must also be resolved before the Plan is ready.
## Orchestrator verification (outside the verbatim body)

All four items confirmed; none refuted. Concerns 1 and 2 were reached
**independently by the Fable family in the same round**, which is the strongest
convergence signal of the loop.

- **Concern 1** confirmed against the document's own table: Stage 4 step 6's
  narration still granted served capability at S5 while the table reserved it
  for S6. v0.10 removes it from the narration and gives S6 its own step.
- **Concern 2** confirmed and is the more serious of the two: in the window
  after Stage 1 lands and before Stage 2, the definition bundler is still
  esbuild and the dual-run seam does not exist, so neither of the guard's two
  stated triggers could fire — and the freeze predicate was scoped "during
  S1–S2", a state window whose entry required receipts that do not yet exist.
  An ordinary codegen publication could have carried a single-tuple-proven
  native parser into the public closure. v0.10 adds a third file fact (a
  declared migration-introduced native binding), rebases the freeze on that
  manifest fact from the Stage-1 landing, and adds the Stage-1-only case to the
  guard's fixture.
- **Concern 3** confirmed: Stage 4's documentation step ran *after* the terminal
  receipt was emitted, and the receipt's source projection excludes only
  `llp/receipts/**` and the status line — so the already-scheduled LLP 0010
  correction would have invalidated the receipt it just authorized, with
  re-emission unable to help because the published tarballs stay bound to the
  earlier SHA. v0.10 moves every amendment inside the immutable candidate
  checkout before S2 construction and makes Stage 4's pass a read-only audit
  whose failure mode is a qualification restart.
- **Concern 4** confirmed and matches the Fable family's parallel suggestion:
  inline extraction already performs a length-changing substitution on the
  functions entry, so two length-changing transforms meet on the highest-value
  file with no stated order. v0.10 pins the order (inline first, attribute
  rewrite second), states that the edit map composes with LLP 0108's splice
  accounting in two hops, and adds the composed fixture.


## Round 10 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf58-99ad-79d1-aa78-4e085cc4c2c7`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; read `scripts/snapback-promote.mjs` and LLP 0041 promotion machinery alongside the target
**Target SHA-256:** `4e62ab1b241b907f85e8d6d7fadf2bd8ba533f8e8a4a0366e2b6ac7c7e24ff94`
**Instruction SHA-256:** (round-10 capsule, derived from the round-8 calibration capsule with the v0.10 hash)
**Status:** completed

## Verbatim review

Target SHA-256: `4e62ab1b241b907f85e8d6d7fadf2bd8ba533f8e8a4a0366e2b6ac7c7e24ff94` — **MATCHED**  
Date: 2026-08-01

Method note: I read all 1,655 lines of the target, every inventory-table file, the codegen bundler/scanner implementation and delegates, all cited governing LLP sections, the package-promotion implementation, and the acceptance/release machinery. I performed binary-safe repository searches for esbuild, Acorn, TypeScript compiler APIs, generated imports, and builtin transform authority. I checked current upstream Rolldown/Oxc documentation and ran the installed esbuild 0.28.1 import-attribute probe. I could not execute `rolldown@1.2.1` or `oxc-parser@0.142.0`: neither is installed, the workspace is read-only, and shell network/DNS was unavailable. Their exact-version measured error tables and runtime probes therefore remain independently uncertain, not contradicted. I did not read anything under `llp/reviews/`, did not read any filename containing `super-refine`, and made no edits.

## Overall assessment

The Plan is technically serious and substantially correct. The first-party census is complete, the governing anchors are real and accurately represented, D-1 is framed honestly under both branches, the size arithmetic is correct, and most upstream capabilities assumed by the design exist.

It is nevertheless not ready. Executing the attribute-rewrite mechanism literally would merge distinct modules and mishandle dependencies imported from attributed JavaScript/TypeScript modules. Separately, the S5/S6 release protocol cannot enforce its stated served-capability boundary and asks an already-emitted receipt to bind evidence that does not yet exist. The pinned option manifest also misplaces Rolldown’s intrinsic-capture banner.

Once those defects are fixed, the acceptance program would establish strong bounded evidence for the declared corpus and two platforms. It would still not prove universal grammar equivalence, behavior under future tool versions, unsupported platforms, rapid-edit race safety, post-publication rollback effectiveness, raw `npm publish` enforcement outside the proof harness, or the quality of a future D-1a security review. The Plan already discloses most of these limits at [LLP 0140:650](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:650) and [LLP 0140:1539](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1539).

VERDICT: NOT READY

## Strengths

- The inventory is complete and accurate. Binary-safe searches found exactly the seven first-party esbuild behavioral surfaces in the table, Acorn only in codegen, and TypeScript compiler API use only in the four stated files. The six Acorn call sites exactly match the responsibilities enumerated at [LLP 0140:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204). The NUL-bearing-file warning at [LLP 0140:143](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:143) is factual.

- The proposed admission plugin covers the current esbuild path’s significant behavior: separate graphs, functions-only transformed entry, capability-mediated reads, exact-file resolution, package-format inputs, authored-byte identity, facade handling, diagnostics, and evaluator custody. Those requirements are concentrated usefully at [LLP 0140:674](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:674).

- All cited governing sections exist and substantively support the Plan. Examples include the static graph and identity requirements at [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330), the capability boundary at [LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774), current stock-bundler ownership at [LLP 0118:246](/Users/ccheever/projects/snapback/llp/0118-vite-rolldown-oxc-alignment.research.md:246), and the packaged-runtime proof model at [LLP 0041:297](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:297).

- The parser projection handles the difficult cases instead of assuming “ESTree-compatible” means interchangeable. The per-consumer TypeScript fallback matrix, UTF-16 span contract, structural error categories, two-direction differential sweep, and explicit residual nonclaim are particularly strong at [LLP 0140:421](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:421), [LLP 0140:482](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:482), and [LLP 0140:614](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:614).

- At the documented API level, the main upstream assumptions hold: Rolldown supports in-memory `generate()` with explicit `close()`, IIFE output, disabled code splitting, disabled tree shaking, disabled sourcemaps, transform targets, controlled plugin resolution, and module metadata. Oxc documents synchronous/asynchronous parsing and ESTree/TS-ESTree projections. Graph completeness is appropriately left to the Stage-3 spike rather than asserted from typings alone. See the official [Rolldown build API](https://rolldown.rs/reference/Interface.RolldownBuild), [output options](https://rolldown.rs/reference/Interface.OutputOptions), [input options](https://rolldown.rs/reference/Interface.InputOptions), [plugin context](https://rolldown.rs/reference/Interface.PluginContext), and [`oxc-parser`](https://www.npmjs.com/package/oxc-parser).

- The size basis is sufficiently precise for reproduction: exact package sets, versions, platform bindings, tarball bytes versus registry unpacked size, measurement date, and the future integrity-bearing receipt are stated at [LLP 0140:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239). Every displayed sum and D-1 delta is arithmetically correct. The conclusion at [LLP 0140:287](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:287)—smaller only under D-1a—is supported by the figures. I could not independently refetch the raw tarball byte counts.

## Concerns

### 1. BLOCKING — Attribute-derived module IDs collide and lose importer identity

Evidence checked: The Plan defines runtime instance identity as `(resolved real path, normalized attribute map)`, but rewrites to `snapback:attr/<mapDigest>/<specifier>` at [LLP 0140:918](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:918) and requires `resolveId` to return that string unchanged at [LLP 0140:921](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:921).

Those are not equivalent. `/a/main.ts` and `/b/main.ts` can both import `./dep.ts` with the same attribute map. The prescribed synthetic IDs are identical even though the resolved files differ, so Rolldown can merge the modules globally.

There is a second break: when an attributed JS/TS module imports `./child.ts`, Rolldown supplies the synthetic ID as `importer`. The current resolver derives the base directory from the real importer at [index.mjs:7802](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7802). The Plan only says `load` maps the synthetic ID to real bytes; it never requires child resolution or nearest-`package.json` lookup to canonicalize the importer back to its real path. The existing fixtures compose attribute maps and edge forms, but not two same-spelled imports from different directories or an attributed module with its own dependency graph.

Resolution criterion: Define synthetic identity from the resolved real-path identity plus normalized attribute map, not from the authored specifier alone. Maintain a `syntheticId → realPath` association and require every child-edge resolution, package-scope lookup, capability check, graph projection, and diagnostic projection to use it. Add composed fixtures proving:

- identical `./dep.ts` spellings and maps from different directories stay distinct;
- an attributed JS/TS module resolves its own child, governing `package.json`, and cycles from the real path;
- runtime instances remain pair-keyed while persisted graph identity still collapses to one member per real file.

### 2. BLOCKING — The S5/S6 receipt and authorization sequence is impossible

Evidence checked: S5 emits `0140-stage4.json`, authorizes beginning promotion, and explicitly does not authorize serving at [LLP 0140:1288](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1288). S6 requires the post-promotion ledger and final `latest` receipts at [LLP 0140:1291](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1291).

However, the mechanical acceptance condition and guard block promotion and serving only while `0140-stage4.json` is absent at [LLP 0140:1460](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1460) and [LLP 0140:1550](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1550). Once S5 creates that file, the stated guard no longer forbids serving. Conversely, the freeze prose says default-tag promotion remains frozen until S6 at [LLP 0140:1556](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1556), which would prevent the promotion needed to reach S6.

The receipt chronology is also impossible. The S6 table says the post-promotion ledger is digest-bound into the “terminal receipt” at [LLP 0140:1519](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1519), but that receipt was already emitted at S5 and its schema only names the candidate ledger at [LLP 0140:1581](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1581). LLP 0041 and the actual promoter construct the post ledger only after tag mutations and both final `latest` proofs, at [LLP 0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420) and [snapback-promote.mjs:706](/Users/ccheever/projects/snapback/scripts/snapback-promote.mjs:706).

Resolution criterion: Split the evidence into:

- an S5 promotion-authorization receipt binding S4 and candidate evidence, which permits default-tag promotion but refuses served references; and
- an S6 terminal receipt binding the S5 digest, post-promotion ledger, both final `latest` receipt digests, and terminal observations.

The served-capability guard must require and reopen S6. Add negative fixtures proving valid S5 plus absent S6 permits promotion but refuses serving, and valid S6 permits serving.

### 3. MATERIAL — The pinned banner option is in the wrong manifest namespace

Evidence checked: The option table consistently identifies output settings as `output.*`, but names the intrinsic-capture setting merely `banner` at [LLP 0140:749](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:749), despite saying the table is generated from the consumed JSON manifest at [LLP 0140:754](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:754). Rolldown defines the setting on `OutputOptions`, conventionally `output.banner`, not on input options; its examples nest it under `output`. See the official [`OutputOptions.banner`](https://rolldown.rs/reference/OutputOptions.banner).

This matters because the current banner captures serialization intrinsics before authored code at [index.mjs:7748](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7748). A combined manifest that places `banner` at input/root level does not configure that output behavior. I could not probe whether 1.2.1 warns, rejects, or ignores the misnesting; the documented type surface is sufficient to establish that the path is wrong or ambiguous as written.

Resolution criterion: Name the serialized path as `output.banner` and specify that `manifest.output.banner` is passed to `generate()`. Add a behavior test proving the exact intrinsic declarations precede all authored/module code, plus a negative test for input-level misplacement.

### 4. MINOR — One governing citation misses the exact optional-runtime rule

Evidence checked: Constraint 7 cites broad runtime-distribution and acceptance sections at [LLP 0140:104](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:104). The exact rule is in `LLP 0041#nine-package-candidate-promotion--2026-07-28`, where each host must retain exactly one empty opposite-platform optional edge while excluding the opposite runtime elsewhere at [LLP 0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420). The acceptance matrix later cites that anchor correctly.

Resolution criterion: Add the exact LLP 0041 anchor and describe the distinction between absent opposite-platform bytes and the retained empty optional edge.

## Suggestions

- Under D-1a, explicitly say that `inline-handlers.mjs` is ported wholesale from TypeScript nodes onto the Oxc projection and new resolver. “Implement the binding resolver” at [LLP 0140:1142](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1142) understates the AST traversal, extraction, splicing, and identity work, although the existing gates would probably catch an incomplete port.

- Commit the small exact-version probe programs that produced the Oxc error table and Rolldown observations. That would make the measured claims directly reproducible during Stage 0 instead of depending on prose transcripts.

- Rename every S5 occurrence from “terminal receipt” to “promotion-authorization receipt.” Reserve “terminal” exclusively for S6.

## Open questions

1. What collision-free identifier will represent `(resolved real path, normalized attribute map)`, and how will synthetic importers recover their real resolution base?

2. What exact artifact records S6, who emits it, and which guard consumes it for served capability?

3. Is the option manifest a combined `{input, output}` object? If so, will every output setting—including `banner`—be mechanically generated and consumed from the `output` member?

4. Which D-1 branch will be selected? This remains a legitimate gated author decision, not a defect in itself.

5. Can the author provide the executable probes or receipts for the exact `oxc-parser@0.142.0` error table and `rolldown@1.2.1` measured behaviors?

## Readiness verdict

NOT READY.

Blocking list:

- The attribute synthetic-ID scheme can merge different real modules and loses the real importer needed for nested resolution.
- The S5/S6 release machine cannot distinguish promotion authorization from served-capability authorization and requires a receipt to bind future evidence.
- The material `output.banner` manifest-path error must also be corrected before the Plan meets the stated readiness bar.
## Orchestrator verification (outside the verbatim body)

All four items confirmed; none refuted. Concern 2 is the same defect the Fable
family reached independently in the same round.

- **Concern 1 is a real design bug, and the most valuable finding of this
  round.** v0.10's synthetic id `snapback:attr/<mapDigest>/<specifier>` keys on
  the *authored specifier*, so `/a/main.ts` and `/b/main.ts` importing
  `./dep.ts` with the same attribute map produce the **same** id — merging two
  different files globally, the exact failure the mechanism exists to prevent.
  The second half is equally real: Rolldown supplies the synthetic id as
  `importer` for child edges, and the current resolver derives its base
  directory from the real importer (`index.mjs:7802-7806`), so child resolution,
  package-scope lookup, capability checks, and diagnostics all needed an
  explicit canonicalization rule. v0.11 keys the id on the resolved real path,
  maintains the `syntheticId → realPath` association, requires every downstream
  use to canonicalize through it, and adds the two composed fixtures.
- **Concern 2** confirmed: the guard's operative clauses keyed on the mere
  existence of `0140-stage4.json`, which S5 creates — so serving became
  mechanically legal at S5 while the table reserved it for S6; and the S6 row
  bound the post-promotion ledger into a receipt already emitted at S5, which
  `scripts/snapback-promote.mjs:706` and LLP 0041 make chronologically
  impossible. v0.11 splits the receipts (`0140-s5.json`, `0140-s6.json`) and
  derives the guard's failure conditions per permission from the state table,
  with the two missing negative fixtures named.
- **Concern 3** confirmed on the documented type surface: `banner` belongs to
  `OutputOptions`, so a root-level entry in the generated manifest would not
  configure the intrinsic-capture banner at all. v0.11 names `output.banner`,
  the serialized path, and both the positive and misplacement tests.
- **Concern 4** confirmed and applied: constraint 7 now carries the exact
  nine-package-promotion anchor and distinguishes absent opposite-platform bytes
  from the retained empty optional edge.


## Round 11 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf6e-25ef-71e1-8807-24341d5959a9`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; read LLP 0041, 0044, and 0111 alongside the target
**Target SHA-256:** `7efc9de29fa7c5983a53eb0a607406c8549aa233063173b26d8b6e56233379a0`
**Status:** completed

## Verbatim review

Target SHA-256 computed: `7efc9de29fa7c5983a53eb0a607406c8549aa233063173b26d8b6e56233379a0`  
Expected SHA-256: `7efc9de29fa7c5983a53eb0a607406c8549aa233063173b26d8b6e56233379a0` — **MATCH**  
Date: 2026-08-01

Method: I read all 1,703 lines of the target; inspected every inventory file, the codegen bundler/scanners and delegated file reader, package manifests, all 19 explicit LLP anchors, and additional governing LLPs 0044, 0111, and 0131; and ran binary-safe repository searches excluding `llp/reviews/**` and every filename containing `super-refine`. I checked official Rolldown/Oxc APIs and package metadata, recomputed the size arithmetic, and reproduced the esbuild half of the import-attribute identity probe. Exact `rolldown@1.2.1` and `oxc-parser@0.142.0` were not installed, and the read-only/network-restricted environment prevented installation, so I could not independently rerun the Oxc error table, UTF-16 offset probe, Rolldown attribute coalescing, warning escalation, or top-level-await probes. Those measurements remain unverified, not contradicted. I made no edits.

## 1. Overall assessment

The migration design is technically credible. The repository census is complete, the current codegen behavior is accurately decomposed, the parser and bundler APIs can support the proposed architecture, and the Plan is unusually candid about D-1, size regressions, bounded differential evidence, and native-process residual risk.

It is not ready because the release state machine still cannot execute in its stated order. S3 requires an LLP 0041 candidate ledger and prior-vector preflight before candidate publication, but LLP 0041 creates that ledger only after publication and registry re-download, and the preflight binds that ledger immediately before default-tag mutation. Several nearby sentences independently reintroduce the same deadlock. The Plan also stops its named Stage-4 gate at S5 while calling S6 terminal.

Two further material gaps remain: S6 is written as permitting served capability without the independently required LLP 0111 qualification/CAS/public-observation sequence, and D-1a does not cover LLP 0044’s in-flight upload-attempt and policy-generation behavior.

D-1 being undecided is not itself a defect; the Plan is coherent enough to review under both branches.

VERDICT: NOT READY

## 2. Strengths

- **The first-party census held.** Binary-safe searches found exactly the direct esbuild, Acorn, TypeScript-API, and `stripTypeScriptTypes` uses listed in the inventory; no migration-owned use was omitted. The six Acorn calls are precisely at [index.mjs:4986](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4986), `5090`, `5664`, `5768`, `7427`, and `7469`, and the one syntax-only TypeScript scanner begins at `5391`. The Plan correctly distinguishes these from the type-semantic inline-handler service and retained `tsc` uses ([Plan:141](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:141), [Plan:188](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188), [Plan:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204)).

- **The admission-plugin specification covers the current esbuild path.** It captures controlled facade generation, exact-file resolution, no resolver fallthrough, capability-aware reads, package-scope format lookup, authored-byte identity, functions-only source override, stable diagnostics, and separate fresh evaluation ([Plan:679](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:679); current implementation at [index.mjs:7679](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7679)). I found no omitted behavior relied on by the current host.

- **The import-attribute analysis is strong.** The Plan distinguishes runtime instance identity from persisted graph identity and specifies the synthetic-ID rewrite, importer canonicalization, edit-map composition, and multi-edge-family fixtures ([Plan:875](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:875), [Plan:917](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:917), [Plan:959](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:959)). My esbuild 0.28.1 probe reproduced the stated `with → {"type":"json"}`, `assert → {}`, two-load, unequal-object behavior.

- **The parser migration is framed as contract preservation, not AST-shape optimism.** Exact parser options, bidirectional differential admission, recovered-AST disposition, mixed-error precedence, Unicode span fixtures, and bounded nonclaims are all named ([Plan:451](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:451), [Plan:590](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:590), [Plan:616](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:616), [Plan:650](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:650)). Official [Oxc parser documentation](https://www.npmjs.com/package/oxc-parser) supports the assumed APIs and ESTree/TS-ESTree projection.

- **Rolldown feasibility is sound.** Its API supports explicit `rolldown()`/`generate()`/`close()`, in-memory IIFE output, controlled plugin resolution, disabled tree shaking/minification, comment and sourcemap controls, and plugin-context graph metadata. See the [Rolldown bundler API](https://rolldown.rs/apis/bundler-api), [resolver API](https://rolldown.rs/reference/Interface.ResolveIdExtraOptions), and [versioned v1.2.1 output-option source](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.1/packages/rolldown/src/options/output-options.ts). The Plan correctly keeps original-byte identity in Snapback’s own ledger rather than trusting transformed `ModuleInfo.code` ([Plan:1247](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1247)).

- **The size argument is reproducible and honest.** All aggregate and D-1 delta arithmetic is correct. Registry `dist.unpackedSize` values reproduced every unpacked total; the macOS esbuild compressed total also reproduced exactly. The basis distinguishes isolated component pricing from resolved headless/React closures and does not claim a size win under D-1b ([Plan:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239), [Plan:280](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:280)).

- **D-1 is treated correctly.** The Plan does not pretend a parser replaces the current symbol service, and it names the oracle, identity migration, ownership, fallback, and whole-artifact rollout obligations for D-1a ([Plan:304](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:304), [Plan:326](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:326), [Plan:361](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:361)).

## 3. Concerns

### 1. BLOCKING — The release state machine requires evidence before that evidence can exist

**Evidence checked:**

- The authoritative table makes LLP 0041’s prior-vector preflight an S3 entry condition and calls S3’s receipt the candidate ledger ([Plan:1544](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1544)).
- LLP 0041 requires candidate publication first, then registry re-download and candidate-ledger construction, then exact public cold installs ([LLP 0041:394](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394)).
- Its prior-default-closure preflight binds that candidate-ledger digest and must run immediately before lease issue/default-tag mutation ([LLP 0041:606](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:606)).
- The Plan’s own numbered flow puts registry re-download in S4, after S3 publication ([Plan:1307](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1307)), and its first-publish discussion likewise assumes the preflight observes publication afterward ([Plan:1553](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1553)).
- The Plan applies LLP 0041 to only “affected” or freeze-predicate packages ([Plan:1292](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1292)), while the cited protocol qualifies and promotes a complete nine-package vector from one clean SHA.
- Stale prose separately forbids candidate publication before the terminal proof ([Plan:1520](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1520)), says removal cannot precede public proof despite S2 doing exactly that ([Plan:1530](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1530)), and keeps default-tag promotion frozen until S6 even though S6 requires completed promotion ([Plan:1599](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1599)).
- S5 is still called “terminal,” and the only named Stage-4 gate emits S5, not S6 ([Plan:1317](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1317), [Plan:1351](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1351)).

**Resolution criterion:** Replace the release flow with one non-contradictory authority:

1. S2 qualifies the final package vector locally.
2. S3 publishes candidates and records a publication journal.
3. S4 re-downloads them, constructs the candidate ledger, and runs exact-version public proofs.
4. The fresh LLP 0041 prior-vector preflight and lease bind that completed ledger immediately before promotion.
5. S5 authorizes default-tag mutation.
6. S6 binds the post-promotion ledger and both final `latest` receipts.

All rollback, freeze, guard, numbered-stage, and completion prose must agree. A named executable S6 command must be required for Stage-4 and Plan completion. The document must also choose either the full nine-package vector required by LLP 0041 or a separately reviewed amendment defining partial-vector qualification, promotion, and rollback.

### 2. MATERIAL — S6 omits the actual served-capability authority

**Evidence checked:**

The S-table says S6 permits served capability ([Plan:1550](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1550)). But LLP 0041 says the post-promotion package lineage is only an input to the LLP 0111 capability carrier ([LLP 0041:594](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:594)). LLP 0111 additionally requires hidden served qualification, image/source/package binding, capability-publication CAS, and a post-CAS public observation with revocation on failure ([LLP 0111:1183](/Users/ccheever/projects/snapback/llp/0111-fly-completion-and-hosted-ephemeral.plan.md:1183), [LLP 0111:1210](/Users/ccheever/projects/snapback/llp/0111-fly-completion-and-hosted-ephemeral.plan.md:1210)). Passing every LLP 0140 row would leave all of that unproven.

**Resolution criterion:** Add LLP 0111 as a governor and reconciliation target. State that S6 makes the package closure eligible for an independently qualified LLP 0111 carrier; it never authorizes serving by itself. Either add the relevant qualification/CAS/observation command and receipt to this Plan or make an explicit handoff whose guard requires the valid LLP 0111 receipt before any served reference.

### 3. MATERIAL — D-1a omits the asset-intent lifecycle governed by LLP 0044

**Evidence checked:**

The Plan correctly identifies `snapback.asset-intent-implementation.v1` as a second identity carrier ([Plan:88](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:88)), but LLP 0044 is absent from Related and the documentation reconciliation list ([Plan:1336](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1336)). LLP 0044 says upload authorizers use the same inline graph and ties implementation identity to generated references, frozen per-intent policy generations, in-flight finalization, and stale-reference refusal before staging ([LLP 0044:225](/Users/ccheever/projects/snapback/llp/0044-asset-storage-pipeline.rfc.md:225), [LLP 0044:279](/Users/ccheever/projects/snapback/llp/0044-asset-storage-pipeline.rfc.md:279)). Hash equality or a generic identity-rotation disposition does not prove those lifecycle effects.

**Resolution criterion:** Add LLP 0044 as a governor. Under D-1a, require fixtures for an open attempt minted under the old generation, a stale generated upload reference, policy-generation bump/revocation behavior, rollback, and refusal timing. Under D-1b, byte-identical asset-intent identity is sufficient.

### 4. MINOR — `check-contract-meta.mjs` has no stated parser-error compatibility policy

**Evidence checked:**

The shared adapter refuses partial ASTs except under the handler policy ([Plan:408](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:408)), while the seven-row consumer matrix excludes the separately migrated contract-meta checker ([Plan:436](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:436), [Plan:1163](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1163)). Today that checker calls `ts.createSourceFile` and walks the recovered tree without consulting parse diagnostics ([check-contract-meta.mjs:14](/Users/ccheever/projects/snapback/scripts/check-contract-meta.mjs:14), [check-contract-meta.mjs:43](/Users/ccheever/projects/snapback/scripts/check-contract-meta.mjs:43)).

**Resolution criterion:** Give this consumer an explicit recovered-AST/error policy, malformed-source fixtures, and a Stage-1 gate command—or state that tightening malformed-input handling is an intentional, separately accepted behavior change.

### 5. MINOR — Three factual statements need correction

**Evidence checked:**

- The const-alias `getSymbolAtLocation` call cited as `inline-handlers.mjs:141` is actually at [inline-handlers.mjs:139](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:139); the general binding call is at `:412`.
- [Plan:770](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:770) says Rolldown `build()` has no close discipline, but the official [bundler API](https://rolldown.rs/apis/bundler-api) says it performs automatic cleanup.
- [Plan:590](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:590) says `OxcError` has no discriminant, although it has a severity discriminant; the intended and correct claim is that it has no stable **error-kind** code/class/discriminant.

**Resolution criterion:** Correct those three statements without changing the design.

## 4. Suggestions

- Cite LLP 0131 as an explicit D-1a consumer-census source; it enumerates `implementationHash` effects on deployment equality, React references, and client-store keys ([LLP 0131:577](/Users/ccheever/projects/snapback/llp/0131-structured-argument-contracts.spec.md:577)).
- In the attribute rewrite, say explicitly that `with` versus `assert` is recovered from authored tokens/source text rather than assumed to survive in normalized ESTree attributes.
- Add `LLP 0041#nine-package-candidate-promotion--2026-07-28` to constraint 7; that is the anchor owning the exact opposite-platform empty-edge rule.
- Keep the residual nonclaims at [Plan:650](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:650). They accurately state that a passing corpus still does not prove grammar equivalence outside the sources/generator, uncatchable native abort behavior, rapid-edit races, future-version behavior, unsupported tuples, raw-`npm publish` enforcement, or post-publication rollback effectiveness.

## 5. Open questions

1. Will S2–S6 qualify the full LLP 0041 nine-package vector, or is the author commissioning a partial-vector amendment?
2. Is S6 intended only as package-provenance eligibility for LLP 0111, or is LLP 0140 intended to own the full served-capability publication sequence?
3. Under D-1a, exactly what happens to open upload attempts, stale generated upload references, and policy generations created before canonical-AST rotation?
4. What executable command emits and validates S6, including the post-promotion ledger and both final `latest` receipts?
5. Which D-1 branch will be selected, and if D-1a fails its oracle, is D-1b the recorded fallback?
6. Is malformed contract-meta input intended to retain TypeScript’s recovered-tree behavior or become a deliberate new refusal?

## 6. Readiness verdict

The blocking release chronology must be rewritten before execution could begin safely. The LLP 0111 and LLP 0044 gaps are also material and must close before READY.

Blocking list:

- S3 requires the LLP 0041 candidate ledger and bound prior-vector preflight before candidate publication, although those artifacts can exist only after publication and registry verification; adjacent freeze, removal, vector-scope, and S5/S6 rules contradict the intended transition order.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

All five items confirmed; none refuted. Concern 1 is the **third consecutive
round** in which a restatement of LLP 0041's publication protocol contained a
chronology inversion — v0.11's S3 required a candidate ledger and prior-vector
preflight *before* candidate publication, while LLP 0041 creates that ledger
*after* publication and registry re-download. That pattern, not any single
sentence, is what v0.12 responds to: the Plan now **stops restating** LLP 0041's
machine and defers all sequencing to it, stating only the preconditions this
migration adds. LLP 0041 wins on ordering; this Plan's table wins only on its
own additional preconditions.

- **Concern 2** confirmed against `llp/0041:594` and LLP 0111's qualification /
  CAS / post-CAS-observation requirements: S6 was granting served capability
  that LLP 0111 independently governs. v0.12 makes S6 grant package-closure
  **eligibility**, and the served-capability guard clause now requires a valid
  LLP 0111 carrier receipt that this Plan neither produces nor claims.
- **Concern 3** confirmed: `snapback.asset-intent-implementation.v1` is tied by
  LLP 0044 to generated references, frozen policy generations, in-flight
  finalization, and stale-reference refusal — lifecycle effects a hash
  comparison cannot see. v0.12 adds the D-1a fixtures (attempt opened under the
  old generation and finalized after rotation, stale reference, generation bump
  and revocation, rollback, refusal timing) and adds LLP 0044 and LLP 0111 to
  `Related` and the reconciliation list.
- **Concern 4** confirmed and applied: `check-contract-meta.mjs` walks a
  recovered tree without consulting parse diagnostics, so Stage 1 now states its
  recovered-AST policy and fixtures malformed sources.
- **Concern 5's three corrections applied**, and one of them settles a
  disagreement *between* the two families: the Fable round-10 review reported
  `getSymbolAtLocation` at `:141`, Codex at `:139`. The orchestrator measured it:
  the const-alias call is at **`inline-handlers.mjs:139`** and the general
  binding call at `:412`. Codex is right; the v0.11 edit made on the Fable
  report is reverted.


## Round 12 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf80-0656-7f81-bfbc-84ec328b8ce3`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind; ran exact esbuild 0.28.1 probes including escape-equivalent attribute spellings; consulted Oxc error-recovery documentation
**Target SHA-256:** `5178835068933f6b4ec906dc8d6626e837e74f84fb6aa77af4151de942036f76`
**Instruction SHA-256:** `(round-12 capsule; adds the defer-to-LLP-0041 scope note)`
**Status:** completed

## Verbatim review

Target SHA-256: `5178835068933f6b4ec906dc8d6626e837e74f84fb6aa77af4151de942036f76` — **MATCHED** the expected hash.  
Date: 2026-08-01

Method: I read the complete 1,758-line target, LLP 0005, every cited governing section, every inventory-row source, the codegen bundler/evaluator/file-reader implementation, all Acorn and TypeScript scan paths, inline-handler identity code, package manifests, and the release gates. I ran binary-safe repository searches and an in-memory `esbuild@0.28.1` import-attribute probe, and consulted official Oxc and Rolldown documentation/source. I could not install and execute exact `rolldown@1.2.1` or `oxc-parser@0.142.0` because the workspace was read-only and shell package fetching was unavailable; their exact measured behaviors are therefore marked uncertain below. I did not open Snapback’s `llp/reviews/**` or any filename containing `super-refine`. One delegated broad search incidentally printed unrelated snippets from vendored Ibex review artifacts; they did not concern LLP 0140 or this migration and were excluded from the analysis. No files were edited.

## Overall assessment

The migration direction is sound, and most of this Plan is unusually well grounded. The first-party census is complete; the cited design constraints exist and generally say what the Plan claims; the parser and admission-plugin requirements cover the current implementation’s important behavior; the size accounting is honest; and the main Rolldown/Oxc architecture is feasible.

Three remaining defects cross the readiness bar:

- Import-attribute instance identity does not precisely preserve esbuild’s cooked-key/value equivalence.
- Stage 4’s named gate stops at S5 and does not specify executable producers/verifiers for S1, S2, and S6.
- The unrestricted diagnostic `message` waiver can admit a public-custody or diagnostic-quality regression while the gate reports success.

Consequently, executing only the named gates can still split currently shared module instances, leave the terminal package lineage incomplete, or accept an unsafe/degraded diagnostic message.

VERDICT: NOT READY

## Strengths

- **The inventory is complete and accurate.** A binary-safe census found exactly the seven direct esbuild execution surfaces represented by the table: codegen, browser-closure proof, cold-install proof template, Cloudflare identity, Cloudflare Miniflare assembly, and the two maintained-demo surfaces. Representative implementations are at [codegen:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736), [browser closure:14](/Users/ccheever/projects/snapback/packages/snapback-client/browser-closure.test.mjs:14), [cold install:2345](/Users/ccheever/projects/snapback/scripts/snapback-package-cold-install.mjs:2345), [Cloudflare identity:52](/Users/ccheever/projects/snapback/cloudflare/scripts/generate-deployment-identity.mjs:52), and [Cloudflare harness:123](/Users/ccheever/projects/snapback/cloudflare/test/harness.mjs:123).

- **The parser census is similarly complete.** Acorn occurs only in `packages/snapback-codegen/index.mjs`, at the six responsibilities enumerated in [LLP 0140:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204). TypeScript compiler-API use occurs only in codegen’s syntax scanner, `inline-handlers.mjs`, `check-contract-meta.mjs`, and `check-package-export-types.mjs`; the distinct Node `stripTypeScriptTypes` exception is correctly recorded at [exact-package.mjs:163](/Users/ccheever/projects/snapback/packages/snapback-contract/exact-package.mjs:163). No omitted first-party direct use was found.

- **The Plan catches non-obvious current behavior.** In particular, it correctly observes that TypeScript inputs currently reach three Acorn consumers through parse-failure fallbacks and that a successful Oxc TypeScript parse could therefore change admission or inference ([LLP 0140:434](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:434)). Stage 1 also names ordering, deduplication, conservative fallbacks, first-error behavior, and protected-query masking ([LLP 0140:1175](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1175)).

- **The proposed Rolldown plugin covers the current esbuild-hosted contract.** Exact-file resolution, no fallback, capability-aware reads, module-format manifests, the `node_modules` scope stop, separate schema/functions/routes graphs, transformed-functions-entry handling, diagnostics, facade serialization, evaluator denial, and authored-byte graph identity are all named at [LLP 0140:691](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:691). These correspond to the shipped resolver at [index.mjs:7698](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7698), its loader at [index.mjs:8174](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8174), and the file capability at [file-read-capability.mjs:23](/Users/ccheever/projects/snapback/packages/snapback-codegen/file-read-capability.mjs:23). I found no unnamed load-bearing esbuild behavior.

- **The governing anchors hold.** LLP 0010 requires structured diagnostics and complete generated-input identity ([LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:312), [LLP 0010:346](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:346)); LLP 0009 makes static inspection defense in depth rather than the capability boundary ([LLP 0009:788](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:788)); and LLP 0118 establishes the controlled-stock-bundler precedent ([LLP 0118:684](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:684)). The Plan also correctly flags LLP 0118’s stale package names.

- **The publication deferral is complete and honest.** LLP 0041 owns candidate publication, promotion, post-promotion lineage, and final `latest` receipts ([LLP 0041:394](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394), [LLP 0041:652](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:652)); LLP 0111 separately owns served qualification and capability publication ([LLP 0111:1192](/Users/ccheever/projects/snapback/llp/0111-fly-completion-and-hosted-ephemeral.plan.md:1192)). LLP 0140 correctly says S6 provides eligibility, not serving authority ([LLP 0140:1596](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1596)).

- **The main upstream feasibility assumptions hold.** Rolldown exposes programmatic bundling and explicit cleanup through `rolldown()` and `close()` ([Rolldown Bundler API](https://rolldown.rs/apis/bundler-api)); its output options cover IIFE format, code splitting, minification, comments, sourcemaps, and `polyfillRequire` ([Rolldown OutputOptions](https://rolldown.rs/reference/Interface.OutputOptions)); input options cover disabled tree shaking, `tsconfig`, platform, warning handling, and Oxc-backed transformation ([Rolldown InputOptions](https://rolldown.rs/reference/Interface.InputOptions)); and plugin graph metadata is available through `moduleParsed`, `getModuleIds`, and `getModuleInfo` ([Rolldown PluginContext](https://rolldown.rs/reference/Interface.PluginContext)). Oxc exposes JavaScript/TypeScript parsing and an ESTree-oriented Node projection suitable for a Snapback-owned adapter ([Oxc parser usage](https://oxc.rs/docs/guide/usage/parser), [`oxc-parser@0.142.0`](https://www.npmjs.com/package/oxc-parser/v/0.142.0)). The remaining Cloudflare inclusion/exclusion details are appropriately gated on a Stage-3 spike rather than assumed.

- **The size table is fit for a Plan.** It states exact versions, platform tuples, native bindings, compressed-byte and `dist.unpackedSize` definitions, measurement date, and receipt requirements ([LLP 0140:239](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:239)). All displayed totals and D-1 deltas are arithmetically correct. Registry unpacked metadata reproduced the totals. The conclusion—that D-1a reduces the isolated closure while D-1b increases it—is supported and is properly separated from resolved React/Vite-tree deduplication ([LLP 0140:280](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:280)).

- **The acceptance matrix is broad and candid about its limits.** A passing repaired matrix would establish fail-closed graph admission, evaluator denials, identity stability/sensitivity, diagnostic spans/order/custody, cross-host equality, Vite state behavior, Cloudflare identity, and package lineage over the frozen corpus ([LLP 0140:1387](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1387)). It correctly leaves unproven behavior outside the corpus/generator, future versions, unsupported hosts, process-fatal N-API aborts, rapid-edit races, post-publication rollback effectiveness, D-1a review quality, and all LLP 0111 served qualification ([LLP 0140:662](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:662), [LLP 0140:1596](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1596)). Those are appropriate residual nonclaims for a Plan.

## Concerns

### 1. BLOCKING — Import-attribute identity does not pin cooked-string equivalence

**Evidence checked:** The Plan defines runtime identity as `(real path, normalized attribute map)` and says a `with` map uses sorted keys with “values as authored” ([LLP 0140:919](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:919)). Its fixtures cover identical/distinct maps, presence, edge families, and `with` versus `assert`, but not lexically different spellings with the same cooked keys and values ([LLP 0140:963](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:963), [LLP 0140:1020](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1020)).

I ran exact `esbuild@0.28.1` with these imports:

```js
with { z: "a", x: "b" }
with { "x": "\u0062", "\u007a": "a" }
```

esbuild invoked resolution once, delivered `args.with` as cooked `{"x":"b","z":"a"}`, and emitted one shared module instance. A digest over raw authored lexemes would instead create two instances and duplicate side effects. If “as authored” was intended to mean cooked semantic strings, the wording is still ambiguous at a load-bearing identity boundary.

The exact Rolldown 1.2.1 collapse measurement was not independently runnable here, although its resolver API’s lack of attribute data supports the Plan’s underlying mechanism. That uncertainty does not affect the current-esbuild parity defect above.

**Resolution criterion:** State that normalization operates on decoded/cooked attribute key and value strings exactly matching esbuild’s `args.with` semantics, then sorts decoded keys and uses one pinned canonical serialization. Add fixtures for reordered keys, identifier-versus-string keys, escape-equivalent keys and values, and side-effect/module-instance equality.

### 2. BLOCKING — Stage 4 does not have a closed executable path through S6

**Evidence checked:** The Plan promises that every gate names an executable command and machine-readable manifest ([LLP 0140:1100](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1100)). Stage 4 narrates S1 through S6 ([LLP 0140:1320](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1320)), and the authoritative table assigns receipts to S1, S2, S5, and S6 ([LLP 0140:1571](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1571)).

But the only named Stage-4 gate command emits S5 ([LLP 0140:1378](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1378)). No producing/verifying command is specified for S1, S2, or S6, and the completion criteria do not explicitly require a validated S6 receipt ([LLP 0140:1747](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1747)). Thus all named gate commands can pass while the post-promotion lineage that grants eligibility remains absent.

This does not require restating LLP 0041’s chronology. The defect is only in LLP 0140’s additional receipts and terminal gate.

**Resolution criterion:** Name an executable producer/verifier—one orchestrator or closed per-transition commands—for S1, S2, S5, and S6; state their receipt inputs and predecessor validation; and make a valid, fact-matching S6 receipt an explicit prerequisite for Stage 4 and `Implemented`.

### 3. MATERIAL — The diagnostic-message waiver is unbounded

**Evidence checked:** Stage 2 permits any difference in the diagnostic `message` member as “presentation-only rendered text” ([LLP 0140:1251](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1251)). Current code incorporates upstream parser/bundler free text directly at [index.mjs:5101](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5101) and [index.mjs:7855](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7855).

LLP 0010 makes a concise message part of the diagnostic contract ([LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:312)). LLP 0108 forbids source paths, spans, dependency paths, and executable source in public custody ([LLP 0108:299](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:299), [LLP 0108:590](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:590)). As written, the compatibility report could waive an empty, misleading, unbounded, or path/source-leaking public message while every non-message field remains equal.

**Resolution criterion:** Bound the waiver to prose differences that remain nonempty, concise/bounded, sanitized under the public projection, free of private paths/source/secrets, and semantically consistent with the stable code/remediation. Retain old/new message text in the report and add a negative public-custody fixture.

### 4. MINOR — Oxc is not “always” fully recoverable

**Evidence checked:** The Plan says Oxc “always recover[s], always return[s] the full program” ([LLP 0140:518](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:518)). Oxc’s own parser documentation explicitly describes it as **partially recoverable**, contrasting that with a parser able to construct a complete AST for arbitrary malformed input ([Oxc error-recovery documentation](https://oxc.rs/docs/learn/parser_in_rust/errors.html)).

The surrounding fatal-unmatched policy prevents this wording error from creating an obvious fail-open path, so it is minor.

**Resolution criterion:** Say that the N-API returns a program projection for the explicitly probed recoverable cases, while recovery may be incomplete; only categorized, fixtured cases may consume a recovered AST, and every other error remains fatal.

### 5. MINOR — D-1b does not remove all inline-handler admission risk

**Evidence checked:** D-1b is described as having “No inline-handler admission risk,” followed by an acknowledgment that all six Acorn scanners still move ([LLP 0140:319](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:319)). Rendered inline-operation bytes are rescanned through the Acorn-backed unsupported-source scanner at [index.mjs:1192](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:1192), and asset authorizers are rescanned at [index.mjs:2341](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:2341). That scanner moves under both branches.

The Stage-1 gates cover this risk, so this is an overstatement rather than a missing gate.

**Resolution criterion:** Replace the claim with “no D-1-specific extractor/binding-resolver or canonical-AST migration risk,” while stating that the post-splice Oxc rescan remains an inline-handler admission/diagnostic risk under both branches.

### 6. MINOR — Release narration still disagrees with the authoritative table

**Evidence checked:** The rollback prose first says no publication may occur before terminal post-removal proof, then correctly explains that candidate publication must precede registry proof ([LLP 0140:1547](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1547)). More importantly, the freeze narration says default-tag promotion remains frozen until S6 ([LLP 0140:1654](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1654)), while the authoritative guard correctly permits beginning promotion with S5 and absent S6 ([LLP 0140:1640](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1640)). S5 is also still called “terminal” at [LLP 0140:1676](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1676).

Because the Plan explicitly says the table wins, this is not a second blocking chronology defect.

**Resolution criterion:** Make all narration use the table’s permissions: S2 permits candidate-machine entry, S5 permits promotion begin, S6 grants package-closure eligibility, and S6—not S5—is the terminal LLP 0140 receipt.

## Suggestions

- Cite `LLP 0041#nine-package-candidate-promotion--2026-07-28` directly in governing constraint 7; that is the precise source of the opposite-platform empty-edge rule, rather than the broader runtime-distribution/acceptance anchors.

- Restore LLP 0041’s conditional wording for first publication: “**if** npm establishes `latest` for a new name,” rather than asserting categorically that every first publish does so ([LLP 0041:401](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:401)).

- Turn the import-attribute oracle into a partition test: generate semantically equivalent and inequivalent maps, ask esbuild which sites share one resolver/load/module instance, and require the candidate to reproduce the same equivalence classes. This is stronger and less error-prone than hand-maintaining individual equality fixtures.

- Preserve executable probe scripts and raw outputs for the exact Oxc error table, UTF-16 offset observation, and Rolldown attribute behavior in the Stage-0 receipt. The exact `oxc-parser@0.142.0` table and exact `rolldown@1.2.1` behavior remain uncertain in this review because those binaries could not be run here; official API documentation makes them plausible, not empirically re-proven.

- Explicitly name the current authorized root pair and both outbound-action profiles in the per-consumer matrix. Existing gates appear capable of proving them; this would reduce implementation ambiguity.

## Open questions

1. Does “values as authored” mean raw lexical spelling or decoded/cooked strings? Which exact canonical serialization is authoritative?

2. What exact command or wrapper produces and validates each of S1, S2, S5, and S6, and which command is the terminal Stage-4 gate?

3. Which invariants remain non-waivable inside `diagnostic.message`, particularly public source/path hygiene and remediation meaning?

4. Is “full program” intended only to describe the return shape of the tested N-API cases, or is the Plan assuming complete recovery for arbitrary malformed input?

5. Which D-1 branch will the author select? The unresolved choice is not itself a review defect, but it must be recorded before Stage 1 as the Plan says.

## Readiness verdict

VERDICT: NOT READY

Blocking list:

- Define and fixture cooked import-attribute equivalence.
- Close the executable S1→S6 receipt path and require S6 for completion.
- Bound the diagnostic-message waiver so diagnostic quality and public custody cannot regress under an approved disposition.

The remaining findings are non-blocking corrections.
## Orchestrator verification (outside the verbatim body)

All six items confirmed; none refuted.

- **Concern 1 is a genuinely new finding at a load-bearing boundary.** v0.12's
  normalization said `with` maps use "keys sorted, values as authored", and
  "as authored" is ambiguous: measured, `with { z: "a", x: "b" }` and
  `with { "x": "b", "z": "a" }` reach esbuild as the **same** cooked
  map and share one module instance, so a digest over raw lexemes would mint two
  instances and duplicate side effects. v0.13 pins normalization to **cooked**
  keys and values matching `args.with` semantics, with one canonical
  serialization and four new equivalence fixtures.
- **Concern 2** is the same defect the Fable family scored MINOR in the same
  round (its C3): only S5 had a named producing command, so every named gate
  could pass with the post-promotion lineage absent. v0.13 names
  `run-0140-corpus.mjs --stage 4 --state <s1|s2|s5|s6>` and `--verify <state>`
  with predecessor validation, and makes a valid, fact-matching S6 receipt an
  explicit prerequisite for Stage 4 completion and for `Implemented`.
- **Concerns 3–6 confirmed and applied**: the `message` waiver is now bounded
  (non-empty, concise, sanitized under the public projection, no path/source/
  secret leakage, with a negative public-custody fixture); the "always recover"
  claim is corrected to Oxc's documented *partial* recovery, which the design
  never needed; D-1b's "no inline-handler admission risk" is narrowed to "no
  D-1-specific extractor/binding-resolver/canonical-AST migration risk", since
  the post-splice Acorn rescan (`index.mjs:1192`, `:2341`) moves under both
  branches; and the release narration now uses the table's permissions
  throughout, with S6 rather than S5 called terminal.


## Round 13 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbf97-5323-7491-bcfb-63d963a272a8`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Target SHA-256:** `291a9afdd33375678d6ca67eff604327b31ca29d54e474e398ac164042d08613`
**Status:** completed

## Verbatim review

Target SHA-256: `291a9afdd33375678d6ca67eff604327b31ca29d54e474e398ac164042d08613` — **MATCH**

Review date: 2026-08-01

Method: I reviewed the complete target on disk, opened every file named in its inventory, performed binary-safe searches for direct first-party esbuild, Acorn, and TypeScript compiler-API authority, traced the current codegen scanners and esbuild bundler path, checked every cited governing LLP anchor, recalculated the size tables, inspected installed package contents, and ran read-only probes against exact `rolldown@1.2.1` and `esbuild@0.28.1`. I also checked official Rolldown/Oxc documentation. I did not read anything under `llp/reviews/`, did not read any filename containing `super-refine`, and made no edits. Exact standalone `oxc-parser@0.142.0` was not installed and shell network resolution was unavailable, so I could not execute that package itself; Rolldown’s bundled Oxc parser corroborated the stated parser-error table and offset behavior, but that is not a literal standalone-package reproduction. Compressed tarball cells and the Linux/Oxc unpacked cells could not be independently fetched; macOS installed-file totals and all arithmetic were verified.

## 1. Overall assessment

The migration design is technically strong. The inventory is complete, the governing constraints are correctly sourced, the proposed parser and bundler boundaries cover the current implementation, both D-1 branches are coherent, the upstream capabilities exist, and the acceptance corpus is unusually serious about security, identity, diagnostics, and native-platform variance.

Two material release-state defects remain. First, S2/S3 can be read as qualifying only migration-affected or freeze-predicate packages, while the LLP 0041 protocol it invokes requires a complete nine-package vector. Second, the mechanically stated S5 verifier lineage does not clearly require or bind the S4 public-registry semantic run it claims to authorize. Executing the Plan literally could therefore enter the publication machine with the wrong package set or authorize promotion without a receipt proving the published closure’s cross-tuple semantics.

VERDICT: NOT READY

## 2. Strengths

- The census is complete and accurate. I found no omitted direct first-party esbuild, Acorn, or TypeScript compiler-API use. The binary-safe scope and exceptional recognizers are well specified at [llp/0140-vite-rolldown-oxc-convergence.plan.md:143](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:143) and [llp/0140-vite-rolldown-oxc-convergence.plan.md:168](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:168); every row beginning at [llp/0140-vite-rolldown-oxc-convergence.plan.md:188](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:188) matches its source. The six Acorn call sites are exactly the six responsibilities enumerated at [llp/0140-vite-rolldown-oxc-convergence.plan.md:204](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:204), and the seventh syntax-only TypeScript scan is correctly separated from the real symbol services.

- The governing constraints are correctly anchored. In particular, static inspection versus runtime authority is supported by [llp/0009-code-execution-security.rfc.md:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774); closed graph, diagnostic, and custody requirements by [llp/0010-agent-dx-and-acceptance.spec.md:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330) and [llp/0010-agent-dx-and-acceptance.spec.md:819](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:819); Vite state behavior by [llp/0030-managed-snapback-vite-dev.rfc.md:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603); identity freshness by [llp/0049-all-aboard-cloudflare-live.plan.md:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997); and inline-handler identity by [llp/0108-inline-handlers-and-result-contracts.spec.md:855](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:855). The Plan also correctly identifies, rather than silently inheriting, the relative/file-only discrepancy at [llp/0140-vite-rolldown-oxc-convergence.plan.md:126](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:126).

- The proposed codegen boundary covers the load-bearing behavior of the current esbuild path at [packages/snapback-codegen/index.mjs:7679](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7679): controlled reads, exact-file resolution, allowlisted bare imports, module-format manifests, separate graphs, authored-versus-transformed identity, IIFE/banner construction, and diagnostic projection. The admission-plugin requirements at [llp/0140-vite-rolldown-oxc-convergence.plan.md:700](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:700) and pinned option manifest at [llp/0140-vite-rolldown-oxc-convergence.plan.md:751](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:751) are complete enough for a Plan.

- Upstream feasibility checks passed. Exact Rolldown probes confirmed in-memory `generate()`, one-IIFE output, controlled resolver/loader hooks, disabled tree shaking/code splitting/comments/sourcemaps, ES2022 and TypeScript lowering without type checking, plugin-context graph metadata, and the documented close lifecycle. The import-attribute divergence and cooked-string normalization at [llp/0140-vite-rolldown-oxc-convergence.plan.md:905](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:905) were reproduced. These capabilities agree with the official [Rolldown plugin API](https://rolldown.rs/apis/plugin-api), [PluginContext reference](https://rolldown.rs/reference/Interface.PluginContext), and [Oxc parser documentation](https://www.npmjs.com/package/oxc-parser).

- The baseline size basis is sufficiently precise for reproduction: exact versions, package sets, platform bindings, measurement date, metric definitions, and a Stage-0 per-package integrity receipt are named at [llp/0140-vite-rolldown-oxc-convergence.plan.md:241](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:241). Every total and D-1 delta is arithmetically correct. The conclusion is also honest: Rolldown is larger than esbuild in isolation, the migration shrinks the component set only under D-1a, and resolved application closures must be measured separately at [llp/0140-vite-rolldown-oxc-convergence.plan.md:280](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:280).

- Apart from the terminal-release defects below, the acceptance matrix would establish the security, identity, and diagnostic contracts over the declared corpus and supported tuples. It covers dual detection, precedence, authored spans, diagnostic custody, evaluator isolation, identity sensitivity, Vite failure states, browser closure, and cross-tuple semantic equality beginning at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1410](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1410). A passing run would still not prove universal grammar equivalence beyond the corpus ([llp/0140-vite-rolldown-oxc-convergence.plan.md:1451](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1451)), musl or other unsupported tuples ([llp/0140-vite-rolldown-oxc-convergence.plan.md:256](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:256)), later tool versions without rerunning evidence ([llp/0140-vite-rolldown-oxc-convergence.plan.md:1545](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1545)), LLP 0111 served qualification ([llp/0140-vite-rolldown-oxc-convergence.plan.md:1629](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1629)), or raw `npm publish` bypass ([llp/0140-vite-rolldown-oxc-convergence.plan.md:1655](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1655). Those residuals are disclosed rather than silently claimed away.

## 3. Concerns

### MATERIAL — S2/S3 does not unambiguously supply LLP 0041’s complete nine-package vector

Evidence checked: LLP 0041 requires one clean SHA to produce all nine tarballs at [llp/0041-packaged-dev-loop.rfc.md:396](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:396), publishes all nine at [llp/0041-packaged-dev-loop.rfc.md:401](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:401), and binds the complete nine-package vector into publication authority at [llp/0041-packaged-dev-loop.rfc.md:667](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:667).

LLP 0140 instead tells S1/S2 to pack and qualify every “affected” package at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1337](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1337) and [llp/0140-vite-rolldown-oxc-convergence.plan.md:1347](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1347), then hands “exactly” those tarballs to LLP 0041 at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1352](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1352). The authoritative table further describes entering that machine “for freeze-predicate packages” at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1597](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1597), while the predicate expressly excludes at least one of the nine at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1697](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1697). That is a subset/full-vector mismatch, not merely omitted implementation detail.

Resolution criterion: state explicitly that S1 and S2 qualify, and S3 hands off, the complete current nine-package vector required by LLP 0041, while only the derived predicate subset is frozen before S3. If subset publication is actually intended, LLP 0041 must first define a complete subset-release protocol that preserves its vector, rollback, and lease invariants.

### MATERIAL — S5’s named verifier lineage can pass without proving S4

Evidence checked: S4 performs public-registry re-download, clean installs, and the published-closure cross-tuple corpus at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1359](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1359); S5 is said to bind that run at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1363](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1363). But the mechanical verifier lineage says only that S5 requires S2 and the LLP 0041 candidate-ledger digest at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1602](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1602). Its field list names unqualified “platform-receipt digests” and case maps only for Stages 0–3 at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1709](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1709).

S2 already has two platform receipts, while LLP 0041’s candidate ledger precedes its public cold installs ([llp/0041-packaged-dev-loop.rfc.md:407](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:407), [llp/0041-packaged-dev-loop.rfc.md:411](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:411)). Therefore S2 plus the candidate ledger does not establish S4’s semantic run. The producer is also spelled inconsistently as `--post-removal` at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1399](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1399) and `--state s5` at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1603](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1603).

Resolution criterion: explicitly define S5 as S4’s terminal receipt and specify that its producer executes S4. S5 must bind—and `--verify s5` must reopen and validate—the two S4 public-registry platform receipts, exact S4 case map and zero-skip result, per-domain projected output digests, and cross-tuple equality. State whether `--post-removal` is an alias for `--state s5`. Alternatively, create an explicit S4 receipt and make S5 bind it.

## 4. Suggestions

- Clarify whether the Stage-0 authority ledger deliberately excludes already-retained first-party Vite/Rollup hooks. The declared scope at [llp/0140-vite-rolldown-oxc-convergence.plan.md:158](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:158) supports excluding them, but the broader future-authority wording at [llp/0140-vite-rolldown-oxc-convergence.plan.md:1125](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1125) could be read otherwise. Classifying retained hooks would remove the ambiguity.

- Preserve the exact standalone `oxc-parser@0.142.0` probe source and output in the Stage-0 receipt, especially for error recovery and UTF-16 offsets. My bundled-Oxc corroboration was strong, but the Plan’s stated measured fact should remain tied to the exact public package.

- Add a compact “terminal proof boundary” list beside S6 enumerating the explicit nonclaims already distributed through the document: unsupported platforms, corpus-bounded grammar coverage, raw-publish bypass, and separate LLP 0111 serving qualification.

## 5. Open questions

1. Does S2 qualify the full LLP 0041 nine-package release vector, or only the freeze-predicate subset?
2. Is `0140-s5.json` intended to be S4’s terminal execution receipt? If so, which exact S4 artifacts and equality results does it bind and revalidate?
3. Which Stage-4 producer command is normative: `--post-removal`, `--state s5`, or a documented alias relationship?
4. Should retained first-party Vite/Rollup hooks appear as classified authority in the Stage-0 ledger?
5. Which D-1 branch will the author choose before Stage 1? The open choice is not itself a readiness defect, but its recorded answer remains an execution prerequisite.

## 6. Readiness verdict

**NOT READY.**

Readiness blockers:

1. Reconcile S1/S2/S3 with LLP 0041’s mandatory complete nine-package vector.
2. Make S5 mechanically prove and revalidate the S4 public-registry cross-tuple semantic run.

I found no other unresolved material correctness, inventory, feasibility, security, identity, diagnostic, size, or D-1 coherence defect.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

Both items confirmed; neither refuted. This review's own summary — "I found no
other unresolved material correctness, inventory, feasibility, security,
identity, diagnostic, size, or D-1 coherence defect" — matches the Fable
family's independent READY on the same revision, leaving only these two.

- **Item 1 confirmed** against `llp/0041:396,401,667`: LLP 0041 requires one
  clean source SHA to produce **all nine** tarballs, publishes all nine, and
  binds the complete vector into publication authority — while v0.13 packed
  "every affected package" and entered the machine "for freeze-predicate
  packages", a predicate that deliberately excludes at least one of the nine
  (`@expo/snapback-client`). Subset versus vector, not an omitted detail. v0.14
  states that S1/S2 qualify and S3 hands off the **complete nine-package
  vector** while only the predicate subset is frozen before S3, and records that
  a subset release would need LLP 0041 to define a subset protocol first.
- **Item 2 confirmed**: LLP 0041's candidate ledger precedes its public cold
  installs (`:407`, `:411`), so "S2 plus the candidate ledger" could never
  establish S4's published-closure semantic run that S5 claims to authorize.
  v0.14 makes **S5 the terminal receipt for S4**: its producer executes S4, and
  it binds — and `--verify s5` reopens — S4's two public-registry platform
  receipts, its case map and zero-skip result, the per-domain projected digests,
  and cross-tuple equality. The `--post-removal` spelling is retired rather than
  aliased.


## Round 14 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbfaa-bc12-76a2-96d4-8ad53391c690`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Target SHA-256:** `c67eccc9279e4eeb1878c3cb7567e13c3fe1ef4d89b31657b1213056db694734`
**Status:** completed

## Verbatim review

Target SHA-256 computed: `c67eccc9279e4eeb1878c3cb7567e13c3fe1ef4d89b31657b1213056db694734`  
Expected SHA-256: `c67eccc9279e4eeb1878c3cb7567e13c3fe1ef4d89b31657b1213056db694734`  
Hash status: **MATCH**  
Date: 2026-08-01

Method: I read the target in full; opened every file named by the inventory plus delegated codegen components; performed a binary-safe repository census of first-party esbuild, Acorn, TypeScript compiler-API, and `stripTypeScriptTypes` uses; checked the cited governing LLP sections and the LLP 0041/0111 publication handoff; audited the size arithmetic, stages, acceptance matrix, receipts, and rollback machine; inspected official upstream documentation and exact package sources; and executed locally installed `esbuild@0.28.1` and `rolldown@1.2.1` probes. I could not install or execute `oxc-parser@0.142.0` because the native package is absent and this environment is read-only, so the exact parser error-count table and runtime offset example remain independently uncertain, though the package’s documented AST/options contract supports the design. I also did not independently redownload the registry artifacts behind every size cell. I did not open or read review artifacts or any file whose name contains `super-refine`. I made no edits.

## 1. Overall assessment

This is an unusually thorough migration Plan. The repository census is complete, the existing codegen behaviors are enumerated faithfully, D-1 is coherent under both branches, the upstream architecture is feasible, and the acceptance matrix tests the right security, identity, diagnostic, and cross-platform contracts.

It is nevertheless not ready. Executing it literally can land the Stage-1 native parser before the publication guard that supposedly freezes that state. A second, stale rollback passage contradicts the authoritative S2→S5 transition chronology. The table’s precedence rule makes the latter recoverable, but neither defect meets the stated “no flaws” readiness bar.

VERDICT: NOT READY

## 2. Strengths

- The inventory is accurate and complete. The Plan explicitly anticipates the NUL-containing scanner file and requires a binary-safe ledger rather than trusting ordinary recursive search ([0140:141](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:141), [0140:158](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:158)). My independent census found exactly the seven first-party esbuild execution surfaces listed, Acorn only in codegen, and TypeScript compiler APIs only in the classified files.

- The current scanner and bundler responsibilities are captured precisely. The six Acorn consumers and the separate TypeScript unsupported-source scanner are enumerable from the implementation, while the admission-plugin section covers descriptor-attested reads, exact-file resolution, graph separation, authored-byte identity, loader rules, and diagnostic projection ([0140:208](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:208), [0140:704](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:704), [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736)).

- The governing anchors exist and support the claims. In particular, the Plan correctly carries forward capability closure, generated-artifact identity, diagnostic custody, Vite failure states, the nine-package publication protocol, and LLP 0111’s separate served-capability qualification ([LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774), [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330), [LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603), [LLP 0041:371](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:371), [LLP 0111:1183](/Users/ccheever/projects/snapback/llp/0111-fly-completion-and-hosted-ephemeral.plan.md:1183)).

- D-1 is honestly scoped and executable under either outcome. D-1a has an oracle, identity migration, lifecycle handling, and rollback rule; D-1b retains TypeScript as a declared shipped-closure exception while still allowing the shared parser migration ([0140:308](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:308), [0140:335](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:335), [0140:372](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:372)).

- The upstream assumptions hold. Rolldown supports explicit in-memory generation, IIFE output, disabled code splitting and tree shaking, output comments/sourcemaps controls, plugin-owned resolution, and graph metadata. Its documented `resolveId` fallthrough makes the Plan’s “resolve or refuse, never `null`” rule necessary. [Rolldown’s exact option source](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.1/packages/rolldown/src/options/output-options.ts), [tree-shaking reference](https://rolldown.rs/reference/InputOptions.treeshake), and [resolver reference](https://rolldown.rs/reference/Interface.Plugin) support these facts. My local 1.2.1 probe produced one in-memory IIFE chunk, lowered TypeScript without type checking, preserved an unused declaration with the pinned options, emitted no source map or region marker, and exposed `moduleIds`/`modules`.

- I independently reproduced the import-attribute incompatibility: esbuild invoked resolve/load twice, delivered `{"type":"json"}` versus `{}`, and evaluated `a === b` as false; Rolldown invoked resolution once and evaluated it as true. The pre-resolution synthetic-instance rewrite therefore addresses a real semantic discrepancy rather than a hypothetical one ([0140:909](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:909), [0140:951](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:951)).

- `oxc-parser@0.142.0` documents ESTree-compatible JavaScript, TS-ESTree-style TypeScript, `preserveParens: true` by default, and optional semantic errors. That validates the need for the pinned adapter and normalization layer, even though I could not execute the exact measured rows. [oxc-parser package documentation](https://www.npmjs.com/package/oxc-parser).

- The baseline size arithmetic is correct, and the measurement basis is sufficiently precise to reproduce: exact versions, raw tarball bytes, registry unpacked size, tuple, and Stage-0 integrity receipts are named ([0140:243](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:243), [0140:291](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:291), [0140:1171](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1171)). The D-1a/D-1b conclusions follow from the shown numbers without treating isolated package sums as resolved-application closure results.

- Passing the acceptance matrix would provide strong bounded evidence for security, diagnostic envelopes and custody, authored spans, graph/value identity, evaluator confinement, Vite failure states, native-package selection, and cross-tuple semantic equality ([0140:1485](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1485), [0140:1494](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1494), [0140:1502](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1502), [0140:1553](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1553)).

- The Plan clearly names what a passing run still would not prove: grammar equivalence beyond the corpus/generator, future-version behavior, unsupported tuples, an uncatchable native abort, rapid-edit races, post-publication rollback effectiveness, raw `npm publish` prevention, or LLP 0111 served qualification ([0140:675](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:675), [0140:1654](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1654), [0140:1680](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1680)). These are honest bounded nonclaims.

## 3. Concerns

### 1. BLOCKING — Stage 1 can trigger the freeze before its executable guard exists

**Evidence checked:** Stage 1 introduces the Oxc native binding, declares the landing unconditionally repository-only, and says the native-parser predicate blocks publication independently of Rolldown ([0140:1226](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1226), [0140:1237](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1237)). The authoritative predicate likewise begins at the first native-binding landing and includes a Stage-1-only refusal fixture ([0140:1684](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1684), [0140:1709](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1709), [0140:1721](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1721)).

But the only installation deadline says the guard lands before or atomically with the **Stage-2** production switch ([0140:1675](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1675)). The current authority script contains no pre-existing ledger publication guard ([check-toolchain-authority.mjs:71](/Users/ccheever/projects/snapback/scripts/check-toolchain-authority.mjs:71)). Executing the Plan literally therefore leaves the Stage-1-only window protected by prose rather than machinery. Line 1230 additionally says the guard engages only when Rolldown is the bundler, contradicting both the immediately following paragraph and the authoritative predicate.

**Resolution criterion:** Require the guard and its bidirectional Stage-1-only fixture to land before or atomically with the first commit satisfying the freeze predicate—normally Stage 1. Bind the guard/fixture result into the Stage-1 gate and receipt, change the deadline at line 1677 from “Stage-2 production switch” to “first freeze-predicate landing,” and correct or remove line 1230.

### 2. MATERIAL — rollback prose contradicts the authoritative S2→S5 chronology

**Evidence checked:** The rollback narrative says no package publication may precede the “Stage-4 terminal post-removal proof,” then argues that a post-removal-receipt publication gate would deadlock because removal cannot precede public proof ([0140:1593](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1593), [0140:1598](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1598)).

The actual design does the opposite: S2 removes esbuild and qualifies final tarballs locally; S3 publishes the candidate; S4 proves the public closure; S5 emits the terminal public-proof receipt ([0140:1357](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1357), [0140:1376](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1376), [0140:1615](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1615)). The table declares itself authoritative, so execution can recover, but the preceding explanation describes precisely the deadlock the table avoids.

**Resolution criterion:** Rewrite lines 1593–1605 to distinguish S2’s local post-removal qualification from S5’s public proof: candidate publication is permitted after a valid, fact-matching S2 receipt; promotion waits for S5; eligibility waits for S6; serving additionally waits for LLP 0111.

### 3. MINOR — two implementation citations are imprecise

**Evidence checked:** The asset-intent discussion cites `index.mjs:2384-2392`, which shows `canonicalAst` entering the identity object, but the actual hash is produced at `index.mjs:2403` ([0140:89](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:89), [index.mjs:2403](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:2403)). The export-type inventory row cites line 176 for fixture compilation, while the actual `tsc` invocation is lines 192–200 ([0140:198](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:198), [check-package-export-types.mjs:192](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:192)).

**Resolution criterion:** Extend the first citation through line 2403 and cite lines 192–200 for the second. The underlying factual claims are correct.

## 4. Suggestions

- Make the permission state machine a small declarative manifest from which the table, guard fixtures, and repeated permission summaries are generated or linted. The recurring failure mode here is prose drifting from one authoritative chronology.

- Put the required `--state s6` command directly in the Stage-4 gate paragraph. The later text correctly makes S6 mandatory, but the prominent gate currently names only S5 ([0140:1417](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1417), [0140:1633](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1633)).

- Retain exact-version probe transcripts as Stage-0 evidence, especially for the Oxc error table and UTF-16 offset probe: package integrity, input, complete options, diagnostics, AST projection, and output. That would make measured prose independently auditable without requiring a compatible native package during every review.

- Correct “Handing off and let its protocol run” to “Hand off and let its protocol run” at line 1371.

## 5. Open questions

1. Which exact landing installs the publication guard: Stage 0, or atomically with Stage 1? The answer must leave no commit satisfying the freeze predicate without enforcement.

2. What does “terminal post-removal proof” at line 1596 intend to name—S2 local qualification or S5 public proof? The surrounding permissions must use the state names rather than that ambiguous phrase.

3. Should the Stage-4 gate explicitly execute and verify both S5 and S6, or should a single terminal command produce the complete lineage?

4. Which D-1 branch will be selected before Stage 1? This remains a legitimate gated author decision, not a present readiness defect.

5. Will the exact Oxc measurements be committed as a reproducible probe transcript or only represented indirectly by later corpus receipts?

## 6. Readiness verdict

**Readiness verdict: NOT READY.**

Blocking list:

1. The Stage-1 native-binding freeze can begin before the Plan requires its executable publication guard to exist.

The material S2/S5 rollback chronology contradiction must also be corrected before READY; it is not optional polish under the stated readiness bar.
## Orchestrator verification (outside the verbatim body)

Both substantive items confirmed; neither refuted.

- **Concern 1 confirmed.** v0.14 moved the freeze's *start* to the first
  native-binding landing (normally Stage 1) but left the guard's *installation
  deadline* at the Stage-2 production switch, so the Stage-1-only window was
  protected by prose after all — and `scripts/check-toolchain-authority.mjs`
  contains no such guard today. v0.15 moves the deadline to "before or
  atomically with the first commit that satisfies the freeze predicate", binds
  the guard-and-fixture result into the Stage-1 gate and receipt, and deletes
  the contradictory "the guard only engages when the definition bundler is
  Rolldown" clause.
- **Concern 2 confirmed.** The rollback narration still described the deadlock
  the S-table was rewritten to avoid. v0.15 rewrites it to separate S2's
  **local** post-removal qualification from S4's **public** proof, and states
  each permission with its own precondition: candidate publication after a valid
  S2 receipt, promotion at S5, eligibility at S6, serving additionally behind
  LLP 0111.
- **Concern 3's two citations corrected** (`index.mjs:2384-2403` for the
  asset-intent hash; `check-package-export-types.mjs:192-200` for the `tsc`
  fixture compilation).


## Round 15 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbfbd-f68e-7290-a2de-75ad824f0210`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Target SHA-256:** `6c9b33ede9827fa0b1b6066475dedf57bae6969091c32e928347164b440601b4`
**Status:** completed

## Verbatim review

Computed target SHA-256: `6c9b33ede9827fa0b1b6066475dedf57bae6969091c32e928347164b440601b4`  
Expected SHA-256: `6c9b33ede9827fa0b1b6066475dedf57bae6969091c32e928347164b440601b4`  
Hash status: **MATCH**  
Review date: **2026-08-01**

Method note: I read LLP 0140 in full; opened every file represented in its first-party inventory; audited the codegen parser, bundler, loader, identity, and inline-handler paths; ran a binary-safe census for direct esbuild, Acorn, and TypeScript compiler-API authority; checked the cited governing LLP sections, release state machines, acceptance matrix, and arithmetic; and checked official Rolldown, Oxc, esbuild, and exact-version source documentation. The read-only environment had neither exact package installed and would not permit installation, so I could not execute `oxc-parser@0.142.0` or `rolldown@1.2.1`, independently reproduce the two measured probes, or re-fetch every binary tarball used in the size cells; I therefore treat those exact empirical results as unconfirmed, while distinguishing them from the API facts that official sources corroborate. I did not intentionally open any review artifact or any filename containing `super-refine`. One delegated broad search used an insufficient exclusion glob and accidentally surfaced one unrelated line from `vendor/ibex/llp/reviews/0026-esm-module-runner.fable.md`, concerning import-phase schema space; I discarded that delegated upstream audit in full, do not use that line or its topic as a finding, and relied only on my independent official-source checks below. No repository files were edited.

## Overall assessment

The migration direction is sound, the census is complete, the governing constraints are correctly understood, D-1 is coherent under either branch, and the Plan’s parser/bundler and compatibility analysis is unusually strong. The size arithmetic and conditional conclusions are also correct.

It is nevertheless not ready. Executing the Plan literally can silently lose a current case-insensitive admission behavior; its release section contains two contradictory safety rules; its final tarballs escape the package inspection applied to the earlier closure; and Stage 0 lacks the aggregate producer/verifier its later lineage assumes. Those are execution-contract defects, not requests for implementation detail.

VERDICT: NOT READY

## Strengths

- The inventory is accurate and complete. The production codegen imports and uses all three authorities as described ([index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736)); the inline-handler path genuinely creates a TypeScript `Program` and `TypeChecker` ([inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494)); and the export checker is genuinely type-semantic ([check-package-export-types.mjs:77](/Users/ccheever/projects/snapback/scripts/check-package-export-types.mjs:77)). I found exactly the six Acorn calls enumerated by the Plan and no omitted first-party direct esbuild, Acorn, or TypeScript compiler-API authority ([LLP 0140:192](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:192), [LLP 0140:208](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:208)).

- The governing anchors exist and support the claimed constraints: structured diagnostics and no silent drops ([LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:312), [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330)); static analysis as defense in depth rather than the capability boundary ([LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774)); loud codegen failure and no silent stale output ([LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603)); nine-package promotion ([LLP 0041:371](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:371)); and deployment-identity freshness and self-exclusion ([LLP 0049:997](/Users/ccheever/projects/snapback/llp/0049-all-aboard-cloudflare-live.plan.md:997)). The Plan also correctly identifies the existing LLP 0010 and LLP 0118 textual drift rather than relying on it silently ([LLP 0140:126](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:126), [LLP 0140:1405](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1405)).

- D-1 is honestly bifurcated. D-1a names the real symbol-service behavior, behavioral oracle, identity rotation, asset-intent lifecycle, and security ownership; D-1b retains TypeScript while still gating the post-splice scanner migration ([LLP 0140:308](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:308), [LLP 0140:335](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:335), [LLP 0140:345](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:345)). Leaving the author’s branch decision open is not a defect.

- The baseline basis is reproducible in principle: exact package sets and versions, platform tuples, measurement date, tarball-length definition, registry unpacked-size definition, and promised per-package integrity rows are stated ([LLP 0140:245](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:245)). Every displayed total and D-1 delta recomputes exactly, and the conclusion correctly says the migration saves package size only under D-1a ([LLP 0140:264](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:264), [LLP 0140:284](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:284), [LLP 0140:291](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:291)).

- Core upstream feasibility holds. Official Rolldown references support programmatic generation, IIFE output, disabling tree shaking, disabling code splitting, sourcemaps, and comment classes, and Oxc-backed TypeScript transformation ([Rolldown reference](https://rolldown.rs/reference), [IIFE format](https://rolldown.rs/reference/OutputOptions.format), [tree shaking](https://rolldown.rs/reference/InputOptions.treeshake), [output options](https://rolldown.rs/reference/Interface.OutputOptions), [transform options](https://rolldown.rs/reference/InputOptions.transform)). Official `oxc-parser` documentation supports `parseSync`/`parse`, explicit language/source-type options, ranges, JS ESTree compatibility, TS-ESTree compatibility with documented deviations, and semantic-error control ([oxc-parser package documentation](https://www.npmjs.com/package/oxc-parser)). Rolldown’s resolver extras omit import attributes, corroborating the structural need for the Plan’s pre-resolution synthetic-id mechanism ([ResolveIdExtraOptions](https://rolldown.rs/reference/Interface.ResolveIdExtraOptions), [LLP 0140:951](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:951)). Graph-metadata sufficiency remains uncertain, but the Plan treats it as an early falsifiable spike rather than an assumption ([LLP 0140:1299](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1299)).

- The acceptance matrix meaningfully tests security, identity, diagnostics, native-package selection, cross-tuple equality, and publication lineage rather than merely requiring builds to pass ([LLP 0140:1430](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1430)). The S6/LLP 0111 deferral is honest: S6 grants package-closure eligibility, not serving authority ([LLP 0140:1665](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1665)).

## Concerns

1. **MATERIAL — Current extension case-folding is neither stated nor gated.**

   **Evidence checked:** Definition admission, loader selection, and module-format classification are all explicitly case-insensitive ([index.mjs:7817](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7817), [index.mjs:7979](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7979), [index.mjs:8174](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:8174)). Handler-path admission and TypeScript scanner dispatch are also case-insensitive ([file-read-capability.mjs:127](/Users/ccheever/projects/snapback/packages/snapback-codegen/file-read-capability.mjs:127), [index.mjs:5075](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5075)). Thus uppercase or mixed-case `.MJS`, `.MTS`, `.JS`, `.TS`, and `.JSON` currently follow their lowercase semantics, while uppercase `.CJS`/`.CTS` are still recognized and refused as CommonJS. The Plan says only “the JSON / TS / JS set” and fixtures lowercase spellings ([LLP 0140:777](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:777), [LLP 0140:1140](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1140), [LLP 0140:1437](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1437)). A case-sensitive Oxc language dispatch or Rolldown module-type map can therefore narrow or misclassify current admission while every named case passes.

   **Resolution criterion:** State the existing case-insensitive rule explicitly and add Stage 0/1/2 case IDs for uppercase or mixed-case handler dispatch, valid ESM/TS/JSON graph dependencies, and uppercase CJS/CTS refusal.

2. **BLOCKING — The publication guard has contradictory installation deadlines.**

   **Evidence checked:** Stage 1 says the guard and Stage-1-only fixtures must land before or atomically with the native Oxc landing ([LLP 0140:1226](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1226), [LLP 0140:1235](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1235)). The rollback section instead says it is installed before or atomically with Stage 2 ([LLP 0140:1686](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1686)). The Plan itself explains that the native-binding predicate is needed precisely to cover the Stage-1-only window ([LLP 0140:1695](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1695)).

   **Resolution criterion:** Make every installation statement name the first Stage-1 landing that introduces the native parser, and bind the guard plus its bidirectional Stage-1-only fixture into the Stage-1 gate and receipt.

3. **BLOCKING — The Plan both rejects and authorizes a subset release under LLP 0041.**

   **Evidence checked:** Stage 4 says LLP 0041 requires the complete nine-package vector and explicitly says a subset release first needs a new LLP 0041 protocol ([LLP 0140:1365](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1365)). LLP 0041 makes the nine-package machine normative for this and later releases and defines a closed full-vector sequence ([LLP 0041:371](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:371), [LLP 0041:394](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:394)); its lease binds the complete vector ([LLP 0041:667](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:667)). Yet LLP 0140 later says an independent non-predicate package such as `@expo/snapback-client` may publish during the freeze and requires a fixture proving that permission ([LLP 0140:1733](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1733)). No governing subset authority exists.

   **Resolution criterion:** Either state only that LLP 0140 adds no extra objection while LLP 0041 still refuses standalone publication, or amend LLP 0041 first with a reviewed subset protocol preserving its vector, lease, and rollback invariants. The guard fixture must not turn Plan-local non-objection into publication authority.

4. **MATERIAL — The final post-removal tarballs escape the package inspection.**

   **Evidence checked:** Stage 4 step 1 inspects dependencies, platform omissions, licenses, integrity, download bytes, and unpacked bytes ([LLP 0140:1344](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1344)). S2 then creates a different clean SHA and rebuilt final tarballs, but reruns only step 2’s cold-install and semantic evidence—not step 1’s inspection ([LLP 0140:1357](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1357)). Neither the S2 entry condition nor the S5 binding adds a final inspection result ([LLP 0140:1626](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1626), [LLP 0140:1745](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1745)). Removing esbuild and the seam changes exactly the dependency, license, native-package, and size surfaces being inspected.

   **Resolution criterion:** Rerun the complete step-1 inspection against S2’s final nine tarballs and bind the inspection result, license-policy version, resolved dependency/native-binding inventory, and size rows into S2 and therefore the S5/S6 lineage.

5. **MATERIAL — Stage 0 lacks the aggregate producer/verifier later lineage assumes.**

   **Evidence checked:** The Plan promises an executable command and machine-readable manifest for every stage ([LLP 0140:1118](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1118)). Stage 0 names ledger and size commands, but leaves the fixture manifest and current-codegen oracle under an open `llp/receipts/0140-*` wildcard with no canonical aggregate path or producer/verifier ([LLP 0140:1179](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1179)). S1 subsequently requires valid Stage-0 receipts, while S5 claims to bind a Stage-0 digest and case map ([LLP 0140:1625](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1625), [LLP 0140:1751](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1751)). There is no canonical fact for those later verifiers to reopen.

   **Resolution criterion:** Name a Stage-0 aggregate receipt and executable producer/verifier—such as `run-0140-corpus --stage 0`—binding the authority ledger, exact fixture case map and corpus digest, zero skips, current-codegen oracle outputs, raw performance baselines, and per-package size evidence.

6. **MINOR — The `.ts` Acorn-fallback claim is overbroad.**

   **Evidence checked:** The Plan says a `.ts` handler fails three Acorn parses ([LLP 0140:443](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:443)). Those consumers receive source text, not an extension; plain ECMAScript in a `.ts` file parses normally ([index.mjs:4982](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4982), [index.mjs:5661](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5661), [index.mjs:5765](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:5765)). Only TypeScript-specific syntax triggers those fallback paths.

   **Resolution criterion:** Qualify the claim as `.ts`/`.mts` source containing syntax Acorn cannot parse.

7. **MINOR — Version provenance is inconsistent.**

   **Evidence checked:** The capsule calls this v0.15, while the exact matching target’s `Revised` header says v0.14 ([LLP 0140:8](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:8)).

   **Resolution criterion:** Correct the document version or explain why the v0.15 review capsule intentionally targets a v0.14-labelled file.

## Suggestions

- Pin a concrete `logLevel`, rather than only “a delivery-preserving value,” so the supposedly pinned option manifest is reviewable before execution ([LLP 0140:779](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:779)).

- Make the Stage-4 gate paragraph name both S5 and terminal S6. The current local gate text names only `--state s5`, while the later authoritative rule correctly requires S6 before Stage 4 is complete ([LLP 0140:1420](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1420), [LLP 0140:1643](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1643)).

- Retain the exact Oxc error-table and Rolldown import-attribute probes as small checked-in, version-pinned programs with raw outputs. Official APIs corroborate their premises, but the exact measured rows, offset unit, hook-call counts, and object-identity results should remain independently reproducible.

- Preserve the Plan’s explicit residual nonclaims. Even a fully passing matrix would not prove grammar equivalence outside the declared corpus/generators, catch an in-process native abort, cover unsupported platforms or future versions, prove rapid-edit Vite race behavior, establish post-publication rollback effectiveness, prevent raw `npm publish` outside the harness, or authorize any served capability ([LLP 0140:675](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:675), [LLP 0140:1691](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1691), [LLP 0140:1665](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1665)).

## Open questions

1. Which D-1 branch will the author select, and—under D-1a—who owns and independently reviews the binding resolver and identity rollout?

2. Is independent publication of a non-predicate package during the migration intended to be genuinely authorized? If so, where will the required LLP 0041 subset protocol be defined?

3. Is current extension case-folding a contract to preserve, as the Plan’s no-narrowing rule implies, or is changing it intended to become a separately reviewed admission change?

4. What canonical Stage-0 command and receipt will later S1/S5 verifiers reopen?

5. Will Rolldown’s Stage-3 metadata spike prove equality against the owned ledger for parsed-but-eliminated modules, package manifests, JSON, aliases, and synthetic ids, or will deployment identity rely solely on the owned ledger?

6. Do the exact Oxc error table, UTF-16 offset result, import-attribute hook counts, and module-instance identity result reproduce on both supported native tuples?

## Readiness verdict

**NOT READY.** The readiness-blocking list is:

1. Missing case-insensitive extension admission contract and fixtures.
2. Contradictory Stage-1 versus Stage-2 guard-installation deadline.
3. Unauthorized subset-publication claim under LLP 0041.
4. No package inspection of S2’s final post-removal tarballs.
5. No canonical Stage-0 aggregate producer/verifier and receipt.

The `.ts` wording and v0.14/v0.15 provenance mismatch are minor and do not independently determine the verdict.

VERDICT: NOT READY
## Orchestrator verification (outside the verbatim body)

All seven items confirmed; none refuted.

- **Concern 7 explains two of the others.** The v0.15 edit batch that carried the
  version-header bump *and* the rollback-section guard-deadline fix aborted on an
  unrelated pattern mismatch and wrote nothing, so the file the round-15
  reviewers hashed still carried the v0.14 header and the stale Stage-2
  deadline. Both are corrected in v0.16, and the header now records the loss.
- **Concern 1 confirmed by direct read**: extension matching is `/i` at
  `index.mjs:7817`, `:7979`, `:8174`, `:5075` and `/iu` at
  `file-read-capability.mjs:127`, so mixed-case `.MJS`/`.TS`/`.JSON` follow
  lowercase semantics today and uppercase `.CJS`/`.CTS` are refused as CommonJS.
  A case-sensitive Oxc dispatch or Rolldown module-type map would narrow
  admission while every lowercase fixture passed. v0.16 states the rule and adds
  the case IDs.
- **Concern 3 is the sharpest of the round**: v0.15's fixture requiring that a
  non-predicate package "is permitted" during the freeze read as a *grant* of
  publication authority that LLP 0041 does not give — its machine is a closed
  full-vector sequence with a lease bound to the complete vector. v0.16 restates
  the fixture as what the guard *decides* (this Plan raises no objection) and
  says explicitly that a standalone release would need LLP 0041 amended first.
- **Concerns 4 and 5 confirmed and applied**: S2's rebuilt tarballs now re-run
  step 1's full package inspection with the result bound into the S2 receipt and
  the S5/S6 lineage; and Stage 0 gains an aggregate `0140-s0.json` with a named
  producer and verifier, since a wildcard over `llp/receipts/0140-*` is not a
  fact a later verifier can reopen.
- **Concern 6 confirmed**: the three Acorn consumers receive source text, not an
  extension, so only TypeScript-specific syntax triggers the fallbacks; the
  claim is now qualified.


## Round 16 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbfd3-a93e-72e1-ae36-a10c40873171`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Status:** completed

## Verbatim review

Computed target SHA-256: `a0376bbc92927372ea6229675e9e5ac7cf98ef65ce5afe7a856fbc40aeba8dc1`  
Expected target SHA-256: `a0376bbc92927372ea6229675e9e5ac7cf98ef65ce5afe7a856fbc40aeba8dc1`  
Hash result: **MATCH**  
Review date: **2026-08-01**

Method note: I reviewed the complete untracked on-disk target; every inventory-table implementation; the full codegen bundler, parser, inline-handler, file-read, asset-reference, client-request, Rust admission, generation, and finalization paths; the cited sections of LLPs 0009, 0010, 0030, 0041, 0044, 0049, 0064, 0108, 0111, and 0118; repository-wide binary-safe searches for first-party esbuild, Acorn, TypeScript compiler-API, built-in transform, and generated-template uses; cached registry metadata and size arithmetic; and official Rolldown/Oxc release, API, source, and parser/transformer documentation. I did not read anything under `llp/reviews/`, did not read any filename containing `super-refine`, and did not edit any file. The exact pinned packages were absent locally, filesystem writes and shell network access were unavailable, so I could not install them or independently rerun the exact `oxc-parser@0.142.0` error table or `rolldown@1.2.1` import-attribute probe. I also could not independently refetch several compressed-tarball byte cells; I treated those observations as unverified, not contradicted.

## 1. Overall assessment

The migration direction is technically feasible, the inventory is complete, and most of this Plan is exceptionally careful. Its parser projection, closed-graph plugin, option manifest, differential admission work, cross-tuple proof, and LLP 0041/0111 deferral are substantially stronger than a typical toolchain-migration plan.

It is nevertheless not ready. There are two blocking defects:

- The Plan treats asset `implementationHash` as a lifecycle carrier, but the current client and runtime do not consume it for stale-reference checks, generation bumps, retained-code selection, or finalization. In addition, reachable asset-authorizer helpers are absent from that hash. Exact execution can therefore preserve or rotate the wrong identity while leaving materially different authorization code under one effective lifecycle generation.
- The claimed Stage-0 aggregate receipt and producer do not exist in the actual text, although later release states require and bind a “valid Stage 0 receipt.”

Two additional material internal contradictions—the publication rollback sentence and the helper-version re-run trigger—also must be reconciled.

VERDICT: NOT READY

## 2. Strengths

- **The first-party census is complete and correctly classified.** The table at [LLP 0140:192](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:192) matches every direct authority I found. Acorn appears only at [index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31); the direct esbuild surfaces are exactly the seven named rows; and the direct TypeScript compiler-API surfaces are `index.mjs`, `inline-handlers.mjs`, `check-contract-meta.mjs`, and the filesystem-composed import in `check-package-export-types.mjs`. The `tsc` uses and `stripTypeScriptTypes` exception are also honestly scoped. No omitted migration-owned authority was found.

- **The seven current scanner responsibilities are accurately enumerable.** The six Acorn consumers and one syntax-only TypeScript scanner listed at [LLP 0140:208](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:208) correspond to the implementation, including the distinct parse-failure fallbacks, deduplication, ordering, and first-error behavior.

- **The Rolldown admission-plugin specification covers the current esbuild contract.** The requirements at [LLP 0140:708](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:708) account for the reserved facade, separate graph/evaluation boundaries, authored-versus-transformed entry bytes, capability-aware reads, exact-file resolution, case-folded extension behavior, module-format custody, two package allowlist entries, every current refusal, intrinsic banner, in-memory output, and absence of built-in resolver or CommonJS fallback. These correspond to [index.mjs:7679](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7679).

- **The governing anchors exist and mostly say what the Plan claims.** In particular, the capability boundary in [LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-ibex-snapback-runtime-architecture.rfc.md:774), generated-artifact/diagnostic rules in [LLP 0010:312](/Users/ccheever/projects/snapback/llp/0010-codegen-and-dev-loop.rfc.md:312), dev-state rules in [LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-vite-dev-loop.rfc.md:603), helper identity in [LLP 0108:855](/Users/ccheever/projects/snapback/llp/0108-inline-handlers-and-result-contracts.spec.md:855), and controlled-bundler precedent in [LLP 0118:246](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:246) substantively support the Plan.

- **The size discussion is honest and reproducible enough for a Plan.** The measurement basis at [LLP 0140:245](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:245) distinguishes tarball bytes, registry unpacked size, cache transfer, apparent size, and allocated size. All totals and all four D-1 deltas at [LLP 0140:266](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:266) are arithmetically exact. Cached metadata reproduced every unpacked component. The conclusions properly state that only D-1a produces a size reduction.

- **The upstream capability assumptions hold or are honestly gated.** Rolldown provides in-memory `generate()`, explicit `close()`, and IIFE output through its [programmatic build API](https://rolldown.rs/reference/Interface.RolldownBuild). The Plan’s option names and nesting agree with the [exact v1.2.1 output-options source](https://raw.githubusercontent.com/rolldown/rolldown/v1.2.1/packages/rolldown/src/options/output-options.ts). The controlled resolver limitation is real: official [`ResolveIdExtraOptions`](https://rolldown.rs/reference/Interface.ResolveIdExtraOptions) exposes `custom`, `isEntry`, and `kind`, but no import attributes, source position, or `require.resolve` kind. Oxc’s package documentation supports the ESTree/TS-ESTree projection and pinned `preserveParens`/`showSemanticErrors` defaults, while its exact parser documentation supports UTF-16 ESTree span conversion. TypeScript lowering belongs to the [Oxc transformer](https://oxc.rs/docs/guide/usage/transformer/typescript), not `oxc-parser`, as the Plan says. Graph-metadata sufficiency remains uncertain, but [LLP 0140:1316](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1316) makes it an early spike rather than an assumed fact.

- **The acceptance matrix is mostly a real proof rather than a restatement.** It binds rows to case IDs and zero-skip manifests, compares admission in both directions, preserves diagnostic precedence and custody, uses metamorphic identity tests, covers cross-tuple public tarballs, and keeps serving outside S6 at [LLP 0140:1450](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1450). Its residual nonclaims at [LLP 0140:679](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:679)—corpus bounds, future versions, unsupported hosts, uncatchable native aborts, rapid-edit races, and D-1a review quality—are appropriately candid. Raw `npm publish` bypass and actual LLP 0111 served qualification also remain explicitly unproven.

## 3. Concerns

### 1. BLOCKING — Asset implementation identity is neither complete nor an effective lifecycle carrier

**Evidence checked:** The Plan says asset authorizers are a second inline identity carrier at [LLP 0140:83](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:83), and claims a D-1a rotation changes asset policy-generation, stale-reference, frozen-finalization, and rollback behavior at [LLP 0140:347](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:347). That does not describe the current producer-to-consumer chain:

- Codegen emits both `implementationHash` and `intentPolicyHash` in the reference at [index.mjs:6481](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:6481).
- The client discards `implementationHash` and sends only `intentPolicyHash` at [assets.mjs:171](/Users/ccheever/projects/snapback/packages/snapback-client/assets.mjs:171) and [assets.mjs:403](/Users/ccheever/projects/snapback/packages/snapback-client/assets.mjs:403).
- Attempt admission compares only the policy hash at [local.rs:5519](/Users/ccheever/projects/snapback/src/local.rs:5519).
- Per-intent generation is keyed and bumped only by the policy hash at [assets.rs:958](/Users/ccheever/projects/snapback/src/assets.rs:958).
- Finalization chooses current versus retained authorizer code solely by policy-hash equality at [local.rs:7235](/Users/ccheever/projects/snapback/src/local.rs:7235).

The problem is deeper for helpers. Asset runtime source includes the reachable helper subset through [inline-handlers.mjs:857](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:857) and [index.mjs:2341](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:2341), but asset implementation identity hashes only the root canonical authorizer AST and policy at [index.mjs:2384](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:2384). Ordinary functions correctly include `{name, contentHash}` helper edges at [index.mjs:4769](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:4769).

A read-only extractor probe confirmed the collision: changing only a reachable asset-authorizer helper left the root canonical AST and marker token identical while changing both the helper content hash and rendered runtime SHA-256. Therefore different executable authorization code receives the same asset `implementationHash`. A direct authorizer-body or declared-read change does move `implementationHash`, but still does not move the effective lifecycle identity because only `intentPolicyHash` reaches the server.

This conflicts directly with LLP 0044’s promise that a changed intent bumps its generation and that revalidation uses the frozen generation’s authorizer code at [LLP 0044:423](/Users/ccheever/projects/snapback/llp/0044-asset-storage-pipeline.rfc.md:423) and [LLP 0044:451](/Users/ccheever/projects/snapback/llp/0044-asset-storage-pipeline.rfc.md:451). The broad identity rows at [LLP 0140:1515](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1515) do not necessarily catch this: Stage 0 can baseline the existing collision, and no named fixture mutates an asset-authorizer helper. D-1b explicitly omits the lifecycle fixtures, so exact execution can leave the defect untouched.

**Resolution criterion:** The Plan must acknowledge the current producer-to-consumer mismatch and make its repair or a reviewed LLP 0044 decision a prerequisite to freezing the baseline. It must name which identity controls reference admission, generation bumps, retained-authorizer selection, and finalization. If implementation identity is that carrier, it must cover the complete executable helper closure and be consumed throughout the lifecycle. If policy and implementation deliberately have separate lifecycle semantics, those semantics must be stated coherently. Add direct-body, helper-only, and declared-read metamorphic lifecycle fixtures proving generation/stale-reference behavior, frozen-code finalization, rollback, and stability of unrelated intents under both D-1 branches.

### 2. BLOCKING — Stage 0 has no aggregate receipt, producer, or verifier

**Evidence checked:** The v0.16 header says it “gave Stage 0 an aggregate receipt and producer” at [LLP 0140:8](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:8), and the stage policy says every gate names an executable command and manifest at [LLP 0140:1132](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1132). Stage 0 instead names a ledger, wildcard receipt paths, and two separate commands at [LLP 0140:1193](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1193). It defines no aggregate path, producer, verifier, schema, or component-set validation rule.

Later states nevertheless require a “valid Stage 0 receipt” at [LLP 0140:1643](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1643), claim every receipt has a producer and verifier at [LLP 0140:1650](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1650), and bind the Stage-0 receipt’s digest and case map into S5 at [LLP 0140:1769](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1769). The lineage is therefore impossible to construct as written.

**Resolution criterion:** Define a named aggregate receipt—such as `llp/receipts/0140-stage0.json`—with an explicit producer and verifier. It must bind the authority ledger, frozen corpus and case map, corpus digest, semantic baselines, size/performance receipts, exact versions/options/integrities, and zero-unapproved-skips fact. Alternatively, define a closed component set and one aggregate validation algorithm used consistently everywhere “valid Stage 0 receipt” appears.

### 3. MATERIAL — The rollback prohibition contradicts the release machine

**Evidence checked:** The rollback paragraph says no package publication may reference a Rolldown-generated closure before the Stage-4 terminal post-removal proof passes at [LLP 0140:1609](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1609). Immediately afterward, the Plan correctly explains that immutable candidate publication must happen before public-registry proof and permits it at S3 after S2 at [LLP 0140:1628](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1628). The authoritative table likewise permits candidate publication at [LLP 0140:1644](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1644).

The table-precedence rule makes execution decidable, but the rollback policy remains self-contradictory.

**Resolution criterion:** Replace lines 1615–1617 with permission-specific wording: non-default candidate publication requires S2/S3; default-tag promotion requires S5; package-closure eligibility requires S6; serving requires S6 plus the separate LLP 0111 carrier receipt.

### 4. MATERIAL — The helper-version re-run rule loses the helpers

**Evidence checked:** Toolchain custody explicitly says the standing re-run rule covers helper changes, including `@rolldown/pluginutils` and `@oxc-project/types`, at [LLP 0140:1083](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1083). The actual acceptance rule names only Rolldown, Oxc, and TypeScript at [LLP 0140:1585](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1585). The receipt-binding paragraph again says helper changes invalidate receipts at [LLP 0140:1795](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1795), while pointing to the incomplete standing rule.

A helper or native-binding integrity can move without a named top-level version moving, which is precisely the supply-chain hazard the custody section identifies.

**Resolution criterion:** Make the standing rule trigger on every effective-exact parser/bundler helper and selected native-binding version or integrity change, not only the three top-level tools. State unambiguously where terminal receipts inherit or directly record those facts and which full evidence set reruns before such a lock change lands.

### 5. MINOR — Constraint 7 cites the wrong section for one exact rule

**Evidence checked:** The clean-install/two-tuple claims at [LLP 0140:104](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:104) are supported by the cited runtime-distribution and acceptance sections. The precise opposite-platform optional-edge rule, however, is in [LLP 0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420).

**Resolution criterion:** Add `LLP 0041#nine-package-candidate-promotion--2026-07-28` to constraint 7. The Plan already uses the correct anchor later, so this is citation precision rather than a design defect.

## 4. Suggestions

- Define one schema-driven receipt DAG whose nodes and permitted actions generate the stage commands, transition table, guard predicates, and version-trigger lists. A Merkle-style Stage-0 root would prevent receipt and dependency lists from shrinking independently.

- Generate the Markdown size tables from the raw Stage-0 receipt, including explicit native-binding versions, rather than maintaining prose totals separately.

- Preserve the exact-version upstream probes as executable, receipt-producing cases with package integrity and upstream release commit recorded. This would make the parser error table and import-attribute result independently auditable even when a reviewer’s environment cannot install packages.

- Keep the existing recommendation to execute D-1b first and separate D-1a into a reviewed identity/security migration. The asset-carrier defect makes that separation more valuable, although D-1b must still close or explicitly gate the existing asset lifecycle issue.

## 5. Open questions

1. What exact fact defines a “changed asset intent”: policy fields, authorizer implementation, declared reads, reachable helper closure, or a versioned combination?
2. Which identity must generated references send and the server compare so that stale references, policy generations, retained authorizer code, and finalization all agree?
3. What is the exact Stage-0 aggregate receipt path, schema, producer, and verifier?
4. Will every helper and native-binding version/integrity movement trigger the same full evidence rerun as a top-level Rolldown/Oxc movement?
5. Which D-1 branch will be recorded before the Plan advances past Review? The unresolved choice is not itself a review defect, but it determines the identity work and size conclusion.
6. For Cloudflare identity, which Rolldown graph surface will own parsed-but-eliminated modules, JSON, aliases, synthetic runtime modules, and package-manifest facts if the Stage-3 spike finds the standard metadata insufficient?

## 6. Readiness verdict

The Plan is **NOT READY**.

Blocking list:

- **BLOCKING:** Specify and gate a coherent asset implementation/lifecycle identity, including reachable helpers and the actual client/server consumer chain.
- **BLOCKING:** Define the missing aggregate Stage-0 receipt, producer, verifier, and lineage.
- **MATERIAL:** Reconcile the rollback prohibition with S3 candidate publication.
- **MATERIAL:** Extend the standing evidence re-run trigger to helpers and native bindings.

The LLP 0041 citation correction is minor and would not independently block readiness.

VERDICT: NOT READY

## Round 17 — 2026-08-01

**Reviewer family:** OpenAI Codex
**Provider / runtime:** codex-cli 0.146.0, `codex exec`, model `gpt-5.6-sol`
**Reasoning effort:** `ultra`
**Session ID:** `019fbfe6-47aa-7493-a4b1-5d5daf28f6fd`
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author CLI runner (not resumed), `-s read-only`, mutually blind
**Status:** completed

## Verbatim review

Target SHA-256 (computed): `4a9b09271cfda6140329f62ebe2e186a81294de06b87a3e8a5096279708323ee` — **MATCHED**

Date: 2026-08-01

Method note: I read the complete target, every file named by its inventory, the codegen implementation and delegates, related tests/manifests/scripts, every cited governing LLP section, and the controlling publication and serving documents. I ran repository-wide searches for direct first-party esbuild, Acorn, and TypeScript compiler-API use; recomputed the size-table arithmetic; inspected official exact-version Rolldown/Oxc sources and documentation; and reran the current esbuild import-attribute normalization probes. I did not read anything under `llp/reviews/` or any file whose name contains `super-refine`, and I made no edits. I could not install or execute exact `rolldown@1.2.1` or `oxc-parser@0.142.0` because the filesystem is read-only and shell DNS was unavailable, so the exact Oxc parser-error table and Rolldown half of the import-attribute probe remain independently uncertain. I also could not re-download the npm tarballs, so I verified the size basis and arithmetic but not each raw byte cell.

## 1. Overall assessment

This Plan is ready to execute. The first-party census is complete within the searched repository, its rows accurately describe the current code, and I found no omitted migration-owned esbuild, Acorn, or TypeScript compiler-API authority. The governing anchors exist and support the claimed contracts. The current esbuild-hosted codegen behavior is enumerated deeply enough that the proposed parser, admission-plugin, identity, diagnostic, and evaluator gates would detect a silent regression.

D-1 is coherent under both branches. Keeping TypeScript preserves the existing symbol service directly; replacing it requires a decision transcript and differential corpus that covers the observable TypeChecker-backed behaviors. The Plan correctly treats choosing the branch as a gated author decision, not an already-settled fact.

The main upstream assumptions are supported by the real APIs: in-memory Rolldown generation, single-IIFE configuration, controlled resolution, disabled tree shaking, explicit output normalization, module metadata, Oxc’s JS/JSX and TypeScript parsing, source ranges, and syntax lowering without type checking all exist. The Plan also correctly treats “is Rolldown’s metadata sufficient for Snapback deployment identity?” as something the spike must prove rather than assuming it.

The size basis is reproducible as stated, its arithmetic is exact, and its conclusion is appropriately conditional: D-1a reduces both measured tuples while D-1b increases them.

Passing the entire acceptance matrix would establish the intended security boundary, graph and attribute identity, diagnostic envelope and offsets, restricted-evaluator behavior, generated-artifact invariants, and supported package closures. It would still not prove grammar outside the corpus, future tool versions, unsupported hosts, concurrent-generation liveness, recovery from a native-process abort, every Vite race, or emergency rollback effectiveness after publication. It also would not establish serving eligibility, which correctly remains LLP 0111’s separate receipt. Those residuals are disclosed at [LLP 0140:679](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:679) and [LLP 0140:1707](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1707), rather than being silently claimed away.

I found three minor factual or editorial defects, but no unresolved material correctness, safety, feasibility, coherence, or decision-quality concern.

VERDICT: READY

## 2. Strengths

- **The inventory is accurate and complete.** The table at [LLP 0140:194](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:194) matches the actual imports and roles: codegen imports all three tools at [index.mjs:31](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:31), constructs its three graphs at [index.mjs:617](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:617), and performs the current in-memory IIFE build at [index.mjs:7736](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7736). The inline-handler symbol service constructs its `Program` and `TypeChecker` at [inline-handlers.mjs:494](/Users/ccheever/projects/snapback/packages/snapback-codegen/inline-handlers.mjs:494). Broad searches found only the named direct first-party authorities.

- **The scanner census is genuinely enumerable.** The six Acorn call sites and the syntax-only TypeScript scan described at [LLP 0140:208](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:208) exist, as do all three TypeScript-to-Acorn fallback paths. The gates explicitly preserve ordering, deduplication, fallback selection, and first-error behavior at [LLP 0140:1222](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1222).

- **The governing contracts are real and correctly interpreted.** Generated-artifact, diagnostic, identity, isolation, and package-manifest constraints are present in [LLP 0010:330](/Users/ccheever/projects/snapback/llp/0010-agent-dx-and-acceptance.spec.md:330); the capability model is at [LLP 0009:774](/Users/ccheever/projects/snapback/llp/0009-code-execution-security.rfc.md:774); current handler behavior is documented at [LLP 0118:179](/Users/ccheever/projects/snapback/llp/0118-handler-composition-and-helper-reuse.research.md:179); and the Vite codegen/hot-push contract exists at [LLP 0030:603](/Users/ccheever/projects/snapback/llp/0030-managed-snapback-vite-dev.rfc.md:603).

- **The admission-plugin design covers the current esbuild path’s load-bearing behavior.** Resolver ownership and refusals, descriptor-attested reads, authored-byte custody, supported extensions, CommonJS refusal, separate fresh graphs, transformed functions entry, output normalization, diagnostic custody, and graph identity are all named or gated between [LLP 0140:713](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:713) and [LLP 0140:1073](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1073).

- **The upstream design uses capabilities that exist.** Rolldown’s official APIs provide programmatic generation, resolver/load hooks, output controls, and module metadata; the exact options are visible in the [v1.2.1 output-options source](https://github.com/rolldown/rolldown/blob/v1.2.1/packages/rolldown/src/options/output-options.ts). Oxc documents JS/JSX ESTree output, TypeScript TS-ESTree output, ranges, `parseSync`, and parser options in its [parser guide](https://oxc.rs/docs/guide/usage/parser). The Plan appropriately puts metadata sufficiency behind the spike at [LLP 0140:1328](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1328).

- **Import-attribute handling is treated as an identity problem, not merely syntax support.** The current esbuild probe reproduced the stated distinction between `with` and legacy `assert`, while reordered and escaped cooked-equivalent attributes normalized identically. The proposed instance-identity fixtures at [LLP 0140:928](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:928) address the right risk.

- **The baseline table is honest.** It states versions, package closure, tuples, packed-byte basis, `dist.unpackedSize` basis, and measurement date at [LLP 0140:243](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:243). All totals and deltas at [LLP 0140:286](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:286) recalculate exactly.

- **The stage gates are evidence-producing gates rather than restated intentions.** Stage-specific commands and receipts begin at [LLP 0140:1135](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1135); the full acceptance matrix is at [LLP 0140:1470](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1470); and S1–S6 assign distinct proof obligations at [LLP 0140:1665](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1665).

- **The v0.17 revision header agrees with the body.** The Stage-0 aggregate receipt, S2 package reinspection, Acorn version-change rerun, literal `logLevel: 'info'` pin, and concurrent-generation residual are all present at the claimed locations.

## 3. Concerns

### MINOR — Rolldown check defaults are not uniformly “on”

Evidence checked: [LLP 0140:797](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:797) characterizes the `checks` defaults as on. Rolldown’s official [checks reference](https://rolldown.rs/reference/InputOptions.checks) defines per-check defaults that vary; for example, `circularDependency` defaults to false while several unresolved-name/import checks default to true.

This is not load-bearing because the Plan subsequently requires a per-class policy table, explicit option assertions, and escalation of unknown warning classes.

Resolution criterion: replace the blanket statement with language saying defaults vary and every supported check class—including default-off classes—is explicitly pinned and dispositioned, or list the deliberately disabled classes and rationale.

### MINOR — One publication parenthetical still reads like an inverted chronology

Evidence checked: [LLP 0140:1691](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1691) says the Plan no longer restates LLP 0041, but the parenthetical at lines 1696–1699 lists prior-vector preflight before immutable candidate publication. LLP 0041 publishes and records the candidate first at [LLP 0041:401](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:401); its later preflight binds the resulting candidate-ledger digest at [LLP 0041:606](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:606).

Execution remains coherent because [LLP 0140:1703](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:1703) explicitly makes LLP 0041 controlling.

Resolution criterion: reorder the parenthetical to match LLP 0041 or label it explicitly as an unordered inventory of protocol components.

### MINOR — The initial wrong-platform constraint cites a broader anchor than the exact invariant

Evidence checked: [LLP 0140:104](/Users/ccheever/projects/snapback/llp/0140-vite-rolldown-oxc-convergence.plan.md:104) cites LLP 0041’s runtime-distribution and acceptance sections for wrong-platform optional-native omission. Those sections support installability and the two supported tuples, but the exact opposite-runtime edge invariant is stated at [LLP 0041:420](/Users/ccheever/projects/snapback/llp/0041-packaged-dev-loop.rfc.md:420). Later Plan sections use the more precise anchor.

Resolution criterion: add the `nine-package-candidate-promotion--2026-07-28` anchor at the initial statement, or separate LLP 0041’s existing invariant from this Plan’s added Oxc/Rolldown binding rule.

## 4. Suggestions

- Preserve the two exact-version probes and their transcripts as executable, hash-bound Stage-0 evidence. That would make the parser-error classification and import-attribute measurements reviewable without reconstructing an installation environment.

- Explicitly name both `SNAPBACK_OUTBOUND_ACTIONS` modes in the D-1a oracle manifest. The existing suite exercises both at [authoring-validation.test.mjs:537](/Users/ccheever/projects/snapback/packages/snapback-codegen/authoring-validation.test.mjs:537), so this would improve traceability rather than add a new gate.

- Run the literal planned facade through Rolldown 1.2.1 to determine whether `MISSING_NAME_OPTION_FOR_IIFE_EXPORT` and `MISSING_GLOBAL_NAME` are production-real warnings or synthetic policy seeds. The current facade at [index.mjs:7968](/Users/ccheever/projects/snapback/packages/snapback-codegen/index.mjs:7968) assigns through `globalThis` and does not export a symbol. Label synthetic-only seeds accordingly.

- If native aborts or concurrent-generation stalls become empirically significant, consider moving the Oxc/Rolldown N-API work behind a supervised worker or child-process boundary. That could recover some failure isolation lost when the esbuild subprocess disappears.

## 5. Open questions

These are legitimate execution decisions, not current Plan-readiness blockers:

- Which D-1 branch will the author select, and what evidence threshold will make the D-1a replacement sufficiently trustworthy?
- What exact final version closure follows that decision, and does installation actually deduplicate the expected native packages?
- Does the metadata/observed-read cross-check produce a complete enough deployment-identity ledger on the real graphs?
- Can the admission plugin preempt every supported CommonJS/builtin resolution path, or does any path bypass `resolveId`?
- Which demos form the maintained Vite acceptance set?
- Do the two measured exact-version claims reproduce when run from the Stage-0 fixture environment?

## 6. Readiness verdict

**READY.** There are no blocking or material concerns, and the blocking list is empty. The three minor corrections should be made in the next editorial pass, but executing the Plan’s gates as written would not silently break a security, identity, diagnostic, package-closure, publication, or serving contract.
## Orchestrator verification — rounds 16 and 17 (outside the verbatim bodies)

**Round 16.** All five items confirmed. The first is the loop's most valuable
find and is a **pre-existing defect in Snapback, not in the Plan**: asset-intent
`implementationHash` hashes the authorizer's root canonical AST but omits the
reachable inline-helper closure (`index.mjs:2384-2397`), while the equivalent
record for ordinary functions folds in `helpers: [{name, contentHash}]`
(`index.mjs:4787-4796`) — and asset runtime source *does* splice the reachable
helpers. Verified independently. Its second half is equally real: only
`intentPolicyHash` reaches the server
(`packages/snapback-client/assets.mjs:173`, `:180`, `:411`;
`src/local.rs:5519`; `src/assets.rs:958`; `src/local.rs:7235`), so
`implementationHash` is not the lifecycle carrier at all. Filed as
`issues/20260801-asset-intent-implementation-hash-omits-helper-closure.md`; the
Plan now records it as a Stage-0 prerequisite disposition under **both** D-1
branches, since D-1b would otherwise preserve the collision byte-identically.
The other four (Stage-0 aggregate receipt, rollback prohibition, helper-version
re-run rule, constraint-7 anchor) were applied.

**Round 17 — READY.** This is the convergence round: both families independently
marked the same revision (v0.17,
`4a9b09271cfda6140329f62ebe2e186a81294de06b87a3e8a5096279708323ee`) ready. The
three minors were applied afterward; see the super-refine journal for the
unreviewed-delta accounting.
