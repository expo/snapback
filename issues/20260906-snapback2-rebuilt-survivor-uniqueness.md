# Snapback2 rebuilt-table survivors can escape newly unique index admission

Status: Open
Date: 2026-09-06
Scope: Snapback2 successor admission; LLP 1001 §4
Evidence level: precise static review trigger; runtime reproduction not yet performed

Fresh Astra review of `ed5c42db76ce87577896db9dddfd6cc8f4368b2d` identifies an inherited gap: ordinary unique-index admission skips rebuilt tables, while per-step rebuild uniqueness iterates only projected rows. Surviving ordinary rows can therefore escape a newly added unique index. The ordering fix itself is supported by its existing native/public evidence.

The reviewed three-generation trigger starts with ordinary aTotals rows legacy-a/group aa/value9 and legacy-b/group bb/value9, unique byGroup, an event group valid, and empty zTotals. A second generation maintains aTotals=count events by group; both ordinary rows survive alongside the projection. A third retires aTotals to ordinary, widens group to text2..2000, adds unique byValue, and maintains zTotals=count aTotals by group. Each generation respects maintained-target/source separation. Rebuilding aTotals removes its old projection and retains both value9 rows; its new projection is empty, so projection-only uniqueness finds nothing. Index-entry identity includes row ID and does not itself reject duplicate logical keys. This is the reviewer's static conclusion, not an observed runtime installation.

Expected behavior: E_SUCCESSOR_UNIQUE and unchanged generation, sequence, rows and indexes for additive install, exact mixed-drop migration and changed-schema reopening. The repair should validate selected/new unique indexes over actual surviving rows plus the same computed projection used by mutation, excluding exactly replaced/deleted IDs. Verify survivor/survivor and survivor/projected collisions, lawful replacement removal of old collisions, and supported tuple/optional-key semantics without adding unrelated historical-field revalidation.

Full independent reviews and provenance: [review evidence](../benchmarks/runs/2026-09-06-clique-improvement/evidence/successor-uniqueness-review/README.md). Grok READY covers the ordering repair and lists related inherited concerns; it is not contrary runtime evidence for this trigger.

The requested same-session Astra xhigh reproduction/repair was rejected by the provider with a cybersecurity-risk flag at2026-09-06T21:21:24Z, before any tools. It exited1 after27.5756s; the isolated uniqueness worktree remains clean ated5. No runtime proof, code fix or model-switch retry resulted. The exact provider receipt is retained. This blocked attempt does not close the issue or qualify combined97fa for landing/publication. Independent release/compiler/offline work continues.
