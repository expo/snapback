# Lane E 0.4.1 round — local options through createApp

Date: 2026-09-24. Branch: `sb4-intent/e-client`.
Fetched origin and merged `origin/main`; the merge fast-forwarded from
`d778b9266` to `ca6d975dabe40c125f395d27f6a99db01899382a` without conflicts.
No package version bump, push or publication.

## Changes, file by file

Paths are relative to `snapback4/`.

| File | Change |
|---|---|
| `packages/snapback4/src/app.ts` | Derive `AppOptions` from `LocalOptions`, with optional device and app-owned identity controls excluded. Forward application configuration on every local open, including `assets` and `waitSeconds`; retain the scoped session store and transport. Online opening ignores local configuration. |
| `packages/snapback4/test/client-seams.test.mjs` | Five new real-server cases: three asset policies across process-device offline reopen, local polling/identity ownership, and online exclusion of local configuration. |
| `packages/snapback4/test/fixtures/client-card.tsx` | Compile valid local/online option forms and reject invalid policy, byte-budget and polling types, app-owned identity options, and unknown properties. |
| `packages/snapback4/README.md` | Enable a 64 MiB viewed-media budget in the app object; render the avatar with `useAsset` and `Image`; describe viewing before offline reopening. 296/300 physical lines. |
| `packages/snapback4/CLIENT-AND-OPERATIONS.md` | Show asset retention in the paved app, media and Expo examples. Document local-only behavior, polling configuration and app-owned identity. |
| `JOURNAL.md` | Append this round's implementation and qualification. |
| This report | Record the merge, tests, decisions and full-suite result. |

## Forms that compile and run

```ts
const app = createApp({
  url,
  device: webDevice(),
  sessionStore: localStorageSessionStore(),
  assets: { keep: "viewed", maxBytes: 67108864 },
  waitSeconds: 1,
});
await app.ready;
```

`assets` has the same `AssetRetention` type as the local client, and
`waitSeconds` has its existing numeric type. Both are accepted without a
device (including `device: undefined`) and ignored on the online tier. Local
opens reuse the settings on restore and account change. New application
configuration fields added to `LocalOptions` are inherited and forwarded
without a second field list in `createApp`.

`AppProvider` and the existing hooks are unchanged. The README now calls
`useAsset(profile.data?.avatar?.id)` with a guarded query result and renders
the ready URI through React Native `Image`, so viewing the avatar populates
the configured cache before the documented offline-reopen journey.

## Tests and evidence

- **Viewed asset at the exact byte budget:** upload and place a real PNG,
  acquire its row, view it, close the app, disable the backend transport, and
  restore a new app over a new process client. The retained asset matches the
  original bytes, and its offline read makes no asset request.
- **Viewed asset over the byte budget:** the same journey with a budget one
  byte too small returns `E_OFFLINE`; forwarding cannot bypass the bound.
- **No retention:** the same journey with `keep: "none"` returns `E_OFFLINE`.
- **Polling and identity:** the real change-feed requests use the requested
  one-second interval. Excess `persona`, `guest` and `session` properties from
  an untyped caller do not replace the account established through `app.auth`.
- **Online exclusion:** throwing accessors for the local settings are never
  read during restore/sign-in, mutation or query without a device.
- **Typing:** valid settings compile for either tier. `@ts-expect-error`
  assertions keep literal policies, numeric budgets/intervals, identity
  ownership and rejection of unknown fields precise.

Before implementation, the retained-asset case failed with `E_OFFLINE`, the
polling case observed 25 seconds instead of 1, and the compile fixture rejected
`assets`. `/tmp/lane-e-041-before.log` records those three expected failures.
The first post-fix focused run exposed an example error introduced here:
`app.client` is the common `Client`, whose public type does not include
device-only `sync`. Removing that call fixed the example without expanding
the Client contract. `/tmp/lane-e-041-focused.log` records that corrected
failure; the subsequent README/type checks pass.

Verification:

- Frozen Bun install, native binary build, package build and typecheck passed.
- Wasm rebuilt after merging main: 1,744,842 B raw, 484,967 B gzip, within
  the inherited 486,000 B budget. This is a whole-artifact measurement, not
  an attribution to this TypeScript change.
- README/documentation tests: **8 passed**; first-account examples compile
  against their generated API and run on both online and local clients.
- README budget and self-contained first-screen check: **296/300**, passed.
- Affected suite: **162 passed, 1 skipped, zero failures**. The skip requires
  macOS Foundation and AVFoundation for Expo native media storage.
  `/tmp/lane-e-041-affected.log` covers app/session/custody/storage, real client
  seams, assets, React, README, first-account and local sign-out behavior.
- Final `scripts/test.sh`: **`== 0 failure(s) in 171 s`**, exit 0.
  `/home/ccheever/sb4-intent/lane-e-041-test.log`. Across all eight client test
  processes, **1,093 passed, 10 skipped, zero failed**; the nine fixture-wrapper
  tests also passed. Cargo tests, builds, wasm, documentation budget, release
  guard and package/reference-app typechecks passed. No baseline or
  environmental failure occurred. The four old Rust baseline failures were
  already fixed in the merged main; none recurred.

## Decisions and limits

Identity selectors (`persona`, `session`, `guest`) remain lower-level client
controls. `createApp` owns those through its auth lifecycle; forwarding them
could select a different identity from the account it publishes. They remain
excluded from `AppOptions`, and untyped excess selectors are stripped or
overridden at local opening. The app's normalized URL, current session,
guarded session store and scoped fetch take precedence over forwarded settings.
The shared `url`, `fetch` and `sessionStore` options retain their existing
behavior on both tiers. Device tuning (`assets`, `waitSeconds`) is explicitly
local-only at the app level.

No deviation from the requested scope. No new Quarry forms, native host API,
Client contract, authorization rule, retention semantics or meter changed.
No calibration #19 app, generated starter template or package version was
modified. The requested offline-media proof uses the real process device and
server; it does not claim an Expo simulator or browser witness for this round.
No open problem from this change remains. No final test failure needs a
reproduction; the pre-fix reproducers and corrected intermediate example
failure are recorded above.
