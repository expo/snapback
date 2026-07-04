// All Aboard — Contract surface Vite config (ENG-22463: paved-road preset;
// ENG-22480: registry packages).
//
// `exactContractWeb` (from `@exact/devtools/contract-web`; Exact LLP 0264,
// docs/contract-web-paved-road.md in the Exact repo) composes the Contract
// compiler plugin and the Exact app plugin — `vite` dev with the agent
// surface AND a production `vite build` (ENG-22441) — with
// external-surface-safe defaults: shell 'auto' preserves this surface's own
// ./index.html (ENG-22445), the agent-readiness audit is off, and static
// native artifacts/desktop manifests are enabled only on this surface's build
// path. It also excludes wa-sqlite from optimizeDeps (data: 'snapback') and
// fails builds whose client chunks leak Node/native-only modules.
//
// ENG-22480: Exact is consumed from the npm registry — `@exact/*` imports
// resolve through npm alias dependencies to the published
// `@ccheever/exact-*` packages (see package.json), and `bun.lock` pins the
// exact bits (it replaced `exact.pin.json`). No sibling checkout, no
// `SNAPBACK_EXACT_ROOT`, no source aliases: the preset itself is imported
// from this surface's own node_modules. The packages ship TS source, so the
// vite binary runs under bun (`bun --bun node_modules/.bin/vite`, see the
// package.json scripts), which loads this TS config and the TS preset from
// node_modules.

import { realpathSync } from 'node:fs';

import { exactContractWeb } from '@exact/devtools/contract-web';

const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

// ENG-22753: dev-only source-provenance probe. The acceptance suites reuse an
// already-running Vite only after this probe proves it serves THIS checkout's
// tree against THIS run's API origin (the Diary 0008 2026-07-01 :4420 gotcha:
// a Vite from a different working tree squatting the default port). The path
// and response shape pair with demos/_kit/provenance.mjs
// (VITE_SOURCE_PROBE_PATH / verifyViteProvenance).
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
          app: 'all-aboard',
          surface: 'contract',
          root: realpathSync(__dirname),
          apiOrigin: snapbackTarget,
        }),
      );
    });
  },
};
const exactNativeOptimizerEscapeHatch = {
  optimizeDeps: {
    // Exact's native startup builder walks the Contract runtime source graph.
    // Vite 8/Rolldown leaves @vite-ignore relative imports inside optimized
    // host-ops chunks, but does not copy the sibling inspector.js module into
    // the native optimizer cache.
    exclude: [
      '@exact/contract/runtime',
      '@exact/renderer/host-ops',
      '@exact/renderer/web-host',
    ],
  },
};
const exactNativeEnvironments = Object.fromEntries(
  [
    'exact_native_android_android_hermes',
    'exact_native_ios_uikit_hermes',
    'exact_native_linux_gtk_hermes',
    'exact_native_mac_appkit_hermes',
    'exact_native_mac_swiftui_hermes',
    'exact_native_native_host_hermes',
    'exact_native_windows_winui_hermes',
  ].map((name) => [name, exactNativeOptimizerEscapeHatch]),
);

export default ({ command }: { command: 'serve' | 'build' }) => ({
  root: __dirname,
  environments: exactNativeEnvironments,
  plugins: [
    sourceProvenanceProbe,
    exactContractWeb({
      data: 'snapback',
      app: {
        entry: command === 'build' ? '/native.ts' : '/main.ts',
        staticPlatformTargets: command === 'build' ? ['mac', 'ios'] : false,
        emitDesktopManifests: command === 'build',
      },
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
});
