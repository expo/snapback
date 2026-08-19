# LLP 0140: Vite, Rolldown, and Oxc toolchain convergence

**Type:** Plan
**Status:** Review
**Systems:** Tooling, Code generation, Developer experience, Packaging, Security, Vite integration, Cloudflare, Testing
**Author:** Charlie Cheever / Codex
**Date:** 2026-08-01
**Revised:** 2026-08-03 (decision-sitting propagation: the asset-intent
carrier prerequisite disposition is ruled — implementation identity
becomes the carrier, extended to the spliced helper closure and consumed
through the client/admission/generation/finalization chain, then pinned
by metamorphic fixtures; Stage 0's baseline freeze is unblocked once
that lands. Source: author decision sitting #2,
`issues/20260803-author-decision-sitting-2.md`; dated LLP 0044
amendment landed in the owner.)
2026-08-02 (decision-sitting propagation: D-1 selects D-1b —
retain the TypeScript checker in the shipped codegen closure while Oxc replaces
syntax-only scanners. Admission semantics do not weaken. The migration program
remains parked until the implementation wave clears, and Status remains Review.
Source: `issues/20260802-author-decision-packet.md`).
2026-08-01 (v0.19 — **converged: dual-family READY on v0.17**, promoted Draft → Review. v0.18–v0.19 apply the round-16 Codex findings that arrived after v0.17 was already under review, plus both families' round-17 minors, and are therefore an unreviewed delta on top of the converged revision — see `llp/reviews/0140-vite-rolldown-oxc-convergence.super-refine.md`. Prior: v0.18 — round-16 Codex findings: recorded the pre-existing asset-intent identity defect the loop uncovered (implementation identity omits the reachable helper closure, and only the policy hash reaches the server) as a Stage-0 prerequisite disposition with its own ticket, made the rollback prohibition permission-specific, extended the version-change re-run rule to helpers and native-binding integrity, and added the missing constraint-7 anchor. Prior: v0.17 — round-16 dual-family review: landed the four v0.16 edits that a partially-failed edit batch dropped, which the round-16 Fable review caught by checking the revision header against the body — the Stage-0 aggregate receipt and producer, the step-1 package re-inspection at S2, Acorn in the version-change re-run rule, and the literal `logLevel` pin — and added concurrent-generation liveness to the residual nonclaim. Prior: v0.16 — rounds 14–15 dual-family review, Fable READY ×2 / Codex NOT READY on shrinking lists: made every guard-installation statement name the first freeze-predicate landing (a v0.15 edit that failed to apply), stated the existing case-insensitive extension folding and gated it, stopped the non-predicate publication fixture from implying an authority LLP 0041 does not grant, re-ran the package inspection against the final post-removal tarballs, gave Stage 0 an aggregate receipt and producer, and corrected the `.ts` fallback claim and the version header. Prior: v0.14 — round-13 dual-family review, Fable READY / Codex NOT READY on two narrow release-handoff items: made S1/S2/S3 qualify and hand off LLP 0041's complete nine-package vector while only the freeze-predicate subset is frozen, and made S5 the terminal receipt for S4 whose producer executes S4 and whose verifier reopens the public-registry evidence. Prior: v0.13 — round-12 dual-family review, Fable READY / Codex NOT READY on two narrow items: pinned attribute normalization to cooked strings after a probe showed escape-equivalent spellings share one esbuild instance, named producer/verifier commands for every S-receipt and made a valid S6 receipt a completion prerequisite, bounded the diagnostic-message waiver against public-custody leakage, and corrected the "always recoverable", D-1b-risk, and release-narration overstatements. Prior: v0.12 — round-11 dual-family review: stopped restating LLP 0041's publication machine and deferred sequencing to it, which removes the chronology-inversion class three consecutive rounds found; made S6 grant package-closure *eligibility* rather than served capability, which LLP 0111 independently governs; extended D-1a to LLP 0044's asset-intent lifecycle; pinned `logLevel` after a probe showed `'silent'` silently defeats the prescribed `onLog` escalation; and corrected three factual statements. Prior: v0.11 — round-10 dual-family review, both families converging on the release-machine guard: derived the guard's failure clauses per permission from the S-table, split the S5 promotion-authorization receipt from the S6 terminal receipt so the chronology is possible, keyed the synthetic attribute id on the resolved real path rather than the authored specifier after a collision was found across importers, canonicalized the importer for child resolution, and corrected the `output.banner` namespace. Prior: v0.10 — round-9 dual-family review, both families converging on the same three release-machinery contradictions: made the freeze bind on a manifest fact from the Stage-1 landing rather than on a state window that does not yet exist, removed served capability from the S5 narration, moved every governing-document amendment inside the immutable candidate checkout so Stage 4 cannot invalidate the receipt it just emitted, and specified the composition order of the inline-handler and attribute transforms. Prior: v0.9 — round-8 dual-family review: stated the publication-freeze predicate once and removed the three inconsistent scopings, reconciled S3–S5 with LLP 0041's first-publish `latest` path and moved served capability behind the post-promotion ledger, made Stage 0–3 receipts explicit predecessors of the release machine, extended the attribute rewrite to every attributed edge family with an internal edit-map for diagnostic back-projection, made Stage 1 unconditionally repository-only, and corrected the facade filename and the TypeScript-lowering attribution. Prior: v0.8 — round-7 dual-family review, both NOT READY on the same gap: specified the attribute-identity normalization function and the source-rewrite mechanism that makes it implementable against a resolver blind to attributes, separated runtime instance identity from persisted graph identity, gave Stage 1 its own release gate, replaced the contradictory S1–S5 entry conditions with one transition table plus S1/S2 receipts, pinned literal facade id and `output.entryFileNames`, corrected `comments` to an output option, corrected the `\0`-entry measurement to silent sanitization, defined the canonical digest projection, and closed the ordering/envelope disposition waiver. Prior: v0.7 — round-6 dual-family review, Fable READY / Codex NOT READY: specified attribute-sensitive runtime module identity after a probe showed esbuild and Rolldown disagree on module-instance count for the same authored source, resequenced Stage 4 onto the S1–S5 machine, bound the terminal receipt to the exact closure it authorizes, closed the `showSemanticErrors` waiver, pinned the facade's virtual id, and named the TypeScript-dialect negative source. Prior: v0.6 — round-5 dual-family review, both reviewers probing the pinned tools: rewrote the `top-level-await-in-script` recognizer after measurement showed it missed three of four admitted spellings, swapped the `import.meta` escalation onto `onLog` because `checks.emptyImportMeta` is boolean-only and cannot refuse, replaced the deadlocked publication guard with a five-state machine reconciled against LLP 0041, added the per-consumer parse matrix covering TypeScript reaching the Acorn scanners, pinned exact-file-only resolution, corrected the early-error and metamorphic-identity claims, and moved documentation amendments into their landing commits. Prior: v0.5 — round-4 dual-family review: chose the handler top-level-`await` policy instead of leaving it open, split the import-edge ledger into authored-syntactic and projected-runtime layers after a probe showed type-only edges never reach the resolver, re-measured the statement-preservation caution under the pinned manifest and corrected it, moved the redeclaration fixture to the invalid corpus, gave Stage 3 an orchestrating command and receipt, added an executable publication guard for the unreleasable window, replaced the last "error-class" leftovers, and weakened the enumeration claim to bounded differential evidence with named sources. Prior: v0.4 — round-3 dual-family review, both reviewers running the pinned tools: dropped the identity-rollout premise LLP 0108 §B explicitly removed and named the asset-intent identity carrier, fixed `comments.legal` to a value Rolldown 1.2.1 accepts and pinned `experimental.attachDebugInfo`, replaced the unimplementable Oxc "error class" gate with Snapback-owned structural categories plus `parse`/`parseSync`, committed to `showSemanticErrors: true` and a differential Acorn-vs-oxc acceptance sweep, added a terminal post-removal package proof, corrected the NUL narrative and several line/anchor citations, and scoped the authority ledger)
**Related:** LLP 0000, LLP 0004, LLP 0009, LLP 0010, LLP 0030, LLP 0040, LLP 0041, LLP 0044, LLP 0049, LLP 0062, LLP 0064, LLP 0091, LLP 0108, LLP 0111, LLP 0117, LLP 0118; Ibex LLP 0007 and LLP 0028

## Summary

Standardize Snapback's first-party JavaScript and TypeScript build tooling on
the Vite 8 family:

- **Vite** owns application development and product-representative browser
  builds;
- **Rolldown** owns lower-level programmatic module-graph bundling where Vite
  would be too broad or would admit application configuration;
- **Oxc** owns syntax parsing and non-type-checking source inspection.

The concrete migration replaces esbuild with Rolldown across Snapback-owned
production, proof, Cloudflare, and maintained-demo bundling surfaces. It
replaces the `@expo/snapback-codegen` package's Acorn scanners and its
syntax-only TypeScript AST scanner with `oxc-parser`, and audits the remaining
first-party syntax-only TypeScript parser uses for the same move.

TypeScript is **not** uniformly removable. Two first-party surfaces use the
TypeScript *type checker* — a semantic service `oxc-parser` does not provide —
and one of them, `packages/snapback-codegen/inline-handlers.mjs`, is production
admission and identity authority. Decision **D-1b** (§Decisions) keeps
TypeScript in the shipped codegen closure, so the migration takes the
retained-TypeScript size row below. TypeScript unconditionally remains the type checker for
authored apps, generated declarations, editor workflows, and `tsc --noEmit`;
Oxc parsing and transformation are not described as type checking.

This is a toolchain migration, not a semantic rewrite. The closed definition
graph, isolated evaluation boundary, stable diagnostic dialect, generated
artifact identities, and public package proofs must survive before the old
dependencies leave the shipped closure. A dual-run test phase compares the old
and candidate paths; production never ships both toolchains.

This Plan is the execution tracker. Separate filesystem tickets are appropriate
only for independently owned defects discovered during the work; duplicating
the migration itself into an issue would create two live authorities.

## Why a Plan rather than a repository ticket

The change crosses the trusted definition evaluator, parser-backed security
diagnostics, generated artifact identity, the public npm closure, Vite-facing
product proofs, Cloudflare test assembly, and multiple maintained demos. It
also has staged replacement and rollback gates. That is larger than a bounded
repository task, while the strategic choice itself is already made: Snapback
will converge on Vite/Rolldown/Oxc. A Plan records the sequencing and evidence
without reopening the direction as an RFC question.

## Governing constraints

1. The definition evaluator retains a complete, static, content-addressed
   module graph. Dynamic import, CommonJS loading, Node builtins, ambiguous bare
   imports, query/hash-qualified imports, `import.meta`, and graph escape
   continue to fail closed (`LLP 0010#generated-artifacts`,
   `LLP 0009#supply-chain-and-generated-bundles`). `import.meta` is named
   explicitly because the current enforcement is a single esbuild-specific
   log escalation (`packages/snapback-codegen/index.mjs:7747`) with no fixture
   behind it, and because Rolldown's default behavior for `import.meta` in
   non-ESM output is to substitute `{}` behind a *warning* — a fail-open unless
   the migration escalates it.
2. Static source inspection remains defense in depth. The capability-empty
   evaluator and restricted runtime remain the actual authority boundary
   (`LLP 0009#capability-model`).
3. Anything the parser or bundler cannot represent emits a structured,
   stable-code diagnostic with a useful source span; it is never silently
   dropped (`LLP 0010#generated-artifacts`, `LLP 0010#diagnostic-shape`). The
   full public/local diagnostic envelope and custody rules survive, not merely
   the code and span — custody is governed by
   `LLP 0010#dated-acceptance-profile-inline-handlers-and-results-2026-07-27`
   and `LLP 0108#diagnostics`, not by `LLP 0010#diagnostic-shape` alone.
4. Definition identity continues to cover every admitted path/source pair,
   governing module-format manifest, and canonical evaluated value. A toolchain
   change may alter implementation bytes, but may not produce different
   definitions under the same identity (`LLP 0010#generated-artifacts`).
5. **Inline-handler identity is a distinct identity domain and does not rotate
   silently.** `packages/snapback-codegen/inline-handlers.mjs:449-457` encodes
   TypeScript numeric `SyntaxKind` values and token text into `canonicalAst`;
   `:474-478` hashes that encoding as the helper content hash; those values
   flow into the emitted handler record and the v1/v2 `implementationHash`
   (`packages/snapback-codegen/index.mjs:4785-4823`). **There is a second
   carrier**: `defineAssetUpload` authorizers run the same inline extraction
   pipeline, and their canonical AST is hashed into
   `snapback.asset-intent-implementation.v1`
   (`packages/snapback-codegen/index.mjs:2384-2403`). Any parser substitution
   under this surface changes helper content hashes, marker tokens, and
   implementation hashes unless it reproduces the encoding exactly. LLP 0108
   makes same-file symbol resolution, deterministic splicing, and v1/v2
   identity normative (`LLP 0108#same-file-helper-sharing--2026-07-31-normative`,
   `LLP 0108#identity-the-v2-implementation-hash-format`). Rotation is permitted only as a
   declared, versioned identity migration with a stated rollout rule — never as
   a side effect of "parser parity."
6. The esbuild-hosted resolver is precedent for the shape, not the authority:
   Snapback owns admission while a stock bundler hosts parsing, lowering, and
   linking (`LLP 0118#what-snapback-does-today`,
   `LLP 0118#3-build-step-bundling-closure-capture--stock-bundler-at-codegen-time`).
7. The packaged closure remains installable and repository-independent on
   Apple-silicon macOS and x86-64 Linux, with wrong-platform optional native
   packages omitted and both clean-host proofs retained — the exact
   opposite-runtime edge invariant being
   `LLP 0041#nine-package-candidate-promotion--2026-07-28`, distinct from this
   Plan's added Oxc/Rolldown third-party binding rule (`LLP 0041#runtime-distribution`,
   `LLP 0041#acceptance`; the exact opposite-platform optional-edge rule is in
   `LLP 0041#nine-package-candidate-promotion--2026-07-28`).
8. Vite integration continues to expose generation failures through Snapback's
   diagnostic channel and never serves stale output silently
   (`LLP 0030#codegen-and-hot-push`, `LLP 0030#diagnostics`). The
   generated-but-not-loaded and offline-push-warning states are governed by
   `LLP 0041#acceptance`. That section does **not** state
   failed-generation-preserves-the-previous-complete-artifact-set; the narrower
   text for that is
   `LLP 0010#dated-acceptance-profile-inline-handlers-and-results-2026-07-27`
   and `LLP 0108#identity-artifacts-and-public-custody`. If atomic preservation
   across the whole Vite state is meant to be normative in LLP 0041, Stage 4
   amends 0041 to say so rather than this Plan citing it as though it already
   does.
9. The Cloudflare deployment identity keeps its freshness and
   self-output-exclusion discipline
   (`LLP 0049#deployment-identity-freshness-gate-2026-07-25`). A bundler swap may
   not weaken the fixed-point rule or let a generated output become one of its
   own inputs.

### A governing-text conflict to resolve, not inherit

`LLP 0010#generated-artifacts` says the resolver admits "literal relative/file
edges only." The shipped resolver also admits absolute-local paths
(`packages/snapback-codegen/index.mjs:7802-7806`) and an exact, two-entry
Snapback-package allowlist — `@expo/snapback-codegen/define` and
`@expo/snapback-codegen/standard-patterns`, defined at
`index.mjs:345-348` and consulted at `:7793` (`LLP 0118#what-snapback-does-today`).

This Plan **adopts the as-built behavior and does not narrow it**; narrowing
would be a semantic change, which this migration is explicitly not. Stage 0
fixtures both allowlist entries and an absolute-local import as *valid* cases,
and Stage 4 amends LLP 0010's sentence to match the as-built resolver. The two
texts may not be left disagreeing.

## Current first-party inventory

