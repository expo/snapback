import { SnapbackClient } from '@expo/snapback-client';
import { createAssetClient } from '@expo/snapback-client/assets';
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
  clientStoreId: 'probe-avatar-issue',
  rqsStore: null,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
const profiles = await client.query(api.listProfiles, { args: {} });
console.log('PROFILE_AVATAR', JSON.stringify(profiles.rows[0]?.avatar));
const assets = createAssetClient(client);
const avatarValue = profiles.rows[0]?.avatar;
const assetId = typeof avatarValue === 'string' ? avatarValue : avatarValue?.assetId;
const issued = await assets.signedUrl(assetId, { widthPx: 240 });
console.log('AVATAR_ISSUE_OK', issued.url.slice(0, 60));
await client.closeAuth();
