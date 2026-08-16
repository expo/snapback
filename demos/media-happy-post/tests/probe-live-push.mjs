import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SnapbackClient } from '@expo/snapback-client';
import { createCommandClient } from '@expo/snapback-client/commands';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '@expo/snapback-contract';
import { MEDIA_POST_PERSONAS } from '../personas.mjs';
import app from '../snapback/generated/app.mjs';
import api from '../snapback/generated/api.mjs';

const persona = MEDIA_POST_PERSONAS[0];
function makeClient(id) {
  const coordinator = new AuthCoordinator({
    appId: 'media-happy-post',
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient('http://127.0.0.1:4431', {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId: id,
    rqsStore: null,
  });
}

const watcher = makeClient('live-push-watcher');
await watcher.authPasswordSignIn({ email: persona.email, password: persona.password });
const emissions = [];
const live = await watcher.liveQuery(api.listProfiles, {
  connectionId: 'live-push-watcher',
  args: {},
  onUpdate: (rows) => {
    emissions.push(JSON.stringify(rows?.[0]?.avatar ?? null));
    console.log('EMISSION', emissions.length, emissions.at(-1)?.slice(0, 60));
  },
});
await new Promise((r) => setTimeout(r, 1500));

const actor = makeClient('live-push-actor');
await actor.authPasswordSignIn({ email: persona.email, password: persona.password });
const profiles = await actor.query(api.listProfiles, { args: {} });
const profileId = profiles.rows[0]._id;
const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixture-1x1.png'));
const commands = createCommandClient(actor);
const task = commands.start(app.commands.changeAvatar, {
  profileId,
  avatar: new Blob([png], { type: 'image/png' }),
});
await task.done.catch(() => {});
console.log('CHANGE', task.snapshot().status);
await new Promise((r) => setTimeout(r, 8000));
console.log('RESULT emissions:', emissions.length, 'last:', emissions.at(-1)?.slice(0, 60));
await actor.closeAuth();
await watcher.closeAuth();
