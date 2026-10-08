# lean--next--no-next~next

Oracle: the engine (SQLite, default ceilings) against the Lean model
(LLP 3000.035 §5.2). Seed 51; shrunk in 146 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/lean--next--no-next~next`

```quarry
table items:            -- (columns elided)
  read <- allow
query run(bucket: int, …):
  return items where .bucket = bucket last 1 by .tag
```

Two rows; the page fills with `r4`.

- **Engine:** `complete: true`, no `next`.
- **Model (before the fix):** `complete: true`, `next` present, because a
  visible candidate (`r3`) follows.

**Diagnosis: model defect, fixed 2026-10-08** (now OPEN C9, confirmed). A
document contradicts the model: LLP 3000.027 §1, "A cursorless top-N answer
has no `next`; a cursor page may be complete with `next`", and the
`N_NO_CURSOR` card, "a returned page without a cursor cannot continue …
Filling `first N` or `last N` is complete without `next`". The model's page
expression now returns no `next` when it has no `after` clause
(`Quarry/Eval.lean`); the theorems are unchanged (they are stated over
`pageRead`), `./check.sh` passes, and the example `page-cursorless-filled`
records the rule. `replay` now passes; this case is a regression.
