#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '../../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';
import { installM2Fixtures } from './seed-m2.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const fixtureRoot = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger');
const starterM3Path = join(fixtureRoot, 'starter-m3.log');
const starterM3Digest = '4b03a5935eda1cee32e4031ade2bef41cb1d304922edc07ecf9e6f3893e51008';
const api = await loadGeneratedApi();
const schemaManifest = loadGeneratedJson('schema.manifest.json');

function passwordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schemaManifest.appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  return new SnapbackClient(baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
    offlineQueue: false,
  });
}

function fixturePersonas() {
  const source = JSON.parse(readFileSync(join(fixtureRoot, 'personas.json'), 'utf8'));
  if (source.version !== '0.1.0-p1' || !Array.isArray(source.starter) || source.starter.length !== 8) {
    throw new Error('Coterie M3 requires the eight social-messenger starter identities');
  }
  return source.starter;
}

function tokensFor(line) {
  const tokens = [];
  let index = 0;
  while (index < line.length) {
    while (line[index] === ' ' || line[index] === '\t') index += 1;
    if (index >= line.length) break;
    if (line[index] === '"') {
      const start = index;
      index += 1;
      let escaped = false;
      while (index < line.length) {
        const character = line[index];
        if (!escaped && character === '"') {
          index += 1;
          break;
        }
        escaped = !escaped && character === '\\';
        if (character !== '\\') escaped = false;
        index += 1;
      }
      tokens.push(JSON.parse(line.slice(start, index)));
    } else {
      const start = index;
      while (index < line.length && line[index] !== ' ' && line[index] !== '\t') index += 1;
      tokens.push(line.slice(start, index));
    }
  }
  return tokens;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function starterActions() {
  const bytes = readFileSync(starterM3Path);
  const observedDigest = sha256(bytes);
  if (observedDigest !== starterM3Digest) {
    throw new Error(`starter-m3.log digest ${observedDigest} does not match ${starterM3Digest}`);
  }
  return bytes.toString('utf8').trim().split('\n').map((line) => {
    const [timestamp, actor, verb, ...args] = tokensFor(line);
    return { timestamp, actor, verb, args, line, digest: sha256(line) };
  });
}

function quotedFixtureId(action) {
  const token = action.args[3];
  if (!token) return null;
  if (!token.startsWith('quote=')) throw new Error(`invalid quote token in ${action.line}`);
  return token.slice('quote='.length);
}

export async function installM3Fixtures({
  baseUrl,
  runId = 'install',
  destructiveResetConfirmed = false,
}) {
  if (typeof baseUrl !== 'string' || !baseUrl.startsWith('http')) {
    throw new TypeError('installM3Fixtures requires a Snapback baseUrl');
  }
  if (destructiveResetConfirmed !== true) {
    const error = new Error(
      'COTERIE_M3_RESET_RESEED_CONFIRMATION_REQUIRED: reset the disposable Coterie database before installing M3 fixtures, then pass destructiveResetConfirmed: true',
    );
    error.code = 'COTERIE_M3_RESET_RESEED_CONFIRMATION_REQUIRED';
    throw error;
  }
  const m2 = await installM2Fixtures({ baseUrl, runId: `m3-${runId}` });
  const clients = new Map();
  const profiles = new Map();
  const conversations = new Map();
  const messages = new Map();
  const actions = starterActions();
  const report = {
    m2,
    logDigest: starterM3Digest,
    conversations: [],
    memberships: [],
    messages: [],
  };
  try {
    for (const persona of fixturePersonas()) {
      const client = passwordClient(baseUrl, `coterie-m3-${runId}-${persona.id}`);
      clients.set(persona.id, client);
      await client.authPasswordSignIn({ email: persona.email, password: persona.password });
      const profile = (await client.query(api.getMyProfile, { args: {} })).rows[0];
      if (!profile || profile.fixtureId !== persona.id) {
        throw new Error(`fixture principal ${persona.id} has no matching profile`);
      }
      profiles.set(persona.id, profile);
    }

    for (const action of actions) {
      const client = clients.get(action.actor);
      if (!client) throw new Error(`unknown fixture actor ${action.actor}`);
      if (action.verb === 'dm-create') {
        const [fixtureId, otherActor] = action.args;
        const other = profiles.get(otherActor);
        if (!other) throw new Error(`unknown DM target ${otherActor}`);
        const outcome = (await client.mutate(api.ensureFixtureDm, {
          args: {
            fixtureId,
            fixtureDigest: action.digest,
            otherProfileId: other._id,
          },
        })).result;
        conversations.set(fixtureId, outcome.conversationId);
        report.conversations.push({ fixtureId, ...outcome });
      } else if (action.verb === 'group-create') {
        const [fixtureId, secondActor, name, description] = action.args;
        const second = profiles.get(secondActor);
        if (!second) throw new Error(`unknown group member ${secondActor}`);
        const outcome = (await client.mutate(api.ensureFixtureGroup, {
          args: {
            fixtureId,
            fixtureDigest: action.digest,
            secondMemberProfileId: second._id,
            name,
            description,
          },
        })).result;
        conversations.set(fixtureId, outcome.conversationId);
        report.conversations.push({ fixtureId, ...outcome });
      } else if (action.verb === 'member-add') {
        const [conversationFixtureId, memberActor, mutationId] = action.args;
        const conversationId = conversations.get(conversationFixtureId);
        const member = profiles.get(memberActor);
        if (!conversationId || !member) throw new Error(`unresolved member-add ${action.line}`);
        const outcome = (await client.mutate(api.ensureFixtureMember, {
          args: {
            conversationId,
            profileId: member._id,
            mutationId,
            sourceDigest: action.digest,
          },
        })).result;
        report.memberships.push({ mutationId, ...outcome });
      } else if (action.verb === 'send') {
        const [fixtureId, conversationFixtureId, body] = action.args;
        const conversationId = conversations.get(conversationFixtureId);
        const quoteFixtureId = quotedFixtureId(action);
        const quotedMessageId = quoteFixtureId ? messages.get(quoteFixtureId) : null;
        if (!conversationId || (quoteFixtureId && !quotedMessageId)) {
          throw new Error(`unresolved send ${action.line}`);
        }
        const outcome = (await client.mutate(api.ensureFixtureMessage, {
          args: {
            fixtureId,
            fixtureDigest: action.digest,
            conversationId,
            body,
            ...(quotedMessageId ? { quotedMessageId } : {}),
          },
        })).result;
        messages.set(fixtureId, outcome.messageId);
        report.messages.push({ fixtureId, ...outcome });
      } else {
        throw new Error(`unsupported M3 fixture action ${action.verb}`);
      }
    }

    for (const action of actions) {
      const client = clients.get(action.actor);
      if (action.verb === 'dm-create' || action.verb === 'group-create') {
        const fixtureId = action.args[0];
        const row = (await client.query(api.getMyFixtureConversation, {
          args: { fixtureId },
        })).rows[0];
        if (!row || row._id !== conversations.get(fixtureId) || row.fixtureDigest !== action.digest) {
          throw new Error(`fixture conversation ${fixtureId} failed digest verification`);
        }
      } else if (action.verb === 'send') {
        const fixtureId = action.args[0];
        const row = (await client.query(api.getMyFixtureMessage, {
          args: { fixtureId },
        })).rows[0];
        if (!row || row._id !== messages.get(fixtureId) || row.fixtureDigest !== action.digest) {
          throw new Error(`fixture message ${fixtureId} failed digest verification`);
        }
      }
    }

    const alice = clients.get('alice');
    const expectedMessageCounts = new Map([
      ['d-alice-bob', 6],
      ['g-starter', 9],
    ]);
    for (const [fixtureId, expectedCount] of expectedMessageCounts) {
      const rows = (await alice.query(api.listMessages, {
        args: { conversationId: conversations.get(fixtureId) },
      })).rows;
      if (rows.length !== expectedCount) {
        throw new Error(`${fixtureId} has ${rows.length} messages; expected ${expectedCount}`);
      }
    }
    return report;
  } finally {
    await Promise.allSettled([...clients.values()].map((client) => client.closeAuth()));
  }
}

function cliBaseUrl(argv) {
  const index = argv.indexOf('--url');
  if (index >= 0 && argv[index + 1]) return argv[index + 1];
  return process.env.SNAPBACK_URL ?? null;
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
  const baseUrl = cliBaseUrl(process.argv.slice(2));
  const destructiveResetConfirmed = process.argv.includes('--destructive-reset-confirmed');
  if (!baseUrl || !destructiveResetConfirmed) {
    process.stderr.write('usage: node demos/coterie/snapback/seed-m3.mjs --url http://127.0.0.1:<port> --destructive-reset-confirmed\n');
    process.exitCode = 2;
  } else {
    const report = await installM3Fixtures({
      baseUrl,
      runId: `cli-${Date.now()}`,
      destructiveResetConfirmed,
    });
    process.stdout.write(`${JSON.stringify({ ok: true, ...report })}\n`);
  }
}
