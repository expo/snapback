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

Performance is owned by the existing `20260908-loop-and-runtime` lane. Its
reviewed implementation and exact measurements will be integrated separately;
this release does not claim those pending source changes. Raw control and
qualification state lives in the coordinating `.llp/ship-runs/` ledgers.
