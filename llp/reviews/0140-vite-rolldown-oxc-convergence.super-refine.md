# LLP 0140 super-refine journal

## Authorization

Charlie Cheever invoked `/llp-super-refine` on LLP 0140 on 2026-08-01, the day
the Plan was drafted. The target was uncommitted in the working tree at v0.1.

The READY bar is the program's standing bar:

> "We've really thought this issue and concept through as much as we can
> without writing code and running it to gather empirical evidence" — as much
> as "there are no flaws in this."

LLP 0140 is a **Plan**, so reviewers were told the direction (converge on
Vite/Rolldown/Oxc) is a settled author decision and out of scope. The in-scope
questions are census completeness, constraint correctness and citation
fidelity, sequencing, whether the gates are real gates, rollback coherence,
whether anything load-bearing is assumed-true about Rolldown/Oxc, and whether
executing the Plan exactly as written would leave a governing contract silently
broken.

## Runtime deviation, recorded

The skill pins orchestration to Claude Fable 5 Max. This loop was orchestrated
from **Claude Opus 5**. The invariants that carry the loop's meaning are
intact: each round used a fresh Claude Fable 5 reviewer and a fresh OpenAI
`gpt-5.6-sol` Codex CLI reviewer at `ultra` effort, neither of which was the
orchestrating/editing session, and the orchestrator belongs to neither reviewer
family — so reviewer independence is stronger, not weaker, than the pinned
configuration. Recorded here rather than passed over. This matches the
precedent set in the LLP 0129 journal.

## Mechanics

Per round: one fresh reviewer per family, mutually blind, both given the same
SHA-pinned revision and the same SHA-pinned instruction capsule. Reviewers were
barred from `llp/reviews/` entirely and from any path containing
`super-refine`, so no verdict is contaminated by another reviewer's findings;
the document's own `**Revised:**` header is allowed. Reviewer sessions are never
resumed. Between rounds the orchestrator verifies decisive claims against the
tree before acting on them, then revises. Reviews are recorded verbatim with
provenance; verification and disposition notes sit outside the verbatim body.

## Concurrency, recorded honestly

This is the shared primary worktree, edited live by other fleet sessions.
During round 1 another session was concurrently running a super-refine loop on
LLP 0141 in the same checkout (`codex exec` on
`llp/0141-embeddable-rust-library.rfc.md`). No LLP 0140 file was touched by
that work, and both round-1 reviewers pinned their reading to the hash-matched
target.

## Round 1 — 2026-08-01

Instruction capsule SHA-256:
`caf069d01f9859847b8def8b93cc5c8bb89cbb94c54a5be8deb8ec8c11a4487c`

Target SHA-256 (v0.1, working tree, uncommitted on top of `5d5c6b71`):
`cf707efa41fc1cc44b60f3c9f2efc18779d7979d474ffd850cfdb8d6054fc324`

### Round 1 results

**Both families NOT READY.** The two reviews were independently written and
converge on the same primary defect.

**Convergent BLOCKING — the census misses the TypeScript type checker.**
Both families found that `packages/snapback-codegen/inline-handlers.mjs` — an
883-line production admission surface imported by `index.mjs:79` — constructs a
real `ts.Program`/`TypeChecker` (`:494-515`) and uses
`checker.getSymbolAtLocation` (`:139`) inside the reflective-access detector.
That is a *type-semantic* service `oxc-parser` does not provide, and the file
was absent from v0.1's inventory table while Stage 1.4 directed implementers to
"delete the codegen imports and dependencies on Acorn and TypeScript."

Fable additionally established the *mechanism* of the miss: the file contains a
literal NUL byte, so ripgrep/grep classify it as binary and skip it — meaning
Stage 0.1's mandated "machine-readable inventory" would have re-missed it.
Codex additionally found a second omitted surface,
`scripts/check-package-export-types.mjs` (`:77`, `:210-234`), and established
that the encoding at `inline-handlers.mjs:449-457` serializes TypeScript
numeric `SyntaxKind` values into the string hashed as the helper content hash,
which flows to the v1/v2 `implementationHash` — so an Oxc rewrite rotates
artifact identity unless it reproduces the TypeScript encoding exactly.

The orchestrator had independently verified this defect against the tree before
either review returned, and re-verified every cited line afterward.

**Fable-only BLOCKING — `import.meta` dropped from the fail-closed contract.**
`LLP 0010#generated-artifacts` (`llp/0010:373-375`) lists `import.meta` among
the constructs that fail closed. v0.1's constraint 1 reproduced that list minus
`import.meta`; the plugin requirements, Stage 0 fixtures, and acceptance matrix
all omitted it. The current enforcement is one line —
`logOverride: { 'empty-import-meta': 'error' }` (`index.mjs:7747`) — with no
fixture behind it, and Rolldown substitutes `{}` for `import.meta` in non-ESM
output behind a default-on *warning*. Executing v0.1 as written could therefore
ship a silent fail-open that no gate would catch. Confirmed by the orchestrator
at all three sites.

**Codex-only BLOCKING — unsafe Rolldown defaults and vacuous gates.** Rolldown
defaults `tsconfig: true` (ambient config discovery), `output.polyfillRequire:
true`, and `output.codeSplitting: true`; a plugin hook returning `null`
delegates to built-in resolution. Separately, v0.1's gates named no command,
manifest, case count, or corpus digest, which conflicts with
`LLP 0010#ci-and-review-gates` requiring the canonical proof to be an explicit
inventory rather than a sample.

**Material items:** handler-scan parse mode (Acorn's relaxed script mode has no
`oxc-parser` equivalent, and v0.1's "no partial-success program" rule
foreclosed the only implementations that preserve
`BUNDLE_UNSUPPORTED_IMPORT/EXPORT/WITH`); the esbuild-error-text sniff at
`index.mjs:7852-7854` and top-level await; Oxc option traps
(`preserveParens: true` by default would let `(eval)(...)` evade the
dynamic-code detector) and the missing offset-unit contract; and an unstated
size-measurement basis.

### Verification outcome

