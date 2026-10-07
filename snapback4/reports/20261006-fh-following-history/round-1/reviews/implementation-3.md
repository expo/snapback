# Resumed implementation review — lifecycle reservations

Provenance: fresh same-family agent `/root/fh_resume_review`, 2026-10-07.
Read-only inspection after the host reboot; no edits, tests, builds, other
worktrees or hosts. The following is its delivered initial verdict.

Verdict: **APPROVE WITH CHANGES** for the internal bounded-prefix milestone under a settled workload. Read-only source review; I ran no tests or builds.

One remaining implementation change: lifecycle allocation reservations are too small. `cancel()` reserves 512 B before expiry-tree removal/reinsertion; a tree split alone can exceed that. `reclaim()` similarly reserves 1,024 B and clones its first key before admission. Opening also constructs its owned lookup key before preflight.

Use a separate conservative **64 KiB lifecycle scratch** reservation for opening, cancellation and each reclamation record, before owned-key allocation. Keep the retained `SESSION_BASE` quota price unchanged. Add refusal regressions proving insufficient heap leaves registrations, abandonment, expiry and quota unchanged.

The prior custody fixes are present: registered and reclaimed openings, cross-viewer reuse, independent observed-head rewind detection, empty terminal tokens, and registered page sizes 0/101. I found no additional material prefix or replay defect.

**The follow-churn termination decision remains open.** Continuous post-B follows can obstruct discovery in `preparing`; this review does not close that finding or qualify public completeness. Route, shaping and SDK delivery remain explicitly deferred.
