# Data-tier conformance corpus (LLP 0051 D5, staged)

Machine-readable cases pinning the semantics of the v1 mutation-IR profile
(LLP 0051 D2): every expression form, the pinned function library, the
value-model rules, the step semantics, and every rejection class. Cases are
**data** — plans plus rows — never code, so every evaluator in every language
can run them; the corpus, not any single runner, is the definition of
correct.

- **Authored** via the typed `define.mjs` builder in
  `packages/snapback-codegen/data-tier-corpus.mjs` (that structure is itself
  the Increment 3 builder-parity gate) and regen-and-diff gated by
  `packages/snapback-codegen/data-tier-corpus.test.mjs` (`--write` to
  regenerate).
- **Executed** by the Rust host runner `tests/data_tier_corpus_v0.rs`.
- **Consumed by reference** from Exact CI (Exact LLP 0329 E-A) and, later,
  the `contract-native` data-tier evaluator (E-C).

## Case shape

```jsonc
{
  "corpus": "snapback-data-tier",
  "corpusVersion": 1,              // shared data-tier profile version
  "name": "…",                     // file is <name>.case.json
  "notes": "…",                    // what this case pins, human-readable
  "schema": { "tables": [ … ] },   // TableManifest values (serde shape)
  "seed": { "<table>": [ { "_id": "…", … } ] },
  "plan": { "steps": [ … ], "return_value": … },  // MutationPlan (serde shape)
  "args": { … },
  "authUserId": "user-1" | null,
  "expect": {
    "result": …,                   // omit to skip
    "changedCount": 0,             // omit to skip
    "rows": { "<table>": [ … ] },  // full table contents, subset-matched per row
    "error": { "code": "…" }       // XOR with result/changedCount
  }
}
```

Placeholders (staging bridge until the ctx-answer ledger — LLP 0051
Increment 2 — makes outputs exact, LLP 0010's `$NOW`/`$ID` mechanism):

- `"$ANY_NOW"` — matches any positive number (RuntimeNow-derived values)
- `"$ANY_ID"` — matches any non-empty string (RuntimeId/bind_id_as values)

Row matching: `expect.rows` lists a table's **complete** contents
(count-exact); each expected row subset-matches one actual row (extra actual
fields — system columns — are ignored). Rejection cases assert the typed
diagnostic code and, optionally, that nothing committed.
