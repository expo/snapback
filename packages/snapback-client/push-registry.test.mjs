import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFakeExpoFileSystem } from './fake-expo-file-system.mjs';
import {
  createExternalSessionClient,
  SnapbackClient,
} from './index.mjs';
import { createExpoPushInstallationStorage } from './push-installation-expo.mjs';
import {
  attachPushRegistry,
  newPushInstallationId,
} from './push-registry.mjs';

const createTestInstallationStorage = (initialValue = null) => {
  let value = initialValue;
  return {
    async read() { return value; },
    async write(next) { value = next; },
    async clear() { value = null; },
  };
};

const rootOnly = new SnapbackClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_push_absent_storage',
});
assert.equal(SnapbackClient.prototype.health.length, 0, 'the public health signature stays exact');
assert.equal(SnapbackClient.auth.length, 1, 'the public auth signature stays exact');
assert.equal(SnapbackClient.roomPermission.length, 2, 'the public roomPermission signature stays exact');
assert.deepEqual(SnapbackClient.auth('user_public', { permissions: ['read'] }), {
  principal: 'user_public',
  session_id: null,
  user_id: 'user_public',
  permissions: ['read'],
});
assert.equal(SnapbackClient.roomPermission('room', { id: 1 }), 'room:2:id=1:1');
assert.equal(Object.hasOwn(rootOnly, 'push'), false, 'the root client has no push runtime surface');
const absent = attachPushRegistry(rootOnly);
await assert.rejects(
  () => absent.push.installationId(),
  (error) => error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED',
  'registration custody refuses rather than silently using process memory',
);
assert.match(newPushInstallationId(), /^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u);
assert.throws(
  () => createExpoPushInstallationStorage({ fileSystem: {} }),
  /fileSystem must provide File, Directory, and Paths\.document/u,
);

const expoRoot = await mkdtemp(join(tmpdir(), 'snapback-push-installation-'));
try {
  const fake = createFakeExpoFileSystem(expoRoot);
  const defaultStorage = createExpoPushInstallationStorage({
    fileSystem: fake.module,
  });
  assert.equal(
    createExpoPushInstallationStorage({ fileSystem: fake.module }),
    defaultStorage,
    'the conventional default is one process-wide writer per device store',
  );
  const beforeLogout = attachPushRegistry(new SnapbackClient('http://127.0.0.1:9', {
    bearerToken: 'sbs_push_expo_before_logout',
  }), { pushInstallationStorage: defaultStorage });
  const afterAccountSwitch = attachPushRegistry(new SnapbackClient('http://127.0.0.1:9', {
    bearerToken: 'sbs_push_expo_after_switch',
  }), { pushInstallationStorage: defaultStorage });
  const [beforeId, switchedId] = await Promise.all([
    beforeLogout.push.installationId(),
    afterAccountSwitch.push.installationId(),
  ]);
  assert.equal(
    switchedId,
    beforeId,
    'logout/account switch preserves the device-scoped installation identity',
  );
  const pushDirectory = new fake.module.Directory(
    fake.module.Paths.document,
    'snapback-push',
  );
  assert.equal(pushDirectory.exists, true);
  assert.deepEqual(
    pushDirectory.list().map((entry) => entry.name),
    ['installation.v1.json'],
  );
  assert.equal(
    new fake.module.Directory(fake.module.Paths.document, 'snapback-rqs').exists,
    false,
    'the installation identity has dedicated custody outside the RQS cache',
  );

  await defaultStorage.clear();
  const resetId = await beforeLogout.push.installationId();
  assert.notEqual(
    resetId,
    beforeId,
    'a full app-data custody reset mints a fresh installation identity',
  );
  assert.equal(
    await afterAccountSwitch.push.installationId(),
    resetId,
    'attached clients re-read custody rather than retaining a cleared identity',
  );

  new fake.module.File(pushDirectory, 'installation.v1.json').write('{corrupt');
  await assert.rejects(
    () => beforeLogout.push.installationId(),
    (error) => error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT',
    'corrupt default custody fails closed without exposing its bytes',
  );
  await defaultStorage.clear();
} finally {
  await rm(expoRoot, { recursive: true, force: true });
}

const storage = createTestInstallationStorage();
const requests = [];
let registrationCount = 0;
let leakResponse = false;
let invalidResponseId = false;
let invalidRegisteredAt = false;
const server = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const encoded = Buffer.concat(chunks).toString('utf8');
  const body = encoded === '' ? {} : JSON.parse(encoded);
  requests.push({ path: request.url, body });
  response.setHeader('content-type', 'application/json');
  if (request.url === '/push/tokens/register') {
    registrationCount += 1;
    const payload = {
      tokenId: invalidResponseId ? 'not-a-token-id' : 'ptok_01k00000000000000000000000',
      installationId: body.installationId,
      registeredAt: invalidRegisteredAt ? -1 : registrationCount,
      rotated: registrationCount > 1,
      ownershipTransferred: false,
      ...(leakResponse ? { token: body.token } : {}),
    };
    response.end(JSON.stringify(payload));
    return;
  }
  response.end(JSON.stringify({
    tokenId: invalidResponseId ? 'not-a-token-id' : 'ptok_01k00000000000000000000000',
    retired: true,
  }));
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