The phase-0 census must refresh this list mechanically before implementation,
and **must be binary-safe**: `packages/snapback-codegen/inline-handlers.mjs`
contains a literal NUL byte at line 625 (a cycle-key join sentinel). Measured
against ripgrep 15.1.0 and BSD grep, the failure has two shapes and neither is
truncation:

- **Recursive sweep** — how a census actually runs — reports *nothing at all*
  for this file, silently, including for matches well before the NUL.
- **Explicit file argument** — the search does reach post-NUL content, but
  line-oriented output collapses to a line-less "binary file matches" notice
  for every match in the file.

Either way, a text sweep cannot produce a `file:line` record for any of the 883
lines. A census tool that can miss a file is not a census.

**Ledger scope.** The ledger covers *migration-owned syntax, bundling, and
transform authority* — the esbuild/Acorn/TypeScript-parser surfaces this Plan
moves, plus any future first-party addition of the same kind. It also
recognizes builtin-hosted compilation authority (`node:vm`, `Function`) but
**classifies rather than migrates** it: the production definition evaluator at
`packages/snapback-codegen/index.mjs:7612` and the evaluator-fence uses in
`tests/` and `admin-ui/tests/` are retained-by-design and appear in the ledger
as such. Type-checking `tsc` spawns are likewise covered by the standing
retention stated in the Summary and are enumerated only in the mechanical
ledger, not in the table below — the codegen test suite spawns the pinned `tsc`
in several places, and listing each would pad a table whose purpose is
migration-owned authority. Completion criteria mean "no unexplained
*migration-owned* authority," not an empty ledger.

Import-position matching is also insufficient. The Stage-0 ledger must
recognize, at minimum:

- ordinary static imports and `require` calls;
- **builtin-hosted transform and parse authority** — `node:module`'s
  `stripTypeScriptTypes`, `node:vm`, and `Function`-constructor compilation —
  which no package-manifest walk can see;
- **imports inside generated source templates**, e.g. the esbuild import
  emitted into the external proof app by
  `scripts/snapback-package-cold-install.mjs:2346`;
- **constant-foldable dynamic module URLs**, e.g. the filesystem-composed
  TypeScript entry in `scripts/check-package-export-types.mjs:77`;
- spawned CLIs, package `scripts` entries, and package manifests.

The checker ships self-tests containing each of these exceptional forms —
including a NUL-bearing file exercised through a **recursive** sweep, the mode
that fails silently. Every row of the table below must map to a ledger record;
the converse does not hold, because the recognizer classes above legitimately
surface retained non-migration authority.

As of 2026-08-01, the known direct uses are:

| Surface | Current role | Disposition |
| --- | --- | --- |
| `packages/snapback-codegen/index.mjs` | Acorn scans JavaScript; TypeScript's AST scans TypeScript; esbuild bundles the controlled schema/functions/routes definition graph into an in-memory IIFE | Oxc parser plus Rolldown; this is the load-bearing production migration |
| `packages/snapback-codegen/inline-handlers.mjs` | **TypeScript `Program` + `TypeChecker`** (`:494-515`): `checker.getSymbolAtLocation` (`:139`; the general binding call is at `:412`) resolves const aliases inside the reflective-access detector, and symbol binding distinguishes locals, same-file helpers, imports, and top-level bindings (`:293-446`). Also defines identity (constraint 5). Imported by `index.mjs:79` | **Decision D-1.** Type-semantic, not syntax-only; `oxc-parser` has no symbol service. Either retain TypeScript in the shipped codegen closure, or commission a Snapback-owned lexical scope/binding resolver with a no-narrowing gate and a declared identity migration |
| `scripts/check-package-export-types.mjs` | dynamically loads TypeScript (`:77`) and uses `createProgram`/`getTypeChecker`/`SymbolFlags.Alias`/`SymbolFlags.Value` (`:210-234`) to check declared export types, **and** spawns the pinned `tsc` binary (`:66`) to compile a synthetic external-consumer fixture (`:192-200`) | **retain TypeScript**, both uses. Genuinely type-semantic; a repository script, not part of the published runtime closure. Recorded so it is a declared exception rather than a late discovery |
| `packages/snapback-client/browser-closure.test.mjs` | esbuild proves the public client root browser-bundles without a Node builtin | move to a controlled Vite/Rolldown browser build |
| `scripts/snapback-package-cold-install.mjs` | an external proof app invokes esbuild to prove the installed browser package closure | use the same Vite build path as the public React starter, with checkout access still forbidden |
| `targets/cloudflare/scripts/generate-deployment-identity.mjs` | esbuild discovers the transitive gateway/handler graph for deployment identity | move to Rolldown graph metadata while preserving the exact identity and fixed-point exclusions |
| `targets/cloudflare/test/harness.mjs` | esbuild bundles Workers and injects the selected app/seed for Miniflare | move to Rolldown with the same controlled alias/plugin behavior |
| `scripts/check-contract-meta.mjs` | TypeScript AST performs syntax-only exported-parameter/sidecar drift checks (`ts.createSourceFile` only; no program, no checker) | evaluate for Oxc parser migration; genuinely syntax-only, so this one should move |
| `packages/snapback-contract/exact-package.mjs` | registers a module loader that runs `node:module`'s `stripTypeScriptTypes(source, { mode: 'transform' })` — full TypeScript lowering via Node's bundled amaro/swc — over **Exact's own checkout sources** (`:163-173`; transform mode is required because that tree uses non-erasable syntax). Ships in the published `@expo/snapback-contract` (`package.json:29`, subpath export `:111-113`) | **declared exception, owner: contract package.** It lowers a sibling checkout for optional dev integration, not admitted user definitions, and it hosts no transform *this* Plan owns. Recording it means the "one family" claim is scoped honestly: a third transform stack exists in the shipped closure and is deliberately out of scope |
| `demos/competitive-checkpoint/surfaces/react-expo/scripts/bundle-runtime.mjs` | esbuild emits a browser ESM runtime fixture | migrate if the fixture remains maintained; otherwise freeze it as historical evidence with an explicit exemption |
| `demos/signal-desk/tests/react-query-group.mjs` | esbuild assembles a real adapter acceptance bundle | migrate to the product-representative Vite/Rolldown path without rewriting retained receipt history |

### The Acorn responsibilities, enumerated

"Acorn scans JavaScript" is not a specification. Stage 1 must preserve each of
these separately, in `packages/snapback-codegen/index.mjs`:

- streamed-response inference (`:4976-5031`);
- handler syntax and ambient-capability diagnostics (`:5075-5383`), including
  the deliberate relaxed script-mode parse at `:5090-5096`;
- static-result refusal (`:5661-5729`);
- protected-query call-graph analysis (`:5760-6257`);
- exported-definition source spans (`:7423-7462`);
- schema-field source spans (`:7465-7518`).

The syntax-only TypeScript handler scanner (`:5386-5659`) is a seventh, and is
the only TypeScript AST use in `index.mjs` that Stage 1 removes.

The census distinguishes four classes:

- **production dependency:** affects what an external Snapback consumer
  installs or executes;
- **product-representative proof:** should use Vite where the product does;
- **lower-level controlled proof/build:** should use Rolldown directly;
- **frozen historical or third-party surface:** recorded but not rewritten
  merely to make a repository-wide string search empty.

Each row carries a disposition **owner** in the Stage-0 machine-readable
ledger, matching the discipline Stage 3.3 already requires for exemptions.

Third-party transitive esbuild dependencies in Wrangler, old demo lockfiles,
or other tools are not first-party transform authority. Success means no
unexplained Snapback-owned direct use, not pretending the entire dependency
ecosystem contains no esbuild bytes. Maintained paved surfaces should use Vite
8; old Vite 6/7 evidence apps are upgraded only when they remain active product
surfaces, not as a history-erasing bulk rewrite.

## Baseline size facts

**Measurement basis.** Each figure is the sum over an explicit package set of
(a) the actual npm tarball byte length fetched from `registry.npmjs.org`
("download") and (b) the registry's `dist.unpackedSize` ("unpacked"). It is
neither transferred bytes under a warm cache nor allocated filesystem blocks;
Stage 0.4 measures those separately on real hosts. Measured 2026-08-01 against
the public registry, not against `bun.lock` — the lock currently resolves Acorn
8.17.0 while the table prices 8.18.0, which is the version a fresh install
would select. The same caveat applies to esbuild, declared `^0.28.1` in both
manifests, where a fresh install could resolve a later 0.28.x than the priced
0.28.1. Per-package versions, integrity hashes, and byte counts are recorded in
the Stage-0 receipt, which self-heals both.

The candidate set now includes Rolldown's two hard runtime dependencies,
`@oxc-project/types` 0.142.0 and `@rolldown/pluginutils` 1.0.1, which v0.1
omitted. The native bindings priced are `@esbuild/darwin-arm64` /
`@esbuild/linux-x64`, `@rolldown/binding-darwin-arm64` /
`@rolldown/binding-linux-x64-gnu`, and `@oxc-parser/binding-darwin-arm64` /
`@oxc-parser/binding-linux-x64-gnu`. **The Linux tuple is glibc, not musl**;
a musl target prices a different binding and is not covered here. Every row
sums to its stated total; three Linux cells in v0.2 did not, and are corrected.

| Package set (Apple-silicon macOS) | Download | Unpacked |
| --- | ---: | ---: |
| esbuild 0.28.1 + `@esbuild/darwin-arm64` | 4,451,782 | 10,721,258 |
| Acorn 8.18.0 | 133,521 | 565,327 |
| TypeScript 5.9.3 | 4,377,468 | 23,625,066 |
| **Current total** | **8,962,771** | **34,911,651** |
| Rolldown 1.2.1 + binding + `@oxc-project/types` + `@rolldown/pluginutils` | 7,411,212 | 17,403,593 |
| `oxc-parser` 0.142.0 + binding | 920,613 | 3,184,858 |
| **Candidate parser+bundler total** | **8,331,825** | **20,588,451** |

| Package set (x86-64 Linux) | Download | Unpacked |
| --- | ---: | ---: |
| esbuild 0.28.1 + `@esbuild/linux-x64` | 4,762,629 | 11,554,938 |
| Acorn 8.18.0 | 133,521 | 565,327 |
| TypeScript 5.9.3 | 4,377,468 | 23,625,066 |
| **Current total** | **9,273,618** | **35,745,331** |
| Rolldown 1.2.1 + binding + `@oxc-project/types` + `@rolldown/pluginutils` | 8,138,183 | 20,175,715 |
| `oxc-parser` 0.142.0 + binding | 1,042,412 | 3,536,788 |
| **Candidate parser+bundler total** | **9,180,595** | **23,712,503** |

### The result depends on decision D-1

| Outcome | macOS download | macOS unpacked | Linux download | Linux unpacked |
| --- | ---: | ---: | ---: | ---: |
| **D-1a**: TypeScript leaves the codegen closure | **-630,946** | **-14,323,200** | **-93,023** | **-12,032,828** |
| **D-1b**: TypeScript retained for inline handlers | **+3,746,522** | **+9,301,866** | **+4,284,445** | **+11,592,238** |

This is the honest form of the size argument, and v0.1 stated only the
favorable half. The direct Rolldown-for-esbuild swap is larger in isolation on
both tuples. The combined plan is smaller **only if** `oxc-parser` replaces
every syntax-only parser stack *and* the TypeScript dependency actually leaves
`@expo/snapback-codegen` — which requires D-1a. Under D-1b the migration is a
size regression and must be justified on other grounds (ecosystem coherence,
parse speed, maintenance surface), stated as such rather than implied to be
free.

A Vite 8 application may already carry Rolldown and deduplicate more, but the
Plan does not count that benefit until clean React-starter evidence proves the
resolved package tree. Conversely, a React application still needs TypeScript
for type checking, so parser migration savings must be reported separately for
the headless and React installation shapes.

## Decisions

### D-1 — the inline-handler symbol service

**Decided 2026-08-02: D-1b.** Retain the TypeScript checker in the shipped
codegen closure; Oxc replaces syntax-only scanners. The admission contract is
unchanged. This records the branch but does not start the program: all stages
remain parked until the current implementation wave clears, and this Plan
stays in Review. Source: `issues/20260802-author-decision-packet.md`.

`inline-handlers.mjs` needs same-file symbol resolution to decide whether an
identifier is a local, a same-file helper, an import, or a top-level binding,
and to resolve const aliases inside the reflective-access detector. Today a
TypeScript `TypeChecker` provides it. `oxc-parser` does not.

- **D-1a — build a Snapback-owned lexical binding resolver.** "Scope-tree
  construction" understates what must be replaced. The existing service also
  performs cycle-safe const evaluation (`inline-handlers.mjs:132-184`),
  duplicate/helper/binding classification (`:293-347`), shadowed-global
  precedence (`:420-432`), lazy helper-graph construction, and deterministic source
  splicing. D-1a unblocks the size result but costs a new security-relevant
  component that must be proven not to narrow the detector, plus a declared
  identity migration for the `SyntaxKind`-encoded canonical AST (constraint 5).
- **D-1b — retain TypeScript in the codegen closure.** No D-1-specific
  extractor, binding-resolver, or canonical-AST migration risk, and no identity
  rotation — but *not* zero inline-handler risk: rendered inline-operation bytes
  and asset authorizers are rescanned through the Acorn-backed unsupported-source
  scanner (`index.mjs:1192`, `:2341`), and that scanner moves under **both**
  branches, so post-splice rescan admission and diagnostics stay at risk either
  way (the Stage-1 gates cover it); Stage 1 still removes Acorn and the
  syntax-only TypeScript scanner. Costs the size result (table above) and
  leaves two parser stacks in the shipped package. This is *not* "zero
  admission risk" for the migration as a whole — the six Acorn scanners still
  move, and their parity is at risk under either branch.

**D-1a requires a behavioral oracle, not a diff.** Before any replacement
lands, freeze a TypeScript-oracle transcript over the full corpus recording,
per input: every identifier classification, every computed-name result, every
helper edge, every diagnostic and span, and every emitted splice decision. The
candidate must reproduce that transcript exactly, except for an explicitly
versioned canonical-AST identity migration. The corpus must cover hoisting,
block/function/`var` scope, destructuring bindings, shadowing, overloads and
duplicate declarations, type-only and imported bindings, alias cycles,
recursive helpers, and the exact helper edge set.

**A prerequisite disposition: the asset-intent carrier is currently broken, and
Stage 0 must not baseline the break.** This loop's review uncovered a
pre-existing defect independent of the migration, filed as
`issues/20260801-asset-intent-implementation-hash-omits-helper-closure.md` and
verified in code. Two halves:

- `snapback.asset-intent-implementation.v1` hashes the authorizer's root
  canonical AST but **not** the reachable inline-helper closure
  (`index.mjs:2384-2397`), while the equivalent record for ordinary functions
  folds in `helpers: [{name, contentHash}]` (`index.mjs:4787-4796`). Asset
  runtime source *does* splice the reachable helpers
  (`inline-handlers.mjs:857`, `index.mjs:2341`), so a helper-only change alters
  what executes while leaving `implementationHash` identical.
- Even when `implementationHash` does move, it is not the lifecycle carrier:
  the client sends only `intentPolicyHash`
  (`packages/snapback-client/assets.mjs:173`, `:180`, `:411`), admission
  compares only the policy hash (`crates/snapback/src/local.rs:5519`), generation is keyed and
  bumped only by it (`crates/snapback/src/assets.rs:958`), and finalization selects
  current-versus-retained authorizer code by policy-hash equality alone
  (`crates/snapback/src/local.rs:7235`).

That contradicts LLP 0044's promise that a changed intent bumps its generation
and that revalidation runs the frozen generation's code
(`LLP 0044#design`). Stage 0 therefore **may not freeze this baseline** until
the ticket is dispositioned: either implementation identity becomes the carrier
(covering the complete executable helper closure and consumed through the whole
chain), or LLP 0044 states coherently why policy and implementation identities
have separate lifecycle semantics. The disposition is recorded before the
Stage-0 gate passes, under **both** D-1 branches — this is not a D-1a-only
concern, because the defect exists today and D-1b would otherwise preserve it
byte-identically.

