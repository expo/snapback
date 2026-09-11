# Snapback 2 derived-only test failed once on a missing file it does not name

**Status:** Open
**Priority:** P3
**Date:** 2026-09-11
**Systems:** Snapback 2 package tests (`tests/effects-visibility.test.ts`), `snapback2 test` isolated owner (`crates/snapback2/src/test.rs`)
**Related:** LLP 1021, [rules](../rules/RULES.md) (blocking checks)

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
