# QX round 0 — first-instinct membership keys and reactions

Date: 2026-09-30. Branch: `sb4-intent/qx-first-instinct-forms`.
Base: `9d03e946232b4017564f3e7c6aa87bd424ce8d58` (0.4.9).
Local implementation only; nothing pushed or published.

## Decision and implementation

Choose **(a), equivalent sugar with explicit limits**. These declarations work:

```quarry
immutable message
read <- exists members[.message.conversation, viewer]
sync to members[.message.conversation]
```

They lower to `read through .message` and `sync`. Messages must declare
`immutable conversation`. The child's reference must already be required,
immutable, without a default, and point to an ordinary application table.
The authored read must spell the whole inherited parent rule. This is a
syntactic sufficient condition, not a general Boolean-equivalence solver.
A third hop works when its intermediate parent already inherits through that
reference. An explicit read-through rule may also name the authored sync path.

This adopts the existing parent lifetime and insert-authority contract, not just
an audience. Parent fields and deadlines are captured once, children cannot
outlive parents, stored children block parent deletion, and references cannot
move to another group. There is no live reference-chain traversal. Captures,
indexes, parent identity, audience, residency, IR, runtime reservations and
meters are identical. The explicit path still passes exact sync admission.
Nullable/mutable links, defaults, unrelated fields, narrower/different rules,
cycles and mismatched audiences remain refused. `E_READ_THROUGH` supplies
schema-specific repair text for invalid paths/rules. Mismatched sync audiences
produce `E_SYNC` (round 1 also adds the schema-specific repair there); choosing a whole-parent repair is an explicit
product choice for a previously narrower child. No automatic `--fix` is added.

The compiler's former blanket server-only upsert site and the engine's matching
blanket refusal are removed. A private parent-pinned missing key uses the existing
parent verdict and independently checked child coverage. A live current parent
plus the child's whole acquired audience group proves absence; a child horizon,
unknown/left/unfinished-rejoin group, provisional or missing parent, capture
mismatch, expired parent or exhausted allowance cannot. Parent horizons are
fine when this parent is held. Public whole-table absence keeps its existing
proof, including complete zero view counts after parent expiry; an actual insert
still checks capture and lifetime. Every secondary unique key and cap group still
needs its own proof. Expiring cap groups keep their insert restriction. Held
children need coverage of every changed constraint population; round 0 omitted
this update check, corrected in round 1. Settlement remains
server-authoritative; refusal restores confirmed rows and replays pending work.

The natural reaction key `(message, viewer)` and `cap 50 by message` therefore
predict their first write and later replacements. Keys omitting the parent can
still have blocked insert arms. `insert ... if absent` retains its existing
child restriction; only that remaining case keeps the explicit branch pattern
on the prediction card. No contract, wire, store format, audience retention,
horizon or resource ceiling changed. No wasm budget increase.

Owners updated: LLP 3000.014 §§2, 5, 9 and LLP 3000.007 §§20.5, 23. Language,
sync and prediction cards document the accepted form, limits and proof.
The original compiled language blocks remain. A new compiled block was added;
repeated prose was shortened to retain the existing 30% word-reduction check,
and four fact-inventory excerpts were updated to their equivalent new wording.

## Calibration reproduction

Read `cal27-evidence/run-log.md` (M4), `diary.md`, `snapback/schema.q` and
`config.q`. The final schema uses read-through and an explicit insert/update
branch; the upsert fixture reconstructs the first-instinct write rather than
claiming that the final file still contains that upsert.

A temporary copy of the final schema replaces only the reactions' read and sync
lines with the original multi-hop intent. With its companion config file:

- Baseline: exit 1, `E_QUARRY_SYNTAX`, `expected "]", got "."`, generic comma repair.
- Fixed: exit 0, no problems.

Evidence: `cal27-{baseline,fixed}-with-config.json`. The first copy omitted
`config.q`; its six missing-helper/view diagnostics are retained in
`cal27-fixed-check.json` and attributed to this harness setup, not the product.

## Equivalence and prediction evidence

