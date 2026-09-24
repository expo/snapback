# Lane E round 9 — account-switch epochs and durable revocation

Date: 2026-09-24. Branch: `sb4-intent/e-client`. Based on `199964910`.
No push, publication or package version change.

## Changes, file by file

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Distinguish the first save of a sign-in from restoration and rotation. Before displacing a saved bearer, record retirement obligations and advance its epoch under the existing session lock. Only then save the new session and replay retirement. Retry the durable journal on restoration, sign-in and successful logout. |
| `packages/snapback4/src/app-revocations.ts` | New private helper: a backend-bound journal in `sessionStore`, written before displacement; skip the current saved bearer; remove tokens only after an explicit logout acknowledgement or HTTP 401 `E_AUTH`. Network errors, other refusals and missing acknowledgements retain entries for later replay. |
| `packages/snapback4/test/app.test.mjs` | Ten real-server regressions covering the failed-fence account switch, restart, missing acknowledgements, failure of each local write, failed comparison reads followed by logout or sign-in, and a foreign journal. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document epoch transitions, retirement durability, credential custody and retry behavior. |
| `../llp/3000.013-quarry-states-intent.rfc.md` §6 | Record the chosen implementation of account replacement and durable retirement. |
| `JOURNAL.md` | Append this round's implementation and measurements. |
| This report | Preserve the design, examples, regression evidence and baseline witness reproduction. |

Paths are relative to `snapback4/`. No source file crosses 1,500 lines; the
README remains unchanged at 296/300 lines.

## Existing forms that compile and run

No new public API or Quarry syntax. After storage recovers from a failed
`await app.auth.logout()`, either existing sign-in method works safely:

```ts
await app.auth.guest();
// Or: await app.auth.login(email, password);
```

If the store still contains another bearer, the new account receives a new
epoch. Another app that opened the old epoch refuses `refreshSession()` with
`E_AUTH` before dispatch, cannot overwrite the new session, and retires its
client. Reload restores the new account. Ordinary restoration and token rotation
retain their epoch. Sign-in over a logout tombstone retains the existing path
that copies the tombstone's epoch before replacing it.

## Durability decision

The durable record is `sessionKey(url) + ".revocations"`, containing the
normalized backend URL and unique retired tokens. It uses the same session lock
and explicit `sessionStore` as the current bearer; the journal contains
revocation credentials and is never a source of sessions to restore.

For a sign-in replacing a saved token, the ordered writes are:

1. Journal the displaced token and all deferred tokens except the new bearer.
2. Persist the incremented epoch.
3. Persist the new bearer.

Only after the new bearer is durable does replay dispatch revocations. Journal
or epoch failure leaves the old session bytes intact and refuses sign-in. If the
bearer write fails after the epoch advances, those old bytes still remain; a
new runtime restores them under the advanced epoch, and journal replay skips
that still-current token. Epochs never roll backward.

This does not rely on the old runtime's in-memory set. If total fence failure
is followed by restart, the old session remains in storage and supplies the
displaced token when sign-in is retried. Once replacement is permitted, the
journal has durable custody before those old bytes disappear. A restart after
replacement, or after an unacknowledged remote request, replays the obligation.
A 200 response carrying a refusal is not confirmation and cannot retire it.
Damaged or foreign journals remain intact and report `E_CLIENT`; they are not
sent to another backend or silently discarded to permit displacement.

A comparison read that fails still defers the token in memory because its
relationship to the stored token is unknown. A subsequent sign-in includes
that token in the durable journal; a successful logout retries its revocation
as before. Tokens that have never reached writable storage cannot survive an
abrupt process loss while every write fails. The guarantee here is that no
successful account replacement erases the last durable copy of a displaced
bearer. Remote reachability remains outside the client's control; unconfirmed
journal entries remain available for retry.

## Regressions and evidence

- **Failed-fence replacement, same runtime and after restart (two cases):**
  A signs up, B restores A's account, every store write fails during logout,
  storage recovers, and A signs in as a guest. The epoch becomes 1, B refuses
  refresh without dispatch, storage and reload preserve the guest, and the
  server refuses the displaced Alice token. Guest queries continue working.
