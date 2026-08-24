#!/usr/bin/env node

import assert from 'node:assert/strict';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  projectAppRefusal,
  SnapbackClient,
} from '../../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/index.mjs';
import { startServer } from '../../_kit/server-process.mjs';

import { loadGeneratedApi, loadGeneratedJson } from './generated-artifacts.mjs';
import {
  chatHistoryEnvelopeLimit,
  messageHistoryEnvelopeLimit,
  receiptEnvelopeAdmits,
  receiptEnvelopeMessageLimit,
} from './functions.mjs';
import { installM3Fixtures } from './seed-m3.mjs';

const backendDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(backendDir, '..', '..', '..');
const fixtureRoot = join(repoRoot, 'benchmarks', 'fixtures', 'social-messenger');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? '/Users/ccheever/projects/snapback-scratch-coterie/target/debug/snapback',
);
const api = await loadGeneratedApi();
const schema = loadGeneratedJson('schema.manifest.json');
const functions = loadGeneratedJson('functions.manifest.json');

function code(error) {
  return error?.diagnostic?.code ?? error?.code ?? null;
}

async function expectAppCode(operation, expected) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), 'SNAPBACK_APP_REFUSAL', error?.stack ?? String(error));
    assert.equal(projectAppRefusal(error)?.appCode, expected, error?.stack ?? String(error));
    return true;
  });
}

async function expectPermissionDenied(operation, label) {
  await assert.rejects(operation, (error) => {
    assert.equal(code(error), 'SNAPBACK_AUTH_PERMISSION_DENIED', `${label}: ${error?.stack ?? error}`);
    return true;
  });
}

function typingValue(actor) {
  return {
    profileId: actor.profile._id,
    userId: actor.profile.fixtureId ?? actor.profile.ownerId,
    displayName: actor.profile.displayName,
  };
}

async function releaseTyping(client, overlay, connectionId, conversationId) {
  overlay.dispose();
  await client.unsubscribeEphemeral(api.ephemeral.typing, {
    connectionId,
    scope: { conversationId },
  }).catch(() => {});
}

