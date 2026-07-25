import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { convexDeploymentUrl } from '../../backends/gateway/convex';
import { loadLocalSecrets } from '../../backends/gateway/secrets.mjs';
import { partitimeCostAttribution } from '../../shared/vite-cost-attribution.mjs';

const root = dirname(fileURLToPath(import.meta.url));
// Browser-safe by design: only the publishable key may reach a bundle.
const localSecrets = loadLocalSecrets(resolve(root, '..', '..', '..', '..'));
const rawConvexUrl = process.env.CONVEX_URL ?? localSecrets.CONVEX_URL ?? localSecrets.CONVEX_DEPLOY_KEY ?? '';
const convexUrl = rawConvexUrl ? convexDeploymentUrl(rawConvexUrl) : '';
const proxy = {
  '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path: string) => path.replace(/^\/matrix-api/, '') },
  '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/snapback/, '') },
};
export default defineConfig(({ mode }) => ({
  plugins: [react(), partitimeCostAttribution()],
  resolve: {
    // Convex's generated API lives outside this surface directory, so normal
    // importer-based lookup cannot see the surface-local pinned dependency.
    alias: { convex: resolve(root, 'node_modules/convex') },
  },
  define: {
    __MATRIX_BACKEND__: JSON.stringify(mode),
    __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433'),
    __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460'),
    __PARTITIME_DISABLE_POLL_FALLBACK__: JSON.stringify(process.env.PARTITIME_DISABLE_POLL_FALLBACK === '1'),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? localSecrets.SUPABASE_URL ?? ''),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(process.env.SUPABASE_PUBLISHABLE_KEY ?? localSecrets.SUPABASE_PUBLISHABLE_KEY ?? ''),
    // A Convex deployment URL is public client configuration. The deploy key
    // is used only to derive that URL and is never embedded in the bundle.
    __CONVEX_URL__: JSON.stringify(convexUrl),
  },
  server: {
    host: '127.0.0.1', port: 5191, fs: { allow: ['../../../..'] },
    proxy,
  },
  // @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
  // production performance instrument exercises built assets through Vite's
  // preview server while retaining the same backend/proxy boundary as dev.
  preview: { host: '127.0.0.1', proxy },
  root,
}));
