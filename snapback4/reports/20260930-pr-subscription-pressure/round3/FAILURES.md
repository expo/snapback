# Failure ledger

## Development failures — ours, fixed

- First report-directory setup used a repository-root path from inside
  `snapback4/`; the install-log redirect failed with `No such file or directory`.
  Removed the empty nested directory and ran the frozen install in the proper
  directory. No dependency command ran on the failed attempt.
- One editing command likewise used repository-root paths inside `snapback4/`
  and raised Python `FileNotFoundError`; it changed no files. Reissued from the
  root. No test result depends on that failed edit.
- `guide-initial.log`: **104 passed / 2 failed**. The merge preserved both
  guides' text but exceeded main's tightened line cap and the existing word cap:
  `client::existence_card_and_starters_teach_the_sdk_words` and
  `client::native_smoke_is_the_milestone_path_with_honest_limits`.
  Shortened text/snippet formatting to 114 lines / 1,196 words, preserving both
  native smoke and pressure guidance. No test or budget changed. Whole guide
  follow-up: 106 passed (`guide.log`).
- `affected.log`: **263 passed / 2 failed**, both
  `wasm/process keep=undefined: eight expired active reads cannot starve later
  observations or publish late` in `per-row-liveness.test.mjs`.
  Initial implementation unnecessarily gave every brand-new observation a
  notified cut, so its extra metadata await let expired retries reach the
  interpreter first. Only a resumed detached owner now inherits that cut.
  Existing liveness assertions are unchanged; all pass in `affected-final.log`
  (**270 passed**). This was our regression, not an environmental failure.

- Final staged whitespace check flagged the stored diff's blank context lines
  in `FULL-PRODUCT.patch` (not product source). Gzipped that evidence without
  changing its bytes; the repeated staged check passes.

## Deliberate negative controls

`round2-control.log`: exact round-2 SDK sources (`1a602df58d`) against current
server/device artifacts, **21 failures / 0 passes**, no skips/cancellations:

- Four detached-notification cases: wasm/process, each with and without a live
  control. The closed getter and 1.25-second sample retain revoked rows on round
  2; the mounted control withdraws. Expected inherited defect.
- Four staged-getter cases: wasm/process × until-revoked/delivered-history. Each
  remains loading after publication and times out waiting for the permitted
  answer. Expected round-2 regression, not a fixture setup failure.
- One production online fairness case: five ordinary rereads make zero starts
  across 160 freed hot-read slots. Expected round-2 starvation.
- Eight real composition cases: wasm/process × constructor, __proto__, toString,
  hasOwnProperty. Each throws `values.some is not a function`.
- Four missing-scope-key cases: inherited properties are incorrectly invoked
  as arrays. Expected round-2 dictionary defect.

`mock-round2-control.log`: **3 passes / 1 expected failure**. The additional
`mock ephemeral writes preserve the table __proto__` fails (`failed` instead
of `sent`) on round 2. All four names pass fixed, with the full names/boundary
run at **337 passed** (`names-boundary.log`).

## Full suite

The single full invocation passed, exit 0: **`== 0 failure(s) in 1261 s`**.
Full-run failures: **ours 0, baseline 0, environmental 0**. Rust 4,368 passed
with 33 existing ignores; client pool 5,417 passed with ten existing skips;
fixture wrappers 9 passed; serial models 79 passed. No cancellations or reduced
model counts. All 1,659 recorded inputs remained unchanged during this run.
The nominal 60-second suite-duration budget is inherited and still exceeded.

After the run, the watermark check was narrowed to detached resumption only.
The broader first version regressed both alternating loaded-process samples;
this was our unnecessary metadata work, recorded in LL-TABLES.md. Only local.ts
changes among the captured suite inputs; its final **527 affected tests** and **321 delivery fault/boundary checks**
all pass, and candidate measurement bytes match the installed final SDK. No second full invocation occurred.
