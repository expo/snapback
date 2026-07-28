import { exactContractWeb } from '@exact/devtools/contract-web';
import * as exactContractRuntime from '@exact/contract/runtime';
import { resolve } from 'node:path';
import { partitimeCostAttribution } from '../../shared/vite-cost-attribution.mjs';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

export default ({ mode, command }: { mode: string; command: 'serve' | 'build' }) => {
  const memoryEntry = process.env.PARTITIME_MEMORY_ENTRY === '1';
  const hydrationReader = typeof (
    exactContractRuntime as Record<string, unknown>
  ).readContractHydrationManifestValue === 'function'
    ? resolve(__dirname, 'hydration-manifest-reader-compact.ts')
    : resolve(__dirname, 'hydration-manifest-reader.ts');
  const base = memoryEntry
    ? '/'
    : process.env.PARTITIME_BASE_PATH ?? (command === 'build' ? '/partitime/' : '/');
  return {
    root: __dirname,
    base,
    plugins: [
      snapbackDev({
        server: { mode: 'off' },
        generatedRoots: [resolve(__dirname, '../../snapback/generated')],
      }),
      exactContractWeb({
        data: 'snapback',
        // The surface owns index.html, so production needs the Contract
        // compiler/boundary preset but not Exact's full dev-server agent
        // plugin. Keep that authoring surface for `vite serve` only.
        // @ref LLP 0063#workstream-8--performance-and-packaging-budgets —
        // production-build latency measures the minimal shipped build path.
        app: command === 'serve'
          ? { entry: memoryEntry ? '/memory.ts' : '/main.ts' }
          : false,
      }),
      partitimeCostAttribution(),
    ],
    resolve: {
      // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
      // frozen 0.1.5 consumer uses its released validator; current Exact uses
      // the ratified compact reader without making that unpublished API a
      // requirement of the stable-package lane.
      alias: [{
        find: './hydration-manifest-reader',
        replacement: hydrationReader,
      }],
    },
    define: {
      __MATRIX_BACKEND__: JSON.stringify(mode),
      __PARTITIME_BASE_PATH__: JSON.stringify(base),
      __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? ''),
      __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? ''),
      __PARTITIME_DISABLE_POLL_FALLBACK__: JSON.stringify(process.env.PARTITIME_DISABLE_POLL_FALLBACK === '1'),
      __CONVEX_URL__: JSON.stringify(process.env.CONVEX_URL ?? ''),
    },
    server: {
      host: '127.0.0.1', port: 5192, fs: { allow: ['../../../..'] },
      proxy: {
        '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/matrix-api/, '') },
        '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/snapback/, '') },
      },
    },
    preview: {
      host: '127.0.0.1',
      proxy: {
        '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/matrix-api/, '') },
        '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/snapback/, '') },
      },
    },
    build: {
      // The supported browser matrix loads native ESM. Disabling Vite's
      // legacy module-preload shim preserves route-level lazy loading without
      // shipping a second dependency scheduler in every Contract cell.
      modulePreload: false,
      ...(memoryEntry ? {
        rollupOptions: { input: resolve(__dirname, 'memory.html') },
      } : {}),
    },
  };
};
