import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  SnapbackClient,
  createMemoryAgentAuthorityCustodyStorage,
} from './index.mjs';

assert.equal(typeof SnapbackClient, 'function');
assert.equal(typeof AgentAuthorityFence, 'function');
assert.equal(typeof createMemoryAgentAuthorityCustodyStorage, 'function');
const client = new SnapbackClient('http://127.0.0.1:9');
assert.equal(client.baseUrl, 'http://127.0.0.1:9');

console.log('package.test.mjs: packaged client exports are consumable');
