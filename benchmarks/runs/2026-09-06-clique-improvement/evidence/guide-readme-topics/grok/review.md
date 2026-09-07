# README H2 topic index — source review

**Verdict: READY**

Candidate `848e8c9ed442de225dc2abc2640b2018acafd13c` against base `df5eb6046d83a6f8ecaeb9d74ffbc5618a847681`. Patch touches only `llp/1002-dev-loop.spec.md`, `snapback2/packages/snapback2/build.mjs`, and `snapback2/packages/compiler/src/test-package-guide.ts`. Native runtime, README/grammar prose, version, and public API are unchanged. This is source review of that frozen delta, not publication or benchmark qualification.

## Material findings

None. No supported-behavior regression in the current package README or in the 23 grammar-construct help values.

## What the change does

LLP 1002 §8 now says: after page, refusal, and symbol lookup, the build-time keyword index also carries package README **H2** topics, keyed by lowercase headings with non-letter/digit runs turned into hyphens (trimmed), with the first prose paragraph before any subheading and a pointer to the packaged README section. Constructs and earlier topics win collisions; H3s are not topics; README remains authoritative.

`guideKeywords` in `snapback2/packages/snapback2/build.mjs` (from line 464) still builds the 23 construct entries first, then walks the package README (`resolve(here, "README.md")`) and inserts missing H2 keys (lines 494–523). Native `snapback2/crates/snapback2/src/guide.rs` is not in the patch.

Current `packages/snapback2/README.md` has one H2 (`## Assets`) and one H3 (`### Native view-once video`). No other ATX headings. LF only.

## 23 construct help values

Grammar construct lines (23): `maintain`, `cap`, `unique`, `immutable`, `public`, `retain`, `channel`, `connected`, `schedule`, `job`, `chunk`, `shape`, `merge`, `after`, `first`, `last`, `require`, `match`, `for`, `emit`, `tokens`, `words`, `divmod`.

Parsed `keywords.json` values for those keys are identical between `evidence/baseline/.../keywords.json` and `evidence/candidate/.../keywords.json`. Candidate adds only `assets`. Independent re-run of the extracted `guideKeywords` against the candidate guide pages plus README reproduced the candidate index bytes (`JSON.stringify` equal) and the 23 old values.

## Native page / refusal / symbol precedence

Unchanged dispatch in `guide.rs` 43–72: `init`/`dev`/`check` → command help; `grammar`/`app`/recipes → pages; `E_*` (and the two `bound/` aliases) → refusal pairs; else symbol, with a keyword excerpt merged under one header; keyword-only if the symbol miss is `E_GUIDE_UNKNOWN`.

Packet native lookups with the unchanged binary and `SNAPBACK2_GUIDE` pointed at the projected indexes:

| Lookup | Baseline | Candidate |
|---|---|---|
| `grammar` (page) | identical | identical |
| `auth` (recipe) | identical | identical |
| `init` (command) | identical | identical |
| `E_STRUCTURAL_FANOUT` (refusal) | identical | identical |
| `channel` (symbol + construct) | identical merged help | identical |
| `decimal` (symbol only) | identical | identical |
| `assets` | unknown, exit 1 | topic help, exit 0 |
| `upload` | not run | unknown, exit 1 |

`assets` is not a recipe, `E_CODE`, or `index.d.ts` export, so it correctly falls through to the keyword index. `job`/`schedule` still win as recipe pages over their construct keys (existing `guide.rs` `RECIPES` plus the Rust test comment at `tests/guide.rs` 226); the current README has no such H2. `upload` remaining unknown is in scope: no alias/synonym policy was requested. The only available-list delta for unknown names is the added key `assets`, which matches §8 (“unknown-name guidance includes index keys when readable”).

## Source-derived topic prose and pointer

Candidate `keywords.assets` (and `guide assets --json` content) is exactly the first Assets prose paragraph from the package README (13 lines, through “does not expose streaming request progress”) plus:

`See the packaged [README.md](../../README.md), section "Assets", for the full documentation.`

It does not include the later peer-version paragraph, fences, `client.upload` prose, React examples, or the H3 view-once section. That is the specified first-paragraph excerpt, not a missing feature.