try {
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  let emptyWrites = 0;
  const emptyCustody = {
    async read() { return null; },
    async write() { emptyWrites += 1; },
    async clear() {},
  };
  const empty = attachPushRegistry(new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_empty_custody',
  }), {
    pushInstallationStorage: emptyCustody,
  });
  const requestsBeforeEmptyUnregister = requests.length;
  assert.deepEqual(await empty.push.unregisterToken(), {
    tokenId: null,
    retired: false,
  });
  assert.equal(emptyWrites, 0, 'unregister never mints an installation identity');
  assert.equal(
    requests.length,
    requestsBeforeEmptyUnregister,
    'unregister with empty custody never reaches the network',
  );

  const first = attachPushRegistry(new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_registry_1',
  }), {
    pushInstallationStorage: storage,
  });
  const second = attachPushRegistry(new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_registry_2',
  }), {
    pushInstallationStorage: storage,
  });
  const installationId = await first.push.installationId();
  assert.equal(await second.push.installationId(), installationId);
  const requestsBeforeHealth = requests.length;
  await first.health('ordinary extra argument');
  assert.equal(requests.length, requestsBeforeHealth + 1);
  assert.equal(requests.at(-1).path, '/health', 'ordinary extra arguments still perform GET /health');

  const tokens = [
    'ExponentPushToken[first_secret]',
    'ExponentPushToken[rotated_secret]',
  ];
  const acquisitions = [];
  for (const token of tokens) {
    const registered = await first.push.registerExpoToken({
      projectId: 'eas-fixture',
      getExpoPushTokenAsync: async (options) => {
        acquisitions.push(options);
        return { data: token };
      },
    });
    assert.equal(Object.hasOwn(registered, 'token'), false);
    assert.equal(registered.installationId, installationId);
  }
  assert.deepEqual(acquisitions, [
    { projectId: 'eas-fixture' },
    { projectId: 'eas-fixture' },
  ], 'each native rotation signal reacquires the Expo token');
  assert.deepEqual(
    requests.filter(({ path }) => path === '/push/tokens/register').slice(0, 2).map(({ body }) => body.token),
    tokens,
  );

  const retired = await first.push.unregisterToken();
  assert.deepEqual(retired, {
    tokenId: 'ptok_01k00000000000000000000000',
    retired: true,
  });
  assert.equal(requests.at(-1).body.installationId, installationId);

  leakResponse = true;
  await assert.rejects(
    () => first.push.registerToken({ token: 'ExponentPushToken[response_echo]' }),
    /SNAPBACK_PUSH_REGISTRY_RESPONSE_INVALID/u,
    'a server response that echoes custody bytes is rejected as non-closed',
  );
  leakResponse = false;
  invalidResponseId = true;
  await assert.rejects(
    () => first.push.registerToken({ token: 'ExponentPushToken[invalid_register_id]' }),
    /SNAPBACK_PUSH_REGISTRY_RESPONSE_INVALID/u,
    'registration rejects a non-registry token-row id',
  );
  await assert.rejects(
    () => first.push.unregisterToken(),
    /SNAPBACK_PUSH_REGISTRY_RESPONSE_INVALID/u,
    'unregister rejects a non-registry token-row id',
  );
  invalidResponseId = false;
  invalidRegisteredAt = true;
  await assert.rejects(
    () => first.push.registerToken({ token: 'ExponentPushToken[negative_timestamp]' }),
    /SNAPBACK_PUSH_REGISTRY_RESPONSE_INVALID/u,
    'registration rejects a timestamp outside the server u64 domain',
  );
} finally {
  await new Promise((resolve) => server.close(resolve));
}

const corruptStorage = createTestInstallationStorage('not-an-installation-id');
const corrupt = attachPushRegistry(new SnapbackClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_push_corrupt_storage',
}), {
  pushInstallationStorage: corruptStorage,
});
await assert.rejects(
  () => corrupt.push.installationId(),
  (error) => error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT',
);

// The additive module receives the root client's fenced request capability,
// not fetch. Registration therefore waits behind external-bearer replacement
// and can dispatch only with successor custody.
const barrierStorage = createTestInstallationStorage();
const barrierClient = attachPushRegistry(createExternalSessionClient('http://push-barrier.test', {
  bearerToken: 'sbs_push_predecessor',
}), { pushInstallationStorage: barrierStorage });
let settleBarrierRelease;
barrierClient.__externalBearerHandles.add({
  paused: false,
  pause() { return new Promise((resolve) => { settleBarrierRelease = resolve; }); },
  async resume() {},
});
const replacement = barrierClient.replaceBearerToken('sbs_push_successor');
await Promise.resolve();
const originalFetch = globalThis.fetch;
const barrierFetches = [];
globalThis.fetch = async (url, init = {}) => {
  barrierFetches.push({
    url: String(url),
    authorization: new Headers(init.headers).get('authorization'),
  });
  return new Response(JSON.stringify({
    diagnostic: { code: 'SNAPBACK_PUSH_BARRIER_PROBE', message: 'probe' },
  }), { status: 503, headers: { 'content-type': 'application/json' } });
};
try {
  const held = barrierClient.push.registerToken({
    token: 'ExponentPushToken[barrier_probe]',
  }).catch(() => {});
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(barrierFetches, [], 'push registration cannot cross a held bearer barrier');
  settleBarrierRelease();
  await replacement;
  await held;
  assert(
    barrierFetches.length >= 1
      && barrierFetches.every(({ authorization }) => authorization === 'Bearer sbs_push_successor'),
    'push registration dispatches only under successor custody',
  );
} finally {
  globalThis.fetch = originalFetch;
}

console.log('push-registry.test.mjs: all cases passed');
