# LAT3 proof execution startup

Scope: `snapback4/proof` imports, native proof command dispatch, and execution
measurements of copied app-farm scripts. Product changes start at `0f8f0a206f`
and include the reviewed error/deadline fixes through `eb80c8c7b3`.
Package versions remain 0.4.44.

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
tarballs. The candidate overlays the frozen measured client archive (the
recorded SHA256 is enforced). `LAT3_FROZEN_CLIENT_TARBALL` can locate that
archive elsewhere; a later build of main cannot silently replace its bytes.
Each lane's
before/after copies begin with independent identical copied bytes. Pair order
alternates across lanes; the same worker executes each pair in one window.
The readiness/calls driver keeps credentials in private scratch files. There
is no change to an original lane or its business assertions.

Run each worker in a separate `systemd-run --user --scope -q -p MemoryMax=40G
-p OOMPolicy=continue` scope, with at most four top-level workers total:

```sh
python3 snapback4/reports/20261027-lat3/replay.py --worker 0 --workers 4
```

Outcome reuse through `--resume` is disabled. Fresh explicit revisions execute
the complete ordered lane; `--cases-file` selects a declared source census.
The final-input replay manifest refreshes every earlier row missing the final
installed-package digest. Input/output package hashes are checked for every
final row; revisions are selected by declared input correction, never speed.
Known original-range and TMPDIR preconditions are recorded in the workstream
report, along with initial mismatches and the actual diagnostic repeats.

Raw task-local logs/receipts are under `/tmp/lat3/` while running. The final
workstream report records actual completed coverage, mismatches, timing
distributions, excluded setup attempts and deferrals. An unchanged pass/fail
result is distinguished from a successful app proof. Comparison removes Node
warnings, the independent copy roots and explicit generated selector/run/log
identities, and the authored random Wurlitzer/Proof Contact/Proof Board fixture
labels. It preserves operative errors, assertions, deadlines and app call
sites. Raw logs remain private and separate from the normalized comparison.

`verify.mjs` retains the selector's complete plan, then replaces its conservative
449-file client closure and seven-whole-Rust-crate expansion with the named
proof/browser/accounts/starter and dispatch consumers and actual language guide
target required by this change. It retains Snapback 4 guide tests, selector tests,
docs checks, builds and root ref-check. Legacy Snapback 1 guide/generated/
diagnostic inventories have unchanged inputs and are omitted under the explicit
fence, as in SEC11L's scoped runner. Every omission is recorded. This disclosed
override follows the brief's explicit ban on the whole client pool and is not
publication qualification. `consumers.mjs`
runs the four actual publication consumer entry points from installed tarballs;
it does not publish or claim a complete publication receipt.

Independent reviews and their exact prompts/transcripts are under
`llp/reviews/3000.011.003.000.000-lat3-*`. Rounds 1 and 3 include Codex NOT READY
findings; both round-4 reviews are READY on the final runtime. The Muse round-2
response contains a model-authored placeholder hyperlink for a commit; the
verbatim response is preserved, and the actual source commit is recorded in
its provenance header.

`export.py` requires the complete script census and matching identity results,
then writes only numerical measurements and hashes into the retained report.
It rejects setup errors, unclassified verdict/message differences, installed
client mutations and native trace parse failures. Raw app logs and credentials
are never copied into the repository. The `.json` receipts distinguish complete
corpus coverage from the subset recording input digests and native telemetry.
