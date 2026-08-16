import { SnapbackClient } from '@expo/snapback-client';
import { createCommandClient } from '@expo/snapback-client/commands';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import app from '../snapback/generated/app.mjs';

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
  clientStoreId: 'probe-diagnostic',
  rqsStore: null,
  offlineQueue: false,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQAB'
  + 'h6FO1AAAAABJRU5ErkJggg==',
  'base64',
);
const commands = createCommandClient(client);
const task = commands.start(app.commands.createPost, {
  body: 'probe',
  media: [new Blob([png], { type: 'image/png' })],
});
await task.done.catch(() => {});
console.log(JSON.stringify(task.snapshot(), null, 1).slice(0, 2000));
await client.closeAuth();
