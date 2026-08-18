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
- **Executed** by the Rust host runner `crates/snapback/tests/data_tier_corpus_v0.rs`.
- **Published by pinned git checkout.** `schemas/data-tier.profile.json`
  declares the public repository, commit-addressed channel, schema path, and
  corpus path. `corpus.manifest.json` pins every case by SHA-256. A sibling
  checkout remains a local cache only; consumers must pin a commit and may not
  silently skip a required profile when that sibling is absent (ENG-23964).
- **Consumed by reference** from Exact CI (Exact LLP 0329 E-A) and the
  `contract-native` data-tier evaluator (E-C). There is one Snapback-owned
  corpus; consumers never vendor a fork.
- **Extended for result transforms.** The separately versioned
  [`result-transform-v1/`](./result-transform-v1/) subcorpus applies the same
  D5 discipline to LLP 0166 §D7 without changing the established 37-case
  mutation-IR manifest or its compatibility tuple.

## Case shape

```jsonc
{
  "corpus": "snapback-data-tier",
  "corpusVersion": 1,              // minimum data-tier profile version
  "name": "…",                     // file is <name>.case.json
  "notes": "…",                    // what this case pins, human-readable
  "schema": { "tables": [ … ] },   // TableManifest values (serde shape)
  "seed": { "<table>": [ { "_id": "…", … } ] },
  "plan": { "steps": [ … ], "return_value": … },  // MutationPlan (serde shape)
  "args": { … },
  "authUserId": "user-1" | null,
  "ctxLedger": {                    // required exact v1 replay recording
    "version": 1,
    "ids": ["…"],                 // exact answer order, possibly empty
    "now": 1785758400000
  },
  "expect": {
    "result": …,                   // omit to skip
    "changedCount": 0,             // omit to skip
    "rows": { "<table>": [ … ] },  // full table contents, subset-matched per row
    "error": { "code": "…" }       // XOR with result/changedCount
  }
}
```

The Rust-generated `schemas/data-tier.case.schema.json` is the shape authority.
The sibling public profile and corpus-manifest schemas carry the compatibility
tuple `(profileVersion, corpusFormatVersion, ledgerVersion, schemaVersion)`.
An optional case above a consumer's supported profile soft-skips with
`skipped:corpus_version_too_new`; a required mismatch fails typed with
`SNAPBACK_DATA_TIER_VERSION_REQUIRED` (newer producer) or
`SNAPBACK_DATA_TIER_VERSION_UNSUPPORTED` (older producer).

Every committed v1 case carries an exact `ctxLedger`. The host and JS runners
consume the complete recording, fail on exhaustion or unused ids, and require
the committed output ledger to echo the input exactly. The corpus contains no
`$ANY_NOW` or `$ANY_ID` staging placeholders; runtime-derived row fields and
whole-plan return values are literal pins.

Row matching: `expect.rows` lists a table's **complete** contents
(count-exact); each expected row subset-matches one actual row (extra actual
fields — system columns — are ignored). Rejection cases assert the exact typed
diagnostic code, and both runners verify atomic rollback against every seeded
table. A rejected plan has no result, changed count, or output ledger.