**Dispositioned 2026-08-03 — author decision sitting #2
(`issues/20260803-author-decision-sitting-2.md`): the first branch is
ruled.** `implementationHash` is extended to the spliced helper closure
and carried through the client/admission/generation/finalization chain;
metamorphic fixtures then pin it. The dated decision lives in LLP 0044's
amendment collection and the ticket is now implementable; Stage 0 may
freeze its baseline once that implementation lands.

**Under D-1a the asset-intent carrier additionally needs lifecycle fixtures, not
just hash equality.** LLP 0044 ties `snapback.asset-intent-implementation.v1` to generated
references, frozen per-intent policy generations, in-flight finalization, and
stale-reference refusal before staging — effects that an identity rotation
changes and that a hash comparison cannot see. D-1a therefore fixtures: an
upload attempt opened under the old generation and finalized after the rotation;
a stale generated upload reference; policy-generation bump and revocation
behavior; rollback; refusal timing; and — under **both** branches, per the
prerequisite above — direct-body, **helper-only**, and `reads`-change
metamorphic cases each asserting generation bump, stale-reference refusal,
frozen-code finalization, rollback, and stability of unrelated intents. Under **D-1b** the identity is
byte-identical and none of this arises, which is a further asymmetry the D-1
decision artifact should weigh.

**The rollout rule must be built on the shipped model, not a removed one.**
LLP 0108 §B (`LLP 0108#b-no-new-expected-operation-or-compatibility-protocol-in-v1`)
explicitly removes `ExpectedOperationV1`, compatibility notices, predecessor
execution windows, and tuple carriage through RQS, groups, resume, and replay;
what remains is the whole-artifact/function-reference compatibility behavior
governed by LLP 0064 and LLPs 0090–0095. A D-1a rotation rule may therefore not
be specified in terms of predecessor/successor tuples. It must instead
enumerate the **actual current identity producers, consumers, and persisted
references** — the function `implementationHash` and the
`snapback.asset-intent-implementation.v1` asset-intent identity are two
carriers; Stage 1 establishes the complete list — and state, for each, what a
whole-artifact reload does to references minted under the old identity, and
what the rollback path is. If predecessor/successor semantics are actually
wanted, that is new design for a governing LLP, not something this Plan may
assume.

**What the branches change in Stage 1.** Steps 1–3 (adapter, the six Acorn
scanners, the syntax-only TypeScript scanner, `check-contract-meta.mjs`) are
identical under both. The branch controls step 4 (oracle transcript, binding
resolver, and identity migration under D-1a; a recorded retention under D-1b)
and step 5's dependency deletion (Acorn only under D-1b; Acorn and TypeScript
under D-1a). It also selects which size rows the acceptance matrix enforces.
D-1 is recorded at the **start of Stage 1** so the oracle transcript is frozen
before the scanners move, not after.

**Selection criterion.** D-1 is an author decision, but it is not an
unstructured one. The decision artifact must record: (a) whether the D-1b size
regression in §Baseline size facts is acceptable — its principal quantified
cost, but not its only one: D-1b also leaves two parser stacks in the shipped
closure with their own version custody, security updates, and maintenance, and
it defers rather than removes the identity exposure, because TypeScript's
numeric `SyntaxKind` values are not stable across releases and the canonical
AST encodes them, so every future forced TypeScript upgrade becomes a declared
identity-migration event; (b) who owns the binding resolver as a security-relevant component
under D-1a, and who reviews it; (c) whether the identity rotation D-1a forces
is worth its rollout, given that the shipped compatibility model is
whole-artifact reload rather than a predecessor protocol; and (d) a fallback if
the D-1a oracle transcript cannot be reproduced.

**Recommendation recorded before the decision.** Executing D-1b first and treating
D-1a as a separately reviewed identity/security migration would reduce
simultaneous moving parts and let real Rolldown/Oxc evidence inform whether
removing TypeScript is worth owning a new binding resolver. That is a
historical rationale for the D-1b branch selected on 2026-08-02.

D-1b's selection does not move LLP 0140 past **Review**. The size conclusion
inverts and TypeScript identity/version custody becomes ongoing; the program is
parked until the implementation wave clears.

## Target architecture

### One family, distinct layers

Use the narrowest member of the family that fits each authority:

- **Oxc parser:** syntax admission, AST-backed diagnostics, static capability
  and unsupported-construct scans, and source-location production.
- **Rolldown programmatic API:** controlled module discovery, TypeScript/JSON
  lowering, linking, and in-memory bundle generation.
- **Vite:** actual browser application builds, dev-server integration, and
  proofs whose claim is specifically that a public Vite application works.

`@expo/snapback-codegen` must not load a user's Vite configuration or arbitrary
Vite plugins while evaluating definition modules. Doing so would give ambient
build plugins filesystem/process authority at the very boundary LLP 0009 and
LLP 0010 close. It uses Rolldown directly with a Snapback-owned plugin and
explicit options. Vite builds used by package proofs run with controlled inline
configuration (`configFile: false` or the equivalent) unless the test's exact
purpose is to exercise the checked-in starter config.

### Snapback-owned parser projection

Do not scatter raw Oxc-node shapes throughout codegen. Introduce a small
Snapback-owned parser adapter that:

- parses JavaScript and the admitted TypeScript extensions with explicit
  source-type and language options;
- normalizes errors into Snapback diagnostics and one-based source spans;
- exposes the ESTree-compatible facts the existing walkers require;
- retains original offsets and filenames for every refusal;
- returns no partial-success program when Oxc reports a syntax error — except
  under the named handler-scan policy below; and
- makes the selected Oxc version observable in doctor/proof metadata without
  treating a version string as a substitute for semantic tests.

**TypeScript reaches the Acorn scanners too.** "Acorn scans JavaScript;
TypeScript's AST scans TypeScript" is a useful summary and an incomplete fact.
Raw TypeScript handler source also reaches three Acorn consumers, each with its
own parse-failure behavior: stream inference falls back to a textual regex
(call at `index.mjs:4968`, fallback at `:4994`); static query-result refusal returns no findings
(`index.mjs:1450`, `:5661`); protected-query analysis selects the masked legacy
scanner (`index.mjs:1474`, `:5765`). Today a `.ts`/`.mts` handler **whose source contains TypeScript-specific
syntax** fails those Acorn parses and silently takes the fallback; plain
ECMAScript in a `.ts` file parses normally, since those consumers receive source
text rather than an extension. Under a *successful* Oxc TypeScript
parse the same input takes the real path — which can change inferred
capabilities, static-result refusals, and protected-query reachability even
when the primary unsupported-source scanner is byte-equivalent. That is an
admission and diagnostic change hiding inside a "parser swap."

Stage 1 therefore produces a **per-consumer matrix**, not a single set of
options: for each of the seven consumers × each admitted extension, the row
records file extension, `lang`, `astType`, `sourceType`, `range`,
`preserveParens`, `showSemanticErrors`, the current parser, the current
parse-failure behavior, the candidate behavior, and any permitted difference
with its justification. Stage 0 adds `.ts`/`.mts` fixtures for
comment-only-versus-real `fetchStream`, object-returning queries, and
direct/aliased protected runtime calls, and the differential sweep compares
**diagnostics as well as admission** across the complete current TypeScript
path and the pinned Oxc path. A related phase hazard: TypeScript's
`parseDiagnostics` currently accepts several constructs that esbuild refuses
later (`index.mjs:5398`), so an Oxc refusal can move the diagnostic's phase,
code, span, and custody even where final admission is unchanged. Those are
compared, not assumed equal.

**Pinned parser call matrix.** The adapter never inherits a default. For each
admitted dialect it pins the API — `oxc-parser@0.142.0`'s parsing entry
points are exactly `parseSync` and `parse` — there is no `parseAsync` (the
module also exports visitor utilities and enums) — plus the filename passed,
`lang`, `sourceType`, `astType`, `range`, `preserveParens`, and
`showSemanticErrors`. Two of those pins are load-bearing rather than hygienic:

- `preserveParens: false`. The default is `true` and emits non-standard
  `ParenthesizedExpression` nodes. The shipped `unwrapCallable`
  (`packages/snapback-codegen/index.mjs:5157-5164`) unwraps `ChainExpression`
  and `SequenceExpression` but not parentheses, so under the default an
  `(eval)(...)` spelling would evade the dynamic-code detector. Measured at
  0.142.0: default parse of `(eval)(x)` yields callee `ParenthesizedExpression`;
  with the pin it yields `Identifier`.
- `showSemanticErrors: true` for the handler and definition scanners. The
  default (`false`) suppresses a **subset** of the early-error family, not all
  of it: measured at 0.142.0, getter arity (`({ get x(a) {} })`) is reported
  with the option both off and on, while redeclaration (`let a; let a;`) and
  strict-mode legacy octal are reported only when it is on. So the option is
  neither a no-op nor a blanket switch, and the exact membership of the subset
  is what the differential sweep must establish — the earlier blanket claim was
  wrong. Turning it on narrows the widening direction at the cost of new
  refusal classes, which the structural-category manifest must place, and whose
  complete observed list the Stage-1 receipt enumerates rather than leaving to
  prose. This is the Plan's position, not an execution-time choice; the sweep
  exists to falsify it, not to make it.
- `sourceType` is never `'unambiguous'` or `'commonjs'`; both invite admission
  ambiguity at exactly the boundary this Plan protects. A test asserts the
  adapter's own option object against the pinned matrix, so configuration drift
  fails rather than silently changing admission.

**Offset unit contract.** `oxc-parser` exposes `start`/`end` offsets and no
`loc`, while every current scanner site reports one-based
`node.loc.start.line`/`.column` (e.g. `index.mjs:5135-5137`), so the adapter
owns the offset-to-line/column derivation. Measured at 0.142.0 through the
N-API boundary, those offsets are **UTF-16 code units, not UTF-8 bytes** — the
statement following `const s = "😀😀"; ` starts at offset 18, the string's
UTF-16 length. That is already Acorn's unit, so the compatibility target is
"UTF-16, convert nothing." The frozen corpus (non-BMP characters, combining
marks, tabs, LF, CRLF) exists to guard against an upstream change to that N-API
conversion, not to discover the unit. A span contract tested only on ASCII is
not tested.

Malformed-UTF-8 rejection stays where it is: fatal byte validation happens at
ingestion in `packages/snapback-codegen/file-read-capability.mjs:100`, before
any parser receives a string. The parser migration does not move it.

**Handler-scan parse mode.** The JavaScript handler scanner deliberately parses
closed scripts with relaxed Acorn options (`sourceType: 'script'`,
`allowAwaitOutsideFunction`, `allowHashBang`, `allowImportExportEverywhere`;
`index.mjs:5090-5096`) so that `import`/`export`/`with` in a handler file yield
the stable authored diagnostics `BUNDLE_UNSUPPORTED_IMPORT` /
`BUNDLE_UNSUPPORTED_EXPORT` / `BUNDLE_UNSUPPORTED_WITH` (`:5236-5257`) instead
of degrading into `BUNDLE_HANDLER_PARSE_FAILED`. `BUNDLE_UNSUPPORTED_EXPORT`
exists specifically to close a documented agent dead-end.

`oxc-parser`'s model is not "strict or relaxed" — it is **recover where it can,
return a program projection, classify errors**. Oxc documents its recovery as
*partial*: it does not promise a complete AST for arbitrary malformed input. The
design does not depend on the stronger claim, because only **categorized,
fixtured** cases may consume a recovered AST and every other error is fatal.
Measured at 0.142.0:

| Input | Mode | Default | `showSemanticErrors: true` |
| --- | --- | --- | --- |
| `import x from "y"` | script | **0 errors**, `ImportDeclaration` returned | 1 error, AST still returned |
| `export const a = 1` | script | **0 errors**, `ExportNamedDeclaration` returned | 1 error, AST still returned |
| `with (a) { b; }` | module | **0 errors**, `WithStatement` returned | 1 error, AST still returned |
| `await fetch(1)` | script | **1 error**, AST recovered | 1 error |
| `await fetch(1)` | module | 0 errors | 0 errors |
| `let a; let a;` | script | **0 errors** — Acorn *rejects* this today | 1 error |
| `<!-- c` | script | 0 errors | 0 errors |
| `<!-- c` | module | **1 error** | 1 error |

So the stable `BUNDLE_UNSUPPORTED_*` diagnostics are derivable from a **single
parse** in script mode: the `ImportDeclaration` / `ExportNamedDeclaration` /
`WithStatement` nodes are simply present in the returned AST, and the scanner
reads them exactly as it reads any other node. No dual-parse and no
error-recovery scheme is required for that family. The real design question is
narrower and different:

1. **Top-level `await` in script mode is a genuine gap, and the Plan chooses to
   close it by preserving admission.** Acorn's `allowAwaitOutsideFunction`
   (`index.mjs:5090-5096`) admits `await` at handler top level and no later
   `AwaitExpression` rule refuses it, so it is admitted today. Oxc script mode
   reports an error for it — but recovers and returns the program. The adapter
   therefore defines a structural category **`top-level-await-in-script`**,
   classified **non-fatal and admitted**. That is a parse-mode artifact, not an
   admission decision, and preserving it is what "not a semantic rewrite"
   requires. No new authored diagnostic is introduced.

   **The recognizer must be written over what Acorn actually admits, which is
   more than the bare-statement form.** Measured against the production Acorn
   options (acorn 8.17.0) and `oxc-parser@0.142.0`:

   | Input | Acorn today | Oxc script | Recovered shape |
   | --- | --- | --- | --- |
   | `await fetch(1)` | admits | 1 error, label 0–5 | program-level `AwaitExpression`, span 0–14 |
   | `const v = await fetch(1);` | admits | 1 error, label 10–15 | `AwaitExpression` inside `VariableDeclarator.init` |
   | `if (await x) { y() }` | admits | 1 error, label 4–9 | inside `IfStatement.test` |
   | `for await (const x of y) {}` | admits | 1 error, label 4–9 | `ForOfStatement` — **no `AwaitExpression` node exists at all** |

   So a recognizer keyed on "a program-level `AwaitExpression`" would leave
   three of four admitted spellings unmatched and therefore fatal under the
   fatal-unmatched default — a silent admission *narrowing*, which the widening
   sweep by construction cannot catch. And even for the bare form the error's
   label span (0–5, the keyword) does not equal the node span (0–14), so
   span *equality* is the wrong predicate.

   The category is therefore: **an error whose label span covers an `await`
   token whose nearest enclosing function or class-field-initializer boundary
   is the Program** — matched by span containment against the keyword, not node
   equality — plus `ForOfStatement` nodes with `await: true` in the same
   position, which carry no `AwaitExpression` to match. Stage 0 fixtures all
   four forms by name, plus destructuring and class-static-block corners where
   Acorn's `allowAwaitOutsideFunction` and Oxc's error placement may differ —
   **and the misclassification direction**: a genuinely fatal syntax error
   adjacent to an identifier spelled `await` at program level in script mode
   (`await` is a legal identifier there), asserted to stay **fatal**. The
   recognizer matches the `await` *keyword token*, not the text, and that
   fixture is what forces the implementation to consult token classification
   rather than spelling.

   **This fixes a general defect, not one category.** "Recognized from the
   returned AST and the error's span" left the matching predicate undefined for
   every category: the `import`/`export`/`with` errors also carry keyword-sized
   label spans (`import` labels 0–6 against an `ImportDeclaration` node of
   0–17 for `import x from "y"`). Every structural category matches by **label-span containment within
   the node's span**, and Stage 1 states the consumption rule when several
   errors coexist — which error each category consumes, and whether precedence
   runs over error order or span order — so the mixed-error acceptance row has
   an adapter rule behind it rather than only an expected outcome.

   This is deliberately *not* a mode switch to `sourceType: 'module'`, which
   would also make top-level `await` legal but would introduce two new
   divergences (`await` as an ordinary identifier is legal in script and
   reserved in module; HTML comments are legal in script and an error in
   module). Preserving one construct by breaking two is a worse trade.

   Note the surface split: this is the **handler scanner**. Bare top-level
   `await` in a *definition module* is refused at bundle time today and stays
   refused — Rolldown 1.2.1 errors on it under `format: 'iife'`, so that
   refusal survives independently.
