# Register Quarry with GitHub Linguist when its thresholds allow

**Opened:** 2026-10-31 · **Source:** LLP 3000.041 §5

GitHub renders `.q` files and ```` ```quarry ```` fences as plain text until
Linguist knows the language. Registration needs a grammar in a public repo
(the tree-sitter grammar at `snapback4/editors/tree-sitter-quarry/` and the
TextMate grammar both qualify) plus evidence of use across repositories that
Quarry does not meet yet, and a heuristic because `.q` is shared with other
languages (a `--` comment or a leading declaration word suffices).

This is a consequence of adoption, not a lever for it. Revisit when Quarry
appears in enough public repositories; until then the docs site and the
extension carry highlighting.