Every decisive repository claim in both reviews checked out. The orchestrator
confirmed: the `Program`/`TypeChecker` construction and `SyntaxKind`-derived
content hash; the runtime `acorn`/`esbuild`/`typescript` dependencies in
`packages/snapback-codegen/package.json:83-85`; the `import.meta` line in
LLP 0010 and its single-line enforcement; the relaxed Acorn options and their
code comment; the type-checker use in `check-package-export-types.mjs`; and
that a binary-safe sweep returns exactly the inventory's eight surfaces plus
the two omitted ones. All ten cited LLP anchors resolve.

The size tables were re-measured independently from `registry.npmjs.org`
(tarball byte length and `dist.unpackedSize`, per package, with integrity
hashes). v0.1's sixteen figures reproduce exactly, but omit Rolldown's two hard
dependencies, and — decisively — the favorable delta assumes TypeScript leaves
the codegen closure, which the census defect makes an open decision rather than
a fact.

### Round 1 dispositions (v0.2)

All findings were accepted; none were refuted. Applied:

1. Inventory rows added for `inline-handlers.mjs` (with the type-semantic
   operation named) and `scripts/check-package-export-types.mjs`; the six Acorn
   responsibilities enumerated separately; Stage 0.1 required to be
   binary-safe, with the NUL-byte mechanism recorded.
2. `import.meta` restored to constraint 1, added to the plugin requirements,
   the Stage 0 fixture list, and the acceptance matrix, with the Rolldown
   warning-escalation and scan-time refusal both named.
3. New constraint 5 makes inline-handler identity a governing domain and
   forbids silent rotation, citing LLP 0108. LLP 0108 added to `Related`.
4. New **§Decisions / D-1** names the two dispositions for the inline-handler
   symbol service and schedules the choice at the start of Stage 1. The Plan
   deliberately does not pick it — see "Author decision" below.
5. §Baseline size facts rewritten: measurement basis stated, Rolldown's two
   hard dependencies included, and the result split into a D-1a table
   (-630,946 / -14,323,200 bytes on macOS) and a D-1b table (**+3,746,522 /
   +9,301,866**). v0.1 stated only the favorable half.
6. Pinned Rolldown option manifest as a table (`tsconfig: false`,
   `codeSplitting: false`, `polyfillRequire: false`, `minify: false`,
   `sourcemap: false`, `legalComments: none`, `platform: neutral`, empty
   `external`, debug output off), plus an explicit no-`null`-fallthrough rule,
   a per-class warning policy, the separate schema/functions/routes graphs, the
   transformed-functions entry overlay, `absWorkingDir` parity, the
   `.cjs`/`.cts` and nearest-package rules, the `require.resolve` mapping
   question, and the `\0`-prefixed synthetic-runtime-module disposition.
7. Pinned Oxc parser options (`preserveParens: false`, `range: true`, `astType`,
   `showSemanticErrors`, no `unambiguous`/`commonjs` source types), the
   offset-unit contract with a Unicode/line-ending corpus, the handler-scan
   dual-parse-or-scoped-recovery policy as the sole exception to
   no-partial-success, and a TypeScript feature/transform matrix requirement.
8. Every stage gate bound to a named command and a machine-readable manifest
   with case IDs, corpus digest, tool versions, and a zero-unapproved-skips
   assertion, registered in the canonical proof. Acceptance matrix extended
   with rows for `import.meta`, top-level await, inline-handler identity, full
   diagnostic-envelope custody, the Vite stale-output states, the exact
   optional-native tree shape, Unicode span fidelity, metamorphic identity, and
   the zero-skip receipt.
9. Recorded the governing-text conflict between `LLP 0010`'s "relative/file
   edges only" and the as-built absolute-local + two-entry allowlist, and
   scheduled its resolution in Stage 4.

`./ref-check --verbose` passes (143 docs, 3482 refs, 0 errors).

## Round 2 — 2026-08-01

Instruction capsule SHA-256:
`61ba1e85fc07385b511979a4e9110e4940a1ed26cb1c22005e621e5fbf87dde5`

Target SHA-256 (v0.2):
`a54731feca22f1804d4a9e325de80c5fdc6a4a581778ae97ea75e8427105e04a`

The round-2 capsule adds a round-context section telling reviewers the document
is v0.2, that a prior round occurred, that they have not seen it and must not
seek it out or assume it was correct, and that the newly added material should
be checked as hard as the rest. No round-1 finding is disclosed.

### Round 2 results

**Both families NOT READY.** The capsule's instruction to check newly added
text hardest paid off: the most serious finding of the round is in material
v0.2 *added*.

**Fable BLOCKING — the v0.2 handler-scan parse-mode policy was factually
wrong.** The Fable reviewer installed `oxc-parser@0.142.0` and probed it. v0.2
asserted "script mode errors on `import`/`export`, module mode errors on
`with`" and mandated a choice between dual-parse and scoped error recovery,
calling that "the sole exception to the no-partial-success rule." Measured
behavior: script mode returns **0 errors** with the `ImportDeclaration`
present; module mode returns **0 errors** with the `WithStatement` present;
both error only under `showSemanticErrors: true`, and even then the full AST is
returned. The orchestrator re-ran every probe independently and confirmed all
of it, plus three facts v0.2 never named: top-level `await` in script mode
*does* error (the real relaxation gap, since Acorn's
`allowAwaitOutsideFunction` has no oxc equivalent); `let a; let a;` is
**admitted** by oxc's default while Acorn rejects it today (a silent widening
in the opposite direction); and HTML comments error in module mode but not
script mode. The whole normative section was built on a premise the tool does
not have — and the corrected design is *simpler*, not harder: a single script
parse yields all three `BUNDLE_UNSUPPORTED_*` diagnostics from ordinary AST
nodes.

**Codex BLOCKING — import attributes were a silent admission tightening.**
v0.2 placed import attributes in the invalid corpus and the fail-closed matrix.
Probed: esbuild 0.28.1 bundles `import v from "./a.json" with { type: "json" }`
successfully and reports `args.with = {"type":"json"}` to `onResolve`, which
`index.mjs:7783` ignores — so the construct is **admitted today**. In a
migration the Summary calls semantics-preserving, that was a compatibility
break introduced by the revision itself. Confirmed by orchestrator probe.

