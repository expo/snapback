// Cursor presence — React control-arm Vite config (ENG-22531). Stock Vite +
// @vitejs/plugin-react; no framework preset. Transport topology matches the
// Contract arm deliberately: the surface talks to Snapback DIRECTLY at the
// defined origin (the server sends local-dev CORS headers), so the two arms
// ride identical wire paths and the comparison stays controlled. The
// `/snapback` proxy remains as a fallback for manual poking.

import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';

const snapbackTarget = process.env.SNAPBACK_CURSORS_API ?? 'http://127.0.0.1:4425';
// This config is ESM (.mts), so the surface root comes from import.meta.url.
const surfaceRoot = dirname(fileURLToPath(import.meta.url));

// ENG-22757 (the ENG-22753 pattern): dev-only source-provenance probe. The
// acceptance suites reuse an already-running Vite only after this probe
// proves it serves THIS checkout's tree against THIS run's API origin (the
// Diary 0008 2026-07-01 :4420 gotcha: a Vite from a different working tree
// squatting the default port). The path and response shape pair with
// demos/_kit/provenance.mjs (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
const sourceProvenanceProbe: PluginOption = {
  name: 'snapback-source-provenance',
  configureServer(server) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'cursors-web',
          surface: 'react',
          root: realpathSync(surfaceRoot),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default defineConfig({
  plugins: [react(), sourceProvenanceProbe],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: false,
    fs: {
      // The surface imports the shared demo kit and the generated Snapback
      // artifacts from the repo, two directories above this package root.
      allow: ['../../../..'],
    },
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
