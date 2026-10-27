# LAT3 proof execution startup

Scope: `snapback4/proof` imports, native proof command dispatch, and execution
measurements of copied app-farm scripts. Product changes are in `0f8f0a206f`,
`f14c2ba98e` and `707f09a0f8`. Package versions remain 0.4.44.

The orientation context is LLP 3000.011.003.000.000 §§1, 4, 5, 8, 16–18
(proof identity, keeper custody, browser assertions, native dispatch),
LLP 3000.000.000.001 §§1–2, 4 (real staging accounts and fresh store boundary),
and LLP 0189's Snapback 4 affected-selection contract. These amendments are
implemented; their current source and guide/testing and guide/staging pages
govern, rather than legacy demo recipes. No broken in-scope @ref was found.
Witness-engine reuse, serve lifetime, release semantics and day-two helper/API
changes remain outside this workstream.

`replay.py` copies original waves 30–34 sources and store bytes into
`/tmp/lat3/`, excluding every store owner/token sidecar and dependency tree.
Original stores are never opened. Dependencies are installed only in copies;
baseline platform/client/Expo inputs are the retained Integration28 0.4.44
tarballs. The candidate overlays this worktree's built client JS. Each lane's
before/after copies begin with independent identical copied bytes. Pair order
alternates across lanes; the same worker executes each pair in one window.
The readiness/calls driver keeps credentials in private scratch files. There
is no change to an original lane or its business assertions.

Run each worker in a separate `systemd-run --user --scope -q -p MemoryMax=40G
-p OOMPolicy=continue` scope, with at most four top-level workers total:

```sh
python3 snapback4/reports/20261027-lat3/replay.py --worker 0 --workers 4
```

Raw task-local logs/receipts are under `/tmp/lat3/` while running. The final
workstream report records actual completed coverage, mismatches, timing
distributions, excluded setup attempts and deferrals. An unchanged pass/fail
result is distinguished from a successful app proof. Source paths, random
identities and stack locations are not failure-message differences; raw logs
remain separate from any normalized comparison.

`verify.mjs` retains the selector's complete plan, then replaces its conservative
449-file client closure with the named proof/browser/accounts/starter and
dispatch consumers required by this change. It retains root checks, guide
tests and builds. This disclosed override follows the brief's explicit ban on
the whole client pool and is not publication qualification. `consumers.mjs`
runs the four actual publication consumer entry points from installed tarballs;
it does not publish or claim a complete publication receipt.

Independent reviews and their exact prompts/transcripts are under
`llp/reviews/3000.011.003.000.000-lat3-*`. Round 1 includes the Codex NOT READY
findings; both round-2 reviews are READY after those fixes. The Muse round-2
response contains a model-authored placeholder hyperlink for a commit; the
verbatim response is preserved, and the actual source commit is recorded in
its provenance header.
