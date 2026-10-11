# Snapback 4: a search `exists` over a per-row rule answers null with a visible match

Status: Closed 2026-10-11 (lead-session fix, branch sb4-ws-w)
Date: 2026-10-11
Scope: Snapback 4 engine (query evaluation of `exists t where …`), guide language
Related: LLP 3000.036 §15.11–§15.12 (wave 5 workstream U), app-farm wave 5 lane 017, lean/OPEN.md C5

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

## Resolution

The engine is changed; the card was right. Cause: the binder lowers the
search form to `count(existence scan first 1) > 0`, which the engine streams
as a domain scalar (`engine/read.rs`, `stream_aggregate`). A scan whose read
rule its pins do not decide notes `non_uniform` in the scalar's coverage
frame, and an incomplete frame made the scalar unavailable even after the
scan had counted a readable match.

Now a counted match whose frame is incomplete only through `non_uniform`
answers `true` (the query stays `complete: false`); no readable match stays
unavailable (`loading`), never `false`; every other gap (cut, device unknown,
horizon, words, presence, overflow, pending) still makes it unavailable. A
pinned or public domain answers `false` as before. Hidden rows never reach
the count, so they can neither make the answer `true` nor `false`.

Devices: unchanged behaviour on both stores. An online-only table stays
unknown on the device (its `non_uniform` always comes with `unknown`); a
synced partition the device holds already answered `true`/`false` from held
rows, and the server now agrees on `true` (it still has no value where the
device certifies `false`, as with non-uniform pages). The device never
answers `true` where the server does not.

`check`'s `N_NEVER_COMPLETE` names "the `exists` over …" and what it returns;
`test` notes when a case's `data` differs because the answer is unavailable;
guide reads and `why N_NEVER_COMPLETE` say a visible or held witness answers
`true` and an undecided scan has no answer. Mutations keep
`E_STRUCTURAL_FANOUT`. With the lane's case lines, `test` now reports `plain
(amy) → capped` passing `"data": true`.

Tests: `snapback4-device/tests/search_exists.rs` (server and both device
stores; visible match `true`, hidden-only match unavailable, decided domain
`false`, answers equal with and without hidden matches),
`snapback4-lang/tests/wave5_rule_language.rs`
(`a_search_exists_over_a_per_row_rule_answers_a_readable_match`, including
the mutation refusal), `snapback4/tests/cli_friction.rs`
(`a_search_exists_case_reports_a_readable_match_and_an_unavailable_answer`).

Follow-ups: the Lean model's `existsRead` (LLP 3000.036 §15.12, lean/OPEN.md
C5; not run here, no elan), and the `matching` form
(`issues/20261011-snapback4-matching-exists-false-over-undecided-rule.md`).
