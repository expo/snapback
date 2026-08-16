import { readFileSync } from 'node:fs';
import { SnapbackClient } from '@expo/snapback-client';
import { createCommandClient } from '@expo/snapback-client/commands';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '@expo/snapback-contract';
import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import app from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const persona = MEDIA_POST_PERSONAS[1];
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
  clientStoreId: 'probe-real-video',
  rqsStore: null,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
const mov = readFileSync(process.env.REAL_MOV);
console.log('mov bytes', mov.length);
const commands = createCommandClient(client);
const task = commands.start(app.commands.createPost, {
  body: 'real device video verification',
  media: [new Blob([mov], { type: 'video/quicktime' })],
});
await task.done.catch(() => {});
const settled = task.snapshot();
console.log('TASK', settled.status, settled.diagnostic ? JSON.stringify(settled.diagnostic).slice(0, 200) : '');
if (settled.status === 'committed') {
  const feed = await client.query(api.listPosts, { args: {} });
  const post = feed.rows.find((r) => r.body === 'real device video verification');
  const media = await client.query(api.postMediaList, { args: { parentId: post._id } });
  const row = (media.rows ?? [media])[0];
  console.log('REAL_VIDEO_VERIFIED', JSON.stringify(row.children.map((c) => c.media.kind)));
}
await client.closeAuth();
