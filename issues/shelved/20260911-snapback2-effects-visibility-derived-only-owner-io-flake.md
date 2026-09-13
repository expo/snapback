# Snapback 2 derived-only test failed once on a missing file it does not name

**Status:** Open
**Priority:** P3
**Date:** 2026-09-11
**Systems:** Snapback 2 package tests (`tests/effects-visibility.test.ts`), `snapback2 test` isolated owner (`crates/snapback2/src/test.rs`)
**Related:** LLP 1021, [rules](../../rules/RULES.md) (blocking checks)

## Evidence and impact

One of nine full `snapback2/scripts/test.sh` runs on expo-build-1000 (clean detached
worktrees, 2026-09-11) failed one package test, at `40acc20c7`. The eight runs at
neighbouring commits of the same chat-starter work passed it, and it passed 9/9 when run
alone at `40acc20c7`.

`derived-only states its scope and skips the effects witness check`
(`tests/effects-visibility.test.ts:249`) ran `snapback2 test --derived-only --json` and
the receipt's owner check failed at 0 ms, after certify passed:

    {"name":"certify","kind":"derived","verdict":"pass","ms":814,"detail":{"operations":29}},
    {"name":"owner","kind":"derived","verdict":"fail","ms":0,"detail":{"code":"E_OWNER_TEST_IO",
     "family":"owner","guide":"owner/dev","message":"No such file or directory (os error 2)",
     "rewrite":"make .snapback writable and rerun snapback2 test"}}

`E_OWNER_TEST_IO` comes from `test_io` in `crates/snapback2/src/test.rs`, which keeps the
OS error but not the path. In `IsolatedOwner::start_with` the fallible steps are copying
`snapback/` and `.snapback/build` into `.snapback/test-run-<stamp>/project` (`copy_tree`
lists a directory, then copies each entry), creating `.snapback`, linking the store,
spawning the owner, and reading its `owner.json`. A file removed between listing and copy
fails this way, but which step failed was not recorded. The log is
`/tmp/s2-starter-papercuts-40acc20c782d5b0d071d7f458580dfe59532a1ae-test.log` on that host
(sha256 `cf3b8e003531742e14b2d1bdc00b55b2a4b47f0a9d9607607a042ebe4f8c79ec`).

`scripts/test.sh` is a blocking check, so an intermittent failure here blocks unrelated
pushes.

## Requested outcome and acceptance

- Name the path and operation in `E_OWNER_TEST_IO` messages.
- Run this test file repeatedly under full-suite load, find which step misses a file and
  what removed it, and fix that race rather than retrying.
- Close as not reproduced if a few hundred loaded runs never fail.

## Additional witness — 2026-09-12, LLP 1023

At `eb681b85a1b01d69fefab28973a165cb6a06424f`, the unchanged full script on
EPYC failed 1/1,451 package tests in 259.53 seconds total: the second CLI test
invocation, `snapback2 test --journey "effect engine absence" --json`, returned
the same `E_OWNER_TEST_IO` / ENOENT owner check before running any journey
(`effects-visibility.test.ts:209`, assertion at 213). Native tests and the other
phases passed. The original full run remains **failed**.

An isolated run of the unchanged existing file passed **9/9** in 36.784 seconds,
using the same prebuilt source, pinned Node 24.18, and original deadlines. The
previously failed invocation took 2.818 seconds; its preceding full CLI test took
17.889 seconds. This isolated run used the canonical package directory and did
not reproduce full-suite parallel load or its package-copy placement. No cause
is established, and no assertion, timeout, or product change was made. The test,
`test.rs`, and `owner.rs` are byte-identical to frozen 0.0.29 source `f2c569a5e5`;
owner publication precedes ready output, so a write-after-ready explanation is
not supported by source alone.

Retained evidence on EPYC (`100.65.137.99`), under
`/home/ccheever/snapback-1023-20260912/coverage-followup/`:

- Failed full log: `full-integrated-epyc.log`, SHA-256
  `7a4b9fa2df3ea8dcfc4212ddcc73b9c4282253bc03c605e9d42385bf66447f2a`;
  its adjacent JSON records exit 1 and child reaping.
- Isolated log: `effects-visibility-isolated/test.log`, SHA-256
  `29f3c69c4cce9caeadf68be2d16229af5cb2f728237d13b099966f09afd46bbb`;
  `run.json` records Node PID 910209 exiting 0/reaped and all 14 observed
  same-group process identities gone. Separately grouped native helpers were
  owned by the existing harness, outside that observer's complete census.

The local diagnosis, fixed source copies, hashes, and original failure excerpt
are retained under
`/Users/ccheever/projects/snapback-1023-20260912/coverage-repair/effects-visibility-diagnosis/`;
`assessment.json` SHA-256 is
`87e60fa447235720241e2e1bf08ef349b1c677216cc4f8472a288181c5da1fdb`.