- 24 generated schema pairs: two/three hops × two retention policies ×
  whole/horizon child sync × three audience-column names. Full serialized
  schemas (including residency) and operation IR are equal. A separate test
  combines explicit read-through with an authored three-hop sync path.
- Eight CLI pairs compare `check --residency --verbose` output from equivalent
  fresh projects, excluding only elapsed milliseconds. This includes the
  notes, prediction classification and sync facts, not just the runtime schema.
- 16 generated schema/schedule pairs per store × 32 membership transitions,
  on both memory and SQLite: **1,024 transitions**. Every transition also
  performs a reaction upsert. Paged snapshots, held groups, acquisition data,
  sync events, server queries, device queries, withdrawals/retained history,
  write results and every server meter field match. A captured ancestor move
  is refused in both variants. Six parent pages are queried after every step.
- Nullable child references, missing immutability on the child or ancestor,
  extra child predicates, unknown rule fields and unknown sync fields get
  targeted diagnostics. Tests compile the suggested declaration repairs.
- Rust prediction tests run on both stores and both two/three-hop chains and
  retention policies: unacquired and missing-parent writes queue; acquired
  inserts and updates predict; rejected updates restore the previous overlay;
  rejected inserts restore the confirmed image; departure and child horizons
  prevent insert prediction.
- Six actual-device tests run the social starter on wasm and process devices.
  Each proves the held-parent/whole-child case, a child horizon, and a held
  parent with an unfinished child rejoin. The covered case predicts both arms,
  then the server revokes membership while sync is withheld and refuses the
  submitted write; settlement removes the predicted row.
- Negative control: rebuilt original wasm and saved original process binary
  fail the two prediction cases and pass the four coverage controls. Fixed
  devices pass **6/6**. The two intentional baseline failures are retained in
  `negative-baseline-device-tiers.log`, exit 1.

The schema equality is the implementation argument: sugar introduces no runtime
mechanism. Generated executions independently check the delivery, answer,
withdrawal and cost consequences. This is executable differential evidence,
not a claim to exhaustive model checking over all Quarry programs.

## Reaction visibility

The retained `tools/measure.mjs` and `tools/page.jsx` adapt LL's actual Chromium
React publication measurement and process-device setup. `tools/fixture.q` is
the repository social starter plus read-through reactions, the natural-key
upsert, a read and a reset mutation. Twenty insert/replace/reset trials per
phase and tier; no samples excluded, no injected network delay or load.

The web tier runs the browser client over real wasm/IndexedDB. The process tier
runs the Node client over `processDevice`; its observations are forwarded into
Chromium React. Both measure writer invocation to the matching React layout
effect using Chromium `performance.now()`. The process measurement includes
the browser/Node bridge. The same path is used before and after in each tier.
The attempted browser-owned process mutation lacked a browser admission journal;
that failed harness probe is preserved, then the proper Node owner is used for
both process measurement phases.

| Tier / arm | Baseline render p50 / p95 (ms) | Final render p50 / p95 (ms) | Baseline pending at first render | Final pending at first render |
|---|---:|---:|---:|---:|
| Web insert | 29.65 / 33.80 | 3.60 / 5.10 | 0/20 | 20/20 |
| Web update | 28.80 / 31.70 | 3.40 / 4.30 | 0/20 | 20/20 |
| Process insert | 35.55 / 73.00 | 8.95 / 10.30 | 0/20 | 20/20 |
| Process update | 35.90 / 49.60 | 7.30 / 8.10 | 0/20 | 20/20 |

All 80 final samples render before the mutation returns sent. Raw observer,
React and request events, every sample, environment, browser version and CPU
are in `{baseline,final}-{wasm,process}.json`; publication, render and mutation
return distributions are in `latency-summary.json`. p95 is nearest-rank over
20 samples. The baseline and final groups ran sequentially on the shared host.
`fixed-*` retains the earlier pre-correction measurement; it is not substituted
for the final samples. The final process median is higher than that earlier
measurement (insert 5.10 ms, update 4.20 ms); host load and run order were not
controlled. The raw records retain load averages. `tools/summarize.py` reproduces
the summary without discarding samples.
This measures the writer's optimistic screen on localhost. It neither
reproduces nor claims to eliminate LL's 4.7–8.1-second remote-reader result.
Server commit and remote acquisition performance are outside this change.

