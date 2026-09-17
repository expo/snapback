# Snapback 4: unary minus directly before a read is refused as a "write sigil"

Status: Open
Priority: P3 (papercut: a wrong diagnostic with a rewrite that cannot help; one correction loop for a fresh builder)
Date: 2026-09-17
Systems: `snapback4-lang` parser (expression prefix `-`; the removed write-sigil refusal)
Observed version: published `snapback4@0.2.27`
Evidence status: met by a fresh builder in the bounds bar's "before" run 2 (loop 1), then reproduced by execution on the published binary

## Problem

```quarry
maintain likeCounts: count likes by postKey
  read <- allow

query a(postKey: text <=100):
  return { n: -likeCounts[postKey] }
```

```
schema.q:14:15 — E_QUARRY_SYNTAX: write sigils are invalid; use insert, update, upsert, or delete
  rewrite: use insert, update, upsert, or delete
  guide: language
```

The author wrote arithmetic negation in an expression position; nothing here is a
write. `0 - likeCounts[postKey]`, `-(likeCounts[postKey])` and `-x` for a variable
all compile (`check: ok`), so the refusal is specific to `-` immediately followed
by a table read — the shape of the removed `-table[key]` delete sigil — and it
fires even where a statement cannot begin (inside an object field's value).

## Fix

In expression position `-` before a read is unary negation. Keep the removed-sigil
refusal only where a *statement* begins with `-table[...]`/`+table …`. If the
refusal must stay reachable from an expression, its rewrite should be the form
that compiles: `0 - likeCounts[postKey]` or `-(likeCounts[postKey])`.
Regression: the four spellings above in `crates/snapback4-lang/tests/`, plus a
statement-position sigil that still gets today's message.
