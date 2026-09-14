# Muse independent grade

**Status: received grade complete; structurally validated.** The independent
grader ran from `2026-09-14T07:18:36Z` through `2026-09-14T07:57:08Z`, exited
0, and recorded 2,312.379 seconds of wall time. Public stream metadata names
`claude-opus-5` under Claude Code 2.1.270, and all 251 assistant-message model
fields agree. This is an uncalibrated N=1 grade (`calibrationPassed: false`),
so it is not claim-eligible.

The received files are preserved byte-for-byte. The external validator passed
the frozen schema and exact 119-ID partition checks.

| Partition | Pass | Fail | Not run | Not applicable |
| --- | ---: | ---: | ---: | ---: |
| Prior comparable 101 IDs | 79 | 13 | 8 | 1 |
| M8 supplemental 18 IDs | 15 | 3 | 0 | 0 |
| Complete 119 IDs | 94 | 16 | 8 | 1 |

The received dimensions are O1 30, O2 40, O3 null, O4 null, and O5 band 0.
M7 is reserved for a later fresh session. See
[`grader-report.json`](./grader-report.json),
[`m8-assertion-results.json`](./m8-assertion-results.json), and
[`validation.json`](./validation.json).

## Coverage adjudication

The raw 94/119 pass count and O1's 34/119 credited count answer different
questions. The lane has no coverage manifest. The received spot verification
marks M2, M3, M6, and M8 dishonest under the frozen mechanical rule:

- M2's thread-order check runs before any reply exists.
- M3's quote-jump check counts bubbles without observing the jump.
- M6's custom-client demo fetches one history page without a cursor, and the
  suite does not run the sample-50 replay.
- M8's `m8-a06` and `m8-a07` labels cover multi-device and offline behavior,
  rather than the declared Trending observables.

O1 therefore credits the 13 M1, 12 M4, and 9 M5 passes. The received score and
all assertion results remain unchanged.

## Choreography method

The frozen grader prompt directs independent web and API checklist execution,
while the report schema describes all `[choreo]` assertions as receipt-only
and says the grader never re-drives them. The lane supplied no original
choreography receipts. Public tool arguments show two attempts to launch a
fresh copy of the frozen web harness. The retained attempt ended fatal before
emitting a receipt: both choreography JSONL files are empty.

The grader then ran grader-authored browser automation for M1, M2, M3, M4, M5,
and M8. Of the 39 `[choreo]` assertions, 28 use `web-automation`; they contain
27 passes and one failure. The other 11 use `choreography-artifacts` for nine
failures and two not-runs. This is consistent with the prompt's web execution
wording and inconsistent with the schema's broader receipt-only instruction.
It is a methodology qualification, not excluded-context contamination or an
automatic invalidation of the whole grade. O4 is null because M6 is not green,
so no O4 score relies on these fresh web runs.

## M3 typing timing

The provisional M3 artifact reports 1/1/0 ms and describes first-keystroke
latency, but its tool waits for all 12 characters at 60 ms each before polling
and stores only the post-typing polling duration. The final report does not use
those measurements. Its targeted recheck starts the peer visibility watcher,
records time immediately before one keypress, awaits visibility, and records
23/25/22 ms before typing the remaining characters. The final report and trace
cite this corrected evidence, so this archive records the provisional-method
error without changing the received pass verdict.

## Access, source, pins, and citations

The final public-tool-argument audit found no explicit content read of the
excluded builder diary, essay, final report, run log, another lane, or a prior
run. An initial lane-root listing could expose the excluded filenames, but no
subsequent command reads their contents. A packet-root search explicitly
filters `/lanes/`. The grader read the public Snapback README and package
metadata and listed the package `dist` directory; it did not read package
implementation files.

The grader did read a worker-token file through a redacting filter and copied
runtime SQLite state into its isolated work area. Those bytes, the raw CLI
stream, credential-bearing evidence, and runtime databases remain external.

All 195 files in the canonical builder source inventory still match the lane.
All 34 files in the repository builder archive match their named source and
destination hashes. The 16 non-dependency files in the isolated choreography
copy match the frozen instrument. The current 177-file instrument remains
read-only. Builder and grading metadata resolve Snapback 4 `0.2.6` and Expo
`0.2.1`.

All 44 distinct explicit evidence paths in 309 report references resolve, and
the cited source line ranges are within their files. The citation to
`app/post/[id].tsx` uses literal brackets and resolves as a literal path.
M1 password-hash evidence includes a runtime SQLite database, which remains
external. M6 and M8 native results accurately point to the empty original
receipt directory.

## Builder lifecycle qualification

The builder lifecycle remains an actual exit 130 after three public terminal
completion events and a recorded background-session continuation loop. The
hash-bound continuation helper admitted only that recorded builder tuple into
scoring, grading, and M7. The independent grade has its own genuine exit-0
lifecycle; neither lifecycle is rewritten. The credential-bearing override
start remains external by hash, while the override end, builder lifecycle,
intervention receipt, post-terminal audit, and helper verification are copied
here.

[`grader-access-source-custody-final.json`](./grader-access-source-custody-final.json)
contains the public event hashes, method analysis, assertion partition,
timing audit, source comparisons, pin checks, citation checks, and builder
qualification. [`COPIED_FILES.json`](./COPIED_FILES.json) records the 14
verbatim copies. [`external-evidence-references.json`](./external-evidence-references.json)
retains hashes for 113 selected grader evidence files, tools, logs, harness
records, cited source, runtime databases, and raw CLI custody without copying
their contents into the repository.
