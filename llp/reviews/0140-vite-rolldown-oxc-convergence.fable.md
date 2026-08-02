# LLP 0140 review — Fable family


## Round 1 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository (no repository edits; scratch notes only outside the tree); mutually blind — barred from `llp/reviews/` and from any path containing `super-refine`; network reachable for the npm registry (rolldown.rs and npmjs.com HTML were not: 404/403), so upstream capability claims were verified by downloading and extracting the actual `rolldown@1.2.1` and `oxc-parser@0.142.0` tarballs and reading their shipped typings/README; target = the uncommitted working-tree draft, SHA-pinned
**Target SHA-256:** `cf707efa41fc1cc44b60f3c9f2efc18779d7979d474ffd850cfdb8d6054fc324`
**Instruction SHA-256:** `caf069d01f9859847b8def8b93cc5c8bb89cbb94c54a5be8deb8ec8c11a4487c`
**Status:** completed

## Verbatim review

# LLP 0005 Review — LLP 0140 "Vite, Rolldown, and Oxc toolchain convergence" (round 1, Fable family)

**Target hash (computed):** `cf707efa41fc1cc44b60f3c9f2efc18779d7979d474ffd850cfdb8d6054fc324` — **matches** the capsule's expected SHA-256, verified with `shasum -a 256` against the working-tree file.
**Date:** 2026-08-01
**Reviewer:** Independent Fable-family reviewer (did not author the document; did not read anything under `llp/reviews/` or any `super-refine` file).