**Convergent BLOCKING (both) — the gate commands and the size row.** v0.2's
"every gate names an executable command" header was not honored: Stage 3 named
`cloudflare:accept` (the script is `cf:accept`, `package.json:22`), Stage 0
carried a literal `scripts/<census>.mjs` placeholder, and Stage 2 named
neither. Separately, both families caught that the acceptance matrix's
"do not regress **download** size" clause is unconditional while the Plan's own
D-1b table projects download regressions of +3.7 MB (macOS) and +4.3 MB
(Linux) — a row a D-1b execution cannot pass.

**Codex MATERIAL:** the pinned Rolldown manifest was not actually pinned
(missing `transform.target`, which defaults to `esnext` against a required
ES2022; deprecated `legalComments` spelling; no input/`cwd`/plugin-order/loader
/`checks`/`onLog`/lifecycle rows); `resolveId` carries no authored import-site
position and a probe showed `require.resolve` never reaches it at all; D-1a's
"scope-tree construction" understates the existing service and D-1b's "zero
admission risk" was too broad; the census-tool spec cannot see imports inside
generated templates or constant-foldable dynamic module URLs; the LLP 0041
optional-native rule is CLI-scoped and was overextended to third-party
bindings; Stage 2 removed the rollback before the Stage-4 proof; cross-tuple
semantic equality was never proven; Cloudflare identity lacked LLP 0049; four
governing anchors were mis-attributed; and Stage 2's "explicit disposition"
escape had no bounded class list.

**Fable MATERIAL:** the census still missed
`packages/snapback-contract/exact-package.mjs`, which runs `node:module`'s
`stripTypeScriptTypes` in transform mode over Exact's checkout sources and
ships in the published contract package — a builtin-hosted transform authority
that v0.2's package-walk census spec is structurally blind to. Also: three
Linux size cells wrong; the offset-unit fact stated backwards; the ripgrep
"silently skip" mechanism described wrong (it truncates at the NUL, losing
lines 626–883); and no syntax-target row.

### Verification outcome, including one refutation

The orchestrator re-ran every decisive probe rather than accepting either
review. All of Fable's C1/C5 parser facts, C2, C3, C4, C6 and C7 confirmed; all
of Codex's blocking items and its anchor corrections confirmed against
`llp/0041:420-430`, `llp/0041:955-957`, `llp/0010:819-836`, and
`packages/snapback-codegen/file-read-capability.mjs:100`.

**One reviewer claim was refuted.** Codex concern 2 asserted the Linux
candidate unpacked *total* should be `23,712,597` and the deltas
`-12,032,734` / `+11,592,332`. An independent registry measurement gives
`824,984 + 19,280,461 + 44,577 + 25,693 = 20,175,715`: the defect was in the
**row** (v0.2 printed 20,175,809), and the total and both delta columns were
already correct. Codex detected the internal inconsistency but repaired the
wrong side of it; Fable, which had measured the packages, got it right. v0.3
corrects the row and leaves totals and deltas untouched. The two Linux download
cells nobody's total caught (±300, cancelling) are also corrected.

### Round 2 dispositions (v0.3)

Every finding was applied except the refuted arithmetic. Notable changes:

1. §Handler-scan parse mode rewritten from the measured error-class table, with
   a single-parse design, the two *real* gaps named (script-mode TLA;
   `showSemanticErrors` moving admission in both directions), and the
   no-partial-success rule restated as a fatal/mapped/advisory disposition rule
   rather than a blanket prohibition.
2. Import attributes moved from the invalid corpus to the **valid** corpus in
   both `with` and legacy `assert` spellings, with the probe recorded and any
   future tightening declared a separate versioned change.
3. Real gate commands throughout (`cf:accept`,
   `scripts/check-toolchain-authority.mjs --ledger`,
   `scripts/run-0140-corpus.mjs`, `scripts/measure-toolchain-size.mjs`) and
   named receipt paths under `llp/receipts/0140-*`.
4. The size acceptance row conditioned on D-1 in **both** dimensions and
   measured against resolved install closures rather than the component table.
5. Three Linux cells corrected; the priced binding set, the
   `@rolldown/pluginutils` version, and the glibc-not-musl scope stated.
6. `exact-package.mjs` census row added as a declared exception with an owner;
   the census recognizer set widened to builtin-hosted transform APIs,
   generated-source templates, constant-foldable dynamic module URLs, spawned
   CLIs, and package scripts, with checker self-tests.
7. Offsets restated as measured UTF-16 code units; the NUL mechanism restated
   as truncate-at-offset; UTF-8 validation located at ingestion.
8. Rolldown manifest completed (`transform.target: es2022`, `comments.legal`,
   input/`cwd`/plugin order/loaders/`checks`/`onLog`/banner/alias, normalized-
   option assertion, `bundle.close()`, one-chunk assertion) plus an
   unknown-warning-escalates policy, and the authored-span authority reassigned
   to the parser's import-edge ledger.
9. D-1a given a frozen TypeScript-oracle transcript with an enumerated case
   list; D-1b's risk claim narrowed; the concrete per-step branch differences
   stated.
10. LLP 0049 added to `Related` and to the governing constraints; the Cloudflare
    ledger spike moved ahead of the rest of Stage 3 and given a sensitivity leg.
11. Four anchors re-attributed; the CLI optional-runtime rule separated from the
    third-party binding rule; cross-tuple semantic equality added as its own
    proof; dual-implementation removal deferred past it with a named rollback
    revision; Stage 2 disposition classes bounded.

`./ref-check --verbose` passes.

## Round 3 — 2026-08-01

Instruction capsule SHA-256:
`52cdfa6671ee1f14edde4f49e4899913b2a4c7a0f504233b95c130295da1fc4c`

Target SHA-256 (v0.3):
`6da4672cb6827bf32e6545f09c8ebab64a39d1d56c47c8927bd2e01e72e61629`

The round-3 capsule additionally tells reviewers that two of the document's
claims are stated as *measured* tool facts and should be checked by running the
tools, not by reading typings — the failure mode round 2 exposed.

### Round 3 results

**Both families NOT READY**, both having installed and run the pinned tools.
The blockers are narrower than round 2's and mostly surgical.

