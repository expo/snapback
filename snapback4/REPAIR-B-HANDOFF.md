# Repair B — where this branch stands

Branch `sb4/repair-b-defer-image-0bf8a4b5`, based on `27a8a4d66`. The design of
record is LLP 3000.001 `#reliability-catchup`, which describes what is built
here, including the two mechanisms that were refuted on the way.

**This is not landed and should not be landed as-is.** After four fix rounds and
five blind review rounds across two model families, neither family has returned
READY. The mechanism itself survived every round — the last GPT-family review
states plainly that it found no counterexample to prediction retirement versus
the published base — and what remains are defects in the durable state the repair
introduced.

## What passes

- `cargo test -p snapback4-device`: 569 passed, 3 pre-existing ignores.
- `cargo test -p snapback4-core`: 160 passed.
- `cargo test -p snapback4 --bin snapback4`: 68 passed.
- `bash scripts/test.sh`: one failure, `README TypeScript examples compile and
  call every public function`, which is **pre-existing on main** and has its own
  ticket (`issues/20260917-snapback4-readme-coverage-test-red-on-main.md`).
- All three refuted-design counterexamples are kept as passing regressions.
- Across the fix rounds, 19 + 9 mutations were each shown to fail their intended
  regression, and two families independently reproduced a sample of them.

## What is open

From the closing review round. The full review texts are under
`snapback4/target/reviews-round1/` … `reviews-final/` in this worktree
(gitignored), and the per-round implementer reports under `target/review-fix*/`.

1. **Incarnation knowledge still has inconsistent lifetimes** (GPT family, High,
   reproduced). After a row-only reset the transport and the receipt still name
   the old store while the replacement detector has forgotten it; store B
   publishes while running store A2's query program and A's receipt stays queued.
2. **`sync_state`'s `transfer_watermark` formula and `begin_send`'s
   `snapshot::clear`** (grok, two Highs).
3. **`apply_publication`'s obsolete-page predicate** treats a missing
   `requested_watermark` as a match and compares against the wrong floor; and the
   first replacement page is gated on the ordinary transfer cursor, so a snapshot
   starting at 0 never applies (grok, two Highs).
4. **`should_defer` with a missing `images_at`** treats every replayable write as
   in the image, and a terminal snapshot with a gap can defer forever (grok, two
   Highs).
5. **First identity is staged only from the current page's `store_id`**, and
   `None` is treated as a write (grok, High).

## The pattern worth carrying forward

Every High in every round was one fact with two representations, or two paths
that had to agree and did not. The durable-key table in `JOURNAL.md` — one
writer, one clearer, and which paths read each key expecting which kind of state
— was added for that reason and is the artifact to keep extending. The open
findings above are all instances of it, mostly private transfer state being read
by a path that expects published state.
