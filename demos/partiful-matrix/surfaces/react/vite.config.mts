import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

import { loadLocalSecrets } from '../../backends/gateway/secrets.mjs';

const root = dirname(fileURLToPath(import.meta.url));
// Browser-safe by design: only the publishable key may reach a bundle.
const localSecrets = loadLocalSecrets(resolve(root, '..', '..', '..', '..'));
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  define: {
    __MATRIX_BACKEND__: JSON.stringify(mode),
    __SNAPBACK_API_ORIGIN__: JSON.stringify(process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433'),
    __MATRIX_GATEWAY_ORIGIN__: JSON.stringify(process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460'),
    __PARTITIME_DISABLE_POLL_FALLBACK__: JSON.stringify(process.env.PARTITIME_DISABLE_POLL_FALLBACK === '1'),
    __SUPABASE_URL__: JSON.stringify(process.env.SUPABASE_URL ?? localSecrets.SUPABASE_URL ?? ''),
    __SUPABASE_PUBLISHABLE_KEY__: JSON.stringify(process.env.SUPABASE_PUBLISHABLE_KEY ?? localSecrets.SUPABASE_PUBLISHABLE_KEY ?? ''),
  },
  server: {
    host: '127.0.0.1', port: 5191, fs: { allow: ['../../../..'] },
    proxy: {
      '/matrix-api': { target: process.env.PARTIFUL_MATRIX_GATEWAY ?? 'http://127.0.0.1:4460', changeOrigin: true, rewrite: (path) => path.replace(/^\/matrix-api/, '') },
      '/snapback': { target: process.env.SNAPBACK_PARTIFUL_MATRIX_API ?? 'http://127.0.0.1:4433', changeOrigin: true, ws: true, rewrite: (path) => path.replace(/^\/snapback/, '') },
    },
  },
  root,
}));