**Convergent — `comments.legal: 'none'` is an invalid value.** Both families
independently probed it: `CommentsOptions.legal` is `boolean` at Rolldown 1.2.1,
and passing `'none'` is a hard `InvalidArg`. The v0.3 row would have failed its
own assertion gate. Both also found that "experimental/debug output disabled"
is not a pin — the default `attachDebugInfo` emits `//#region <module-id>`
markers carrying checkout-relative paths into the definition IIFE. Orchestrator
probe reproduced both.

**Convergent — the NUL narrative was wrong.** v0.3 claimed the
`createProgram`/`getTypeChecker` evidence at line 515 sat *after* a NUL the same
paragraph located at line 625. Both families caught the ordering contradiction;
Fable additionally measured the real behavior, which is not truncation:
recursive sweeps omit the file entirely and silently, while explicit-file
invocations reach post-NUL content but lose line attribution for every match.

**Codex BLOCKING — the identity-rollout gate rested on machinery LLP 0108
removed.** v0.3 required a D-1a rotation rollout "across predecessor/successor
tuples." `llp/0108:701-709` (§B, under the round-3 normative reconciliation at
`:656`) explicitly removes `ExpectedOperationV1`, compatibility notices,
predecessor execution windows, and tuple carriage; what remains is
whole-artifact/function-reference compatibility under LLP 0064 and 0090–0095.
Confirmed. Codex also found a second identity carrier constraint 5 had never
named: `defineAssetUpload` authorizers run the same inline pipeline and hash
their canonical AST into `snapback.asset-intent-implementation.v1`
(`index.mjs:2384-2392`). Confirmed.

**Codex BLOCKING — the Oxc error-class gate is unimplementable.** `OxcError`
exposes severity, free-text message, labels, help, and codeframe — **no stable
code or class discriminant** — so v0.3's "disposition of every Oxc error class"
cannot be written. Also: v0.3's call matrix named `parseAsync`; the package
exports `parse` and `parseSync`. Confirmed by direct import.

**Fable BLOCKING — the widening direction is a class, not two cases.**
`showSemanticErrors: false` suppresses the entire ECMA-262 early-error family,
so the set of constructs Acorn rejects that Oxc would silently admit is
enumerable only from Acorn's side. A table of Oxc's *reported* classes
structurally cannot see it, and v0.3 fixtured two anecdotes.

**Codex BLOCKING — the gates do not prove the shipped package.** Removing the
dual implementation changes the closure *after* the two-tuple proof runs, so a
passing execution could prove one package and publish another.

**Material:** LLP 0041's optional-runtime quote lives under "Nine-package
candidate promotion", not `#runtime-distribution`; Stage 4's fixed
document list omitted LLP 0040's and LLP 0091's Cloudflare deployment-identity
text and LLP 0004's fail-closed contracts; the "or the migration must narrow the
resolver" clause contradicted the non-semantic scope; the ledger's declared
`node:vm` recognition made "empty unexplained set" ambiguous against the
production evaluator at `index.mjs:7612`; D-1 had no selection criterion; three
line citations drifted; and `build()` was called "experimental" without a source
(the disk-write default is real, the label is not).

### Verification outcome

