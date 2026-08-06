import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAssetClient } from '../../../../../packages/snapback-client/assets.mjs';
import { AuthCoordinator, createMemoryAuthCustodyStorage } from '@expo/snapback-contract';
import { SnapbackClient } from '../../../../_kit/client.mjs';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../../_kit/harness.mjs';
import { startServer } from '../../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const ADA = 'user_ada';
const suite = createSuite('tandem snapback / headless', { expectedChecks: 8 });
const acceptanceDir = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(acceptanceDir, '..', '..');
const repoRoot = resolve(appDir, '..', '..', '..');
const backendDir = join(appDir, 'snapback');
const generatedDir = join(backendDir, 'generated');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const generated = (name) => readJson(join(generatedDir, name));
const scratch = mkdtempSync(join(tmpdir(), 'tandem-snapback-'));
const startupArtifacts = join(scratch, 'startup-artifacts.json');
writeFileSync(startupArtifacts, `${JSON.stringify({
  formatVersion: 1,
  schema: generated('schema.manifest.json'),
  functions: generated('functions.manifest.json'),
})}\n`, { mode: 0o600 });
const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  startupArtifacts,
  captureImpersonationCapability: true,
});
const provisioner = new SnapbackClient(server.baseUrl, { ...server.clientOptions, rqsStore: null });
let provisioned;
try {
  const reset = await fetch(`${server.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-snapback-admin-token': server.adminToken },
    body: JSON.stringify({
      schemaVersion: 'snapback.v0',
      requestId: 'tandem-seed-reset',
      operation: 'app.reset',
      seed: readJson(join(backendDir, 'seed.json')),
    }),
  });
  const resetResult = await reset.json();
  if (!reset.ok || resetResult.ok !== true) throw new Error(`seed reset failed: ${JSON.stringify(resetResult)}`);
  provisioned = { schema: 'current', functions: 'current', seed: 'seeded' };
} finally {
  await provisioner.closeAuth();
}
const coordinator = new AuthCoordinator({
  appId: 'snapback',
  storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient(server.baseUrl, {
  authCoordinator: coordinator,
  authInvalidationProtocol: 1,
  authorityDescriptorProtocol: 1,
  authorizedLeaseProtocol: 1,
  clientStoreId: 'tandem-acceptance-ada',
});
const requested = await client.authRequestCode('ada@tandem.local');
const mailboxResponse = await fetch(`${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`, {
  headers: {
    'x-snapback-admin-token': server.adminToken,
    'x-snapback-impersonation-capability': server.impersonationCapability,
  },
});
const mailbox = await mailboxResponse.json();
if (!mailboxResponse.ok) throw new Error(`mailbox failed: ${JSON.stringify(mailbox)}`);
await client.authExchange({ challengeId: requested.challengeId, code: mailbox.code });
const app = {
  appDir,
  client,
  provisioned,
  server,
  close: async () => {
    try { await client.closeAuth(); }
    finally {
      await server.stop();
      rmSync(scratch, { recursive: true, force: true });
    }
  },
};

await runAcceptance(suite, async () => {
  await suite.check('seed provisions one group and two direct conversations', async () => {
    assertEqual(app.provisioned.seed, 'seeded', 'seed provisioned');
    const inbox = (await app.client.query(api.listInbox, { args: { viewerId: ADA } })).rows;
    assertEqual(inbox.length, 3, 'conversation count');
    assertEqual(inbox.filter(({ isGroup }) => isGroup).length, 1, 'group count');
    assertEqual(inbox.filter(({ isGroup }) => !isGroup).length, 2, 'DM count');
  });

  await suite.check('seeded messages preserve image, reply, and reaction projections', async () => {
    const rows = (await app.client.query(api.listMessages, { args: { conversationId: 'conv_crew', viewerId: ADA } })).rows;
    assertEqual(rows.length, 6, 'group message count');
    assert(rows.some(({ seedImageUrl }) => Boolean(seedImageUrl)), 'seed image missing');
    assert(rows.some(({ replyTo }) => replyTo?.id === 'msg_crew_3'), 'reply pointer missing');
    assertEqual(rows.find(({ id }) => id === 'msg_crew_3')?.reactions[0]?.count, 2, 'reaction rollup');
  });

  let replyId;
  await suite.check('messages send to DMs and groups with a non-threaded reply pointer', async () => {
    await app.client.mutate(api.sendMessage, { args: { conversationId: 'conv_mina', senderId: ADA, text: 'DM acceptance ping' } });
    replyId = (await app.client.mutate(api.sendMessage, {
      args: { conversationId: 'conv_crew', senderId: ADA, text: 'Group acceptance reply', replyToId: 'msg_crew_6' },
    })).result;
    const group = (await app.client.query(api.listMessages, { args: { conversationId: 'conv_crew', viewerId: ADA } })).rows;
    const reply = group.find(({ id }) => id === replyId);
    assertEqual(reply?.replyTo?.id, 'msg_crew_6', 'reply pointer target');
    assert(!('threadId' in reply), 'reply accidentally created a thread');
  });

  await suite.check('a live group view receives a message from another client', async () => {
    const live = await app.client.liveQuery(api.listMessages, {
      args: { conversationId: 'conv_crew', viewerId: ADA },
      connectionId: 'tandem-observer',
    });
    await app.client.mutate(api.sendMessage, { args: { conversationId: 'conv_crew', senderId: 'user_noor', text: 'Live from Noor' } });
    const rows = await live.poll();
    assert(rows.some(({ text }) => text === 'Live from Noor'), 'live message absent');
  });

  await suite.check('reaction toggle adds, changes, and removes one user reaction', async () => {
    assertEqual((await app.client.mutate(api.toggleReaction, { args: { conversationId: 'conv_crew', messageId: replyId, userId: ADA, emoji: '👍' } })).result, { reacted: true, emoji: '👍' }, 'add');
    assertEqual((await app.client.mutate(api.toggleReaction, { args: { conversationId: 'conv_crew', messageId: replyId, userId: ADA, emoji: '❤️' } })).result, { reacted: true, emoji: '❤️' }, 'change');
    assertEqual((await app.client.mutate(api.toggleReaction, { args: { conversationId: 'conv_crew', messageId: replyId, userId: ADA, emoji: '❤️' } })).result, { reacted: false, emoji: '❤️' }, 'remove');
  });

  await suite.check('typed image upload attaches and publicly delivers a message image', async () => {
    const png = readFileSync(join(repoRoot, 'demos', 'party-wall', 'snapback', 'seed', 'balloons.png'));
    const assets = createAssetClient(app.client);
    const task = assets.start({
      upload: api.messageImageUpload,
      file: new Blob([png], { type: 'image/png' }),
      declaredFilename: 'acceptance.png',
      declaredContentType: 'image/png',
    });
    const finished = await task.done;
    assertEqual(finished.status, 'ready', JSON.stringify(finished.diagnostic));
    const messageId = (await app.client.mutate(api.sendMessage, {
      args: { conversationId: 'conv_mina', senderId: ADA, text: 'Uploaded from Expo-shaped bytes', imageAssetId: finished.assetId },
    })).result;
    const rows = (await app.client.query(api.listMessages, { args: { conversationId: 'conv_mina', viewerId: ADA } })).rows;
    assertEqual(rows.find(({ id }) => id === messageId)?.imageAssetId, finished.assetId, 'typed asset projection');
    const delivered = await fetch(`${app.server.baseUrl}/assets/public/${encodeURIComponent(finished.assetId)}/display`);
    assert(delivered.ok, `public image delivery failed (${delivered.status})`);
  });

  await suite.check('typing state is scoped and leaves durable storage untouched', async () => {
    const before = (await app.client.inspect()).storage.version;
    const observer = await app.client.subscribeEphemeral(api.ephemeral.typing, {
      connectionId: 'typing-observer',
      scope: { conversationId: 'conv_crew' },
      transport: 'poll',
    });
    await app.client.publishEphemeral(api.ephemeral.typing, {
      connectionId: 'typing-mina',
      scope: { conversationId: 'conv_crew' },
      value: { userId: 'user_mina', name: 'Mina', color: '#EC6B82' },
      ttlMs: 4_000,
    });
    await observer.drain();
    assert(observer.currentEntries().some(({ value }) => value.name === 'Mina'), 'typing presence missing');
    assertEqual((await app.client.inspect()).storage.version, before, 'typing advanced durable version');
    await app.client.deleteEphemeral(api.ephemeral.typing, {
      connectionId: 'typing-mina',
      scope: { conversationId: 'conv_crew' },
    });
    await observer.drain();
    assertEqual(observer.currentEntries(), [], 'connection-owned typing state survived disconnect');
  });

  await suite.check('invalid membership and cross-conversation replies refuse without writes', async () => {
    const before = (await app.client.query(api.listMessages, { args: { conversationId: 'conv_mina', viewerId: ADA } })).rows.length;
    await assertThrows(
      () => app.client.mutate(api.sendMessage, { args: { conversationId: 'conv_mina', senderId: 'user_noor', text: 'not a member' } }),
      'SNAPBACK_HANDLER_FAILED',
      'non-member send',
    );
    await assertThrows(
      () => app.client.mutate(api.sendMessage, { args: { conversationId: 'conv_mina', senderId: ADA, text: 'bad reply', replyToId: 'msg_crew_1' } }),
      'SNAPBACK_HANDLER_FAILED',
      'cross-conversation reply',
    );
    assertEqual((await app.client.query(api.listMessages, { args: { conversationId: 'conv_mina', viewerId: ADA } })).rows.length, before, 'rejected send wrote');
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});
