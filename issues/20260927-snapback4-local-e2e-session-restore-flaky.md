# Snapback 4: `local-e2e` "a device restores its session on its own" is flaky

- **Opened:** 2026-09-27, while landing lane OW.
- **Severity:** Low: an intermittent test failure seen on `main`. No product
  defect is known.
- **Area:** `snapback4/packages/snapback4/test/local-e2e.test.mjs:205`.

`local-e2e.test.mjs` "a device restores its session on its own" expects
`E_AUTH` at line 205 and sometimes receives `undefined`. It failed in lane
OW's merge full suite on eb1000, and 1 of 3 isolated runs on `main`
`3a1f8b55d`; the same file passed 3 of 3 on OW's merge. Find the race:
likely the order between the session restore and the refusal the test
waits for. Fix it without weakening the assertion, and prove it with 20
loaded runs.