All blocking and material items confirmed by orchestrator probe or file read.
No reviewer claim was refuted this round. Two extra facts were measured while
adjudicating and folded in: bare top-level await under `format: 'iife'` is a
hard `[UNSUPPORTED_FEATURE]` error at Rolldown 1.2.1 (closing v0.3's OQ6), and
`treeshake: false` is not statement preservation (an unused binding is still
eliminated), which matters only as a caution for reading the dual-run
comparison.

### Round 3 dispositions (v0.4)

1. Identity rollout rebuilt on the shipped whole-artifact/function-reference
   model with LLP 0108 §B cited correctly; the asset-intent carrier added to
   constraint 5 and the acceptance row.
2. `comments: { legal: false, annotation: false, jsdoc: false }` and
   `experimental.attachDebugInfo: 'none'` pinned, with a fixture asserting the
   absence of debug markers in emitted bytes; normalized-option assertion split
   into "assert the subset Rolldown exposes, behavior-test the rest," since
   `tsconfig`/`treeshake`/`transform`/`external`/`checks` are not visible at
   `buildStart`.
3. Error handling rewritten around **Snapback-owned structural categories**
   recognized from AST node presence and spans, never message text, with every
   unmatched parser error fatal; `parse`/`parseSync` corrected.
4. `showSemanticErrors: true` adopted as the Plan's position, with a
   **differential Acorn-versus-pinned-Oxc acceptance sweep** (frozen corpus plus
   a generated early-error input set, seeded shrinking fuzzing, committed
   minimized regressions) as the enumeration mechanism; the acceptance row
   generalized from one construct to zero-widening over the whole sweep.
5. Terminal post-removal proof added to Stage 4: repack after removal, then
   clean install, both templates, generation, browser build, doctor, and the
   semantic corpus on both tuples against the final closure. Stage 2's landing
   state renamed "repository-default but unreleasable."
6. NUL narrative rewritten to the two measured failure modes; census self-test
   required to exercise the recursive mode.
7. Ledger scope stated: migration-owned parser/bundler/transform authority,
   with `node:vm`/`Function` recognized but classified retained; completion
   criteria aligned.
8. Resolver narrowing clause deleted; both allowlist entries named and
   fixtured; the LLP 0041 quote re-anchored; Stage 4's document list made
   census-driven with 0004/0040/0091 named; LLP 0004/0040/0064/0091 added to
   `Related`; three line citations corrected; the `build()` rationale rested on
   the verified disk-write behavior only.
9. D-1 given a decision-artifact criterion (size acceptance, resolver owner and
   reviewer, rotation worth, fallback) and Codex's D-1b-first sequencing
   recorded as a suggestion, not a choice.

`./ref-check --verbose` passes.

## Round 4 — 2026-08-01

Instruction capsule SHA-256:
`980472bfb402eaf39e9c79e2a1ac4a0c68c5fe2fa7bcfec763095c02d26f5513`

Target SHA-256 (v0.4):
`154cf6b5f1031d7b0ab977ce4b9755e09f7ba55b7b0a2488969e3a683bd7ae26`

The round-4 capsule adds an anti-ratchet instruction: rounds have been
narrowing, and a false NOT READY is as much a failure as a false READY.

### Round 4 results

**Both families NOT READY**, both having installed and run the pinned tools, and
both explicitly recording that the rest of the document survived a maximum-effort
adversarial check. The findings are now narrow and mostly coherence-level, with
two genuinely new substantive ones.

**Convergent — the Stage-0 corpus contradicted the Plan's own pin.** v0.4 listed
`let a; let a;` as a **valid**-side fixture (a leftover from when the
`showSemanticErrors` value was undecided) while simultaneously committing
`showSemanticErrors: true`, stating that Acorn rejects the input today, and
requiring the acceptance matrix to treat it as a case Oxc must refuse. Stage 0
freezes the oracle every later gate reads, so a self-contradictory
classification is not harmless prose.

**Convergent — the "measured" statement-preservation caution was measured with
the wrong options.** Both families flagged it; Codex isolated the cause. v0.4
said `treeshake: false` still eliminates an unused binding and rewrites
`export const y = 2` to `exports.y = 2`. Under the **complete** pinned manifest
(with `minify: false`), Rolldown 1.2.1 retains the declaration and emits
`const y = 2; … exports.y = y`. The elimination appears only when `minify` is
omitted and Rolldown inherits a DCE-only default. Orchestrator probe reproduced
both cases; the conclusion (bundle bytes are not the oracle) is unaffected, but
the evidence was wrong.

**Convergent — D-1b's "only cost" claim.** Both families noted the selection
criterion called the size regression D-1b's only cost while the branch bullet
itself named a second. Fable added a third neither draft had: TypeScript's
numeric `SyntaxKind` values are not stable across releases and the canonical AST
encodes them, so under D-1b every future forced TypeScript upgrade is itself a
declared identity-migration event. D-1a pays that rotation once; D-1b defers it
indefinitely.

**Codex BLOCKING — handler top-level `await` had no satisfiable policy.** The
scanner admits it today (`allowAwaitOutsideFunction`, `index.mjs:5090-5096`);
Oxc script mode errors on it; v0.4's fatal-unmatched rule would therefore refuse
it; and the Stage-1 gate demands "no admission regression in either direction"
while the acceptance matrix permitted either outcome and two open questions left
the choice unresolved. A direct contradiction, not a gap.

**Codex MATERIAL — type-only edges are not runtime edges.** Probed at both
esbuild 0.28.1 and Rolldown 1.2.1: `import type { T } from "not-installed"`
bundles cleanly and the resolver is **never invoked** for that specifier; same
for `export type … from` and for a value import used only in a type position.
Only the runtime-value twin reaches the resolver and is refused. v0.4's single
"authoritative edge ledger carrying every specifier" would have over-admitted
and over-hashed. Confirmed by orchestrator probe.

**Fable BLOCKING — the unreleasable window was prose-only.** Every other safety
property in the Plan carries a named command; the Stage-2→Stage-4 publication
prohibition carried none, in a repository that demonstrably runs concurrent
sessions against a standing publication lane.

**Also material:** Stage 3 had no orchestrating command or receipt path despite
the Plan's universal gate discipline; "enumerated not sampled" overstated an
undefined finite sweep; Stage 1 and open question 4 still carried "error class"
leftovers the architecture section had already declared unimplementable; and
`scripts/check-package-export-types.mjs` also spawns the pinned `tsc` binary,
which its inventory row omitted.

### Verification outcome

All blocking and material items confirmed by orchestrator probe or file read; no
reviewer claim was refuted this round.

**One fact was found while adjudicating that neither review reported:**
`experimental` is a Rolldown **input** option. v0.4 placed
`experimental.attachDebugInfo: 'none'` in the output half of the manifest, where
1.2.1 rejects it as an invalid key — the row named the right option and would
not have worked. Both families verified the option's *effect* without catching
its placement.

### Round 4 dispositions (v0.5)

1. **Handler top-level `await` policy chosen**: admission is preserved via a
   named non-fatal structural category (`top-level-await-in-script`), recognized
   by an error span coinciding with a program-level `AwaitExpression` in the
   recovered AST. Deliberately *not* a switch to `sourceType: 'module'`, which
   would preserve one construct by breaking two (`await`-as-identifier, HTML
   comments). The definition-module bundle-time refusal is a separate surface
   and is unchanged.
2. **Two ledger layers**: an authored syntactic-specifier ledger (spans,
   diagnostics, `require.resolve` detection) and a projected runtime-edge ledger
   (admission, identity), with the projection of `import type`, `export type`,
   type queries, value-imports-used-as-types, and `import = require` specified,
   and Stage-0 fixtures pairing each form with its runtime-value twin.
3. Redeclaration fixture moved to the **invalid** corpus with its code, span,
   envelope, and precedence pinned.
4. Executable publication guard added inside
   `check-toolchain-authority.mjs --ledger`, wired into the publication and
   staged-promotion proofs, with its own acceptance row and a fixture proving
   the guard fires.
5. Stage 3 given an orchestrating command and `llp/receipts/0140-stage3.json`
   with the same custody as every other stage.
6. The enumeration claim weakened to bounded differential evidence over **named
   sources** (frozen corpus, Acorn's negative cases at the pinned version,
   Test262 negative syntax/early-error cases, a versioned deterministic
   generator plus committed fuzz seeds), with an explicit residual nonclaim.
7. Statement-preservation caution re-measured and corrected; `experimental`
   marked as an input option; `emptyImportMeta` escalation surface named
   (`checks` key plus `onLog` code, whose spellings differ).
8. D-1b's cost statement corrected to "principal quantified cost" plus version
   custody, maintenance, and the deferred TypeScript-`SyntaxKind` identity
   exposure; D-1b size tolerance restated as delta-against-delta.
9. `check-package-export-types.mjs` row extended to its `tsc` spawn; tsconfig
   parity evidence recorded; standing re-run-on-version-change rule added to the
   acceptance matrix; `require.resolve` named as the one refusal class whose
   second leg is the evaluator rather than a second static detector.

`./ref-check --verbose` passes.

## Round 5 — 2026-08-01

Instruction capsule SHA-256:
`a418ffa23bb3bc993a88ea639a326fff62d089c793506b9a335edb826a2c8d95`

Target SHA-256 (v0.5):
`6f9108ed90eb3e20a01fab465283ce9ec77384f1f939b02379973b4f7e60ee2f`

**Interruption, recorded.** The first round-5 launch was lost when the
orchestrating process exited mid-run; both reviewers were killed before
producing output and neither partial run is counted or recorded. Round 5 was
relaunched from scratch with fresh contexts against the identical SHA-pinned
target and capsule. No review is recorded by intent, and a killed attempt is not
a review.

### Round 5 results

**Both families NOT READY.** Both probed the pinned tools. The findings are
narrow and precisely located; Fable closed with "I expect a v0.6 addressing
exactly these items to be READY."

**Fable BLOCKING — the `top-level-await-in-script` recognizer was measurably
wrong.** v0.5 defined the category as "an error whose span coincides with a
program-level `AwaitExpression`." Measured against acorn 8.17.0 under the
production options and `oxc-parser@0.142.0`, Acorn admits `await` in *any*
top-level position, and only the bare-statement form recovers to a
program-level `AwaitExpression`: `const v = await f()` nests it in
`VariableDeclarator.init`, `if (await x)` in `IfStatement.test`, and
`for await (const x of y) {}` produces **no `AwaitExpression` node at all**.
Under the fatal-unmatched default, three of four admitted spellings would have
become fatal refusals — a silent admission *narrowing*, which a widening-only
sweep cannot catch. And even for the bare form, the error label span (0–5) is
not the node span (0–14), so span *equality* was the wrong predicate — a defect
that generalized to every category (the `import` error labels 0–6 against a
node of 0–18). Orchestrator probe reproduced the whole table.

**Fable BLOCKING — the `import.meta` escalation mechanism was inverted.** v0.5
put the escalation on `checks.emptyImportMeta` with `onLog` as belt-and-braces.
Measured: that option is boolean-only (`'error'` is a hard napi type failure),
`true` is already the default and yields a *warning*, `false` silences it — the
`checks` surface can never refuse. Only `onLog` can. Orchestrator probe
reproduced all three cases.

**Codex BLOCKING — the publication guard had no legal transition.**
`LLP 0041:392-412` requires publishing immutable exact candidate versions under
a **non-default dist-tag** before registry re-download and clean public installs
can happen; v0.5's Stage 4 required the public-registry proof before removal,
while the guard forbade any publication until the post-removal receipt existed.
A deadlock introduced by the round-4 fix.

**Codex MATERIAL — TypeScript reaches three Acorn consumers today.** Raw `.ts`
handler source hits stream inference (`index.mjs:4961`), static query-result
refusal (`:1446`), and protected-query analysis (`:1473`), each of which
currently *fails to parse* and silently takes a fallback (textual regex, no
findings, masked legacy scanner). Under a successful Oxc TypeScript parse the
same inputs take the real path, which can change inferred capabilities, static
refusals, and protected-query reachability. Codex also **falsified** a v0.5
claim: `showSemanticErrors: false` does not suppress the entire early-error
family — getter arity is reported with the option both off and on; it is a
subset. Orchestrator probe confirmed both.

**Also material:** exact-file-only resolution was unpinned (prose forbade
falling back to Rolldown's resolver but not a Snapback-owned resolver growing
extension/index/`main`/`exports` probing); the D-1b size oracle compared a
resolved-closure delta against an isolated component-set delta, which can differ
in sign when a React/Vite tree deduplicates; all documentation amendments were
deferred to Stage 4 while Stages 1–3 may land independently, contradicting
`AGENTS.md:128`; the acceptance matrix's top-level-`await` row still permitted
the alternative v0.5's policy had foreclosed (found by **both** families
independently); the metamorphic identity row said comments preserve identity
while `moduleGraphIdentity` (`index.mjs:8202-8207`) hashes raw authored bytes;
`attachDebugInfo` misplacement is warned-and-ignored rather than rejected, so it
fails *open*; `getModuleIds` is a plugin-context method, not a `RolldownBuild`
one; and two citations still needed narrowing.

