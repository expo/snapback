// @ref LLP 0015#acceptance-rules — workout apps use the same generated
// artifacts, provenance-verified server lifecycle, and deterministic seed path.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { AdminClient } from '../../packages/snapback-admin-client/index.mjs';
import { SnapbackClient } from './client.mjs';
import { startForkedServer } from './instance-fork.mjs';
import { resolveHeadlessAppLayout } from './repo-layout.mjs';
import { startServer } from './server-process.mjs';

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export async function openHeadlessApp(metaUrl, {
  appId,
  // Explicit app directory (absolute, or relative to the repository root) for
  // layouts the marker walk cannot infer; ordinary `demos/<app>/tests/
  // acceptance` and nested `demos/<suite>/<arm>/tests/acceptance` suites can
  // leave it unset.
  appDir: appDirOption = null,
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
  // Marker-walk resolution instead of a fixed number of parent traversals, so
  // nested bakeoff arms resolve the real repository root and their own
  // `<arm>/snapback` backend, and anything unresolvable refuses here — before
  // a server can be launched from a plausible wrong directory
  // (issues/closed/20260805-headless-app-nested-demo-root.md; LLP 0176 A4).
  const { appDir, backendDir, generatedDir, repoRoot } = resolveHeadlessAppLayout(
    metaUrl,
    { appDir: appDirOption },
  );
  if (!existsSync(join(generatedDir, 'schema.manifest.json'))) {
    throw new Error(
      `SNAPBACK_KIT_GENERATED_ARTIFACTS_MISSING: ${generatedDir} has no ` +
        'schema.manifest.json; run codegen first, e.g. ' +
        `node packages/snapback-codegen/index.mjs ${backendDir}`,
    );
  }
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
  const provisioner = new SnapbackClient(server.baseUrl, {
    ...server.clientOptions,
    rqsStore: null,
  });
  const routesPath = join(generatedDir, 'routes.manifest.json');
  let provisioned;
  try {
    provisioned = await provisioner.ensureApp({
      schema: generated('schema.manifest.json'),
      functions: generated('functions.manifest.json'),
      // A fork is useful because it keeps the parent's real cardinalities and
      // oddities. Never mix the demo seed into that state implicitly.
      ...(forkFrom === null ? { seed: readJson(join(backendDir, 'seed.json')) } : {}),
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
    fork: server.fork ?? null,
    provisioned,
    repoRoot,
    server,
    // Only present when opened via forkFrom — exposes the fork lifecycle
    // (id, TTL, create envelope, diff, drop) to fork-aware acceptance suites.
    fork: server.fork ?? null,
    close: async () => {
      try {
        await client.closeAuth();
      } finally {
        await server.stop();
      }
    },
  };
}
