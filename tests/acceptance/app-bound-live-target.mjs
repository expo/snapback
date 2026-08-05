import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const readyFile = process.env.SNAPBACK_APP_BOUND_READY_FILE;
const port = Number(process.env.SNAPBACK_APP_BOUND_PORT ?? '43991');
if (!readyFile || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
  throw new Error('SNAPBACK_APP_BOUND_READY_FILE and a valid SNAPBACK_APP_BOUND_PORT are required');
}

const { generate } = await import(`${root}/packages/snapback-codegen/index.mjs`);
const { SnapbackClient } = await import(`${root}/packages/snapback-client/index.mjs`);
const {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} = await import(`${root}/packages/snapback-contract/index.mjs`);
const { startServer } = await import(`${root}/demos/_kit/server-process.mjs`);

const scratch = await mkdtemp(`${process.env.RUNNER_TEMP ?? '/tmp'}/snapback-app-bound-live-`);
const backendRoot = join(scratch, 'app', 'snapback');
const fixtureRoot = join(root, 'tests', 'acceptance', 'fixtures', 'app-cli-journey');
const bearerFile = join(scratch, 'session-bearer');
let server = null;

const shutdown = async () => {
  await server?.stop?.();
  await rm(scratch, { recursive: true, force: true });
  process.exit(0);
};

try {
  await cp(fixtureRoot, backendRoot, { recursive: true });
  await rm(join(backendRoot, 'generated'), { recursive: true, force: true });
  const generated = await generate(backendRoot);
  if (!generated.ok) throw new Error(JSON.stringify(generated.diagnostics));
  const readJson = async (name) => JSON.parse(await readFile(join(backendRoot, 'generated', name), 'utf8'));
  const schema = await readJson('schema.manifest.json');
  const functions = await readJson('functions.manifest.json');
  const members = await readJson('api-envelope.members.json');
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, JSON.stringify({ formatVersion: 1, schema, functions }), { mode: 0o600 });
  server = await startServer({
    port,
    bindPortExactly: true,
    db: ':memory:',
    cwd: root,
    serverBinary: join(root, 'target', 'debug', 'snapback'),
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });
  const admin = new SnapbackClient(server.baseUrl, { adminToken: server.adminToken });
  await admin.ensureApp({
    intent: 'provision',
    requestedMode: 'sessions',
    schema,
    functions,
    apiEnvelope: members,
  });
  const custodyState = { custody: {} };
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
    storage: createMemoryAuthCustodyStorage({ state: custodyState }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const user = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'app-bound-linux-proof',
  });
  const requested = await user.authRequestCode('app-bound-linux@example.test');
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  if (!mailboxResponse.ok) throw new Error(JSON.stringify(mailbox));
  await user.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
  const bearer = custodyState.custody[schema.appId]?.bearer;
  if (typeof bearer !== 'string') throw new Error('session bearer was not established');
  await writeFile(bearerFile, `${bearer}\n`, { mode: 0o600 });
  await writeFile(readyFile, JSON.stringify({ appId: schema.appId, bearerFile, port }), { mode: 0o600 });
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  await new Promise(() => {});
} catch (error) {
  await server?.stop?.();
  await rm(scratch, { recursive: true, force: true });
  throw error;
}
