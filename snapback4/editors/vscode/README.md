# Quarry

Quarry highlighting and compiler diagnostics for Snapback 4. Built from the
repository's `snapback4 grammar --json` with the same version as this extension.
Install `snapback4/target/quarry.vsix` through **Extensions: Install from VSIX**;
[build instructions](https://github.com/expo/snapback/blob/main/snapback4/editors/README.md) live beside the extension source.

Open the application root containing `snapback/*.q`. Saving a `.q` file runs
**quarry: check**; **Quarry: Check workspace** runs it manually. There is no
language server. Node 24 must be on VS Code's PATH. The wrapper uses the
workspace's `node_modules/.bin/snapback4` when installed, otherwise `snapback4`
on PATH. Set `quarry.binary` to an absolute binary path to override this, and
set `quarry.checkOnSave` to `false` to use only manual checks. Concurrent saves
coalesce into one subsequent check. Multiple workspace folders get separate tasks.

To select the task as the workspace's default build task, use `.vscode/tasks.json`:

```json
{
  "version": "2.0.0",
  "tasks": [{ "type": "quarry", "label": "Quarry check", "group": { "kind": "build", "isDefault": true }, "problemMatcher": "$quarry-check" }]
}
```

`scripts/check-problems.mjs --workspace <app-root> [--binary <path>]` runs
`snapback4 check --json` with `<app-root>/snapback` as its working directory.
Each located problem or compiler note is printed once in exactly this form:

```text
/absolute/file.q:line:col: CODE message | rewrite
```

Line and column are the compiler's one-based positions. Message and rewrite
whitespace (including embedded newlines) collapses to single spaces. The entire
`message | rewrite` is the Problems message; the code has its own column.
Diagnostics without a source location go to stderr without an invented site.
The compiler's failure exit status is preserved; missing tools, empty source
directories and malformed JSON fail loudly. The matcher uses error severity for
all matched lines, including advisory `N_` notes; the code distinguishes notes.
Acknowledged security notes are omitted. `E_SECURITY_INVARIANT` is emitted only
for authored/generated fixture traces that fail the compiler's check; synthetic
and trusted-seed refutations remain in the compiler report, without editor errors.

The extension registers `.q` and a first-line hint matching `--` or Quarry
declaration heads. VS Code's filename association can still select Quarry for
Q/kdb+ files: `firstLine` is a recognition hint, not an exclusion filter. In a
mixed workspace set `files.associations` explicitly (using the language id from
your Q/kdb+ extension for its files), or use **Change Language Mode**.

Comments use `--`. Brackets and quotes close automatically. A trailing colon
indents the next line. Enter before `{`, `and ` or `or ` indents a continuation;
Enter within an existing indented continuation keeps its indentation. The lexer
requires these continuation lines to be deeper than their enclosing block.

Regenerate with `node scripts/generate-editor-grammar.mjs` from `snapback4/`.
Build locally with `bun install --frozen-lockfile` then `bun run package` here.
No marketplace publication, GitHub/Linguist registration, completion, hover or
go-to-definition is included. Tree-sitter and visual theme screenshots remain
outside chunk A's executable evidence.
