# Quarry editors

`vscode/` contains the Quarry TextMate grammar and a VS Code extension with
compiler diagnostics. The extension version tracks the Snapback 4 binary used
to generate the grammar. It is installed locally; nothing is published here.
`tree-sitter-quarry/` supplies the second highlighting grammar, with a layout
scanner and generated lexical tables. See [its README](./tree-sitter-quarry/README.md)
for Neovim, Helix and Zed setup. Rust remains the parser of record.

From `snapback4/`, using Node 24:

```sh
cargo build -p snapback4
(cd editors/vscode && bun install --frozen-lockfile)
(cd editors/tree-sitter-quarry && bun install --frozen-lockfile)
node scripts/generate-editor-grammar.mjs
node scripts/check-editor-grammar.mjs
(cd editors/vscode && bun run package)
code --install-extension target/quarry.vsix
```

Alternatively, use VS Code's **Extensions: Install from VSIX** command and
select `snapback4/target/quarry.vsix`. Open the application root containing
`snapback/*.q`; saving a `.q` runs the compiler task. **Quarry: Check workspace**
and **Tasks: Run Task → quarry: check** also run it. Node 24 and a compatible
`snapback4` must be available to VS Code; `quarry.binary` can select an absolute
binary path. See [the extension README](./vscode/README.md) for task configuration.

The generator reads `snapback4 grammar --json`; it carries no keyword list of
its own. `--binary /path/to/snapback4` chooses a binary; `--output /tmp/grammar.json`
chooses the TextMate output; `--keywords-output /tmp/keywords.generated.js` selects
the tree-sitter JavaScript tables. `--scanner-output` selects the generated
hyphenated-word C header; `--manifest-output` selects the extension manifest
whose `firstLine` is generated from the declaration heads and comment marker. Output keys and keyword alternatives are sorted, with no
clock or absolute build path in the generated file. Regenerate and commit the
grammar alongside lexer/parser changes. When releasing, align the extension's
`package.json` version with that binary's `--version`.

The fence regenerates into a temporary directory and compares bytes, then uses
pinned `vscode-textmate` and `vscode-oniguruma` to tokenize every `.q` below
`snapback4/` except `target/` and `node_modules/`. Symlinks fail loudly
instead of being silently omitted. It also tokenizes
every `quarry` fence in the Rust/Markdown guide sources and the package README.
The compiler-owned templates retain named scopes for `@NAME@` placeholders and
`$local` template bindings; these are expanded before Quarry parsing.
Unscoped tokens are reported with every file, line and column; empty corpora,
missing dependencies and missing binaries fail. Scope witnesses check declarations,
fields, reads, literals and rules; a real compiler refusal checks the diagnostic
wrapper and matcher. Parser unit tests census every production string literal
whose spelling could be a Quarry word: each needs one editor class or a
documented non-keyword exception, including single-word diagnostic prose.
The fence is selected by `scripts/affected.mjs` after `build-cli`; it is not added
to `scripts/test.sh`. The default run now also generates tree-sitter C into a temporary build,
runs its corpus/layout tests, and parses every source and guide fence for
`ERROR`/`MISSING` and local `missing_delimiter` recovery nodes. It reports every failing site. The three pre-expansion
templates are listed with reasons in `tree-sitter-quarry/expected-errors.txt`;
their temporary copies replace only each expander's listed placeholders with identifiers and must parse
cleanly. Stale/missing exceptions fail. No ordinary Rust-accepted file may be listed.
`--tree-sitter` explicitly requests the default full fence; `--textmate-only`
is a labeled timing/bisection mode. A missing pinned CLI or C compiler fails.
The fence passes its selected `--binary` to all compiler-backed self-tests too.
Generated `parser.c`, tree-sitter support headers and parser metadata stay ignored
and uncommitted; the small generated keyword header is freshness-checked.
