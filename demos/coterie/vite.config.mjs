import { defineConfig } from 'vite';
import { contractVitePlugin } from '@exact/contract/vite-plugin';
import { exactVitePlugin } from '@exact/devtools';

export default defineConfig({
  // COTERIE_PROVIDER is a public boot selector, not a secret. This makes the
  // exact variable named by LLP 0266 D8 available through import.meta.env.
  envPrefix: ['VITE_', 'COTERIE_'],
  plugins: [
    // Compiles `.contract` modules (enforce: 'pre') before anything else
    // in the graph sees them.
    contractVitePlugin(),
    exactVitePlugin({
      entry: '/src/main.tsx',
    }),
  ],
  resolve: {
    // React is a real dependency of this app (the renderer uses it at
    // runtime, and the native dep optimizer must be able to resolve it from
    // this root — ENG-22663/ENG-23265); dedupe so the source-linked @exact
    // packages resolve this app's copy (two React instances break hooks).
    dedupe: ['react', 'react-dom'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: {
    // Raw development loader data is intentionally loopback-only by default.
    // Change this explicitly when testing on a trusted LAN device.
    host: '127.0.0.1',
    port: 8083,
  },
});
