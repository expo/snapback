// Todo — Contract surface Vite config (ENG-22487: paved-road preset, matching
// the All Aboard shape from ENG-22463), migrated onto the LLP 0030 managed-dev
// plugin (LLP 0079 SC-2a).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) composes the Contract
// compiler plugin and the Exact app plugin with external-surface-safe
// defaults; Exact comes from the npm registry through the alias dependencies
// in package.json (ENG-22564) and bun.lock is the reproducibility pin.
//
// `snapbackDev` replaces the old hand-rolled `/snapback` proxy + separate
// server terminal: one `bun run dev` attaches to an already-running backend
// through the ready-file handshake or spawns a managed child, loads this
// demo's generated schema/functions and seed during bring-up (the browser no
// longer provisions anything), and relays only allowlisted app routes at
// `/__snapback`. Setting SNAPBACK_TODO_API selects external mode instead:
// proxy to that URL, no lifecycle ownership, no destructive setup.
//
// Known limit, unchanged from the old proxy: under `bun --bun` the dev server
// never surfaces HTTP upgrade events, so the live WebSocket cannot relay and
// the surface falls back to outbox polling (same as graffiti/cursors-web's
// findings; the @snapback/vite package test proves WS-through-relay under a
// node-run Vite server, per LLP 0030's dedicated-WS-test allowance).

import { join } from 'node:path';

import { exactContractWeb } from '@exact/devtools/contract-web';

import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const demoRoot = join(__dirname, '..', '..');
const repoRoot = join(demoRoot, '..', '..');
const externalTarget = process.env.SNAPBACK_TODO_API ?? null;

export default () => ({
  root: __dirname,
  plugins: [
    snapbackDev({
      projectRoot: __dirname,
      generatedRoots: [join(demoRoot, 'snapback', 'generated')],
      server: externalTarget
        ? { mode: 'external', url: externalTarget }
        : {
            mode: 'auto',
            db: join(__dirname, '.snapback', 'dev.sqlite3'),
            readyFile: join(__dirname, '.snapback', 'dev.ready.json'),
            runtimeBinary:
              process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
          },
      setup: externalTarget ? false : { backendDirectory: join(demoRoot, 'snapback') },
      // The exactContractWeb preset pins `server.host: true` (LAN exposure
      // for device/native testing), which the Snapback plugin refuses by
      // default. Opting in is a deliberate, visible decision: the plugin
      // still emits SNAPBACK_DEV_HOST_EXPOSED, and the relay only forwards
      // the app-route allowlist — unlike the old full-root /snapback proxy.
      allowNonLoopbackHost: true,
    }),
    exactContractWeb({
      data: 'snapback',
      app: { entry: '/main.ts' },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: false,
  },
});
