import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '@expo/snapback-client';
import { createCommandClient } from '@expo/snapback-client/commands';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract';
import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import app from '../snapback/generated/app.mjs';
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
  clientStoreId: 'probe-avatar',
  rqsStore: null,
});
await client.authPasswordSignIn({ email: persona.email, password: persona.password });
const profile = await client.mutate(api.ensureProfile, { args: { displayName: persona.displayName } });
console.log('profile', JSON.stringify(profile.result ?? profile).slice(0, 200));
const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture-1x1.png'));
const commands = createCommandClient(client);
const profileId = profile.result?._id ?? profile._id ?? profile.result;
const task = commands.start(app.commands.changeAvatar, {
  profileId,
  avatar: new Blob([png], { type: 'image/png' }),
});
await task.done.catch(() => {});
console.log('SNAPSHOT', JSON.stringify(task.snapshot()).slice(0, 900));
await client.closeAuth();
