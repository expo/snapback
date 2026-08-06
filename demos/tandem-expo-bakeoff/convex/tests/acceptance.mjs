import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ConvexClient, ConvexHttpClient } from 'convex/browser';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { api } from '../convex/_generated/api.js';

const url = process.env.EXPO_PUBLIC_CONVEX_URL;
if (!url) throw new Error('EXPO_PUBLIC_CONVEX_URL is missing; run npx convex dev --once first');
const client = new ConvexHttpClient(url);
const suite = createSuite('tandem convex / acceptance', { expectedChecks: 8 });
const armRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(armRoot, '..', '..', '..');
const waitFor = async (predicate, label, timeoutMs = 8_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 40));
  }
  throw new Error(`timed out waiting for ${label}`);
};

await runAcceptance(suite, async () => {
  await client.mutation(api.seed.seed, {});

  await suite.check('seed provisions one group and two direct conversations', async () => {
    const inbox = await client.query(api.chat.listInbox, { viewerId: 'user_ada' });
    assertEqual(inbox.length, 3, 'conversation count');
    assertEqual(inbox.filter(({ isGroup }) => isGroup).length, 1, 'group count');
    assertEqual(inbox.filter(({ isGroup }) => !isGroup).length, 2, 'DM count');
  });

  await suite.check('seeded messages preserve image, reply, and reaction projections', async () => {
    const rows = await client.query(api.chat.listMessages, { conversationId: 'conv_crew', viewerId: 'user_ada' });
    assert(rows.some(({ imageUrl }) => Boolean(imageUrl)), 'seed image missing');
    assert(rows.some(({ replyTo }) => replyTo?.id === 'msg_crew_3'), 'reply pointer missing');
    assertEqual(rows.find(({ id }) => id === 'msg_crew_3')?.reactions[0]?.count, 2, 'reaction rollup');
  });

  let replyId;
  await suite.check('messages send to DMs and groups with a non-threaded reply pointer', async () => {
    await client.mutation(api.chat.sendMessage, { conversationId: 'conv_mina', senderId: 'user_ada', text: 'Convex DM acceptance ping' });
    replyId = await client.mutation(api.chat.sendMessage, {
      conversationId: 'conv_crew', senderId: 'user_ada', text: 'Convex group acceptance reply', replyToId: 'msg_crew_6',
    });
    const rows = await client.query(api.chat.listMessages, { conversationId: 'conv_crew', viewerId: 'user_ada' });
    const reply = rows.find(({ id }) => id === replyId);
    assertEqual(reply?.replyTo?.id, 'msg_crew_6', 'reply pointer target');
    assert(!('threadId' in reply), 'reply accidentally created a thread');
  });

  await suite.check('a WebSocket subscription receives a second-client message', async () => {
    const live = new ConvexClient(url, { unsavedChangesWarning: false });
    let observed = [];
    const unsubscribe = live.onUpdate(
      api.chat.listMessages,
      { conversationId: 'conv_crew', viewerId: 'user_ada' },
      (rows) => { observed = rows; },
    );
    try {
      await waitFor(() => observed.length > 0, 'initial Convex subscription');
      const body = `Live from Noor ${Date.now()}`;
      await client.mutation(api.chat.sendMessage, { conversationId: 'conv_crew', senderId: 'user_noor', text: body });
      await waitFor(() => observed.some(({ text }) => text === body), 'Convex live message');
    } finally {
      unsubscribe();
      await live.close();
    }
  });

  await suite.check('reaction toggle adds, changes, and removes one user reaction', async () => {
    assertEqual(await client.mutation(api.chat.toggleReaction, { conversationId: 'conv_crew', messageId: replyId, userId: 'user_ada', emoji: '👍' }), 'added', 'add');
    assertEqual(await client.mutation(api.chat.toggleReaction, { conversationId: 'conv_crew', messageId: replyId, userId: 'user_ada', emoji: '❤️' }), 'changed', 'change');
    assertEqual(await client.mutation(api.chat.toggleReaction, { conversationId: 'conv_crew', messageId: replyId, userId: 'user_ada', emoji: '❤️' }), 'removed', 'remove');
  });

  await suite.check('storage upload attaches and publicly delivers a message image', async () => {
    const bytes = readFileSync(join(repoRoot, 'demos', 'party-wall', 'snapback', 'seed', 'balloons.png'));
    const uploadUrl = await client.mutation(api.files.generateUploadUrl, {});
    const uploaded = await fetch(uploadUrl, {
      method: 'POST',
      headers: { 'content-type': 'image/png' },
      body: new Blob([bytes], { type: 'image/png' }),
    });
    assert(uploaded.ok, `storage upload failed (${uploaded.status})`);
    const { storageId } = await uploaded.json();
    const messageId = await client.mutation(api.chat.sendMessage, {
      conversationId: 'conv_mina', senderId: 'user_ada', text: 'Convex uploaded image', imageStorageId: storageId,
    });
    const rows = await client.query(api.chat.listMessages, { conversationId: 'conv_mina', viewerId: 'user_ada' });
    const imageUrl = rows.find(({ id }) => id === messageId)?.imageUrl;
    assert(imageUrl, 'storage URL projection missing');
    assert((await fetch(imageUrl)).ok, 'storage image was not deliverable');
  });

  await suite.check('typing indicator expires through the scheduled nonce guard', async () => {
    await client.mutation(api.typing.set, {
      conversationId: 'conv_crew', userId: 'user_mina', name: 'Mina', color: '#EC6B82', typing: true,
    });
    assert((await client.query(api.typing.list, { conversationId: 'conv_crew' })).some(({ userId }) => userId === 'user_mina'), 'typing row missing');
    await waitFor(
      async () => !(await client.query(api.typing.list, { conversationId: 'conv_crew' })).some(({ userId }) => userId === 'user_mina'),
      'scheduled typing expiry',
      7_000,
    );
  });

  await suite.check('invalid membership and cross-conversation replies refuse', async () => {
    await assertThrows(
      () => client.mutation(api.chat.sendMessage, { conversationId: 'conv_mina', senderId: 'user_noor', text: 'not a member' }),
      null,
      'non-member send',
    );
    await assertThrows(
      () => client.mutation(api.chat.sendMessage, { conversationId: 'conv_mina', senderId: 'user_ada', text: 'bad reply', replyToId: 'msg_crew_1' }),
      null,
      'cross-conversation reply',
    );
  });
}, {
  reportFile: join(armRoot, 'acceptance-report.json'),
});