function passwordClient(baseUrl, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId: schema.appId,
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

async function eventually(assertion, label, timeoutMs = 15_000, intervalMs = 30) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, intervalMs));
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`, { cause: lastError });
}

async function messageRows(client, conversationId) {
  return (await client.query(api.listMessages, { args: { conversationId } })).rows;
}

async function messageRow(client, conversationId, messageId) {
  return (await messageRows(client, conversationId)).find((row) => row._id === messageId);
}

test('chat-level receipt envelope admits the exact scale boundary and refuses limit+1', () => {
  assert.equal(receiptEnvelopeMessageLimit(), 1_024);
  assert.equal(receiptEnvelopeAdmits(1_024), true);
  assert.equal(receiptEnvelopeAdmits(1_025), false);
});

test('Coterie Snapback M3 backend', { timeout: 1_800_000 }, async (t) => {
  assert(existsSync(runtimeBinary), `charter-pinned runtime is missing: ${runtimeBinary}`);
  const scratch = mkdtempSync(join(tmpdir(), 'coterie-m3-'));
  const clients = [];
  const handles = [];
  let server = null;
  t.after(async () => {
    await Promise.allSettled(handles.map(async (handle) => handle.dispose()));
    await Promise.allSettled(clients.map((client) => client.closeAuth()));
    let stopError = null;
    try {
      await server?.stop();
    } catch (error) {
      stopError = error;
    }
    rmSync(scratch, { recursive: true, force: true });
    if (stopError) throw stopError;
  });

  const stagedRuntime = join(scratch, 'snapback-runtime');
  symlinkSync(runtimeBinary, stagedRuntime);
  const carrier = join(scratch, 'startup-artifacts.json');
  writeFileSync(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
    mode: 0o600,
  });
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    serverBinary: stagedRuntime,
  });

  const firstSeed = await installM3Fixtures({ baseUrl: server.baseUrl, runId: 'first' });
  const secondSeed = await installM3Fixtures({ baseUrl: server.baseUrl, runId: 'second' });
  const personas = JSON.parse(readFileSync(
    join(fixtureRoot, 'personas.json'),
    'utf8',
  )).starter;
  const actors = new Map();
  for (const persona of personas) {
    const client = passwordClient(server.baseUrl, `coterie-m3-acceptance-${persona.id}`);
    clients.push(client);
    await client.authPasswordSignIn({ email: persona.email, password: persona.password });
    const profile = (await client.query(api.getMyProfile, { args: {} })).rows[0];
    actors.set(persona.id, { client, profile });
  }
  const alice = actors.get('alice');
  const bob = actors.get('bob');
  const carol = actors.get('carol');
  const dave = actors.get('dave');
  const erin = actors.get('erin');
  const frank = actors.get('frank');
  const henry = actors.get('henry');
  const fixtureDm = (await alice.client.query(api.getMyFixtureConversation, {
    args: { fixtureId: 'd-alice-bob' },
  })).rows[0]._id;
  const fixtureGroup = (await alice.client.query(api.getMyFixtureConversation, {
    args: { fixtureId: 'g-starter' },
  })).rows[0]._id;

  await t.test('schema authority, typing permission backing, and seed replay are deterministic', async () => {
    const table = (name) => schema.tables.find((candidate) => candidate.name === name);
    assert.equal(table('conversations').indexes.find(({ name }) => name === 'by_dm_pair').unique, true);
    assert.equal(
      table('conversationMembers').indexes.find(({ name }) => name === 'by_active_key').unique,
      true,
    );
    assert.deepEqual(
      table('conversationMembers').indexes
        .find(({ name }) => name === 'by_current_conversation').fields,
      ['conversationId', 'isCurrent'],
    );
    assert.deepEqual(
      table('conversationMembers').indexes
        .find(({ name }) => name === 'by_latest_profile').fields,
      ['profileId', 'isLatest'],
    );
    assert.deepEqual(
      table('conversationMembers').indexes
        .find(({ name }) => name === 'by_profile_latest_chat_page').fields,
      ['profileId', 'isLatest', 'chatPageKey'],
    );
    assert.deepEqual(table('conversationCurrentMembers').membership, {
      bootstrapRole: 'member',
      id: 'conversationCurrentMembers',
      principal: 'ownerId',
      principalAddressedWrites: { remove: true },
      provenance: 'full',
      resource: 'conversationId',
      resourceTable: 'conversations',
      role: 'role',
      roles: ['member'],
      scope: 'resource',
      transitions: [
        { by: ['member'], op: 'insert', target: 'other', to: ['member'] },
        { by: ['member'], op: 'remove', target: 'other' },
        { by: ['self'], from: ['member'], op: 'remove', target: 'self' },
      ],
    });
    assert.equal(
      table('conversationCurrentMembers').indexes
        .find(({ name }) => name === 'by_owner_conversation').unique,
      true,
    );
    assert.deepEqual(
      table('conversationCurrentMembers').visibility,
      { kind: 'owner', field: 'ownerId' },
    );
    assert.equal(
      table('messageReceipts').indexes.find(({ name }) => name === 'by_message_recipient').unique,
      true,
    );
    for (const name of ['conversations', 'conversationMembers', 'messages', 'messageReceipts']) {
      assert.deepEqual(table(name).visibility, { kind: 'public-read' });
      assert.equal(table(name).syncable, false);
    }
    const typing = schema.ephemeralCollections.find(({ name }) => name === 'typing');
    assert(typing);
    assert.equal(typing.defaultTtlMs, 5_000);
    assert.equal(typing.maxTtlMs, 5_000);
    assert.deepEqual(typing.permissionBacking, {
      allowedRoles: ['member'],
      roleField: 'role',
      scopeFields: { conversationId: 'conversationId' },
      subjectField: 'ownerId',
      table: 'conversationCurrentMembers',
    });
    assert.deepEqual(typing.publish, {
      RequireRoomPermission: { prefix: 'm_conversationCurrentMembers' },
    });
    assert.deepEqual(typing.subscribe, typing.publish);
    assert(api.ephemeral.typing);
    assert.equal(firstSeed.logDigest, '4b03a5935eda1cee32e4031ade2bef41cb1d304922edc07ecf9e6f3893e51008');
    assert(firstSeed.conversations.every(({ disposition }) => disposition === 'created'));
    assert(firstSeed.memberships.every(({ disposition }) => disposition === 'created'));
    assert(firstSeed.messages.every(({ disposition }) => disposition === 'created'));
    assert(secondSeed.conversations.every(({ disposition }) => disposition === 'matched'));
    assert(secondSeed.memberships.every(({ disposition }) => disposition === 'matched'));
    assert(secondSeed.messages.every(({ disposition }) => disposition === 'matched'));
    assert.equal((await messageRows(alice.client, fixtureDm)).length, 6);
    assert.equal((await messageRows(alice.client, fixtureGroup)).length, 9);
    const chats = (await alice.client.query(api.listChats, { args: {} })).rows;
    assert(chats.some(({ _id }) => _id === fixtureDm));
    assert(chats.some(({ _id }) => _id === fixtureGroup));
    assert.equal('typingScope' in chats.find(({ _id }) => _id === fixtureDm), false);
    assert.equal('typingAvailable' in chats.find(({ _id }) => _id === fixtureDm), false);
  });

  await t.test('DM open is structurally deduplicated, including a concurrent first-open race', async () => {
    const reused = await Promise.all([
      alice.client.mutate(api.openDm, { args: { otherProfileId: bob.profile._id } }),
      bob.client.mutate(api.openDm, { args: { otherProfileId: alice.profile._id } }),
    ]);
    assert.deepEqual(
      reused.map(({ result }) => result),
      [
        { conversationId: fixtureDm, disposition: 'reused' },
        { conversationId: fixtureDm, disposition: 'reused' },
      ],
    );

    const raced = await Promise.all([
      alice.client.mutate(api.openDm, { args: { otherProfileId: erin.profile._id } }),
      erin.client.mutate(api.openDm, { args: { otherProfileId: alice.profile._id } }),
    ]);
    assert.equal(raced[0].result.conversationId, raced[1].result.conversationId);
    assert.deepEqual(
      raced.map(({ result }) => result.disposition).sort(),
      ['created', 'reused'],
    );
    assert.deepEqual(
      (await alice.client.mutate(api.openDm, {
        args: { otherProfileId: erin.profile._id },
      })).result,
      { conversationId: raced[0].result.conversationId, disposition: 'reused' },
    );
  });

  await t.test('identical-membership groups remain distinct and joining exposes full history', async () => {
    const memberProfileIds = [bob.profile._id, carol.profile._id];
    const first = (await alice.client.mutate(api.createGroup, {
      args: { name: 'Same people A', description: '', memberProfileIds },
    })).result;
    const second = (await alice.client.mutate(api.createGroup, {
      args: { name: 'Same people B', description: '', memberProfileIds },
    })).result;
    assert.notEqual(first, second);

    const historyGroup = (await alice.client.mutate(api.createGroup, {
      args: {
        name: 'History is shared',
        description: 'Joiners see the beginning.',
        memberProfileIds: [bob.profile._id],
      },
    })).result;
    const beforeJoin = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: historyGroup, body: 'Written before Carol joined.' },
    })).result;
    await alice.client.mutate(api.addMember, {
      args: { conversationId: historyGroup, profileId: carol.profile._id },
    });
    assert((await messageRows(carol.client, historyGroup)).some(({ _id }) => _id === beforeJoin));
  });

  await t.test('current membership stays exact after incarnation churn beyond old scan caps', {
    timeout: 600_000,
  }, async () => {
    const churnGroup = (await alice.client.mutate(api.createGroup, {
      args: {
        name: 'Incarnation churn',
        description: 'Current seats are an indexed projection.',
        memberProfileIds: [bob.profile._id],
      },
    })).result;
    for (let iteration = 0; iteration < 640; iteration += 1) {
      await bob.client.mutate(api.leaveChat, { args: { conversationId: churnGroup } });
      await alice.client.mutate(api.addMember, {
        args: { conversationId: churnGroup, profileId: bob.profile._id },
      });
    }

    const accessMessage = (await bob.client.mutate(api.sendMessage, {
      args: { conversationId: churnGroup, body: 'Access survived incarnation churn.' },
    })).result;
    assert.equal((await messageRow(bob.client, churnGroup, accessMessage)).body,
      'Access survived incarnation churn.');

    const churnChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === churnGroup);
    assert(churnChat);
    assert.equal(churnChat.active, true);
    assert.deepEqual(
      churnChat.members.map(({ profileId }) => profileId).sort(),
      [alice.profile._id, bob.profile._id].sort(),
    );
    assert(churnChat.members.every(({ active }) => active));

    const recipientProbe = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: churnGroup, body: 'Recipient projection probe.' },
    })).result;
    const recipientRow = await messageRow(alice.client, churnGroup, recipientProbe);
    assert.deepEqual(recipientRow.receiptSummary, {
      aggregateStatus: 'sent',
      recipientCount: 1,
      requiredCount: 1,
      sentCount: 1,
      deliveredCount: 0,
      readCount: 0,
    });
    assert.equal((await bob.client.mutate(api.markRead, {
      args: { messageId: recipientProbe },
    })).result.status, 'read');
  });

  await t.test('two clients receive messages live with avatars and quoted-reply pointers', async () => {
    const aliceLive = await alice.client.liveQuery(api.listMessages, {
      args: { conversationId: fixtureDm },
      connectionId: 'coterie-m3-alice-dm',
      transport: 'stream',
      fallbackToPoll: false,
    });
    const bobLive = await bob.client.liveQuery(api.listMessages, {
      args: { conversationId: fixtureDm },
      connectionId: 'coterie-m3-bob-dm',
      transport: 'stream',
      fallbackToPoll: false,
    });
    handles.push(aliceLive, bobLive);
    const quoted = (await alice.client.query(api.getMyFixtureMessage, {
      args: { fixtureId: 'sm0001' },
    })).rows[0];
    const aliceMessage = (await alice.client.mutate(api.sendMessage, {
      args: {
        conversationId: fixtureDm,
        body: 'A live message quoting the fixture.',
        quotedMessageId: quoted._id,
      },
    })).result;
    await eventually(() => {
      const row = bobLive.rows.find(({ _id }) => _id === aliceMessage);
      assert(row, 'Bob has not received Alice message');
      assert(row.senderAvatar, 'sender avatar is absent');
      assert.equal(row.quotedMessageId, quoted._id);
      assert.equal(row.quotedMessage.messageId, quoted._id);
      assert.equal(row.quotedMessage.excerpt, 'Coffee after work?');
    }, 'Bob did not receive Alice message over the live stream');

    const bobReply = (await bob.client.mutate(api.sendMessage, {
      args: {
        conversationId: fixtureDm,
        body: 'Bob replies over the same live channel.',
        quotedMessageId: aliceMessage,
      },
    })).result;
    await eventually(() => {
      assert(aliceLive.rows.some(({ _id }) => _id === bobReply));
      assert(bobLive.rows.some(({ _id }) => _id === bobReply));
    }, 'Alice and Bob did not converge on Bob reply');
    for (const handle of [aliceLive, bobLive]) {
      await handle.dispose();
      const index = handles.indexOf(handle);
      if (index >= 0) handles.splice(index, 1);
    }
  });

  await t.test('typing is visible within two seconds, expires at five seconds, and denies every non-member class', async () => {
    const aliceConnection = 'coterie-m3-typing-alice';
    const bobConnection = 'coterie-m3-typing-bob';
    const scope = { conversationId: fixtureDm };
    const aliceOverlay = await alice.client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId: aliceConnection,
      scope,
    });
    const bobOverlay = await bob.client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId: bobConnection,
      scope,
    });
    try {
      const publishedAt = Date.now();
      await bobOverlay.publish(typingValue(bob), { ttlMs: 5_000 });
      await eventually(() => {
        const entry = aliceOverlay.currentEntries().find(
          (candidate) => candidate.value.userId === 'bob',
        );
        assert(entry, 'Alice has not observed Bob typing');
        assert.equal(entry.value.displayName, bob.profile.displayName);
      }, 'Bob typing was not visible inside the two-second contract', 2_000);
      await eventually(() => {
        assert.equal(aliceOverlay.currentEntries().length, 0);
      }, 'Bob typing did not expire inside the five-second lease window', 7_000);
      assert(Date.now() - publishedAt >= 4_500, 'typing lease expired materially before five seconds');
    } finally {
      await Promise.all([
        releaseTyping(alice.client, aliceOverlay, aliceConnection, fixtureDm),
        releaseTyping(bob.client, bobOverlay, bobConnection, fixtureDm),
      ]);
    }

    const anonymous = passwordClient(server.baseUrl, 'coterie-m3-typing-anonymous');
    clients.push(anonymous);
    const negativeCases = [
      ['anonymous', anonymous, typingValue(alice)],
      ['non-member', henry.client, typingValue(henry)],
    ];
    for (const [kind, client, value] of negativeCases) {
      await expectPermissionDenied(
        client.subscribeEphemeral(api.ephemeral.typing, {
          connectionId: `coterie-m3-typing-${kind}-observer`,
          scope,
        }),
        `${kind} observer`,
      );
      await expectPermissionDenied(
        client.publishEphemeral(api.ephemeral.typing, {
          connectionId: `coterie-m3-typing-${kind}-writer`,
          scope,
          value,
          ttlMs: 5_000,
        }),
        `${kind} writer`,
      );
    }

    const formerConversation = (await alice.client.mutate(api.createGroup, {
      args: {
        name: 'Former-member typing denial',
        description: 'Removal closes both ephemeral directions.',
        memberProfileIds: [carol.profile._id],
      },
    })).result;
    const formerScope = { conversationId: formerConversation };
    const formerObserverConnection = 'coterie-m3-typing-former-observer-active';
    const formerWriterConnection = 'coterie-m3-typing-former-writer-active';
    const formerObserver = await alice.client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId: formerObserverConnection,
      scope: formerScope,
    });
    const formerWriter = await carol.client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId: formerWriterConnection,
      scope: formerScope,
    });
    try {
      await formerWriter.publish(typingValue(carol), { ttlMs: 5_000 });
      await eventually(() => {
        assert(formerObserver.currentEntries().some(
          (entry) => entry.value.userId === 'carol',
        ));
      }, 'current member typing was not visible before removal', 2_000);
      await alice.client.mutate(api.removeMember, {
        args: { conversationId: formerConversation, profileId: carol.profile._id },
      });
    } finally {
      await Promise.all([
        releaseTyping(
          alice.client,
          formerObserver,
          formerObserverConnection,
          formerConversation,
        ),
        releaseTyping(
          carol.client,
          formerWriter,
          formerWriterConnection,
          formerConversation,
        ),
      ]);
    }
    await expectPermissionDenied(
      carol.client.subscribeEphemeral(api.ephemeral.typing, {
        connectionId: 'coterie-m3-typing-former-observer-denied',
        scope: formerScope,
      }),
      'former-member observer',
    );
    await expectPermissionDenied(
      carol.client.publishEphemeral(api.ephemeral.typing, {
        connectionId: 'coterie-m3-typing-former-writer-denied',
        scope: formerScope,
        value: typingValue(carol),
        ttlMs: 5_000,
      }),
      'former-member writer',
    );
  });

  await t.test('receipts are monotonic and group aggregation uses the send-time recipient set', async () => {
    const messageId = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: fixtureGroup, body: 'Receipt aggregation probe.' },
    })).result;
    let row = await messageRow(alice.client, fixtureGroup, messageId);
    assert.deepEqual(row.receiptSummary, {
      aggregateStatus: 'sent',
      recipientCount: 3,
      requiredCount: 3,
      sentCount: 3,
      deliveredCount: 0,
      readCount: 0,
    });
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'delivered');
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'delivered');
    assert.equal((await bob.client.mutate(api.markRead, { args: { messageId } })).result.status, 'read');
    assert.equal((await bob.client.mutate(api.markDelivered, { args: { messageId } })).result.status, 'read');
    await carol.client.mutate(api.markDelivered, { args: { messageId } });
    await dave.client.mutate(api.markDelivered, { args: { messageId } });
    row = await messageRow(alice.client, fixtureGroup, messageId);
    assert.equal(row.receiptSummary.aggregateStatus, 'delivered');

    await alice.client.mutate(api.addMember, {
      args: { conversationId: fixtureGroup, profileId: erin.profile._id },
    });
    await carol.client.mutate(api.markRead, { args: { messageId } });
    await dave.client.mutate(api.leaveChat, { args: { conversationId: fixtureGroup } });
    row = await messageRow(alice.client, fixtureGroup, messageId);
    assert.deepEqual(row.receiptSummary, {
      aggregateStatus: 'read',
      recipientCount: 3,
      requiredCount: 2,
      sentCount: 2,
      deliveredCount: 2,
      readCount: 2,
    });

    await alice.client.mutate(api.addMember, {
      args: { conversationId: fixtureGroup, profileId: dave.profile._id },
    });
    row = await messageRow(alice.client, fixtureGroup, messageId);
    assert.deepEqual(row.receiptSummary, {
      aggregateStatus: 'read',
      recipientCount: 3,
      requiredCount: 2,
      sentCount: 2,
      deliveredCount: 2,
      readCount: 2,
    });
    const rejoinMessage = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: fixtureGroup, body: 'Rejoined members receive new obligations.' },
    })).result;
    row = await messageRow(alice.client, fixtureGroup, rejoinMessage);
    assert.deepEqual(row.receiptSummary, {
      aggregateStatus: 'sent',
      recipientCount: 4,
      requiredCount: 4,
      sentCount: 4,
      deliveredCount: 0,
      readCount: 0,
    });
    assert.equal((await dave.client.mutate(api.markDelivered, {
      args: { messageId: rejoinMessage },
    })).result.status, 'delivered');
    row = await messageRow(alice.client, fixtureGroup, rejoinMessage);
    assert.equal(row.receiptSummary.requiredCount, 4);
    assert.equal(row.receiptSummary.deliveredCount, 1);
  });

  await t.test('unread projection and receipt watermarks stay incarnation-exact across rejoin', async () => {
    const conversationId = (await alice.client.mutate(api.createGroup, {
      args: {
        name: 'Rejoin receipt projection',
        description: 'Old obligations stay dropped after a new membership incarnation.',
        memberProfileIds: [bob.profile._id],
      },
    })).result;
    const oldMessageId = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId, body: 'Old incarnation receipt.' },
    })).result;
    let bobChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === conversationId);
    assert.equal(bobChat.unreadCount, 1);

    await bob.client.mutate(api.leaveChat, { args: { conversationId } });
    await alice.client.mutate(api.addMember, {
      args: { conversationId, profileId: bob.profile._id },
    });
    const oldForBob = await messageRow(bob.client, conversationId, oldMessageId);
    assert.equal(oldForBob.viewerReceiptRequired, false);
    bobChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === conversationId);
    assert.equal(bobChat.unreadCount, 0);
    assert.deepEqual(
      (await bob.client.mutate(api.markReceiptsThrough, {
        args: { conversationId, state: 'read' },
      })).result,
      { status: 'read', requiredCount: 0, throughSequence: 3 },
    );
    assert.deepEqual(
      (await messageRow(alice.client, conversationId, oldMessageId)).receiptSummary,
      {
        aggregateStatus: 'read',
        recipientCount: 1,
        requiredCount: 0,
        sentCount: 0,
        deliveredCount: 0,
        readCount: 0,
      },
    );

    const newMessageId = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId, body: 'New incarnation receipt.' },
    })).result;
    const newForBob = await messageRow(bob.client, conversationId, newMessageId);
    assert.equal(newForBob.viewerReceiptRequired, true);
    bobChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === conversationId);
    assert.equal(bobChat.unreadCount, 1);
    await bob.client.mutate(api.markReceiptsThrough, {
      args: { conversationId, state: 'read' },
    });
    bobChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === conversationId);
    assert.equal(bobChat.unreadCount, 0);
    assert.equal(
      (await messageRow(alice.client, conversationId, newMessageId)).receiptSummary.aggregateStatus,
      'read',
    );
  });

  await t.test('group administration is server-enforced and removal retains only prior history', async () => {
    await expectAppCode(
      bob.client.mutate(api.removeMember, {
        args: { conversationId: fixtureGroup, profileId: carol.profile._id },
      }),
      'NOT_GROUP_ADMIN',
    );
    await expectAppCode(
      bob.client.mutate(api.addMember, {
        args: { conversationId: fixtureGroup, profileId: frank.profile._id },
      }),
      'NOT_GROUP_ADMIN',
    );
    await expectAppCode(
      bob.client.mutate(api.promoteAdmin, {
        args: { conversationId: fixtureGroup, profileId: carol.profile._id },
      }),
      'NOT_GROUP_ADMIN',
    );
    await alice.client.mutate(api.promoteAdmin, {
      args: { conversationId: fixtureGroup, profileId: bob.profile._id },
    });
    await bob.client.mutate(api.addMember, {
      args: { conversationId: fixtureGroup, profileId: frank.profile._id },
    });
    await expectAppCode(
      bob.client.mutate(api.addMember, {
        args: { conversationId: fixtureGroup, profileId: frank.profile._id },
      }),
      'MEMBER_ALREADY_EXISTS',
    );

    const beforeRemoval = await messageRows(carol.client, fixtureGroup);
    await alice.client.mutate(api.removeMember, {
      args: { conversationId: fixtureGroup, profileId: carol.profile._id },
    });
    const afterRemovalMessage = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: fixtureGroup, body: 'Carol must not receive this.' },
    })).result;
    const postRemovalFixtureId = 'acceptance-post-removal-message';
    const postRemovalFixture = (await alice.client.mutate(api.ensureFixtureMessage, {
      args: {
        fixtureId: postRemovalFixtureId,
        fixtureDigest: 'f'.repeat(64),
        conversationId: fixtureGroup,
        body: 'Fixture lookup must honor Carol\'s removal cutoff.',
      },
    })).result.messageId;
    const retained = await messageRows(carol.client, fixtureGroup);
    assert.equal(retained.some(({ _id }) => _id === afterRemovalMessage), false);
    assert.equal(retained.some(({ _id }) => _id === postRemovalFixture), false);
    for (const old of beforeRemoval) assert(retained.some(({ _id }) => _id === old._id));
    assert.equal((await alice.client.query(api.getMyFixtureMessage, {
      args: { fixtureId: postRemovalFixtureId },
    })).rows[0]._id, postRemovalFixture);
    assert.deepEqual((await carol.client.query(api.getMyFixtureMessage, {
      args: { fixtureId: postRemovalFixtureId },
    })).rows, []);
    await expectAppCode(
      carol.client.mutate(api.sendMessage, {
        args: { conversationId: fixtureGroup, body: 'Removed sender attempt.' },
      }),
      'CHAT_MEMBERSHIP_REQUIRED',
    );
    const removedChat = (await carol.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === fixtureGroup);
    assert.equal(removedChat.active, false);
    assert.equal('typingScope' in removedChat, false);
    assert.equal('typingAvailable' in removedChat, false);
  });

  await t.test('a sole admin may leave and produce an admin-less group', async () => {
    const conversationId = (await alice.client.mutate(api.createGroup, {
      args: {
        name: 'Admin-less is valid',
        description: '',
        memberProfileIds: [bob.profile._id],
      },
    })).result;
    await alice.client.mutate(api.leaveChat, { args: { conversationId } });
    const bobChat = (await bob.client.query(api.listChats, { args: {} })).rows
      .find(({ _id }) => _id === conversationId);
    assert(bobChat);
    assert.equal(bobChat.members.length, 1);
    assert.equal(bobChat.members[0].profileId, bob.profile._id);
    assert.equal(bobChat.members[0].role, 'member');
  });

  await t.test('unknown chats and non-members have operation-exact refusal codes', async () => {
    const missingConversationId = '00000000-0000-7000-8000-000000000000';
    const missingChatOperations = [
      () => alice.client.query(api.listMessages, { args: { conversationId: missingConversationId } }),
      () => alice.client.mutate(api.addMember, {
        args: { conversationId: missingConversationId, profileId: henry.profile._id },
      }),
      () => alice.client.mutate(api.removeMember, {
        args: { conversationId: missingConversationId, profileId: henry.profile._id },
      }),
      () => alice.client.mutate(api.promoteAdmin, {
        args: { conversationId: missingConversationId, profileId: henry.profile._id },
      }),
      () => alice.client.mutate(api.leaveChat, { args: { conversationId: missingConversationId } }),
      () => alice.client.mutate(api.sendMessage, {
        args: { conversationId: missingConversationId, body: 'Missing chat.' },
      }),
      () => alice.client.mutate(api.markReceiptsThrough, {
        args: { conversationId: missingConversationId, state: 'read' },
      }),
    ];
    for (const operation of missingChatOperations) {
      await expectAppCode(operation(), 'CHAT_NOT_FOUND');
    }
    await expectAppCode(
      alice.client.mutate(api.removeMember, {
        args: { conversationId: fixtureGroup, profileId: henry.profile._id },
      }),
      'MEMBER_NOT_FOUND',
    );
    await expectAppCode(
      alice.client.mutate(api.promoteAdmin, {
        args: { conversationId: fixtureGroup, profileId: henry.profile._id },
      }),
      'MEMBER_NOT_FOUND',
    );
  });

  await t.test('message code-point bounds, quote locality, and membership privacy are enforced', async () => {
    const atLimit = (await alice.client.mutate(api.sendMessage, {
      args: { conversationId: fixtureDm, body: '😀'.repeat(2_000) },
    })).result;
    assert.equal((await messageRow(bob.client, fixtureDm, atLimit)).body.length, 4_000);
    await expectAppCode(
      alice.client.mutate(api.sendMessage, {
        args: { conversationId: fixtureDm, body: '😀'.repeat(2_001) },
      }),
      'MESSAGE_BODY_TOO_LONG',
    );
    await expectAppCode(
      alice.client.mutate(api.sendMessage, {
        args: { conversationId: fixtureDm, body: '   ' },
      }),
      'MESSAGE_BODY_REQUIRED',
    );
    const groupMessage = (await messageRows(alice.client, fixtureGroup))[0];
    await expectAppCode(
      alice.client.mutate(api.sendMessage, {
        args: {
          conversationId: fixtureDm,
          body: 'Cross-chat quote attempt.',
          quotedMessageId: groupMessage._id,
        },
      }),
      'QUOTED_MESSAGE_NOT_FOUND',
    );
    await expectAppCode(
      henry.client.query(api.listMessages, { args: { conversationId: fixtureDm } }),
      'CHAT_MEMBERSHIP_REQUIRED',
    );
  });

  await t.test('message envelope admits 1,024, refuses 1,025 before write, and leaves queries healthy', async () => {
    assert.equal(messageHistoryEnvelopeLimit(), 1_024);
    const existing = await messageRows(alice.client, fixtureDm);
    assert(existing.length < messageHistoryEnvelopeLimit());
    let boundaryMessageId = null;
    for (let count = existing.length; count < messageHistoryEnvelopeLimit(); count += 1) {
      boundaryMessageId = (await alice.client.mutate(api.sendMessage, {
        args: {
          conversationId: fixtureDm,
          body: `Message envelope boundary ${count + 1}`,
        },
      })).result;
    }
    const atBoundary = await messageRows(alice.client, fixtureDm);
    assert.equal(atBoundary.length, messageHistoryEnvelopeLimit());
    assert(atBoundary.some(({ _id }) => _id === boundaryMessageId));
    await expectAppCode(
      alice.client.mutate(api.sendMessage, {
        args: { conversationId: fixtureDm, body: 'Message envelope overflow.' },
      }),
      'MESSAGE_ENVELOPE_EXCEEDED',
    );
    const afterRefusal = await messageRows(alice.client, fixtureDm);
    assert.equal(afterRefusal.length, messageHistoryEnvelopeLimit());
    assert.deepEqual(
      afterRefusal.map(({ _id }) => _id),
      atBoundary.map(({ _id }) => _id),
      'overflow refusal must not mutate or permanently fault listMessages',
    );
  });

  await t.test('chat envelope admits 1,000, refuses both creators at 1,001, and leaves queries healthy', async () => {
    assert.equal(chatHistoryEnvelopeLimit(), 1_000);
    const partners = [bob, carol, dave, erin, frank, henry];
    const initialChats = (await alice.client.query(api.listChats, { args: {} })).rows;
    assert(initialChats.length < chatHistoryEnvelopeLimit());
    for (let count = initialChats.length; count < chatHistoryEnvelopeLimit() - 1; count += 1) {
      const partner = partners[count % partners.length];
      await alice.client.mutate(api.createGroup, {
        args: {
          name: `Chat envelope boundary ${count + 1}`,
          description: '',
          memberProfileIds: [partner.profile._id],
        },
      });
    }
    const at999 = (await alice.client.query(api.listChats, { args: {} })).rows;
    assert.equal(at999.length, chatHistoryEnvelopeLimit() - 1);
    const existingDmProfileIds = new Set(at999.flatMap((chat) => (
      chat.kind === 'dm' ? chat.members.map(({ profileId }) => profileId) : []
    )));
    const unusedDmProfiles = partners.filter(({ profile }) => !existingDmProfileIds.has(profile._id));
    assert(unusedDmProfiles.length >= 2, 'chat boundary needs two not-yet-open DM counterparts');
    const exactBoundary = (await alice.client.mutate(api.openDm, {
      args: { otherProfileId: unusedDmProfiles[0].profile._id },
    })).result;
    assert.equal(exactBoundary.disposition, 'created');
    const atBoundary = (await alice.client.query(api.listChats, { args: {} })).rows;
    assert.equal(atBoundary.length, chatHistoryEnvelopeLimit());

    await expectAppCode(
      alice.client.mutate(api.createGroup, {
        args: {
          name: 'Chat envelope overflow group',
          description: '',
          memberProfileIds: [bob.profile._id],
        },
      }),
      'CHAT_ENVELOPE_EXCEEDED',
    );
    await expectAppCode(
      alice.client.mutate(api.openDm, {
        args: { otherProfileId: unusedDmProfiles[1].profile._id },
      }),
      'CHAT_ENVELOPE_EXCEEDED',
    );
    const groupWithoutAlice = (await bob.client.mutate(api.createGroup, {
      args: {
        name: 'Chat envelope add-member overflow',
        description: '',
        memberProfileIds: [carol.profile._id],
      },
    })).result;
    await expectAppCode(
      bob.client.mutate(api.addMember, {
        args: { conversationId: groupWithoutAlice, profileId: alice.profile._id },
      }),
      'CHAT_ENVELOPE_EXCEEDED',
    );
    assert.equal(
      (await bob.client.query(api.listChats, { args: {} })).rows
        .find(({ _id }) => _id === groupWithoutAlice)
        .members.some(({ profileId }) => profileId === alice.profile._id),
      false,
      'addMember overflow refusal must happen before inserting Alice membership',
    );
    assert.deepEqual(
      (await alice.client.mutate(api.openDm, {
        args: { otherProfileId: bob.profile._id },
      })).result,
      { conversationId: fixtureDm, disposition: 'reused' },
      'reusing an existing DM at the envelope must remain legal',
    );
    const afterRefusals = (await alice.client.query(api.listChats, { args: {} })).rows;
    assert.equal(afterRefusals.length, chatHistoryEnvelopeLimit());
    assert.deepEqual(
      afterRefusals.map(({ _id }) => _id),
      atBoundary.map(({ _id }) => _id),
      'overflow refusals must not mutate or permanently fault listChats',
    );
    assert.equal((await messageRows(alice.client, fixtureDm)).length, messageHistoryEnvelopeLimit());
  });
});
