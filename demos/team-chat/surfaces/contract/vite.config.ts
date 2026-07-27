import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exactContractWeb } from './published-toolchain.mjs';

const surfaceRoot = dirname(fileURLToPath(import.meta.url));

export default ({ command }: { command: 'serve' | 'build' }) => ({
  root: surfaceRoot,
  plugins: [
    exactContractWeb({
      data: 'snapback',
      app: command === 'serve' ? { entry: '/main.ts' } : false,
    }),
  ],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(
      process.env.SNAPBACK_TEAM_CHAT_API ?? 'http://127.0.0.1:4438',
    ),
  },
  server: {
    host: '127.0.0.1',
    port: 5195,
    strictPort: false,
    fs: {
      allow: ['../../../..'],
    },
  },
  build: {
    modulePreload: false,
  },
});
