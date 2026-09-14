# Astra independent grade

**Status: received grade complete; structurally validated.** The foreground
grader ran from `2026-09-14T05:47:44Z` through `2026-09-14T06:30:41Z`, exited
0, and recorded 2,576.906 seconds of wall time. The public log metadata names
`claude-opus-5` under Claude Code 2.1.270; all 216 assistant-message model
fields agree. This is an uncalibrated N=1 grade (`calibrationPassed: false`),
so it is not claim-eligible.

The received files are preserved byte-for-byte. The external validator passed
the frozen schema and exact 119-ID partition checks. The totals are:

| Partition | Pass | Fail | Not run |
| --- | ---: | ---: | ---: |
| Prior comparable 101 IDs | 84 | 8 | 9 |
| M8 supplemental 18 IDs | 16 | 2 | 0 |
| Complete 119 IDs | 100 | 10 | 9 |

The reported outcome dimensions are O1 74, O2 76, O3 null, O4 35, and O5
band 30. O3 is null because this wave has no committed holdout probe set. M7
was reserved for a later fresh session and its nine assertions are not run.
See [`grader-report.json`](./grader-report.json),
[`m8-assertion-results.json`](./m8-assertion-results.json), and
[`validation.json`](./validation.json).

## Choreography-method qualification

The frozen instructions have a scope tension. `grader-prompt.md` execution
order step 3 directs independent web and custom-API checklist re-execution,
including best-of-three timing, while its explicit no-rerun rule names native
and simulator proofs. The same prompt says retained choreography artifacts are
the only basis for O4. Separately,
`grader-report.schema.json` line 171 describes every `[choreo]` check as
receipt-only and says the grader never re-drives it.

The grader publicly executed the web choreography harness for M1 through M6
and M8, including M3 and M5 retries, in its isolated checkout. This is
consistent with the prompt's web re-execution step and inconsistent with the
schema's broader receipt-only method description. It is recorded as a
methodology qualification; the received grade is not repaired or declared
wholly invalid.

Thirty-five scored pass/fail assertions use those new grader-run receipts as
their primary `choreography-artifacts` method:

- M1: `m1-a05`, `m1-a06`, `m1-a09`
- M2: `m2-a04`, `m2-a05`, `m2-a14`, `m2-a19`
- M3: `m3-a01`, `m3-a02`, `m3-a06`, `m3-a07`, `m3-a08`, `m3-a09`,
  `m3-a12`, `m3-a13`
- M4: `m4-a02`, `m4-a04`, `m4-a05`, `m4-a08`, `m4-a11`
- M5: `m5-a07`
- M6: `m6-a01` through `m6-a07`
- M8: `m8-a02`, `m8-a13` through `m8-a18`

Of those 35, 26 pass and 9 fail. `m5-a12` is one additional mixed case: its
`web-automation` result combines new M5 receipts with independent latency and
expiry evidence. The two M7 choreography-method results, `m7-a02` and
`m7-a05`, are not run and cite no execution. No scored assertion uses an
original builder choreography receipt as its sole basis.

O4 explicitly says it was “Scored only from grader-run harness receipts” and
cites the new M5, M6, and M8 receipts, so its score of 35 carries the same
qualification. The original builder M5 receipt appears only as a comparison.
Across 34 shared web assertions, the final builder and grader receipts agree
on 33; `warm-offline-search-over-synced-messages` is true in the builder
receipt and false in the grader receipt. M6 and M8 native supplemental status
remains `not-recorded` in both.

The received `m5-a07` evidence string names nonexistent
`grading/checkout/evidence/choreo-m5b.jsonl`. The named
`chat-color-background-sync` assertion is present and passing in both actual
grader-run M5 receipts. This is retained as a citation traceability defect; the
report bytes and score are unchanged.

## Access, source, pins, and custody

The final public-tool-argument audit found no explicit grader access to the
excluded builder `diary.md`, `essay.md`, `final-report.md`, `FINAL.md`, or
`run-log.md`, and no access to Grok, Muse, or a prior run. It inspected public
command and path arguments, event metadata, and receipt contents needed for
custody; it did not inspect private reasoning bodies.

All 261 canonical source-inventory files match the original lane, all 53
archived builder evidence files match the canonical snapshot, and all 224
whitelisted source files in the grader checkout match that snapshot. The five
excluded builder reports and all 14 archived builder choreography/observation
files are unchanged. The original lane and isolated grader checkout both pin
Snapback 4 `0.2.6` and Expo `0.2.1` in manifests, lockfiles, and installed
metadata. Full details, event hashes, assertion mapping, instruction line
citations, and receipt comparisons are in
[`grader-access-source-custody-final.json`](./grader-access-source-custody-final.json).

[`COPIED_FILES.json`](./COPIED_FILES.json) records the eight verbatim copies
and confirms their destination hashes. Selected grader-created evidence,
screenshots, checkout receipts, harness logs, and raw CLI custody are retained
externally by path, byte count, and SHA-256 in
[`external-evidence-references.json`](./external-evidence-references.json).
The raw NDJSON transcript, checkout, dependency trees, runtime state, and
server logs are not copied into the repository.