**Codex C2 — D-1 is still unmade.** Not a defect this loop can close; it is the
author decision the Plan gates on. Recorded, not "fixed."

### Verification outcome

Every blocking and material item confirmed by orchestrator probe or file read;
no reviewer claim was refuted. The Codex run self-reported that one delegated
pass accidentally crossed the review-artifact blindness boundary; that pass was
discarded before its findings were received and the affected audit was rerun by
a clean reviewer. Recorded rather than passed over.

### Round 5 dispositions (v0.6)

1. TLA recognizer rewritten to label-span containment over an `await` token
   whose nearest enclosing function or class-field-initializer boundary is the
   Program, plus `ForOfStatement` with `await: true`; the measured four-row
   table is in the document; and the matching predicate is generalized to
   **every** structural category with a stated multi-error consumption rule.
2. `import.meta` escalation moved to `onLog`, with `checks.emptyImportMeta:
   true` pinned so the check cannot be disabled underneath it, and a Stage-2
   behavior test for whether an `onLog` fatal actually aborts `generate()`.
3. Publication guard replaced with a five-state machine (S1 pre-removal
   compatibility → S2 post-removal local qualification → S3 non-default-tag
   candidate publication → S4 registry verification → S5 terminal), reconciled
   with LLP 0041, with the guard's mechanical predicate named.
4. Per-consumer parse matrix added (seven consumers × admitted extensions,
   recording current parser, current parse-failure behavior, candidate
   behavior, permitted differences), with `.ts`/`.mts` fixtures for the three
   fallback consumers and a diagnostics-as-well-as-admission differential.
5. The early-error claim corrected to the measured subset, with the Stage-1
   receipt required to enumerate the observed new refusal classes.
6. Exact-file-only resolution pinned, with `./helper`, `./dir`, `./dir/`, and
   package-like specifiers as invalid fixtures beside explicit-extension twins.
7. Differential sweep now fails in **both** directions, referenced to acorn
   8.17.0 (what the scanner runs) rather than the 8.18.0 the size table prices.
8. Documentation amendments moved into their landing commits per `AGENTS.md`;
   Stage 4 is terminal reconciliation and audit.
9. Size oracle derived per install shape from Stage-0 lock/tree receipts, with
   the sign of a resolved delta no longer predeclared.
