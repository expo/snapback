// Cursor presence — Contract surface Vite config (ENG-22479), on the
// exactContractWeb paved-road preset (ENG-22463; see the all-aboard config
// for the preset rationale). The surface talks to Snapback DIRECTLY at the
// defined origin: vite under `bun --bun` cannot complete proxied WebSocket
// upgrades, and the live socket is the presence transport.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(__dirname, '../../../../../exact');
const snapbackTarget = process.env.SNAPBACK_CURSORS_API ?? 'http://127.0.0.1:4425';

export default async () => {
  const { exactContractWeb } = await import(
    pathToFileURL(resolve(exactRoot, 'packages/exact-devtools/src/contract-web.ts')).href
  );

  return {
    root: __dirname,
    plugins: [
      exactContractWeb({
        data: 'snapback',
        exactRoot,
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
  };
};
