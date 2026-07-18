# Capture exact read-your-writes query inputs

**Status:** Closed
**Severity:** P1
**Systems:** Ibex runtime, Mutations, Queries, OCC
**Author:** Codex (GPT-5), directed by Charlie Cheever
**Date:** 2026-07-17
**Related:** LLP 0003; LLP 0020; LLP 0032
**Marker:** read-your-writes, query, captured-read, occ, buffered-write

Buffered mutation queries first captured a declared-limit storage query, then
performed a separate overfetch for the actual overlay and uncaptured point
reads for touched ids. A sibling commit could make the handler consume storage
facts that were absent from its captured OCC ledger, allowing commit-time
validation to reason about a different read than the one that produced the
handler result.

**Done when:**

- The query dependency describes the exact overfetch consumed by the buffered
  merge.
- Every touched id is point-read and captured before it contributes to the
  overlay.
- The merge is pure over the captured storage rows and performs no hidden
  database reads.
- Non-buffered queries retain their single-query behavior.
- A regression proves the captured query limit is the actual overfetch and an
  out-of-range touched row still receives its own point dependency.

## Resolution

The buffered path now executes one bounded overfetch, captures that exact
range, reads and captures every touched id, and passes those rows into a pure
overlay merge. The former preliminary query and uncaptured reads are gone.
Changes between these reads are conservatively rejected by the captured query
or point dependency, while stable reads preserve normal read-your-writes
semantics.
