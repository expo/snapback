import assert from 'node:assert/strict';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';
import { SnapbackClient } from './index.mjs';
import * as hosted from './hosted-browser.mjs';

assert.deepEqual(Object.keys(hosted), ['HostedBrowserSnapbackClient']);
const coordinator = new AuthCoordinator({
  appId: 'snapback.test/hosted-browser-artifact',
  storage: createMemoryAuthCustodyStorage(),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new hosted.HostedBrowserSnapbackClient('https://app.example.test', {
  authCoordinator: coordinator,
});
assert.equal(client.senderConstrained, true);
assert.equal(client instanceof hosted.HostedBrowserSnapbackClient, true);
assert.equal(client instanceof SnapbackClient, false);
assert.equal(Object.getPrototypeOf(client), hosted.HostedBrowserSnapbackClient.prototype);
assert.equal(
  Object.getPrototypeOf(hosted.HostedBrowserSnapbackClient.prototype),
  Object.prototype,
);
assert.equal(Object.isFrozen(client), true);
assert.throws(
  () => new hosted.HostedBrowserSnapbackClient('https://app.example.test', {
    authCoordinator: coordinator,
    bearerToken: 'sbs_forbidden',
  }),
  /option bearerToken is not permitted/u,
);
assert.throws(() => client.setBearerToken('sbs_forbidden'), /cannot bypass/u);
assert.throws(
  () => { client.senderConstrained = false; },
  /transport posture is immutable/u,
);
assert.throws(
  () => { client.baseUrl = 'https://attacker.example.test'; },
  /transport posture is immutable/u,
);
assert.throws(
  () => Object.setPrototypeOf(client, SnapbackClient.prototype),
  /prototype is immutable/u,
);
assert.throws(
  () => new hosted.HostedBrowserSnapbackClient('http://app.example.test', {
    authCoordinator: coordinator,
  }),
  /canonical HTTPS origin/u,
);

console.log('hosted-browser.test.mjs: direct bearer and non-HTTPS seams are excluded');
