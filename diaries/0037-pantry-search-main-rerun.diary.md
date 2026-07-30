# Diary 0037: Pantry Search current-main rerun

**Application:** indexed recipe search over title, ingredients, and tags on
Snapback and Convex
**Rerun:** 2026-07-30
**Snapback revision:** `01e941730306973aadaf21cd50b4c1613d171075`
**Systems:** Snapback, Convex, portable full-text search, code generation,
mutations, acceptance
**Related:** Diary 0028; LLP 0073;
`issues/20260730-search-real-integral-digest-corruption.md`;
`/Users/ccheever/projects/snapback-workout-matrix-20260729/apps/06-pantry-search`

## Why rerun

The first Pantry Search implementation predated Snapback's portable full-text
search. It honestly bounded a JS live-query scan to 200 rows, but that made the
comparison lopsided: Convex had a declared search index while Snapback had an
application scorer.

Current main ships the LLP 0073 local SQLite search profile. This rerun removes
the stale scan completely and tests the shipped authoring/client path:

- schema-level `.searchIndex(...)`;
- `defineSearchQuery(...)`;
- the portable structured query AST;
- `client.search(...)`;
- deterministic scoring, highlights, filters, and indexed maintenance; and
- explicit nonclaims for live, hosted, offline, and native-accelerated search.

The Convex implementation and behavioral contract remain unchanged.

## Orientation and guide experience

I loaded the guide index, capability index, text-search page, queries,
mutations, live queries, and acceptance page, then oriented through the root
LLP and LLP 0073. The search page supplied the full paved sequence and
prevented two overclaims:

- `defineSearchQuery` is an ordinary `Query`, not a live query; and
- v1 equality filters do not imply arbitrary numeric range filters.

The prior diary's missing-search guide gap is closed. The current guide also
states the supported target honestly: local SQLite, with no claim for hosted,
Postgres, Cloudflare, offline, or native acceleration.

## Current-main Snapback arm

The `recipes` table now declares `search_recipes` with semantic version
`pantry-search-recipes.v2`. It indexes:

- `title` at weight 8;
- normalized `searchIngredients` at weight 4; and
- normalized `searchTags` at weight 3.

`difficulty` is an indexed equality filter. The result stores title,
difficulty, minutes, and the two normalized search fields, and enables title
highlights. The existing arrays remain persisted as `v.json()`;
`searchIngredients` and `searchTags` are deliberate denormalized scalar search
sources, similar to the Convex arm's `searchText`.

`functions.mjs` now declares:

```js
export const searchRecipes = defineSearchQuery({
  table: recipes,
  index: 'search_recipes',
});
```

The old `defineJsLiveQuery` scan/ranker was deleted. `handlers.mjs` contains
only `addRecipe`, which maintains the denormalized search strings.

## Search runtime evidence

The first native index run failed closed with:

```text
SNAPBACK_SEARCH_INDEX_CORRUPT:
search source content failed its authoritative digest recheck
```

This was independent of the Hermes JS-runtime incident: search is the native
declarative lane, and the same failure reproduced in an isolated fresh
in-memory server.

The cause was a schema/value normalization edge. `minutes` was declared
`v.number()` (`Real`) but every accepted value was an integer, and `minutes`
was included in the stored search projection. The initially derived source and
the row reloaded from SQLite did not reproduce as byte-for-byte equal canonical
JSON, so the authoritative digest check quarantined the result. Declaring the
actual domain as `v.integer()` in both schema and mutation arguments removed
the mismatch. This is a valid app model and the final solution, but the
diagnostic burden is too high: an integral value accepted by a real validator
should not turn into an opaque corruption report merely because it is a stored
search field.

After that correction, real Snapback acceptance passed **7/7**:

1. six rows seeded and the generated manifest exposed
   `search_recipes`/`pantry-search-recipes.v2`;
2. `title:tom*` returned “Tomato Basil Pasta” then “Roasted Tomato Soup” with
   integer score 640 and a title highlight;
3. ingredient prefix `chick*` found curry and tag prefix `break*` found oats;
4. `vegan` tag plus indexed `difficulty = easy` composed, with the unsupported
   `minutes <= 30` range applied explicitly as a client projection;
5. add returned an id, commit version, and `changed_count: 1`;
6. attempting `liveQuery` on the generated search reference failed with the
   exact `SNAPBACK_FUNCTION_NOT_LIVE` diagnostic; and
