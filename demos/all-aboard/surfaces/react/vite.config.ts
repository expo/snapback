// All Aboard — React surface Vite config.
//
// Unlike the Contract surface, this needs no sibling Exact checkout and no
// aliases: the toolchain is stock `vite` + `@vitejs/plugin-react` resolved from
// this directory's own node_modules. The wiring shared with the Contract arm is
// the `/snapback` proxy to the demo API server plus the direct-origin define:
// the surface talks to Snapback DIRECTLY at __SNAPBACK_API_ORIGIN__ (HTTP under
// the server's loopback CORS; the live WebSocket needs no CORS), because vite
// under `bun --bun` never completes proxied WebSocket upgrades — the same bug
// the Contract arm sidesteps the same way.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

// ENG-22753: dev-only source-provenance probe. The acceptance suites reuse an
// already-running Vite only after this probe proves it serves THIS checkout's
// tree against THIS run's API origin (the Diary 0008 2026-07-01 :4420 gotcha:
// a Vite from a different working tree squatting the default port). The path
// and response shape pair with demos/_kit/provenance.mjs
// (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
const sourceProvenanceProbe: PluginOption = {
  name: 'snapback-source-provenance',
  configureServer(server) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'all-aboard',
          surface: 'react',
          root: realpathSync(__dirname),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default defineConfig({
  root: __dirname,
  plugins: [
    snapbackDev({
      server: { mode: 'off' },
      generatedRoots: [resolve(__dirname, '../../snapback/generated')],
    }),
    react(),
    sourceProvenanceProbe,
  ],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5179,
    strictPort: false,
    fs: {
      // The surface imports the shared transit model + generated manifests from
      // ../../snapback and the shared client from ../../../_kit.
      allow: [resolve(__dirname, '../../../..')],
    },
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        // The live stream (LLP 0034 D1) is a WebSocket at
        // /snapback/live/{connection}/stream; without ws:true the proxy never
        // upgrades. Kept as the fallback path when the define is absent.
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
