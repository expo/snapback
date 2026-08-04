# 0158: first consumer — fleet fork-per-worktree dogfood (criteria 1+2)

**Opened:** 2026-08-03. **Source:** LLP 0158 §Status graduation criteria
(consumer PINNED by author 2026-08-03). **Depends on:** the F0a tickets
and F0b (the fork verb, which follows a green corpus).

**Resolved:** 2026-08-03. Diary 0054 records a real two-session Todo
fork-per-worktree workflow from one live parent. The sessions carried the same
logical app id and different function bundles, wrote and diffed independently,
and were disposed exactly; a separate post-fix expiry probe proved deterministic
reaping after the workflow exposed a teardown race. The LLP 0081
comparison found additive whole-app development value without weakening or
duplicating migration rehearsal. Dated machine-readable facts are retained in
`tests/acceptance/instance-fork-fleet-dogfood.2026-08-03.v1.json`.

The named first consumer is this repository's own agent fleet:
fork-per-worktree for demo-application development (replaces the
stale-server / shared-dev-database traps documented in the repo's
operational history). When F0b exists, adopt it in at least one real
multi-session demo work stream.

Also fold in criterion 2 (per author direction): during first real use,
compare the fork-based whole-app rehearsal flow against LLP 0081's
restore-derived rehearsal and record whether the fork adds workflow
value (ergonomics, speed, whole-plan coverage) or duplicates the paved
path.

Deliverable: a diary entry (LLP 0016 loop) recording the experience, a
verdict on graduation criteria 1+2, and any guide-gap tickets.

**Dependency update — 2026-08-03, before resolution:** F0a landed green: custody/fidelity,
credential negatives, crash-safe publication/recovery, and fail-loud
deny-all egress were executable substrate. The ticket remained open at that
point because F0b's user-facing fork verb did not yet exist; no synthetic diary
or graduation verdict was recorded in place of the required real multi-session
dogfood.
