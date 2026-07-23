# Checkpoint instrument corrections: canonical target identity + cross-user delete witness

**Status:** Open
**Severity:** P2
**Systems:** Competitive evaluation, Testing
**Author:** Claude (Fable 5), directed by Charlie Cheever
**Date:** 2026-07-23
**Related:** LLP 0075 §Author adjudication, demos/competitive-checkpoint/acceptance/implementation-status.v0.json (knownInstrumentDefects), demos/competitive-checkpoint/tests/acceptance/local-streaming.mjs (hardcoded alias, cross-user tests), demos/competitive-checkpoint/acceptance/results/local-streaming.v0.json, LLP 0065 (delete-refusal requirement), issues/20260723-llp0075-checkpoint-program.md
**Marker:** llp-0075, competitive-checkpoint, instrument

The only "do" code work in the 0075 program — two recorded instrument defects,
each requiring a prospective rerun of the affected witness (a valid baseline is
never silently rewritten).

1. The retained local-streaming receipt hardcodes the retired
   `local-ibex-sqlite.v1` target alias; protocol amendment v0.1 corrected the
   canonical identity to `local-dev-sqlite-ibex` and requires deriving identity
   from the served capability manifest.
2. The witness covers cross-user list/lookup/update denial but not cross-user
   **delete** refusal, which the frozen fixture and LLP 0065 both require.

**Done when:**

- The harness derives `targetProfile` from the served capability manifest (and
  records the manifest digest) rather than hardcoding it; the receipt schema
  makes the alias mistake structurally unrepeatable.
- A real-server cross-user delete negative witness is added.
- Both witnesses are rerun prospectively and the receipts regenerated; the
  `knownInstrumentDefects` entries clear and the "locally proven generated-owner"
  language narrows to the exact witnessed subset until the rerun lands.
