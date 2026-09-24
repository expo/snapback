# Lane E round 7 — 0.4.1 delta review fixes

Date: 2026-09-24. Branch: `sb4-intent/e-client`. Based on `06a2f84c0`.
All round 7 findings are addressed. No push, publication or version bump.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Persist a logout fence before removing/revoking credentials. If the epoch key fails, shrink the session into a durable tombstone and retain it. Read both epoch locations under the existing session lock; preserve that epoch before a later sign-in replaces a tombstone. Hold remote revocation and retiring-session cleanup behind the durable logout result. Validate and snapshot local asset configuration before restoration or sign-in. |
| `packages/snapback4/src/app-storage.ts` | Recognize the private, noncredential logout tombstone and its decimal epoch. |
| `packages/snapback4/src/auth.ts` | `restoreSession` returns null for a tombstone without deleting it. |
| `packages/snapback4/src/local-assets.ts` | Shared asset-policy validation and snapshot; document `maxBytes` as a nonnegative safe integer byte budget. |
| `packages/snapback4/src/local.ts` | Reuse that validation for lower-level clients without changing their retention behavior. |
| `packages/snapback4/bin/web-shell.js` | Resolve a trailing-slash navigation to slash-stripped `.html` before trying its directory index or the root fallback. |
| `packages/snapback4/test/app.test.mjs` | Seven new real-server regression cases; update two earlier quota assertions for the durable tombstone behavior. |
| `packages/snapback4/test/client-seams.test.mjs` | Require `wait=30` on real local change-feed requests after both sign-in and restoration. |
| `packages/snapback4/test/web-shell.test.mjs` | Check `contact/` and `contact/?from=home` online and offline at `/` and `/chat/`, including `.html` priority when a directory index also exists. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Document the fence fallback, storage failure/recovery behavior, asset validation and trailing-slash routing. |
| `JOURNAL.md` | Append the dated round 7 implementation and qualification entry. |
| This report | Record examples, regressions, measurements and limits. |

The README remains unchanged at 296/300 lines. No source file exceeds 1,500
lines; `local.ts`, the largest modified source, has 1,488 lines.

## Forms that compile and run

The existing paved configuration remains:

```ts
const app = createApp({
  url,
  device: webDevice(),
  sessionStore: localStorageSessionStore(),
  assets: { keep: "viewed", maxBytes: 67108864 },
  waitSeconds: 30,
});
await app.ready;
```

Local opening and restoration use the supplied media budget and polling duration.
Without `device`, these local options remain ignored. An invalid local budget
such as `maxBytes: -1` or `1.5` produces `{ ok: false, why }` from `ready` and
sign-in, with `E_CLIENT`, site `app.assets` and a concrete `createApp` rewrite.
It makes no session-store or network calls and preserves the saved live bearer.

`await app.auth.logout()` completes without network revocation round trips. When
the epoch key is unavailable but a smaller session overwrite succeeds, logout
saves a tombstone. `await restoreSession(url, store)` then returns null while
retaining the fence. A held refresh or login from an earlier epoch cannot
install its late bearer; that bearer is revoked in the background.

`npx snapback4 web-shell dist --base /chat/` now serves cached `contact.html`
for `/chat/contact/`, including query strings, before trying
`contact/index.html`. The active build supplies HTML both online and offline.
No new Quarry syntax or public API is added.

## Regression evidence

The seven new app cases cover:

- **Held refresh and held login, epoch-only failure (two cases):** the store
  rejects `.epoch` writes but permits session overwrites. The late token cannot
  restore the account; direct and app restoration retain the tombstone. A new
  sign-in cannot erase the sole epoch copy. After storage repair a new account
  signs in, and the server refuses the discarded token.
- **The same two races with quota limits (two cases):** reads, deletes,
  unchanged writes and shrinking overwrites work, but allocation/growth fails.
  The epoch stays unwritable while the other app's held response is released.
- **Neither fence can be written:** logout reports the storage error, makes
  zero bearer deletes and zero remote revocations, and preserves the exact
  stored session. Repairing storage and retrying logout clears it.
- **Negative and fractional asset budgets (two cases):** a saved real session
  survives the configuration error byte-for-byte, remains accepted by the
  server, and restores through a real process device after correcting the budget.

The earlier offline quota cases now require zero session deletes and a retained
tombstone. A successful fallback is a successful logout even when the separate
marker remains unwritable; a second marker attempt uses the space freed by the
smaller value. This deliberately replaces their old delete-first expectations.