**Method note.** I read the full target (383 lines) and verified its load-bearing claims directly: I re-ran the first-party census with ripgrep (including a `--text` pass that standard text search misses — decisive, see Concern 1); opened every file named in the inventory table; read the esbuild-hosted definition bundler (`packages/snapback-codegen/index.mjs:7679–7872`), all six Acorn call sites, the TypeScript handler scanner (:5386–5659), `cloudflare/scripts/generate-deployment-identity.mjs` in full, and the Miniflare harness bundler (`cloudflare/test/harness.mjs:90–200`); checked all ten cited LLP anchors (0010 #generated-artifacts/#diagnostic-shape, 0009 #capability-model/#supply-chain-and-generated-bundles, 0118 #what-snapback-does-today/#3-build-step-bundling…, 0041 #runtime-distribution/#acceptance, 0030 #codegen-and-hot-push/#diagnostics) and confirmed each section exists and says what the Plan claims. Network was available for the npm registry: I confirmed all five named package versions exist, re-derived every cell of the baseline size table from registry metadata and actual tarball downloads, and extracted the `rolldown@1.2.1` and `oxc-parser@0.142.0` tarballs to inspect their real type definitions and README. What I could **not** verify: rolldown.rs docs (404) and npmjs.com pages (403) were unreachable; I did not execute Rolldown/Oxc on fixtures, so runtime behaviors not visible in typings (top-level-await-in-IIFE handling, whether `require.resolve` routes through `resolveId`, offset units UTF-8 vs UTF-16) are marked uncertain rather than asserted.

## 1. Overall assessment

This is a strong Plan with an unusually honest evidentiary posture: the governing constraints are the right ones and every anchor I checked is real and accurately characterized; the admission-plugin requirement list reproduces nearly every behavior of the shipped esbuild plugin; the size table's sixteen numbers reproduce **to the byte** from the public registry; and the stage gates are mostly real gates (frozen-corpus equality, explicit dispositions, real permission-denied subprocess evaluation) rather than restatements. The skepticism about Rolldown's `resolveId` coverage is well-placed and, per the actual 1.2.1 typings, testable.

It is not ready, for two reasons that are exactly the failure classes the capsule asks about. First, the census — the Plan's own foundation, with completion criteria of "no unexplained first-party use" — is missing a load-bearing production surface: `packages/snapback-codegen/inline-handlers.mjs` imports the TypeScript compiler API and builds a real `Program`/`TypeChecker` (semantic, not syntax-only), which makes Stage 1.4 unexecutable as written and silently undermines the headline size conclusion. The mechanism of the miss is itself instructive: the file contains a NUL byte, so ordinary text search classifies it as binary and skips it — the same mechanical census Stage 0 mandates would re-miss it. Second, the Plan drops `import.meta` from the fail-closed list it otherwise inherits from LLP 0010, and the current enforcement is a single untested esbuild `logOverride`; Rolldown replaces `import.meta` with `{}` in non-ESM output behind a default-on *warning*, so executing this Plan exactly as written can ship a silent fail-open of a documented refusal that no fixture, gate, or matrix row would catch.

Both are cheaply fixable in text, and the fixes make the Plan meaningfully stronger rather than merely longer.

VERDICT: NOT READY

## 2. Strengths

- **Correctly scoped as a Plan.** The direction is settled; the document confines itself to census, constraints, sequencing, gates, and rollback (`llp/0140-vite-rolldown-oxc-convergence.plan.md:40–48`), and the "two live authorities" argument against a parallel ticket (:36–38) is sound.
- **Constraints are real and correctly cited.** Every anchor exists and matches: the closed-graph/fail-closed contract (`llp/0010-agent-dx-and-acceptance.spec.md:369–380`, `llp/0009-code-execution-security.rfc.md:989–1005`), static-scan-as-defense-in-depth (`llp/0009:788–800` — the Valet arms-race lesson), the "precedent for the shape, not the authority" framing (`llp/0118-handler-composition-and-helper-reuse.research.md:668–704`, whose controlled-vs-delegated-resolution split the Plan's §Target architecture faithfully applies), packaging (`llp/0041-packaged-dev-loop.rfc.md:297–339, 946+`), and Vite-dev diagnostics (`llp/0030-managed-snapback-vite-dev.rfc.md:603–656`).
- **The admission-plugin requirements track the shipped code closely.** I checked each bullet at :180–194 against `packages/snapback-codegen/index.mjs:7736–7843`: facade namespace, the four admission cases, all seven refusal families with their existing codes, the capability-aware reader (`resolveFileReadCapability`, :7698–7732), package.json-joins-graph module-format logic (:7820–7832), `treeShaking: false` (:7743), the intrinsic-capture banner (:7748–7770), and no-CJS-fallback. This is a nearly complete behavioral census of the plugin — nearly (see Concern 2).
- **The `resolveId`-coverage skepticism (:196–199) is exactly right and now testable.** Rolldown 1.2.1's typings confirm a `kind` discriminator (`'import-statement' | 'dynamic-import' | 'require-call' | …`, binding typings :1688–1700), so the adversarial corpus can prove edge interception rather than assume it.
- **Feasibility assumptions largely hold, verified against the real packages.** From `rolldown@1.2.1` dist typings: `format: "iife"` (ModuleFormat, define-config :303), `treeshake?: boolean` (:3684), in-memory `RolldownBuild.generate()` (:1283–1302), `banner` (:512), `sourcemap` off, `legalComments: "none"` (:859–866), and `OutputChunk.moduleIds`/`modules` (:182–233) for deployment-identity graph metadata. From `oxc-parser@0.142.0`: ESTree conformance for JS ("the same as produced by Acorn") and TS-ESTree for TS, per its README, with deviations enumerated.
- **Stage 2.3 is a real gate.** Exercising candidate IIFEs inside the actual permission-denied evaluator subprocess (:255–256) — not just the parent process — is the difference between comparing bytes and comparing the security contract.
- **The rollback stance is coherent and correctly argued.** "No runtime auto-selection between esbuild and Rolldown" (:347–350) is justified by an identity argument, not taste; independent landing of Stage 1 (:352–354) is consistent because parser and bundler are different authorities.
- **The size table is honest and reproducible in its conclusions.** I re-derived all sixteen numbers from the registry and tarballs; the stated figures are exact under the (unstated) basis of {main package + platform binding}, and the Plan correctly declines to count Vite-side deduplication before evidence (:128–134).
- **The identity design survives the migration by construction, and the Plan knows it.** Artifact identity hashes authored handler bytes and admitted path/source pairs plus canonical evaluated values (`index.mjs:2597–2650`, `llp/0010:377–380`), not transient bundle bytes — and Stage 0.3 (:226–228) explicitly refuses bundle bytes as the semantic oracle.

## 3. Concerns

### Concern 1 — BLOCKING: the census omits `inline-handlers.mjs`, which uses the TypeScript *type checker*; this breaks Stage 1.4 and undermines the size-table conclusion

**Evidence.** `packages/snapback-codegen/inline-handlers.mjs:1` is `import ts from 'typescript';`. It is production admission surface (imported by `index.mjs:79`; it is the LLP 0108/0118 inline-handler extractor with the `SNAPBACK_INLINE_HANDLER_*` refusals). Critically, it is **not syntax-only**: line 515 is `ts.createProgram([path], compilerOptions, compilerHost).getTypeChecker()`, and `checker.getSymbolAtLocation` (:139) drives const-alias resolution inside the reflective-access detector (`staticString`, :132–184). The inventory table (:83–92) lists only `index.mjs` and `scripts/check-contract-meta.mjs` as TS-AST users. I verified the omission is the *only* one — a repo-wide `--text` sweep for esbuild/acorn/typescript imports across `.mjs/.js/.ts/.cjs/.mts/.cts` (excluding node_modules/vendor) returns exactly the table's eight files plus this one.

**Why it blocks, three ways.** (a) Stage 1.4 (:244–246) — "delete the codegen imports and dependencies on Acorn and TypeScript" — is unexecutable: `@expo/snapback-codegen`'s `typescript` dependency (`packages/snapback-codegen/package.json:85`) is load-bearing for inline-handlers regardless of the scanner migration. (b) The baseline-size conclusion (:128–130: "The combined plan is smaller because `oxc-parser` can replace both syntax-only parser stacks") silently assumes TypeScript (23,625,066 bytes unpacked, 4,377,468 download) leaves the codegen closure. If inline-handlers retains it — and `oxc-parser` has no symbol/type API to replace `getSymbolAtLocation` (its `showSemanticErrors` is only extra parse-time errors) — the claimed −14.4 MB / −12.1 MB unpacked deltas mostly evaporate, and the candidate closure is *larger* than the current one on both platforms. (c) The Stage 4 gate's "syntax-only TypeScript" carve-out (:302–305) would then quietly become the load-bearing exemption for a security-critical detector without the Plan ever saying so.

**Mechanism worth recording.** The file contains a NUL byte (in a cycle-key join sentinel, ~offset 22296), so ripgrep/grep classify it as binary and silently skip it in list mode. This is very plausibly how the author's own census missed it, and Stage 0.1's "machine-readable inventory" (:217–219) would re-miss it unless the census tool is required to be binary-tolerant.

**Resolution criterion.** The inventory table carries an `inline-handlers.mjs` row with an explicit disposition that names the type-semantic operation (`Program`/`TypeChecker` symbol resolution for const-alias reflective-access detection) and decides: retain TypeScript in the codegen closure (and restate the size table's conclusion and the acceptance matrix's size rows under that corrected closure), or commission a designed syntax-only replacement with an explicit no-narrowing gate. Stage 1.4 and the Stage 4 gate wording are reconciled with the chosen disposition. Stage 0.1 additionally requires the census tooling to search binary-classified first-party files (e.g., `rg --text` or equivalent).

### Concern 2 — BLOCKING: `import.meta` is dropped from the fail-closed contract, and executing the Plan as written can silently open it

**Evidence.** LLP 0010's fail-closed list *includes* `import.meta`: "dynamic imports, CommonJS loaders, bare resolution, `node:*` capabilities, query/hash-qualified specifiers, and `import.meta` fail closed" (`llp/0010:374–376`). The Plan's Constraint 1 (:53–55) reproduces this list *minus* `import.meta`; the admission-plugin requirements (:180–194) don't mention it; Stage 0's fixture enumeration (:220–223) omits it; the acceptance matrix (:309–340) has no row for it. The current enforcement is exactly one line — `logOverride: { 'empty-import-meta': 'error' }` (`index.mjs:7747`) — and I could find **no test anywhere** that pins this refusal (no `import.meta`-in-definition-module fixture in any `packages/snapback-codegen/*.test.mjs`), so "every repository backend fixture" in the Stage 2 dual-run would not catch a regression either. On the Rolldown side, the 1.2.1 typings show `import.meta` in non-ESM output is *replaced with an empty object* behind a default-on **warning** (`ChecksOptions.emptyImportMeta`, define-config :1601–1606: "emit warnings when `import.meta` is not supported with the output format and is replaced with an empty object (`{}`)"). A warning is not a refusal: a definition module reading `import.meta.url` would bundle successfully and evaluate against `{}` — different definitions from what the contract promises, with no diagnostic, and nothing in the Plan forces the escalation.

**Resolution criterion.** `import.meta` is restored to Constraint 1's list; the admission-plugin section names the required behavior (escalate Rolldown's `emptyImportMeta` warning class to a structured stable-code refusal, and/or refuse `MetaProperty` at scan time — note `oxc-parser` even hands back `importMetas: Array<Span>` in its ESM info, making this nearly free); Stage 0.2 adds an `import.meta` fixture to the frozen invalid corpus; and the acceptance matrix gains a fail-closed row for it. Relatedly, the plugin section should state the general **warning policy** (today: `logLevel: 'silent'` plus one escalation, `index.mjs:7745–7747`; Rolldown has a broader default-on `checks`/`onLog` surface) — which warning classes are suppressed, escalated, or surfaced.

### Concern 3 — MATERIAL: the handler-scan parse-mode strategy is unspecified, and the adapter rule as written forecloses the only obvious implementations

**Evidence.** The JS handler scanner parses closed scripts with Acorn's relaxed options — `sourceType: 'script'`, `allowAwaitOutsideFunction`, `allowHashBang`, `allowImportExportEverywhere` (`index.mjs:5090–5096`) — *deliberately*, so that `import`/`export`/`with` in handler files produce the stable authored diagnostics `BUNDLE_UNSUPPORTED_IMPORT`/`EXPORT`/`WITH` (:5236–5257) instead of degrading into `BUNDLE_HANDLER_PARSE_FAILED`. The code comment at :5081–5089 says exactly this, and the `BUNDLE_UNSUPPORTED_EXPORT` message (:5063–5071) exists to close a documented agent dead-end (the 0137 A4 note). `oxc-parser@0.142.0` has **no equivalent options** — its complete `ParserOptions` is `lang`, `sourceType ('script'|'module'|'commonjs'|'unambiguous')`, `astType`, `range`, `preserveParens`, `showSemanticErrors` (verified from `src-js/index.d.ts:159–198`). Script mode errors on `import`/`export`; module mode errors on `with` and sloppy-mode constructs. The Plan's adapter rule "returns no partial-success program when Oxc reports a syntax error" (:168) then forecloses the error-recovery route, leaving Stage 1 with no lawful implementation that preserves this diagnostic family. The Stage 1 gate would *catch* the regression (`authoring-validation.test.mjs` pins `BUNDLE_UNSUPPORTED_EXPORT`), but the Plan's bar is thinking this through before code, and this contradiction is knowable now.

**Resolution criterion.** The parser-projection section names the strategy: e.g., dual-parse (script, then module on specific failure classes) with a defined merge/precedence policy, or a narrowly scoped, explicitly-policied use of Oxc's recoverable errors for exactly the `import`/`export`/`with`-in-script family — and reconciles the "no partial-success program" rule with it (e.g., "…except under the named handler-scan policy").

### Concern 4 — MATERIAL: toolchain-specific diagnostic remap and top-level await are unenumerated

**Evidence.** `index.mjs:7852–7854` remaps esbuild's literal error text (`'Top-level await'` + lineText containing `'import('`) to `CODEGEN_DYNAMIC_IMPORT_UNHASHABLE`. This string-sniff is inherently esbuild-specific and silently stops matching under Rolldown. Bare top-level `await` in a definition module is an observable current refusal (IIFE cannot represent it) that appears nowhere in Stage 0's fixture list (:220–223) or the acceptance matrix. Whether Rolldown errors on TLA-in-IIFE (as Rollup does) I could not confirm from typings — uncertain, needs the Stage 0 corpus. (`await import('./x')` should still be caught earlier as `kind: 'dynamic-import'` at resolve time, preserving the code — but that is an inference, not evidence.)

**Resolution criterion.** Stage 0.2's fixture list adds top-level await in both spellings (bare, and `await import()`), and the Stage 2 section names the esbuild-error-text remap at :7852–7854 as behavior to re-derive under Rolldown rather than port.

### Concern 5 — MATERIAL: the parser adapter must pin concrete Oxc options and span semantics, and two defaults are traps

**Evidence.** (a) `oxc-parser` defaults `preserveParens: true` (`src-js/index.d.ts:180–189`), emitting non-standard `ParenthesizedExpression` nodes; Acorn's default emits none, and the shipped walkers' `unwrapCallable` (`index.mjs:5157–5164`) unwraps `ChainExpression`/`SequenceExpression` but **not** `ParenthesizedExpression` — so under the default, `(eval)(...)`-style spellings would evade the dynamic-code detector. This is a concrete instance of the "narrowing the detector to convenient node shapes" hazard the Plan names generically (:172–174) but does not pin. (b) `oxc-parser` exposes only `range` offsets — there is no `loc`/line/column in the API — while every scanner site reports `node.loc.start.line/column` one-based (e.g., :5135–5137); the adapter must own an offset→line/column derivation, and the offset *unit* (UTF-16 code units, Acorn's behavior, vs UTF-8 bytes) is unstated in the typings and unresolved in the Plan (open question 3 gestures at spans but not at units).

**Resolution criterion.** The adapter section enumerates the option pins (`preserveParens: false`, `astType`, `range: true`, chosen `sourceType` policy per Concern 3) and assigns the adapter the offset→one-based-line/column derivation with an explicit statement of the offset unit contract and a test that proves it on non-BMP source.

### Concern 6 — MINOR: the size table's measurement basis is unstated, and the candidate closure omits two hard dependencies

**Evidence.** I reproduced all sixteen cells exactly; the basis is: sum over {main package + matching platform binding} of actual npm tarball bytes (download) and registry `dist.unpackedSize` (unpacked). The Plan states neither the package set nor the fields. And `rolldown@1.2.1` hard-depends on `@oxc-project/types@0.142.0` (44,577 unpacked / 7,715 download) and `@rolldown/pluginutils` (25,693 / 6,681), which the candidate figures exclude despite the "platform closures" framing (:112–114). Corrected candidate totals: macOS 8,331,825 download / 20,588,451 unpacked; Linux 9,180,595 / 23,712,503. The conclusions survive (candidate still smaller on both platforms) — but the acceptance matrix makes size a *gate* (:333–336), and a gate needs a defined basis.

**Resolution criterion.** The table states its basis (package set summed, registry fields vs tarball bytes) and includes the full resolved dependency closure; Stage 0.4 names the same basis so the gate is anchored to a defined measurement. (Subordinate to Concern 1, which may change these numbers more than the 70 KB does.)

### Concern 7 — MINOR: `require.resolve` fidelity under Rolldown's kind set

**Evidence.** esbuild distinguishes `require-resolve` from `require-call` and the plugin emits distinct message text (`index.mjs:7787–7789`); Rolldown's kinds have `require-call` but no `require-resolve` (binding typings :1688–1700), and whether `require.resolve('./x')` routes through `resolveId` at all is unverified. Same refusal code either way (`CODEGEN_COMMONJS_LOADER_UNHASHABLE`), so this is message-level fidelity, but Stage 2's normalized-diagnostic comparison should name it as an expected-difference candidate rather than discover it.

**Resolution criterion.** One sentence in Stage 2 or the plugin section acknowledging the `require.resolve` mapping question and requiring a fixture for it.

### Concern 8 — MINOR: Rolldown's synthetic runtime module vs deployment-identity input sets

**Evidence.** Rolldown exports `RUNTIME_MODULE_ID = "\0rolldown/runtime.js"` (define-config :2606) — it injects a synthetic helper module into bundles. The deployment identity derives from the metafile input list with exactly one fixed-point exclusion (`generate-deployment-identity.mjs:66–70`); under Rolldown, `moduleIds` will include synthetic ids whenever helpers inject, and the "same input set" acceptance row (:328–330) can fail — or worse, pass while silently hashing a virtual id. Open question 2 (:361–363) is the right question; it should name this concrete fact.

**Resolution criterion.** Open question 2 (or Stage 3.1) names synthetic/virtual module ids (`\0`-prefixed, `RUNTIME_MODULE_ID`) as an input-set class needing an explicit disposition (exclude-and-document, mirroring the existing fixed-point exclusion).

## 4. Suggestions (non-blocking)

- **State where TypeScript handler lowering happens and add it to the comparison surface.** The comment at `index.mjs:5386–5388` says TS handler emission "is still produced by esbuild later"; identity is safe (it hashes authored bytes, :2597–2600), but the Stage 2 semantic comparison should explicitly include emitted handler artifacts for `.ts`/`.mts` handlers so an oxc-transform lowering difference is a compared surface, not an assumed one.
- **Name `absWorkingDir`/resolution-root parity** (`index.mjs:7737`) in the plugin requirements — cheap insurance against subtle relative-resolution differences.
- **The census classes are good; add the disposition owner per row.** Stage 3.3 requires "an owner and reason" for frozen exemptions; the table itself could carry the same discipline.
- **Consider stating the `sourceType: 'unambiguous'` and `'commonjs'` modes are *not* used** by the adapter — both invite admission ambiguity at exactly the boundary this Plan is protecting.
- **Record the reproduction script for the size table** (a ~30-line registry fetch) beside the Plan or in Stage 0 tooling, so the gate's baseline is one command.

## 5. Open questions the author must answer

1. What is the disposition for `inline-handlers.mjs`'s `Program`/`TypeChecker` use — retain TypeScript in the shipped codegen closure (and restate the size story), or replace symbol resolution with a designed syntax-only mechanism under a no-narrowing gate? (Concern 1)
2. How will the Oxc adapter preserve `BUNDLE_UNSUPPORTED_IMPORT`/`EXPORT`/`WITH` given no relaxed script mode: dual-parse with a defined precedence, or a scoped recoverable-error policy — and how is that reconciled with the "no partial-success program" rule? (Concern 3)
3. Is the `import.meta` refusal plugin-owned (warning-class escalation), parser-owned (`MetaProperty`/`importMetas` scan), or both — and under which diagnostic code? (Concern 2)
4. What is the adapter's offset-unit contract (UTF-16 code units vs UTF-8 bytes), and who converts for one-based column reporting? (Concern 5)
5. Does Rolldown hard-error on bare top-level await in IIFE output, and what code does that error map to? (Concern 4 — needs Stage 0 empirical fixture)
6. Can Rolldown's built-in CJS handling and default-on `checks` be configured so no interop path engages before the Snapback plugin's load-time refusal? (extends the Plan's own :196–199 skepticism to the load/transform side)
7. Vite/Rolldown version coherence (existing OQ1) — after Concern 1's disposition, does the deduplication argument for the React shape still hold?

## 6. Readiness verdict

**VERDICT: NOT READY**

Blocking list:
1. **Census omission** — `packages/snapback-codegen/inline-handlers.mjs` (TypeScript `Program`/`TypeChecker` at :515, imported by `index.mjs:79`) is absent from the inventory; Stage 1.4 is unexecutable as written and the size-table conclusion is unsupported until its disposition is recorded; the Stage 0 census must be binary-tolerant (the file's NUL byte defeats standard text search).
2. **`import.meta` fail-open hazard** — dropped from Constraint 1's list (present in `llp/0010:374–376`), absent from the plugin requirements, Stage 0 fixtures, and the acceptance matrix; enforced today only by an untested `logOverride` (`index.mjs:7747`); Rolldown substitutes `{}` behind a default-on warning, so the Plan as written can ship a silent widening no gate would catch.

Material items 3–5 (handler-scan parse-mode strategy, TLA/error-text remap enumeration, adapter option/span pins) should be resolved in the same revision; they are text-level fixes fully determinable without writing code, which is exactly this program's bar. With those addressed, the Plan's architecture, constraints, gates, and rollback policy are sound, and I would expect a second round to converge quickly.

## Orchestrator verification (outside the verbatim body)

Spot-checks run by the orchestrating session against the working tree, all
**confirmed**:

- `packages/snapback-codegen/inline-handlers.mjs:1` imports `typescript`;
  `:515` is `ts.createProgram([path], compilerOptions, compilerHost).getTypeChecker()`;
  `:139` calls `checker.getSymbolAtLocation`; `:449–457` `canonicalAst`
  serializes TypeScript numeric `SyntaxKind` values into the string that
  `:474–478` hashes as the helper content hash; `index.mjs:79` imports it.
- `packages/snapback-codegen/package.json:83–85` declares `acorn`, `esbuild`,
  and `typescript` as **runtime** dependencies of the published package.
- `llp/0010-agent-dx-and-acceptance.spec.md:373–375` does list `import.meta`
  in the fail-closed set; `packages/snapback-codegen/index.mjs:7747` is the only
  enforcement (`logOverride: { 'empty-import-meta': 'error' }`).
- `packages/snapback-codegen/index.mjs:5090–5096` uses the relaxed Acorn
  script-mode options with the code comment the review quotes.
- A binary-safe repository sweep for direct `esbuild` / `acorn` / `typescript`
  imports returns exactly the inventory table's eight surfaces plus
  `inline-handlers.mjs` (and, per the Codex-family review,
  `scripts/check-package-export-types.mjs`, verified independently at `:77`,
  `:212`, `:222`, `:232–233`).


## Round 2 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context, not resumed from round 1)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository; mutually blind — barred from `llp/reviews/` and from any path containing `super-refine`, and given no round-1 finding; network reachable, and the reviewer **installed the pinned tools** (`rolldown@1.2.1`, `oxc-parser@0.142.0`) in a scratch sandbox and ran empirical probes of parser option defaults, offset units on non-BMP input, script/module error behavior, `import.meta` in IIFE output, the resolve `kind` set, and `RUNTIME_MODULE_ID`; size figures re-measured from `registry.npmjs.org`; target = v0.2, SHA-pinned
**Target SHA-256:** `a54731feca22f1804d4a9e325de80c5fdc6a4a581778ae97ea75e8427105e04a`
**Instruction SHA-256:** `61ba1e85fc07385b511979a4e9110e4940a1ed26cb1c22005e621e5fbf87dde5`
**Status:** completed

## Verbatim review

# LLP 0140 v0.2 — Independent review (Fable family, round 2 capsule)

**Target hash:** `a54731feca22f1804d4a9e325de80c5fdc6a4a581778ae97ea75e8427105e04a` — computed via `shasum -a 256 llp/0140-vite-rolldown-oxc-convergence.plan.md`; **matches** the capsule's expected hash. Reviewed as-is on disk (720 lines, uncommitted).
**Date:** 2026-08-01.

**Method note.** I read the full target document and verified its claims against: `packages/snapback-codegen/index.mjs` (every cited line span: 31, 79, 345–348, 603–645, 4781–4823, 4976–5031, 5075–5383, 5090–5096, 5135–5137, 5157–5164, 5236–5257, 5386–5659, 5661–5729, 5760–5775, 7423–7462, 7465–7518, 7690–7870, 8174–8204), `packages/snapback-codegen/inline-handlers.mjs` (:132–178, :280–539, NUL byte located at line 625), `scripts/check-package-export-types.mjs`, `scripts/check-contract-meta.mjs`, `packages/snapback-client/browser-closure.test.mjs`, `scripts/snapback-package-cold-install.mjs`, `cloudflare/scripts/generate-deployment-identity.mjs`, `cloudflare/test/harness.mjs`, both demo rows, and the cited sections of LLP 0009/0010/0030/0041/0108/0118. I ran binary-safe repository-wide searches for first-party `esbuild`, `acorn`, and TypeScript-API use. Network was available: I fetched live figures from `registry.npmjs.org` (tarball byte lengths measured by full download; `dist.unpackedSize` from version metadata) and **installed the pinned tools** (`rolldown@1.2.1`, `oxc-parser@0.142.0`) in the scratchpad, empirically testing parser option defaults, offset units on non-BMP input, script/module-mode error behavior, `import.meta` handling in IIFE output, the resolve `kind` set, and `RUNTIME_MODULE_ID`. I did not read anything under `llp/reviews/` or any `super-refine` file. What I could not verify: actual dual-run behavior of a ported plugin (requires implementation), and whether `require.resolve('./x')` reaches Rolldown's `resolveId` (the Plan itself flags this unverified — OQ5).

## 1. Overall assessment

This is a strong, unusually honest Plan. The census is line-accurate where it has rows; the six enumerated Acorn responsibilities exactly match the six `parseJavaScript` call sites in `index.mjs`; the inline-handler identity constraint is precisely grounded in code and in LLP 0108's normative text; the governing-text conflict with LLP 0010 is real and correctly refused as an inheritance; the D-1 framing converts v0.1's size claim into an honest conditional, and the D-1 delta arithmetic reproduces exactly from live registry totals. Several hazards the Plan asserts about the tools are true and I confirmed them empirically: `preserveParens` defaults to `true` and would let `(eval)(...)` evade `unwrapCallable`; Rolldown substitutes `{}` for `import.meta` in IIFE output behind a warning; `polyfillRequire` and `tsconfig` discovery default on; the resolve `kind` set has `require-call` and no `require-resolve`; `"\0rolldown/runtime.js"` is real.

But the capsule's warning about newly added text proved out. The v0.2-added **handler-scan parse-mode policy** — a normative section that mandates a choice between two designs — is premised on empirically false claims about `oxc-parser@0.142.0`: script mode does *not* error on `import`/`export` by default, module mode does *not* error on `with` by default (both error only under `showSemanticErrors: true`, and even then the full AST including the `ImportDeclaration`/`WithStatement` nodes is returned), while the relaxation Acorn actually provides that oxc script mode lacks — `allowAwaitOutsideFunction` — goes unmentioned. The section's two "must adopt one of" options solve a problem the real tool does not have, in the shape the real tool does not have it. Additionally, three cells of the v0.2-restated Linux size table disagree with the registry and with the table's own totals, and the acceptance matrix's download-size row contradicts the Plan's own D-1b projection. These are exactly the classes of defect the Plan's execution gates would trip over or, worse, "fix" by silently rewriting the policy mid-implementation.

VERDICT: NOT READY

## 2. Strengths

- **The Acorn census is complete and exact.** The six enumerated responsibilities (Plan §"The Acorn responsibilities, enumerated") correspond one-to-one to the six `parseJavaScript` call sites: `packages/snapback-codegen/index.mjs:4986, 5090, 5664, 5768, 7427, 7469` (import at `:31`). No seventh Acorn site exists. The claim that `:5386-5659` is the only TypeScript AST use in `index.mjs` is exactly right — every `ts.` reference in the file falls inside that span.
- **Constraint 5 (inline-handler identity) is precisely grounded.** `packages/snapback-codegen/inline-handlers.mjs:449-457` does encode numeric TS `SyntaxKind` values plus token text; `:474-478` hashes it under `snapback:inline-helper-content:v1`; `packages/snapback-codegen/index.mjs:4781-4823` folds `canonicalAst` and helper `{name, contentHash}` edges into the v1/v2 `implementationHash`. LLP 0108's cited anchors (`llp/0108-inline-handlers-and-result-contracts.spec.md:855`, `:940`) say exactly what the Plan claims, including the export-stripping and byte-identical-v1 regeneration facts.
- **The D-1 discovery and framing.** `inline-handlers.mjs:494-515` really does build a `Program` and `TypeChecker`; `:139` (`checker.getSymbolAtLocation`) really does resolve const aliases inside the reflective-access detector; `:293-347` really does distinguish helper/local/import/top-level bindings via symbol declarations. `oxc-parser` ships no symbol service (verified: its API surface is parse-only). Making this an author decision with both branches costed, and making the size headline conditional on it, is the honest form.
- **The governing-text conflict is real.** `llp/0010-agent-dx-and-acceptance.spec.md:375-376` says "admits literal relative/file edges only"; the shipped resolver admits absolute paths (`index.mjs:7805-7806`) and an exactly-two-entry package allowlist (`index.mjs:345-348`). Refusing to inherit the disagreement is right.
- **The `preserveParens` hazard is real and important.** Verified empirically: `oxc-parser@0.142.0` default parse of `(eval)(x)` yields callee type `ParenthesizedExpression`; with `preserveParens: false` it yields `Identifier`. The shipped `unwrapCallable` (`index.mjs:5157-5164`) unwraps only `ChainExpression` and `SequenceExpression`. This is a genuine detector-evasion trap the pin closes, and finding it before implementation is exactly what a Plan at this bar should do.
- **The `import.meta` fail-open claim is empirically true.** A real `rolldown@1.2.1` build of an `import.meta.url` module to IIFE emitted `console.log({}.url)` plus a `EMPTY_IMPORT_META` *warning*. And the "no fixture behind it" claim checks out: every `import.meta` occurrence in `packages/snapback-codegen/*.test.mjs` is `import.meta.url`-style plumbing; no fixture feeds `import.meta` through the definition graph and asserts refusal. The current enforcement is exactly the one `logOverride` at `index.mjs:7747`.
- **Rolldown facts verified against the shipped 1.2.1 package:** `tsconfig` default `true` (discovers user tsconfig), `output.polyfillRequire` default `true`, `checks.emptyImportMeta` exists, `codeSplitting` boolean exists, `platform: 'neutral'` exists, resolve `kind` set is `'import-statement' | 'dynamic-import' | 'require-call' | 'import-rule' | 'url-token' | 'new-url' | 'hot-accept'` (no `require-resolve` — the fixture-not-discover item is well aimed), `RUNTIME_MODULE_ID = "\0rolldown/runtime.js"` (`rolldown/dist/index.mjs:20`), and `moduleParsed`/`getModuleIds` both exist. The two hard runtime deps (`@oxc-project/types`, `@rolldown/pluginutils`) match the registry metadata.
- **The admission-plugin requirements section is near-complete against the real esbuild path.** I walked `index.mjs:7690-7870` behavior by behavior: facade, refusal families, capability reader (`:7699-7714`), identity-root check, module-format lookup stopping at `node_modules` (`:8190-8204`), unconditional `.cjs/.cts` refusal (`:8175`), entry-source override with authored-bytes identity (`:7833-7838`), `absWorkingDir` (`:7737`), banner intrinsics, silent log level (`:7745`), TLA text sniff (`:7852-7854`). Every one is named in the plugin section or matrix. "Fallthrough is not neutral" and the escalation of the esbuild-string-sniff into re-derivation are exactly right.
- **Measurement basis honesty.** The bun.lock claim verifies (`bun.lock` resolves `acorn@8.17.0`; registry latest is 8.18.0), both macOS tuples and all four totals reproduce byte-for-byte from the live registry, and all eight D-1 delta cells recompute exactly from the stated totals.
- **Stage 2.3** (re-qualify the IIFEs inside the real permission-denied evaluator subprocess, not the parent) closes the gap most migrations of this shape leave open, and correctly re-cites `LLP 0010#generated-artifacts` (whose NUL-framing and evaluated-value strictness text at `llp/0010:373-400` I verified says what constraint 4 claims).

## 3. Concerns

### C1 — BLOCKING: the handler-scan parse-mode policy is premised on empirically false oxc-parser behavior

**Evidence.** The Plan asserts: "`oxc-parser` has no equivalent relaxation: script mode errors on `import`/`export`, module mode errors on `with`" and mandates the adapter "must therefore adopt one of" dual-parse or scoped recovery, naming that choice "the sole exception to the no-partial-success rule." I tested `oxc-parser@0.142.0` (the version the Plan itself prices):

- `parseSync('t.js', 'import x from "y";', { sourceType: 'script' })` → **0 errors**, and `program.body[0].type === 'ImportDeclaration'`. Same for `export`.
- `parseSync('t.js', 'with (a) { b; }', { sourceType: 'module' })` → **0 errors**, `WithStatement` node present.
- Both error **only** under `showSemanticErrors: true` — and even then the complete AST is still returned alongside the error (`ImportDeclaration`, `WithStatement` nodes intact).
- The relaxation gap that actually exists is the one the Plan never names: Acorn's `allowAwaitOutsideFunction` (`index.mjs:5093`) has no oxc script-mode equivalent — `await fetch(1)` at top level in script mode errors ("`await` is only allowed within async functions and at the top levels of modules"), though again with a fully recovered AST.
- A second unnamed asymmetry: `showSemanticErrors: true` reports classes Acorn *also* reports as hard parse errors (`let a; let a;` redeclaration) that the oxc **default** silently admits — so the pinned disposition of `showSemanticErrors` is load-bearing for scanner parity in both directions, not a footnote. A definition file Acorn refuses today (`BUNDLE_HANDLER_PARSE_FAILED` via redeclaration) parses clean under oxc defaults.
- Third: HTML comments (`<!--`) hard-error in oxc module mode but are legal in script mode — relevant if any parse-mode change is contemplated.

The section's forced binary is therefore wrong-shaped: oxc's model is "always recover, always return the full program, classify errors" — meaning the stable `BUNDLE_UNSUPPORTED_IMPORT`/`EXPORT`/`WITH` diagnostics are derivable from the AST of a *single* parse in essentially any mode, and the design question is actually "which error classes from which pinned mode are fatal, advisory, or mapped to authored diagnostics," including TLA-in-script and the `showSemanticErrors` class list. This is a material correctness defect in a normative v0.2-added section; executing Stage 1 as written would force the implementer to discover mid-flight that both mandated options are premised on behavior the tool does not have.

**Resolution criterion.** The section restates oxc's measured behavior at the pinned version (default recovery with full AST; `showSemanticErrors` gating for module/script-mismatch classes; script-mode TLA error; module-mode HTML-comment error), derives the parse-mode policy from those facts (naming the pinned `sourceType`, the pinned `showSemanticErrors` value, and an enumerated fatal/advisory/mapped disposition per error class), names redeclaration-class parity fixtures in the Stage-0 corpus, and reconciles the result with the "no partial-success program" rule (which, as written, would forbid using oxc's recovered AST at all when any error is present — including the very errors the stable diagnostics depend on).

### C2 — MATERIAL: the census omits a shipped first-party TypeScript-transform surface, and the census tool spec cannot see its class

**Evidence.** `packages/snapback-contract/exact-package.mjs:163-173` registers a module loader that runs `node:module`'s `stripTypeScriptTypes(source, { mode: 'transform', ... })` — full TypeScript lowering (the comment at `:149-151` says transform mode is required because the Exact tree uses non-erasable syntax), hosted by the swc-based amaro bundled in Node. The file ships in the published `@expo/snapback-contract` package (`packages/snapback-contract/package.json:29`, subpath export at `:111-113`). This is first-party, non-type-checking TypeScript transform authority in the public closure — precisely the class the Summary says the migration "audits ... for the same move" — and it appears nowhere in the inventory table. Moreover, the Stage-0.1 ledger is specified as a "binary-safe parser and package-manifest walk" over "imported package and API": a package-import walk is structurally blind to builtin-hosted transform authority (`node:module`, `node:vm`, `Function` constructors), so the census tool as specified would re-miss this row. The Plan's own standard applies: "A census tool that can miss a file is not a census."

**Resolution criterion.** The inventory gains a row for `packages/snapback-contract/exact-package.mjs` with an explicit disposition (declared exception seems defensible — it lowers *Exact's own checkout sources* for optional dev integration, not admitted user definitions — but that must be said, with an owner), and the Stage-0.1 ledger spec is widened to enumerate builtin-hosted transform/parse APIs, not only imported packages.

### C3 — MATERIAL: three cells of the Linux baseline size rows are wrong, and the unpacked rows do not sum to the table's own total

**Evidence.** Measured 2026-08-01 against `registry.npmjs.org` (full tarball downloads; `dist.unpackedSize` from metadata):

- Linux Rolldown-set download: table **8,137,883**; registry sum (`rolldown` 189,418 + `@rolldown/binding-linux-x64-gnu` 7,934,369 + `@oxc-project/types` 7,715 + `@rolldown/pluginutils@1.0.1` 6,681) = **8,138,183** (−300 in the table).
- Linux oxc-set download: table **1,042,712**; registry (`oxc-parser` 137,027 + `@oxc-parser/binding-linux-x64-gnu` 905,385) = **1,042,412** (+300 in the table). The two errors cancel, so the candidate total 9,180,595 is right.
- Linux Rolldown-set unpacked: table **20,175,809**; registry sum = **20,175,715** (+94). Here the errors do *not* cancel: the table's own rows sum to 20,175,809 + 3,536,788 = **23,712,597**, but its stated candidate total is **23,712,503** — the table is internally inconsistent, and the total (not the row) matches the registry. The implied per-tuple `@rolldown/pluginutils` figures also differ between the macOS rows (which imply 1.0.1 exactly) and the Linux rows (which imply sizes matching no published version).

Every macOS cell, every total, and all eight D-1 delta cells reproduce exactly, so the conclusions stand — but Stage 0's gate says "the size receipt reproduces §Baseline size facts," which is unsatisfiable for these three cells, and the capsule-relevant point is that this is v0.2-restated text presented as registry fact.

**Resolution criterion.** The three Linux cells are corrected to registry values (or the actual measurement that produced them is stated and shown to differ from the registry for a stated reason), the `@rolldown/pluginutils` version used per tuple is pinned in the table's basis paragraph, and rows are shown to sum to totals.

### C4 — MATERIAL: the acceptance matrix's download-size row contradicts the Plan's own D-1b projection

**Evidence.** The matrix row reads: "headless and React installs do not regress **download** size. **Unpacked** size must improve ... under D-1a; under D-1b the measured regression in §Baseline size facts is accepted explicitly by Charlie ..." The download clause is unconditional, but the Plan's own D-1b table shows download regressions of +3,746,522 (macOS) and +4,284,445 (Linux). The carve-out sentence grammatically modifies only unpacked. As written, a D-1b execution cannot pass this row.

**Resolution criterion.** The download clause is conditioned on D-1 exactly as the unpacked clause is (or the row is split into D-1a and D-1b variants with their respective bounds).

### C5 — MINOR: the offset-unit fact is stated backwards for the pinned version

**Evidence.** The Plan asserts "`oxc-parser` exposes byte-range offsets and no `loc`," framing UTF-8 bytes as what the tool gives and UTF-16 as the conversion target. Empirically at 0.142.0: no `loc` (confirmed), but node spans *and* error-label spans arrive in **UTF-16 code units** at the napi boundary (a statement after a non-BMP string literal starts at offset 6, not byte offset 8; an error after the same prefix labels start 12, not 14). OQ3 honestly says the unit must be answered empirically and "the public typings do not" — but the design section states the wrong answer as fact, and a reader implementing from the section rather than the OQ would build the wrong conversion. Non-blocking because the mandated non-BMP frozen-corpus proof would catch it.

**Resolution criterion.** The sentence is restated as the empirical finding at the pinned version (UTF-16 code units at the JS boundary, no `loc`), with the corpus proof retained as the guard against upstream regression of that conversion.

### C6 — MINOR: two gate-command/manifest nits in v0.2's "every gate names an executable command" claim

**Evidence.** (a) Stage 3's gate names `bun run cloudflare:accept`; the repository script is `cf:accept` (`package.json:22`). (b) The pinned Rolldown option manifest names `output.legalComments: none`; at 1.2.1 that option is deprecated in favor of `comments.legal` ("When both ... are set, `comments.legal` takes priority" — `rolldown/dist/shared/define-config-DSMNXceb.d.mts:864`), so the pin as spelled rides a deprecation. (c) The Stage-0 gate's command is the placeholder `scripts/<census>.mjs` — acceptable for a Plan, but it sits under a v0.2 header claiming every gate is "bound ... to a named command."

**Resolution criterion.** `cf:accept` (or a new alias) is named; the manifest pins `comments.legal` (or both spellings with precedence noted); the census script gets its real name or the placeholder is flagged as Stage-0-defined.

### C7 — MINOR: the ripgrep "silently skip" claim is overstated

**Evidence.** The NUL byte is real (`inline-handlers.mjs:625`, offset 22296). But `rg` without `-a` does not silently skip the file: it prints `binary file matches (found "\0" byte around offset 22296)` in match mode and lists the file under `-l`; what it actually does is truncate the search at the NUL, missing matches after line 625 and suppressing match display. The operational conclusion — a text-grep census is unreliable on this file — is correct; the mechanism description is not, and a census-tool author reading it might test the wrong failure mode.

**Resolution criterion.** The sentence describes the truncate-at-NUL behavior (matches after line 625 of 883 are lost; display degrades to a binary notice) rather than "silently skip."

### C8 — MINOR: the pinned option manifest omits a syntax-target row

**Evidence.** The current esbuild call pins `target: ['es2022']` (`index.mjs:7741`), which is a syntax-lowering commitment, and the plugin section requires "one in-memory ES2022 IIFE" — but the pinned Rolldown option manifest table has no row saying where that target is set (Rolldown's lowering lives in its transform options, not a top-level `target` mirror) or whether the policy is "no downleveling, refuse newer syntax." Determinism of output bytes across tool versions depends on this being explicit.

**Resolution criterion.** The manifest gains a row pinning the syntax-target mechanism (or an explicit "no downleveling; ES2022+ syntax passes through" disposition with a fixture).

## 4. Suggestions (non-blocking)

- **Home the Stage-0 ledger check in the existing authority checker.** `scripts/check-toolchain-authority.mjs` already CI-asserts exact versions for miniflare/typescript/workerd/wrangler; the toolchain authority ledger check is the same discipline and could extend it rather than adding a parallel script.
- **Add a sensitivity leg to the Stage-3 deployment-identity gate.** The gate proves identity *unchanged* for unchanged sources; the metamorphic row proves sensitivity for codegen artifacts only. One fixture proving a changed handler input changes the Cloudflare deployment identity under the Rolldown-derived ledger would close the symmetric failure (an identity that never changes passes the stated gate).
- **Consider stating the scan-time/bundle-time consistency obligation once.** Several refusals (`import.meta`, dynamic import, TLA) will now exist twice — in the Oxc scan and in the Rolldown plugin. A one-line invariant ("every dual-implemented refusal class has a fixture asserting both fire on the same input") would prevent drift between Stages 1 and 2.
- **Note the local/origin numbering skew.** `origin/main` already contains `llp/0141-embeddable-rust-library.rfc.md` while this working tree ends at 0139 + untracked 0140; 0140 is unclaimed on origin as of `c5da4e3d`, so the number is safe, but landing should re-verify given the concurrent-session fleet.
- **`sourceType: 'unambiguous'` refusal:** good pin; consider also asserting in a test that the adapter *rejects* configuration drift (an assertion over the adapter's own option object), matching the "asserted in a test rather than assumed" discipline the Rolldown manifest already has.

## 5. Open questions the author must answer

1. (From C1) With oxc's always-recover model, what is the actual fatal/advisory/mapped disposition table per error class, per pinned mode — and is `showSemanticErrors` on or off for each scanner? The answer changes admission behavior in both directions (redeclarations admitted vs. new refusal classes appearing).
2. (From C1) Do any accepted handler-corpus fixtures use top-level `await` under the current `allowAwaitOutsideFunction` relaxation, and what is the intended authored diagnostic for it under oxc?
3. (From C2) Is `exact-package.mjs`'s `stripTypeScriptTypes` loader a declared exception (Node-builtin, checkout-scoped) or a migration target — and does the "one family" architecture claim tolerate a third transform stack (amaro/swc) permanently in the shipped closure?
4. (From C5/OQ3) Given offsets are UTF-16 at the pinned version, is the adapter's declared unit simply "UTF-16, assert-and-convert-nothing," with the corpus proof guarding upstream changes to the napi conversion?
5. D-1 timing: Stage 1 step 2 ports six scanners before D-1's branch point is reached in step 4, but the section header says D-1 is recorded at step 0 "because Stage 1's step ordering ... differ[s] between the branches." Which steps concretely differ under D-1a vs D-1b? Stating that would prove the scheduling claim rather than asserting it.

## 6. Readiness verdict

**VERDICT: NOT READY**

Blocking list:

1. **C1** — the handler-scan parse-mode policy (a normative v0.2 addition) asserts empirically false behavior of `oxc-parser@0.142.0` in both directions (script-mode `import`/`export` and module-mode `with` do not error by default; the real gaps — TLA-in-script, `showSemanticErrors` class asymmetry including redeclarations, module-mode HTML comments — are unnamed), and both mandated design options plus the "sole exception to the no-partial-success rule" framing are built on that premise.

Material list (must also be resolved for the stated bar, but each is a bounded edit):

2. **C2** — census omission of the shipped `stripTypeScriptTypes` transform surface in `@expo/snapback-contract`, plus the census-tool spec's structural blindness to builtin-hosted transform authority.
3. **C3** — three wrong Linux cells in the baseline size table, one internal row/total inconsistency, under a Stage-0 gate that requires reproducing the section.
4. **C4** — the acceptance matrix's unconditional "do not regress download size" row is unsatisfiable under the Plan's own D-1b projection.

The direction, the census discipline, the constraint set, the staging, and the rollback policy are otherwise sound, and the majority of the document's tool-facts survived adversarial empirical checking. Fixing C1 correctly is not a large edit — the measured behavior actually makes the adapter *simpler* than the Plan fears — but it is a rewrite of a normative section from corrected premises, and under the program's stated bar that must happen on paper before code moves.

## Orchestrator verification (outside the verbatim body)

The orchestrator independently re-ran the decisive probes against the same
installed `oxc-parser@0.142.0`. **All of C1 and C5 confirmed:**

| Probe | Result |
| --- | --- |
| `import x from "y"` / `sourceType: 'script'` | 0 errors, `ImportDeclaration` returned |
| `export const a = 1` / `script` | 0 errors, `ExportNamedDeclaration` returned |
| `with (a) { b; }` / `module` | 0 errors, `WithStatement` returned |
| same two, `showSemanticErrors: true` | 1 error each ("Cannot use import statement outside a module"; "'with' statements are not allowed"), **full AST still returned** |
| `await fetch(1)` / `script` | 1 error ("`await` is only allowed within async functions and at the top levels of modules"), AST recovered — the real gap, unnamed in v0.2 |
| `await fetch(1)` / `module` | 0 errors |
| `let a; let a;` default | **0 errors** (Acorn hard-errors) |
| `let a; let a;` + `showSemanticErrors` | 1 error |
| `<!--` comment / `script` vs `module` | 0 errors vs 1 error ("HTML comments are not allowed in modules") |
| non-BMP offset | statement after `const s = "😀😀"; ` starts at **18** = the UTF-16 length — offsets are UTF-16 code units, not bytes |
| `(eval)(x)` default vs `preserveParens: false` | `ParenthesizedExpression` vs `Identifier` |

C3's arithmetic was re-derived from an independent registry measurement and is
correct: the Linux Rolldown-set unpacked **row** (20,175,715) was wrong, not the
total. C4, C6(a), C6(b), and C7 confirmed against `package.json:22`,
`rolldown/dist/shared/define-config-DSMNXceb.d.mts:864`, and the NUL offset. C2
confirmed at `packages/snapback-contract/exact-package.mjs:163-173` and
`packages/snapback-contract/package.json:29,111-113`.


## Round 3 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context, not resumed)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository; mutually blind — barred from `llp/reviews/`, from any `super-refine` path, and from any prior reviewer's `.md` text left in the scratchpad; network reachable; reused the round-2 npm sandbox (`oxc-parser@0.142.0`, `rolldown@1.2.1`) and wrote its own `r3-` probes, re-fetched all 13 package tarballs, and re-derived both size tables and both D-1 delta rows; target = v0.3, SHA-pinned
**Target SHA-256:** `6da4672cb6827bf32e6545f09c8ebab64a39d1d56c47c8927bd2e01e72e61629`
**Instruction SHA-256:** `52cdfa6671ee1f14edde4f49e4899913b2a4c7a0f504233b95c130295da1fc4c`
**Status:** completed

## Verbatim review

# LLP 0140 v0.3 — Fable-family adversarial review (round 3)

**Target hash (computed):** `6da4672cb6827bf32e6545f09c8ebab64a39d1d56c47c8927bd2e01e72e61629` — **matches** the capsule's expected SHA-256. Reviewed as-is from the working tree (961 lines).
**Date:** 2026-08-01.

**Method note.** I read the full target document and verified its claims against the repository and the live tools rather than taking them on faith. Code: `packages/snapback-codegen/index.mjs` (the esbuild call, resolver, all six Acorn call sites, the TS scanner, the implementation-hash assembly), a binary-safe (Python) read of `packages/snapback-codegen/inline-handlers.mjs`, `packages/snapback-codegen/file-read-capability.mjs`, `packages/snapback-contract/exact-package.mjs` and its manifest, `scripts/check-package-export-types.mjs`, `scripts/check-contract-meta.mjs`, `scripts/check-toolchain-authority.mjs`, `scripts/snapback-package-cold-install.mjs`, and repository-wide sweeps for esbuild/acorn/TypeScript/`node:vm`/`stripTypeScriptTypes` authority. LLP anchors: I confirmed every cited section heading in LLPs 0009, 0010, 0030, 0041, 0049, 0108, and 0118 and read the anchored text. Tools: I reused the sandbox at `<scratchpad>/r2-tools` (`oxc-parser@0.142.0`, `rolldown@1.2.1` confirmed installed) and wrote my own `r3-` probes — I reproduced the parser error-class table, the `preserveParens`/`(eval)` hazard, the UTF-16 offset measurement, the `importMetas` claim, the `require.resolve`/`resolveId` probe, the `EMPTY_IMPORT_META` fail-open, `RUNTIME_MODULE_ID`, the option-manifest names and defaults, and the esbuild 0.28.1 import-attribute probe (both `with` and `assert` spellings). Network was available: I re-fetched all 13 package tarballs and registry metadata and recomputed both size tables and both D-1 delta rows byte-for-byte. Per the blindness rules I read nothing under `llp/reviews/`, no `super-refine` files, and none of the prior reviewers' `.md` text in the scratchpad. Not verified: musl binding sizes (out of scope by the document's own glibc pin), Oxc's TypeScript *transform* option-by-option behavior (the Plan defers this to a Stage-1 feature matrix, which I judge adequate), and any claim about Rolldown versions other than 1.2.1.

---

## 1. Overall assessment

This is a strong, unusually honest migration plan. Its census of first-party tool authority is — with the small exceptions noted below — complete and correct against the repository; its size tables reproduce cell-for-cell from the live registry today, including the unflattering D-1b row; its measured claims about `oxc-parser@0.142.0` and `rolldown@1.2.1` reproduce exactly under independent probes, including the subtle ones (`preserveParens` default emitting `ParenthesizedExpression` nodes that would evade the shipped `unwrapCallable`; UTF-16 offsets at the N-API boundary; `require.resolve` never reaching `resolveId`; `EMPTY_IMPORT_META` warn-and-substitute fail-open). The constraint set is the right one, the gates mostly name executable commands and real scripts, the disposition classes for dual-run differences are bounded so "weakened admission" can never be dispositioned away, and the rollback point survives past the production switch until the two-tuple proof.

Three material defects keep it short of the program's "no flaws" bar, and all three sit in exactly the place the capsule predicted: text v0.2/v0.3 newly wrote. First, the NUL-census paragraph — the foundation of the Plan's "a census tool that can miss a file is not a census" argument — is internally contradictory (it places the `createProgram` evidence at `:515` "after" a NUL it locates at line 625) and misstates the measured behavior of ripgrep and grep in both search modes. Second, the pinned Rolldown option manifest requires `comments.legal: none`, which is a measured hard error at 1.2.1 (the option is a boolean). Third, the Plan treats the `showSemanticErrors:false` silent-widening problem as one or two cases (redeclaration, top-level await) when the probe data it cites actually demonstrates a structural class: *all* early/semantic errors are off by default, so the set of constructs Acorn rejects today that oxc would silently admit is enumerable only from Acorn's side, and neither the corpus nor the acceptance matrix currently requires that enumeration. Each fix is cheap; none is optional under the stated bar.

VERDICT: NOT READY

## 2. Strengths

- **The census is real and checks out.** An exhaustive sweep found exactly the seven first-party esbuild importers the table lists (`packages/snapback-codegen/index.mjs:33`, `packages/snapback-client/browser-closure.test.mjs:14`, `cloudflare/scripts/generate-deployment-identity.mjs:16`, `cloudflare/test/harness.mjs:12`, `scripts/snapback-package-cold-install.mjs` (template emission at `:2346`, verified), `demos/competitive-checkpoint/.../bundle-runtime.mjs:5`, `demos/signal-desk/tests/react-query-group.mjs:21`), exactly one Acorn importer (`index.mjs:31`), and exactly the three TypeScript importers rowed (`index.mjs:34`, `inline-handlers.mjs:1`, `scripts/check-contract-meta.mjs:6`) plus the dynamic load at `scripts/check-package-export-types.mjs:77` and the `stripTypeScriptTypes` loader at `packages/snapback-contract/exact-package.mjs:163-173` (files entry `package.json:29`, subpath export `:111-113`) — every row's "current role" is true as stated.
- **Every cell of the size tables reproduces.** I re-fetched all 13 tarballs from `registry.npmjs.org` and recomputed both platform tables and both D-1 delta rows; all 34 numbers match byte-for-byte (e.g. macOS current total 8,962,771 / 34,911,651; Linux D-1a delta −93,023 / −12,032,828). The lock-vs-fresh-install caveat is also correct: `bun.lock:379` resolves `acorn@8.17.0` under spec `^8.17.0` while a fresh install selects 8.18.0. The measurement basis is stated precisely enough that my independent script reproduced it exactly — the strongest possible answer to capsule question 5.
- **The measured oxc claims are all true at 0.142.0.** My probe reproduced all eight rows of the error-class table in both modes (script-mode `import`/`export` = 0 errors with nodes returned; module-mode `with` = 0 errors with `WithStatement` returned; script `await` = 1 error with recovered AST; `let a; let a;` = 0 errors default / 1 with semantics on; HTML comment split). `(eval)(x)` yields `ParenthesizedExpression` by default and `Identifier` under the pin, and the shipped `unwrapCallable` (`index.mjs:5157-5164`) indeed unwraps only `ChainExpression`/`SequenceExpression` — the evasion hazard is real and the pin is load-bearing exactly as claimed. The statement after `const s = "😀😀"; ` starts at offset 18 (UTF-16), `loc` is absent, `module.importMetas` carries spans, and every pinned option name (`lang`, `sourceType` including the warned-against `'unambiguous'`/`'commonjs'`, `astType`, `range`, `preserveParens`, `showSemanticErrors`) exists in the typings.
- **The measured Rolldown claims are all true at 1.2.1** (except the one value defect in Concern C2): `resolveId` receives only `{isEntry, kind, custom}` — no position; the `kind` union is exactly the seven listed values with no `require-resolve`; `require.resolve("./x")` never reached `resolveId` and survives verbatim in output; `import.meta` in IIFE output produces `warn:EMPTY_IMPORT_META` and emits `{}.url` — fail-open exactly as constraint 1 warns; `RUNTIME_MODULE_ID = "\0rolldown/runtime.js"`; `output.polyfillRequire` `@default true`; `tsconfig` `@default true` with discovery; `transform.target` `@default 'esnext'`; the `legalComments` deprecation note in the typings matches the Plan's wording verbatim.
- **The v0.3 import-attribute correction is right.** esbuild 0.28.1 bundles both `with { type: "json" }` and the legacy `assert` spelling, and passes `args.with = {"type":"json"}` to `onResolve`, which the shipped resolver (callback at `index.mjs:7783`) never reads; oxc 0.142.0 parses both spellings with zero errors. Preserving the admission and fixturing both spellings as valid is the correct non-semantic-rewrite posture.
- **The Acorn responsibility enumeration is complete and honest about implicit behavior.** The six `parseJavaScript` call sites in `index.mjs` (`:4986`, `:5090`, `:5664`, `:5768`, `:7427`, `:7469`) map one-to-one onto the six enumerated responsibilities, the TS scanner at `:5386/:5391` is the seventh, and the "currently implicit" behaviors Stage 1.2 names are real code: issue dedup via a seen-set (`:5111-5131`), first-error-only TS reporting (`:5398`), the conservative `BUNDLE_HANDLER_PARSE_FAILED` fallback (`:5100-5108`), and the masked textual fallback (`maskCommentsAndStrings`, `:6259`).
- **The identity constraints are correctly grounded.** `canonicalAst` at `inline-handlers.mjs:449-457` encodes numeric `SyntaxKind` plus token text, `helperContentHash` at `:474-478` hashes it, and both flow into the v1/v2 `implementationHash` at `index.mjs:4785-4823`; the `TypeChecker` construction at `:494-515` and `getSymbolAtLocation` const-alias resolution at `:139` are exactly as the D-1 row describes. The "no silent rotation" constraint and the D-1a behavioral-oracle requirement are the right shape for this hazard.
- **The governing-text conflict is surfaced, not inherited.** `llp/0010-agent-dx-and-acceptance.spec.md:375` really says "admits literal relative/file edges only," and the shipped resolver really admits absolute-local paths (`index.mjs:7802-7806`) and a two-entry package allowlist (`index.mjs:345-348`, used at `:7793`). Forcing Stage 4 to reconcile the texts is exactly right.
- **The anchors are near-uniformly correct.** All cited sections in 0009 (`:774`, `:956`), 0010 (`:330`, `:312`, `:746`, `:819`), 0030 (`:603`, `:623`), 0041 (`:297`, `:946`), 0049 (`:997`), 0108 (`:555`, `:855`, `:940`, `:237`), and 0118 (`:179`, `:668`) exist and say what the Plan claims — including the fussy slugs with em-dashes and dates. The one mis-anchor is Concern C4.
- **The gates name real things.** `cf:accept` exists (`package.json:22`), `scripts/check-toolchain-authority.mjs` exists and already CI-asserts exact versions as claimed, workspace names match the `bun run --filter '@expo/snapback-codegen'` spelling, and the bounded disposition classes plus the deployment-identity sensitivity leg ("an identity that never changes cannot pass by never moving") make Stage 2/3 gates genuinely falsifiable rather than restatements.
- **The `import.meta` "no fixture behind it" claim is true**: the only escalation is `logOverride: {'empty-import-meta': 'error'}` at `index.mjs:7747`, and no codegen test exercises `import.meta` as a definition-graph input (every test hit is the tests' own `import.meta.url` plumbing).

## 3. Concerns

**C1 — MATERIAL. The NUL-census paragraph is internally contradictory and misstates measured tool behavior.**
Evidence: The paragraph (§Current first-party inventory) says ripgrep and grep "*truncate the search at the NUL*, losing every match in lines 626–883," and explains the v0.1 miss as: "the `import ts from 'typescript'` at line 1 is before the NUL, but the `createProgram`/`getTypeChecker` evidence at `:515` is after it." I measured the file: the NUL is at line 625 / byte offset 22,296, and `createProgram`/`getTypeChecker` are at line 515 / offset 18,229 — *before* the NUL in both line and byte order. The sentence contradicts the paragraph's own "line 625" three lines earlier. I then measured the tools (ripgrep 15.1.0, BSD grep): (a) in **recursive** mode — how a census sweep actually runs — `rg -n createProgram .` from `packages/snapback-codegen/` reports *nothing at all* for this file, silently, including for pre-NUL matches, directly contradicting "do not silently ignore the file"; (b) with an **explicit file argument**, rg found a token that exists *only after* the NUL (`SNAPBACK_INLINE_HELPER_CYCLE`, line 629) and reported "binary file matches" — so the search is *not* truncated at the NUL; what is lost is line attribution for **all** matches, pre- and post-NUL alike; (c) `grep -c` counts post-NUL matches fine. The remedial design (binary-safe parser walk, NUL-bearing self-test) is correct and, in recursive mode, *more* necessary than the Plan says — but a v0.3 whose Revised header advertises empirically-grounded rewrites cannot rest its census argument on a false mechanism and an arithmetic self-contradiction.
Resolution criterion: rewrite the paragraph to the observed behavior — recursive sweeps silently omit the entire file (all 883 lines, no notice); explicit-file invocations degrade to a line-less "binary file matches" for every match, not just post-NUL ones — delete or correct the ":515 is after it" sentence (the true story is "line-oriented output is lost for the whole file"), and either pin the grep-tool versions the claim was measured against or drop the mechanism claim in favor of the measured outcomes.

**C2 — MATERIAL. The pinned option manifest's `comments.legal | none` row is an invalid value at the pinned Rolldown version.**
Evidence: `CommentsOptions.legal` is typed `boolean` (rolldown 1.2.1, `dist/shared/define-config-DSMNXceb.d.mts:342`, attached to `OutputOptions.comments` at `:881`). Probe: passing `comments: { legal: 'none' }` to `generate()` is a hard error — "Invalid type: Expected boolean but received \"none\"" — while `comments: { legal: false }` works and strips a `/*! ... */` comment. The row's *why* text (deprecation of `output.legalComments`, priority rule) is verbatim-correct, but the required value is not expressible. Since the table is declared to be generated from the versioned JSON manifest that production and tests consume, this row as written would fail its own assertion gate.
Resolution criterion: the row reads `comments: { legal: false }` (or `comments: false`), and the manifest also states the `annotation`/`jsdoc` sub-options' pins (both default `true`; for byte determinism they should be deliberately chosen, not inherited).

**C3 — MATERIAL. Silent admission-widening is treated as two cases when the Plan's own measurements show it is a class.**
Evidence: my probes confirm `showSemanticErrors: false` (the default) suppresses the *entire* semantic/early-error family — the redeclaration case the Plan fixtures is one member. Other members Acorn rejects today via throw (→ `BUNDLE_HANDLER_PARSE_FAILED` per `index.mjs:5100-5108`) will be silently admitted by a default-mode oxc parse unless the pin enables semantic errors or each construct is separately fixtured: strict-mode violations, getter/setter arity, duplicate parameter names, legacy octal escapes, and the rest of the early-error catalogue. The Stage-1 error-class disposition rule enumerates *oxc's* error classes per pinned mode — but classes suppressed by the pin never appear in any oxc output, so the table structurally cannot see this direction. The acceptance matrix's "redeclaration parity" row names one instance; the Stage-0 corpus adds one fixture. Nothing requires the widening direction to be enumerated from *Acorn's* rejection set, which is the only side that can enumerate it. A passing run as specified would leave "no construct Acorn refuses today is silently admitted" proven only for two anecdotes.
Resolution criterion: the Plan states a mechanism that enumerates the widening direction from the current tool's behavior — e.g. Stage 0 derives invalid-corpus fixtures from Acorn's early-error productions (its `raise` sites or the ECMA-262 early-error list), or Stage 1 runs a differential-acceptance sweep (Acorn verdict vs pinned-oxc verdict) over a generated input set — and the acceptance matrix's redeclaration row is generalized from "a construct" to "every enumerated construct Acorn rejects that the pinned mode would admit."

**C4 — MINOR. The "Two distinct invariants" quote is mis-anchored.**
Evidence: "exactly one empty npm-tree entry at the CLI's opposite, platform-filtered optional-runtime edge" is quoted verbatim from `llp/0041-packaged-dev-loop.rfc.md:423`, which sits under "Nine-package candidate promotion — 2026-07-28" (`:371`), not under "Runtime distribution" (`:297`), which the Plan cites (`LLP 0041#runtime-distribution`). v0.3's header claims four citations were re-anchored; this one still points at the wrong section, in a paragraph whose entire purpose is not conflating two invariants.
Resolution criterion: the quote cites `LLP 0041#nine-package-candidate-promotion--2026-07-28` (keeping `#runtime-distribution` for the general packaging posture is fine).

**C5 — MINOR. Three first-party `node:vm` compilation sites are absent from the census table that the Plan's own recognizer will ledger.**
Evidence: the Stage-0 recognizer spec names `node:vm` as builtin-hosted transform/parse authority, and the checker's self-tests must include one; but `tests/allowlist_install_v0.mjs:3`, `tests/action_fetch_fence_v0.mjs:5`, and `admin-ui/tests/setup-credential-errors.mjs:7` each import `node:vm` and appear in no table row (the evaluator's own vm use inside `index.mjs:7612` is at least implicitly covered by the load-bearing row). These are test-side evaluation fences, not migration surfaces — but "every row of the table below must map to a ledger record" invites the inverse check, and a mechanically generated ledger will surface them as unexplained on day one.
Resolution criterion: either a table row (or a stated class, "evaluator-fence test uses of `node:vm`, disposition: retained, owner: test suite") covers them, or the census section states that ledger records with no table row are expected for recognizer classes beyond the three migrated tools.

**C6 — MINOR. Small line-citation drift in three places.**
Evidence: `target: ['es2022']` is at `index.mjs:7742`, not `:7741`; the "absolute-local paths and an exact, two-entry Snapback-package allowlist" citation `index.mjs:7817-7838` actually points at the `onLoad` extension/module-format checks — the allowlist is defined at `:345-348` and consulted at `:7793`, absolute-local admission at `:7802-7806`; "shadowed-global precedence (`:409`)" — line 409 opens the `inspect` function, while the shadow-resolution comment and logic are at `:420-432`. Every underlying claim verified true; only the pointers drift.
Resolution criterion: the three citations are corrected (or widened to honest ranges).

**C7 — MINOR. The `build()` rejection rests half on an unverifiable label.**
Evidence: "it is experimental and writes to disk by default" — the disk-write default is verified (`rolldown/dist/index.mjs:42-48` routes to `build.write(...)` unless `write` is falsy), but nothing in the 1.2.1 package marks `build()` experimental (typings at `define-config-DSMNXceb.d.mts:1262-1275` carry no such tag). The decision is right; the stated reason is half right.
Resolution criterion: the sentence rests on the verified fact (disk writes by default; no `close()` discipline) and drops or sources the "experimental" label.

## 4. Suggestions (non-blocking)

- **Consider a module-mode single parse for handler scans.** Measured at 0.142.0: in `sourceType: 'module'` with defaults, `import`/`export` are ordinary legal nodes, `with (a) { b; }` still returns a `WithStatement` with **zero** errors, and top-level `await` is legal — which would derive all three `BUNDLE_UNSUPPORTED_*` diagnostics from node presence *and* close design-question 1 (the top-level-await gap) without a new diagnostic. The cost is two new divergences to fixture: `await` as an identifier (legal in script, reserved in module) and HTML comments (legal in script, an error in module — Acorn under the current options parses `<!-- c`, verified). The Plan already fixtures HTML-comment-adjacent inputs; add an `await`-as-identifier fixture and this alternative becomes decidable on evidence.
- **Close OQ6 now, with the same rigor the document applies elsewhere:** measured at 1.2.1, bare top-level await under `format: 'iife'` is a hard build error — `[UNSUPPORTED_FEATURE] Top-level await is currently not supported with the 'iife' output format`. The open question can become a stated fact plus the code-mapping decision.
- **Name `experimental.attachDebugInfo: 'none'` in the option manifest.** Measured: the default emits `//#region ../../../.../side.mjs` comments embedding cwd-relative paths into output bytes — checkout-position-dependent bytes that the generic "experimental/debug output | disabled" row covers only if the implementer knows which option to disable. Setting `'none'` removes them (verified). Since every other load-bearing row names its exact spelling, this one should too.
- **Record the `@oxc-project/types` coherence constraint explicitly:** rolldown 1.2.1 pins `=0.142.0` exactly while `oxc-parser` wants `^0.142.0`; the single-copy pricing in the candidate total holds only while the two packages' versions stay coherent. §Toolchain custody's "exact and coherent" rule covers this in spirit; one sentence tying the size table to it would prevent a future surprise dedup regression.
- **Note that `treeshake: false` is not statement preservation.** Measured: with `treeshake: false`, an unused imported binding (`const s = 12345`) is still eliminated from IIFE output and `export const y = 2` is rewritten to `exports.y = 2`; module-level side effects are kept. The manifest row's rationale ("declaration side effects must not be optimized out") holds, but anyone expecting esbuild's `treeShaking: false` statement-level fidelity in the dual-run byte comparison should be warned that only value/effect identity, not statement identity, survives.
- The handler-scan section could state explicitly that the current `MetaProperty`/`import.meta` handling in the handler walker (`index.mjs:5240-5244`, mapped to `BUNDLE_UNSUPPORTED_IMPORT`) is preserved by the single-parse design — it falls out of node presence, but the section's import/export/with enumeration omits it.

## 5. Open questions for the author

1. (= C3) What enumerates the Acorn-rejects/oxc-admits widening set — early-error catalogue fixtures, differential sweep, or per-scanner `showSemanticErrors: true` with a mapped-class table? The Plan must pick a mechanism, not a pair of examples.
2. (= C1) Which invocation mode will the binary-safe census checker's self-test simulate — recursive sweep (silent whole-file omission) or explicit-file (line-attribution loss)? The self-test should assert the failure mode the real sweep would hit.
3. Do any current handler fixtures use `await` as an ordinary identifier? The answer decides whether the module-mode single-parse alternative (Suggestions) is free or needs an authored diagnostic, and it also sharpens existing OQ5.
4. Under D-1b, does the retained TypeScript dependency stay at the workspace-pinned 5.9.3 in the published codegen closure, and does the D-1b acceptance row's "within 5%" tolerance track TypeScript's own version growth or freeze against 5.9.3? The projection is priced at exactly one TS version.
5. For the Stage-3 identity spike: are Rolldown's plugin-context `getModuleIds()`/`moduleParsed` (both verified present at 1.2.1) the intended cross-check surface, and is the `\0rolldown/runtime.js` synthetic module's exclusion from deployment identity decided before or during the spike?

## 6. Readiness verdict

**VERDICT: NOT READY**

Blocking list (all MATERIAL, all narrowly fixable):

1. **C1** — rewrite the NUL-census narrative to the measured rg/grep behavior and fix the internally contradictory line-order sentence (`:515` is before the NUL at line 625, not after it).
2. **C2** — correct the pinned option manifest's `comments.legal` row to a value Rolldown 1.2.1 accepts (`{ legal: false }`), and pin the sibling comment classes.
3. **C3** — commit to a mechanism that enumerates the `showSemanticErrors`-off admission-widening class from Acorn's rejection set, and generalize the acceptance matrix's redeclaration row accordingly.

Everything else I checked — the census sweep, all 34 size-table numbers, all eight LLP anchor families, all six Acorn call sites, the inline-handler identity plumbing, and every measured oxc/Rolldown claim except the one option value — verified clean. With the three blockers addressed, this Plan would meet the bar: I found no unsound sequencing, no incoherent rollback state, no missing constraint, and no load-bearing assumption about the tools that the tools do not actually satisfy.

## Orchestrator verification (outside the verbatim body)

Independently re-probed and **confirmed**: `comments: { legal: 'none' }` fails at
Rolldown 1.2.1 (`Expected boolean but received "none"`; `CommentsOptions.legal`
is `boolean` at `define-config-DSMNXceb.d.mts:342`); default IIFE output carries
`//#endregion` debug markers, so `experimental.attachDebugInfo` needed an
explicit pin; bare top-level await under `format: 'iife'` is a hard
`[UNSUPPORTED_FEATURE]` build error, which converts v0.3's OQ6 into a fact; and
`inline-handlers.mjs`'s NUL is at line 625 while `createProgram`/
`getTypeChecker` sit at line 515 — v0.3's ordering sentence was simply wrong and
is deleted in v0.4. C3's structural point is accepted: v0.4 commits to
`showSemanticErrors: true` plus a differential Acorn-versus-oxc acceptance sweep
rather than fixturing anecdotes.

The Codex-family round-3 review independently found the same `comments.legal`
and `attachDebugInfo` defects and added one this review did not reach: v0.3's
identity-rollout row rested on LLP 0108's predecessor/successor tuple protocol,
which `llp/0108:701-709` explicitly **removed**. Both findings are applied.


## Round 4 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context, not resumed)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository; mutually blind — barred from `llp/reviews/`, from any `super-refine` path, and from prior reviewers' scratchpad text; network reachable; reused the `r2-tools` sandbox for live probes of `oxc-parser@0.142.0` and `rolldown@1.2.1` plus the repository-installed `esbuild@0.28.1` and `acorn@8.17.0`, reproduced the full size table from `registry.npmjs.org`, and reproduced both NUL census failure modes with ripgrep 15.1.0 and BSD grep; target = v0.4, SHA-pinned
**Target SHA-256:** `154cf6b5f1031d7b0ab977ce4b9755e09f7ba55b7b0a2488969e3a683bd7ae26`
**Instruction SHA-256:** `980472bfb402eaf39e9c79e2a1ac4a0c68c5fe2fa7bcfec763095c02d26f5513`
**Status:** completed

## Verbatim review

**Target hash (computed):** `154cf6b5f1031d7b0ab977ce4b9755e09f7ba55b7b0a2488969e3a683bd7ae26` — **matches** the capsule's expected SHA-256 for `llp/0140-vite-rolldown-oxc-convergence.plan.md` (1,097 lines, uncommitted working-tree file).
**Date:** 2026-08-01.
**Reviewer:** Fable-family independent reviewer, round 4 (v0.4 of the document).

**Method note.** I read the full target document, then verified its load-bearing claims directly rather than assuming them: I opened every file named in the inventory table and checked every `file:line` citation in the document against the working tree (`packages/snapback-codegen/index.mjs`, `inline-handlers.mjs` via binary-safe Python because of its NUL byte, `file-read-capability.mjs`, `packages/snapback-contract/exact-package.mjs` and its `package.json`, `scripts/check-package-export-types.mjs`, `scripts/check-contract-meta.mjs`, `scripts/snapback-package-cold-install.mjs`, `scripts/check-toolchain-authority.mjs`, `packages/snapback-client/browser-closure.test.mjs`, `cloudflare/scripts/generate-deployment-identity.mjs`, `cloudflare/test/harness.mjs`, both demo esbuild surfaces); I swept the repository for first-party esbuild/Acorn/TypeScript-compiler-API uses the table might omit; I resolved every cited LLP anchor and read the cited sections (LLPs 0009, 0010, 0030, 0041, 0049, 0108, 0118); I reproduced the NUL census failure modes with ripgrep 15.1.0 and BSD grep; I reproduced the entire baseline size table cell-for-cell from `registry.npmjs.org` (network was available); and I ran live probes of `oxc-parser@0.142.0` and `rolldown@1.2.1` in the provided `r2-tools` sandbox (writing only `r4-*` scratch files), plus probes of the repository-installed `esbuild@0.28.1` and `acorn@8.17.0`, covering both claims the capsule flags as "measured" and several more. I did not read anything under `llp/reviews/`, any `super-refine` file, or any prior-review text in the scratchpad. Not verified: Rolldown's documented `esnext` transform default and the `build()`-writes-to-disk claim (docs-level, made moot by the Plan's pins), the `polyfillRequire: true` default-synthesis claim (my probe exercised only the external-`require` case), and the exact `ImportKind` string list beyond the behavioral fact that `require.resolve` never reaches `resolveId`.

---

# 1. Overall assessment

This is a strong, unusually honest Plan, and v0.4's newly added material survives adversarial checking almost everywhere I pressed on it. The inventory census is complete against my independent sweep — every first-party direct use of esbuild, Acorn, and the TypeScript compiler API in the repository is either a table row or a comment-only mention, and my own TS-API sweep *missed* `inline-handlers.mjs` because of its NUL byte, vividly confirming the census-tool requirement the Plan builds in. Every one of the roughly forty `file:line` citations I checked resolves to exactly the claimed code. Every LLP anchor exists and says what the Plan claims it says, including the LLP 0010:373 "literal relative/file edges only" conflict the Plan flags rather than inherits, and the LLP 0108 §B removal of `ExpectedOperationV1` that v0.4's rollout-rule constraint is rebuilt on. The full size table — thirteen packages, six rows per tuple, both totals, and all eight D-1 delta cells — reproduces byte-for-byte from the registry today under the stated basis. Both capsule-flagged measured claims reproduce exactly at the pinned versions: the eight-row parser-mode table (including the `let a; let a;` default-admission and the script/module HTML-comment split), and the esbuild import-attribute admission probe (`args.with = {"type":"json"}` delivered to and ignored by the resolver). The additional measured claims also reproduce: `preserveParens` default yielding a `ParenthesizedExpression` callee for `(eval)(x)` that the shipped `unwrapCallable` (index.mjs:5157-5164) would not unwrap; UTF-16 offsets (18 for the emoji fixture); the `OxcError` shape with no stable code (`severity, message, labels, helpMessage, codeframe` — the v0.4 replacement of the unimplementable error-class table with Snapback-owned structural categories is the right fix); `comments.legal: 'none'` hard-erroring while booleans are accepted; the default `attachDebugInfo` emitting checkout-position-dependent `//#region ../../…/main.js` markers and `'none'` removing them; the exact `UNSUPPORTED_FEATURE` TLA/iife error; `require.resolve` left verbatim with `resolveId` never invoked; `treeshake: false` still eliminating unused bindings; the `buildStart` normalized-options object omitting exactly `tsconfig`/`treeshake`/`transform`/`external`/`checks`; and `EMPTY_IMPORT_META` as a *warning* with `{}` substituted into the IIFE — confirming constraint 1's fail-open characterization. I also adversarially probed the one place I suspected the Plan had the as-built facts wrong — whether the current esbuild path honors a user `tsconfig.json` — and the Plan is right: esbuild honors it for disk-loaded files but *not* for plugin-loaded contents, and the shipped path loads everything through the plugin, so the `tsconfig: false` pin and the "must not take effect" fixture expectation are parity, not narrowing.

Two defects remain, both in the "gates are real gates" dimension the Plan sets as its own standard: the Stage-2→Stage-4 "unreleasable" window is enforced only by prose, with no named executable guard, in a repository where multiple concurrent sessions run the standing publication lane; and Stage 0.2 classifies the `let a; let a;` fixture on the **valid** side, which contradicts both the Plan's own committed `showSemanticErrors: true` position and the acceptance matrix's no-widening row that treats the same input as Acorn-rejected. Both are cheap to fix, but the first can ship an unproven closure and the second, followed literally, freezes a corpus that contradicts the Plan's own gate.

VERDICT: NOT READY

# 2. Strengths

- **The census is complete and the census-tool requirement is empirically grounded.** My independent repository sweep found no first-party esbuild/Acorn/TS-parser authority outside the table; all other `esbuild` mentions (`admin-ui/brand-mark.contract-meta.ts:7`, `cloudflare/src/coordinator.js:77`, `packages/snapback-cli/index.mjs:2126`, `packages/snapback-harness/workerd/allowlist.mjs:4`, etc.) are comments. The NUL claims reproduce exactly: `inline-handlers.mjs` line 625 is a NUL-join cycle-key sentinel; a recursive `rg` sweep returns *nothing* for the file, and an explicit-file search collapses to a line-less "binary file matches" notice — and my own recursive TS-API sweep silently missed the file, which is the Plan's point.
- **The two hardest inventory rows are exactly right.** `inline-handlers.mjs:494-515` really builds a single-file `Program` + `TypeChecker`; `:139` really is `checker.getSymbolAtLocation` inside const-alias resolution; `:449-457` really encodes numeric `SyntaxKind` + token text; `:474-478` really hashes it. The second identity carrier is real: `index.mjs:2384-2392` hashes the authorizer canonical AST into `snapback.asset-intent-implementation.v1`. And `packages/snapback-contract/exact-package.mjs:163-173` really ships `stripTypeScriptTypes(…, { mode: 'transform' })` in the published package (`package.json:29`, exports `:111-113`) — recording that third transform stack as a scoped exception is exactly the honesty a "one family" claim needs.
- **The Acorn responsibilities enumeration matches the code precisely** — all six ranges plus the TS scanner (`index.mjs:4976-5031`, `:5075-5383` with the relaxed parse at `:5090-5096`, `:5661-5729`, `:5760-6257`, `:7423-7462`, `:7465-7518`, `:5386-5659`), and the implicit behaviors named for porting (dedup/ordering at `:5657-5658`, conservative textual fallbacks at `:4976-5031`) exist.
- **The single-parse handler-scan design is measured, correct, and simpler than the alternative.** The AST-presence facts (default script parse returns `ImportDeclaration`/`ExportNamedDeclaration`/`WithStatement` with zero errors) reproduce exactly, the `MetaProperty` mapping at `:5240-5244` is real, and the top-level-await gap and `showSemanticErrors` bidirectionality are correctly identified as the *actual* design questions. Acorn 8.17.0 under the shipped options confirms the claimed today-behavior for all six probe inputs.
- **The v0.4 corrections are all correct against the tools.** `comments.legal` as boolean (probed: `'none'` is a hard error), `experimental.attachDebugInfo: 'none'` (probed: default emits position-dependent region markers into the IIFE bytes — a real determinism/identity hazard the pin closes), the structural-category error disposition (probed: `OxcError` has no discriminant), and the corrected NUL narrative (probed: both failure shapes, neither truncation).
- **The size argument is now honest and fully reproducible** — every cell, sum, and D-1 delta matches a fresh registry measurement under the stated basis; the lock-vs-fresh-install Acorn note (`bun.lock:379` = 8.17.0, latest = 8.18.0) is accurate; the `=0.142.0` vs `^0.142.0` custody coupling (rolldown's and oxc-parser's manifests) is accurate.
- **The fixture-gap claim is true**: handler tests cover `import` and `import()` (`authoring-validation.test.mjs:440-441`) but no test anywhere exercises `import.meta` refusal, and `empty-import-meta` appears only at `index.mjs:7747` — so constraint 1's "no fixture behind it" and the acceptance matrix's "the fixture proving it is new" are correct, and the fail-open Rolldown default I probed makes the escalation genuinely load-bearing.
- **Gate commands are real**: `scripts/check-toolchain-authority.mjs` exists to extend, `cf:accept` (`package.json:22`), `scripts/verify-local-proof`, `scripts/check-guide.mjs`, both templates (`packages/snapback-cli/templates/{react,todo-contract}`), and the client/codegen test entries all exist; the React starter already pins `vite ^8.0.0` and Vite 8.2.0 is the live latest.
- **Stage 3's sensitivity leg** ("an identity that never changes cannot pass by never moving") and Stage 4's terminal post-removal proof ("must not prove one package and publish another") close two classic false-pass modes; the bounded disposition classes in the Stage-2 gate ("weakening … is never a permitted disposition") are a real gate, not a restatement.

# 3. Concerns

**C1 — MATERIAL. The "repository-default but unreleasable" window has no executable guard.**
Evidence: §Rollback and failure policy states "no package publication or served capability may reference a Rolldown-generated closure before the Stage-4 terminal post-removal proof passes" (target lines 1032-1036), and Stage 2.5 defers removal until the Stage-4 two-tuple proof — but no gate, script, or receipt check enforces the prohibition. Every other safety property in this Plan gets a named command and manifest; this one is prose. During the window, the standing publication and staged-proof lanes would pass on their own receipts (nothing in `packages/snapback-codegen/package.json`'s test entry or the publication discipline knows about the 0140 corpus), and this repository demonstrably runs concurrent sessions that publish. Executing the Plan exactly as written therefore leaves a contract (cross-tuple semantic equality, terminal-closure equivalence) enforceable only by every future session remembering a sentence in a Draft plan.
Resolution criterion: the Plan names an executable guard for the window — e.g., the publication/staged-promotion proof (or `check-toolchain-authority.mjs --ledger`) fails whenever the codegen closure's default bundler is Rolldown and `llp/receipts/0140-stage4.json` is absent, or whenever the dual implementation is still present in a package being published — and adds a corresponding row to the acceptance matrix.

**C2 — MATERIAL (coherence). Stage 0.2 misclassifies the redeclaration fixture as valid.**
Evidence: Stage 0.2 lists "**Valid**-side additions: … and a redeclaration case (`let a; let a;`) that Acorn rejects today" (target lines 738-744). Three other passages contradict that classification: the pinned-matrix section commits `showSemanticErrors: true` as "the Plan's position, not an execution-time choice" (under which oxc rejects the input — probed: 1 error); the today-behavior table says Acorn rejects it (probed: `Identifier 'a' has already been declared`, i.e., a `BUNDLE_HANDLER_PARSE_FAILED` today); and the acceptance matrix's no-widening row commits the same input as a case Oxc must *refuse* ("`let a; let a;` is one committed case, not the criterion", lines 940-943). Followed literally, Stage 0 freezes a corpus that records as valid an input whose retained baseline (Stage 0.3) is a refusal — the contradiction fires at the first gate, but a frozen corpus is the one artifact the whole Plan's evidence chain hangs from, and its classification text must not be self-contradictory.
Resolution criterion: the redeclaration case is moved to the invalid/refused side (or to an explicitly named "pin-evidence" class) with its expected verdict stated under the committed `showSemanticErrors: true` pin, consistent with the acceptance matrix row.

**C3 — MINOR. D-1 selection criterion (a) understates D-1b's costs, including a deferred identity-rotation exposure.**
Evidence: §Decisions says the decision artifact must record "(a) whether the D-1b size regression … is acceptable, **since that is the only cost of D-1b**" (target line 357-359), but the D-1b bullet itself names a second cost ("leaves two parser stacks in the shipped package", line 316), and there is an unnamed third: under D-1b the canonical AST permanently encodes TypeScript numeric `SyntaxKind` values (`inline-handlers.mjs:449-457`), and `SyntaxKind` numbering is not stable across TypeScript releases — so any future TS version change is itself a potential identity migration. This is not a silent hazard (the exact `"typescript": "5.9.3"` pin, the Stage-0 retained hashes, and tracked generated artifacts such as `demos/competitive-checkpoint/snapback/generated/api.mjs:33` pin absolute `implementationHash` values, so a rotation fails loudly), but it is a real asymmetry the D-1 decision-maker should see: D-1a pays the rotation once; D-1b defers it to every future forced TS upgrade.
Resolution criterion: criterion (a) drops "only," and the D-1b branch (or constraint 5) states that under D-1b a TypeScript version change is a declared identity-migration event, bounded by the exact-pin custody rule.

**C4 — MINOR. Two small measured-claim inaccuracies in the dual-run cautions.**
Evidence: "`export const y = 2` still becomes `exports.y = 2`" — measured output at 1.2.1 is `const y = 2; … exports.y = y;` (and cross-module const inlining occurs: an imported `d = 41` folded into `const y = 42` in my probe). The substance (statement identity does not survive; only value/side-effect identity does) is correct and the oracle choice is unaffected. Also, the warning-policy section names the class `emptyImportMeta` while the runtime log code is `EMPTY_IMPORT_META` (the camelCase form is the `checks` option key); the Plan should say which surface — `checks` config or `onLog` code matching — implements the escalation, since that is exactly the kind of drift its own unknown-warning policy exists to catch.
Resolution criterion: the caution reads "is rewritten to an `exports` assignment" (or quotes actual output), and the warning policy names the escalation surface.

**C5 — MINOR. The D-1b size-acceptance tolerance is structurally ambiguous.**
Evidence: the acceptance row measures "against the resolved headless and React install closures rather than the component table," then satisfies D-1b by "matching the §Baseline size facts D-1b projection within 5%" (lines 994-1000) — a component-table *delta* compared against a resolved-closure *measurement* without saying whether 5% applies to the delta or to closure totals, and resolved closures contain packages outside the component set.
Resolution criterion: the row states the comparand explicitly (e.g., "the before/after resolved-closure delta matches the projected delta within 5%").

# 4. Suggestions (non-blocking)

1. **Record the tsconfig parity evidence.** The manifest row's "Why" for `tsconfig: false` describes only Rolldown's default. The load-bearing fact is that the *current* path also ignores user tsconfig — but only because every load goes through the plugin (probed: the same esbuild call honors `useDefineForClassFields` from a user tsconfig for disk-loaded files, and ignores it for `onLoad`-provided contents). One sentence recording this stops a future reader from misreading `tsconfig: false` as a narrowing, and explains *why* the "must not take effect" fixture is parity.
2. **Input-option validation is a warning, not an error, at 1.2.1** (probed: a bogus `experimental.attachDebugInfo` value logs "Invalid input options" and proceeds). The Plan's manifest-assertion-plus-behavior-test design already covers this, but stating the fact would justify the design to implementers.
3. **Add a standing re-run rule**: any Rolldown/Oxc/TypeScript version change after Stage 4 re-runs the frozen corpus and cross-tuple digests before the lock lands. §Toolchain custody implies it; the acceptance matrix never says it, and every measured behavior in this Plan is version-tagged for exactly this reason.
4. **`@rolldown/pluginutils` pricing carries the same fresh-install caveat as Acorn** (rolldown declares `^1.0.0`; the table prices 1.0.1, today's latest). The Stage-0 receipt covers it; a parenthetical would make the basis note complete.
5. Consider naming, in Stage 2, the fixture that proves `require.resolve` is refused *at scan time* — my probe confirms Rolldown's resolver genuinely never sees it, so the Oxc import-edge ledger is the sole preventive detector for that class (evaluation-time `ReferenceError` in the capability-empty subprocess is the backstop), which makes it the one refusal class where "not the sole detector" leans on the evaluator rather than a second static check. The acceptance matrix's both-detectors row should either include it or note the evaluator as its second leg.

# 5. Open questions for the author

1. What is the executable guard for the Stage-2→Stage-4 unreleasable window, and which lane owns it (publication proof, staged promotion, or the ledger check)? (C1)
2. Under the committed `showSemanticErrors: true` pin, what is the frozen corpus's recorded verdict for `let a; let a;` — and, generally, which corpus class holds "pin-evidence" inputs whose purpose is to witness a decision rather than assert an admission? (C2)
3. Under D-1b, is a future TypeScript upgrade a declared identity migration, and who signs off on it? (C3)
4. For the differential Acorn-vs-Oxc sweep: is the generated input set derived from Acorn's early-error productions only, or from its full rejection surface (plain syntax errors included)? The widening direction needs the latter; the fuzzing extension implies it but the text says "early-error productions."
5. The `emptyImportMeta` escalation: `checks` option, `onLog` code matching, or both? (C4)

# 6. Readiness verdict

**VERDICT: NOT READY**

Blocking list:
1. **C1** — the "repository-default but unreleasable" Stage-2→Stage-4 window is enforced by prose only; name an executable publication guard and an acceptance-matrix row for it.
2. **C2** — Stage 0.2's valid-side classification of `let a; let a;` contradicts the committed `showSemanticErrors: true` pin, the measured today-behavior table, and the acceptance matrix's no-widening row; fix the fixture's class and stated verdict.

Both fixes are small and neither reopens the direction, the census, the constraints, the pinned manifests, or the measured tool facts — all of which I checked and which hold. With C1 and C2 resolved (C3-C5 optionally addressed), this document would meet the bar: everything else load-bearing in it survived a maximum-effort adversarial check, including every claim v0.4 newly added.

## Orchestrator verification (outside the verbatim body)

Both blocking items **confirmed** and applied in v0.5: the unreleasable window
now has an executable guard inside `check-toolchain-authority.mjs --ledger`
wired into the publication and staged-promotion proofs, plus its own acceptance
row with a fixture proving the guard fires; and the redeclaration case moved to
the **invalid** side of the Stage-0 corpus with its refusal, code, span,
envelope, and precedence pinned under the committed `showSemanticErrors: true`.
C3, C4, and C5 were also applied.

**C4's first half was re-measured and the correction is sharper than stated.**
Under the *complete* pinned manifest — `minify: false` included — Rolldown 1.2.1
does **not** eliminate the unused binding at all: `const unused = 1; export
const y = 2;` emits `const unused = 1; const y = 2; … exports.y = y;`. The
elimination this review and the v0.4 text both reported comes from omitting
`minify`, where Rolldown inherits a DCE-only default. The Codex-family round-4
review isolated that cause independently. v0.5 rewrites the caution to the
manifest-accurate result and records why the earlier measurement was wrong.

Suggestion 1 (tsconfig parity), suggestion 3 (standing re-run rule on any
version change), and suggestion 5 (`require.resolve` as the one class whose
second leg is the evaluator, not a second static detector) were adopted.


## Round 5 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context, not resumed)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository; mutually blind — barred from `llp/reviews/`, from any `super-refine` path, and from prior reviewers' scratchpad text; network reachable; reused the `r2-tools` sandbox to rerun every measured claim against `oxc-parser@0.142.0` and `rolldown@1.2.1` plus the repository-installed `esbuild@0.28.1` and `acorn@8.17.0`, and re-fetched all 13 package tarballs to recompute both size tables; target = v0.5, SHA-pinned
**Target SHA-256:** `6f9108ed90eb3e20a01fab465283ce9ec77384f1f939b02379973b4f7e60ee2f`
**Instruction SHA-256:** `a418ffa23bb3bc993a88ea639a326fff62d089c793506b9a335edb826a2c8d95`
**Status:** completed

**Round-5 note:** an earlier round-5 launch was killed when the orchestrating process exited; it produced no output and is not recorded. This is a fresh context against the identical SHA-pinned target and capsule.

## Verbatim review

# LLP 0140 v0.5 — Independent review (Fable family, round 5)

**Target hash (computed):** `6f9108ed90eb3e20a01fab465283ce9ec77384f1f939b02379973b4f7e60ee2f` — **matches** the capsule's expected SHA-256, verified with `shasum -a 256` against the working-tree file (1,190 lines).
**Date:** 2026-08-01.

**Method note.** I read the full target document and verified its claims directly against the repository and the pinned tools. Code read: `packages/snapback-codegen/index.mjs` (all ~40 cited line ranges), `packages/snapback-codegen/inline-handlers.mjs` (byte-level, including the NUL), `scripts/check-package-export-types.mjs`, `scripts/check-contract-meta.mjs`, `scripts/check-toolchain-authority.mjs`, `packages/snapback-contract/exact-package.mjs` and its `package.json`, `scripts/snapback-package-cold-install.mjs:2346`, the Cloudflare scripts/harness, `packages/snapback-harness/workerd/strip.mjs`, and `packages/snapback-vite`. LLPs read for anchor verification: 0009, 0010, 0030, 0041, 0049, 0108, 0118. I ran an independent census sweep for first-party `esbuild`/`acorn`/TypeScript-API imports (and separately for `node:vm`/`Function` authority), reproduced the NUL-file silent-skip with ripgrep 15.1.0, and — reusing the `r2-tools` sandbox (`oxc-parser@0.142.0`, `rolldown@1.2.1`) plus the repository-installed `esbuild@0.28.1` and `acorn@8.17.0` — reran every measured claim: the full parser error table, `preserveParens`, UTF-16 offsets, `importMetas`, the Rolldown option-manifest claims (`comments.legal`, `attachDebugInfo`, `treeshake`/`minify` statement preservation, TLA-under-iife, `require.resolve`, `require-call` kind, normalized-option omission, `EMPTY_IMPORT_META`, `\0rolldown/runtime.js`), the type-only-import elision probe on both tools, and the esbuild import-attribute probe. Network was available: I fetched all 13 package tarballs and registry metadata and recomputed every cell of both size tables and both D-1 delta tables. I did not read anything under `llp/reviews/`, any `super-refine` file, or any prior-round review text in the scratchpad. Not verified: musl/other-platform bindings (out of scope by the document's own glibc pin), Test262/Acorn-negative-suite mechanics (feasibility judged, not executed), and cross-tuple Linux behavior (single-host review).

## 1. Overall assessment

This is a very strong Plan — the strongest property being that its factual base is almost entirely real. The census is complete (my independent import sweep found exactly the table's rows and nothing else), the NUL-file hazard is precisely true and my own recursive sweep demonstrably fell into it, every one of the ~40 code citations I opened is accurate, all cited LLP anchors exist and say what the Plan claims, and the size tables are exact to the byte in all twenty cells and both delta tables. Nearly all of the measured tool claims reproduce exactly, including several that would have been easy to state sloppily (the `minify`-omitted DCE correction, the `comments.legal` InvalidArg, the `require.resolve`-never-reaches-`resolveId` asymmetry, type-only-edge elision on both tools).

But the round-5 question is whether executing the Plan exactly as written leaves a contract broken, and for one newly added v0.5 policy the answer is yes. The `top-level-await-in-script` structural category is specified by a recognizer — "an error whose span coincides with a program-level `AwaitExpression` in the recovered AST" — that I measured to be wrong at the pinned versions: Acorn's `allowAwaitOutsideFunction` admits `await` in *any* top-level position (`const v = await f()`, `if (await x)`, `for await (const x of y)`), and only the bare-statement form recovers to a program-level `AwaitExpression`. Under the Plan's own fatal-unmatched default, the other forms — including the most common spelling, an `await` in a declarator initializer — become fatal refusals: a silent admission narrowing of exactly the kind the Plan prohibits, and one the widening-only differential sweep cannot catch and the singular named corpus fixture need not catch. A second measured claim, the `checks.emptyImportMeta` escalation mechanism, is inverted: at Rolldown 1.2.1 that option is a boolean that can only enable or disable a *warning*; it cannot escalate anything to a refusal, so the mechanism the Plan names as primary cannot perform the function, and only the "belt-and-braces" `onLog` path can. Both defects are small to fix and sit in newly written v0.5 text; neither survives the document's own standard.

VERDICT: NOT READY

## 2. Strengths

- **The census is complete and honestly scoped.** My independent sweep for `from 'esbuild'`/`require('esbuild')` found exactly the seven importers in the table (`packages/snapback-codegen/index.mjs:33`, `cloudflare/scripts/generate-deployment-identity.mjs:16`, `cloudflare/test/harness.mjs:12`, `packages/snapback-client/browser-closure.test.mjs:14`, `scripts/snapback-package-cold-install.mjs:2346`, `demos/signal-desk/tests/react-query-group.mjs:21`, `demos/competitive-checkpoint/surfaces/react-expo/scripts/bundle-runtime.mjs:5`); exactly one Acorn import (`index.mjs:31`); and exactly the five TypeScript-API surfaces the table names, including the easy-to-miss `packages/snapback-contract/exact-package.mjs:163-173` `stripTypeScriptTypes` loader, which ships in the published package (`packages/snapback-contract/package.json:29`, export at `:111-113`). Every other repository "esbuild" hit is a comment, lockfile, or manifest whose importer is already a row.
- **The NUL claim is exactly true and materially load-bearing.** `inline-handlers.mjs` has exactly one NUL, at byte 22296, line 625, in `join('\x00')` — and my own recursive ripgrep 15.1.0 sweep silently returned nothing for that file's `import ts from 'typescript'` at line 1. A census tool that can miss the identity-authority file is indeed not a census (`llp/0140-vite-rolldown-oxc-convergence.plan.md:137-150`).
- **The size tables are exact.** All 20 cells (`:254-272`) match registry `dist.unpackedSize` and actual tarball byte lengths I downloaded today, and both D-1 delta rows (`:276-279`) are arithmetically exact against those cells. The "swap is larger in isolation; smaller only under D-1a" framing (`:281-288`) is the honest reading of the numbers. The `@oxc-project/types` `=0.142.0` vs `^0.142.0` custody note (`:1173-1177`) matches the shipped manifests.
- **The measured parser table reproduces cell-for-cell** (`:466-475`), including the two admission-moving cells (`let a; let a;` admitted by default oxc, rejected by Acorn 8.17.0 with the production options at `index.mjs:5090-5096`; refused again under `showSemanticErrors: true`). The `preserveParens` hazard is real: default parse of `(eval)(x)` yields a `ParenthesizedExpression` callee, and the shipped `unwrapCallable` (`index.mjs:5157-5164`) unwraps only `ChainExpression`/`SequenceExpression` — the pin at `:419-423` closes a genuine dynamic-code-detector evasion. UTF-16 offsets confirmed (offset 18 vs 22 UTF-8 bytes, `:438-449`).
- **The Rolldown option manifest is measured, not transcribed, and it held up hard.** `comments.legal: 'none'` is a hard error at generate time (`:616`); TLA under `format: 'iife'` fails with the exact quoted `UNSUPPORTED_FEATURE` text (`:653-658`); `treeshake: false` + `minify: false` preserves `const y = 2; … exports.y = y` while the `minify`-omitted basis of the earlier draft's wrong measurement also reproduces (`:645-653`) — the self-correction is accurate in both directions; the normalized-options object at `buildStart` exposes only `{context, cwd, inner, input, inputPlugins, onLog, platform, shimMissingExports}`, confirming the assert-what's-observable/behavior-test-the-rest split (`:630-643`); the `legalComments` deprecation text matches Rolldown's types verbatim.
- **The resolver-authority analysis is correct and important.** `require.resolve("./x")` is left verbatim and never reaches `resolveId`; the `kind` union in Rolldown's types has no `require-resolve` (verified in `binding-CVtkJvyl.d.mts`); plain `require()` does arrive as `require-call`; and the current esbuild path *does* refuse `require-resolve` at `index.mjs:7787-7789` — so the two-layer ledger and the named scan-only asymmetry (`:686-713`) are exactly what the migration needs. Type-only edges never reach the resolver on either tool (probed on both), so the authored/projected ledger split is measured, not assumed.
- **The import-attribute reversal is verified.** esbuild 0.28.1 bundles `with { type: "json" }` and the legacy `assert` spelling, reporting `args.with = {"type":"json"}` to `onResolve`, which the Snapback resolver at `index.mjs:7783` never reads — so current behavior is admission, and fixing v0.2's wrong invalid-corpus placement (`:722-730`) was right.
- **The governing-text conflict is real.** LLP 0010 line 373 says "literal relative/file edges only"; the shipped resolver admits absolute-local paths (`index.mjs:7802-7806`) and the exact two-entry allowlist (`:345-348`, consulted at `:7793`). Adopting as-built and amending 0010 (`:120-133`) is the correct non-semantic-rewrite posture.
- **The Acorn responsibility enumeration is complete:** exactly six `parseJavaScript(` call sites exist in `index.mjs` (`:4986, :5090, :5664, :5768, :7427, :7469`), matching the six listed responsibilities, plus the single `ts.createSourceFile` handler scanner at `:5391`.
- **Anchor discipline held:** every cited anchor — `LLP 0010#generated-artifacts` (line 330), `#diagnostic-shape` (312), `#ci-and-review-gates` (746), the dated 0010 acceptance profile (819), `LLP 0009#capability-model` (774), `#supply-chain-and-generated-bundles` (956), both 0118 anchors (179, 668), both 0041 anchors plus the nine-package rule (297, 946, 371 with the "exactly one empty npm-tree entry" text at 423-425), both 0030 anchors (603, 623), the 0049 freshness gate (997, whose self-output-exclusion text says what constraint 9 claims), and all three 0108 anchors including §B's removal of `ExpectedOperationV1` (701-709) — exists and supports the claim made on it.
- **The identity story is correct at the code level:** `canonicalAst` encodes numeric `SyntaxKind` plus token text (`inline-handlers.mjs:449-457`), hashed at `:474-478`, flowing into the v1/v2 `implementationHash` (`index.mjs:4785-4823`) and the second carrier `snapback.asset-intent-implementation.v1` (`index.mjs:2384-2392`) — the D-1 framing, the oracle-transcript requirement, and the refusal to assume a predecessor-tuple protocol that LLP 0108 §B removed are all sound.

## 3. Concerns

**C1 — BLOCKING (MATERIAL correctness): the `top-level-await-in-script` recognizer misses most Acorn-admitted top-level-`await` forms, and its span predicate is factually wrong at the pinned version.**
Evidence: the Plan (`llp/0140-vite-rolldown-oxc-convergence.plan.md:488-494`) defines the category as "recognized by an error whose span coincides with a program-level `AwaitExpression` in the recovered AST," non-fatal and admitted, with every unmatched error fatal (`:523-525`). I measured, with the production Acorn options from `index.mjs:5090-5096` (acorn 8.17.0) and `oxc-parser@0.142.0`:

| Input | Acorn (production options) | oxc script mode | Recovered shape |
| --- | --- | --- | --- |
| `await fetch(1)` | ACCEPT | 1 error, label 0–5 | `ExpressionStatement` → program-level `AwaitExpression` (span 0–14) |
| `const v = await fetch(1);` | ACCEPT | 1 error, label 10–15 | `AwaitExpression` nested in `VariableDeclarator.init` — **not** program-level |
| `if (await x) { y() }` | ACCEPT | 1 error, label 4–9 | nested in `IfStatement.test` — not program-level |
| `for await (const x of y) {}` | ACCEPT | 1 error, label 4–9 | `ForOfStatement` — **no `AwaitExpression` node exists at all** |

So (a) three of four currently admitted spellings — including the most natural one, an initializer `await` — have no program-level `AwaitExpression`, are unmatched by the category as written, and therefore go fatal: a silent admission narrowing, which the Plan's own "not a semantic rewrite" rule (`:493-494`) prohibits. (b) Even for the bare form, the error's label span (0–5, the keyword) does not "coincide" with the `AwaitExpression` span (0–14), so the recognizer predicate is unimplementable as literally specified. (c) Neither gate reliably catches this: the differential sweep is explicitly widening-direction-only (`:539-549`, matrix row `:1018-1024`), and the Stage-0 corpus names only "top-level `await` in a handler" as a single fixture (`:809-811`) with the form unspecified. The failure mode is fail-closed (false refusal), not a security hole — but it is a measured-wrong load-bearing category in a document whose authority is precise pinning.
Resolution criterion: restate the category structurally as "an error whose span matches an `await` token whose nearest enclosing function/class-field boundary is the Program" (covering expression-statement, initializer, condition, destructuring, and `for await` forms — the last recognized via `ForOfStatement.await` since no `AwaitExpression` node exists), specify the error-to-category matching predicate (label-span containment/start-equality, not node-span equality) for *all* categories including import/export/with (whose error labels are also keyword-spans, 0–6 for `import` vs node 0–18 — the `:512-521` "recognized from the returned AST and the error's span" text currently leaves the consumption rule undefined when multiple errors are present), and add the variant forms to the Stage-0 corpus by name.

**C2 — MATERIAL: the `import.meta` escalation mechanism is inverted at the pinned version.**
Evidence: `:665-675` states "The escalation is implemented on the `checks` option surface (`checks.emptyImportMeta`) with `onLog` as the belt-and-braces check on the emitted log code (`EMPTY_IMPORT_META`)." Measured at Rolldown 1.2.1: `checks.emptyImportMeta` accepts only booleans (`'error'` is a hard napi type failure: "Expected boolean but received \"error\""); `true` is the default and produces a **warning** (`EMPTY_IMPORT_META`) while the build succeeds and emits the `{}` substitution (`exports.u = {}.url` — confirming constraint 1's fail-open-by-default claim at `:66-68`); `false` silences it. The `checks` surface can therefore only keep the warning *emitted*; it cannot escalate anything to a refusal. The only escalation mechanism is `onLog` (or Snapback's own log handling treating the code as fatal) — the current esbuild equivalent being precisely `logOverride: { 'empty-import-meta': 'error' }` at `index.mjs:7746`. The Plan's sentence exists to prevent exactly this spelling/mechanism drift and gets the mechanism wrong; executing it as written yields a warning where a refusal is required, saved only by the belt-and-braces path and the scan-time `importMetas` refusal (both of which are real — I verified `importMetas` spans are returned).
Resolution criterion: swap the roles — the escalation is implemented in `onLog` (fatal on `EMPTY_IMPORT_META`), with `checks.emptyImportMeta: true` pinned so the check cannot be disabled out from under `onLog`, and the scan-time refusal remains the third detector. The unknown-warning policy (`:668-670`) already generalizes correctly and needs no change.

**C3 — MATERIAL (coherence): the acceptance-matrix top-level-`await` row was not updated to the v0.5 decision.**
Evidence: `:1013-1017` still reads "top-level `await` inside a *handler* … **either stays admitted or gains a named authored diagnostic**," but v0.5's policy section (`:483-494`) chose: stays admitted, "No new authored diagnostic is introduced." Two live authorities inside one document now disagree — the exact two-authorities failure the Plan itself lectures about at `:43-45` and `:120-133`. An executor reading only the matrix could lawfully ship a new diagnostic the policy forbids.
Resolution criterion: the matrix row states the chosen policy only (admitted, no new diagnostic, with the variant-form fixtures from C1).

**C4 — MINOR: misplaced `attachDebugInfo` is warned-and-ignored, not "rejected."**
Evidence: `:617` says passing it under output options "is rejected as an invalid key." Measured: Rolldown emits a validation *warning* ("Invalid key: Expected never but received \"experimental\"") and proceeds, ignoring the option — so a misplaced pin fails open, which is worse than rejection and makes the immutable-input-manifest assertion (`:630-635`) the real guard. The underlying claim held: it is an input option, and the default does emit checkout-position-dependent markers (`//#region <module-id>` under `format: 'es'`; residual `//#endregion` debris even under `iife`, removed by `'none'` — my first probe nearly false-negatived this by searching only `#region` in iife output).
Resolution criterion: say "warned and silently ignored," and note the manifest self-assertion is what catches misplacement.

**C5 — MINOR: "`oxc-parser@0.142.0` exports exactly `parseSync` and `parse`"** (`:412-413`) is overstated: the package also exports `Visitor`, `visitorKeys`, `experimentalGetLazyVisitor`, `Severity`, and others. The load-bearing half — there is no `parseAsync` — is true.
Resolution criterion: "exports exactly two parse entry points" or equivalent.

**C6 — MINOR: Stage 3's cross-check names `getModuleIds`** (`:916`) without noting it is a plugin-context method (`this.getModuleIds()` in hooks), not a `RolldownBuild` method — I confirmed `bundle.getModuleIds` does not exist at 1.2.1 while the plugin-context iterator does, and `\0rolldown/runtime.js` does appear in chunk `moduleIds` when CJS interop engages. An implementer following the sentence naively hits a missing function.
Resolution criterion: one clause locating the API on the plugin context or the output-chunk `moduleIds`.

## 4. Suggestions (non-blocking)

- The differential-acceptance sweep is deliberately widening-direction-only, with narrowing left to the frozen corpus (`:539-549`). C1 shows the corpus is the weak leg. Consider running the same four input sources through the *narrowing* comparison too (fail on any input Acorn accepts that the adapter refuses, modulo the declared `showSemanticErrors` refusal classes) — the harness is identical and the asymmetry is currently unjustified.
- The Stage-0 fixture "top-level `await` in a handler … (to determine whether any accepted fixture relies on it)" (`:809-811`) reads as though the policy were still open; v0.5 decided it. Reword to "fixtures each admitted top-level-`await` form" once C1's forms are enumerated.
- The redeclaration disposition (`:812-817`) pins code, span, envelope, and precedence for `let a; let a;` — good — but `showSemanticErrors: true` admits a whole early-error family as new refusals (`:425-432`); consider requiring the Stage-1 receipt to enumerate the complete list of new refusal classes actually observed over the sweep sources, so OQ4's "per-scanner exceptions" is answered by evidence rather than left as prose.
- Acorn 8.17.0 is what the lock resolves and what production parses with today; the differential sweep's reference (`:545`, "at the pinned Acorn version") should say explicitly *which* — the 8.17.0 the shipped scanner runs, not the 8.18.0 the size table prices.
- The measured `//#endregion`-only debris under `iife` (vs full `//#region <path>` under `es`) is worth one sentence in the `:617` row — it is the reason the byte-absence fixture (`:642-643`) should grep for `endregion`, not just `#region`; my own probe initially produced a false negative exactly that way.

## 5. Open questions for the author

1. (C1) What is the exact structural predicate for `top-level-await-in-script`, stated over the measured label spans and covering `for await` (which has no `AwaitExpression` node)? And does "top level" mean strictly Program-child statements, or any position outside a function body (class static blocks, computed class keys)? Acorn's `allowAwaitOutsideFunction` and Oxc's error placement may differ in those corners; the corpus should decide.
2. (C1/C6-adjacent) When multiple categorized and uncategorized errors coexist in one handler, which error does each category consume, and is precedence defined over error order or span order? The mixed-error fixture row (`:1025-1027`) asserts the outcome but the adapter rule producing it is not yet stated.
3. (C2) After the roles are swapped: is a thrown/collected fatal from `onLog` guaranteed to abort `generate()` at 1.2.1, or must the plugin refuse at scan time to get a deterministic failure point? This is a measurable fact the corrected text should pin.
4. The unreleasable-window guard (`:1127-1135`) keys on "the codegen closure's default definition bundler is Rolldown." What is the mechanical predicate for that — a manifest field, an import scan, the presence of the dual-run seam? The guard is only as executable as that predicate.
5. D-1 remains the shape-changing open question, as the Plan itself says (`:1139-1141`). Given the recommended-sequencing paragraph (`:369-373`), does Charlie intend to record D-1b-first at Stage 1 start, or hold the decision until Stage-0 evidence exists?

## 6. Readiness verdict

**VERDICT: NOT READY**

Blocking list:
1. **C1** — the `top-level-await-in-script` structural category, as specified, turns three of four currently admitted top-level-`await` spellings into fatal refusals and rests on a span-coincidence predicate that is measurably false at `oxc-parser@0.142.0`; the corpus and both gates as written need not catch it.
2. **C2** — the `import.meta` escalation is attributed to a mechanism (`checks.emptyImportMeta`) that at Rolldown 1.2.1 can only enable or disable a warning and can never produce the required refusal; the roles of `checks` and `onLog` must be swapped.
3. **C3** — the acceptance-matrix top-level-`await` row still permits the alternative ("or gains a named authored diagnostic") that the v0.5 policy explicitly forecloses; the two texts may not be left disagreeing.

All three are small, precisely locatable text fixes; nothing in the Plan's direction, sequencing, census, size analysis, rollback policy, or the remainder of its measured base failed verification. Absent these three, I found no other material defect: the document otherwise meets its own "no unexplained authority, no unmeasured load-bearing claim" standard, and I expect a v0.6 addressing exactly these items to be READY.

## Orchestrator verification (outside the verbatim body)

**C1 confirmed by independent probe**, exactly as measured: Acorn 8.17.0 under
the production options accepts all four spellings; only `await fetch(1)` yields
a program-level `AwaitExpression` (span 0–14) against an error label of 0–5;
`const v = await fetch(1);` labels 10–15 with the node inside
`VariableDeclarator.init`; `if (await x)` labels 4–9 inside `IfStatement.test`;
and `for await (const x of y) {}` labels 4–9 with **no `AwaitExpression` node at
all**. v0.6 rewrites the recognizer to label-span containment over an `await`
token whose nearest enclosing function or class-field-initializer boundary is
the Program, plus `ForOfStatement` with `await: true`, and generalizes the
matching predicate to every structural category (the `import` error labels 0–6
against a node of 0–18, so node-span equality was wrong everywhere, not just
here).

**C2 confirmed by independent probe**: `checks.emptyImportMeta: 'error'` is a
hard napi type failure; `true` (the default) yields
`warn:EMPTY_IMPORT_META` with the build succeeding; `false` silences it. The
`checks` surface cannot refuse. v0.6 moves the escalation to `onLog`, pins
`checks.emptyImportMeta: true` so the check cannot be disabled underneath it,
and adds the reviewer's open question 3 as a Stage-2 behavior test.

**C3, C4, C5, C6 confirmed and applied**, along with all five suggestions: the
sweep now fails in both directions, the Stage-0 fixture enumerates the four
spellings, the Stage-1 receipt must enumerate the observed new refusal classes,
the Acorn reference is pinned to 8.17.0 rather than the 8.18.0 the size table
prices, and the byte-absence fixture must match `endregion` as well as
`#region`.

The Codex-family round-5 review independently reached this review's C3 and added
findings this one did not: a genuine deadlock between the v0.5 publication guard
and LLP 0041's publication state machine, three Acorn consumers that receive raw
TypeScript today via parse-failure fallbacks, unpinned exact-file-only
resolution, and a falsification of v0.5's blanket claim that
`showSemanticErrors: false` suppresses the entire early-error family (getter
arity is reported either way). All are applied in v0.6.


## Round 6 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, fresh general-purpose subagent (non-author context, not resumed)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** fresh non-author subagent, read-only over the repository; mutually blind — barred from `llp/reviews/`, from any `super-refine` path, and from prior reviewers' scratchpad text; network reachable; verified the baseline size table cell for cell against `registry.npmjs.org` (all 13 tarballs downloaded and byte-counted) and ran fresh `r6-` probes against `oxc-parser@0.142.0`, `rolldown@1.2.1`, `esbuild@0.28.1`, and the locked `acorn@8.17.0`; target = v0.6, SHA-pinned
**Target SHA-256:** `5681147344cc5f036fc7648f75e5887c06fea2d01b393744a586d2a508cc2f0c`
**Instruction SHA-256:** `93f2d85bbe8e6f151a95d128c35410241895a02975d62ec95a37d34948544f26`
**Status:** completed
**Verdict:** **READY** — the first READY of this loop.

## Verbatim review

# LLP 0140 v0.6 — Independent review (Fable family, round 6)

**Target hash (computed):** `5681147344cc5f036fc7648f75e5887c06fea2d01b393744a586d2a508cc2f0c` — **matches** the capsule's expected SHA-256.
**Date:** 2026-08-01
**Reviewer:** Fable-family independent reviewer, blind to all prior review artifacts per the capsule.

**Method note.** I read the full target document (1,337 lines) and verified its claims against the repository and the live tools. Repository: I opened every file named in the inventory table and checked roughly forty `file:line` citations in `packages/snapback-codegen/index.mjs`, `packages/snapback-codegen/inline-handlers.mjs`, `packages/snapback-codegen/file-read-capability.mjs`, `scripts/check-package-export-types.mjs`, `scripts/check-contract-meta.mjs`, `packages/snapback-contract/exact-package.mjs` and `package.json`, `scripts/snapback-package-cold-install.mjs`, `cloudflare/scripts/generate-deployment-identity.mjs`, `cloudflare/test/harness.mjs`, and both demo files; I ran independent binary-safe repository sweeps for first-party esbuild/Acorn/TypeScript authority; I checked every cited LLP anchor in LLPs 0009, 0010, 0030, 0040, 0041, 0049, 0108, and 0118 and read the anchored text. Tools: network was available; I verified the baseline size table **cell for cell** against `registry.npmjs.org` (all 13 tarballs downloaded and byte-counted, all `dist.unpackedSize` values fetched, all totals and all four D-1 delta cells re-summed). I ran fresh probes (prefixed `r6-`) against the sandbox's pinned `oxc-parser@0.142.0` and `rolldown@1.2.1`, the repo's `esbuild@0.28.1`, and the repo's locked `acorn@8.17.0`, reproducing the parser error-class table, the import-attribute admission probe, and roughly twenty other stated measurements. I did not read anything under `llp/reviews/` or any `super-refine` file. What I could not verify: whether a fatal raised from `onLog` aborts `generate()` (the Plan itself defers this to a Stage-2 test rather than claiming it), the full Rolldown dynamic-resolution hook surface beyond typings, and musl/Windows behavior (out of scope by the Plan's own statement).

## 1. Overall assessment

This is the most thoroughly verified planning document I have reviewed. Its load-bearing claims are almost uniformly true, and true at the level of the exact line, the exact byte count, and the exact tool behavior. The first-party census is complete: my independent binary-safe sweep found precisely the seven esbuild/Acorn surfaces and four TypeScript-import surfaces the table lists, and nothing else (every other repository "esbuild" string is a comment, a lockfile, or frozen demo evidence — the classes the census scoping already handles). The six enumerated Acorn responsibilities correspond exactly to the six `parseJavaScript` call sites in `index.mjs`, plus the one TypeScript scanner. Every LLP anchor I checked exists and says what the Plan claims — including the genuinely awkward ones, like LLP 0010:373's "literal relative/file edges only" sentence contradicting the shipped resolver, and LLP 0041's acceptance section *not* containing the artifact-preservation language the Plan declines to over-cite. The size table reproduces from the live registry without a single wrong cell. The v0.6 additions — the four-spelling top-level-await recognizer, the `onLog`-based `EMPTY_IMPORT_META` escalation, the five-state publication machine, the per-consumer parse matrix, exact-file-only resolution — all held under my re-measurement: I confirmed the four Acorn-admitted spellings against the production options at the locked 8.17.0, the keyword-sized label spans (0–5, 10–15, 4–9, 4–9), the `ForOfStatement`-carries-no-`AwaitExpression` trap, the boolean-only `checks.emptyImportMeta` typing, the `{}` substitution fail-open, the misplaced-`attachDebugInfo`-warned-and-ignored fail-open, the raw-TypeScript-reaches-three-Acorn-consumers claim (traced through `resolveJsHandler` to authored bytes), and the two-layer ledger's premise that type-only imports never reach the resolver.

I found no blocking defect and no unresolved material defect. I found two factual/coherence blemishes and a handful of operational gaps, all minor with one-line resolutions: one v0.6-era measured assertion (the "bare `//#endregion`" debris shape) that failed to reproduce in five configurations I tried, though the fixture it justifies is strictly stronger than needed and therefore safe; one wording seam where Stage 4.2's imperative sentence can be read against the S1–S5 machine, though the mechanical guard fails closed and the intended reading is recoverable from the document itself; and one new probe finding (a `\0`-prefixed virtual *entry* id is a hard `INVALID_OPTION` at 1.2.1) that the facade implementation will hit loudly, not silently. Sequencing is sound, the gates are real gates with commands and receipts, the rollback policy is coherent, D-1 is named honestly and the Plan is complete under both branches, and the residual nonclaims are stated rather than implied away.

VERDICT: READY

## 2. Strengths

- **The census is complete and correctly scoped.** My independent sweep for esbuild/Acorn import positions returned exactly the table's files and no others; TypeScript importers returned exactly `index.mjs:79`→`inline-handlers.mjs`, `index.mjs`, `check-contract-meta.mjs:15,44` (`createSourceFile` only — genuinely syntax-only as claimed), and `exact-package.mjs:163-173`. The three prod dependencies really are in the *published* codegen closure (`packages/snapback-codegen/package.json:81-86`), so the size argument's premise holds. The `node:vm`/`Function` retained-authority classification matches reality (`index.mjs:7612` evaluator; `tests/allowlist_install_v0.mjs`, `tests/action_fetch_fence_v0.mjs`, `admin-ui/tests/setup-credential-errors.mjs`).
- **The NUL-census hazard is real and precisely described.** `inline-handlers.mjs:625` carries the NUL; with ripgrep 15.1.0 a recursive sweep of the directory returns *nothing* (exit 1) while the explicit-file form returns a line-less "binary file matches" notice — both failure shapes exactly as written (`llp/0140-...:141-156`), and the file is 883 lines as stated.
- **Every measured tool claim I re-ran reproduced** (except one, Concern C1): the full 8-row parser mode/error table (`:510-519`); `parseSync`/`parse` only, no `parseAsync` (`:452-455`); `preserveParens` default emitting `ParenthesizedExpression` for `(eval)(x)` and the pin restoring `Identifier` against the real `unwrapCallable` gap at `index.mjs:5157-5164` (`:458-464`); the `showSemanticErrors` *subset* behavior — getter arity reported both ways, redeclaration and legacy octal only when on (`:466-476`); UTF-16 offsets, 18 exactly (`:482-493`); `comments.legal` boolean-only with `'none'` a hard error (`:707`); `treeshake:false`+`minify:false` preserving the unused declaration under the corrected v0.6 claim (`:738-746`); TLA-under-iife `[UNSUPPORTED_FEATURE]` with the exact message text (`:747-751`); `bundle.getModuleIds` undefined and `getModuleIds` living on the plugin context (`:1019-1022`); the 7-member `kind` union with no `require-resolve`, from the shipped typings verbatim (`:777-783`); `require.resolve("./x")` verbatim in iife output with `resolveId` never invoked; type-only imports never reaching the resolver (`:785-791`); esbuild 0.28.1 admitting `with { type: "json" }` and reporting `args.with` to an `onResolve` that ignores it at `index.mjs:7783` (`:819-829`); `RUNTIME_MODULE_ID` = `"\0rolldown/runtime.js"` (`:831-834`); the normalized `buildStart` options omitting exactly `tsconfig`, `treeshake`, `transform`, `external`, `checks` (`:722-731`); rolldown pinning `@oxc-project/types` at `=0.142.0` vs oxc-parser's `^0.142.0` (`:1320-1324`); Vite 8 real (`latest` = 8.2.0).
- **The size table is exactly right.** All 26 component cells and all 8 D-1 delta cells re-derive from live registry bytes to the digit, on both tuples, and the measurement-basis paragraph (`:241-249`) honestly discloses the Acorn 8.17.0-lock vs 8.18.0-priced discrepancy — which I confirmed in `bun.lock` — and the sweep correctly pins its reference to the *locked* 8.17.0 (`:624-626`).
- **The v0.6 TLA recognizer correction is correct and important.** All four spellings admit under the production Acorn options at 8.17.0 (I ran them); Oxc's label spans are keyword-sized as stated; `for await` recovers as `ForOfStatement` with no `AwaitExpression`; and the generalization to label-span containment for the `import`/`export`/`with` categories (`:563-572`) fixes a predicate that was genuinely undefined.
- **The `onLog` escalation redesign matches the measured typing** (`checks.emptyImportMeta` napi-rejects `'error'`; the warning-level `EMPTY_IMPORT_META` log code and the `{}` substitution fail-open both reproduce), and the Plan correctly refuses to trust the misplaceable `attachDebugInfo` pin, which I confirmed is warned-and-ignored under output options (`:708`, `:763-774`).
- **Line citations are unusually accurate.** Of ~40 checked, all were exact or within a couple of lines (e.g. `:5090-5096`, `:5157-5164`, `:5236-5257`, `:7737/7742/7745-7747`, `:7802-7806`, `:8174-8199`, `:8202-8207`, `inline-handlers.mjs:449-457/474-478/494-515`, `check-package-export-types.mjs:66/77/210-234`, `cold-install.mjs:2346`).
- **The governing-text conflict is real and handled correctly** — adopting as-built plus a same-commit LLP 0010 amendment (`:126-139`) is the only move consistent with "not a semantic rewrite," and Stage 4.4's same-commit amendment policy (`:1075-1086`) matches this repository's actual doc-with-code rule; the LLP 0040:648 esbuild-identity sentence is a correctly named omission.
- **The five-state publication machine is reconciled with LLP 0041's real text** — I verified the nine-package section requires non-default dist-tag candidate publication before public installs and the "exactly one empty npm-tree entry" CLI rule verbatim, so both the deadlock diagnosis and the two-invariant split (`:855-865`) are grounded.

## 3. Concerns

**C1 — MINOR. The "bare `//#endregion`" debris claim does not reproduce.**
Evidence: `:733-736` asserts that under `format: 'iife'` "the residual debris is a bare `//#endregion` and a `#region`-only assertion false-negatives." I probed rolldown 1.2.1 in five configurations — default; pinned comments manifest (`legal/annotation/jsdoc: false`, `minify: false`, `sourcemap: false`); `minify: 'dce-only'`; misplaced `attachDebugInfo` under output; and a plugin-loaded virtual entry — and in every case where markers appear at all, the output contains a full `//#region <module-id>` line *and* `//#endregion`; with `experimental.attachDebugInfo: 'none'` correctly placed on input, both are absent. In no configuration did a bare `//#endregion` appear alone. The prescribed fixture (match both spellings) is strictly stronger than needed, so nothing fails open — but this is a stated measurement in a document whose own rule is that measured behaviors are version-tagged evidence.
Resolution: either record the exact configuration that produced the bare-`//#endregion` observation, or correct the sentence to "debris includes both `//#region <id>` and `//#endregion`; the fixture matches both defensively."

**C2 — MINOR. Stage 4.2's sentence order can be read against the S1–S5 machine.**
Evidence: `:1057-1068` ("Run staged cold installs and the eventual public-registry proof on both tuples. … Then run the cross-tuple semantic equality proof … Only after this passes may Stage 2's dual implementation and the esbuild dependency be removed") reads, imperatively, as running the public-registry proof *before* removal — which the guard itself forbids ("fails **any** publication while the dual implementation is still present," `:1272-1282`) and which S2→S4 (`:1262-1270`) sequences the other way. The reconciling reading — "the eventual public-registry proof" as a forward reference to S4, with the 4.2 cross-tuple run executed on the pre-removal staged closure — is recoverable, and the guard fails closed rather than letting the bad ordering do harm, which is why this is minor rather than material. But the sentence sits on exactly the seam the v0.6 state machine was written to fix, and the pre-removal staged-closure cross-tuple run it mandates appears nowhere in the state table.
Resolution: annotate Stage 4's steps with their S-states (4.2 staged qualification and staged-closure cross-tuple run = S1; removal → 4.3 = S2; candidate publication = S3; public-registry and published-closure cross-tuple proof = S4), and either add the S1 cross-tuple run to the state table or name it as a stage step distinct from S4's.

**C3 — MINOR. A `\0`-prefixed virtual *entry* id is a hard error at 1.2.1 — the facade's module id needs a disposition.**
Evidence: my probe of a plugin-resolved entry id `\0facade` fails `generate()` with `[INVALID_OPTION] Invalid substitution "\0facade" for placeholder "[name]" in "output.entryFileNames"` even for in-memory output; a non-`\0` virtual id works (emitting `//#region snapback-facade` debris, cf. C1). The current esbuild path loads the facade from a namespace (`index.mjs:7778-7782`); the Plan's plugin section requires "supply the synthetic serialization facade" (`:661`) and disposes `\0` ids for *deployment identity* (`:831-834`), but neither the option manifest nor the plugin section pins the facade's id scheme or `output.entryFileNames`. This fails closed and loud, so it cannot silently break a contract.
Resolution: one sentence in the plugin section or one manifest row: the facade uses a non-`\0` reserved virtual id (or pins `entryFileNames`), with a Stage-2 fixture.

**C4 — MINOR. The differential sweep's external sources are JavaScript-only; the TypeScript dialect side leans entirely on Snapback's own corpus.**
Evidence: the named sources (`:630-637`) — Acorn's negative cases, Test262 negative syntax/early errors, the versioned generator — cover JavaScript grammar. The per-consumer matrix (`:436-449`) correctly identifies the TypeScript-reaching paths as the highest-drift area (I verified raw `.ts` bytes reach the three Acorn consumers via `resolveJsHandler`, `index.mjs:1179-1231`, `:1490`), yet no external TypeScript negative corpus is named for the sweep, and the current-TypeScript-path comparison inherits only the frozen fixtures and generator.
Resolution: name a TypeScript-dialect negative source (e.g. the TypeScript compiler's parser-error baselines at the pinned 5.9.3, or an explicit statement that the TS side's differential evidence is fixtures-plus-generator only, extending the residual nonclaim to say so).

**C5 — MINOR. "Acorn's own test suite's negative cases" are not in the npm tarball.**
Evidence: the acorn 8.17.0/8.18.0 packages ship `dist/` only; the negative cases live in the GitHub repository at the release tag. The receipt schema (`:637-638`) records source+hash, which would surface this at execution, but the Plan implies an install-local source.
Resolution: state the provenance (git tag matching the locked 8.17.0) in the input-source list.

## 4. Suggestions (non-blocking)

- Stage 0.4 measures peak RSS on both tuples (`:927-931`) but the acceptance matrix gates only latency (`:1208-1213`). Either add an RSS criterion or state that RSS is recorded evidence without a gate.
- Citation nit — the stream-inference fallback is cited as `index.mjs:4961, :4982`; the call is at `:4968` and the textual regex fallback at `:4994`. The described behavior is exactly right; the numbers drifted. (The only citation drift I found.)
- The D-1b acceptance-matrix sentence (`:1199-1207`) is grammatically tangled by the em-dash insertion of Charlie's-acceptance clause into the resolved-delta clause; split it into two sentences before someone quotes half of it.
- Consider naming, in the residual nonclaim, two more things a fully passing run leaves unproven: watch-mode/regeneration *race* behavior (the matrix fixtures Vite dev *states*, not transitions under rapid edits), and the quality of the D-1a binding-resolver security review, which the selection criterion assigns an owner for but no gate can prove.
- The normalized `buildStart` option object contains an `inner` member at 1.2.1; if the manifest self-assertion walks the normalized subset, pin whether `inner` is consulted or ignored so an upstream widening of that object doesn't silently expand what "asserted" means.

## 5. Open questions for the author

1. Which exact configuration produced the bare-`//#endregion` observation behind `:734-736`? (C1 — if none, correct the sentence.)
2. What virtual id and `entryFileNames` policy will the serialization facade use, given the measured `INVALID_OPTION` on `\0`-prefixed entries? (C3; ties into OQ3's synthetic-id disposition.)
3. What is the TypeScript-dialect negative-evidence source for the differential sweep? (C4)
4. Should the pre-removal staged-closure cross-tuple run in Stage 4.2 be represented in the S1–S5 table, and will Stage 4's steps be annotated with their states? (C2)
5. (Standing, correctly identified by the document itself) D-1 — the one question that changes the shape of the work; the Plan's own framing of it as the gate to leaving Review is right, and the recommended-sequencing paragraph (`:375-379`) is the best available advice.

## 6. Readiness verdict

Every decisive factual claim I could check — census, line citations, LLP anchors, the complete size table against the live registry, the parser error-class table, the import-attribute probe, the TLA recognizer measurements, the option typings, the fail-open behaviors, the NUL census shapes — held under independent adversarial re-measurement, with the single benign exception in C1. The remaining concerns are all MINOR with one-line resolutions, and none would leave a contract silently broken if the Plan were executed exactly as written: the two coherence-adjacent items fail closed and loud. Under the stated bar — no unresolved material correctness, coherence, feasibility, safety, or decision-quality concern — the document passes, and I state plainly that I looked for the remaining defect and found only the items above.

VERDICT: READY

## Orchestrator verification (outside the verbatim body)

**C1 — the orchestrator has the missing configuration.** The bare-`//#endregion`
observation is real and came from a probe with `treeshake: false` and **`minify`
omitted** — the DCE-only default, where the region-open line is elided and only
`//#endregion` survives. With the full pinned manifest (`minify: false`) the
markers appear as a matched `//#region <path>` / `//#endregion` pair, exactly as
this review measured. v0.7 records both shapes and the configuration that
produces each, which is the answer to open question 1.

**C2 confirmed and raised in severity.** The Codex-family round-6 review reached
the same seam independently and scored it BLOCKING, with the additional
observation that an immutable candidate published from a pre-removal closure
could never be replaced under the same exact version. v0.7 rewrites Stage 4's
steps *as* S1–S5 rather than annotating them.

**C3, C4, C5 confirmed and applied**: the facade now uses a non-`\0` reserved
virtual id with `output.entryFileNames` pinned; the TypeScript compiler's
parser-error baselines at the pinned 5.9.3 are named as the TypeScript-dialect
negative source; and Acorn's negative cases are sourced from the git tag
matching the locked 8.17.0. All five suggestions were adopted, including the
`:4968`/`:4994` citation correction and the two added residual nonclaims.


## Rounds 7–17 — 2026-08-01

**Reviewer family:** Claude Fable
**Provider / runtime:** Anthropic Claude Code, `claude-fable-5`, one fresh non-author general-purpose subagent per round (never resumed)
**Effort:** session-inherited (max)
**Date:** 2026-08-01
**Redacted:** no
**Method:** as rounds 1–6 — mutually blind, barred from `llp/reviews/` and any `super-refine` path, SHA-pinned target and capsule per round. From round 5 onward every reviewer installed and ran the pinned tools (`rolldown@1.2.1`, `oxc-parser@0.142.0`, plus the repository's `esbuild@0.28.1` and locked `acorn@8.17.0`) and re-fetched the priced packages from `registry.npmjs.org`.

**Verdict sequence:** r7 NOT READY (3 material) → r8 NOT READY (1) → r9 NOT READY (1) →
r10 NOT READY (1) → r11 NOT READY (1) → **r12 READY** → **r13 READY** →
**r14 READY** → **r15 READY** → r16 NOT READY (2 — both were the author's own
edits that a partially-failed edit batch had dropped, caught by checking the
revision header's claims against the body) → **r17 READY**.

The full verbatim bodies for these rounds are large and were consumed by the
orchestrator round by round; the dispositions, the measured facts each round
established, and the one inter-family disagreement the orchestrator adjudicated
are recorded in
`llp/reviews/0140-vite-rolldown-oxc-convergence.super-refine.md`, which is the
authoritative account of this loop. Recorded here rather than reconstructed:
no review body has been paraphrased into this file as if verbatim.

**Round 17 (convergence).** Target
`4a9b09271cfda6140329f62ebe2e186a81294de06b87a3e8a5096279708323ee` (v0.17).
VERDICT: READY, with five MINOR non-blocking items (Stage-0 receipt naming
inside the state series; a missing `await`-as-identifier misclassification
fixture; `for await` unnamed on the definition-module refused side; a dangling
referent in the D-1b size clause; nested attributed imports unnamed in the
composed fixtures). All five were applied. The review's own summary: "Everything
checkable without executing the migration has been checked — by this review,
independently, including every measured tool claim, every size cell, the census,
and the anchor texts — and it all held."
