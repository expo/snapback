# Clique

Expo Router social messenger backed by **snapback4@0.4.9**, with **snapback4-expo@0.4.9** for the native replica. The complete application backend is in `snapback/schema.q` and the generated fixture configuration in `snapback/config.q`. `snapback/workers/push.mjs` is the replaceable notification delivery seam.

Use Node 24.18.0. On this host, put `/Users/ccheever/.volta/tools/image/node/24.18.0/bin` first on PATH. From this lane:

```sh
npm install
npm run backend
```

In another shell, seed the starter segments in order and serve the exported web app:

```sh
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npm run build:web
npm run serve:web
```

Open http://127.0.0.1:49361. Fixture credentials are in `instrument/fixtures/personas.json`. Starter installation is idempotent per installed segment. The backend uses 49360; optional Expo development uses 49367. These commands do not choose ports outside the lane allocation.

```sh
npm run acceptance -- --milestone m8
node scripts/choreo.mjs m8
npm run export:ios
```

Acceptance supports m1, m2, m3, m4, m5, m6 and m8. Choreography receives `CHOREO_BASE_URL` through its lane wrapper and writes its receipts in `evidence/`. Tests create real application data. M8's suite creates an unliked Insights test post; run it before retrying M8 choreography. The kit and choreography copies remain unchanged.

`CONFIGURATION.md` explains shortened/production windows and digest periods. `API.md` documents the custom-client interface and demo. `coverage-manifest.json` maps every required suite assertion. Hermes exports for each milestone live under `artifacts/`; the final M8 export is `artifacts/m8-ios-release`. Expo Go uses the online fallback; a native replica requires the installed Expo module in a development or production native build.

`run-log.md`, `diary.md`, `essay.md`, and `final-report.md` retain the build evidence and limitations. M7 was explicitly excluded. No external push service is contacted; provider receipts are logged. The scale corpus is in a separate instance, with the first contaminated attempt preserved separately and excluded from the clean replay result. Replaying again requires a new directory and an unused allocated port, because the adapter refuses to reuse the completed scale instance.

Web exports clear Metro's transform cache and explicitly bind the backend URL. Set `EXPO_PUBLIC_SNAPBACK_URL` deliberately when exporting an alternate measurement client; never reuse its build as the main client.