- **Restart after unacknowledged retirement (two cases):** the first runtime
  either loses the logout transport or receives HTTP 200 with a refusal.
  The old token remains live until a new runtime replays the journal; replay
  revokes it while preserving the current account.
- **Failed journal, epoch and bearer writes (three cases):** each individual
  failure refuses sign-in and preserves the exact old session bytes. Restart
  proves a staged retirement never revokes the bearer still in storage.
- **Comparison read failure (two cases):** hold a committed login response,
  fail both logout fence writes, then throw from the comparison read for the
  discarded login. It is not prematurely revoked. Repairing storage and then
  successfully logging out or signing in revokes that discarded token. The
  successful sign-in's own bearer stays usable.
- **Backend binding:** a transplanted retirement journal reports a client
  warning, preserves its bytes and sends no foreign bearer to this backend.

Against the previous app implementation, five new behavioral cases failed and
one passed: `/tmp/lane-e-r9-before-behavior.log`. These are the prior-round
account-switch/durability defects addressed here; the comparison-read behavior
was already correct and needed coverage. The first attempt to run those tests
failed environmentally with missing `target/debug/snapback4` (`ENOENT`), before
any behavior ran. Rebuilding the lane's native binary fixed that precondition.

Temporary built-artifact mutations prove the comparison-read test fails if its
catch drops the deferred token, and the refusal/restart test fails if any HTTP
200 is treated as a revocation acknowledgement. Logs are
`/tmp/lane-e-r9-mutant-read-forgets.log` and
`/tmp/lane-e-r9-mutant-status-only.log`. Artifacts were restored after each probe.

## Qualification

- Affected suite: **177 passed, zero failures or skips**;
  `/tmp/lane-e-r9-affected-final.log`. All ten new cases also passed as a focused
  set (`/tmp/lane-e-r9-focused.log`).
- Native/package build and package typecheck passed.
- `./ref-check --verbose` passed: 504 LLP documents, 9,235 references in 25,615
  files, zero errors and zero unchecked references. `git diff --check` passed.
- Real Chromium offline-shell/replica witness passed with both servers stopped;
  `/tmp/lane-e-r9-browser-shell.log`.
- Cross-tab Chromium witness: **baseline intermittency reproduced**, detailed
  below; current code has successful runs, but this is not an unqualified pass.
- Full `scripts/test.sh`, first run: **`== 0 failure(s) in 380 s`**, exit 0;
  1,117 client passes across the main runner and seven shards, 10 skips, nine
  fixture passes. No introduced, baseline or environmental suite failure.
  Log: `/home/ccheever/sb4-intent/lane-e-r9-test.log`. The previously recorded
  worker shutdown race did not recur. Wasm measured 1,744,842 raw / 484,967 gzip
  bytes, within the unchanged 486,000-byte gzip budget.

## Baseline witness problem and reproduction

`node witness/app-sessions.mjs` intermittently reaches its final assertion with
Alice's successor still live: `timed out: Alice's successor revoked` at line 106.
The initial run failed. An instrumented run passed and observed the successor's
`/auth/logout` response `{ ok: true }`. Three further unmodified current-code
runs passed twice and failed once at that same assertion.

For comparison, the prior commit's `app.ts` was transpiled to a temporary module
outside the package, and the same witness aliased only `snapback4/app` to it.
Everything else, including the native server and unchanged client modules, was
identical. Those three baseline runs also passed twice and failed once with the
same successor-revocation timeout. The temporary witness was removed. Logs:
`/tmp/lane-e-r9-browser-{current,baseline}-{1,2,3}.log`; the instrumented trace is
`/tmp/lane-e-r9-browser-debug.log`. This establishes pre-existing intermittency;
it does not establish the underlying cause. The witness and unrelated logout
implementation were not changed to mask it, under the lane's baseline rule.

## Deviations and remaining limits

No deviation from the round 9 implementation scope, and no unresolved round 9
finding. The durable journal is the requested chosen design; its custody and
failure boundaries are stated above and in LLP 3000.013 §6. No client contract,
Quarry, native API, asset policy, authorization/disclosure rule or meter changed.
The baseline cross-tab witness intermittency remains open with the reproduction
above. Round 7's separately documented worker shutdown race was not changed.
