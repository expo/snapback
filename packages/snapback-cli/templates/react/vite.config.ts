import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    __SNAPBACK_URL__: JSON.stringify(process.env.SNAPBACK_URL ?? 'http://127.0.0.1:3000'),
  },
});
