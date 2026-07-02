// All Aboard — Contract surface Vite config (ENG-22463: paved-road preset).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) replaces the hand-rolled
// plugin + alias matrix. It composes the Contract compiler plugin and the
// Exact app plugin — `vite` dev with the agent surface AND a production
// `vite build` (ENG-22441) — with external-surface-safe defaults: shell
// 'auto' preserves this surface's own ./index.html (ENG-22445), the
// agent-readiness audit is off, and no native static artifacts or desktop
// manifests are emitted. It also supplies the Phase 0 source aliases for the
// checkout at `exactRoot`, excludes wa-sqlite from optimizeDeps
// (data: 'snapback'), fails builds whose client chunks leak Node/native-only
// modules, and reports drift against ./exact.pin.json (ENG-22446 — re-pin
// deliberately with EXACT_WRITE_PIN=1 after verifying on a new revision;
// EXACT_PIN_STRICT=1 turns drift into a hard failure).
//
// SNAPBACK_EXACT_ROOT (the diary 0009 pinning hook; tests/acceptance/
// browser.mjs already honors it for the vite spawn cwd) selects the Exact
// checkout, defaulting to the sibling `../exact` of this repo checkout. The
// preset itself is imported from that same checkout, so plugin code, source
// aliases, and the pin check all come from one revision — the hand-rolled
// config loaded plugin code from the literal sibling path even when
// SNAPBACK_EXACT_ROOT pointed elsewhere.

import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(__dirname, '../../../../../exact');
const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

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
      // The surface talks to Snapback DIRECTLY at this origin (HTTP under the
      // server's loopback CORS; the live WebSocket needs no CORS). Direct is
      // the same pattern cursors-web uses, and it sidesteps a real bug: vite
      // under `bun --bun` never completes proxied WebSocket upgrades (the
      // ws:true proxy below logs the forward, then the tunnel hangs), which
      // would leave the stream transport permanently connecting.
      __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
    },
    server: {
      host: '127.0.0.1',
      port: 5178,
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
