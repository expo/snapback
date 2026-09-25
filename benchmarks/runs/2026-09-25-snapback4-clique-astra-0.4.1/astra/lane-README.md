# Clique

An Expo Router social messenger backed entirely by Quarry, using exact public packages `snapback4@0.4.1` and `snapback4-expo@0.4.1`.

Use Node 24.18.0. From this directory:

```sh
npm install
npm run configure:grading
npx snapback4 check
npx snapback4 dev --port 49360
```

In another terminal:

```sh
npm run seed -- --segment m1
npm run seed -- --segment m2
npm run seed -- --segment m3
npm run build:web
node scripts/serve.mjs
```

Open `http://127.0.0.1:49361`. Starter login: `alice@example.com` / `Alice!Clique2026` (likewise Bob, Carol, and the other fixture personas). Sessions persist. The seeded accounts use real password authentication; development persona shortcuts are not the app's login path.

Run `npm run acceptance -- --milestone m1` (also m2–m6, m8). Run matching frozen choreography with `CHOREO_BASE_URL=http://127.0.0.1:49361 node scripts/choreo.mjs m1`. Install its browser first with `cd choreography && PLAYWRIGHT_BROWSERS_PATH=./browsers npx playwright install chromium` when moving this workspace to a new host.

`npm run build:ios` exports a current Hermes bundle. The milestone exports are preserved under `artifacts/ios-m1` through `ios-m6`, and `ios-m8`. `npm start` uses the permitted Metro port 49365. Native custom builds carry the installed native replica; Expo Go uses the online fallback.

Read [CONFIGURATION.md](CONFIGURATION.md) for shortened versus production windows, digest scheduling, push-worker startup, offline acquisition and the scale instance. Read [API.md](API.md) for standalone client authentication and the complete message API. The run's results, scope limits and evidence links are in [final-report.md](final-report.md).