## Checks and artifact size

Affected language/engine tests: **114 passed**. Affected device tests:
**40 passed** before the full run. After its correction, **104/104**
(first-instinct, read-through, readauth and row-view expiry), **31/31** ordinary
upsert proof cases and **27/27** related coverage cases pass. Final first-paste
CLI subset: **7/7**, including eight residency pairs. Actual wasm/process device
cases: **6/6**. Whole guide: **105/105**. Compatibility record: **1/1**; only the
specific changed upsert residency site, verdict and emitted prediction strings
are normalized against the frozen baseline. Path tests: **3/3**.

`ref-check --verbose`: 525 LLP documents, 9,992 references, zero errors or
unchecked references, including the final journal and documentation changes.
The source manifest captured at full-suite launch is `full-suite-inputs.json`.

Ran `bash scripts/test.sh` **once**, exit **1**, exact summary:

```text
== 1 failure(s) in 1369 s
   cargo test
```

Rust: **4,368 passed, 3 failed, 33 ignored**. Client pool: **5,314 passed,
0 failed, 10 skipped**. Serial models: **79 passed, 0 failed**. Fixture
wrappers: **9 passed**. Build, wasm, docs budget, release guard, package checks
and app checks pass. All three failed tests are **ours**, now corrected:

1. `snapback4-device::readauth::census::authoring_census`: the new language
   example adds two census entries. Updated after reviewing its private write
   against the new device lifecycle cases; final readauth target **81/81**.
2. `snapback4-device::row_view_expiry::inherited_expiry_replay_memory`:
   the new parent proof incorrectly intercepted public whole-table coverage
   after parent expiry. An isolated checkout of the original commit passed.
   Keep uniformly readable rules on their existing absence-proof path.
3. `snapback4-device::row_view_expiry::inherited_expiry_replay_sqlite`:
   the same regression. Final whole expiry target **10/10**.

**Baseline failures: 0. Environmental failures: 0.** The original full run
remains red. After its Rust stage, the correction, census and guide fact-home
updates received the affected checks above; final native/wasm artifacts were
rebuilt after the client pool finished. All six actual-device cases and the
measurements then ran again. `final-source.json` records the final source and
lists changed recorded files since full-run launch. The launch manifest omitted
then-untracked additions due to a path-normalization mistake; their final hashes
are listed separately, and their actual full-run test results are retained. This
is not an unchanged-source full-suite pass. `FAILURES.md` also preserves every detecting/superseded test and harness
failure. The serial models' expected E_AUTH fault messages are not test failures.

Pinned Rust 1.97.0, wasm-bindgen 0.2.127, Binaryen 132.0.0:

| Artifact | Raw bytes | Gzip bytes |
|---|---:|---:|
| Rebuilt original | 1,978,828 | 593,225 |
| Full-run artifact before expiry correction | 1,979,463 | 593,635 |
| Final | 1,979,433 | 593,524 |
| Final delta from original | +605 | +299 |

The unchanged cap is **593,719 B**, leaving **195 B**. Baseline reproduction
matches its first build exactly. Full logs retain optimizer output;
`artifact-hashes.json` and `baseline-wasm-sha256.txt` identify final and original
artifacts. `artifact-hashes-during-earlier-build.json` preserves an earlier
audit taken during a rebuild; its source wasm entry is an intermediate
unoptimized artifact, not the qualification or measured web artifact.
Compiler sugar is outside the web device; the measured increase is the shared
runtime absence proof using the existing parent resolver. This is a whole
artifact delta, not symbol-level attribution. No ceilings or budget ratchet moved.

All detecting and superseded failures, including setup errors, are enumerated
in `FAILURES.md`; they are not silently replaced by final successful runs.
