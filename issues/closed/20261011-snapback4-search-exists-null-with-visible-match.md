# Snapback 4: a search `exists` over a per-row rule answers null with a visible match

Status: Open
Date: 2026-10-11
Scope: Snapback 4 engine (query evaluation of `exists t where …`), guide language
Related: LLP 3000.036 §15.11 (wave 5 workstream U), app-farm wave 5 lane 017

In a query, `exists t where <predicate>` over a table whose read rule is not
decided by the scan's prefix answers `null` with `complete: false`, even when
a row the viewer may read matches. Reproduced on the shipped 0.4.20 binary
and on `sb4-ws-u`:

```quarry
table applications:
  owner: principal
  status: enum('draft', 'submitted')
  totalPoints: int
  read <- .owner = viewer
  online only
query plain():
  return exists applications where .status = 'submitted'
```

With one row `{owner: dev:amy, status: 'submitted'}`, `test --as amy` gives
`plain (amy) → capped: data … null`. The same query over a `public` table
answers `true` and `complete`. In a mutation the same form refuses
`E_STRUCTURAL_FANOUT` (it would miss hidden rows), which is accurate.

`guide language` says "`exists` stops at a visible match; unknown domains
cannot prove absence". A visible match proves presence, so `true` (complete
or not) would follow the card; `null` reads as unknown. Either the engine
should answer `true` on a visible match (and `null` only when no visible row
matched and the domain is undecided), or the card should say a search
`exists` over a per-row rule is unavailable in a query. This changes query
semantics on the server and both devices (and the Lean model's `exists`), so
it was left for the lead session; the wave-5 bracket diagnostic (§15.7)
prints this search form, which is lane 017's own (mutation, staff-guarded)
repair.
