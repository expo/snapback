import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import api from '../snapback/generated/api.mjs';
import { mutate, sessionClient } from './client.mjs';

const instrument = '/home/ccheever/bench-0317-wave5/instrument-036-final';
const fixtureRoot = join(instrument, 'fixtures/social-messenger');
const personas = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8')).starter;
const personaById = new Map(personas.map((persona) => [persona.id, persona]));
const handleById = new Map(personas.map((persona) => [persona.id, persona.handle]));
let activeClient = null;
let activeActor = null;
const conversationAliases = new Map();
const executed = [];
const sampleMode = process.argv.includes('--sample-50');

function tokens(line) {
  return [...line.matchAll(/"([^"]*)"|(\S+)/gu)].map((match) => match[1] ?? match[2]);
}

function fixtureRef(relative) {
  return `fixture:${relative.split('/').at(-1).replace(/\.[^.]+$/u, '')}`;
}

async function clientFor(id) {
  if (activeClient && activeActor === id) return activeClient;
  await activeClient?.dispose();
  const persona = personaById.get(id);
  if (!persona) throw new Error(`Unknown fixture persona ${id}`);
  activeClient = await sessionClient({ email: persona.email, password: persona.password, signup: true, databaseName: `clique-replay-${id}-${Date.now()}` });
  activeActor = id;
  return activeClient;
}

async function run(line, segment, lineNumber) {
  const [timestamp, actor, action, ...args] = tokens(line);
  if (action === 'register' && !personaById.has(actor)) {
    personaById.set(actor, { id: actor, email: args[0], password: args[1], handle: actor });
  }
  const persona = personaById.get(actor);
  const client = await clientFor(actor);
  if (action === 'register') {
    // clientFor signs up, or adopts the already-created fixture session.
  } else if (action === 'profile-set') {
    handleById.set(actor, args[1]);
    await mutate(client, api.upsertProfile, {
      email: persona.email, displayName: args[0], handle: args[1], bio: args[2],
      location: args[3], link: args[4], avatarUri: fixtureRef(args[5]),
    }, `replay-${segment}-${lineNumber}`);
  } else if (action === 'follow') {
    await mutate(client, api.setFollow, { targetHandle: handleById.get(args[0]) ?? args[0], state: args[1], mutationId: args[2] }, `replay-${args[2]}`);
  } else if (action === 'post') {
    const [externalId, type, text, media = ''] = args;
    const mediaFiles = media ? media.split(',') : [];
    await mutate(client, api.createPost, {
      externalId, type: type === 'images' ? 'image' : type, text,
      mediaUri1: mediaFiles[0] ? fixtureRef(mediaFiles[0]) : '', mediaUri2: mediaFiles[1] ? fixtureRef(mediaFiles[1]) : '', parentExternalId: '',
    }, `replay-post-${externalId}`);
  } else if (action === 'reply') {
    await mutate(client, api.createPost, { externalId: args[0], type: 'text', text: args[2], mediaUri1: '', mediaUri2: '', parentExternalId: args[1] }, `replay-reply-${args[0]}`);
  } else if (action === 'like') {
    await mutate(client, api.setPostLike, { postExternalId: args[0], state: args[1], mutationId: args[2] }, `replay-${args[2]}`);
  } else if (action === 'repost') {
    await mutate(client, api.setRepost, { postExternalId: args[0], state: args[1], mutationId: args[2] }, `replay-${args[2]}`);
  } else if (action === 'dm-create') {
    conversationAliases.set(args[0], await mutate(client, api.ensureDm, { otherHandle: handleById.get(args[1]) ?? args[1] }, `replay-dm-${args[0]}`));
  } else if (action === 'group-create') {
    await mutate(client, api.createGroup, { externalId: args[0], memberHandles: [handleById.get(args[1]) ?? args[1]], name: args[2], description: args[3] }, `replay-group-${args[0]}`);
    conversationAliases.set(args[0], args[0]);
  } else if (action === 'member-add') {
    await mutate(client, api.changeMember, { conversationExternalId: conversationAliases.get(args[0]) ?? args[0], targetHandle: handleById.get(args[1]) ?? args[1], action: 'add', mutationId: args[2] }, `replay-${args[2]}`);
  } else if (action === 'send') {
    const quote = args.find((value) => value.startsWith('quote='))?.slice(6) ?? '';
    await mutate(client, api.sendMessage, { externalId: args[0], conversationExternalId: conversationAliases.get(args[1]) ?? args[1], text: args[2], mediaUri: '', mediaKind: '', viewOnce: false, replyToExternalId: quote }, `replay-send-${args[0]}`);
  } else if (action === 'send-media') {
    await mutate(client, api.sendMessage, {
      externalId: args[0], conversationExternalId: conversationAliases.get(args[1]) ?? args[1],
      text: args[4], mediaUri: fixtureRef(args[3]), mediaKind: args[2],
      viewOnce: args[5] === 'view-once', replyToExternalId: '',
    }, `replay-send-${args[0]}`);
  } else if (action === 'react') {
    await mutate(client, api.setMessageReaction, {
      messageExternalId: args[0], emoji: args[1], mutationId: args[2],
    }, `replay-${args[2]}`);
  } else {
    throw new Error(`Unsupported starter action ${action}`);
  }
  executed.push({ segment, line: lineNumber, timestamp, actor, action });
}

let failure = null;
try {
  for (const segment of sampleMode ? ['sample-50'] : ['m1', 'm2', 'm3']) {
    const file = segment === 'sample-50' ? 'sample-50.log' : `starter-${segment}.log`;
    const lines = readFileSync(join(fixtureRoot, file), 'utf8').trim().split('\n').filter(Boolean);
    for (let index = 0; index < lines.length; index += 1) await run(lines[index], segment, index + 1);
  }
} catch (error) {
  failure = error;
  throw error;
} finally {
  await activeClient?.dispose();
  const receipt = { schemaVersion: sampleMode ? 'clique.sample-replay.v1' : 'clique.starter-replay.v1', ok: failure === null, instrument: 'social-messenger@0.3.6-m8', segments: sampleMode ? ['sample-50'] : ['m1', 'm2', 'm3'], actionCount: executed.length, actions: executed, failure: failure ? String(failure.stack ?? failure) : null, completedAt: new Date().toISOString() };
  const output = new URL(sampleMode ? '../receipts/replay-sample-50.json' : '../receipts/replay.json', import.meta.url);
  mkdirSync(dirname(output.pathname), { recursive: true });
  writeFileSync(output, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(receipt)}\n`);
}
