// Party Wall — React surface Vite config, the shindig topology minus the
// provenance probe: the surface talks to a sessions-mode Snapback at the
// configured origin. The dev mailbox capability for the demo sign-in flow
// rides VITE_SNAPBACK_ADMIN_TOKEN (trusted-local demo only — see README).
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const snapbackTarget = process.env.SNAPBACK_PARTY_WALL_API ?? 'http://127.0.0.1:4433';

export default defineConfig({
  plugins: [react()],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
});
