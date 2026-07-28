// Shindig — React surface Vite config. Same topology as the cursors-web
// React arm: the surface talks to Snapback directly at the defined origin
// (local-dev CORS), with a `/snapback` proxy fallback for manual poking, and
// the dev-only source-provenance probe so acceptance suites can refuse a
// squatting Vite from another checkout (the Diary 0008 :4420 gotcha).

import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const snapbackTarget = process.env.SNAPBACK_SHINDIG_API ?? 'http://127.0.0.1:4431';
const surfaceRoot = dirname(fileURLToPath(import.meta.url));

const sourceProvenanceProbe: PluginOption = {
  name: 'snapback-source-provenance',
  configureServer(server) {
    server.middlewares.use('/__snapback/source', (_req, res) => {
      res.setHeader('content-type', 'application/json');
      res.end(
        JSON.stringify({
          app: 'shindig',
          surface: 'react',
          root: realpathSync(surfaceRoot),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};

export default defineConfig({
  plugins: [
    snapbackDev({
      server: { mode: 'off' },
      generatedRoots: [resolve(surfaceRoot, '../../snapback/generated')],
    }),
    react(),
    sourceProvenanceProbe,
  ],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5187,
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
