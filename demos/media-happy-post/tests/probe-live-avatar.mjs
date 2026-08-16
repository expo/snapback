import { SnapbackClient } from '@expo/snapback-client';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '@expo/snapback-contract';
import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import api from '../snapback/generated/api.mjs';

const persona = MEDIA_POST_PERSONAS[0];
const coordinator = new AuthCoordinator({
  appId: 'media-happy-post',
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient('http://127.0.0.1:4431', {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'probe-live-avatar',
  rqsStore: null,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
let resolveDone;
const done = new Promise((resolve) => { resolveDone = resolve; });
const timeout = setTimeout(() => resolveDone('TIMEOUT_NO_EMISSION'), 15000);
const live = await client.liveQuery(api.listProfiles, {
  connectionId: 'probe-live-avatar',
  args: {},
  onUpdate: (rows) => {
    clearTimeout(timeout);
    resolveDone(JSON.stringify(rows?.[0]?.avatar ?? null));
  },
});
console.log('LIVE_AVATAR', await done);
await (live.close?.() ?? live.dispose?.() ?? live.unsubscribe?.());
await client.closeAuth();
