# Snapback 4: a common first search word exhausts the 16 MiB query heap before a later term matches

Status: Open
Date: 2026-10-08
Scope: Snapback 4 core search execution and meter (`matching`), periphery none
Reproduced: yes, on main cd2fa88d8b (dev server, 2,500 rows)

## Evidence

App-farm round 1 cluster 10 (S-SEARCH, GPT-only, major): 3 builds.
access-dependency-map-0917: `Portfolio 2499` returned
`{loading:true,data:null,complete:false}` after 2,475 examined rows and
16,778,262 heap bytes, while `2499 Portfolio` examined two rows.
elevator-vibration-log-0883 saw the same on a 3,000-car fleet;
supplier-allergen-web-0094 also. Only builds that seeded thousands of rows
could see it.

## Repro

```quarry
use personas alice
table nodes:
  title: text 1..160
  building: text <=100
  note: text <=400 default ''
  search title, building
  read <- allow
  insert <- allow
  online only
table approvals:
  node: nodes
  principal: principal
  unique node
  read <- allow
  insert <- allow
  online only
query directory(q: text <=100, c: cursor ?):
  return nodes matching q first 40 by .title after c { *, approval: approvals[node = .id] }
```

`snapback4 dev`, then `POST /seed` 2,500 rows titled `Portfolio 0000` …
`Portfolio 2499` (building `Hall N`), then `POST /q/directory` as alice:

| q | answer | examined | heapBytes |
|---|---|---|---|
| `Portfolio 2499` | `loading: true`, `data: null`, `complete: false` | 1,974 | 16,777,372 |
| `Portfolio 0001` | `loading: true`, `data: null` | 1,974 | 16,777,602 |
| `2499 Portfolio` | 1 row, complete | 2 | 38,803 |

Without the `{ *, approval: .. }` decoration the same data completes but
`Portfolio 2499` still examines 2,500 rows and peaks at 7,976,284 bytes
(~3.2 KB per examined row; ~8.5 KB with the decoration).

Expected: a candidate the second term rejects releases its transient heap
(the meter's examined/steps counts still grow), so a 40-row page over a few
thousand candidates finishes; or, at the bound, the reply is a resumable
partial page (`complete: false` with a cursor), not `data: null`.

## Observations

- Heap grows linearly with rejected candidates, which suggests filtered rows
  (or their decoration) stay charged after rejection.
- NOT-DOING.md "Search beyond word prefixes" keeps the first term as the
  driver with no intersection index; this ticket does not ask to change that,
  only the per-candidate retention and the null answer.
- `check` notes `N_SEARCH_WORDS` ("further-term misses consume the meter"),
  which is accurate but gives no scale at which it fails.

## Suggested fix (lead session)

1. Release heap charged to a candidate once a later term or the predicate
   rejects it (and evaluate decorations only for accepted rows).
2. When the bound is still hit, return the rows found so far with
   `complete: false` and a continuation cursor instead of `loading`/`null`.
3. Optionally drive by the rarest term when term frequencies are known.
