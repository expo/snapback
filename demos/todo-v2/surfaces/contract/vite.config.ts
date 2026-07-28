// Todo v2 — Contract surface Vite config (ENG-22487: paved-road preset;
// ENG-23899: registry packages, matching the All Aboard shape from
// ENG-22480).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) composes the Contract
// compiler plugin and the Exact app plugin — `vite` dev with the agent
// surface AND a production `vite build` — with external-surface-safe
// defaults: shell 'auto' preserves this surface's own ./index.html, the
// agent-readiness audit is off, and no native static artifacts or desktop
// manifests are emitted. It also excludes wa-sqlite from optimizeDeps
// (data: 'snapback') and fails builds whose client chunks leak Node/
// native-only modules.
//
// ENG-22480 consumption model: Exact is consumed from the npm registry —
// `@exact/*` imports resolve through npm alias dependencies to the published
// `@ccheever/exact-*` packages (see package.json), and `bun.lock` pins the
// exact bits (it replaced `exact.pin.json`). No sibling checkout, no
// `SNAPBACK_EXACT_ROOT`, no source aliases: the preset itself is imported
// from this surface's own node_modules. The packages ship TS source, so the
// vite binary runs under bun (`bun --bun node_modules/.bin/vite`, see the
// package.json scripts).

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { exactContractWeb } from '@exact/devtools/contract-web';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const snapbackTarget = process.env.SNAPBACK_TODO_V2_API ?? 'http://127.0.0.1:4421';

// ENG-22753-style dev-only source-provenance probe (see
// demos/_kit/provenance.mjs): proves a reused Vite serves THIS checkout's
// tree against THIS run's API origin.
const sourceProvenanceProbe = {
  name: 'snapback-source-provenance',
  configureServer(server: {
    middlewares: {
      use: (
        path: string,
        handler: (
          req: unknown,
          res: { setHeader: (k: string, v: string) => void; end: (body: string) => void },
        ) => void,
      ) => void;
    };
  }) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'todo-v2',
          surface: 'contract',
          root: realpathSync(__dirname),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default () => ({
  root: __dirname,
  plugins: [
    snapbackDev({
      server: { mode: 'off' },
      generatedRoots: [resolve(__dirname, '../../snapback/generated')],
    }),
    sourceProvenanceProbe,
    exactContractWeb({
      data: 'snapback',
      app: { entry: '/main.ts' },
    }),
  ],
  define: {
    // The surface talks to Snapback DIRECTLY at this origin (HTTP under the
    // server's loopback CORS; the live WebSocket needs no CORS). Direct is
    // the all-aboard pattern and sidesteps a real bug: vite under `bun --bun`
    // never completes proxied WebSocket upgrades, and the hung upgrade wedges
    // subsequent proxied HTTP requests too.
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: false,
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        // The live stream (LLP 0034 D1) is a WebSocket at
        // /snapback/live/{connection}/stream; without ws:true the proxy
        // never upgrades and the browser surface can only poll.
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
