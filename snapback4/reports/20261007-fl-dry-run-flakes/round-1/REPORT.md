# FL round 1 — reject corruption before retrying a moving watermark

2026-10-07. Implements Astra's P1 from `fl-r0.astra.md` against `68c81efbb5`.
All work stayed on eb1000 (`expose-builder-pixel`) in this worktree. No other
worktrees, remote machines, pushes or publications. The custody implementation
and fixture are byte-identical to round 0. Grok's pending review is not claimed
or anticipated here.

## Correction

The review is correct. Round 0 discarded an entire pair whenever `seq`
differed, so a transient difference in another field could disappear on the
next retry. The original negative controls tested corruption and sequence drift
separately, which missed their combination. The old read-test qualification
claim is superseded by this record.

`point_answers_share_watermark` now checks numeric sequences, copies both
answers, removes only `seq` from those copies, and compares the complete
serialized remainder **before** allowing a retry. Any other difference fails
immediately. At equal sequences it also compares the complete, untouched
serialized envelopes, including `seq`. Only that complete comparison lets the
integration test succeed. The existing eight-pair bound, trace evidence
request-ID waits, opt-in behavior and absence of hidden-read evidence remain.
This preserves the pre-existing parsed/reserialized JSON comparison; it makes
no new claim about raw HTTP formatting.

The permanent `point_answer_corruption_is_rejected_even_with_a_moving_sequence`
regression obtains real absent and hidden replies. It checks equal answers,
sequence-only retry eligibility, and all 21 of Astra's corruption cases with
both equal and advanced sequences: every non-sequence top-level field, every
meter field, and added `extraField` and `existence` disclosure fields. The
matrix derives existing fields from the actual envelope, so new fields join it.

No product behavior, custody code, budget or LLP contract changes. The active
constraints remain LLP 3000.015 §2.1 and LLP 3000.031 §1.2: optional probe
miss evidence must not disclose hidden rows. The report and append-only journal
carry this test correction; the governing LLPs need no semantic update.

## Negative controls

[Adapted Astra reproducer](reproduce/retry-masking.py), with its original
hash in [environment.json](evidence/environment.json). Changes to that script
are limited to local evidence paths, the new expected verdict, explicit equal
sequences for the no-drift half, and the existing incremental build setting.
Its first-hidden-reply corruption and 21 field cases are preserved.

- [42/42 corruption runs reject the first pair](evidence/retry-masking-summary.json):
  21 equal-sequence controls and all 21 corruption-plus-sequence-advance controls.
  Exactly one injection marker appears in each failed run: no retry discarded
  the defective pair. This exercises the full original integration test.
- [Sequence-only controls](evidence/retry-controls-summary.json): one advance
  followed by equal answers passes in both trace modes; endless advances fail
  after exactly eight pairs.
- [Regression sensitivity](evidence/regression-downgrade.log): temporarily
  removing only the new non-sequence assertion restores round 0's permissive
  predicate. The new permanent regression fails on corruption with sequence
  drift. Its original source is restored and rebuilt in `finally`.

Expected negative exits are evidence, not suite failures. All mutations affect
only the test source and are absent from the final source and binary. No
mutation or control touches custody or another worktree.

## Verification

- **20/20 complete `dev_refusals` runs under synthetic CPU load:** 22 tests
  each, **440 passed, zero failures or skips**. The full suite includes both the
  original empty-read test and the new mixed-fault regression. Runs took
  6.721–8.417 seconds (median 7.202); the tested source hash stayed
  unchanged, and all four load processes were terminated and reaped.
- **Five export files:** 80 passed, 33 existing platform skips, zero failures,
  cancellations or runner leaks in one run. Background alone: 62 passed and
  32 Darwin skips. Custody remains unchanged.
- **All 42 corruption controls, bounded-retry controls and regression sensitivity
  control behaved as expected**, as detailed above.

- Initial complete `dev_refusals`: 22 passed, including the new regression.
- Developer-evidence unit module: 7 passed; HTTP refusal module: 3 passed.
- Rust witness module, one test thread: 72 passed.
- Five surrounding export files use the normal client-file runner; platform
  skips remain explicit. Linux results do not qualify Darwin execution.
- `git diff --check` and syntax checks for the retained reproduction scripts.
  Custody source equality against `68c81efbb5` is checked independently.

No full publication dry run, wasm rebuild, Darwin execution or new independent
review verdict is claimed. The round-0 report's inherited reference-check error
is outside this test-only change; no new reference-check pass is claimed.

## Reproduce

Run from `snapback4/`, sequentially because the negative controls temporarily
edit and rebuild `dev_refusals.rs`:

```sh
python3 reports/20261007-fl-dry-run-flakes/round-1/reproduce/retry-masking.py
python3 reports/20261007-fl-dry-run-flakes/round-1/reproduce/retry-controls.py
python3 reports/20261007-fl-dry-run-flakes/round-1/reproduce/load.py
```

The load runner uses four directly owned busy-loop processes and confines them,
the full test binary and all its descendants to CPUs 80–81 with `taskset`.
It runs the complete suite 20 times with two test threads, verifies the source
hash stayed unchanged, and terminates and waits for all four load children.
Builds use `LIBSQLITE3_FLAGS=-USQLITE_ENABLE_MEMORY_MANAGEMENT`, six build jobs,
and the ordinary test profile. The [full test outputs](evidence/loaded-runs.log),
[load summary](evidence/loaded-summary.json), [corruption outputs](evidence/retry-masking.log),
and [export suites](evidence/export-suites.log) retain the executed evidence.
