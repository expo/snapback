import { realpathSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, type PluginOption } from 'vite';

const apiOrigin = process.env.SNAPBACK_TEAM_CHAT_API ?? 'http://127.0.0.1:4438';
const surfaceRoot = dirname(fileURLToPath(import.meta.url));

const sourceProvenanceProbe: PluginOption = {
  name: 'snapback-source-provenance',
  configureServer(server) {
    server.middlewares.use('/__snapback/source', (_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        app: 'team-chat',
        surface: 'react',
        root: realpathSync(surfaceRoot),
        apiOrigin,
      }));
    });
  },
};

export default defineConfig({
  plugins: [react(), sourceProvenanceProbe],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(apiOrigin),
  },
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
  server: {
    host: '127.0.0.1',
    port: 5194,
    strictPort: false,
    fs: {
      allow: ['../../../..'],
    },
  },
});
