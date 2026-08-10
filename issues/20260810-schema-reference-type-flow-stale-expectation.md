# schema-reference-type-flow test expects ok:false where structured values now succeed

**Status:** Open
**Impact:** 2
**Urgency:** 2
**Ease:** 3
**Confidence:** 4
**Systems:** Code generation, Testing
**Date:** 2026-08-10
**Related:** LLP 0211 (typed opaque/structured stored values),
`packages/snapback-codegen/schema-reference-type-flow.test.mjs` (~line 304)

Found while verifying the regenerate-race fix: the full codegen suite
fails at `schema-reference-type-flow.test.mjs:304` — the test expects
`ok: false` for a case current structured-value support generates
successfully. Reproduces on clean main with no local changes, so it is
pre-existing: the LLP 0211 typed-values work appears to have outrun this
test's expectation. Whoever owns the 0211 slice should either bless the
new behavior (update the expectation) or classify it as a real
regression.
