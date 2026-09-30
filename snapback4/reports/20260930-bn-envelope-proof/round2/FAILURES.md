# BN round 2 failures

| Invocation | Result | Classification / disposition |
| --- | --- | --- |
| `new-tests-first.log` | 1 pass, 1 fail | Ours: the new test helper tried `text.includes` on the numeric child exit status. Pass only stdout/stderr to the credential assertion. No product failure; corrected tests subsequently pass. |
| `round1-controls.log` | 0 pass, 3 fail; exit 1 | Expected detecting controls against actual round 1. Uppercase-hex reflection leaks to stdout; acquire equals-token and iOS equals-token errors leak to stderr. The assertions print only form/boundary labels, not real tokens. |
| `round1-runtime-control.log` | 0 pass, 1 fail; exit 1 | Expected detecting control against actual round 1: runtime refusal stderr prints a caller artifact-path argument. |

`acquire-first.log` is the passing 38-test development run before splitting the
acquire and iOS refusal cases. `affected.log` is the passing 75-test witness run
before the final runtime-refusal test and path omission. The final unchanged
source check is `affected-final.log`; earlier passing logs do not stand in for it.
No assertion, timeout, workload or existing proof guard was weakened. Receipt
assertions were migrated to format 2 (hashed table/position keys, HTTP categories
and omitted server timing) while preserving the original proof assertions.

No baseline/environmental test failures occurred. Rust builds retain the
existing tiny_http dead-code warning. The full suite was intentionally not run
under the round 2 instruction; no full-suite summary or full qualification is
claimed.
