# Clique — incomplete Snapback 3 diagnostic

This is a partial account/profile app, not a completed messenger. M1 is aborted because the installed S3 worker rejects media; all later continuous milestones are blocked by M1. The exact failing schema and diagnostic are retained under `evidence/m1-media-*`.

Use Node `/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node` (v24.13.1). The immutable tarball remains the only backend dependency. Do not modify the frozen `ui`, `choreography`, or `metering` copies.

```
npm ci
npm run check
npm run build:web
npm start
```

The S3 owner serves the Expo web export on `http://127.0.0.1:54800`. `scripts/server.mjs` records its PID. Only kill that recorded PID when finished.

```
npm run seed -- --segment m1
```

This command intentionally exits nonzero at the first unsupported avatar action. It does not certify an installed segment. To reproduce only the supported profile browser checks, use the explicitly nonconforming diagnostic textual fixture load:

```
npm run seed -- --segment m1 --diagnostic-text-only
npm run acceptance -- --milestone m1
node scripts/setup-identity.mjs
/home/ccheever/.local/node-v24.13.1-linux-x64/bin/node scripts/choreography.mjs
npm run build:ios
```

Acceptance remains nonzero for avatar upload/render and emits `evidence/m1-coverage.json`, `evidence/m1-suite.json`, and `suite-status.json`. The choreography wrapper sets `CHOREO_BASE_URL`, obtains credentials only from the frozen fixture file, and invokes the unchanged harness. A passing browser choreography does not override the red suite. M2/M3 seed commands and later acceptance selections fail with `blocked-by-M1`; no later behavior or coverage is claimed.

The build artifacts are `dist/` and `artifacts/m1-ios/`. The latter includes Hermes bytecode and is not native simulator proof. Linux native unavailability is recorded in `artifacts/native-status.json`. Native storage in this partial app is ephemeral; native session/offline behavior is not implemented or claimed.

Account/profile behavior uses `snapback3/client` and `snapback3/react`, with server-authorized Quarry operations. A separate `scripts/auth-probe.mjs` checks short-password rejection, a future token expiry, and old-token refusal after logout. No alternative storage backend or media encoding workaround exists.

Read `final-report.md`, `run-log.md`, `diary.md`, and `essay.md` for limits and evidence. There is no M6 messaging custom-client API or scale replay adapter because the frozen prerequisite DAG blocked those milestones.