10. Metamorphic identity restated per domain; acceptance TLA row aligned to the
    chosen policy; `attachDebugInfo` described as warned-and-ignored;
    `getModuleIds` located on the plugin context; oxc-parser phrasing narrowed
    to parsing entry points; custody and artifact-preservation citations
    re-anchored, with an instruction to amend LLP 0041 if whole-Vite-state
    atomic preservation is meant to be normative there.
11. D-1 stated explicitly as the one item that must be answered before the
    document moves past Review.

`./ref-check --verbose` passes.

## Round 6 — 2026-08-01

Instruction capsule SHA-256:
`93f2d85bbe8e6f151a95d128c35410241895a02975d62ec95a37d34948544f26`

Target SHA-256 (v0.6):
`5681147344cc5f036fc7648f75e5887c06fea2d01b393744a586d2a508cc2f0c`

The round-6 capsule adds one scope note: D-1 is an explicit author decision the
document deliberately gates on, so reviewers should judge whether the Plan is
coherent and complete under **both** branches and names the decision honestly,
rather than scoring an unmade author decision as a blocking defect this loop
cannot close.

### Round 6 results

**Split: Fable READY, Codex NOT READY.** The first READY of the loop.

**Fable READY** with five MINOR concerns and five suggestions, all one-line
resolutions, and an explicit statement that it looked for the remaining defect
and found only those. Its re-measurement independently reproduced ~20 stated
tool behaviors, all 26 size cells and all 8 delta cells from the live registry,
~40 line citations, and every LLP anchor. One v0.6 measured claim failed to
reproduce for it (a "bare `//#endregion`") — the orchestrator has the missing
configuration: the bare form appears with `minify` **omitted** (DCE-only
default), where the region-open line is elided; with the pinned `minify: false`
the markers are a matched pair. v0.7 records both shapes and their configs.

**Codex NOT READY** with three blocking, one material, two minor — and one
finding that is the most consequential of the loop's late rounds.

**Codex BLOCKING — import attributes change module-instance semantics.** v0.6
had established that import attributes are *admitted* today and preserved them.
Admission was not the whole contract. Probed:

```js
import a from "./a.json" with { type: "json" };
import b from "./a.json" assert { type: "json" };
export const r = a === b;
```

esbuild 0.28.1 calls resolve/load **twice** (attribute maps `{"type":"json"}`
and `{}`), emits two JSON objects, and `r` is **`false`**. Rolldown 1.2.1 calls
`resolveId` **once**, emits one, and `r` is **`true`**. Structural cause:
esbuild exposes attributes to plugin hooks; Rolldown's `ResolveIdExtraOptions`
carries only `custom`, `isEntry`, `kind`. Snapback's graph ledger is keyed by
real path alone. So unchanged authored source **evaluates differently** across
the swap while every v0.6 admission fixture passes — a semantic change wearing a
toolchain change's clothes. Orchestrator probe reproduced it exactly
(`a_default`/`a_default2` versus a single `a_default`).

**Codex BLOCKING — Stage 4 had two incompatible execution orders.** Its
imperative steps ran the public-registry proof before removal; the v0.6 S1–S5
table sequenced removal first; and an immutable candidate published from a
pre-removal closure could never be replaced under the same exact version. The
Fable review flagged the same seam at MINOR.

**Codex BLOCKING — the terminal receipt was bound only to a corpus digest**, so
a stale but corpus-matching receipt could authorize a later changed closure —
weaker than LLP 0041's source/tarball ledger binding.

**Codex MATERIAL — the `showSemanticErrors` exemption was an unbounded waiver.**
Both differential gates exempted "declared" classes while the class list was an
execution-time open question, so a construct discovered mid-execution to be
current-valid and Oxc-invalid could be added to the declaration to make the gate
pass — contradicting Stage 2's rule that admission weakening is never a
permitted disposition.

**Minor:** the Vite acceptance row cited only LLP 0030/0041 for artifact
preservation those sections do not state, and LLP 0118's "today" text names
`@snapback/codegen/*` where the shipped allowlist is `@expo/snapback-codegen/*`.

### Verification outcome

Every blocking and material item confirmed by orchestrator probe or file read;
no reviewer claim was refuted. Fable's one non-reproducing claim was resolved in
the document's favor with the missing configuration supplied.

### Round 6 dispositions (v0.7)

1. **Runtime module identity is now the pair (resolved real path, normalized
   attribute map)**, with the Oxc scan as the authority because Rolldown's
   resolver cannot see attributes; both ledgers carry normalized attributes; the
   plugin realizes distinct pairs as distinct modules via non-`\0` synthetic
   ids; and Stage 0 fixtures identical, distinct, absent, and mixed
   `with`/`assert` maps on the same path, asserted by JSON object identity and
   top-level side-effect count.
2. Stage 4's steps rewritten *as* S1–S5: pre-removal local evidence → remove and
   re-qualify the final tarballs → non-default-tag candidate publication →
   published-closure verification → terminal receipt → promotion.
3. Terminal receipt schema defined and bound to the clean source SHA,
   candidate-ledger digest, version vector, tarball and integrity digests, lock
   digest, platform receipts, tool versions and option manifests, corpus digest,
   and seam absence; any relevant change invalidates it mechanically.
4. The `showSemanticErrors` exemption bounded: a class qualifies only if the
   *current end-to-end pipeline* already refuses it with equivalent diagnostic
   custody; anything else fails the Plan or becomes a separately reviewed
   versioned admission change.
5. Facade pinned to a non-`\0` reserved virtual id with `output.entryFileNames`
   pinned (a `\0` *entry* id is a hard `INVALID_OPTION` at 1.2.1).
6. TypeScript-dialect negative source named (the TypeScript compiler's
   parser-error baselines at the pinned 5.9.3); Acorn's negative cases sourced
   from the git tag matching the locked 8.17.0.
7. Both debug-marker shapes and their configurations recorded; Vite-row and
   LLP 0118 citations corrected; RSS stated as recorded evidence not a gate; the
   normalized-options `inner` member pinned; the `:4968`/`:4994` citation drift
   fixed; two residual nonclaims added (Vite regeneration *races*, and the
   unprovable-by-gate quality of a D-1a security review).

`./ref-check --verbose` passes.

## Round 7 — 2026-08-01

Instruction capsule SHA-256:
`237fb4d538ab5cc20124c835b0b57ddedcfe565059a21eb8076287e4dd110a65`

