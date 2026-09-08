# Follow-up implementation and verification

Two measured problems have fixes: React startup now passes the real owner URL
to Vite and reports actual connection state; `test --journey "name"` runs an
explicitly selected authored journey. The compiler diagnostic cascade and wrong
type-mismatch rewrite remain assigned to the existing compiler owner, queued
behind active correctness repairs. There is no diagnostic fix or passing
diagnostic result to claim yet.

Product source: `0004ff7f2d7e906b606802faeaeb15da771399d1`, based on
`1936eaddbea3621777c9df9c145f90a7fe92d9db`. The independent review is
[READY](fix-evidence/review.md). This is a source change and a locally packed
candidate, **not a newly published version**. The release coordinator owns
version changes, production/Hermes qualification, and npm publication.
The original [published 0.0.14 measurement](README.md) is retained separately.

Ownership was accepted before product edits: [coordinator reply](fix-evidence/reply.md).
The clean, already-merged named `clique-cli` worktree was reused on branch
`s2/clique-dx`; the shared root checkout and other agents' compiler/native files
were not edited. CLI ownership included the optional `scope.journey` field in
`receipt.rs`. The coordinator explicitly confirmed no overlap with native R2.
A rebase combined two LLP 1002 revision-header entries; product behavior was
unchanged by that conflict resolution. The reviewer inspected the integrated
delta. [Source identity](fix-evidence/source-check-final.json) compares all
935 tracked Snapback 2 files with their [SHA-256 manifest](fix-evidence/candidate-source-sha256-final.json).

## Behavior and measured effect

`init`'s human and JSON next command quotes the project path, installs dependencies,
then starts/attaches the owner and launches Vite with its actual URL. `guide init`
prints the same startup sequence. The generic React template uses `useConnection()`:

```sh
snapback_url=$(npx snapback2 dev) && VITE_SNAPBACK_URL="${snapback_url#SNAPBACK_URL=}" npm run dev
```

A headless Chromium check used the candidate React files and this exact command
against the installed published 0.0.14 backend/SDK, adding only Vite host/port
arguments to reserve port 5188. It connected to owner port 54107 with no failed
requests or page errors. Starting Vite without configuration instead reported
`Backend connection: reconnecting.` and four failed requests to the fallback
3210; it no longer falsely claims a connection. The browser probe includes an
intentional 1.8-second observation window, so its duration is not connection
latency. Both browser/Vite processes and the owned backend were stopped.
[Browser records](fix-evidence/browser-candidate.json).

Named selection is exact; all duplicate matching registrations run. Unknown
names fail and list available names. Backend compilation/certification, module
loading failures, isolated test ownership and per-journey deadlines remain.
Selected failures remain failures, and `scope.journey` is present on early-failure
and successful receipts. Derived checks are omitted. This is manual focused
verification; it does not infer affected coverage or implement `--changed`.
Plain `test` retains the full suite.

On the **same installed Linux candidate**, three serial alternating full/focused
pairs on the unchanged 26-operation chat template produced:

| Scope | Median | Range | Result |
|---|---:|---:|---|
| Full chat verification | 15.900 s | 15.664–15.905 s | 30 checks; 29 pass, effects blocked because this development build omits the engine |
| `--journey "profile ownership, uniqueness, and live public reads"` | 2.337 s | 2.314–2.424 s | selected journey passes, scope recorded |

That is **85.3% less wall time for the selected check**, with less coverage.
It is not an equal-coverage full-suite speedup or a comparison between the Mac
published baseline and Linux candidate. Full tests still cost about 16 seconds;
compilation and full verification latency remain improvement opportunities.
The missing-name control exits 1. [All commands, samples, receipts and installed
tarball/native-byte hashes](fix-evidence/focused-measure.json).

## Verification and limits

- All **52 affected Rust tests pass**: guide 13, init 15, test verb 24.
  The new regression cases prove exact versus prefix selection, duplicate
  names, selected failure, unknown-name refusal, invalid flag combinations,
  compilation failure and a full-suite failure after a focused pass.
  [Complete affected log](fix-evidence/affected-fresh-mtime.log).
- The existing installed-consumer measurement passes every functional step:
  installed public exports, todos/chat init and checks, both React bundles,
  React live query/mutation round trip, todo tests, and owner shutdown.
  Chat is accepted only under the harness's explicit no-engine development
  allowance. It is not a production effects proof.
  [Measurement output](fix-evidence/measure-check.log).
- `measure.mjs --check` remains **red**: installed consumer verification
  32.97 s exceeds 30 s; project check 1.260 s exceeds 1 s. Doctor samples
  0.035/0.033 s, incremental build 2.67 s and init-to-dev 2.53 s pass their
  budgets. No budgets or deadlines changed. The measured record's `sha`
  is the remote snapshot's synthetic Git identity `6249276`; the source
  manifest above binds that snapshot to the reviewed source. The original
  record is preserved rather than relabeled. [Budget follow-up](../../../issues/20260907-snapback2-loop-budget-overruns-in-parallel-papercut-lane.md).
