# lean--next--next~no-next

Oracle: the engine (SQLite, default ceilings) against the Lean model
(LLP 3000.035 §5.2). Seed 7500; shrunk in 97 attempts.
Replay (after `cd snapback4/lean && lake build`):
`cargo run --release -p snapback4-difftest -- replay crates/snapback4-difftest/cases/found/lean--next--next~no-next`

```quarry
table items:            -- (columns elided)
  read <- .owner = viewer
query run(bucket: int, c: cursor ?, …):
  return items where .bucket = bucket last 1 by .label, .score after c
```

Store: one row, `r6`, owned by the viewer. The read rule's deciding field
(`owner`) is not pinned, so the page is non-uniform and never complete; both
sides agree on that and on the data (`[r6]`, `complete: false`).

- **Engine:** the page fills (`last 1`) and carries `next`.
- **Model:** the walk exhausted the candidates, so `next` is null. The model
  carries `next` on a filled page only when another visible candidate follows
  (OPEN C2: an uncharged lookahead).

**Diagnosis: open language question, OPEN C2** (does a page that fills
exactly carry `next`?). The reads card says only "A terminal full page need
not carry `next`", which permits both behaviours. Engine behaviour observed in
the 60,000-case run:

- **uniform pages with no residual conjunct:** the engine agrees with the
  model's lookahead (all 9,859 such pages; 5,109 reads were followed to their
  end on both sides' own cursors);
- **non-uniform pages** (1,150 of 1,162 disagreed) and **uniform pages with a
  residual filter** (94 of 1,784: `.score >= 0`, `.label != ''`, a
  disjunction, and `.maybe = null`, which the binder keeps as a residual
  filter where the model pins it): a full page carries `next` even when no
  further candidate exists.

No data or `complete` result differs. Following the engine's extra cursor
returns an empty page (checked on both retained cases). No engine or binder code
was changed. `lean--continuation-next--next~no-next` is the same point on a
later page.
