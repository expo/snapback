# EA round 4 failure ledger

Every unsuccessful exploratory check is retained below. Except for the named
Node runtime exception, these are **ours**, including the earlier-round defects
intentionally exposed by negative controls.
No exploratory failure is attributed to baseline. One environmental Node HTTP
parser exception, observed in two runs, is detailed below. The complete
TAP name list is in `development-failures.json`; full-suite results are recorded
separately in REPORT.md and the full log.

- Initial setup: two shell edits used a root-relative path while already inside
  `snapback4/`; both failed before editing. Corrected the paths. A preliminary
  name-filtered invocation therefore selected zero new tests; its output was
  replaced by the actual reproduction run, and it is not counted as evidence.
- `reproduce.log`: the two replacement tests caught the old second-call
  retargeting, but the empty snapshot produced NOT_MEMBER after the wrong
  admission. The hang test's teardown tried closing before releasing its held
  device read. Sent Ctrl-C to the owned tool session during that wedge; the test file
  reports one cancellation. Registered release cleanup first and populated the fixture rows.
- `reproduce-pins.log`: two expected retargeting failures with the initial empty
  snapshot. Superseded as a detecting control by `negative-merged-baseline.log`.
- `reproduce-boundary.log`: the final read hangs and rejects raw, as reviewed.
  Two browser retry tests instead failed because the fixture used the wrong
  localStorage key prefix (`snapback4:admission:`). Corrected to the real
  `snapback4-admission:` prefix, including the older empty-journal assertion.
- `negative-merged-baseline.log`: all eight corrected Astra tests intentionally
  fail against merge 57e90132f4's product sources. Store and backend replacement
  retarget the second call; final read hangs/rejects; wasm and Worker same-ID
  retries return E_WRITE_RECEIPT_EXPIRED; both remaining-budget cases never
  complete. The last two originally report accessing `why` on an absent result;
  the final assertions use optional access for a clearer missing-outcome failure.
- `mutant-delete-final-recheck.log`: both replacement controls initially failed
  a check-count setup precondition. Removed that dependency on the final check.
  `mutant-delete-final-recheck-detecting.log` then fails both at the meaningful
  assertion: two ordinary admissions occurred where only the first is allowed.
  The production recheck was restored and the package rebuilt after each run.
- `guide.log`: one failure, `definitions::w11_every_registered_code_quotes_its_definition`.
  The defining-sentence pins still quoted the old STORE and TIMEOUT wording.
  Updated them to pin the clarified meanings. `guide-corrected.log`: 99/99.
- `grok-negative.log`: temporary unreadiness and empty capture cover the new
  review, but three adoption fixtures used `set_meta`, which prefixes keys with
  `client:` and cannot set `device:backend-required`. The empty-capture fixture
  also attempted to mock an absent global property. Fixed its property setup;
  `grok-capture-negative.log` then detects the old E_ADMISSION refusal.
- `grok-fixed.log`: three adoption cases still fail because of that ineffective
  fixture flag. Replaced the flag write with a real legacy watermark rewind via
  `observe_store`, asserting unchanged store/generation/backend and actual
  `backend_required: true`. `grok-corrected.log`: 9/9.
- `grok-negative-detecting.log`: all five corrected Grok tests intentionally
  fail with the five Grok-relevant JS/native source files restored from merged
  round 3 (the independent asynchronous ID-release fix remains). Both adoption
  windows acknowledge ordinary custody, temporary unreadiness refuses, native
  admission crosses the flag, and empty capture uses E_ADMISSION. Sources were
  restored byte-for-byte and both native/client artifacts rebuilt afterward.

The earlier broader affected run passed 180/180 and the initial matrix passed
321/321. They precede the complete Grok repair; final scoped checks and the one
full run are identified separately in REPORT.md. No red log is relabeled green.

- `affected-final.log`: 130 individual tests passed, then one test-file failure
  from asynchronous activity attributed to `ordinary native settlement stamps a
  live outbox before replacement (Grok round 2)`: Node's bundled HTTP parser
  timeout destructured `parser.deref()` after collection. **Environmental** host
  runtime exception, not an admission assertion failure. `node-parser-timer.json`
  records the actual bundled code and the existing pinned undici guard. The
  fixture now routes its instrumented Node fetch through the SDK's existing
  defaultFetch dispatcher. `identity-final.log` repeats that same exception with all 39 assertions
  passing; `identity-pinned-fetch.log` is the corrected 39/39 check.

The single final `scripts/test.sh` run exited 0 with the exact summary
`== 0 failure(s) in 1297 s`. All stages passed. Full-run failure attribution:
**ours 0; baseline 0; environmental 0**. No full run was repeated, and the
source/test inputs stayed unchanged throughout that run.

The final staged whitespace check also reported TAP indentation on empty lines
and a trailing blank line in captured logs (**ours**, report formatting). Those
raw logs are retained unchanged; the whitespace check excluding captured `.log`
files passes. This was a formatting check, not another test invocation.
