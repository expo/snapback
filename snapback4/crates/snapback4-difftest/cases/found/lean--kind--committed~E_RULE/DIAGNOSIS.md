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