- `ref-check` and `caps` pass. [Reference validation](fix-evidence/ref-check-final.log),
  [size/rule budgets](fix-evidence/caps-final.log). Snapback 1 inventories and
  bootstrap protocols do not apply inside the Snapback 2 fence.

The **first complete `scripts/test.sh` run is red** (source `361d2f423`, before upstream integration), preserved in
[full-tests.log](fix-evidence/full-tests.log): package 513/518 pass; Rust
784/787 pass (4 skipped); evaluator 218/218 plus 2/2 visibility checks;
compiler 402/405 pass. These results are not replaced with an invented full green:

- Four package real-owner failures reproduce on rebuilt baseline `1936eaddb`
  after reversing this entire product patch: one obsolete refusal-text
  expectation and three attempts to drain a descending thread. They are
  non-timing failures, tracked in [their own ticket](../../../issues/20260907-snapback2-real-owner-tests-use-obsolete-drain-contracts.md).
  [Baseline output](fix-evidence/baseline-real-owner.log).
- The jobs queue test took 11.465 s for its idle chunks against 10 s under
  nextest with eight workers. With the same assertion in isolation it took
  8.14 s and passed. That is scheduling-sensitive evidence, not a quantified
  contention penalty. [Isolated output](fix-evidence/jobs-isolated.log).
- A stale offline guide expectation was resolved by already-landed upstream
  documentation changes; the unchanged assertion passes in the final affected run.
- The remote snapshot initially omitted the root video fixture, LLP files and
  Git metadata. These caused one asset failure, three compiler failures, and
  the source-NUL scan failure. Supplying those inputs made the existing checks
  pass: [asset](fix-evidence/assets-isolated.log),
  [compiler support checks](fix-evidence/compiler-support-checks.log),
  [NUL scan](fix-evidence/source-nul-isolated.log).
  These were verification setup mistakes, not product latency.

Other preserved first failures: the expanded testing guide initially exceeded
its 4,096-byte cap by two bytes (final 4,025); a new help test invoked the
nonexistent `guide test` page instead of `test --help`; the initial affected run
lacked the media helper. The reused build machine also had missing extracted
`cc-1.4.4` module files. A private Cargo cache re-extracted the unchanged locked
crate archives and built successfully. After source updates, preserved archive
mtimes initially let Cargo reuse an old guide-test executable; extracting with
fresh mtimes and rebuilding resolved that harness error. All original logs
remain under `fix-evidence/`; none of these waits are charged to the product's
published edit loop. [Step commands and durations](fix-evidence/tail-verification.json).

## Reproduction

Use source `0004ff7f2` in a named warm lane, with root fixtures/LLPs present.
From `snapback2/`, run `bun install --frozen-lockfile`,
`node packages/snapback2/build.mjs`, and
`cargo build -p snapback2 -p snapback2-media`, then:

```sh
cargo test -p snapback2 --test guide --test init --test test_verb --no-fail-fast -- --test-threads 4
scripts/test.sh
node scripts/measure.mjs --check
```

For focused timings, install both locally packed CLI/platform tarballs containing
that source (the run's exact pack/install commands and hashes are in the JSON),
initialize chat with `--client none`, and alternate three runs of each:

```sh
snapback2 test --json
snapback2 test --journey "profile ownership, uniqueness, and live public reads" --json
snapback2 test --journey "absent DX journey" --json
```

The build host was Hetzner450b, Ryzen 5 3600, 12 logical CPUs, 125 GiB RAM,
Linux, Node 24.13.1, Bun 1.3.14, Rust 1.97.0. It was idle at allocation
(load 0.07). Release prewarming finished before the timed consumer pairs;
no Rust build or other dispatched workload overlapped them. Start load averages
in the pairs were 2.37–4.41, including decaying build/test load. This is not an
exclusive-host guarantee. The occupied EPYC scale run was not touched.

## Published type fixes and fresh workflow — 2026-09-07

The coordinated publisher reservation transferred to DX. Frozen source
`7b947aa4d` and its original qualified artifacts are now published as
`snapback2@0.0.18` plus Darwin arm64, with matching public versions, latest tags,
and SRIs. A fresh npm11 install/ci and todos edit → diagnostics → focused/full
tests → verified change passed after retained registry-propagation and app-index
corrections. Installed public/standalone declarations and generated insert/merge
rows pass complete scoped type checks; incompatible boolean-to-number assignments
are rejected. The accepted timeout helper preserves deadline failure separately
from actual child exit, including the initial install’s unknown child exit and
a successful deliberate timeout control. Original timing reds remain.

[Complete release/workflow evidence and reproduction](published-0.0.18/README.md).
