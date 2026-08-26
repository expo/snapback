# Scaffold verify config expects a named acceptance export; CLI-entrypoint apps fail SNAPBACK_VERIFY_CLI_FAILED

**Status:** Open
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
