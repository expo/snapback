# LLP 1018 release, cold build, performance and issue reconciliation

Commissioned 2026-09-08: qualify and publish current Snapback 2, run a fresh
Clique build from the published package, recover performance headroom, and
reconcile old issue tickets. This is an N=1 diagnostic, not a formal benchmark
or a new comparative score. The canonical instrument has no rotated probe set;
no O3/O5 qualification is claimed.

## Release

Version 0.0.19 qualification used source `c170e53f9` (equivalent metadata landed
as `c47c44ba3`, with only intervening issue/doc changes). Standard production
publisher dry-run passed on apartment M1 Max, Node24.18.0, Rust1.97.0, in313.6s.
Both todos and chat installed receipts passed with the full Hermes engine;
media was qualified with its required codecs. Exact tarball hashes and
installed consumer steps are in `release-qualification.json`; independent
metadata reviews are LLP1018 release019 Sol and Grok artifacts.

Both immutable artifacts are published and their registry SRI values match the
qualified tarballs. The fresh registry consumer passes every step, including
full-engine todos and chat receipts; see `publication.json`. Initial installs
failed while npm processed the shim and while negative metadata remained cached.
A fresh cache resolved those availability failures; no product or deadline was
changed. The cold builder starts only after this successful registry proof.

## Cold builder plan, fixed before launch

One fresh codex gpt-5.6-sol/xhigh session on apartment M1 Max, using only
npm snapback2@0.0.19, its installed docs/types, and the existing frozen Clique
instrument. No prior app, engineering findings, diary or baseline scores enter
the builder context. Preserve the complete benchmark directory layout; copying
only choreography breaks relative imports. Harness dependencies and actual
headless Chromium readiness are provisioned outside the authoring clock.

Lane: `/Users/ccheever/clique-cold-019-20260908/lanes/sol-snapback2` on the
apartment M1. Only ports53120–53139; explicitly owned PIDs and simulator.
Node24.18.0 and Xcode26.6 are verified; iOS runtimes are available.
Run M1→M2→M3→M4→M5→M6→M8 continuously, preserving failed attempts and correction
clocks, then independent assessment, then fresh-session M7. Native M6/M8
proofs remain separate actual process-kill/recording/receipt obligations.

Retain the existing Astra-medium Convex baseline rather than rerunning it.
Disclose model/host differences and incomplete baseline native/M7 evidence;
compare applicable dimensions only. Neither source integration nor this single
run establishes an overall winner.

The fresh session started at 2026-09-08T06:58:29.447490+00:00 (session
`01a07fcf-a3b8-7761-b378-d22df2d7d8aa`). Its result is pending.

## Other authorized work

Issue reconciliation landed at `12f4ff01b`: four closures, one stale open copy
removed while preserving its existing closed record, and five concrete
remainders retained. No new product execution was claimed by that audit.

Performance landed at `7b6edfee4`. After integrating the separately landed
client-item surface, the full suite passed in 83.921s: 815 Node tests, 865
native passes with four skips, doctests, 225 evaluator cases plus two visibility
checks, and 214 compiler checks. The pinned same-upstream runtime pair is
83,413 → 83,227 gzip bytes (186 saved), with 773 bytes under the independently
adopted 84,000-byte allocation. The 80,000-byte runtime target and 60-second
loop budget remain unmet. Historical 136.48s suite timing used a different
toolchain, so it is not a controlled percentage comparison.

Both independent performance code reviews are READY; the reviewed delta
survived integration unchanged and combined-source checks passed. See
[performance.json](performance.json) and LLP 1018.000 §10. These changes are
on main after the 0.0.19 release; they are not part of that immutable package
or its cold-build result. Raw control and qualification state lives in the
coordinating `.llp/ship-runs/` ledgers.

## Additional exact acceptance witness

The builtin-named table ticket is now resolved on published 0.0.19: all eight
table reads and all seven supported same-named calls pass. The retired
`words()` call gives its documented refusal. See
[builtin-name-witness/RESULTS.md](builtin-name-witness/RESULTS.md).

The frozen grader report schema excludes M8 assertion keys. The diagnostic
assessment will retain those outcomes in a companion record; the concrete
[instrument follow-up](../../../issues/20260908-social-messenger-grader-schema-rejects-m8-assertions.md)
keeps that reporting gap visible without altering this run’s instrument.
