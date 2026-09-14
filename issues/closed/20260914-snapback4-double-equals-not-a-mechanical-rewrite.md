# Snapback 4: `==` in a condition is a generic syntax error, not a mechanical rewrite

Status: Closed
Priority: P3
Date: 2026-09-14
Systems: Quarry parser diagnostics, `check --fix` guessed spellings (LLP 3000.007 §5.5, §18.5)
Observed version: published `snapback4@0.2.12`

## Problem

Equality in Quarry is `=`. Writing `if f == 'x':`, the most common guess
from nearly every other language, produces:

```text
schema.q:12:11 — E_QUARRY_SYNTAX: expected expression, got "="
  rewrite: fix this Quarry line and rerun snapback4 check
  guide: language
```

The parser's recovery then cascades into further errors for the same
helper, including "a fn body ends with return". The guessed-spelling set
(`elif`, `? :`, `?.`, `len`, `//`, `#`, `proc`, and §18.5's four) was built
so that a guess costs a command, not a loop, and `==` is not in it.
Observed by the catch-up lead while writing the helper-cursor reproduction
(`issues/20260914-snapback4-helper-early-return-drops-page-cursor.md`).

## Acceptance

`a == b` (and `a != b`, which is already Quarry) gets
`E_QUARRY_SYNTAX: equality is = in Quarry` with the rewrite `a = b`,
marked mechanical so `check --fix` applies it. No alias enters the parser
(ruling 3): the rewrite is applied, never silently accepted.

## Resolution — 2026-09-14, lane N3

The helper reproduction produced 3 diagnostics on base
`ce15819ad71bd24c9d1b9ec228c083330dee3a31`; it now produces exactly 1:
`E_QUARRY_SYNTAX: equality is = in Quarry`, with the operator-span rewrite
`=` marked mechanical. The parser continues through the comparison and
helper, but compilation stops before binding until the spelling is fixed.
`check --fix` rechecks the two adjacent symbol tokens at the exact source
site and replaces only those two bytes. Tests cover the reproduced helper,
two comparisons on one line and in two files, stale sites, Unicode, CRLF,
and unchanged strings and comments. `!=` remains valid and unchanged (the
acceptance paragraph's parenthetical did not mean to refuse Quarry's own
inequality); `===` retains its generic, non-mechanical diagnostics.
