# Snapback 4 binary suite intermittently refuses the witness barrier after owner drop

Status: Open
Date: 2026-10-02
Scope: Snapback 4 test harness / witness store ownership

`verbs::witness::smoke::tests::smoke_barrier_advances_only_the_commit_clock`
sometimes refuses the second barrier after the test's explicit Owner and Store
have left scope: `E_WITNESS_BACKEND: cannot acquire backend store; stop its
owner and check store permissions` at `smoke.rs:313`.

FDL reproduced it twice in five runs of the **unchanged baseline** unit binary
(base 1687b58af2, including CT merge 67191e220d), with soft NOFILE 4096 and hard
1048576. That binary's SHA-256 is
`434da54e2965781bf3583d909c521e24005f37346eb941a6764811ce9d8f7edf`.
It also recurs after the FDL descriptor raise. This is not evidence of EMFILE,
and raising the soft limit does not cure it. The failure's redacted error does
not establish which underlying ownership check failed. Investigate the actual
OS cause and any concurrent fork/exec inheritance before changing ownership
semantics or weakening the refusal assertion.

Evidence and every run: [FDL results](../snapback4/reports/20261002-fdl-fd-limit/RESULTS.md)
and [failure ledger](../snapback4/reports/20261002-fdl-fd-limit/FAILURES.md),
especially `baseline-loaded-4.log` and `baseline-loaded-5.log`. Serial baseline
execution passes. The entire baseline suite returns to three descriptors in
quiet serial intervals; no lasting descriptor leak is established.

Acceptance: preserve refusal while the explicit owner lives and successful
barrier-only commit advancement after it is gone, with repeated concurrent
whole-binary runs and a deterministic regression for the underlying cause.