2. **`showSemanticErrors` moves admission in both directions.** With it off,
   oxc admits a redeclaration (`let a; let a;`) that Acorn rejects today as
   `BUNDLE_HANDLER_PARSE_FAILED` — a silent widening. With it on, new refusal
   classes appear that no current code path produces. Neither default is
   automatically right.

**Error disposition rule — Snapback-owned categories, not upstream classes.**
`OxcError` carries severity, a free-text message, labels, help text, and a
codeframe. It carries a `severity` discriminant but **no stable error-kind code or
class**, so a table keyed
on "every Oxc error class" is not implementable and must not be specified.
Instead:

- The adapter defines a finite set of **Snapback-owned structural categories**
  recognized from the returned AST and the error's span — e.g. "an
  `ImportDeclaration` is present in a handler scan," "a `WithStatement` is
  present" — never from message text. These map to the existing stable
  `BUNDLE_UNSUPPORTED_*` codes with authored spans.
- Every parser error not matched by a structural category is **fatal**: no
  program is handed to a caller. Fail-closed is the default, so an upstream
  message change cannot silently downgrade a refusal.
- If any exact-version message matching is used at all, the Plan names it and a
  fixture pins it, so a version bump breaks the test rather than the contract.

The no-partial-success rule is restated in those terms: the adapter never hands
a caller a program when an unmatched (fatal) error is present, and never
suppresses a categorized error into silence. A recovered AST accompanied only
by categorized errors is a legitimate input to the scanners — which is what
makes the single-parse design above lawful. The same node-presence logic
already covers `import.meta` in handler scans (`index.mjs:5240-5244`, mapped to
`BUNDLE_UNSUPPORTED_IMPORT`), so that refusal survives the single-parse design
without a special case.

**Admission drift is checked from Acorn, not from Oxc.** A table of what Oxc
reports structurally cannot see what Oxc *stops* reporting. Stage 1 therefore
runs a **differential-acceptance sweep**: for every input, record Acorn's
verdict and the pinned-Oxc verdict, and fail in **both** directions — on any
input Acorn rejects that Oxc admits (widening), and on any input Acorn accepts
that the adapter refuses (narrowing), modulo the declared `showSemanticErrors`
refusal classes — and "declared" is bounded: a class qualifies only if the
*current* end-to-end pipeline already refuses it with equivalent diagnostic
custody. A construct discovered mid-execution to be current-valid and
Oxc-invalid may not be added to the declaration to make the gate pass; that
would contradict Stage 2's rule that admission weakening is never a permitted
disposition. The harness is identical either way, and the top-level-`await`
recognizer defect corrected in v0.6 is exactly the narrowing class a
widening-only sweep cannot see. The reference is the **Acorn the
shipped scanner actually runs** — 8.17.0, what `bun.lock` resolves — not the
8.18.0 the size table prices. The input set is named, not gestured at:

- the frozen Stage-0 corpus;
- Acorn's own test suite's negative cases, taken from the git tag matching the
  **locked 8.17.0** (they are not in the npm tarball, which ships `dist/` only);
- the TypeScript compiler's parser-error baselines at the repository tag
  matching the pinned 5.9.3 (they are not in the npm tarball either), so the
  TypeScript dialect has an external negative source rather than resting
  entirely on Snapback's own fixtures — the per-consumer matrix identifies the
  TypeScript-reaching paths as the highest-drift area, so they cannot be the
  least externally evidenced;
- the Test262 negative syntax and early-error cases for the admitted language
  level; and
- a versioned deterministic generator plus seeded, shrinking differential
  fuzzing, with seeds and minimized regressions committed.

The receipt records each source, its hash, the generator version, the fuzz
seeds, and the case count.

**Residual nonclaim, stated rather than implied.** This is bounded differential
evidence, not a proof of grammar equivalence. A passing sweep leaves unproven:
admission equivalence outside the declared sources and generator; untested
combinations of recovery, early errors, and scanner rules; behavior under
future Rolldown/Oxc/TypeScript versions; performance outside the frozen
workloads and measured hosts; unsupported platform tuples; post-publication
rollback effectiveness; **concurrent-generation liveness** — esbuild's work
happens in a subprocess while Rolldown and Oxc are in-process N-API calls
contending with the host event loop and libuv thread pool, so under parallel
generation (several backends, or the Vite dev loop regenerating during a test
run) the new failure shape is a stall rather than an error, and the
frozen-workload latency gate will not see it; **process-fatal native failure** — esbuild runs as a
subprocess while `oxc-parser` and Rolldown are in-process N-API bindings, so a
native panic or abort that escapes the napi boundary is a failure shape the
current toolchain cannot produce; the adapter maps any caught native-level
exception to a stable fatal code rather than a raw throw, but an uncatchable
abort remains a new possibility class; Vite regeneration *races* under rapid edits, as opposed
to the dev *states* the matrix fixtures; and the quality of the D-1a binding
resolver's security review, which the selection criterion assigns an owner for
but which no gate can prove. Exact version pins bound the third of those; the rest
are the honest limit of the method.

The existing Acorn scans and TypeScript-AST scan move onto that projection.
Where Oxc's TypeScript AST differs, the rewrite must preserve the current
lexical-role, alias, reflective-access, dynamic-code, and ambient-capability
coverage rather than narrowing the detector to convenient node shapes. Under
D-1a the same applies to the binding resolver replacing the `TypeChecker`.

TypeScript lowering without type checking is performed by **Rolldown's bundled
Oxc transformer** — `oxc-parser` parses and does not itself lower — but isolated
transform behavior differs by option for namespaces, decorators, enums, class
fields, and import elision. Stage 1 states the admitted TypeScript feature
matrix and, for each item, either a parity rule or a deliberate refusal.

### Snapback-owned Rolldown admission plugin

The definition bundler retains a single plugin that owns every graph edge. It
must:

- supply the synthetic serialization facade under the literal reserved virtual
  id **`snapback:facade`** — no `\0` prefix — with `output.entryFileNames`
  pinned to the literal **`[name].js`**. Measured at 1.2.1: a `\0`-prefixed
  *entry* id does **not** fail; `generate()` succeeds and the NUL is **silently
  sanitized to `_`** in the emitted filename (`\0snapback-facade` →
  `_snapback-facade.js`). Sanitization is not limited to NUL: the pinned id
  `snapback:facade` itself emits **`snapback_facade.js`**, the `:` mangled the
  same way. The pin does not escape mangling — it makes the mangled result
  *deterministic*, and the exactly-one-chunk fixture asserts that literal
  filename. Silent name mangling is worse than a loud error, which is why the
  id is a pinned literal rather than a described rule — and it
  is a second reason Cloudflare identity must come from the Snapback-owned
  ledger rather than rendered chunk names. The facade id, the attribute-pair
  ids below, Rolldown's `\0rolldown/runtime.js`, and user paths occupy
  **disjoint** namespaces, and the plugin asserts no collision;
- admit only the existing relative, `file:`, absolute-local, and explicit
  Snapback-package allowlist cases;
- reject dynamic import, CommonJS `require`/`require.resolve`, Node builtins,
  unsupported extensions, query/hash identities, `import.meta` in every
  spelling, ambiguous package scope, and paths outside the authorized roots
  with the existing diagnostic families;
- load bytes through the existing descriptor/capability-aware file reader
  (`resolveFileReadCapability`, `index.mjs:7698-7732`) rather than letting
  Rolldown reopen already-authorized paths ambiently;
- record the same graph path, source bytes, and governing `package.json` facts,
  preserving the nearest-package module-format lookup that stops at
  `node_modules` and the unconditional `.cjs`/`.cts` refusal
  (`index.mjs:7817-7838`, `:8174-8199`);
- keep schema, functions, and routes as **separate graphs with separate fresh
  evaluations** (`index.mjs:617-645`), not one combined IIFE or context;
- preserve the split where only the functions graph receives the
  inline-handler-transformed entry while identity records the authored bytes
  (`index.mjs:603-625`, `:7833-7838`);
- preserve `absWorkingDir`/resolution-root parity (`index.mjs:7737`);
- emit one in-memory ES2022 IIFE with the existing intrinsic-capture banner and
  no legal-comment or sourcemap nondeterminism; and
- preserve **case-insensitive extension folding**. Definition admission
  (`index.mjs:7817`), loader selection (`:7979`), module-format classification
  (`:8174`), handler-path admission (`file-read-capability.mjs:127`), and
  TypeScript scanner dispatch (`index.mjs:5075`) all match extensions with `/i`
  today, so `.MJS`, `.MTS`, `.JS`, `.TS`, and `.JSON` follow their lowercase
  semantics and uppercase `.CJS`/`.CTS` are recognized and refused as CommonJS.
  A case-sensitive Oxc language dispatch or Rolldown module-type map would
  narrow admission while every lowercase fixture passed, so Stage 0 carries
  case IDs for mixed-case handler dispatch, mixed-case ESM/TS/JSON graph
  dependencies, and uppercase CJS/CTS refusal;
- resolve **exact files only**: one specifier maps to one candidate path, read
  as a regular file (`index.mjs:7802-7806`,
  `file-read-capability.mjs:34`, `:61`). No extension probing, no directory
  index, no `main`, no `exports` resolution. Forbidding fallback into
  Rolldown's resolver is not the same as forbidding a Snapback-owned resolver
  from growing those rules, and prose that only says the former would admit a
  widening implementation; and
- use no CommonJS compatibility plugin or default resolver fallback that can
  silently widen the graph.

**Pinned option manifest.** Several Rolldown defaults conflict with the closed
contract and must be set explicitly, version-pinned, and asserted in a test
rather than assumed:

| Option | Required | Why |
| --- | --- | --- |
| `tsconfig` | `false` | the default discovers a user `tsconfig.json` and can apply `baseUrl`, path mappings, and transform settings — ambient filesystem and configuration authority at the closed boundary. This is **parity, not narrowing**: measured, the discriminator is which resolver resolved the module, not who supplied the bytes: a default-resolved file whose contents come from `onLoad` **does** get the tsconfig applied, while a plugin-resolved path does not — and the shipped path resolves everything through the catch-all `onResolve` (`index.mjs:7783`) — so a user tsconfig has no effect today either, and the "must not take effect" fixture pins existing behavior |
| `treeshake` | `false` | declaration side effects must not be optimized out |
| `output.format` | `iife` | the evaluator contract |
| `output.codeSplitting` | `false` | exactly one chunk per graph; no assets, no maps |
| `output.polyfillRequire` | `false` | the default is `true` and would synthesize a `require` the graph must refuse |
| `output.minify` | `false` | determinism |
| `output.comments` | `{ legal: false, annotation: false, jsdoc: false }` | determinism. Note the type: `CommentsOptions.legal` is a **boolean**, not esbuild's `'none'` — passing `'none'` is a hard `InvalidArg` at 1.2.1 — but only at the **output**
level. Measured: placed at input level, `comments` is warned and **silently
ignored** and comments are retained: the same misplacement-fails-open hazard as
`attachDebugInfo`, in the opposite nesting direction. `output.legalComments` is deprecated in favor of `comments.legal`, which takes priority when both are set. The sibling classes default to `true` and are pinned deliberately rather than inherited |
| `experimental.attachDebugInfo` (**input** option) | `'none'` | the default emits `//#region <module-id>` markers into output bytes — checkout-position-dependent content in the definition IIFE. Measured: this is an *input* option; passing it under output options is **warned and silently ignored**, not rejected — so a misplaced pin fails *open*, and the immutable-input-manifest self-assertion is what actually catches misplacement (measured: option-validation warnings print directly and are **not** delivered to a registered `onLog`, so the unknown-warning policy cannot escalate them — the manifest self-assertion is not merely the better catch, it is the only possible one). "Debug output disabled" is not a pin; this is |
| `output.sourcemap` | `false` | determinism |
| `transform.target` | `es2022` | the current esbuild call pins `target: ['es2022']` (`index.mjs:7742`); Rolldown's documented default is `esnext`, and lowering lives in transform options, not a top-level mirror. Without this row, output bytes drift with the tool version |
| `platform` | `neutral` | no Node or browser ambient assumptions |
| `external` | empty | no unresolved edges |
| `cwd` / `input` | explicit | matches the current `absWorkingDir` root |
| module types / loaders | explicit: the JSON / TS / JS set `definitionLoader` already returns (`index.mjs:7979-7983`), matched **case-insensitively** as today | no inferred loader widens the admitted extension set. Synthetic attribute ids carry no extension, so module-type selection must canonicalize through the `syntheticId → realPath` association |
| `checks` / `onLog` | explicit, see warning policy | defaults are on |
| `logLevel` | `'info'` — a delivery-preserving literal, never `'silent'` | measured at 1.2.1: `logLevel: 'silent'` delivers **nothing** to a registered `onLog`, including codes whose `checks` entry is explicitly pinned on. Under a naive parity translation of the shipped `logLevel: 'silent'` (`index.mjs:7745`) the escalation below is inert, `generate()` succeeds, and `import.meta` fails open to `{}` — the exact outcome constraint 1 exists to prevent. Silencing happens inside Snapback's own `onLog`, never by disabling the channel |
| `output.banner` | the intrinsic-capture banner | as today (`index.mjs:7748-7770`). Rolldown defines this on `OutputOptions`, so the serialized path is `manifest.output.banner`, passed to `generate()`; a root-level `banner` would not configure it. A behavior test proves the intrinsic declarations precede all authored and module code, and a negative test covers input-level misplacement |
| plugin order | single Snapback plugin, no others | no ambient plugin authority |
| alias / inject / define | empty | no synthetic rewriting |
| experimental/debug output | disabled | no incidental artifacts in identity |

The manifest is stored as a versioned JSON object consumed by both production
and tests — the table above is generated from it. Assertion has two halves,
because Rolldown's normalized-option surface is partial: the normalized input
object exposed to `buildStart` at 1.2.1 omits `tsconfig`, `treeshake`,
`transform`, `external`, and `checks`. So Snapback validates the immutable
input manifest itself, asserts only the normalized subset Rolldown actually
exposes, and **behavior-tests** the rest — a fixture per unobservable
load-bearing setting; the self-assertion also states whether the normalized
object's `inner` member is consulted or ignored, so an upstream widening of that
object cannot silently expand what "asserted" means (a user `tsconfig.json` that must not take effect, a
side-effecting declaration that must survive, a `require` that must not be
polyfilled). `bundle.close()` is called on every path; the `build()`
convenience API is not used, because it writes to disk unless `write` is falsy;
its automatic cleanup is documented, so the reason to prefer the explicit
`rolldown()`/`generate()`/`close()` path is the disk write and the explicit
lifecycle, not a missing cleanup. Exactly one output chunk, no assets
and no maps, is asserted per graph, and a fixture asserts the **absence** of
source-path or debug markers in the emitted bytes, matching **both**
`//#region <id>` and `//#endregion`. The two spellings do not always appear
together, and the discriminator is exactly `minify`. Measured on
`const unused = 1; export const y = 2;` with `treeshake: false`:
`minify: false` (the pinned value) → matched `//#region <path>` /
`//#endregion` pair, unused binding retained; `minify` **omitted** or
`minify: 'dce-only'` → region-open line elided, a **bare `//#endregion`**
remains, unused binding eliminated. A `#region`-only assertion misses the
second shape entirely. Matching both is
defensive against the configuration the fixture is not running in.

