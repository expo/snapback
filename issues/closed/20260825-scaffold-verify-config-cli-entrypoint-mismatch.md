# Scaffold verify config expects a named acceptance export; CLI-entrypoint apps fail SNAPBACK_VERIFY_CLI_FAILED

**Status:** Resolved
**Opened:** 2026-08-25
**Systems:** CLI, Acceptance testing, Templates
**Related:** `benchmarks/runs/2026-08-25-clique-pair-published-0127-capstone/`
(cell 1, end of M8)

## Problem

On published 0.1.27, the capstone builder's app ships its acceptance as the
required CLI entrypoint (`npm run acceptance -- --milestone mN`, per the
benchmark contract), but the scaffold's verify config expects a named
acceptance export — so `snapback verify` fails with
`SNAPBACK_VERIFY_CLI_FAILED` (`.snapback/verify-receipt.json`) even though
the acceptance suites and choreography are green. Two legitimate acceptance
shapes disagree at the verify seam.

## Wanted

Either the verify config accepts a CLI-entrypoint acceptance shape (command
+ expected exit/receipt contract) alongside the named-export shape, or the
scaffold/template and docs state clearly that verify requires the named
export and how to provide one that wraps an existing CLI entrypoint. A
regression covering the CLI-entrypoint shape at the verify seam.

## Resolution

Resolved 2026-08-28. Verify profiles now define exactly one of `run` or a
directly spawned `command` (`executable`, ordered `args`, config-relative
`cwd`, and expected exit code). A zero exit is valid CLI-entrypoint acceptance
evidence and receives honest unsupported D1 provenance unless the command
writes the optional fresh `snapback.verify-profile-result.v1` machine result.
That result can carry the same context, diagnostics, and conformance evidence
as a named runner. Verify removes stale results before execution, bounds output
and runtime, cleans up the owned process group, and refuses missing or malformed
results with coded diagnostics. Nonzero expected exits require a passing
machine result, so configuring an acceptance failure as the expected exit
cannot launder it into a pass.

The regression runs the reported package-script shape (`npm run acceptance --
--milestone m8`) through the verify seam, validates both exit-only and
receipt-producing passes against `snapback.verify-receipt.v1`, and covers
missing-result and expected-nonzero failure cases.
