// @ref LLP 0015#acceptance-rules — workout apps use the same generated
// artifacts, provenance-verified server lifecycle, and deterministic seed path.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { AdminClient } from '../../packages/snapback-admin-client/index.mjs';
import { SnapbackClient } from './client.mjs';
import { startForkedServer } from './instance-fork.mjs';
import { startServer } from './server-process.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export async function openHeadlessApp(metaUrl, {
  appId,
  cronDisabled = false,
  env = {},
  // Opt-in LLP 0158 F1 path: preserve realistic parent rows instead of
  // installing this demo's seed into a blank in-memory server. The fork CLI
  // still loads this worktree's generated schema/functions before returning.
  forkFrom = null,
  forkRoot = null,
  forkTtl = '30m',
  forkWithSecrets = false,
  serverBinary = null,
} = {}) {
  if (!appId) throw new TypeError('openHeadlessApp requires appId');
  const acceptanceDir = dirname(fileURLToPath(metaUrl));
  const appDir = resolve(acceptanceDir, '..', '..');
  const repoRoot = resolve(appDir, '..', '..');
  const backendDir = join(appDir, 'snapback');
  const generatedDir = join(backendDir, 'generated');
  const generated = (name) => readJson(join(generatedDir, name));

  // @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 — this
  // is an explicit fork-instead-of-seed option. Ordinary suites retain the
  // in-memory seed path; fork-aware suites get finite TTL and exact drop.
  const server = forkFrom === null
    ? await startServer({
        port: 0,
        db: ':memory:',
        cwd: repoRoot,
        cronDisabled,
        env,
        serverBinary,
        provenance: {
          appId,
          artifactsPath: join(generatedDir, 'artifacts.json'),
        },
      })
    : await startForkedServer({
        from: forkFrom,
        appRoot: appDir,
        repoRoot,
        forkRoot,
        ttl: forkTtl,
        withSecrets: forkWithSecrets,
        serverBinary,
        env,
      });
  const provisioner = new SnapbackClient(server.baseUrl, server.clientOptions);
  const routesPath = join(generatedDir, 'routes.manifest.json');
  const provisioned = await provisioner.ensureApp({
    schema: generated('schema.manifest.json'),
    functions: generated('functions.manifest.json'),
    // A fork is useful because it keeps the parent's real cardinalities and
    // oddities. Never mix the demo seed into that state implicitly.
    ...(forkFrom === null ? { seed: readJson(join(backendDir, 'seed.json')) } : {}),
    ...(existsSync(routesPath) ? { routes: readJson(routesPath) } : {}),
  });
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
    fork: server.fork ?? null,
    provisioned,
    repoRoot,
    server,
    close: () => server.stop(),
  };
}
