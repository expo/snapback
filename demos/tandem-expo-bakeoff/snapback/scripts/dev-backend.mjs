import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startServer } from '../../../_kit/server-process.mjs';

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = resolve(appRoot, '..', '..', '..');
const generatedDir = join(appRoot, 'snapback', 'generated');
const localDir = join(appRoot, '.local');
const snapbackPort = Number(process.env.TANDEM_SNAPBACK_PORT ?? 4477);
const brokerPort = Number(process.env.TANDEM_BROKER_PORT ?? 4478);
const localSnapbackOrigin = `http://127.0.0.1:${snapbackPort}`;
const localBrokerOrigin = `http://127.0.0.1:${brokerPort}`;
const publicSnapbackOrigin = process.env.TANDEM_PUBLIC_SNAPBACK_ORIGIN ?? localSnapbackOrigin;
const publicBrokerOrigin = process.env.TANDEM_PUBLIC_BROKER_ORIGIN ?? localBrokerOrigin;
const envPath = join(appRoot, '.env.local');

function readExistingBrokerToken() {
  try {
    const match = readFileSync(envPath, 'utf8').match(/^EXPO_PUBLIC_TANDEM_BROKER_TOKEN=([a-f0-9]{64})$/m);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

mkdirSync(localDir, { recursive: true });
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const startupArtifacts = join(localDir, 'startup-artifacts.json');
writeFileSync(startupArtifacts, `${JSON.stringify({
  formatVersion: 1,
  schema: readJson(join(generatedDir, 'schema.manifest.json')),
  functions: readJson(join(generatedDir, 'functions.manifest.json')),
})}\n`, { mode: 0o600 });

const snapback = await startServer({
  port: snapbackPort,
  bindPortExactly: true,
  db: join(localDir, 'tandem.sqlite'),
  cwd: repoRoot,
  startupArtifacts,
  captureImpersonationCapability: true,
});

const seedResponse = await fetch(`${snapback.baseUrl}/_snapback/api/app/seed/ensure-v1`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-snapback-admin-token': snapback.adminToken },
  body: JSON.stringify({
    formatVersion: 'snapback.seed.install-request.v1',
    operationId: '019c0000-0000-7000-8000-000000000001',
    artifact: readJson(join(generatedDir, 'seed.artifact.json')),
    requestedMode: 'sessions',
  }),
});
const seedResult = await seedResponse.json();
if (!seedResponse.ok) {
  await snapback.stop();
  throw new Error(seedResult.diagnostics?.[0]?.message ?? 'seed install failed');
}

// Keep one installation credential across ordinary backend restarts so a
// running Metro bundle does not become stale merely because the server did.
const brokerToken = readExistingBrokerToken() ?? randomBytes(32).toString('hex');
writeFileSync(envPath, [
  `EXPO_PUBLIC_TANDEM_BROKER_ORIGIN=${publicBrokerOrigin}`,
  `EXPO_PUBLIC_TANDEM_BROKER_TOKEN=${brokerToken}`,
  '',
].join('\n'), { mode: 0o600 });

let cachedBearer = null;
// @ref LLP 0064#3-react-nativeexpo-online-surface — the native carrier gets an
// ordinary app session; admin and impersonation authority remain host-side.
const broker = createServer(async (request, response) => {
  response.setHeader('access-control-allow-origin', '*');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  if (request.method === 'OPTIONS') {
    response.writeHead(204).end();
    return;
  }
  if (request.method !== 'POST' || request.url !== '/session') {
    response.writeHead(404, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'not found' }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${brokerToken}`) {
    response.writeHead(401, { 'content-type': 'application/json' }).end(JSON.stringify({ error: 'invalid app installation credential' }));
    return;
  }
  try {
    if (!cachedBearer) {
      const minted = await fetch(`${snapback.baseUrl}/_snapback/api/host-ops`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-snapback-admin-token': snapback.adminToken,
          'x-snapback-impersonation-capability': snapback.impersonationCapability,
        },
        body: JSON.stringify({
          schemaVersion: 'snapback.v0',
          requestId: `tandem-broker-${randomUUID()}`,
          operation: 'auth.mintSession',
          args: { email: 'ada@tandem.local' },
        }),
      });
      const envelope = await minted.json();
      if (!minted.ok || envelope.ok !== true || typeof envelope.data?.token !== 'string') {
        throw new Error(envelope.diagnostics?.[0]?.message ?? 'session mint failed');
      }
      cachedBearer = envelope.data.token;
    }
    response.writeHead(200, { 'cache-control': 'no-store', 'content-type': 'application/json' });
    response.end(JSON.stringify({
      bearerToken: cachedBearer,
      serverOrigin: publicSnapbackOrigin,
    }));
  } catch (error) {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});

await new Promise((resolveListen, rejectListen) => {
  broker.once('error', rejectListen);
  broker.listen(brokerPort, '127.0.0.1', resolveListen);
});
console.log(`Tandem Snapback backend ready at ${localSnapbackOrigin}`);
console.log(`Tandem identity broker ready at ${localBrokerOrigin}`);
console.log('Wrote the ignored Expo runtime configuration to .env.local (credential redacted).');

let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await new Promise((resolveClose) => broker.close(resolveClose));
  await snapback.stop();
}
process.once('SIGINT', () => { void stop().then(() => process.exit(0)); });
process.once('SIGTERM', () => { void stop().then(() => process.exit(0)); });
await new Promise(() => {});
