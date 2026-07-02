import { resolve } from 'node:path';

import { contractVitePlugin } from '../../../../../exact/packages/exact-contract/src/vite-plugin.ts';
import { exactVitePlugin } from '../../../../../exact/packages/exact-devtools/src/vite-plugin.ts';

// `../../../../../exact` is the sibling Exact checkout from a normal snapback
// checkout. When serving from a git worktree, symlink it into place, e.g.
//   ln -s /path/to/exact <repo>/.claude/worktrees/exact
// (the SNAPBACK_EXACT_ROOT resolver convention; see the diary for the one-liner).
// SNAPBACK_EXACT_ROOT (already honored by tests/acceptance/browser.mjs for the
// spawn cwd) now also repoints these aliases, so the surface can build against
// a pinned Exact worktree instead of whatever HEAD the sibling checkout is on.
const exactRoot = process.env.SNAPBACK_EXACT_ROOT
  ? resolve(process.env.SNAPBACK_EXACT_ROOT)
  : resolve(__dirname, '../../../../../exact');
const packages = resolve(exactRoot, 'packages');
const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

export default {
  root: __dirname,
  plugins: [
    exactVitePlugin({ entry: '/main.ts', agentReadiness: false }),
    contractVitePlugin(),
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
};
