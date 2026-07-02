// Cursor presence — React control-arm Vite config (ENG-22531). Stock Vite +
// @vitejs/plugin-react; no framework preset. Transport topology matches the
// Contract arm deliberately: the surface talks to Snapback DIRECTLY at the
// defined origin (the server sends local-dev CORS headers), so the two arms
// ride identical wire paths and the comparison stays controlled. The
// `/snapback` proxy remains as a fallback for manual poking.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const snapbackTarget = process.env.SNAPBACK_CURSORS_API ?? 'http://127.0.0.1:4425';

export default defineConfig({
  plugins: [react()],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5186,
    strictPort: false,
    fs: {
      // The surface imports the shared demo kit and the generated Snapback
      // artifacts from the repo, two directories above this package root.
      allow: ['../../../..'],
    },
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        ws: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
});
