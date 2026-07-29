import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { snapbackDev } from '@snapback/vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [
      react(),
      // Build-time generated imports are resolved through artifacts.json and
      // its immutable complete-input cache. The bakeoff owns backend startup
      // separately, so only the review-surface resolver is enabled here.
      snapbackDev({
        server: { mode: 'off' },
        generatedRoots: ['snapback/generated'],
      }),
    ],
    define: {
      __SNAPBACK_URL__: JSON.stringify(env.SNAPBACK_URL || 'http://127.0.0.1:4287'),
      __CONVEX_URL__: JSON.stringify(env.VITE_CONVEX_URL || ''),
      __SUPABASE_URL__: JSON.stringify(env.SUPABASE_URL || env.VITE_SUPABASE_URL || ''),
      __SUPABASE_KEY__: JSON.stringify(
        env.SUPABASE_PUBLISHABLE_KEY ||
          env.SUPABASE_ANON_KEY ||
          env.VITE_SUPABASE_PUBLISHABLE_KEY ||
          '',
      ),
    },
    server: {
      strictPort: true,
    },
  };
});
