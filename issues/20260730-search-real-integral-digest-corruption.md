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

## Root cause (2026-07-30 code trace, LLP 0115 coverage audit)

The digest recheck is not what fails. Both sides compute RFC 8785 canonical
digests via `sha256_identity`, under which integral `5` and `5.0` both spell
`"5"` — the content digests agree. The failing check is the full
representation-sensitive struct equality `source != authoritative` at
`src/search/sqlite.rs:1731`: the insert-path in-memory document keeps
serde_json integer `Number(5)` because `normalize_json_value`
(`src/storage.rs`) validates without normalizing, while the authoritative row
reloads from SQLite as `Number(5.0)`, and serde_json equality treats those as
unequal. The comparison is also a strengthening beyond LLP 0073's specified
version+partition+predicate recheck, and the diagnostic message ("failed its
authoritative digest recheck") is wrong about its own trigger.

Reproduction asymmetry: `Patch`-maintained rows reload from SQLite before
maintenance, so both sides hold `5.0` and pass — a "corrupt" row silently
heals on its first patch. Only insert/seed-maintained rows reproduce; the
regression test in the resolution criteria must target that path
specifically.

Fix direction: compare canonical bytes/digests at the release recheck and/or
normalize integral Reals to their SQLite round-trip form in
`normalize_json_value` (which also fixes the latent storage asymmetry for any
other subsystem comparing in-memory vs. reloaded documents); correct the
diagnostic message; optionally pin RFC 8785 number spelling for
stored/filter scalar bytes in LLP 0073.

## Evidence

- `diaries/0037-pantry-search-main-rerun.diary.md`
- `/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/06-pantry-search`
