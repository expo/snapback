# Fork diagnostics missing from the reviewed HTTP table (main red gate)

**Status:** Open
**Severity:** P2
**Systems:** Server, Diagnostics, Instance forking
**Date:** 2026-08-06
**Related:** LLP 0158; `src/server.rs` (`s5_d10_production_diagnostic_inventory_cannot_drift`)

## Problem

`cargo test --lib s5_d10_production_diagnostic_inventory_cannot_drift` fails on
current `main` (observed at 8cd50fc8d and at e8bbfa2b2):

```
production diagnostics and the reviewed HTTP table drifted;
unclassified=["SNAPBACK_FORK_APP_BINDING_MISMATCH",
"SNAPBACK_FORK_APP_BINDING_REQUIRED",
"SNAPBACK_FORK_WRITER_COVERAGE_GAP"]; stale=[]
```

Three instance-forking diagnostic codes (LLP 0158 front) were introduced
without classifying them in the reviewed HTTP diagnostic table the S5 D10
gate audits. Found while verifying an unrelated storage fix; failure
reproduces identically on clean checkouts, so this is a standing red gate
for every full-lib run, not an environment artifact.

## Fix shape

Classify the three `SNAPBACK_FORK_*` codes in the reviewed table (owner:
whoever landed the fork boot/binding diagnostics — see `git log` for
`SNAPBACK_FORK_APP_BINDING_REQUIRED`), or record why they are not
production-HTTP-reachable.
