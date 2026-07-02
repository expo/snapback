import { resolve } from 'node:path';

import { contractVitePlugin } from '../../../../../exact/packages/exact-contract/src/vite-plugin.ts';
import { exactVitePlugin } from '../../../../../exact/packages/exact-devtools/src/vite-plugin.ts';

const exactRoot = resolve(__dirname, '../../../../../exact');
const packages = resolve(exactRoot, 'packages');
const snapbackTarget = process.env.SNAPBACK_TODO_V2_API ?? 'http://127.0.0.1:4421';

export default {
  root: __dirname,
  plugins: [
    exactVitePlugin({
      entry: '/main.ts',
      agentReadiness: false,
    }),
    contractVitePlugin(),
  ],
  resolve: {
    alias: {
      '@exact/contract/compiler': resolve(packages, 'exact-contract/src/compiler/index.ts'),
      '@exact/contract/runtime': resolve(packages, 'exact-contract/src/runtime/index.ts'),
      '@exact/contract/exports': resolve(packages, 'exact-contract/src/exports.ts'),
      '@exact/contract/vite-plugin': resolve(packages, 'exact-contract/src/vite-plugin.ts'),
      '@exact/contract': resolve(packages, 'exact-contract/src/index.ts'),
      '@exact/devtools/vite-plugin': resolve(packages, 'exact-devtools/src/vite-plugin.ts'),
      '@exact/renderer/web-host': resolve(packages, 'exact-renderer/src/web-host.ts'),
      '@exact/renderer/dom-mirror': resolve(packages, 'exact-renderer/src/dom-mirror.ts'),
      '@exact/renderer/host-ops': resolve(packages, 'exact-renderer/src/host-ops.ts'),
      '@exact/renderer': resolve(packages, 'exact-renderer/src'),
      '@exact/core': resolve(packages, 'exact-core/src'),
    },
    conditions: ['browser', 'module', 'import', 'default'],
  },
  server: {
    host: '127.0.0.1',
    port: 5175,
    strictPort: false,
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        // The live stream (LLP 0034 D1) is a WebSocket at
        // /snapback/live/{connection}/stream; without ws:true the proxy
        // never upgrades and the browser surface can only poll.
        ws: true,
        rewrite: (path) => path.replace(/^\/snapback/, ''),
      },
    },
  },
};