7. a fresh ordinary `client.search` after mutation observed “Curry in a Hurry”
   and “Golden Chickpea Curry”.

This proves a synchronously maintained real backend index. It does not claim a
live subscription: clients must issue a fresh ordinary search after changes.

## Code generation and typing

Code generation completed with:

```text
tables 1; operations 2 (query 1, mutation 1); live 0
files 18 (review manifest 1, consumer committed 0, ignored cache 17)
inputsHash da0845321feb…
```

The generated API correctly marks `searchRecipes.kind` as `Query` and exposes a
typed `SearchPageV1` result with stored fields, score, highlights, cursor, and
`hasMore`.

There are still three provider-introspection warnings:

- the structured search `query` argument is exposed as `unknown`;
- `ingredients` is `unknown`; and
- `tags` is `unknown`.

The latter two follow from the continued lack of typed array validators in
this authoring vocabulary. `addRecipe` also lacks a declared precise result
contract.

## Convex control

The unchanged Convex arm declares its native `search_recipes` index over a
denormalized `searchText` field, with difficulty as a filter field. Its owned
anonymous local backend passed **6/6**:

- deterministic six-row reset/seed;
- title, ingredient, and tag prefix matches through the declared index;
- relevance ordering;
- tag/difficulty/time composition;
- generated document id from add; and
- second-client WebSocket delivery of the newly indexed curry result.

Direct strict TypeScript checking of `convex/recipes.ts` and
`convex/schema.ts` passed. The wrapper stopped its owned backend.

The semantic difference remains important: Convex search queries participate
in its reactive query subscription model; Snapback portable search v1 is
ordinary request/response only.

## What felt good

- The old whole-table JS scan is gone. Snapback now has a real declared and
  synchronously maintained search index.
- The declaration makes weights, text fields, equality filters, stored fields,
  highlights, visibility, and semantic version auditable.
- `parseSearchQueryV1` plus the `search.*` builders made the structured AST
  usable without constructing wire JSON by hand.
- Scores, result ordering, highlight ranges, and cursor shape are explicit
  portable contracts rather than a provider-defined opaque array.
- Fail-closed digest verification caught a representation inconsistency
  instead of silently serving unverified search state.
- The guide's target and live-query nonclaims were clear and directly testable.

## What felt bad or surprising

- `Real` plus integral stored values produced
  `SNAPBACK_SEARCH_INDEX_CORRUPT`, an alarming and under-specified diagnostic
  for an ordinary schema/value combination.
- The search query argument degrades to `unknown` even though the client ships
  a concrete portable AST type.
- Ingredients and tags still need `v.json()`, losing generated collection
  types.
- Search v1 cannot express the numeric minutes range; the app must
  over-fetch/filter or model a finite equality bucket.
- Search is non-live, while Convex naturally pushes the recomputed indexed
  result to a subscriber.
- The external app still depends on absolute checkout imports.

## Size and comparison

Measured over authored source/seed/acceptance files, excluding generated
caches, reports, locks, and tool configuration:

| Arm | Authored | Generated |
| --- | ---: | ---: |
| Snapback | 336 lines / 11,399 bytes | 18 files, 2,020 lines / 64,940 bytes |
| Convex | 303 lines / 10,773 bytes | 5 files, 368 lines / 12,448 bytes |

The authored gap is now small. Snapback's generated surface is much larger
because it includes capability, provider, Contract, identity, and custody
evidence. Convex remains more concise and reactive; Snapback is more explicit
about portable scoring/highlights/cursors and backend integrity.

## Verdict and priorities

Current main reverses the prior diary's central conclusion that Snapback lacks
indexed search. Both providers now execute real declared full-text indexes and
both pass their preserved contracts. Convex still has the smoother production
shape for this app because indexed queries are reactive, typed arrays are
native, and generated output is compact. Snapback's portable contract and
integrity checks are compelling, but the `Real` normalization failure and
non-live client model are substantial friction.

Highest-value improvements:

1. canonicalize numeric search-source values consistently across maintenance
   and authoritative reload, or reject the mismatch with a precise
   schema/value diagnostic before indexing;
2. generate the concrete portable search AST argument type instead of
   `unknown`;
3. add typed collection validators such as `v.array(v.string())`;
4. add a live/re-execution story for indexed search without relabeling the
   current ordinary query;
5. expand portable filter support beyond equality where a bounded,
   cross-provider contract is possible;
6. improve the dense review-manifest diff while retaining the ignored evidence
   graph; and
7. publish an installable external-app authoring/client path.
