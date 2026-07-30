# Stored search `Real` fields corrupt on integral values

**Status:** Open
**Date:** 2026-07-30
**Systems:** portable full-text search, SQLite storage, canonical search-source
digests, schema validation
**Governing:** LLP 0073

## Observed

During the Pantry Search current-main rerun at
`01e941730306973aadaf21cd50b4c1613d171075`, the `recipes` table declared:

```js
minutes: v.number()
```

The declared search index included `minutes` in `storedFields`. All six seed
values and both mutation values were positive JavaScript integers accepted by
the `Real` validator. Schema loading, seeding, and search maintenance
succeeded, but every matching `client.search(...)` failed during authoritative
release with:

```text
SNAPBACK_SEARCH_INDEX_CORRUPT:
search source content failed its authoritative digest recheck
```

The failure reproduced on an isolated fresh in-memory server and was
independent of the Ibex/Hermes JS-runtime incident. Changing only the schema
and mutation argument to the narrower, accurate domain:

```js
minutes: v.integer()
```

made the same index, seed, queries, mutation maintenance, scoring, and
highlights pass 7/7.

The current text-search guide does not require integral values to avoid
`v.number()`/`v.real()`, nor should an accepted integral `Real` value normally
be treated as index corruption. The likely boundary is representation
normalization between the row supplied to search maintenance and the
authoritative row reloaded from SQLite.

## Why it matters

`SNAPBACK_SEARCH_INDEX_CORRUPT` is intentionally a severe fail-closed
diagnostic. Emitting it for an ordinary validator-accepted value makes a schema
modeling detail look like storage tampering and gives the author no field-level
path to a repair. Any stored or filtered real-valued field may encounter the
same maintenance/reload mismatch.

The integer workaround is appropriate for Pantry Search's actual domain, but
it does not resolve the product defect for legitimate real-valued stored
fields.

## Resolution criteria

- Canonicalize numeric values identically when search maintenance first derives
  a source and when authoritative release reloads that row from SQLite.
- Cover integral and fractional values declared as `v.real()`/`v.number()` in
  stored fields and equality filters.
- Preserve the fail-closed authoritative digest recheck for genuine derived
  state divergence.
- If any numeric representation is unsupported, reject it at schema load or
  mutation validation with a precise field-level diagnostic rather than
  `SNAPBACK_SEARCH_INDEX_CORRUPT`.
- Add a regression test that inserts an integral value into a `Real` field
  stored by a search index and successfully searches/releases the result.

## Evidence

- `diaries/0037-pantry-search-main-rerun.diary.md`
- `/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/06-pantry-search`
