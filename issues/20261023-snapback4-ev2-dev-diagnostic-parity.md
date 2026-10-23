# EV-2: residual dev-adoption diagnostic text differences on Postgres

Status: Open
Date: 2026-10-23
Scope: Snapback 4 core, `engine/postgres/column_evolution.rs` (dev adoption diagnostics)
Severity: P3 (refusal text only; codes match on both stores; no data effect)

P1-EV-2 landed after two fix rounds. The final blind review found two
diagnostic-selection differences from SQLite. The refusal codes are the same
on both stores; only the explanatory text names a different constraint.

1. **Multi-cap traversal.** Declare `cap 1 by parent` (with `parent` optional
   and `on delete set null`) and then `cap 2 by bucket`. Store two rows with
   `parent=null, bucket=1`, then tighten only the bucket cap to 1. SQLite's
   dev detail revisits every cap in declaration order with null exemption
   disabled and reports `notes cap by parent`, key `[null]`
   (`store/adopt_refusals.rs` ~354). Postgres runs diagnostics only for the
   violating cap (`column_evolution.rs` ~175, ~229) and reports
   `notes cap by bucket`, key `[1]`. Follow SQLite's applicable-cap traversal.
2. **Maintain-target ordering.** On a dev activation, Postgres sorts
   maintain-target checks together with successor steps
   (`column_evolution.rs` ~104–112). SQLite runs its physical pass only after
   `assess`, in `BTreeMap` order (`store/activation.rs` ~447–450). With two
   failing maintained unique indexes, or a maintained table that sorts before
   an ordinary `E_ADOPT`, the stores name different indexes or return
   different codes. This is reachable only through a faulty recount builder.

Each fix needs a dual-store full-text witness.
