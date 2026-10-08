# lean--kind--committed~NOT_FOUND

Oracle: the engine (SQLite, default ceilings) against the Lean model
(`snapback4/lean`, LLP 3000.035 §5.2). Seed 23074; shrunk in 95 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/lean--kind--committed~NOT_FOUND`

```quarry
table items:            -- (columns elided)
  read <- .owner = viewer
  update <- .owner = viewer
mutation run(key: id, …):
  upsert items[key] { owner: viewer, bucket, score: 0, … }
```

Store: one row `r0` owned by `bob`. Viewer: `alice`, key `r0`.

- **Engine:** commits. `alice` now owns `r0`.
- **Model:** refuses `NOT_FOUND`. The unnamed rule is expanded to
  `old.owner = viewer and next.owner = viewer`; the old image is bob's, and
  the target is unreadable to alice, so the denial is `NOT_FOUND`.

**Diagnosis: open language question, OPEN R2** (which images an unnamed
`update <- R` judges). A direct probe of the engine
(2026-10-08, the same schema) settles its behaviour: it judges **the next
image only**:

| old owner | next owner | engine | model |
| --- | --- | --- | --- |
| viewer | other (`update … { owner: to }`) | `E_RULE` | `E_RULE` |
| other | viewer (`update` or `upsert`) | committed | `NOT_FOUND` (unreadable) / `E_RULE` (readable) |

Named rules agree everywhere: 374 compared writes under
`update (old, next) <- old.owner = viewer`, `… next.owner = viewer` and
`… old.owner = viewer and next.owner = viewer` in the 60,000-case run, with no
disagreement.

The documents lean toward the model but do not decide the unnamed form:

- `snapback4 why NOT_FOUND`: "the update rule judges old and next";
- LLP 3000.007 §8 item 7(a), "Write authority is the write rule": the
  table's `update` rule decides "as Postgres applies an `UPDATE` policy
  without a `SELECT` policy" — a Postgres `UPDATE` policy's `USING` judges
  the existing row and, with no `WITH CHECK`, the new row too;
- `guide from-sql`: RLS `USING` / `WITH CHECK` map to `update <-`;
- against: the rules card's "Insert uses the new image, named updates
  old/next" names no image for an unnamed update, and the language card pairs
  `update <- .authorId = viewer` with `immutable authorId`, which makes the
  two readings coincide.

**Why it matters (security).** Under the engine's reading,
`update <- .owner = viewer` without `immutable owner` lets any principal take
over another principal's row with a blind `update`/`upsert` that sets
`owner: viewer`. The model's reading refuses it. This needs Charlie's ruling;
no engine or binder code was changed. The companion signature
`lean--kind--committed~E_RULE` is the same point on a readable target.
