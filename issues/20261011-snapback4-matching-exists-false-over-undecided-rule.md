# Snapback 4: a word-search `exists` over an undecided rule answers `false`

Status: Open
Date: 2026-10-11
Scope: Snapback 4 engine (query evaluation of `exists t matching q`)
Related: LLP 3000.036 §15.12, issues/closed/20261011-snapback4-search-exists-null-with-visible-match.md

After §15.12, a query's `exists t where …` over a read rule its pins do not
decide answers `true` on a readable match and is unavailable (`loading`)
without one. The word-search form `exists t matching q` over the same rule
does not go through the streaming scalar (`runner.rs` excludes word-prefix
scans from `stream_aggregate`): it collects the merged word page and counts
it, so with no readable match it answers `false` with `complete: false`.

```quarry
table applications:
  owner: principal
  body: text <=200
  search body
  read <- .owner = viewer
  online only
query words(q: text <=40):
  return exists applications matching q
```

With one row `{owner: dev:amy, body: 'hello world'}`, `words` as bob with
`q: 'hello'` answers `false` (capped); the `where` form answers no value.
This is disclosure-safe (bob gets `false` with or without amy's row) but is
not the documented "an undecided scan has no answer" (guide reads). A fix
would observe the word merge's undecided rule (and word cuts) in a scalar
frame and make a zero count unavailable; it touches the server-search merge
path and the device's held-word reads, so it was left out of the §15.12 fix.
