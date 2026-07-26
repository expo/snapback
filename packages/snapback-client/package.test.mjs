import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  AgentAuthorityFence,
  SnapbackClient,
  bindSnapbackAppLifecycle,
  createExternalSessionClient,
  createMemoryAgentAuthorityCustodyStorage,
} from './index.mjs';
import {
  SnapbackClient as OnlineSnapbackClient,
  bindSnapbackAppLifecycle as bindOnlineSnapbackAppLifecycle,
} from './online.mjs';

const packageManifest = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const packageFiles = new Set(packageManifest.files);
const exportedTargets = Object.values(packageManifest.exports)
  .flatMap((target) => (typeof target === 'string' ? [target] : Object.values(target)))
  .filter((target) => target !== './package.json')
  .map((target) => target.replace(/^\.\//, ''));
for (const target of exportedTargets) {
  assert.ok(packageFiles.has(target), `package files must include exported target ${target}`);
}

assert.equal(typeof SnapbackClient, 'function');
assert.equal(OnlineSnapbackClient, SnapbackClient);
assert.equal(typeof AgentAuthorityFence, 'function');
assert.equal(typeof createMemoryAgentAuthorityCustodyStorage, 'function');
assert.equal(typeof createExternalSessionClient, 'function');
assert.equal(bindOnlineSnapbackAppLifecycle, bindSnapbackAppLifecycle);
const client = new SnapbackClient('http://127.0.0.1:9');
assert.equal(client.baseUrl, 'http://127.0.0.1:9');
assert.throws(
  () => new SnapbackClient('http://127.0.0.1:9', {
    agentAuthority: Object.create(AgentAuthorityFence.prototype),
  }),
  /agentAuthority must be an AgentAuthorityFence/,
);
const agentAuthority = new AgentAuthorityFence({
  actorUserId: '018f0f00-0000-7000-8000-000000000001',
  credentialId: '018f0f00-0000-7000-8000-000000000002',
  credentialGeneration: 0,
  grantId: '018f0f00-0000-7000-8000-000000000003',
  tokenId: '018f0f00-0000-7000-8000-000000000004',
  bearerToken: 'package-test-bearer',
});
const agentClient = new SnapbackClient('http://127.0.0.1:9', { agentAuthority });
assert.equal(agentClient.agentAuthority, agentAuthority);
const externalClient = createExternalSessionClient('http://127.0.0.1:9', {
  bearerToken: 'sbs_external_package_test',
});
assert.equal(externalClient.bearerToken, 'sbs_external_package_test');
assert.deepEqual(externalClient.authProtocols, {
  authClient: 1,
  authInvalidation: 1,
  authorityDescriptor: 1,
  authorizedLease: null,
});
assert.throws(
  () => createExternalSessionClient('http://127.0.0.1:9', { bearerToken: '' }),
  /non-empty bearerToken/,
);
assert.throws(
  () => new SnapbackClient('http://127.0.0.1:9', { authClientProtocol: 1 }),
  /explicit external-bearer custody/,
);
assert.throws(
  () => externalClient.setBearerToken('sbs_external_replacement'),
  /replaceBearerToken/u,
);
const externalTransitionEvents = [];
let settleExternalRelease;
const externalHandle = {
  pause() {
    externalTransitionEvents.push('pause');
    return new Promise((resolve) => { settleExternalRelease = resolve; });
  },
  async resume() { externalTransitionEvents.push('resume'); },
};
externalClient.__externalBearerHandles.add(externalHandle);
const unregisterExternalMaterialization = externalClient.registerAuthMaterialization({
  capture: () => null,
  blank: () => externalTransitionEvents.push('blank'),
});
externalClient.__connectionGrants.set('old', Promise.resolve({
  id: 'old',
  token: 'old',
}));
externalClient.__liveStreamManagers = new Map([['old', {
  close() { externalTransitionEvents.push('close'); },
}]]);
const externalReplacement = externalClient.replaceBearerToken('sbs_external_replacement');
await Promise.resolve();
assert.deepEqual(
  externalTransitionEvents,
  ['pause', 'blank'],
  'predecessor rows blank before asynchronous unsubscribe settlement',
);
assert.equal(
  externalClient.bearerToken,
  'sbs_external_package_test',
  'successor bearer is not installed before predecessor release settles',
);
settleExternalRelease();
await externalReplacement;
assert.equal(externalClient.bearerToken, 'sbs_external_replacement');
assert.deepEqual(externalTransitionEvents, ['pause', 'blank', 'close', 'resume']);
assert.equal(externalClient.__connectionGrants.size, 0);
assert.equal(externalClient.__liveStreamManagers.size, 0);
externalClient.__externalBearerHandles.delete(externalHandle);
unregisterExternalMaterialization();
const appStateListeners = new Set();
const appState = {
  currentState: 'active',
  addEventListener(event, listener) {
    assert.equal(event, 'change');
    appStateListeners.add(listener);
    return { remove: () => appStateListeners.delete(listener) };
  },
};
const lifecycleCalls = [];
const lifecycle = bindSnapbackAppLifecycle(appState, {
  pause() { lifecycleCalls.push('pause'); },
  async resume() { lifecycleCalls.push('resume'); },
});
for (const listener of appStateListeners) listener('background');
for (const listener of appStateListeners) listener('active');
await lifecycle.settled();
assert.deepEqual(lifecycleCalls, ['pause', 'resume']);
lifecycle.dispose();
assert.equal(appStateListeners.size, 0);

{
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({
      intent: 'provision',
      schema: 'provisioned',
      functions: 'provisioned',
      seed: 'skipped-absent',
      profile: 'dev',
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };
  try {
    const provisioningClient = new SnapbackClient('http://snapback.test', {
      adminToken: 'ensure-admin',
    });
    const outcome = await provisioningClient.ensureApp({
      intent: 'provision',
      requestedMode: 'sessions',
      schema: { appId: 'sessions-app' },
      functions: { appId: 'sessions-app' },
    });
    assert.equal(outcome.intent, 'provision');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, 'http://snapback.test/app/ensure');
    assert.equal(
      new Headers(requests[0].init.headers).get('x-snapback-admin-token'),
      'ensure-admin',
    );
    assert.deepEqual(JSON.parse(requests[0].init.body), {
      intent: 'provision',
      requestedMode: 'sessions',
      schema: { appId: 'sessions-app' },
      functions: { appId: 'sessions-app' },
    });
    await assert.rejects(
      provisioningClient.ensureApp({
        intent: 'attest',
        requestedMode: 'sessions',
      }),
      /intent must be 'provision'/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}

console.log('package.test.mjs: packaged client exports are consumable');
