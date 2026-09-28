# Lane MP — round 3

2026-09-28. Branch `sb4-intent/mp-modeling-papercuts`.
Read all three lane prompts, prior reports and MP journal entries, and Astra's
complete round-2 NOT READY review (copied as `astra-r2.md`). Prior Grok reviews
remain the completed round-0/round-1 reports already addressed in round 2;
there is no round-2 Grok report at completion.

Fetched origin and performed a read-only merge check. Main had advanced to
`ae265b730`, and the check found conflicts in JOURNAL.md and LLP 3000.028.
Only then merged, as authorized for this round, in `e0fc5732e`. Both parent
journals survive as ordered subsequences; the LLP keeps MP's complete corrected
revision history and EX's five additions. No product conflict needed manual
resolution. EX's automatically merged guide/operations changes remain intact.

## Changes and detecting regressions

1. Every actual JSON refusal envelope now enters the dev stream, regardless
   of code. A real owner-only image upload and placement allows Alice's download;
   after a known mutation refusal, Bob receives HTTP 404/E_ASSET_UNKNOWN and a
   new asset-operation record with a new request identity and explicit
   `cause not instrumented`. No asset authorization or response bytes changed.
2. A newly parked job submits its name, durable job ID, saved refusal code,
   wall-clock timestamp and fallback cause after the engine guard is released.
   It uses the same sequence allocator, live watermark and bounded writer as
   request records. The scheduled-chunk regression executes
   `require false else NOT_FOUND`, advances the dev clock, observes one parked
   job, and proves that record supersedes an earlier request and precedes a
   later request in the same stream. Production does not submit job evidence.
3. The supervisor's ruling is recorded in LLP 3000.015 §2.1 and the published
   operations/why guidance. Successful visibility filtering in sync and reads
   is not a refusal and does not enter the stream. The output's scope statement
   names mutations, queries, asset requests and jobs, and points to `why TABLE`
   (read rule and sync residency) and `guide rules` for visibility questions.
   Records carry operation, request/job identity and Unix milliseconds; stderr
   also prints time and job identity. A filtered sync, page and point read as
   Bob leave Alice's prior named, timed mutation refusal unchanged. The two
   source-generation host tests now use real authorization exhaustion instead
   of successful filtering, preserving their collector/source-map assertions.
4. The composed missing-row query `{outer: {row: rows['absent']}}` after a known
   refusal gets a new EMPTY_READ record with its operation, request identity,
   time and unknown cause. This conservative empty-result fallback is retained
   by the explicit round-3 requirement; it is not proof of a rule denial.

Four removal probes restore the old asset-code filter, omit parked-job
submission, omit the successful-filtering exclusion, or replace the object
arm of `empty()` with false. Each causes its corresponding submitted process
test to fail at runtime, not compilation. Source bytes are restored in `finally`;
the final process run passes all 12 tests. See `counterfactual.py` and its logs.

The product changes stay in three native host files. No core/device code,
authorization, logical meter, caller envelope, endpoint, production collector,
or budget changes. Jobs currently have no clause collector, so their terminal
record deliberately reports the fallback rather than guessing from error text.
All records retain the existing asynchronous lag/drop and live-instance rules.

## Validation

Logs are stored losslessly as `.log.gz`; use `gzip -dc FILE.log.gz`.
Exact commands, all failures and their attribution are in [VALIDATION.md](VALIDATION.md).

- Affected host matrix: **246 passed, 0 failed, 4 existing ignored**, comprising
  195 host unit tests, 19 clock tests, 12 dev-refusal process tests, 5 maintenance
  tests and 15 replay tests. Existing caller-byte/production-isolation tests pass.
- MP behavioral target: **18 passed**, including trace-on/off refusal-byte and
  full logical-meter equality for query/capture exhaustion and other rule paths.
- Whole guide: initial **97 passed / 1 failed** on the newly integrated EX
  published-path guard. MP's generated local evidence path was not listed as an
  application output. Added that exact path to the existing APP_FILES list and
  its positive guard regression, without broadening path matching. Final whole
  guide: **98 passed, 0 failed**.
- Four deliberate removal probes: **4/4 detected**; final restored process suite:
  **12 passed**. Overlapping reruns are not added to the totals above.
- Source caps and whitespace checks pass. Final reference audit is recorded
  in `ref-check.log.gz` and VALIDATION.md.

`scripts/test.sh` was **not run**, per this round's instruction. The supervisor's
round-2 landing suite remains independent; this report makes no complete-suite
or publication qualification claim.

Wasm: **2,019,925 B raw / 586,252 B gzip**, identical to round 2, delta **0 / 0 B**.
The rebuilt artifact's SHA-256 is unchanged:
`39dbc171e30ed10ac19152381cf3e7ae0908afaf0b01ae285c2341ce542480b5`.
The unchanged **586,193 B** gzip budget still fails by **59 B**: a
**baseline/inherited** qualification failure, not a green budget claim.
No ceiling was raised.

One journal entry appended. No tools installed, shared paths or other lanes
changed, push or publication. Local commits carry
`Co-Authored-By: GPT-6 Astra <noreply@openai.com>`.

## Orientation context (llp-orient)

Applied the read-only skill from the existing
`/home/ccheever/coldclone-test/vendor/llp/skills/llp-orient/SKILL.md`, as in prior
rounds; the worktree's vendor symlink remains uninitialized.
Scope: native response classification, parked-job handoff and published scope.
Governing LLPs: LLP 3000 §§1/4/7 (fence and budgets), LLP 2000.000 §12,
LLP 3000.007 §8 (rules/dev seams), LLP 3000.014 §4 (capture phase),
LLP 3000.015 §2.1 (developer evidence) and Accepted LLP 3000.028 §2.4
(builder diagnostics). LLP 3000.028 is in current; these Snapback 4 governing
files are not foundation links. Active constraints and rationale come from
LLP 3000.015 §2.1: do not reevaluate authorization, disclose causes to callers,
change meters, or enable collection under serve. Its revised notes and the
published why/operations text are the required doc updates. The scope ruling
resolves filtered-sync coverage; empty-result fallback remains explicitly
unknown. No new LLP, gate or unresolved design decision. Hand-off: none.
