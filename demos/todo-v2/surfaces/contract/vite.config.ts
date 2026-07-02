// Todo v2 — Contract surface Vite config (ENG-22487: paved-road preset,
// matching the All Aboard shape from ENG-22463).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) replaces the hand-rolled
// plugin pair + alias matrix. It composes the Contract compiler plugin and
// the Exact app plugin — `vite` dev with the agent surface AND a production
// `vite build` — with external-surface-safe defaults: shell 'auto' preserves
// this surface's own ./index.html, the agent-readiness audit is off, and no
// native static artifacts or desktop manifests are emitted. It also supplies
// the Phase 0 source aliases for the checkout at `exactRoot`, excludes
// wa-sqlite from optimizeDeps (data: 'snapback'), fails builds whose client
// chunks leak Node/native-only modules, and reports drift against
// ./exact.pin.json (re-pin deliberately with EXACT_WRITE_PIN=1 after
// verifying on a new revision; EXACT_PIN_STRICT=1 turns drift into a hard
// failure).
//
// SNAPBACK_EXACT_ROOT selects the Exact checkout, defaulting to the sibling
// `../exact` of this repo checkout. The preset itself is imported from that
// same checkout, so plugin code, source aliases, and the pin check all come
// from one revision.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(__dirname, '../../../../../exact');
const snapbackTarget = process.env.SNAPBACK_TODO_V2_API ?? 'http://127.0.0.1:4421';

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
  };
};