One measured caution for the dual-run comparison, corrected: under the
**complete pinned manifest** (`minify: false` included) `treeshake: false` does
preserve an unused top-level declaration; `export const y = 2` emits
`const y = 2; … exports.y = y`. An earlier draft reported the binding being
eliminated, which was measured with `minify` omitted, where Rolldown inherits a
DCE-only default. The conclusion is unchanged and does not depend on the
measurement: bundle bytes are not the semantic oracle, evaluated values and
artifacts are — but the pinned manifest is closer to statement fidelity than
that draft claimed. And bare top-level
await under `format: 'iife'` is a hard build error at 1.2.1
(`[UNSUPPORTED_FEATURE] Top-level await is currently not supported with the
'iife' output format`), so the current refusal survives; Stage 2 maps that
error to the existing stable code rather than to the deleted esbuild text
sniff.

**Fallthrough is not neutral.** A Rolldown plugin hook returning `null`
delegates to Rolldown's built-in resolution. Every resolution and load path in
the Snapback plugin must therefore resolve or refuse — never return `null`.
Stage 2 must test that no built-in path is reachable.

**Warning policy.** Today the bundler runs `logLevel: 'silent'` with exactly
one escalation (`index.mjs:7745-7747`). Rolldown has a broader `checks`/`onLog` surface whose
per-class defaults **vary** — several unresolved-name and import checks default
on while, for example, `circularDependency` defaults off. So every supported
class is explicitly pinned and dispositioned, including the default-off ones,
rather than inherited. Stage 2 produces a per-class table — suppressed,
escalated to a stable-code refusal, or surfaced — and an **unknown-warning
policy**: any class not in the table escalates to a refusal, so an upstream
addition cannot arrive as silence. A fixture proves that a provoked warning class actually **reaches** `onLog`
under the production option object — without it a silenced channel would make
the whole policy vacuous and nothing would notice — and a second fixture
provokes an *unlisted* class to prove the unknown-warning escalation fires.
Four classes already carry seed dispositions — the enumeration is seed data,
and the unknown-class escalation is the actual closure:
`EMPTY_IMPORT_META`, escalated below;
`MISSING_NAME_OPTION_FOR_IIFE_EXPORT`, which the definition IIFEs provoke;
`MISSING_GLOBAL_NAME`, measured to co-fire with the next one under
`format: 'iife'`; and `UNRESOLVED_IMPORT` — measured, a bare specifier no resolver claims produces a
*successful* build with an implicit external under `logLevel: 'silent'`, so the
never-return-`null` rule is backed by an explicit escalation rather than only by
the rule. Stage 2 dispositions all four rather than discovering them. The escalation is implemented
in **`onLog`**, treating the emitted log code
`EMPTY_IMPORT_META` as fatal — measured, `checks.emptyImportMeta` accepts only
booleans (`'error'` is a hard napi type failure), and `true` is already the
default: the `checks` surface can keep the warning *emitted* but can never
escalate it to a refusal. So `checks.emptyImportMeta: true` is pinned to stop
the check being disabled out from under `onLog`, and `onLog` performs the
refusal. Note the two spellings differ (`emptyImportMeta` is the option key,
`EMPTY_IMPORT_META` the log code); the Plan names both so the drift its own
policy exists to catch cannot happen here. Stage 2 pins, by test, whether a
fatal raised from `onLog` actually aborts `generate()` at the pinned version or
whether the scan-time refusal is the only deterministic failure point. A
provisional measurement at 1.2.1: a thrown `onLog` error does abort
`generate()`, so the pin starts from evidence rather than open uncertainty. `import.meta` is additionally refused at scan time (`oxc-parser` returns
`importMetas` spans in its ESM info, which makes this nearly free).

**Import-site spans and `require.resolve` do not come from the resolver.**
Rolldown's `resolveId` receives source, importer, and `kind`, but no authored
import-site position — and its `kind` set (`import-statement`,
`dynamic-import`, `require-call`, `import-rule`, `url-token`, `new-url`,
`hot-accept`) has no `require-resolve`. A probe against the
repository-installed Rolldown left `require.resolve("./x")` verbatim and never
invoked `resolveId` at all. Both facts point the same way: the parser, not the
resolver, is the authoritative edge list.

**Two ledger layers, because authored specifiers are not runtime edges.** A
naive "every specifier the parser saw" ledger would over-admit and over-hash.
Measured at both esbuild 0.28.1 and Rolldown 1.2.1: `import type { T } from
"not-installed"` bundles cleanly and the resolver is **never invoked** for that
specifier — the same for `export type { … } from`, and for a value import used
only in a type position. Only the runtime-value twin reaches the resolver and is
refused. So the migration keeps two layers:

- the **authored syntactic-specifier ledger** — every specifier the Oxc scan
  saw, with its authored span. This owns diagnostics and span attribution, and
  it is where `require.resolve` is detected.
- the **projected runtime-edge ledger** — the subset that survives TypeScript
  import elision. This owns admission and identity, and it is what must match
  the current esbuild-derived graph.

Stage 1 states how each form projects under `tsconfig: false`: `import type`,
`export type`, type queries, a value import used only as a type, and
`import = require`. Stage 0 fixtures each form with a missing/bare/outside-root
specifier **and** its runtime-value twin, asserting resolver invocation, graph
membership, and identity for both.

Resolver-hook refusals map back to the syntactic ledger for their spans; they
do not invent positions, and they are not the sole detector for any refusal
class — except `require.resolve`, whose only preventive static detector is the
scan (the capability-empty evaluator is its runtime backstop). Stage 2 fixtures
that asymmetry explicitly rather than letting the both-detectors row imply
symmetry that does not exist.

**Diagnostic re-derivation, not porting.** `index.mjs:7852-7854` sniffs
esbuild's literal error text (`'Top-level await'` plus a line containing
`'import('`) to produce `CODEGEN_DYNAMIC_IMPORT_UNHASHABLE`. That string match
is esbuild-specific and will silently stop matching. Stage 2 re-derives this
refusal from Rolldown's own signals rather than porting the sniff.

**Import attributes stay admitted — and they change module-instance identity,
which the two bundlers do not agree on.** v0.2 listed import attributes in the
invalid corpus and the fail-closed matrix. That was wrong: the current path
**accepts** them. But admission is not the whole contract. Measured, importing
the same JSON path twice with different attribute maps:

```js
import a from "./a.json" with { type: "json" };
import b from "./a.json" assert { type: "json" };
export const r = a === b;
```

- **esbuild 0.28.1** invokes resolve/load **twice** (attribute maps
  `{"type":"json"}` and `{}`), emits two JSON objects, and `r` is **`false`**.
- **Rolldown 1.2.1** invokes `resolveId` **once**, emits one object, and `r` is
  **`true`**.

The cause is structural: esbuild exposes attributes to plugin hooks, while
Rolldown's `ResolveIdExtraOptions` carries only `custom`, `isEntry`, and `kind`.
Snapback's current graph ledger is keyed by real path alone
(`index.mjs:7687-7731`). So unchanged authored source can **evaluate
differently** after the swap while every admission fixture passes — a semantic
change wearing a toolchain change's clothes, and exactly what this Plan says it
is not.

Therefore: **runtime module *instance* identity is the pair (resolved real
path, normalized attribute map)**, not the path alone.

**The normalization function, stated — and it is deliberately unintuitive.**
Parity with the current path, not semantic tidiness, is the criterion:

| Authored form | Normalized map | Rationale |
| --- | --- | --- |
| no attributes | `{}` | baseline |
| `assert { … }` (legacy) | **`{}`** | measured: esbuild delivers the legacy spelling to the hook as an *empty* map, so it is today's equivalent of "absent". Normalizing `assert` onto the `with` map would **merge** two instances that are distinct today — a silent semantic change under this Plan's own rule |
| `with { … }` | **cooked** keys and values — decoded exactly as esbuild delivers them in `args.with` — with decoded keys sorted and one pinned canonical serialization | measured: `with { z: "a", x: "b" }` and `with { "x": "\u0062", "\u007a": "a" }` reach esbuild as the *same* cooked map `{"x":"b","z":"a"}` and share **one** module instance. A digest over raw authored lexemes would mint two instances and duplicate side effects — "as authored" was ambiguous at a load-bearing identity boundary, and it means cooked |

The measured consequence to pin: `with { type: "json" }` and
`assert { type: "json" }` on the same path are **two** instances today and must
remain two. Stage 0's mixed-spelling fixture asserts that outcome
(`a === b` is `false`), not merely that both bundle.

**The mechanism, because a normalization rule alone is not implementable.**
Rolldown's `resolveId` receives the same `(source, importer, kind)` at both
import sites and cannot tell them apart, so no resolver-side rule can split
them. The split happens **before** Rolldown resolution: the Oxc scan already
has every import site's span and normalized map, so the plugin rewrites the
importer's source at load time, replacing each specifier whose normalized map is
non-empty with a Snapback-owned synthetic specifier
`snapback:attr/<mapDigest>/<realPathDigest>`. **The key is the resolved real
path, not the authored specifier.** Keying on the specifier collides:
`/a/main.ts` and `/b/main.ts` can both import `./dep.ts` with the same map, and
identical synthetic ids would let Rolldown merge two different files globally —
the opposite of the bug being fixed. The plugin therefore maintains a
`syntheticId → realPath` association, and **every** downstream use canonicalizes
through it: child-edge resolution (the resolver derives its base directory from
the *real* importer, `index.mjs:7802-7806`), nearest-`package.json` module-format
lookup, the capability-aware read, **module-type/loader selection**, the graph
projection, and diagnostic projection. A synthetic id that reaches any of those un-canonicalized is a
defect, not a variation.

**The synthetic id stays the module id end to end.** `resolveId` returns it
*unchanged* — returning the real path would re-merge both sites onto one module,
which is the exact behavior being worked around — and only `load` maps it to the
real path's bytes. The graph-identity projection collapses it back to the real
path (identity is per file; instantiation is per pair). Distinct pairs get
distinct ids; identical pairs share one; empty maps are untouched, so the common
case involves no rewrite.

**Every attributed edge family is rewritten, not just `import` declarations.**
Measured at esbuild 0.28.1, attributes are admitted today on binding imports,
side-effect imports, source-bearing named re-exports, star re-exports, and
namespace re-exports, on JavaScript and TypeScript as well as JSON, with
arbitrary attribute keys — the catch-all resolver (`index.mjs:7783`) restricts
neither syntax nor extension. A candidate that rewrote only `ImportDeclaration`
would pass every named row and silently merge instances that are distinct today.
So the rewrite covers all of those forms across every admitted extension, and
Stage 0 fixtures **each edge family** against identical, distinct,
present-versus-absent, and `with`-versus-`assert` maps, asserting instance
identity, side-effect **count and order** (via a recording array), and value
behavior — not merely successful bundling. Four
further fixtures pin the cooked-equivalence boundary: reordered keys,
identifier-versus-string keys, escape-equivalent keys, and escape-equivalent
values — each asserting a **single** shared instance and one side effect. One
fixture pair uses a **non-`type: "json"`** attribute map on a JavaScript import,
so the corner with no other frozen oracle has one.

**The rewrite changes source length, so diagnostics need an edit map.**
Recovering the authored span from the syntactic ledger covers *resolver-edge*
refusals, but a later Rolldown parse or link diagnostic located after a
rewritten specifier would point into transformed source: measured with a proxy,
a same-line top-level-`await` diagnostic after an attributed import moved from
column 48 to 127 under a digest-bearing specifier. Since the acceptance contract
requires every diagnostic to carry the authored line and column, the plugin
maintains an **internal edit map** — per rewritten file, the ordered
(originalStart, originalEnd, replacementLength) triples — and back-projects
every downstream Rolldown location to authored UTF-16 offsets, not only resolver
errors. This is internal diagnostic custody; output sourcemaps stay disabled.
**Composition order, because two length-changing transforms already meet on the
highest-value file.** Inline-handler extraction already replaces authored
expression ranges with length-changing marker expressions
(`inline-handlers.mjs:826-829`) and hands the functions bundler a substituted
entry (`index.mjs:603-625`, `:7833-7838`). The order is **inline extraction
first, attribute rewrite second**: the attribute rewrite's Oxc spans are taken
over the *transformed* functions entry, and the edit map composes with LLP
0108's splice accounting to project back to **authored** offsets in two hops
rather than one. An implementer who anchored the attribute edit map to the
authored text would mis-project on exactly the file that matters most.

Stage 0 composes the fixtures rather than testing them apart: a same-line
diagnostic after an attributed import and after an attributed re-export, over
ASCII and non-BMP text; and one fixture with a length-changing inline handler
plus attributed imports and re-exports **both before and after it**, asserting
module-instance semantics, the exact rewritten specifiers, and original authored
spans for a downstream Rolldown diagnostic. Two further composed fixtures cover
the collision and importer-identity hazards: identical `./dep.ts` spellings with
identical maps imported from **different directories** must stay distinct
modules; and an attributed JS/TS module must resolve its own child, its governing
`package.json`, and a cycle from the real path — and the rewrite applies to
synthetic-id loads identically, so an **attributed import inside an attributed
module** is fixtured too — while persisted graph identity
still collapses to one member per real file.

**Scope: instance identity is execution-only.** Persisted graph identity
continues to hash `(label, authored bytes)` per real path
(`index.mjs:8204-8209`) — one file, one graph member, regardless of how many
instances evaluation creates. The pair-keyed ledger governs *instantiation*; the
graph ledger governs *identity*. Stage 0 fixtures both facts on the same input
so the distinction is proven rather than assumed, and the compatibility report
records instance count alongside graph membership.

Stage 0 fixtures the same path imported with: identical maps, distinct maps,
one present and one absent, and mixed `with`/`assert` spellings — asserted by
**JSON object identity and JavaScript top-level side-effect count**, not merely
by "it bundled." Tightening admission later is a separate, versioned change with
its own code, span, envelope, and rollout — not a side effect of a toolchain
swap.

**Synthetic ids.** Rolldown injects a synthetic runtime module
(`RUNTIME_MODULE_ID`, `"\0rolldown/runtime.js"`), so `\0`-prefixed virtual ids
are an input-set class the deployment-identity work must disposition
explicitly.

The plugin must explicitly test Rolldown's static and dynamic resolution hooks.
A generic `resolveId` callback is not assumed to intercept every computed or
dynamic edge until the adversarial corpus proves it — and the same skepticism
extends to the load/transform side, where built-in CJS interop must be proven
not to engage before the plugin's refusal.

### Toolchain custody

Production parser and bundler versions are exact and coherent in the released
codegen closure. The repository lock, published manifest, cold-install receipt,
and diagnostic/toolchain projection must agree. Prefer alignment with the
Rolldown version selected by the paved Vite release when it satisfies the
closed-graph contract; reproducibility wins over deduplication if they conflict.

"Exact" must reach the helpers, not stop at the named tools. Rolldown 1.2.1
declares `@rolldown/pluginutils: ^1.0.0` and `oxc-parser@0.142.0` declares
`@oxc-project/types: ^0.142.0` while Rolldown pins the same package `=0.142.0`.
A later public install can therefore resolve a changed helper, or a second copy
of `@oxc-project/types`, without any named top-level version moving — silently
invalidating both the measured size closure and the executed one. So every
shipped helper contributing to either closure carries an effective exact pin;
both clean-install trees are asserted to contain exactly one permitted version
and one copy of each; helper versions and integrity hashes appear in the
receipts; and the standing re-run rule covers **helper** version changes, not
only Rolldown, Oxc, and TypeScript.

Native optional packages introduce supply-chain and platform facts. The
publication proof records the selected Oxc and Rolldown binding package,
version, integrity, platform tuple, compressed size, and unpacked size, and
proves that foreign-platform bindings are omitted. The exact rule is
`LLP 0041#nine-package-candidate-promotion--2026-07-28`: each host retains
**exactly one empty** opposite-platform optional edge at the CLI path while the
opposite runtime is absent everywhere else — absent bytes and a retained empty
edge are different facts, and the proof asserts both.

