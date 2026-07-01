import { resolve } from 'node:path';

import { contractVitePlugin } from '../../../../../exact/packages/exact-contract/src/vite-plugin.ts';
import { exactVitePlugin } from '../../../../../exact/packages/exact-devtools/src/vite-plugin.ts';

// `../../../../../exact` is the sibling Exact checkout from a normal snapback
// checkout. When serving from a git worktree, symlink it into place, e.g.
//   ln -s /path/to/exact <repo>/.claude/worktrees/exact
// (the SNAPBACK_EXACT_ROOT resolver convention; see the diary for the one-liner).
const exactRoot = resolve(__dirname, '../../../../../exact');
const packages = resolve(exactRoot, 'packages');
const snapbackTarget = process.env.SNAPBACK_ALL_ABOARD_API ?? 'http://127.0.0.1:4420';

export default {
  root: __dirname,
  plugins: [
    exactVitePlugin({ entry: '/main.ts', agentReadiness: false }),
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
    port: 5178,
    strictPort: false,
    proxy: {
      '/snapback': {
        target: snapbackTarget,
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/snapback/, ''),
      },
    },
  },
};
