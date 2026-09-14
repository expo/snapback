# Grok independent grade

**Status: received grade complete; structurally validated.** The foreground
grader ran from `2026-09-14T06:31:10Z` through `2026-09-14T07:17:44Z`, exited
0, and recorded 2,793.393 seconds of wall time. Public log metadata names
`claude-opus-5` under Claude Code 2.1.270; all 212 assistant-message model
fields agree. This is a cross-family but uncalibrated N=1 grade
(`calibrationPassed: false`), so it is not claim-eligible.

The received files are preserved byte-for-byte. The external validator passed
the frozen schema and exact 119-ID partition checks. The raw assertion totals
are:

| Partition | Pass | Fail | Not run |
| --- | ---: | ---: | ---: |
| Prior comparable 101 IDs | 60 | 17 | 24 |
| M8 supplemental 18 IDs | 10 | 1 | 7 |
| Complete 119 IDs | 70 | 18 | 31 |

The reported outcome dimensions are O1 10 and O2 25. O3 is null because M6
is not green, O4 is consequently null, and O5 is null because no qualifying
scale-replay receipt exists. The wave has no committed holdout probe set, so
the report contains no holdout results. M7 is reserved for a later fresh
session and its nine assertions are not run. See
[`grader-report.json`](./grader-report.json),
[`m8-assertion-results.json`](./m8-assertion-results.json), and
[`validation.json`](./validation.json).

## Coverage adjudication and O1

O1’s “12 of 119” is a scoring adjudication, not the raw assertion subtotal.
The frozen grader rule makes a dishonest coverage mapping a scoring-only
`capability-failure` and counts that milestone’s checklist as not passed in
O1. The grader applied that rule to M2, M3, M4, M5, M6, and M8; M7 was not
run. Only M1 therefore contributed its 12 passes to O1.

The six milestone findings have concrete support in the unchanged
`scripts/acceptance.mjs`:

- M2 includes sampled `assert(true)` and `assert(own || true)` mappings and
  sampled tests that check only a truthy payload, URL text, an array, or page
  length instead of the declared observable.
- M3 maps quote-jump to `assert(true)` and its idempotency check replays only
  the M1 fixture before comparing inbox lengths.
- M4’s edited-label mapping ends with `assert(msg?.editedAt || true)`.
- M5 maps second-view behavior to `assert(true)` and in-chat UI search to an
  API-only query.
- M6 has three sampled unconditional `assert(true)` mappings.
- M8 checks only `Array.isArray` for Trending and maps two assertions to
  `assert(true)`.

The audit preserves both views: the received files contain 70 pass, 18 fail,
and 31 not-run results, while O1=10 credits only M1 after the frozen coverage
adjudication. It does not recompute or repair the score.

## Choreography method

The frozen prompt directs independent web and API checklist execution while
the report schema describes every `[choreo]` check as receipt-only. Unlike the
Astra grade, this session did not exercise that scope tension. Public tool
arguments show that the grader copied and installed the harness, read and
grepped its source, and read the original M1–M3 receipts. No command invoked
`choreography.mjs`; independent checks used separate grader-authored web and
API scripts.

Across all 119 IDs, 39 results use `choreography-artifacts`: 9 pass, 6 fail,
and 24 are not run. Fifteen pass/fail results rely on the original M1–M3
builder receipts. The not-runs cover the M2 follower count that its receipt did
not observe, absent M4/M5/M8 receipts, absent M6/M8 native proof, and M7. O4
remains null because M6 is not green.

## Scale-attempt qualification

The received notes describe scale as “never attempted” because there is no
replay receipt. The separately curated continuous-builder archive establishes
a narrower fact: the builder started a real replay, ran it for 233 seconds
under registration rate limiting, and stopped before completion without an
invariant verification or qualifying result. The grader did not access those
builder narratives. O5 remains null; the accurate orchestration distinction is
“no qualifying replay receipt,” rather than “no execution attempt.” The audit
binds the existing Grok README, run log, and timing audit by hash.

## Access, source, pins, and citations

The final public-tool-argument audit found no explicit access to the excluded
builder diary, essay, final report, run log, another lane, or a prior run. The
only forbidden-filename marker occurs while the grader writes its own trace;
it is not a read. Private reasoning bodies were not inspected.

All 228 canonical source-inventory files still match the original lane, all
four excluded builder reports match the canonical snapshot, and all 50 files
in the repository’s builder archive match their named source and destination
bytes, including 28 original receipts. In the isolated grading work tree, 118
copied source/config files match the snapshot. The ten changed common files
are generated grading state: the push log, one coverage receipt, seven suite
receipts, and suite status. The original manifest, lockfile, and installed
packages pin Snapback 4 `0.2.6` and Expo `0.2.1`; the work copy omits the
lockfile but its manifest and installed metadata match the same pins.

Two received citations need qualification. Defect `d-02` cites
`app/profile/edit.tsx:563`, but that file has 87 lines. The behavior is also
supported by its retained web evidence and other source citations. `m8-a01`
names `grading/insights-baseline` without the `.mjs` extension and points to a
script rather than a standalone result receipt; the counts are embedded in the
assertion note and trace. The report bytes remain unchanged.

Full event hashes, instruction lines, assertion mapping, source comparisons,
pin observations, coverage support, scale context, and citation checks are in
[`grader-access-source-custody-final.json`](./grader-access-source-custody-final.json).
[`COPIED_FILES.json`](./COPIED_FILES.json) records the eight verbatim copies.
[`external-evidence-references.json`](./external-evidence-references.json)
retains hashes for 99 selected grader evidence files, screenshots, receipts,
scripts, suite/runtime logs, and raw CLI custody without copying their contents
into the repository.