**The canonical projection, so "projected digest" is a gate rather than an
escape hatch.** Every cross-tuple and dual-run comparison runs through a
**versioned, fail-closed** projection defined per domain. It enumerates exactly
which fields may be removed or rewritten — host root paths substituted by a
declared token, absolute temporary directories, wall-clock timestamps, and
process ids, and nothing else — and it **rejects unknown fields** rather than
dropping them, so an upstream addition fails the comparison instead of vanishing
from it. Codes, spans, envelope and custody fields, graph members, identity
inputs, and artifact bytes are compared raw. A mutation test proves that
changing any load-bearing field changes its digest; a projection that can
normalize away a difference is not a gate.

**Two distinct invariants, not one.**
`LLP 0041#nine-package-candidate-promotion--2026-07-28` requires "exactly one
empty npm-tree entry at the CLI's opposite, platform-filtered optional-runtime
edge" — that rule is about *Snapback's own two CLI runtime packages* and is
unaffected by this migration; it must keep passing unchanged.
Rolldown and Oxc are third-party packages that each declare many platform
bindings (GNU and musl variants among them), so their invariant is different
and must be stated separately: name the expected host binding per supported
tuple, pin the Linux libc (glibc), and enumerate which foreign edges are
permitted to appear as omitted or empty. Conflating the two would either
weaken the CLI rule or fail the third-party tree for no reason.

Because two native implementations exist, **cross-tuple semantic equality is
its own proof.** Stage 4 runs the identical frozen corpus on both tuples and
compares canonically projected digests of parser projections, diagnostics, graph
identities, evaluated values, and generated artifacts. Installing and
generating successfully on each host is not evidence that the two native
builds agree.

## Migration stages

Every gate below names an executable command and a machine-readable manifest.
A gate whose evidence is "the tests pass" is not a gate: LLP 0010 requires the
canonical proof to be an explicit inventory rather than a sample, and requires
that no required suite disappear through an automatic skip
(`LLP 0010#ci-and-review-gates`). Each stage's manifest records the exact case
IDs, case count, corpus digest, tool versions and option manifests, and a
zero-unapproved-skips assertion, and is registered in the canonical local
proof.

### Stage 0 — freeze the census, corpus, and baselines

1. Generate a machine-readable **toolchain authority ledger**: source file,
   imported package and API, role class, owning contract, intended
   disposition, disposition owner, permitted exception, and proof command.
   Generate it with a binary-safe parser walk plus the recognizer set in
   §Current first-party inventory — not a text grep — and CI-check it so a new
   first-party parser/bundler/transform authority fails the build. Extend the
   existing `scripts/check-toolchain-authority.mjs`, which already CI-asserts
   exact tool versions, rather than adding a parallel script; the ledger check
   is the same discipline. The checker ships self-tests containing a
   NUL-bearing file, a generated-source template import, a
   constant-foldable dynamic module URL, and a `node:module` transform call.
2. Freeze valid and invalid definition-graph fixtures covering JavaScript,
   TypeScript (`.ts/.mts/.cts`), JSON, re-exports, cycles, package scopes,
   symlinks, malformed UTF-8, static/dynamic imports, CommonJS
   (`require` and `require.resolve` separately), builtins, query/hash
   specifiers, outside-root traversal, **`import.meta` in every spelling**,
   **every top-level-await spelling at definition-module top level — bare
   statement, declarator initializer, condition position, and `for await` — plus
   `await import()` separately** (measured: `for await` at module top level is
   also a hard `UNSUPPORTED_FEATURE` under `format: 'iife'` at Rolldown 1.2.1), a user
   `tsconfig.json` present in the resolution root, a user Vite config and
   plugin present, URL/protocol specifiers, virtual and `\0`-prefixed ids, and
   source-span reporting over ASCII, BMP, non-BMP, combining-mark, tab, LF, and
   CRLF inputs, and **exact-file-only resolution**: `./helper`, `./dir`,
   `./dir/`, and package-like specifiers as *invalid* fixtures beside their
   explicit-extension valid twins, with stable diagnostics and identity
   asserted on both sides. **Valid**-side additions: JSON import attributes in both the
   `with` and legacy `assert` spellings, each admitted top-level-`await`
   spelling — bare statement, declarator initializer, condition position, and
   `for await` — under the chosen non-fatal category, and both
   Snapback-package allowlist entries
   plus an absolute-local import. **Invalid**-side addition: a redeclaration
   case (`let a; let a;`), which Acorn rejects today as
   `BUNDLE_HANDLER_PARSE_FAILED` (`index.mjs:5098-5108`) and which the pinned
   `showSemanticErrors: true` must keep refusing — its retained baseline is a
   refusal with a pinned code, span, envelope, and precedence, not an
   admission.
3. Retain current codegen results for every first-party backend fixture: graph
   members and digests, canonical evaluated schema/functions/routes values,
   generated artifacts, the raw `args.with` map esbuild delivers per import
   spelling (the frozen oracle for the attribute-normalization function),
   inline-handler canonical ASTs, helper content hashes,
   v1/v2 implementation hashes, marker tokens, and the full diagnostic
   envelopes including public/local custody. Do not retain transient bundle
   bytes as the semantic oracle.
4. Measure cold and warm generation time, peak RSS, package download bytes,
   apparent unpacked bytes, and allocated filesystem bytes on both public
   runtime tuples, under the same stated basis as §Baseline size facts.
   Measure the headless template and React/Vite template separately. Commit
   the raw receipt with **per-package rows**, not only the aggregate
   Rolldown/parser totals, including every package version and integrity hash,
   so registry drift is auditable per component.

Gate: `node scripts/run-0140-corpus.mjs --stage 0` emits the **aggregate**
Stage-0 receipt `llp/receipts/0140-stage0.json` (named into the *stage* series,
not the S1–S6 *state* series — no tooling may treat an `s*` prefix as the state
family) — binding the authority-ledger
digest, the fixture-manifest digest with its exact case map and case count, a
zero-unapproved-skips assertion, the retained current-codegen oracle outputs,
the raw performance baselines, and the per-package size receipt digest — and
`--verify stage0` revalidates it. **This single file is what S1's entry condition,
`--verify s1`, and the S5 lineage mean by "the Stage 0 receipt"**; a wildcard
over `llp/receipts/0140-*` is not a fact a later verifier can reopen. The same
command asserts the fixture-manifest-to-acceptance-matrix mapping, so the rule
that a matrix row without a case ID fails Stage 0 has a named enforcer. Within
it, `node scripts/check-toolchain-authority.mjs --ledger` reports an empty
unexplained set, its self-tests pass, and the ledger is committed at
`llp/receipts/0140-toolchain-authority.json`; the fixture manifest, its digest,
and the retained baseline receipts are committed under `llp/receipts/0140-*`;
`node scripts/measure-toolchain-size.mjs` reproduces §Baseline size facts cell
for cell, with per-package versions and integrity hashes.

### Stage 1 — Oxc parser convergence

0. **Record decision D-1** before any code moves, and under D-1a freeze the
   TypeScript-oracle transcript first.
1. Add the parser adapter with the pinned call matrix, offset-unit contract,
   and the structural-category manifest, and run Oxc beside the current
   scanners in tests.
2. Port each of the six enumerated Acorn responsibilities, then the syntax-only
   TypeScript unsupported-source scanner, requiring the same accepted/refused
   corpus, stable codes, spans, and full diagnostic envelopes — including the
   behaviors that are currently implicit: issue deduplication and ordering,
   conservative parse-failure fallbacks, first-error-only TypeScript reporting,
   and the masked textual fallback in protected-query scanning. Each gets a
   named fixture.
3. Port `scripts/check-contract-meta.mjs`, which is genuinely syntax-only. It
   walks a recovered TypeScript tree today without consulting parse diagnostics
   (`:15`, `:44`), so Stage 1 states its recovered-AST/error policy explicitly
   and fixtures malformed sources: either the recovered-tree tolerance is
   preserved, or tightening it is recorded as an intentional, separately
   accepted behavior change rather than a side effect.
   Retain TypeScript in `scripts/check-package-export-types.mjs` as a declared
   type-semantic exception.
4. Under **D-1a**, implement and prove the binding resolver, then declare the
   inline-handler identity migration and its rollout rule. Under **D-1b**,
   leave `inline-handlers.mjs` on TypeScript and record it as a retained
   dependency of the shipped closure.
5. Switch the production scans to Oxc and delete the codegen import of and
   dependency on Acorn. Delete the codegen TypeScript dependency only under
   D-1a. Root/application TypeScript remains wherever type checking or
   declaration compilation uses it.

Gate: `bun run --filter '@expo/snapback-codegen' test` and
`node scripts/run-0140-corpus.mjs --stage 1` pass with zero unapproved skips
and a corpus digest matching Stage 0; the emitted manifest at
`llp/receipts/0140-stage1.json` shows no diagnostic, envelope, span, or
admission regression in either direction; no fatal-class parse yields a
program; inline-handler identity is byte-identical (D-1b) or matches the
declared migration (D-1a); the full generated-artifact proof passes before
Stage 2 starts.

**Stage 1 is a repository-only landing.** Switching production scans to Oxc
puts a *native* binding in the codegen closure, while the first two-tuple
binding/install/semantic proof does not appear until Stage 4 S1. So Stage 1 is
**unconditionally repository-only**. It may land; it may not
publish and it may not back served capability until the release machine's
two-tuple closure gate passes. An "independent Stage-1 release" is deliberately
not offered as an alternative, because offering it would require a second full
release gate — command, receipt path and schema, two-host lineage, guard
validation, bidirectional fixture — duplicating the one the release machine
already owns. The freeze predicate in §Rollback and failure policy covers this
case directly — a codegen closure declaring a **native parser** binding is
frozen whether or not the definition bundler is yet Rolldown — which is why the
guard and both its fixtures must land **before or atomically with this very
landing**, not with the Stage-2 switch, and why the Stage-1 gate binds that
result.

### Stage 2 — definition bundling on Rolldown

1. Put the current esbuild call behind a narrow internal definition-bundler
   contract, then implement the Rolldown twin against the pinned option
   manifest.
2. In test-only dual-run mode, compare admitted graph identity, canonical
   evaluated values, generated artifacts, and full normalized diagnostics
   (code, span, envelope, custody) across the frozen corpus and every
   repository backend fixture. Assert exactly one JavaScript chunk and no
   assets or maps per graph, and that no built-in resolution or load path is
   reachable.
3. Exercise the resulting IIFEs inside the real permission-denied evaluator
   subprocess, not only in the parent Node process, and re-assert NUL-safe
   length framing, strict evaluated-value refusals, caller
   `NODE_OPTIONS`/preload isolation, and Wasm/string-code denial
   (`LLP 0010#generated-artifacts`).
4. Re-derive the top-level-await and dynamic-import refusals from Rolldown's
   own signals; fixture the `require` versus `require.resolve` mapping.
5. Switch production codegen to Rolldown and commit the before/after
   compatibility report — old and new tool versions, complete option manifests,
   corpus digest, comparison digests, diagnostic dispositions, platform, and
   timing/size measurements. **Do not remove esbuild or the dual
   implementation yet**: it is the only restorable rollback point, and the
   two-tuple semantic proof does not run until Stage 4. Removal happens after
   that proof passes, and the Plan records the exact source, package, and lock
   revision the rollback would restore.

Gate: `node scripts/run-0140-corpus.mjs --stage 2 --dual` passes and emits
`llp/receipts/0140-stage2-compat.json`; the complete graph and evaluated values
are equal for valid fixtures; invalid fixtures preserve stable refusal classes,
envelopes, and useful original-source spans; every semantic difference has an
explicit disposition in the compatibility report rather than a golden-file
refresh. **Permitted disposition classes are bounded**: a difference may be
dispositioned only as **(a) presentation-only rendered text** or **(b)
performance** — nothing else.

Class (a) is prose a human reads: specifically the diagnostic's `message`
member, which `LLP 0010#diagnostic-shape` lists in the shape but which this Plan
treats as presentation, since parser substitution necessarily rewrites upstream
prose embedded in messages like `BUNDLE_HANDLER_PARSE_FAILED`
(`index.mjs:5098-5108`, `:7855`). **That waiver is bounded**: a replacement
message must remain non-empty, concise and length-bounded, semantically
consistent with its stable code and remediation, and — for any message in public
custody — sanitized under the public projection, carrying no private path, span,
dependency path, executable source, or secret
(`LLP 0108#identity-artifacts-and-public-custody`). The compatibility report
retains both old and new text, and a **negative public-custody fixture** proves a
leaking message fails rather than being dispositioned.
Everything else is contractual and cannot be waived by a compatibility-report
note — stable codes, source spans, public/local envelope fields, issue
**ordering and precedence**, first-error behavior, deduplication, admission,
identity, and the capability boundary. Changing any of those is a failed gate,
or, if genuinely intended, a separately reviewed and versioned diagnostic
migration with its own rollout.

### Stage 3 — converge the remaining first-party bundling surfaces

1. Move Cloudflare deployment-input discovery and the Miniflare harness to
   Rolldown. Preserve app aliasing, seed override behavior, JSON handling,
   Worker format, and the exact deployment-identity fixed-point exclusion.
   Derive identity from the **Snapback-owned resolve/load ledger**, not from
   rendered chunk names or output formatting, and cross-check it against
   Rolldown's `moduleParsed` hook and `this.getModuleIds()` — comparing module-id
   **sets**, not orders (measured: `moduleParsed` order and `chunk.moduleIds`
   order differ), so an ordering flake cannot masquerade as identity drift — a **plugin-context**
   iterator, not a `RolldownBuild` method (measured: `bundle.getModuleIds` does
   not exist at 1.2.1) — or the output chunk's `moduleIds`, in which
   `\0rolldown/runtime.js` does appear once CJS interop engages. Run this as an **early
   spike**, before the rest of Stage 3: compare the ledger against the current
   esbuild `metafile.inputs` set over JSON, aliases, cycles, package manifests,
   parsed-but-eliminated modules, and `\0rolldown/runtime.js`, and pin the
   resulting inclusion/exclusion algorithm and fixed-point rule. Preserve the
   `LLP 0049#deployment-identity-freshness-gate-2026-07-25` self-output
   exclusion.
2. Move client browser-closure tests to a controlled Rolldown or Vite browser
   build, and move the public cold-install browser proof onto the checked-in
   Vite 8 starter path.
3. Migrate the maintained Competitive Checkpoint and Signal Desk esbuild
   surfaces, or record a frozen-evidence exemption with an owner and reason.
4. Remove the root direct esbuild dependency when no retained first-party
   source imports it. Regenerate the Bun lock mechanically.
5. Audit maintained application surfaces for the paved Vite 8 line. Upgrade an
   older Vite surface only when it remains maintained and its receipts can be
   regenerated honestly; do not edit frozen bakeoff work directories or
   historical locks merely for cosmetic convergence.

Gate: `node scripts/run-0140-corpus.mjs --stage 3` orchestrates
`bun run cf:accept`, `node targets/cloudflare/scripts/generate-deployment-identity.mjs`
plus the drift check, `bun run --filter '@expo/snapback-client' test`, the React
starter build, the Expo package proof, and the active-demo tests, and emits
`llp/receipts/0140-stage3.json` with exact case IDs and counts, the corpus
digest, tool and option manifests, and a zero-unapproved-skips assertion — the
same custody every other stage gets. The receipt must map the identity
sensitivity leg, the browser and package proofs, every maintained-demo
disposition, and all Vite dev-state cases to case IDs. The deployment identity
is unchanged for unchanged sources, or a reviewed one-time rotation enumerates
its cause — **and the sensitivity leg proves the converse**: one fixture
changing a handler input must change the identity, so an identity that never
changes cannot pass by never moving.

### Stage 4 — public-package and documentation closure

1. Pack the **complete nine-package vector** LLP 0041 requires — one clean
   source SHA produces all nine tarballs
   (`LLP 0041#nine-package-candidate-promotion--2026-07-28`), not only the
   migration-affected subset — and inspect each package's declared and resolved
   dependencies, platform omissions, licenses, integrity, download bytes, and
   unpacked bytes. "Inspect licenses" is not a criterion; Stage 4 states an
   allow/deny list and fails on a license outside it.
