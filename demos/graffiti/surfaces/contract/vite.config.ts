// Graffiti wall — Contract surface Vite config, on the exactContractWeb
// paved-road preset (ENG-22463; see the all-aboard config for the preset
// rationale). Like cursors-web, the surface talks to Snapback DIRECTLY at the
// defined origin: vite under `bun --bun` cannot complete proxied WebSocket
// upgrades, and the live socket carries both the durable wall stream and the
// ephemeral presence lane. ENG-22564 moves the LLP 0281 channel + rated-
// publish grammar and the `ephemeral` binding onto reproducible registry
// packages pinned by this surface's bun.lock.

import { join } from 'node:path';

import { exactContractWeb } from '@exact/devtools/contract-web';

// Channel A serving seam (LLP 0090 D2 rollout step 3 / LLP 0092 §0E.3):
// graffiti adopts the `packages/snapback-vite` seam as a composable plugin
// beside the Exact preset (0092 OQ-C's first option — the preset stays
// untouched; the seam owns route matching, the anonymous read-mode bundle
// evaluation against the backend, the HTML-safe embed, no-store response
// mechanics, and degrade-to-shell). Imported relatively like the rest of the
// demo's repo-local modules; the plugin is dependency-free by design.
import { snapbackChannelA } from '../../../../packages/snapback-vite/channel-a.mjs';

const snapbackTarget = process.env.SNAPBACK_GRAFFITI_API ?? 'http://127.0.0.1:4431';
const generatedDir = join(__dirname, '..', '..', 'snapback', 'generated');

export default () => ({
  root: __dirname,
  plugins: [
    // Before the Exact preset so the seam sees matching document requests
    // first; unmanifested (or degraded) requests fall through untouched.
    snapbackChannelA({
      origin: snapbackTarget,
      routesManifestPath: join(generatedDir, 'routes.manifest.json'),
      functionsManifestPath: join(generatedDir, 'functions.manifest.json'),
    }),
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
    port: 5179,
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
