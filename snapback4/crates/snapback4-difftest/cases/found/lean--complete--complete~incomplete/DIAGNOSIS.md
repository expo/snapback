# lean--complete--complete~incomplete

Oracle: the engine (SQLite, default ceilings) against the Lean model
(LLP 3000.035 §5.2). Seed 282; shrunk in 155 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay 'crates/snapback4-difftest/cases/found/lean--complete--complete~incomplete'`

```quarry
table items:            -- (columns elided)
  read <- .owner = viewer or exists access[0, viewer]
  online only
table access:           -- read <- allow
query run(bucket: int, …):
  return items where .bucket = bucket last 1 by .label, .score after c
```

No `items` rows; `bob` holds `access[0, bob]`.

- **Engine:** `[]`, `complete: true`: the readable grant `exists access[0,
  viewer]` holds for bob, so the page is decided once (LLP 3000.036 §12.1).
- **Model before 2026-10-12:** `[]`, `complete: false`: its `uniform` had no
  per-caller arm (OPEN C8).

**Diagnosis: a model that predated the engine, then a stale oracle.** The
model gained the grant arm (and §16.3's pinned-parent arm) on 2026-10-12
(`granted`, `decided_store`; OPEN C8), and `lean::generate` began drawing
this rule. The signature then reappeared on the merged `sb4-loop` tree with
the current model's sources: `lean/.lake` still held a `quarry-oracle` built
from the pre-merge model, and nothing rebuilt it. The harness now runs
`lake build quarry-oracle` before a `run-lean` campaign and before the Lean
tests (`lean::refresh`; the campaign's workers inherit the refreshed path
through `SNAPBACK4_LEAN_ORACLE`). Engine and current model agree; `replay`
passes; this case is a regression for the grant arm.
