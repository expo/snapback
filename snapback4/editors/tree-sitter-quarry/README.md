# Quarry tree-sitter grammar

This is a **highlighting grammar**, not a second parser of record. Only
`snapback4-lang` decides what Quarry accepts; run `snapback4 check` for syntax,
types, rules and diagnostics. Expressions deliberately retain loose sequences
of operands/clauses instead of duplicating Rust precedence or semantic checks.
A clean tree is not evidence that a program compiles. File type: `quarry`;
extension: `.q` (override locally if you also use Q/kdb+).

From this directory, with Node 24, Bun and a C compiler:

```sh
bun install --frozen-lockfile
bun run generate
bun run test
bun run parse-corpus
```

`generate` reads `../../target/debug/snapback4 grammar --json` (build the binary
with `cargo build -p snapback4` in `snapback4/` first). The shared generator writes
TextMate JSON, the manifest first-line recognizer, `keywords.generated.js` and
`src/keywords.generated.h`; structural rules in `grammar.js` and
layout/boundaries in `src/scanner.c` are hand-written. For another binary/output, run
`node ../../scripts/generate-editor-grammar.mjs --binary /path/to/snapback4
--keywords-output /tmp/keywords.generated.js --output /tmp/quarry.tmLanguage.json`.
Unchanged lexical facts generate identical bytes. Do not hand-edit the tables.

`tree-sitter-cli` is an exact local devDependency, including its install script;
no global CLI is needed. `bun run test` generates C, runs 12 source-backed corpus
cases, then exercises layout, recovery and incremental edits. The calendar case
comes from the compiled language guide; the others come from the chat schema and
three real `.q` fixtures. Titles identify their source. Query files use standard
captures; the default fence also compiles all three queries.

`bun run parse-corpus` runs the complete editor fence. Its default is both
TextMate and tree-sitter, over the same `.q` enumeration and published Quarry
fences. It regenerates keywords and C into a temporary build directory, runs the
tests, and queries every tree for all `ERROR`, `MISSING` and local
`missing_delimiter` nodes. The latter keeps an unclosed group and its block
intact for highlighting while remaining a located fence failure. Leading tabs
and off-stack dedents retain Rust's recovered layout; `check` reports their diagnostics.
`--textmate-only` on the fence is an explicit measurement/bisection mode, not a
full pass. Compiler/dependency failures and empty corpora refuse loudly.

`expected-errors.txt` has only the three compiler-owned pre-expansion templates;
none of the ordinary `.q` files is excluded. A listed template must exist, contain placeholders, and parse cleanly after
only its expander's vocabulary (listed beside the path) is replaced with
equal-length identifiers in a temporary copy. Dollar locals are expanded only
for receipts; timeline replaces only `@T@`, and bridge uses its explicit names.
Unknown sigils remain parse errors. Future refusal fixtures must have a verified Rust
`E_QUARRY_SYNTAX` diagnostic, which the fence rechecks. Semantic refusals do not
qualify. The highlighting grammar may color refusal fixtures successfully.

Generated `src/parser.c`, grammar/node metadata, tree-sitter support headers and build outputs are
ignored and must not be committed. The fence builds them afresh. Scanner state
includes grouping depth, logical line starts across CR/LF, pending/completed layout and
the full indentation stack. Like all
external scanners, it must fit tree-sitter's serialization buffer: this build
supports 250 nested blocks and refuses deeper layout rather than truncating
state. That is an editor implementation limit, not a Quarry language limit.

## Neovim

Use a Neovim with tree-sitter ABI 15 support (the CLI's default). Generate first,
then build a local shared library on macOS/Linux:

```sh
mkdir -p build
cc -O2 -fPIC -shared -Isrc src/parser.c src/scanner.c -o build/quarry.so
```

Copy `queries/highlights.scm` and `queries/folds.scm` into
`~/.config/nvim/queries/quarry/`. Load the library and register `.q` in `init.lua`:

```lua
vim.filetype.add({ extension = { q = 'quarry' } })
vim.treesitter.language.add('quarry', {
  path = '/absolute/path/to/tree-sitter-quarry/build/quarry.so',
})
vim.api.nvim_create_autocmd('FileType', {
  pattern = 'quarry',
  callback = function() vim.treesitter.start(0, 'quarry') end,
})
```

Optional folding: `foldmethod=expr` and
`foldexpr=v:lua.vim.treesitter.foldexpr()`. `indents.scm` uses
`@indent.begin`/`@indent.end`/`@indent.ignore` for nvim-treesitter's indentation
module; Neovim core highlighting does not enable that module.
See [Neovim's parser/query documentation](https://neovim.io/doc/user/treesitter/).

## Helix

After generating, add this to your Helix `languages.toml`:

```toml
[[language]]
name = "quarry"
scope = "source.quarry"
file-types = ["q"]
comment-tokens = "--"
indent = { tab-width = 2, unit = "  " }

[[grammar]]
name = "quarry"
source = { path = "/absolute/path/to/tree-sitter-quarry" }
```

Run `hx --grammar build quarry`, then place `queries/highlights.scm` in your
Helix configuration's `runtime/queries/quarry/highlights.scm`. For optional
indent queries, use `(block) @indent`, `(shape) @indent`, `(list) @indent`,
`(parenthesized) @indent`, and `["}" "]" ")"] @outdent`; Helix's capture names
differ from the supplied Neovim-style file. See
[Helix language configuration](https://docs.helix-editor.com/languages.html) and
[its local grammar source support](https://github.com/helix-editor/helix/blob/master/helix-loader/src/grammar.rs).

## Zed

Create a development extension directory with `extension.toml`:

```toml
id = "quarry"
name = "Quarry"
version = "0.4.50"
schema_version = 1
authors = ["Snapback contributors"]
description = "Quarry highlighting"

[grammars.quarry]
repository = "file:///absolute/path/to/snapback-checkout"
rev = "<commit containing this grammar>"
path = "snapback4/editors/tree-sitter-quarry"
```

In that extension, create `languages/quarry/config.toml`:

```toml
name = "Quarry"
grammar = "quarry"
path_suffixes = ["q"]
line_comments = ["-- "]
tab_size = 2
hard_tabs = false
```

Copy `queries/highlights.scm` to `languages/quarry/highlights.scm`. Use Zed's
**Install Dev Extension** command. Its builder fetches the chosen revision into
`<extension>/grammars/quarry`; because this repository does not commit `parser.c`,
the first build cannot compile it yet. Run the original checkout's pinned
`node_modules/.bin/tree-sitter generate` with working directory
`<extension>/grammars/quarry/snapback4/editors/tree-sitter-quarry`, then retry
**Install Dev Extension**. Keep the same revision so the generated files match.
No Rust extension library or language server is required. Optional Zed
`indents.scm` uses `(block) @indent`, `(shape) @indent`, `(list) @indent`, and
`(parenthesized) @indent`; do not copy the Neovim indent captures verbatim.

This local build step is necessary: Zed's builder compiles `src/parser.c` and
`src/scanner.c` directly, without invoking our generator. A future distributed
extension needs a prepared grammar artifact. See
[Zed language extensions](https://zed.dev/docs/extensions/languages) and
[the builder](https://github.com/zed-industries/zed/blob/main/crates/extension/src/extension_builder.rs).
No editor installation or GUI validation is claimed by this lane.
