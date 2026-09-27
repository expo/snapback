# Snapback 4: compact membership search still returns heap-null pages on three paths

Opened 2026-09-27 at lane GS's landing. Severity: Medium per both reviewers; not a regression
(the previous evaluator returns the same "unavailable" null on heap exhaustion).
Sources: `~/sb4-intent/reviews/gs-r5.astra.md` and `gs-r5.grok.md` (both NOT READY on these).

LLP 3000.024's one-read plan refuses `E_SEARCH_OPEN` instead of a heap-null page on
the paths rounds 2–5 fixed (heads, emitted rows, defaults, witness materialization,
the cursor page's final copy). Three paths still escape the conversion:

1. **Cursorless returns lose compact provenance** (`engine/pages.rs:56`, consumed at
   `runner.rs:351`). The return plan uses `returned_origins(..., false, ...)`, which
   excludes cursorless merges. Remove `after c` from the fixture's `newest`: heap
   3,019,966–3,019,997 returns `data: null`, unavailable, no cursor (charged 3,019,998).
2. **Shaping escapes the refusal boundary** (`runner.rs:436`, `:457`). Add `{ id }` (or
   `{ id, payload }`) after `after c`: heap failures while copying the shape's input or
   running its collector come back as heap-null (e.g. 3,025,041; 3,025,073 at
   `newest:2:1`).
3. **Argument and search preparation run before compact execution is recorded**
   (`runner.rs:343`, `:352`). Heap ceilings 1–3 null while charging the query argument
   or at `where:1`; a continuation followed at heap 64 returns null; a zero-hit query
   nulls at ceiling 3.

Fix: establish compact refusal provenance before argument/needle/cursor preparation,
carry it across cursorless returns, shape domains and collectors, and convert every
heap `Bound` inside that scope to `E_SEARCH_OPEN` (an opening that never ran reports
zero discovered memberships as an unfinished lower bound). Tests: byte-by-byte
sweeps without `after c`, with `{ id }` and `{ id, payload }` shapes, a continuation
sweep, and a mutation passing `discovered: false` at `runner.rs:354` must fail.
