import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { snapbackDev } from '@expo/snapback-vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      snapbackDev({
        server: { mode: 'off' },
        generatedRoots: ['snapback/generated'],
      }),
    ],
    define: {
      __SNAPBACK_API_ORIGIN__: JSON.stringify(env.SNAPBACK_URL || 'http://127.0.0.1:4399'),
      __SNAPBACK_ADMIN_TOKEN__: JSON.stringify(env.SNAPBACK_ADMIN_TOKEN || ''),
      __SNAPBACK_IMPERSONATION_CAPABILITY__: JSON.stringify(
        env.SNAPBACK_IMPERSONATION_CAPABILITY || '',
      ),
    },
    server: { host: '127.0.0.1', port: 5223, strictPort: false },
  };
});