2. **(S1) Pre-removal evidence, local only.** Run staged cold installs on both
   supported tuples — `snapback new <name> --template todo-contract`, `snapback new <name> --template react`,
   generation, dev, browser build, and doctor all repository-free — and the
   **cross-tuple semantic equality** proof over the frozen corpus, comparing
   canonically projected digests of parser projections, diagnostics, graph identities,
   evaluated values, and generated artifacts. Nothing is published in S1.
3. **(S2) Remove and re-qualify.** Remove esbuild and the dual-run seam, then
   rebuild the **complete nine-package vector from the post-removal clean
   SHA**, **re-run the whole of step 1 — pack *and* inspection, including the
   license allow/deny check and the third-party binding-omission proof —
   against those final tarballs**, because removing esbuild and the seam
   changes exactly the dependency, license, native-binding, and size surfaces
   step 1 examines, so the earlier inspection no longer describes what ships;
   the S2 receipt binds that inspection result, the license-policy version, the
   resolved dependency and native-binding inventory, and the size rows (and
   therefore the S5/S6 lineage) — unaffected packages may come out byte-identical, but their
   provenance is the new SHA, because LLP 0041 requires one clean source SHA to
   produce all nine and a mixed-SHA vector is not a vector it accepts — and re-run the whole of step 2 against the **final**
   tarballs on both tuples. Removing the seam changes the closure, so the S1
   evidence no longer describes what ships; a passing execution must not
   qualify one package and publish another.
4. **(S3) Hand off to LLP 0041.** Enter
   `LLP 0041#nine-package-candidate-promotion--2026-07-28` with exactly the
   nine tarballs S2 qualified — **the whole vector, not the frozen subset**. Note
that LLP 0041's nine-package section still lists the pre-migration
`@ccheever/*` public identities while this Plan uses the terminal
`@expo/snapback-*` names; the *protocol* is what this Plan defers to, and the
Stage-4 documentation audit reconciles that section's stale inventory.
   The freeze predicate and the publication vector are different sets and must
   not be conflated: the predicate says which packages this migration *blocks*
   before S3, while LLP 0041's protocol requires all nine to be built from one
   clean SHA, published together, and bound into publication authority. A
   subset release would need LLP 0041 to define a subset protocol preserving its
   vector, rollback, and lease invariants first; this Plan does not assume one.
   Let LLP 0041's protocol run in its own order: this Plan contributes one
   precondition — the valid, fact-matching S2 receipt — and asserts nothing
   about the internal sequencing. S2 precedes S3 because an
   immutable candidate published from a pre-removal closure could never be
   replaced under the same version.
5. **(S4) Prove the published closure.** Re-download every exact registry
   version, prove tarball digest equality against the locally qualified
   tarballs, run clean public installs on both tuples, and re-run the
   cross-tuple semantic corpus against the **published** closure.
6. **(S5) Run S4 and emit its terminal receipt** — the S5 producer executes the
   public-registry verification of step 5 and binds its evidence (schema in
   §Rollback and failure policy).
   This is where *this Plan* stops objecting to default-tag promotion; it
   authorizes nothing on its own.
7. **(S6) Emit the eligibility receipt** once LLP 0041's post-promotion ledger
   and both final `latest` cold receipts pass. The closure is then **eligible**
   for an LLP 0111 capability carrier. Serving requires that separate,
   independently qualified LLP 0111 receipt — this Plan does not produce it.
8. **Documentation: read-only audit.** Every governing LLP and Guide amendment
   lands in the *same commit* as the stage change that makes its text
   historical, and therefore **inside the immutable candidate checkout, before
   S2 package construction** — including the already-known LLP 0010
   "relative/file only" correction, which moves ahead of candidate construction
   rather than trailing it. This is not only repository policy (doc updates
   land with the code they describe); it is a receipt-integrity requirement:
   the S5 and S6 receipts bind the candidate source SHA, so a documentation edit
   *after* S5 would invalidate the receipt it just authorized, and re-emitting
   would not help because the published immutable tarballs stay bound to the
   earlier SHA. Stage 4's pass here is therefore **read-only audit**: a missed
   edit requires a new source SHA, a new immutable package version where
   applicable, and a qualification restart from S1 — not a quiet amendment. The
   affected set is census-driven, not a fixed list: LLP 0009/0010/0030/0041/0044/0049/0108/0111/0117/0118
   are known, and LLP 0004's fail-closed codegen contract, LLP 0040's
   esbuild-based deployment-identity description, and LLP 0091's Cloudflare
   amendment are known omissions from earlier drafts. LLP 0118's
   "today" text is also stale in a specific way the reconciliation must fix: it
   names `@snapback/codegen/*` where the shipped allowlist is
   `@expo/snapback-codegen/*` (`index.mjs:345-348`). The governing conclusion
   this Plan draws from 0118 is unaffected; the corroborating text is not
   exact. Includes the LLP 0010
   "relative/file only" sentence flagged in §Governing constraints.
9. Update the authoring and diagnostics Guide pages if parser/bundler wording,
   diagnostics, installation remediation, or supported syntax changes.
10. Run `./ref-check --verbose`, `node scripts/check-guide.mjs`, package tests,
   Cloudflare local acceptance, and `scripts/verify-local-proof`.

Gate: `node scripts/run-0140-corpus.mjs --stage 4 --state s5` (the
`--post-removal` spelling used in earlier drafts is retired, not an alias) emits
`llp/receipts/0140-s5.json` covering both tuples with zero unapproved
skips, and the terminal package closure contains no direct Acorn or esbuild
dependency owned by Snapback codegen; every retained TypeScript use is
classified as type checking, a declared type-semantic exception, or the D-1b
retention, and appears in the committed authority ledger; all other retained
occurrences are classified third-party, frozen evidence, or an explicit
documented exception.

## Compatibility and acceptance matrix

The migration is accepted only with evidence for all of the following. Each row
is realized as one or more case IDs in the stage manifests named above; the
manifests, not this prose, carry the receipts, and a row with no case ID in any
manifest fails the Stage-0 gate.

- valid JavaScript and TypeScript definitions produce the same canonical
  evaluated values and generated artifacts;
- static helper imports, re-exports, cycles, and JSON modules preserve their
  admitted semantics;
- dynamic import, CommonJS loaders/modules (`require` and `require.resolve`
  separately), builtins, ambiguous bare imports, query/hash specifiers,
  unsupported extensions, `.cjs`/`.cts`, URL/protocol specifiers, virtual ids,
  and root escapes fail closed;
- **JSON import attributes remain admitted** in both the `with` and legacy
  `assert` spellings, matching current behavior;
- **every refusal class implemented in both the Oxc scan and the Rolldown
  plugin has a fixture asserting both fire on the same input**, so the two
  detectors cannot drift apart between Stage 1 and Stage 2;
- **`import.meta` fails closed in every spelling**, at both scan time and
  bundle time, with a stable code and an authored span — and the fixture
  proving it is new, because none exists today;
- **bare top-level await and `await import()` retain their current refusals**
  with codes re-derived from Rolldown signals rather than from esbuild error
  text. Top-level `await` inside a *handler* — currently parseable under
  Acorn's `allowAwaitOutsideFunction` — **stays admitted** in all four measured
  spellings under the non-fatal `top-level-await-in-script` category; a new
  authored refusal for any of them fails the gate;
- **no admission drift in either direction over the declared input sources**:
  the differential Acorn-versus-pinned-Oxc sweep reports zero inputs that Acorn
  rejects and Oxc admits, **and zero that Acorn accepts and the adapter
  refuses** outside the declared `showSemanticErrors` classes — and a class may
  be declared **only** if it is proven to be refused by the *current end-to-end
  pipeline* with equivalent diagnostic custody, so the declaration cannot become
  a discovered-during-execution waiver; any class currently admitted end to end,
  and any unmatched new class, fails this Plan unless handled as a separately
  reviewed and versioned admission change — across the frozen corpus, Acorn's
  negative test cases at the locked 8.17.0 tag, the Test262 negative
  syntax/early-error set, **the TypeScript 5.9.3 parser-error baselines** (whose
  selection policy, source hash, case count, and coverage of every
  TypeScript-reaching consumer mode the Stage-0 and Stage-1 receipts record), and
  the versioned generator plus committed fuzz seeds; the receipt records each
  source and its hash, and the residual
  nonclaim in §Snapback-owned parser projection stands — this is bounded
  differential evidence, not proved grammar equivalence;
- **mixed-error precedence** is fixtured: a handler containing more than one of
  `import`/`export`/`with`/parse-error produces the same code, span, and
  ordering as today;
- module-format `package.json` files remain graph and identity inputs, with the
  nearest-package lookup stopping at `node_modules`;
- schema, functions, and routes remain separate graphs with separate fresh
  evaluations;
- invalid UTF-8, missing files, symlink swaps, and outside-root identities
  retain stable diagnostics;
- all AST-backed ambient-capability and dynamic-code probes retain coverage for
  direct, computed, aliased, destructured, parenthesized, and reflective
  spellings;
- JavaScript and TypeScript diagnostics point to the original authored file,
  line, and column rather than a facade or transformed offset, **and the span
  contract holds over non-BMP characters, combining marks, tabs, LF, and CRLF**
  under the declared offset unit;
- the **full diagnostic envelope and public/local custody** survive, not only
  the code and span
  (`LLP 0010#dated-acceptance-profile-inline-handlers-and-results-2026-07-27`,
  `LLP 0108#diagnostics`; `LLP 0010#diagnostic-shape` alone does not establish
  custody);
- **inline-handler and asset-intent identity** — canonical AST encoding, marker
  tokens, helper content hashes, v1/v2 `implementationHash`, and
  `snapback.asset-intent-implementation.v1` — is byte-identical, or rotates only
  under a declared versioned migration whose rollout rule is expressed in the
  shipped whole-artifact/function-reference model
  (`LLP 0108#b-no-new-expected-operation-or-compatibility-protocol-in-v1`,
  LLP 0064) and names every producer, consumer, persisted reference, and
  rollback path;
- the evaluator still denies filesystem, child/worker, addon, inspector,
  process, network, dynamic code, time, locale, and randomness capabilities,
  and NUL-safe length framing, strict evaluated-value refusals,
  `NODE_OPTIONS`/preload isolation, and Wasm/string-code denial still hold;
- generated artifact freshness changes for every real graph/value change and
  stays stable for a semantically irrelevant bundler wrapper difference —
  proven metamorphically, per identity domain: **graph** identity hashes raw
  authored source bytes (`index.mjs:8204-8209`), so an authored comment change
  *does* move it and must; what a comment must not move is the **canonical
  evaluated value** or the artifacts derived from it. A harmless *bundler
  wrapper* difference — output the graph never authored — moves neither. Any
  admitted source byte, module-format manifest, or canonical evaluated value
  change moves the identity that owns it; a single helper change
  affects only its reachable operations;
- **the Vite dev states survive**: successful regeneration and load, failed
  generation preserving the previous complete artifact set, stale-state
  marking, generated-but-not-loaded, and offline-push warnings
  (`LLP 0030#codegen-and-hot-push`, `LLP 0041#acceptance` for the state set;
  `LLP 0010#dated-acceptance-profile-inline-handlers-and-results-2026-07-27`
  and `LLP 0108#identity-artifacts-and-public-custody` for the
  previous-artifact-set preservation those two do not state);
- Cloudflare deployment identities retain the same input set when source and
  configuration are unchanged, with synthetic/virtual ids explicitly
  dispositioned, or carry a reviewed one-time identity rotation whose cause is
  enumerated;
- Vite browser and Expo/Metro package proofs still reject Node-builtin leakage;
- Apple-silicon macOS and x86-64 glibc Linux select only their matching
  Oxc/Rolldown native packages under the separately stated third-party binding
  rule, Snapback's own CLI optional-runtime edge still satisfies
  `LLP 0041#nine-package-candidate-promotion--2026-07-28` unchanged, and both
  hosts complete clean-host generation;
- size, **both dimensions conditioned on D-1**, measured against the resolved
  headless and React install closures rather than the component table: under
  **D-1a**, neither download nor unpacked size regresses and unpacked size
  improves; under **D-1b**, the criterion is the per-shape expected delta derived from the
  Stage-0 lock and dependency-tree receipts for that shape, not the isolated
  component-set delta: a React/Vite tree may already carry Rolldown, Oxc, or
  TypeScript and deduplicate them, so its resolved delta can differ in
  magnitude or even in sign while every package manifest is correct. §Baseline
  size facts is an isolated decomposition and an input to that derivation, not
  an oracle for either shape; the Plan does not predeclare the sign of a
  resolved-closure delta before that shape's before/after graph establishes it — with Charlie's explicit acceptance of the derived per-shape expected deltas,
  whatever their sign, recorded here before Stage 4;
- median and p95 generation latency do not regress by more than 15% on the
  frozen corpus without an explicit, evidence-backed disposition. An absolute
  sub-100-ms difference may be recorded as noise rather than blocking the
  migration. The measurement states host specification, warmup, sample count,
  percentile method, and concurrency; when the 15% and 100-ms rules disagree,
  the absolute rule wins only below 100 ms. Peak RSS from Stage 0.4 is recorded
  evidence, not a gate, unless a measured regression prompts Charlie to make it
  one;
- **the two supported tuples produce equal normalized digests** for parser
  projections, diagnostics, graph identities, evaluated values, and generated
  artifacts over the frozen corpus; and
- **the publication state machine is enforced mechanically**: with a
  Rolldown-default or native-parser codegen closure, the guard's per-permission
  clauses hold: frozen-package publication requires a matching S2 receipt,
  `latest`/promotion-begin requires a valid S5 receipt, and a served-capability
  reference requires a valid **S6** receipt **and** a valid LLP 0111 carrier
  receipt — S6 eligibility alone never authorizes serving, and a valid S5 never
  does. Fixtures prove both directions of each clause, including the
  Stage-1-only refusal and the valid-S5-absent-S6 pair;