Target SHA-256 (v0.7):
`2610d5fcade5a72edbe309da168cfe72588d718af2e4748c455ef0b322fdb77a`

Verdicts and dispositions are appended as reviews are actually received.

## Rounds 7–17 and convergence

Rounds 4–17 ran the same mechanics: one fresh reviewer per family per round,
mutually blind, SHA-pinned target and capsule, no resumed sessions, verify-then-
fix between rounds. From round 5 onward both families installed and ran the
pinned tools rather than reading typings, which is what made the later rounds
productive.

### Verdict trajectory

| Round | Fable | Codex |
| ---: | --- | --- |
| 1–5 | NOT READY | NOT READY |
| 6 | **READY** | NOT READY |
| 7–11 | NOT READY | NOT READY |
| 12–15 | **READY** ×4 | NOT READY |
| 16 | NOT READY | NOT READY |
| **17** | **READY** | **READY** |

**Convergence: round 17, revision v0.17**, target SHA-256
`4a9b09271cfda6140329f62ebe2e186a81294de06b87a3e8a5096279708323ee`. Both
families independently marked that revision ready, having each verified the
census, the citations, the LLP anchors, every size-table cell against the live
registry, and roughly twenty-five measured tool behaviors against the pinned
versions.

### What the loop actually found

The high-value findings, in rough order of consequence, every one confirmed by
orchestrator probe or file read:

1. **The census missed the TypeScript type checker.** `inline-handlers.mjs`
   builds a real `Program`/`TypeChecker`; v0.1 directed implementers to delete
   TypeScript from the codegen closure. This became decision **D-1**, which
   inverts the migration's headline size result and remains the author's to
   make.
2. **Import attributes change module-instance semantics.** esbuild resolves the
   same JSON path twice for `with` versus `assert` and evaluates `a === b` as
   `false`; Rolldown resolves once and evaluates `true`. Unchanged authored
   source would have evaluated differently across the swap while every admission
   fixture passed. Produced the attribute-identity design (cooked normalization,
   real-path-keyed synthetic ids, execution-vs-persisted identity split, edit
   map, transform composition order).
3. **`logLevel: 'silent'` defeats the `import.meta` escalation.** The shipped
   esbuild call uses `logLevel: 'silent'`; a naive parity port would have made
   the prescribed `onLog` refusal inert and let `import.meta` fail open to `{}`
   in a *successful* build.
4. **A pre-existing Snapback defect** — asset-intent `implementationHash` omits
   the reachable helper closure, and only `intentPolicyHash` reaches the server.
   Filed as
   `issues/20260801-asset-intent-implementation-hash-omits-helper-closure.md`.
   Independent of this migration; the Plan now blocks Stage-0 baselining on its
   disposition.
5. **Three release-machine chronology inversions** in consecutive rounds, which
   ended only when the Plan stopped restating LLP 0041's publication protocol
   and deferred sequencing to it.
6. A long tail of measured corrections: the `top-level-await` recognizer missing
   three of four admitted spellings; `checks.emptyImportMeta` being boolean-only
   and unable to refuse; `comments.legal` accepting no `'none'`; `\0` and `:`
   silently sanitized in emitted filenames; `preserveParens` letting `(eval)(…)`
   evade the dynamic-code detector; UTF-16 rather than byte offsets;
   `require.resolve` never reaching `resolveId`; type-only edges never reaching
   the resolver; `OxcError` carrying no stable code; case-insensitive extension
   folding; and the `minify`-discriminated debug-marker shapes.

### Refutations — reviewer claims the orchestrator rejected

Recorded because a loop that never refuses a reviewer is not verifying:

- **Codex round 2** proposed correcting the Linux candidate unpacked *total*.
  Re-measurement showed the defect was in the **row**; the total and both delta
  columns were already right. Fable, which had measured the packages, had it
  correct.
- **Fable round 7** reported that the bare-`//#endregion` debris did not
  reproduce. It does — with `minify` omitted or `'dce-only'`, where the
  region-open line is elided. The orchestrator supplied the missing
  configuration and kept the claim.
- **Fable round 10** placed `getSymbolAtLocation` at `inline-handlers.mjs:141`;
  **Codex round 11** said `:139`. Measured: `:139` for the const-alias call,
  `:412` for the general binding call. Codex was right and the round-10 edit was
  reverted.

### An honest process note

Two edit batches applied by the orchestrator failed partway and wrote nothing,
so v0.15 and v0.16 shipped revision headers claiming changes the body did not
contain. The **round-16 Fable review caught this by checking the header's claims
against the body** — a check worth keeping. Both batches were re-applied edit by
edit with each one verified present before moving on.

### Status and the unreviewed delta

The converged revision is **v0.17**. The document on disk is **v0.19** and its
`**Status:**` has been moved **Draft → Review**, the only transition this loop
authorizes.

The v0.18–v0.19 delta is **unreviewed** and consists of: the round-16 Codex
findings, which arrived after v0.17 had already gone out for review (the
asset-identity prerequisite disposition and its ticket, the permission-specific
rollback wording, the helper-and-integrity version re-run rule, and a constraint-7
anchor); plus both families' round-17 minors (Rolldown `checks` defaults are
per-class rather than uniformly on; the LLP 0041 component list relabelled as an
unordered inventory; Stage-0 receipt renamed into the stage series; an
`await`-as-identifier misclassification fixture; `for await` named on the
definition-module refused side; the D-1b size clause's dangling referent; nested
attributed imports in the composed fixtures). Every one is additive and
reviewer-motivated, and none reopens a design question — but none has been
reviewed, and this journal says so rather than implying the converged revision
is what sits on disk.

### The author decision this loop cannot close

**D-1** — whether the shipped codegen closure keeps TypeScript for the
inline-handler symbol service, or a Snapback-owned binding resolver replaces it.
It changes the shape of Stage 1, the sign of the size result, and whether an
identity migration is needed at all. Both families judged the Plan coherent and
complete under **both** branches and explicitly declined to score the open
decision as a defect. The Plan states that D-1 must be answered before the
document moves past Review, and records the Plan's own recommendation —
D-1b first, D-1a as a separately reviewed identity/security migration — as a
suggestion, not a choice.
