# `snapback verify` admission stage fails for every sessions-auth app: index schemaVersion v0 vs manifest v1

**Date:** 2026-08-05 · **Found by:** LLP 0183 Stage 0.5 control scaffold validation

## Symptom

`snapback verify <backend>` fails `admission-and-conformance` with
`SNAPBACK_VERIFY_ADMISSION_IDENTITY_MISMATCH`:

```
{"manifest":"schema","key":"schemaVersion","expected":"snapback.v0","observed":"snapback.v1"}
{"manifest":"functions","key":"schemaVersion","expected":"snapback.v0","observed":"snapback.v1"}
```

Reproduced on both `demos/zerobugs/control` (new) and `demos/card-game`
(landed, green) with a freshly qualified runtime receipt — so this affects
every `auth: { mode: 'sessions' }` app, not one scaffold.

## Cause

- `packages/snapback-codegen/index.mjs` line ~1226: sessions apps emit
  schema/functions manifests with `SESSIONS_SCHEMA_VERSION = 'snapback.v1'`.
- Line ~4078: `legacyArtifactIndex.schemaVersion` is hardcoded
  `SCHEMA_VERSION = 'snapback.v0'` regardless of auth mode.
- `packages/snapback-cli/verify.mjs` `probeAdmission()` (~line 320) compares
  each manifest's `schemaVersion` against `identity.schemaVersion`, where
  `identity` is built from the artifact index (~line 276) — guaranteed
  mismatch for sessions apps.

`verify.test.mjs` only exercises `snapback.v0` fixtures, which is why this
never failed in CI.

## Fix directions (pick one, keep Rust-derived schema validation green)

1. Make the index carry the auth-mode-appropriate `artifactVersion` (check
   whether the committed Rust-derived index schema pins `snapback.v0` — if so
   that schema needs the same widening), or
2. teach `probeAdmission` the per-auth-mode expected manifest version instead
   of assuming index==manifest equality.

Either way add a sessions-app fixture to `verify.test.mjs`.

## Resolution

Resolved on 2026-08-05 with direction 1. The DK-7 validation block validates
the Rust-owned schema and function manifests against the auth-mode
`artifactVersion`, and validates the independently versioned capability
manifest against `snapback.v0`; it does not validate the codegen-owned review
index. The review index's own committed JavaScript schema permits either app
artifact version. `legacyArtifactIndex.schemaVersion` therefore now carries
`artifactVersion`, so a sessions app's index, schema manifest, and function
manifest all identify `snapback.v1` while the Rust-owned capability manifest
retains its independent `snapback.v0` format.

`probeAdmission()` was not weakened: its exact `appId`, `schemaHash`,
`bundleHash`, and `inputsHash` comparisons are unchanged. A regression in
`packages/snapback-cli/verify.test.mjs` generates the existing sessions-auth
push-seam fixture, runs the real freshness probe, and requires local admission
to pass with the v1 identity. The codegen auth-artifact test now also pins the
review index to v1 for sessions apps.

The committed review manifests were regenerated with each app's generate
command for the sessions-mode direct demos: Campfire, Card Game, File Drop,
Party Wall, RBAC, Signal Desk, Triage Graph, and the ZeroBugs control. The
first seven changed only the index `schemaVersion`; the control also preserves
its pre-existing, related `artifactSchemaVersion` v1 regeneration delta.

Validation:

- `node --test packages/snapback-cli/verify.test.mjs` passes (17 cases).
- `node packages/snapback-codegen/auth-artifacts.test.mjs` passes.
- The full `@expo/snapback-cli` package command was run. Its first two tests
  passed, then the managed sandbox refused `fake-expo-push.test.mjs`'s
  localhost listener with `listen EPERM 127.0.0.1`; individually runnable
  remainder tests included green verify, generated-load, hosted-admission,
  agent-setup, diagnostics, and hosted-control coverage (the latter with a
  writable temporary npm cache), while lifecycle/listener tests were likewise
  environment-blocked.
- With the requested debug runtime, both `demos/zerobugs/control` and
  `demos/card-game` passed all five `snapback verify --json` stages, including
  `admission-and-conformance` and capability resolution. Both had no registered
  acceptance profiles, so their receipts honestly record
  `no-registered-acceptance-paths` and make no D1 aggregate-coverage claim.
  Card Game's temporary runtime-readiness receipt was removed afterward.
