# Lane E round 8 — retain revocation across failed logout fences

Date: 2026-09-24. Branch: `sb4-intent/e-client`. Based on `7801e16a9`.
No push, publication or version bump.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Apply the same token-specific revocation decision to scoped `/auth/logout` fetches and retired sign-in responses. When a fence rejects, compare against the stored bearer under the existing session lock; revoke discarded tokens and defer the still-stored token. Retain deferred tokens across failed attempts and drain them after a successful logout retry. |
| `packages/snapback4/test/app.test.mjs` | Seven new real-server regressions: four held-response/retry cases, deferred revocation after an account replacement, the tombstone promotion window, and mutation of the caller's asset policy immediately after `createApp`. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document discarded-token revocation after a failed fence, deferred-token custody and logout retry. |
| `JOURNAL.md` | Append this round's implementation and qualification. |
| This report | Record the file map, examples, test evidence, decisions and full-suite result. |

Only revocation behavior needed a production change. The tombstone promotion
order and asset-policy snapshot were already correct; the added tests now
observe the previously untested windows and reject the reviewers' mutations.
The modified source is 455 lines and its test file is 855 lines. The README
remains unchanged at 296/300 lines.

## Existing forms and behavior

No new public API or Quarry syntax is introduced. The existing call remains:

```ts
const result = await app.auth.logout();
// If local storage failed, repair it and retry the same method.
const retry = await app.auth.logout();
```

When neither fence can be saved, logout still returns `{ ok: false, why }` and
protects the exact bearer remaining in storage. A discarded refresh successor
or login session differs from that bearer and is revoked even though the fence
failed. A later successful retry drains retained revocations, including a token
that another account has since replaced in storage. Responses arriving after
the retry are also revoked. Logout completion does not wait on remote requests.

The existing local configuration is captured synchronously:

```ts
const assets = { keep: "viewed" as const, maxBytes: 67108864 };
const app = createApp({ url, device, sessionStore, assets });
assets.maxBytes = -1;
await app.ready; // This app still opens with the captured valid budget.
```

Restoration keeps the bearer and opens the real process device. A subsequent
`createApp` using that now-invalid object would validate its own configuration
and refuse it as documented in round 7.

## Regressions and negative controls

- **Committed refresh, response before retry:** hold the real server response
  after rotation, make every store `set` throw, fail logout, and release it.
  The discarded successor receives `/auth/logout` and the server refuses it;
  the still-stored original token is not submitted for revocation.
- **Committed login, response before retry:** the equivalent login case also
  verifies that the original saved bearer remains live until successful logout.
- **Committed refresh and login, responses after retry (two cases):** repair
  storage and complete logout while each response is held. Releasing it cannot
  leave the discarded bearer live or reestablish a saved session.
- **Deferred-token custody:** fail the fence twice, preserving the stored token
  and making zero revocation calls. Another app replaces the saved account.
  Successful retry must revoke both the newly stored token and the earlier
  deferred token, even though the latter is no longer reachable from storage.
- **Promotion ordering:** create a logout tombstone with no epoch key, start
  sign-in, and hold the epoch write before it commits. Inspect the underlying
  store during that window: the tombstone must remain and `restoreSession` must
  return null. Only after the epoch becomes durable may the new bearer replace it.
- **Mutable caller configuration:** seed a real saved account, call `createApp`
  with a valid local policy, and immediately change that same object's budget
  to `-1`. Real local restoration succeeds with the same live bearer, no
  revocation, and no configuration refusal.

Before the fix, the held refresh/login cases with responses released before
retry and the deferred-token case failed: **3 failures, 4 passes** in
`/tmp/lane-e-r8-before.log`. These were defects in our prior round, fixed here.
All 48 app tests then passed, including the existing
negative test requiring zero deletion or revocation when neither durable fence
can be written.

Temporary built-artifact mutation checks fail as required:

1. Write the new session before promoting the tombstone epoch.
2. Pass the mutated caller policy instead of the captured policy.
3. Omit draining deferred tokens on a successful logout retry.

Logs: `/tmp/lane-e-r8-mutant-{promotion-order,mutable-assets,omit-drain}.log`.
The original built artifact was restored immediately after every probe.

## Qualification

- Affected suite: **167 passed, zero failed or skipped**;
  `/tmp/lane-e-r8-affected.log`.
- Package build and typecheck passed.
- Real Chromium session witness passed with separate tabs, shared localStorage,
  delayed rotation, logout/account switch and successor revocation;
  `/tmp/lane-e-r8-browser-sessions.log`.
- Real Chromium shell/replica witness passed, including offline reload and
  account restoration with both servers stopped;
  `/tmp/lane-e-r8-browser-shell.log`.
- Full `scripts/test.sh`: **`== 0 failure(s) in 147 s`**, exit 0 on the first
  run; `/home/ccheever/sb4-intent/lane-e-r8-test.log`. All **1,107 client cases
  passed**, with 10 platform/optional skips. The nine fixture-wrapper tests,
  Rust tests, builds, documentation checks, release guard and all typechecks
  passed. No introduced, baseline or environmental failure occurred.

## Decisions and limits

No scope deviation. The same stored-token comparison protects both revocation
paths, so a failed fence no longer cancels revocation of every session. If the
store cannot be read, revocation is conservatively deferred until a successful
logout retry. Deferred tokens remain owned by this runtime; they cannot be
persisted into a store whose writes are failing. Remote revocation keeps the
existing best-effort network behavior. No bearer, journal or storage format,
Client contract, authorization/disclosure rule, meter, native API, starter or
package version changed.

No unresolved round 8 finding remains. The baseline worker shutdown race and
its reproduction are recorded in [the round 7 report](./20260924-lane-e-round7.md).
That unrelated code was not changed, and its failure did not recur in this run.
