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
const client = new SnapbackClient(process.env.ORIGIN ?? 'http://127.0.0.1:4431', {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'probe-issuance',
  rqsStore: null,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
const feed = await client.query(api.listPosts, { args: {} });
const post = feed.rows[0];
const media = await client.query(api.postMediaList, { args: { parentId: post._id } });
const row = (media.rows ?? media.items ?? [media])[0];
const children = row.children;
console.log('ITEM_SHAPE', JSON.stringify(children[0]).slice(0, 400));
const assets = createAssetClient(client);
const assetId = children[0].media.assetId;
for (const opts of [{ variant: 'primary' }, { widthPx: 960 }, undefined]) {
  try {
    const issued = await assets.signedUrl(assetId, opts);
    console.log('OK', JSON.stringify(opts), issued.url);
  } catch (e) {
    console.log('FAIL', JSON.stringify(opts), e?.code ?? e?.message);
  }
}
await client.closeAuth();

