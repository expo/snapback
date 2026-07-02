// All Aboard — React surface Vite config.
//
// Unlike the Contract surface, this needs no sibling Exact checkout and no
// aliases: the toolchain is stock `vite` + `@vitejs/plugin-react` resolved from
// this directory's own node_modules. The only wiring shared with the Contract
// arm is the `/snapback` proxy to the demo API server.

import { resolve } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

export default defineConfig({
  root: __dirname,
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5179,
    strictPort: false,
    fs: {
      // The surface imports the shared transit model + generated manifests from
      // ../../snapback and the shared client from ../../../_kit.
      allow: [resolve(__dirname, '../../../..')],
    },
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
