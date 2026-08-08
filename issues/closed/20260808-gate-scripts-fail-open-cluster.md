# Two gate scripts can silently fail-open (swallowed subshell failure; staleness misread as infrastructure)

**Opened:** 2026-08-08 · **Severity:** P2 (fail-open enforcement seams) · **Area:** scripts / drift gates

Two independent fail-open seams in the enforcement layer, grouped because both
turn a real gate failure into a green/quiet outcome.

## A) `check-generated-artifacts`: process-substitution failure swallowed

`scripts/check-generated-artifacts:22-32, 36-38, 47-54`

```sh
while … done < <(node scripts/generated-artifact-policy.mjs jobs)
```

Under `set -euo pipefail`, a non-zero exit of a **process-substituted** command
is ignored, and there is no guard that at least one job was read. If the `jobs`
subcommand crashes (OOM, a future formatting bug) while later calls succeed,
**zero** codegen jobs run; the gate then diffs committed review manifests that
were never regenerated and reports "ok" on any clean tree — exactly the
staleness class the gate exists to catch. The total-failure case is caught only
incidentally (empty `REVIEW_ROOTS` makes a downstream script exit 2).
*Fix:* capture each policy invocation into a variable first (assignment under
`set -e` propagates failure) and assert the job list is non-empty before
proceeding.

## B) Drift-gate classifier can misread genuine staleness as infrastructure

`scripts/drift-prone-gates.mjs:44` (`INFRASTRUCTURE_OUTPUT`), 504-513
(`runBackstop`), 794-797

Any failing gate whose stdout/stderr matches
`Cannot find package|MODULE_NOT_FOUND|couldn't read .*No such file…|SNAPBACK_(CAPABILITY_IBEX|IBEX)_…`
is classified as infrastructure. In `runBackstop` that means **no stale-record
ticket is filed** and exit 2 into a launchd log nothing monitors. A gate that
legitimately fails stale and whose diff/expected-vs-actual output happens to
contain one of those strings (plausible here: error-message fixtures,
errors-as-docs content, guide snippets demonstrating `Cannot find package`)
gets permanently misclassified — `main` can stay stale for days with the system
convinced it's an environment problem. The pre-push side fails closed, so this
is specifically a backstop-promise gap.
*Fix:* anchor the match to the gate runner's own diagnostics (node/sh stderr
lines, or require the marker at line start), and file a self-health ticket after
N consecutive infrastructure classifications.

## Confidence

Medium on each (both need a specific failure to bite); neither pattern is a
deliberate fail-open. Both live at the least-observable (backstop) tier.

## Resolution (2026-08-08)
Fixed on main (Lane G). Verified: bash -n / node --check on edited scripts; cargo verify-project OK.
