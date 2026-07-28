// Cursor presence — Contract surface Vite config (ENG-22479), on the
// exactContractWeb paved-road preset (ENG-22463; see the all-aboard config
// for the preset rationale). The surface talks to Snapback DIRECTLY at the
// defined origin: vite under `bun --bun` cannot complete proxied WebSocket
// upgrades, and the live socket is the presence transport.

import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { exactContractWeb } from '@exact/devtools/contract-web';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const snapbackTarget = process.env.SNAPBACK_CURSORS_API ?? 'http://127.0.0.1:4425';

// ENG-22757 (the ENG-22753 pattern): dev-only source-provenance probe. The
// acceptance suites reuse an already-running Vite only after this probe
// proves it serves THIS checkout's tree against THIS run's API origin (the
// Diary 0008 2026-07-01 :4420 gotcha: a Vite from a different working tree
// squatting the default port). The path and response shape pair with
// demos/_kit/provenance.mjs (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
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
          app: 'cursors-web',
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
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5184,
    strictPort: false,
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
