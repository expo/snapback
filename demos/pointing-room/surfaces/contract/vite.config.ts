import { readFileSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { exactContractWeb } from '@exact/devtools/contract-web';
import { snapbackDev } from '../../../../packages/snapback-vite/index.mjs';

const snapbackTarget = process.env.SNAPBACK_POINTING_API ?? 'http://127.0.0.1:4367';
const configDir = dirname(fileURLToPath(import.meta.url));

function localMailboxCredentials(): { adminToken: string; impersonation: string } | null {
  const explicitAdmin = process.env.SNAPBACK_POINTING_ADMIN_TOKEN?.trim();
  const explicitImpersonation = process.env.SNAPBACK_POINTING_IMPERSONATION_CAPABILITY?.trim();
  if (explicitAdmin && explicitImpersonation) {
    return { adminToken: explicitAdmin, impersonation: explicitImpersonation };
  }
  const readyFile = process.env.SNAPBACK_POINTING_READY_FILE;
  if (!readyFile) return null;
  const descriptor = JSON.parse(readFileSync(readyFile, 'utf8')) as {
    adminTokenFile: string;
    impersonationCapabilityFile: string;
  };
  return {
    adminToken: readFileSync(descriptor.adminTokenFile, 'utf8').trim(),
    impersonation: readFileSync(descriptor.impersonationCapabilityFile, 'utf8').trim(),
  };
}

// The local provider has no mail delivery. This serve-only middleware keeps
// the admin and impersonation carriers in the Vite process and relays only the
// one-time code to the browser. It never proxies arbitrary Snapback routes.
const pointingRoomMailbox = {
  name: 'pointing-room-local-mailbox',
  apply: 'serve' as const,
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use(async (
      request: { url?: string },
      response: {
        statusCode: number;
        setHeader(name: string, value: string): void;
        end(body: string): void;
      },
      next: () => void,
    ) => {
      if (!request.url?.startsWith('/__pointing-mailbox')) return next();
      const challengeId = new URL(request.url, 'http://pointing-room.local')
        .searchParams.get('challengeId');
      const credentials = localMailboxCredentials();
      if (!challengeId) {
        response.statusCode = 400;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({ error: 'missing challengeId' }));
      }
      if (!credentials) {
        response.statusCode = 503;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        return response.end(JSON.stringify({
          error: 'local mailbox credentials unavailable',
          recovery: 'set SNAPBACK_POINTING_READY_FILE or both SNAPBACK_POINTING_ADMIN_TOKEN and SNAPBACK_POINTING_IMPERSONATION_CAPABILITY',
        }));
      }
      const mailbox = await fetch(
        `${snapbackTarget}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(challengeId)}`,
        {
          headers: {
            'x-snapback-admin-token': credentials.adminToken,
            'x-snapback-impersonation-capability': credentials.impersonation,
          },
        },
      );
      response.statusCode = mailbox.status;
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.setHeader('cache-control', 'no-store');
      return response.end(await mailbox.text());
    });
  },
};

const sourceProvenanceProbe = {
  name: 'pointing-room-source-provenance',
  configureServer(server: { middlewares: { use: Function } }) {
    server.middlewares.use('/__snapback/source', (
      _request: unknown,
      response: { setHeader(name: string, value: string): void; end(body: string): void },
    ) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({
        app: 'pointing-room',
        surface: 'contract',
        root: realpathSync(configDir),
        apiOrigin: snapbackTarget,
      }));
    });
  },
};

export default () => ({
  root: configDir,
  plugins: [
    pointingRoomMailbox,
    snapbackDev({
      server: { mode: 'off' },
      generatedRoots: [resolve(configDir, '../../snapback/generated')],
    }),
    sourceProvenanceProbe,
    exactContractWeb({
      data: 'snapback',
      app: { entry: '/main.ts' },
    }),
  ],
  define: {
    __SNAPBACK_API_ORIGIN__: JSON.stringify(snapbackTarget),
  },
  server: {
    host: '127.0.0.1',
    port: 5187,
    strictPort: false,
  },
});
