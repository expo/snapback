#!/usr/bin/env node

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import { createFileRqsResumeStore } from '@expo/snapback-client/rqs-store-file';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import { generate } from '@expo/snapback-codegen';
import { startServer } from '../../demos/_kit/server-process.mjs';

// @ref LLP 0255#acceptance — A1 crosses the published doorways and a real local target.

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const fixture = join(root, 'tests/fixtures/data-surface-a1');
const backend = join(fixture, 'snapback');
const generatedRoot = join(backend, 'generated');
const serverBinary = resolve(process.env.SNAPBACK_RUNTIME_BINARY ?? join(root, 'target/debug/snapback'));
const scratch = await mkdtemp(join(tmpdir(), 'snapback-data-surface-a1-'));
const database = join(scratch, 'a1.sqlite');
const startupArtifacts = join(scratch, 'startup-artifacts.json');
const storeDirectory = join(scratch, 'client-store');
let server = null;
let store = null;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

try {
  let result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  execFileSync(serverBinary, [
    'composition-activation-prepare',
    '--db', database,
    '--generated', generatedRoot,
    '--deployment-id', 'data-surface-a1-phase4',
  ], {
    cwd: root,
    env: { ...process.env, DYLD_FRAMEWORK_PATH: join(root, 'vendor/ibex/ios/Frameworks') },
  });
  result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  await writeFile(startupArtifacts, `${JSON.stringify({
    formatVersion: 1,
    schema: await readJson(join(generatedRoot, 'schema.manifest.json')),
    functions: await readJson(join(generatedRoot, 'functions.manifest.json')),
  })}\n`);

  server = await startServer({
    port: 0,
    db: database,
    cwd: root,
    serverBinary,
    startupArtifacts,
    trustedCompositionActivation: join(generatedRoot, 'trusted-composition-activation.json'),
    captureImpersonationCapability: true,
    startupTimeoutMs: 120_000,
  });

  const appId = (await readJson(join(generatedRoot, 'schema.manifest.json'))).appId;
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  store = createFileRqsResumeStore({ directory: storeDirectory, clientStoreId: 'data-surface-a1' });
  await store.whenLockSettled();
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: 'data-surface-a1',
    rqsStore: store,
    offlineQueue: true,
  });
  const requested = await client.authRequestCode('a1@data-surface.test');
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    { headers: {
      'x-snapback-admin-token': server.adminToken,
      'x-snapback-impersonation-capability': server.impersonationCapability,
    } },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });

  const app = await import(`${pathToFileURL(join(backend, 'app.mjs')).href}?a1=${Date.now()}`);
  assert.equal(app.reactAndExpoShareDoorway, true);
  const db = app.createA1Database(client);
  const transaction = app.createThree(db);
  const dispatch = await transaction.dispatched;
  const settlement = await transaction.settled;
  assert.equal(dispatch.status, 'settled', JSON.stringify(dispatch));
  assert.equal(settlement.status, 'committed', JSON.stringify(settlement));
  assert.equal(settlement.results.length, 3);

  const descriptor = app.firstPage();
  const page1 = await db.read(descriptor);
  assert.deepEqual(page1.rows.map(({ title }) => title), ['one', 'two']);
  assert.equal(page1.complete, false);
  assert.match(page1.cursor, /^dc1\./u);
  const page2 = await db.read(descriptor.after(page1.cursor));
  assert.deepEqual(page2.rows.map(({ title }) => title), ['three']);
  assert.equal(page2.cursor, null);
  assert.equal(page2.complete, true);

  console.log('data-surface A1 acceptance: 1 transaction settled; 2 pages read; 3 rows observed');
} finally {
  if (store) await store.close();
  if (server) await server.stop();
  await rm(scratch, { recursive: true, force: true });
}
