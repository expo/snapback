# Snapback2 rebuilt-table survivors can escape newly unique index admission

Status: Resolved — 2026-09-07
Date: 2026-09-06
Scope: Snapback2 successor admission; LLP 1001 §4
Evidence level: native current-main reproduction and regression controls; historical review below

Fresh Astra review of `ed5c42db76ce87577896db9dddfd6cc8f4368b2d` identifies an inherited gap: ordinary unique-index admission skips rebuilt tables, while per-step rebuild uniqueness iterates only projected rows. Surviving ordinary rows can therefore escape a newly added unique index. The ordering fix itself is supported by its existing native/public evidence.

The reviewed three-generation trigger starts with ordinary aTotals rows legacy-a/group aa/value9 and legacy-b/group bb/value9, unique byGroup, an event group valid, and empty zTotals. A second generation maintains aTotals=count events by group; both ordinary rows survive alongside the projection. A third retires aTotals to ordinary, widens group to text2..2000, adds unique byValue, and maintains zTotals=count aTotals by group. Each generation respects maintained-target/source separation. Rebuilding aTotals removes its old projection and retains both value9 rows; its new projection is empty, so projection-only uniqueness finds nothing. Index-entry identity includes row ID and does not itself reject duplicate logical keys. This is the reviewer's static conclusion, not an observed runtime installation.

Expected behavior: E_SUCCESSOR_UNIQUE and unchanged generation, sequence, rows and indexes for additive install, exact mixed-drop migration and changed-schema reopening. The repair should validate selected/new unique indexes over actual surviving rows plus the same computed projection used by mutation, excluding exactly replaced/deleted IDs. Verify survivor/survivor and survivor/projected collisions, lawful replacement removal of old collisions, and supported tuple/optional-key semantics without adding unrelated historical-field revalidation.

Full independent reviews and provenance: [review evidence](../../benchmarks/runs/2026-09-06-clique-improvement/evidence/successor-uniqueness-review/README.md). Grok READY covers the ordering repair and lists related inherited concerns; it is not contrary runtime evidence for this trigger.

The requested same-session Astra xhigh reproduction/repair was rejected by the provider with a cybersecurity-risk flag at2026-09-06T21:21:24Z, before any tools. It exited1 after27.5756s; the isolated uniqueness worktree remains clean ated5. No runtime proof, code fix or model-switch retry resulted. The exact provider receipt is retained. This blocked attempt does not close the issue or qualify combined97fa for landing/publication. Independent release/compiler/offline work continues.


## Resolution — 2026-09-07

Reproduced on main source `22427817e` through the public Rust `Runtime` API:
ordinary `totals` rows `legacy-a/group aa/value9` and `legacy-b/group bb/value9`
survive installing a count maintain. Retiring the maintain while adding unique
`byValue` incorrectly returned a successful `SuccessorReport`. This is the
same survivor-uniqueness gap, reduced to omit the separate text-widening change
from the historical candidate. Its three unpublished widening/ordering commits
remain preserved on their old branch; this repair does not land them.

The check now runs immediately before each target rebuild, within the existing
transaction. It checks surviving rows plus the exact next projection being
installed, excluding only the union of predecessor/successor-owned IDs. It sees
prior rebuilds and post-drop rows, while migration retains the predecessor IDs
computed before drops. No unique index means no added target scan. Native
installation and reopening preserve the typed `E_SUCCESSOR_UNIQUE` refusal
rather than wrapping it as a generic store failure.

Regression cases in existing `tests/successor_maintains.rs` cover:

- Survivor/survivor refusal through additive install, exact mixed-drop migration,
  and changed-schema reopening; generation, sequence, rows, indexes, and every
  other durable table remain unchanged. Snapshot comparison excludes only the
  `Store::open` lock-owner stamp, which legitimately changes before admission.
- Survivor/projected collisions with a typed conflict key; optional compound
  keys treat omitted and explicit null equally; reports cap at ten distinct keys.
- Valid replacement of an ordinary row by the next projection at the same ID,
  removal of conflicting predecessor projections, and source deletion with
  pre-drop ownership preserved.
- A later target's uniqueness uses the projection after an earlier target is
  retired, avoiding a stale precomputed conflict.

The original failing reproduction and the first snapshot assertion failure
(the changing owner stamp), followed by the passing controls, are retained in
`/Users/ccheever/projects/snapback/.llp/ship-runs/survivor-uniqueness-*.log`.
All 420 core nextest tests passed (one pre-existing skipped test), including
the 12 maintained-successor tests. Independent read-only review returned READY with no material findings; it did
not independently rerun tests. This is an engine correctness repair, not a
published-package, full M7, or old candidate qualification claim.
