# Round 12 evidence

Final qualification: `== 0 failure(s) in 701 s`, exit 0. Rust 307 s;
client tests 152 s (1,620 pass / 10 skips); models 231 s (78 pass / 13,000 seeds).
All 54 real-browser admission checks passed.

Commands run from `snapback4/` with `$HOME/.local/bin:$HOME/.cargo/bin` on
`PATH`. The source implements both completed round-11 delta reviews.

- `legacy-receipts.log`: `node --test packages/snapback4/test/legacy-receipts.test.mjs`
  before the additional receipt-abort unit: 12 passes, including eight real
  server/memory/SQLite upgrade cases, all with audit 0.
- `replay-persistence.log`: the added receipt-abort proof unit, one pass.
- `device-targeted.log`: `cargo test -p snapback4-device --test write_authority --test repair_b --lib`;
  9 + 108 + 42 passes. History replacement rejects absent or foreign proof,
  adopted receipts, and every non-replacement failure on both stores.
- `client-targeted.log`: `node --test` over `client-lifecycle`, `acquisition`,
  `repair-b`, `repair-b-round7`, `repair-b-round8`, and `legacy-receipts`; 107 passes.
- `browser-focused-initial.log`: the two new browser cases plus real sync
  acknowledgement correction and lookup-only receipt persistence; all pass.
- `browser-updated-fixture.log`: the updated actual-success replacement
  fixture plus the gated final-preflight case, both pass.
- `fixture-encoding.log`: unchanged word-expansion fixture matches after
  omitting the new map when empty.
- `bun-install.log`, `client-build.log`, `typecheck.log`, `native-build.log`
  and `ref-check.log`: setup/build/type/reference checks.
- `receipt-fixtures.log`: both revised client fixture files, 67 passes and one
  optional historical-binary skip.
- `test-artifact-build.log`: an intermediate mechanical edit also changed a
  function signature; that syntax error was ours and corrected immediately.
- `test-artifact-build-fixed.log`: all workspace test artifacts compile after
  adding empty qualification to direct wire constructors.
- `server-wire.log`: real snapshot/stream encoder unit tests.
- `full-suite.log` and `.exit`: complete qualification using
  `SNAPBACK4_RUST_TEST_PROCESSES=4 taskset -c 64-79 scripts/test.sh`.

## Negative controls

These exits are intentionally nonzero and fail at the intended assertions:

```sh
SNAPBACK4_WEB_ADMISSION_FOCUS='legacy refused observation' \
SNAPBACK4_WEB_ADMISSION_MUTANT=legacy-success \
node --test packages/snapback4/test/web-admission-review.test.mjs

SNAPBACK4_WEB_ADMISSION_FOCUS='final begin_send' \
SNAPBACK4_WEB_ADMISSION_MUTANT=final-preflight \
node --test packages/snapback4/test/web-admission-review.test.mjs

SNAPBACK4_RECEIPT_MUTANT=only-admin \
node --test --test-name-pattern='authored refusal' \
  packages/snapback4/test/legacy-receipts.test.mjs
```

The browser controls report `sent !== pending` and `sent !== failed`.
The narrowed authored-refusal guard fails independently for `NOT_FOUND` and
`CONFLICT`; `NOT_ADMIN` still passes. No production source is mutated on disk.

## Development failure accounting

The initial full suite ended `== 2 failure(s) in 512 s`, exit 1; its two
failed stages were Cargo artifact compilation and client tests. Full logs are
in `full-suite-initial.log` and `.exit`. Compilation missed the additive field
in direct reply constructors. The ten client failures were the two replacement
transport fixtures and eight memory/process × staged/deferred × head 20/25
fixtures. The corrected artifact build and 67 passing client checks are recorded
above. All 54 browser cases and all 78 models passed even in this first full run.

All of these development failures are ours, corrected before final qualification:

- `legacy-receipts-initial.log`: eight new cases refused to compile because
  the fixture required a nullable boolean. The concrete compiler rewrite was
  applied (`admin = true`).
- `write-authority-initial.log`: one positive fixture lacked explicit success
  qualification; it now carries the modern wire field.
- `device-targeted-initial.log`: two old tests asserted sequence-only success.
  The first now distinguishes known outcome from unknown identity; the second
  requires retaining legacy custody through replacement.
- `browser-all.log`: 53 admission checks passed, one older positive fixture
  expected bare `observed_seq` to return sent. It now commits the actual id
  on store A and keeps its qualified sequence before testing replacement.
- `device-all.log`: 434 main-device checks passed, one frozen serialization
  fixture failed due to an empty `sent` map. `fixture-encoding.log` proves the
  omission fix without regenerating the fixture.
- `wasm-build*.log`: intermediate representations and final measurement all
  exceeded the inherited 496,000 B ceiling. The final 496,604 B artifact is
  recorded with the 497,000 B ratchet adjustment and reason in code, docs and
  commit. Full-suite output is the final build measurement.

The supplied baseline tail (`~/sb4-intent/baseline-test.log`) was read before
classifying failures. It reports `== 1 failure(s) in 276 s` (`cargo test`).
None of the development failures above is attributed to that baseline.
