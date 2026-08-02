import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { snapbackDev } from '@expo/snapback-vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Sessions custody needs a signed-in principal, and the shipped provider has
// no production mail adapter: the sign-in code lands in the server's dev
// mailbox, which is admin- and impersonation-gated. This trusted-local
// middleware reads both carriers server-side and hands the browser only the
// one-time code — neither credential enters the bundle, and the relay itself
// never forwards `/_snapback/*`.
const snapdropMailbox = {
  name: 'snapdrop-local-mailbox',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use(async (
      request: { url?: string },
      response: { statusCode: number; setHeader(name: string, value: string): void; end(body: string): void },
      next: () => void,
    ) => {
      if (!request.url?.startsWith('/__snapmailbox')) return next();
      const challengeId = new URL(request.url, 'http://snapdrop.local').searchParams.get('challengeId');
      if (!challengeId) {
        response.statusCode = 400;
        return response.end(JSON.stringify({ error: 'missing challengeId' }));
      }
      const descriptor = JSON.parse(readFileSync(resolve('.snapback/dev.ready.json'), 'utf8')) as {
        serverUrl: string;
        adminTokenFile: string;
        impersonationCapabilityFile: string;
      };
      const adminToken = readFileSync(descriptor.adminTokenFile, 'utf8').trim();
      const impersonation = readFileSync(descriptor.impersonationCapabilityFile, 'utf8').trim();
      const mailbox = await fetch(
        `${descriptor.serverUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
        { headers: {
          'x-snapback-admin-token': adminToken,
          'x-snapback-impersonation-capability': impersonation,
        } },
      );
      response.statusCode = mailbox.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      return response.end(await mailbox.text());
    });
  },
};

export default defineConfig({
  plugins: [
    snapdropMailbox,
    react(),
    snapbackDev({
      server: { mode: 'attach' },
      generatedRoots: ['snapback/generated'],
    }),
  ],
});
