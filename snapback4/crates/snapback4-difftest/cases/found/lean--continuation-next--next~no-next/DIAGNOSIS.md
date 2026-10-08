# lean--continuation-next--next~no-next

Oracle: the engine (SQLite, default ceilings) against the Lean model
(LLP 3000.035 §5.2). Seed 22563; shrunk in 164 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/lean--continuation-next--next~no-next`

```quarry
table items:            -- (columns elided)
  read <- .owner = viewer
query run(bucket: int, c: cursor ?, …):
  return items where .bucket = bucket first 1 by .tag after c
```

Store: two rows of the viewer's, `r6` and `r8`. The first pages agree
(`[r6]`, `next` on both sides). Each side then continues from its own cursor
(OPEN C1): the second page is `[r8]` on both, `complete: false` on both
(non-uniform), and only the engine carries `next`.

**Diagnosis: open language question, OPEN C2**, the same point as
`lean--next--next~no-next` on a continuation page (see its DIAGNOSIS.md for the
observed rule: non-uniform and residual-filter pages that fill carry `next`).
