import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { snapbackDev } from '@expo/snapback-vite';

export default defineConfig({
  plugins: [
    react(),
    snapbackDev({
      server: { mode: 'attach' },
      generatedRoots: ['snapback/generated'],
    }),
  ],
});
