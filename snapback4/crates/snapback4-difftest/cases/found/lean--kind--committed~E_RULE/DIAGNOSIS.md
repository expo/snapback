# lean--kind--committed~E_RULE

Oracle: the engine (SQLite, default ceilings) against the Lean model
(LLP 3000.035 §5.2). Seed 58348; shrunk in 111 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/lean--kind--committed~E_RULE`

```quarry
table items:            -- (columns elided)
  read <- allow
  update <- .owner = viewer
mutation run(key: id, …):
  upsert items[key] { owner: viewer, bucket, score: 0, … }
```

Store: one row `r0` owned by `bob`. Viewer: `alice`, key `r0`.

- **Engine:** commits; `alice` takes over `r0`.
- **Model:** refuses `E_RULE`. The target is readable (`read <- allow`), and
  the expanded rule `old.owner = viewer and next.owner = viewer` fails on the
  old image.

**Diagnosis: open language question, OPEN R2**, the same point as
`lean--kind--committed~NOT_FOUND` (see its DIAGNOSIS.md for the engine probe,
the documents on each side and the security consequence). The engine judges
an unnamed update rule against the next image only. Only the refusal code of
the model's side differs, because here the target is readable (OPEN W3).

## Resolution (2026-10-08): engine defect, fixed — kept as a regression

The orchestrator classified this as an engine defect (security), not an open
question: the rules card and `why NOT_FOUND` say "the update rule judges old
and next". The engine now judges an unnamed `update <- R` as
`R[old] and R[next]` (`snapback4-core/src/schema/update_images.rs`, applied in
`Runner::check_rule`), so it refuses `E_RULE` here, as the model does; `bob`'s
row is unchanged. `snapback4/lean/OPEN.md` R2 is decided by the documents.
This case must replay as agreeing (`replay` exits 0); a regression to the
next-image-only reading makes it fail again. Unit coverage:
`crates/snapback4-core/tests/update_rule_images.rs` and the Postgres test
`engine::postgres::tests::update_images`.
