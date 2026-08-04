// @ref LLP 0015#acceptance-rules — workout apps use the same generated
// artifacts, provenance-verified server lifecycle, and deterministic seed path.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdminClient } from '../../packages/snapback-admin-client/index.mjs';
import { SnapbackClient } from './client.mjs';
import { startServer } from './server-process.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export async function openHeadlessApp(metaUrl, {
  appId,
  cronDisabled = false,
  env = {},
} = {}) {
  if (!appId) throw new TypeError('openHeadlessApp requires appId');
  const acceptanceDir = dirname(fileURLToPath(metaUrl));
  const appDir = resolve(acceptanceDir, '..', '..');
  const repoRoot = resolve(appDir, '..', '..');
  const backendDir = join(appDir, 'snapback');
  const generatedDir = join(backendDir, 'generated');
  const generated = (name) => readJson(join(generatedDir, name));

  const server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    cronDisabled,
    env,
    provenance: {
      appId,
      artifactsPath: join(generatedDir, 'artifacts.json'),
    },
  });
  const provisioner = new SnapbackClient(server.baseUrl, server.clientOptions);
  const routesPath = join(generatedDir, 'routes.manifest.json');
  let provisioned;
  try {
    provisioned = await provisioner.ensureApp({
      schema: generated('schema.manifest.json'),
      functions: generated('functions.manifest.json'),
      seed: readJson(join(backendDir, 'seed.json')),
      ...(existsSync(routesPath) ? { routes: readJson(routesPath) } : {}),
    });
  } finally {
    // @ref LLP 0166#writer-discipline-and-format-versioning — the fresh
    // product client may not write until the provisioning client's owned
    // file-store lease has been released.
    await provisioner.closeAuth();
  }
  // Provisioning changes the app/auth generation. Start product traffic from
  // a fresh client so no pre-provision handshake or connection cache can cross
  // that boundary.
  const client = new SnapbackClient(server.baseUrl, server.clientOptions);
  const admin = new AdminClient(`${server.baseUrl}/_snapback/api`, {
    token: server.adminToken,
  });

  return {
    admin,
    appDir,
    backendDir,
    client,
    generated,
    provisioned,
    repoRoot,
    server,
    close: async () => {
      await client.closeAuth();
      await server.stop();
    },
  };
}
