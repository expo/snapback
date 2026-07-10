// Todo — Contract surface Vite config (ENG-22487: paved-road preset, matching
// the All Aboard shape from ENG-22463).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) replaces the hand-rolled
// plugin pair + alias matrix. It composes the Contract compiler plugin and
// the Exact app plugin — `vite` dev with the agent surface AND a production
// `vite build` — with external-surface-safe defaults: shell 'auto' preserves
// this surface's own ./index.html, the agent-readiness audit is off, and no
// native static artifacts or desktop manifests are emitted. It also excludes
// wa-sqlite from optimizeDeps (data: 'snapback') and fails builds whose client
// chunks leak Node/native-only modules.
//
// ENG-22564 consumption model: Exact comes from the npm registry through the
// alias dependencies in package.json; bun.lock is the reproducibility pin.
// There is no sibling checkout, source alias, or exact.pin.json dependency.

import { exactContractWeb } from '@exact/devtools/contract-web';

const snapbackTarget = process.env.SNAPBACK_TODO_API ?? 'http://127.0.0.1:4420';

export default () => ({
  root: __dirname,
  plugins: [
    exactContractWeb({
      data: 'snapback',
      app: { entry: '/main.ts' },
    }),
  ],
  server: {
    host: '127.0.0.1',
    port: 5174,
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
