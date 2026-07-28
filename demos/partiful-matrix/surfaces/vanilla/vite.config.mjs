import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { partitimeCostAttribution } from '../../shared/vite-cost-attribution.mjs';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const proxy = {
  '/matrix-api': {
    target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/matrix-api/, ''),
  },
  '/snapback': {
    target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433',
    changeOrigin: true,
    ws: true,
    rewrite: (path) => path.replace(/^\/snapback/, ''),
  },
};

export default defineConfig(({ mode }) => ({
  plugins: [
    snapbackDev({
      server: { mode: 'off' },
      generatedRoots: [resolve(root, '../../snapback/generated')],
    }),
    partitimeCostAttribution(),
  ],
  define: {
    __MATRIX_BACKEND__: JSON.stringify(mode),
    __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433'),
    __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460'),
    __PARTITIME_DISABLE_POLL_FALLBACK__: JSON.stringify(process.env.PARTITIME_DISABLE_POLL_FALLBACK === '1'),
  },
  server: {
    host: '127.0.0.1',
    port: 5193,
    fs: { allow: ['../../../..'] },
    proxy,
  },
  // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
  // production performance instrument exercises built assets through Vite's
  // preview server while retaining the same backend/proxy boundary as dev.
  preview: { host: '127.0.0.1', proxy },
  root,
}));
