import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import {
  SnapbackClient,
  newPushInstallationId,
} from './index.mjs';

const createTestInstallationStorage = (initialValue = null) => {
  let value = initialValue;
  return {
    async read() { return value; },
    async write(next) { value = next; },
    async clear() { value = null; },
  };
};

const absent = new SnapbackClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_push_absent_storage',
});
await assert.rejects(
  () => absent.push.installationId(),
  (error) => error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_REQUIRED',
  'registration custody refuses rather than silently using process memory',
);

assert.match(newPushInstallationId(), /^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u);
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
  const empty = new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_empty_custody',
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

  const first = new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_registry_1',
    pushInstallationStorage: storage,
  });
  const second = new SnapbackClient(baseUrl, {
    bearerToken: 'sbs_push_registry_2',
    pushInstallationStorage: storage,
  });
  const installationId = await first.push.installationId();
  assert.equal(await second.push.installationId(), installationId);

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
  assert.deepEqual(requests.slice(0, 2).map(({ body }) => body.token), tokens);

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
const corrupt = new SnapbackClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_push_corrupt_storage',
  pushInstallationStorage: corruptStorage,
});
await assert.rejects(
  () => corrupt.push.installationId(),
  (error) => error?.code === 'SNAPBACK_PUSH_INSTALLATION_CUSTODY_CORRUPT',
);

console.log('push-registry.test.mjs: all cases passed');
