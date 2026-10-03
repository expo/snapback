# Snapback 4 delivery fault matrix misses follow injection sites

Status: Open
Date: 2026-10-02
Scope: delivery-fault-matrix.test.mjs fixture coverage

The single NX round-5 canonical suite exited 1 with exactly
`== 1 failure(s) in 2240 s` (`client tests`). The client pool had 5,764 passed,
three failed and five skipped (5,772 total). It reported these failures:

- 47 transient: local.ts:850 follow
- 47 persistent: local.ts:850 follow
- 48 transient: local.ts:855 follow

A focused rerun reproduced case 47 transient: `the classified await must actually
experience an injected fault` (`failures > 0` was false). Cases 47 persistent and
48 transient/persistent passed that rerun. The unanchored name pattern also ran
147 and 148's transient/persistent controls; all four passed. Overall recheck:
7 passed / 1 failed, exit 1, 123.014 s. The canonical suite's full failure details
and exact overall summary are retained in the NX report.

These fixtures, instrumenter, recipes and local client TypeScript are unchanged
from e1adc01ddc; the rebuilt wasm has the same hash. NX changes the CLI shim,
export wrapper and Rust witness recovery/publication, not this in-process client
fixture. This is an untriggered fault-injection coverage assertion; no cause is
established and no assertion, model count or retry deadline was weakened.

Next: deterministically drive each follow await into its intended fault path,
retain the assertion that injection occurred, and verify both transient and
persistent variants. Do not reclassify an unexercised fault as a passing control.

Evidence: `snapback4/reports/20261001-nx-export-proves-native/round5/`
`delivery-fault-recheck.log`, `delivery-fault-source.json` and the full-suite
summary/archive reference.