- **a version change re-runs the evidence**: any Rolldown, Oxc, TypeScript,
  **Acorn** (while it remains in any restorable closure — it is the differential
  sweep's reference at the locked 8.17.0, and Stage 3.4 regenerates the lock),
  or **any effective-exact parser/bundler helper or selected native-binding
  version *or integrity* movement** — a helper or binding can move without any
  named top-level tool version moving, which is precisely the supply-chain
  hazard §Toolchain custody identifies — after Stage 4 re-runs the frozen corpus, the differential
  sweep, and the cross-tuple digests before the lock lands, because every
  measured behavior in this Plan is version-tagged; and
- every stage manifest reports zero unapproved skips and its corpus digest
  matches the Stage-0 frozen digest.

## Rollback and failure policy

The test-only dual-run implementation is a migration instrument, not a shipped
fallback. If Rolldown or Oxc fails a gate, keep the old production tool for that
stage, record the exact incompatibility here, and either pin a fixed upstream
release or commission the smallest compatibility design. Do not ship runtime
auto-selection between esbuild and Rolldown: two consumers could then produce
different artifacts from identical sources based on incidental dependency
availability.

A completed earlier stage may **land** independently — repository-only;
publication and served capability remain gated by the release machine in every
case. In particular, Oxc parser convergence may land even if the Rolldown
bundler gate exposes a blocker; it may not publish on that basis. The
Plan is not complete until every direct first-party esbuild surface has a
migrated or explicit retained disposition and the public closure gates pass.

**The rollback point is explicit and survives past the switch.** Stage 2
switches production to Rolldown but retains the esbuild implementation and the
dual-run harness through Stage 4's S1 pre-removal evidence; S2 is where they
go, and every later state proves the closure that actually ships. Until then
the rollback is a revert of a named source, package, and lock revision recorded
in `llp/receipts/0140-stage2-compat.json` — not a reconstruction. Stage 2's
landing state is **repository-default but unreleasable**, and each permission
carries its own precondition rather than one blanket prohibition:
non-default-tag candidate publication requires a valid S2 receipt and entry at
S3; default-tag promotion requires S5; package-closure eligibility requires S6;
and serving requires S6 **plus** the separate LLP 0111 carrier receipt.

**That window needs an executable guard, not a sentence** — and the guard must
be keyed to the state machine rather than to a single "terminal proof exists"
boolean. An earlier draft phrased it as "no publication until the post-removal
receipt exists" and deadlocked: LLP 0041 requires publishing immutable exact
candidate versions under a **non-default dist-tag** *before* registry
re-download and clean public installs can happen at all
(`LLP 0041#nine-package-candidate-promotion--2026-07-28`), so a receipt that
depends on the public proof can never precede the publication that produces it.

The design resolves this by separating **local** post-removal qualification from
the **public** proof: S2 removes esbuild and qualifies the final tarballs
locally; candidate publication is permitted once a valid, fact-matching S2
receipt exists (S3); the public closure is proven at S4; promotion waits for S5;
eligibility waits for S6; and serving additionally waits for an LLP 0111
carrier receipt. Each permission has its own precondition, so every transition
is reachable.

The window is therefore six explicit states, each with its own permission:

This table is the **single authoritative transition rule**; Stage 4's numbered
steps are its narration, and where the two could be read apart, this table wins.

| State | Entry condition (all required) | Receipt | Permits |
| --- | --- | --- | --- |
| **S1 pre-removal compatibility** | valid Stage 0, 1, 2, and 3 receipts **and** both-tuple repository-free cold installs plus cross-tuple projected-digest equality against the *pre-removal staged* closure | `llp/receipts/0140-s1.json` | repository default; **no publication of any freeze-predicate package** |
| **S2 post-removal local qualification** | valid S1 receipt; dual implementation and esbuild removed; repacked; both-tuple cold installs and cross-tuple equality re-pass against the **final** tarballs | `llp/receipts/0140-s2.json`, binding source SHA, lock digest, option manifests, seam absence, final tarball and integrity digests, and both platform receipts | nothing published yet |
| **S3 candidate publication** | valid S2 receipt whose bound facts match the current checkout | — | entering **LLP 0041's publication state machine** with its complete nine-package vector |
| **S4 published-closure verification** | LLP 0041's own publication sequence completed through its candidate ledger | — | re-running this Plan's cross-tuple semantic corpus against the **published** closure |
| **S5 promotion-authorized** | S4 executed by the S5 producer and passed | `llp/receipts/0140-s5.json` — S4's terminal receipt: binds S4's public-registry platform receipts, case map, zero-skip result, per-domain projected digests, cross-tuple equality, plus S2 and the LLP 0041 candidate-ledger digest | this Plan stops objecting to LLP 0041 default-tag promotion |
| **S6 eligible** | LLP 0041's post-promotion ledger and both final `latest` cold receipts pass | `llp/receipts/0140-s6.json` — binds the S5 digest, the post-promotion ledger, and both final `latest` receipt digests | the package closure becomes **eligible** for an LLP 0111 capability carrier — it does **not** authorize serving |

**Every one of this Plan's receipts has a named producer and verifier.**
`node scripts/run-0140-corpus.mjs --stage 4 --state <s1|s2|s5|s6>` emits the
corresponding `llp/receipts/0140-<state>.json`, and `--verify <state>`
revalidates it plus every predecessor in the lineage: S1 requires valid Stage
0–3 receipts, S2 requires S1, **S5 is S4's terminal receipt**: its producer *executes* S4, and it binds — and
`--verify s5` reopens and revalidates — S4's two public-registry platform
receipts, S4's exact case map and zero-unapproved-skip result, the per-domain
projected output digests, and the cross-tuple equality result, in addition to
S2 and the LLP 0041 candidate-ledger digest. S2's own platform receipts and the
candidate ledger are **not** sufficient: LLP 0041's candidate ledger precedes
its public cold installs, so neither establishes the published-closure semantic
run that S5 claims to authorize. S6 requires S5 plus LLP 0041's post-promotion ledger and both final
`latest` receipt digests. A **valid, fact-matching S6 receipt is an explicit
prerequisite** for calling Stage 4 complete and for moving this Plan to
`Implemented` — without it, every other named gate command can pass while the
post-promotion lineage that grants eligibility is simply absent.

**This Plan does not restate LLP 0041's publication machine, and earlier drafts
were wrong to try.** Three consecutive review rounds found chronology
inversions in that restatement — a candidate ledger required before the step
that creates it, a post-promotion ledger bound into a receipt already emitted,
a freeze that forbade the promotion needed to lift it. The cause was structural,
not clerical: LLP 0041 owns an intricate ordered protocol whose components are — as an
**unordered inventory**, since the order is LLP 0041's to state and any second
telling of it drifts — immutable candidate publication, registry re-download and
digest equality, both-platform clean installs, the prior-vector preflight that
binds the resulting candidate-ledger digest, tag mutation, the post-promotion
ledger, and the final `latest` receipts.

So S3–S6 state only what **this migration adds**: which packages are frozen,
which of this Plan's receipts must exist and match, and when this Plan stops
objecting. The ordering *inside* LLP 0041's machine is LLP 0041's, and where
this table and LLP 0041 could be read apart, **LLP 0041 wins on sequencing** and
this table wins only on the additional preconditions it names.

**S6 does not authorize serving.** LLP 0041 treats the post-promotion package
lineage as an *input* to the LLP 0111 capability carrier, and LLP 0111
independently requires hidden served qualification, image/source/package
binding, capability-publication CAS, and a post-CAS public observation with
revocation on failure. Passing every row in this Plan would leave all of that
unproven, so S6 grants eligibility and nothing more; the served-capability guard
requires a valid **LLP 0111** receipt, which this Plan neither produces nor
claims to.

**A brand-new package name establishes `latest` on first publish, and the Plan
must not pretend otherwise.** LLP 0041 records this explicitly and requires the
observed version to be treated as an already-promoted member of the prior vector
rather than an unrecorded side effect
(`LLP 0041#nine-package-candidate-promotion--2026-07-28`); npm's registry
metadata gives every package a `latest` tag. So S3 does not assert "no `latest`
moves" — it asserts that any automatically established `latest` is detected by
the prior-vector preflight, recorded as `alreadyAtNewVersion`, and quarantined
without served authority until S6. A terminal-generation name that has never
been published is the case this handles; ignoring it would either deadlock the
first publication or tolerate an unacknowledged `latest` mutation.

Every receipt is schema-validated; a missing or schema-invalid receipt is
treated as absent. The guard is installed and **both** its bidirectional fixtures passing —
including the Stage-1-only case — **before or atomically with the first commit
that satisfies the freeze predicate**, which is normally the Stage-1 landing,
not the Stage-2 production switch. The freeze begins when a migration-introduced
native binding enters the closure, so a Stage-2 deadline would leave the
Stage-1-only window protected by prose. The Stage-1 gate and receipt bind the
guard-and-fixture result. A guard that arrives after the state it protects is
not a guard.

The guard is a check inside `scripts/check-toolchain-authority.mjs --ledger`,
wired into the publication and staged-promotion proofs. Its authority is the
proof-mediated path: a raw `npm publish` outside the harness bypasses any
script, and for that exposure the Plan inherits LLP 0041's posture rather than
claiming a stronger one. Its mechanical predicate is three **file facts**, not inferences, in the
codegen package manifest and tree: (a) the declared definition-bundler
dependency, (b) the presence of the dual-run seam module, and (c) **a declared
migration-introduced native parser or bundler binding** (`oxc-parser`,
`rolldown`, or their bindings). Fact (c) is what makes the freeze bind from the
Stage-1 landing onward, when the bundler is still esbuild and no seam exists —
without it the guard has nothing to fire on in the Stage-1-only window, which is
exactly the window Stage 1 says is repository-only. **Its failure conditions are derived per permission from the state table above,
not stated independently of it** — the round-10 defect was exactly that the two
had drifted apart:

| Attempted action | Requires | Therefore refused when |
| --- | --- | --- |
| publishing a **freeze-predicate** package | being in S3: a valid S2 receipt whose bound facts match the current checkout | no S2 receipt exists — which mechanically covers the Stage-1-only window, since no S2 receipt can exist there — or its facts do not match |
| `latest` move / **beginning** promotion | a valid `llp/receipts/0140-s5.json` **with all bound facts matching** per §Rollback's receipt-binding paragraph — not the corpus digest alone | that receipt is absent, schema-invalid, or any bound fact mismatches |
| **served capability** reference | a valid `llp/receipts/0140-s6.json` (eligibility) **and** a valid LLP 0111 carrier receipt | either is absent — S6 eligibility alone never authorizes serving, and a valid S5 receipt never does |

Splitting S5 and S6 into two receipts is what makes the chronology possible:
LLP 0041 constructs the post-promotion ledger only *after* the tag mutations and
both final `latest` proofs, so a single receipt emitted at S5 could never
contain it. The guard's fixtures assert both directions of each row, including
the two the round-10 reviews found missing: **valid S5, absent S6, served
reference → refused**; and **valid S5, absent S6, promotion begin →
permitted**.

**The freeze predicate, stated once and referenced everywhere else.** The
freeze **begins** at the first landing that puts a migration-introduced native
binding or the Rolldown default into the codegen closure — a manifest fact, so a
same-day revert lifts it and a stale freeze cannot persist — and **ends** at S3
for entering LLP 0041's candidate machine, at S5 for beginning default-tag
promotion, and at S6 (plus an LLP 0111 carrier receipt) for serving. It is not scoped to a state window, because the earliest hazard
precedes S1. A package is frozen if and only if its resolved dependency closure contains
`@expo/snapback-codegen`, **or** it declares a native parser or bundler binding
introduced by this migration. The S2 receipt enumerates the resulting package
list as data once S2 exists; before that the guard derives it from the same
manifest facts, so there is no window in which the enforcement source is
missing. The guard's fixture reads that list rather than re-deriving it from
prose, and includes the **Stage-1-only case**: an Oxc-native closure with
esbuild still the bundler and no seam present must be refused. **This Plan adds no objection** for packages **outside** the predicate —
`@expo/snapback-client`, for instance, is one of the nine but depends only on
`@expo/snapback-contract`. That is *not* a grant of publication authority:
LLP 0041's nine-package machine still governs, and it does not today define a
standalone single-package release, so a non-predicate package publishing alone
would need LLP 0041 amended with a reviewed subset protocol preserving its
vector, lease, and rollback invariants. The guard's both-directions fixture
asserts only what the guard decides — a predicate package is refused by *this*
guard, a non-predicate package is not refused by *this* guard — and must not be
read as authorizing the publication LLP 0041 separately governs. Non-default-tag candidate publication in S3 is
explicitly permitted. The acceptance matrix carries a row for the guard, and a
fixture proves it fires in both directions.

**The S5 and S6 receipts are bound to the closure they authorize, not merely to a
corpus digest.** A receipt that matched only the frozen corpus digest could
authorize a *later, changed* closure — weaker than LLP 0041's source/tarball
ledger binding. `llp/receipts/0140-s5.json` therefore records, and the guard
compares, all of: the clean source SHA; the candidate-ledger digest; the package
and version vector; every final tarball and integrity digest; the Bun lock
digest; both S2 platform-receipt digests and, separately, S4's two public-registry
platform-receipt digests; the codegen, Rolldown, Oxc, and
TypeScript versions with their complete option manifests; the frozen corpus
digest; the seam-absence fact; **and the digests and case maps of the Stage 0,
Stage 1, Stage 2, and Stage 3 receipts**, so the Cloudflare deployment identity,
browser-closure, maintained-demo, and Vite dev-state contracts are part of the
authorization lineage rather than parallel to it. The guard reopens and
validates that lineage rather than trusting a single terminal digest. Promotion compares the receipt's
candidate-ledger digest against the ledger actually being promoted. The binding is to the **immutable candidate checkout** — the clean source SHA
the tarballs were built from — not to the repository's current HEAD, which
necessarily advances when the receipt itself, LLP 0140's status, or the terminal
documentation lands. The guard compares the candidate checkout's facts under a
closed source projection that **excludes** `llp/receipts/**` and this
Plan's own file (`llp/0140-vite-rolldown-oxc-convergence.plan.md`), and nothing
else. Excluding the whole file rather than only its status line is deliberate:
this document is the execution tracker, so it is the one most likely to be
edited mid-flight, and a tracker note between S2 and S6 must not force a
qualification restart. It is safe because the Plan is not an input to any
package: no tarball, lock, or generated artifact reads it; a receipt-or-status-only commit is therefore
explicitly permitted and does not invalidate authorization. Any change to
source inside that projection, or to lock, options, tool or helper versions, or
package bytes, **invalidates** the receipt mechanically — the standing re-run rule below states what to do, and
this states that the old receipt stops authorizing anything in the meantime.

## Open questions

1. **D-1 — ANSWERED 2026-08-02:** D-1b; retain the TypeScript checker in the
   shipped codegen closure while Oxc replaces syntax-only scanners. The
   migration remains parked until the implementation wave clears. Source:
   `issues/20260802-author-decision-packet.md`.
2. Which exact Vite/Rolldown/Oxc version set satisfies both the closed-graph
   contract and useful deduplication with the React starter at execution time?
   After D-1, does the deduplication argument for the React shape still hold?
3. Does Rolldown expose graph metadata sufficient to cross-check the
   Snapback-owned resolve/load ledger for Cloudflare deployment identity, and
   how are parsed-but-eliminated modules, JSON, aliases, package manifests, and
   `\0`-prefixed synthetic ids each dispositioned? The Stage-3 spike answers
   this before the rest of Stage 3 proceeds.
4. Are there scanner-specific exceptions to the `showSemanticErrors: true` pin
   — a scanner whose current behavior needs the default — and what is the
   complete Snapback structural-category manifest for that scanner? The pin
   itself and the fatal-unmatched invariant are decided; only per-scanner
   exceptions and the category list remain.
5. Can Rolldown's built-in CJS interop and default-on `checks` be configured so
   no built-in path engages before the Snapback plugin's refusal?
6. Which old Vite 6/7 demo surfaces are maintained product evidence versus
   frozen historical evidence? Stage 0 must classify them before any upgrade.
7. After first-party convergence, can any duplicated transform/parser native
   binding be shared with Ibex's Rust-side Oxc/Rolldown toolchain without
   weakening the standalone npm or native-runtime boundaries? This is a
   measured follow-up, not permission to couple codegen to the vendored Ibex
   checkout.

Questions earlier drafts carried are now **answered empirically** and moved into
the design sections rather than left open: `oxc-parser` reports UTF-16 code-unit
offsets at the N-API boundary; `require.resolve('./x')` does not reach
`resolveId` at all (no `require-resolve` kind exists), which is why the
authored-span authority is the parser's import-edge ledger; and bare top-level
await under `format: 'iife'` is a hard `UNSUPPORTED_FEATURE` build error at
Rolldown 1.2.1, so that refusal survives the swap.

One custody note the size table depends on: Rolldown 1.2.1 pins
`@oxc-project/types` at `=0.142.0` while `oxc-parser` accepts `^0.142.0`. The
single-copy pricing in the candidate totals holds only while those stay
coherent, which §Toolchain custody's "exact and coherent" rule already requires
— stated here so a future dedup regression is a known risk, not a surprise.

## Completion criteria

This Plan moves to **Implemented** when Stages 0–4 and the complete acceptance
matrix pass, decision D-1 is recorded and executed, governing LLP/Guide
descriptions match the as-built system, the terminal post-removal package closure is
proven on both supported tuples, and the committed authority ledger shows no
unexplained first-party migration-owned parser, bundler, or transform
authority (retained `node:vm`/`Function` evaluation authority is classified,
not absent). A migration blocked on an
upstream incompatibility remains Draft with the failed gate and retained
authority named; ecosystem preference alone is not evidence that the security
or artifact contracts survived.
