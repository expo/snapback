# snapback2: the TypeScript twin and seed validator accept a lone-surrogate string the server refuses

**Opened:** 2026-09-03 (row-width lane re-review, minor parity gap)
**Area:** `snapback2/packages/evaluator/src/value-runtime.ts` (text validation),
`snapback2/packages/compiler/src/project-seed.ts`

Text values now refuse C0 control characters other than tab, newline, and
carriage return in both runtimes (`fc450e4cc`). One JavaScript-only case
remains: a string containing a lone UTF-16 surrogate passes the twin's and
the seed validator's checks (JavaScript strings admit it) but is refused by
the server at JSON parse time (Rust strings cannot hold it). The predicted
local outcome therefore differs from the committed one for that input.

Fix: refuse a string that is not well-formed (`String.prototype.isWellFormed()`
is available in Bun and Node 20+) at the same validation sites with the same
`E_INPUT` wording, and pin it in the evaluator and seed tests beside the
control-character cases.
