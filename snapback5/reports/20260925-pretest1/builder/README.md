This directory is the independent builder-family classification of the frozen
pre-test 1 corpus. `summary.md` contains the counts, stopping questions,
chosen ambiguity readings, and hash receipt. `units.jsonl` is the complete
ledger; `ambiguities.md` maps readings to exact stable unit ids.

Reproduce from this worktree root (Python 3.9 was used):

```sh
python3 -m venv snapback5/.venv
snapback5/.venv/bin/python -m pip install pglast==7.10
snapback5/.venv/bin/python snapback5/reports/20260925-pretest1/builder/parse_corpus.py
snapback5/.venv/bin/python snapback5/reports/20260925-pretest1/builder/report.py
```

The venv is local, uncommitted and disposable. Its local `.gitignore` contains
`*`. The successful recipe pins PostgreSQL 17.4's parser through pglast 7.10;
an initial unpinned install selected a newer major and was replaced before
the corpus was enumerated. `freeze.json` did not name a parser build.

By default, inputs are read only from
`/Users/ccheever/projects/snapback-sb5-program/pretest1`.
`parse_corpus.py --input /path/to/pretest1` permits relocation of the same
frozen bytes. Hash mismatch is fatal before parsing/classification.
The script also verifies the exact rubric bytes occur in the frozen RFC.
It does not fetch a branch, modify a corpus file or run SQL against a server.

Parsing uses the libpg_query-backed `parse_sql_json` and
`parse_plpgsql_json` APIs. All embedded PL/pgSQL expressions are parsed a
second time: SQL directly, expressions under SELECT, and assignment RHSs
after finding the assignment operator with PostgreSQL's scanner. No SQL
string is split at semicolons. See the [pglast parser API documentation](https://pglast.readthedocs.io/en/v7/parser.html).

`parse_corpus.py` mechanically enumerates units; `classify.py` implements
the repeated builder judgments; `body-decisions.json` records explicit
context-dependent decisions after reading the source/AST. This is a
reproducible human classification, not a claim to have implemented §3's
resolver/transpiler. The complete scratch AST inventory is written inside
the ignored venv. Committed units retain source, exact node paths,
expressions, and table/signature ASTs for review.

The report generator checks id uniqueness, all five legal classes, raw/post
flags, rewrite metadata, and the worst-child rule for every table/routine.
It produces no LLP edits. Only this directory is committed; no push is made.
