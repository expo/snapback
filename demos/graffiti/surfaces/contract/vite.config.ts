// Graffiti wall — Contract surface Vite config, on the exactContractWeb
// paved-road preset (ENG-22463; see the all-aboard config for the preset
// rationale). Like cursors-web, the surface talks to Snapback DIRECTLY at the
// defined origin: vite under `bun --bun` cannot complete proxied WebSocket
// upgrades, and the live socket carries both the durable wall stream and the
// ephemeral presence lane. ENG-22564 moves the LLP 0281 channel + rated-
// publish grammar and the `ephemeral` binding onto reproducible registry
// packages pinned by this surface's bun.lock.

import { exactContractWeb } from '@exact/devtools/contract-web';

const snapbackTarget = process.env.SNAPBACK_GRAFFITI_API ?? 'http://127.0.0.1:4431';

export default () => ({
  root: __dirname,
  plugins: [
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
