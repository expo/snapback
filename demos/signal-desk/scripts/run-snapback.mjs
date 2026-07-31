import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { SnapbackClient } from '@expo/snapback-client';
import { startServer } from '../../_kit/server-process.mjs';
import { resolveGeneratedArtifact } from '@expo/snapback-codegen/review-surface';
import { resetInstallGeneratedSeed } from './versioned-seed.mjs';

// @ref LLP 0031#server-binary-identity-on-health — an explicit fallback
// binary must retain the harness's independent stamp-mismatch verdict.
const demoRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const generatedJson = async (path) => JSON.parse(
  await readFile(resolveGeneratedArtifact(generatedRoot, path), 'utf8'),
);
const configuredBinary = process.env.SNAPBACK_SERVER_BINARY;

const server = await startServer({
  port: 4287,
  bindPortExactly: true,
  db: ':memory:',
  cwd: repoRoot,
  ...(configuredBinary ? { serverBinary: resolve(configuredBinary) } : {}),
  provenance: {
    appId: 'backend-bakeoff',
    artifactsPath: join(demoRoot, 'snapback', 'generated', 'artifacts.json'),
  },
});
const client = new SnapbackClient(server.baseUrl, server.clientOptions);
await client.ensureApp({
  schema: await generatedJson('schema.manifest.json'),
  functions: await generatedJson('functions.manifest.json'),
  routes: await generatedJson('routes.manifest.json'),
  intent: 'provision',
  requestedMode: 'sessions',
});
await resetInstallGeneratedSeed(
  client,
  await generatedJson('seed.artifact.json'),
);
process.stdout.write(`Signal Desk Snapback backend ready at ${server.baseUrl}.\n`);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await server.stop();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await new Promise(() => {});
