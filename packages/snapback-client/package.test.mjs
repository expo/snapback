import assert from 'node:assert/strict';

import {
  AgentAuthorityFence,
  SnapbackClient,
  createMemoryAgentAuthorityCustodyStorage,
} from './index.mjs';
import { SnapbackClient as OnlineSnapbackClient } from './online.mjs';

assert.equal(typeof SnapbackClient, 'function');
assert.equal(OnlineSnapbackClient, SnapbackClient);
assert.equal(typeof AgentAuthorityFence, 'function');
assert.equal(typeof createMemoryAgentAuthorityCustodyStorage, 'function');
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

console.log('package.test.mjs: packaged client exports are consumable');