From `dist/guide/keywords.json`, `../../README.md` resolves to the package-root README. Confirmed on the evidence tree (`evidence/candidate/packages/snapback2/README.md`, same SHA-256 as source). `package.json` `files` lists `dist` and not README; npm still always packs README, so the same relative path holds in the published JS layout. The snapshot path in `build.mjs` already copies README next to `dist/`.

## Markdown boundaries, normalization, collisions

Against the current README: H1 intro is not a topic; the Assets H2 is; the H3 is not; fences after the first paragraph do not become headings; the first blank line ends the definition.

Against the `--self-test` fixture (re-executed here): construct `spark` is not replaced by `## Spark`; `## Upload & Storage!` normalizes to `upload-storage` with the exact first paragraph and original heading in the pointer; `## Upload / Storage` does not replace it; `###` is not a topic; an H2 whose first block is a child heading gets no entry; fenced `##` is ignored; a list is not the defining paragraph; prose after the fence/list is; `## !!!` yields no key.

No setext headings exist in this README; not evaluating speculative ATX-only gaps as regressions.

## Generated package layout

Product write remains `dist/guide/keywords.json` (`build.mjs` 211). Full `build.mjs` still copies `guide/` into `dist/guide/`, emits `families.json`, and deletes `families.source.json`. The packet indexes were produced by extracting that helper and the real write statement, then copying source markdown; they still contain `families.source.json` and lack `families.json`. Native refusal lookup already falls back to the source file (`guide.rs` 414–421). Index *content* matches a real `guideKeywords(pages, readme)` run; this is not a full rebuilt dist.

## Test coverage

- `build.mjs --self-test` (invoked from `packages/compiler/src/test-final-gates.ts`) covers synthetic normalization, collisions, H3/fence/list/first-paragraph boundaries, and construct non-replacement.
- `test-package-guide.ts` 60–76 still requires every grammar construct’s grammar line and defining heading, then exact `keywords.assets` including the pointer, and `Object.keys(keywords).length === entries.length + 1` (so an accidental H3 key or a second H2 on this README would fail).
- Unchanged Rust `quarry_keywords_print_grammar_and_definitions_beside_symbol_help` still walks the same 23 constructs via the CLI, including page-wins-for-`job`/`schedule` and symbol merge. Not re-run in this packet.

## Checks actually performed

**Packet receipts read, not re-run:** `guide-focused` exit 0 (1.182s); `caps` 0; `ref-check` 0; `git diff --check` 0 (empty log); 15 native `guide --json` lookups as recorded in `evidence/native-guide-checks.json` (`failures: []`). Receipts themselves state: not a full package build, parser/typecheck not run, not a rebuilt/installed graph.

**This review (read-only, packet + candidate/baseline source only):**

- Required orientation: `AGENTS.md`, `snapback2/AGENTS.md`, `rules/RULES.md`, `rules/NOT-DOING.md`, LLP 1000, LLP 1002 §8 (baseline and candidate), `evidence-facts.md`, `revision.patch`.
- Complete candidate/baseline `build.mjs` `guideKeywords` and call site; complete `test-package-guide.ts`; complete `guide.rs` dispatch; package README; `guide/grammar.md`; `package.json` `files`; evidence indexes and native stdout/stderr.
- Independent parse/compare of both `keywords.json` files; independent `guideKeywords` run on current pages+README; independent self-test fixture; pointer resolution from `dist/guide`; construct count; heading inventory; native `assets` content vs index; unknown available-list delta; line counts (`build.mjs` 561 / baseline 511, under the 1,500-line cap).

## Scope limits

- Did not run `scripts/test.sh`, cargo/nextest, full `node build.mjs`, publisher, measure, or any benchmark app.
- Did not inspect moving worktrees named in receipts (`clique-guide`, `guide-readme-topics`); only this packet.
- Did not read other-family or author review directories.
- Did not evaluate upload/media synonyms, runtime README parsing, or extra aliases.
- Native `job`/`schedule` page precedence is from unchanged source, not a packet CLI replay of those names.
- Evidence dist is a guide-index projection, not a full package graph (`fullPackageBuild: false` in `evidence/index-receipt.json`).
