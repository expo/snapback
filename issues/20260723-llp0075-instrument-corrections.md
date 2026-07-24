# Checkpoint instrument corrections: canonical target identity + cross-user delete witness

**Status:** Blocked (2026-07-23 — both corrections landed; full prospective rerun blocked on the LLP 0076 streamed-action implementation landing on main)
**Resolution so far (2026-07-23, session 1681e9d6):** The instrument and fixture are now pinned in-tree (they previously existed only untracked in a working tree while cited by implementation-status.v0.json). The harness derives targetProfile from the served capability manifest (GET /inspect targetProfileId), asserts it matches the generated artifact pair, and records the manifest sha256 in the receipt — the alias mistake is structurally unrepeatable. A real-server cross-user delete negative witness (then `SNAPBACK_ROW_NOT_VISIBLE` + owner row intact) was added and passed against committed main. LLP 0065 subsequently adopted existence secrecy at the public boundary, so the current instrument expects the collapsed `SNAPBACK_ROW_NOT_FOUND` refusal while retaining the owner-row survival witness. Prospective rerun receipt: acceptance/results/local-streaming.v0.rerun-20260723.json (2/6: owner-pattern and idempotency checks pass; the four streaming checks fail on committed main because ctx.fetchStream/timed_out/ambiguous settlement exist only as in-flight LLP 0076 work in a concurrent session — recorded as a new knownInstrumentDefects entry). The retained 6/6 baseline receipt is kept unrewritten; it is superseded when LLP 0076 lands and the full rerun passes.
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
