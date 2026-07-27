# 0022 — documents: exploratory convergence kernel

## 2026-07-26 — Draft-protocol reducer checkpoint

LLP 0063 asks for a Notion/Docs-style pressure app, but LLP 0008 deliberately
defers collaborative text and LLP 0068 remains Draft. I therefore started with
the smallest useful artifact that can improve the protocol without laundering
it into a product claim: a pure candidate reducer plus a retained operation
corpus. The branch is intentionally off main and the pressure profile is red
and claim-ineligible.

### What felt good

- Operation-scoped atom ids remove the ambiguity between one operation counter
  and a multi-scalar insertion. A two-character insert consumes one operation
  counter and deterministically derives offsets zero and one.
- Reducing an immutable operation set makes duplicate and opposite delivery
  straightforward to test. The acceptance runner compares canonical snapshot
  bytes and hashes across forward, reverse, interleaved, duplicate, and
  reconstructed deliveries.
- The Draft's greatest-placement cycle rule is implementable as a small total
  graph algorithm. The corpus includes concurrent `A-after-B` and `B-after-A`
  moves plus a delete/move race, so the code cannot hide behind traversal order.
- Keeping missing dependencies buffered and invisible is a clean boundary. It
  produces useful protocol evidence without inventing a whole-document
  overwrite fallback.

### What remains awkward or missing

- This is not yet a Snapback application. There is no generated document
  declaration, durable operation admission, uniqueness/settlement transaction,
  live invalidation, retained local outbox, or authority-bound replay.
- Marks are intentionally refused. Endpoint affinity, deleted-endpoint repair,
  grapheme-aware editor behavior, and undo need stronger fixtures before they
  should become durable protocol bytes.
- The canonical encoder starts from already-parsed closed JavaScript objects.
  A wire parser still needs to reject duplicate JSON keys and prove the exact
  byte profile across Rust, web, Swift/iOS, and Kotlin/Android.
- Compaction is the hard architectural continuation: anchor skeletons,
  retention leases, compactor fencing, and an old offline edit need one
  executable race, not four independent happy paths.
- The reducer does not make a Notion/Docs product. History, comments, granular
  sharing, presence, large-document windows, and product UI all remain red.

Compared with React plus Yjs, the bespoke candidate makes authorization,
operation identity, audit bytes, and fail-closed limits much easier to inspect.
The cost is immediate and substantial: Snapback owns the reducer, editor
adapters, cross-language corpus, fuzzing, and compaction semantics that Yjs
would otherwise supply. This checkpoint is useful precisely because it prices
that choice before ratification.
