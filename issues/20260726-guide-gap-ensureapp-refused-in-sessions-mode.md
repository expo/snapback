# guide-gap: `ensureApp({ schema, functions, seed })` is refused in sessions mode

**Filed:** 2026-07-26 · **Source:** building `demos/partitime/backends/snapback`
**Status:** open

## What happened

The guide teaches `db.ensureApp({ schema, functions, seed })` as *the*
idempotent boot rule — `guide/getting-started/your-first-backend.md` ("the
idempotent form") and `guide/clients/headless.md` ("Start app boot with
`health()`, then `ensureApp({ schema, functions, seed })`"). Against an app
whose schema declares `auth: { mode: 'sessions' }`, it fails:

```
SNAPBACK_AUTH_POLICY_UNAVAILABLE: this operation is unavailable under the active auth policy
```

## Cause

`src/server.rs` registers three `/app/ensure` operations. `app.ensure.legacy`
carries `SessionModeOverlay { effect_policy: Some(EffectPolicy::Unavailable), .. }`.
The legacy body shape `{schema, functions, seed}` is the only shape
`SnapbackClient.ensureApp()` can send (`packages/snapback-client/index.mjs`),
so the documented client method is exactly the shape sessions mode refuses.

The admitted shape is the explicit provision intent, with an admin credential:

```json
{"intent":"provision","requestedMode":"sessions","schema":…,"functions":…,"seed":…}
```

No client method sends it; the Partitime backend hand-writes the `fetch`.

## Why it matters

Sessions mode is the auth mode the guide teaches as "the real thing", and the
boot rule it teaches does not work with it. Neither
`guide/auth/sessions-and-principals.md` nor
`guide/getting-started/your-first-backend.md` mentions the restriction; the
card-game demo avoids it by loading its app through the startup-artifacts
carrier and never calling ensure.

## Fix candidates

1. Teach the `intent: "provision"` form on both guide pages, with the
   admin-credential requirement.
2. Add an `intent`/`requestedMode` option to `SnapbackClient.ensureApp()` so
   the paved client method works in both modes.
