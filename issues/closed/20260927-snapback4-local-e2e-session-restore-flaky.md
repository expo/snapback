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

## Resolution (2026-09-27)

The test raced sign-out's remote logout. `signOut()` completes without
waiting for the server (remote logout is best effort, and
`local-signout.test.mjs` proves sign-out completes with logout stalled),
but the test checked the old token the moment sign-out returned. Under load
its `/q/inbox` could reach the server before the logout committed, and the
query answered.

Proof on eb1000 (lane-gn worktree at `main` `686ffd2ab`):

- Delivering the client's logout 300 ms late makes the old assertion fail
  5 of 5 runs, with the flake's signature (`undefined` for `E_AUTH`).
- The fixed test keeps that late logout, so the race is exercised on every
  run, and waits for the server to refuse the old token, still asserting
  `E_AUTH`. It passed 20 of 20 runs, five at a time, beside two lanes' full
  suites.
- The test as it was on `main` passed 20 of 20 at that load, so the late
  logout is what makes the race reproducible.