The polling test clears captured requests after online restoration, makes a
write to wake the current long poll, and requires the next `/changes` request
to carry `wait=30`. Asset-retention, exact-budget, under-budget, online-ignore,
identity ownership, session races, React and documentation checks still pass.

Before the fixes, seven focused cases failed as expected (both initial quota
races, neither-fence failure, both invalid budgets and both navigation bases),
recorded in `/tmp/lane-e-r7-before.log`. Mutation checks against temporary built
artifacts also fail as required when:

- tombstones are ignored by `readEpoch`;
- `waitSeconds` is always forwarded as `1`;
- `waitSeconds` is forwarded as `1` only during restoration.

Their logs are `/tmp/lane-e-r7-mutant-{ignore-tombstone,wait-constant,wait-restore}.log`.
The artifacts were restored immediately after each probe. The first build caught
an introduced `exactOptionalPropertyTypes` error in the validated asset forwarding;
using the value known to exist for a valid local open fixed it before qualification.

## Qualification

- Affected tests: **160 passed, zero failed or skipped**, including all seven
  new app cases; `/tmp/lane-e-r7-affected.log`.
- Package build and typecheck passed.
- Real Chromium two-page session witness passed: distinct realms, shared
  localStorage, delayed save serialized with logout, Bob restored and successor
  revoked; `/tmp/lane-e-r7-browser-sessions.log`.
- Real Chromium offline shell/replica witness passed with both backend and
  shell server stopped; `/tmp/lane-e-r7-browser-shell.log`.
- First full suite: **`== 1 failure(s) in 185 s`**, exit 1. Its only failure was
  `W7r1 runWorker and doctor observe deferred presence effects` at
  `packages/snapback4/test/worker.test.mjs:655`: expected no errors but received
  `AbortError: This operation was aborted`. **Baseline / pre-existing shutdown
  race**, not introduced here; see the reproduction below. Both worker cases
  passed immediately in isolation (`/tmp/lane-e-r7-worker-recheck.log`). The
  original host baseline and the prior round also passed this timing-sensitive
  case. The failed full log is
  `/home/ccheever/sb4-intent/lane-e-r7-test-first.log`.
- Final `scripts/test.sh`: **`== 0 failure(s) in 154 s`**, exit 0, without
  further code changes or weakened assertions. All 1,100 client tests passed;
  10 platform/optional checks were skipped. The nine fixture tests, Rust tests,
  builds, documentation budget, release guard and typechecks passed.
  `/home/ccheever/sb4-intent/lane-e-r7-test.log`. No failure remained in the final
  run. The first run's sole baseline failure and reproduction are retained above.

## Decisions, deviations and remaining limits

No deviation from the round 7 scope. The success result for a durable tombstone
replaces the previous round's error for a failed separate epoch marker: the
local logout boundary is now durable. If both writes fail, credentials remain
and logout must be retried after storage repair. A sign-in cannot replace a
fallback tombstone until its epoch is saved separately. This deliberately
preserves the authorization boundary when storage remains broken.

TypeScript has no integer primitive: `maxBytes` remains precisely a `number`
with the documented nonnegative safe-integer requirement enforced at runtime,
preserving existing call sites. No authorization/disclosure, meter, native API,
Client contract or asset retention rule changed. No new refusal code was added.
No open problem from the round 7 fixes remains. Existing non-browser stores
shared across processes still require a single app writer; browser tabs use
Web Locks.

One unrelated baseline problem remains: the worker presence test stops the worker
as soon as SQLite says its effect is sent, which can abort the still-unread HTTP
settlement response. `runWorker` then attempts failure settlement and reports the
abort. The worker source and test are unchanged by this round. The source is
byte-identical to HEAD (`sha256 c210b0af0deb678d3f622c23b4d828752b626af76454efdafac2206f30e8d65f`);
it has no runtime dependency on the changed app/session modules.

A deterministic reproduction is recorded in
`/tmp/lane-e-r7-worker-shutdown.mjs`: call `runWorker` with one `notify` effect
and a fetch stub that answers `/claim` with that effect, then aborts the worker
and throws `DOMException("This operation was aborted", "AbortError")` for `/done`.
The failure-settlement fetch calls `signal.throwIfAborted()`. `worker.done`
resolves but `onError` receives the same abort as the full-suite failure. This
models the test's observed database commit preceding response consumption. It
reproduces with the unchanged worker; no production code or assertions for this
unrelated behavior were modified, per the lane's baseline rule.
