import { join } from 'node:path';
import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const suite = createSuite('messaging-snapback / headless', { expectedChecks: 10 });
const app = await openHeadlessApp(import.meta.url, { appId: 'messaging-snapback' });

await runAcceptance(suite, async () => {
  await suite.check('seed provisions users, conversations, and a message backlog', async () => {
    assertEqual(app.provisioned.seed, 'seeded', 'seed provisioned');
    const conversations = await app.client.query(api.myConversations, { args: { viewerHandle: 'lin' } });
    assertEqual(conversations.rows.length, 4, 'lin belongs to 4 seed conversations');
    const founders = conversations.rows.find((c) => c._id === 'conv_group_founders');
    assert(founders, 'founders group present');
    assertEqual(founders.kind, 'group', 'founders is a group');
    assertEqual(founders.memberHandles.length, 4, 'founders has 4 members');
  });

  await suite.check('conversation feed carries replies and aggregated reactions', async () => {
    const feed = await app.client.query(api.conversationMessages, { args: { conversationId: 'conv_group_founders' } });
    assertEqual(feed.rows.length, 5, 'seed founders message count');
    const withReply = feed.rows.find((m) => m._id === 'msg_gf_4');
    assert(withReply?.replyPreview, 'reply preview attached');
    assertEqual(withReply.replyPreview.messageId, 'msg_gf_3', 'reply points at the right message');
    const withReactions = feed.rows.find((m) => m._id === 'msg_gf_3');
    assertEqual(withReactions.reactions.find((r) => r.emoji === '👍')?.count, 2, 'thumbs-up aggregated across 2 users');
  });

  let dmId;
  await suite.check('sendMessage stamps trusted time and updates the conversation preview', async () => {
    const before = await app.client.query(api.conversationById, { args: { conversationId: 'conv_dm_lin_ada' } });
    dmId = before.rows[0]._id;
    const sent = await app.client.mutate(api.sendMessage, {
      args: { conversationId: dmId, authorHandle: 'lin', authorName: 'Lin Chen', body: 'Acceptance ping' },
    });
    const messageId = sent.result;
    assert(typeof messageId === 'string' && messageId.length > 0, 'message id returned');
    const feed = await app.client.query(api.conversationMessages, { args: { conversationId: dmId } });
    const created = feed.rows.find((m) => m._id === messageId);
    assert(Number.isSafeInteger(created.createdAt), 'createdAt is trusted runtime time');
    const conversation = await app.client.query(api.conversationById, { args: { conversationId: dmId } });
    assertEqual(conversation.rows[0].lastMessageText, 'Acceptance ping', 'preview updated');
  });

  await suite.check('a reply carries a quoted pointer, not a nested thread', async () => {
    const parent = await app.client.mutate(api.sendMessage, {
      args: { conversationId: dmId, authorHandle: 'ada', authorName: 'Ada Lovelace', body: 'Original question' },
    });
    const reply = await app.client.mutate(api.sendMessage, {
      args: { conversationId: dmId, authorHandle: 'lin', authorName: 'Lin Chen', body: 'Reply text', replyToId: parent.result },
    });
    const feed = await app.client.query(api.conversationMessages, { args: { conversationId: dmId } });
    const row = feed.rows.find((m) => m._id === reply.result);
    assertEqual(row.replyPreview.authorName, 'Ada Lovelace', 'reply preview names the original author');
    assertEqual(row.replyPreview.body, 'Original question', 'reply preview quotes the original body');
    assert(!('children' in row), 'reply is a flat pointer, never a nested thread node');
  });

  await suite.check('toggleReaction is idempotent per (message, user, emoji)', async () => {
    const first = await app.client.mutate(api.toggleReaction, { args: { messageId: 'msg_dm2_1', userHandle: 'mo', emoji: '👏' } });
    assertEqual(first.result.reacted, true, 'first toggle reacts');
    const feedAfterFirst = await app.client.query(api.conversationMessages, { args: { conversationId: 'conv_dm_lin_grace' } });
    const reactedRow = feedAfterFirst.rows.find((m) => m._id === 'msg_dm2_1');
    assert(reactedRow.reactions.some((r) => r.emoji === '👏' && r.userHandles.includes('mo')), 'reaction visible in feed');
    const second = await app.client.mutate(api.toggleReaction, { args: { messageId: 'msg_dm2_1', userHandle: 'mo', emoji: '👏' } });
    assertEqual(second.result.reacted, false, 'second toggle un-reacts');
  });

  await suite.check('startDirectMessage reuses an existing dm instead of duplicating it', async () => {
    const again = await app.client.mutate(api.startDirectMessage, {
      args: { selfHandle: 'lin', selfName: 'Lin Chen', otherHandle: 'ada', otherName: 'Ada Lovelace' },
    });
    assertEqual(again.result, dmId, 'existing dm reused');
  });

  let groupId;
  await suite.check('createGroup seats every named member', async () => {
    const created = await app.client.mutate(api.createGroup, {
      args: {
        title: 'Acceptance Squad',
        creatorHandle: 'lin',
        creatorName: 'Lin Chen',
        memberHandles: ['grace', 'mo'],
      },
    });
    groupId = created.result;
    const conversation = await app.client.query(api.conversationById, { args: { conversationId: groupId } });
    assertEqual(conversation.rows[0].memberHandles.length, 3, 'creator plus 2 named members');
    const graceInbox = await app.client.query(api.myConversations, { args: { viewerHandle: 'grace' } });
    assert(graceInbox.rows.some((c) => c._id === groupId), 'named member sees the new group in her inbox');
  });

  await suite.check('a real image upload attaches through the trusted asset pipeline', async () => {
    // Dev-mode HTTP asset requests resolve an anonymous caller (no identity
    // on that surface — guide/backend/assets.md), so a plain fetch-based
    // upload can never satisfy this app's per-owner asset checks. The paved
    // dev/test path for a real caller identity is the CLI's admin-impersonated
    // `assets put --user`, exactly like seed-images.mjs uses.
    // See issues/20260805-guide-gap-dev-mode-asset-upload-anonymous-caller.md.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { makeSolidPng } = await import('../../scripts/make-png.mjs');
    const execFileAsync = promisify(execFile);

    const dir = mkdtempSync(join(tmpdir(), 'messaging-acceptance-'));
    const filePath = join(dir, 'acceptance.png');
    writeFileSync(filePath, makeSolidPng(12, 12, [220, 20, 60]));
    const binary = process.env.SNAPBACK_SERVER_BINARY ?? join(app.repoRoot, 'target', 'debug', 'snapback');
    let assetId;
    try {
      const { stdout } = await execFileAsync(binary, [
        'assets', 'put', filePath,
        '--upload', 'messageImageUpload',
        '--user', 'lin',
        '--url', app.server.baseUrl,
        '--token', app.server.adminToken,
        '--content-type', 'image/png',
      ]);
      const envelope = JSON.parse(stdout);
      assert(envelope.ok, `asset.put ok: ${stdout}`);
      assetId = envelope.data.task.assetId;
      assertEqual(envelope.data.task.availability, 'ready', 'upload finalized ready');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }

    const sent = await app.client.mutate(api.sendMessage, {
      args: { conversationId: groupId, authorHandle: 'lin', authorName: 'Lin Chen', body: '', assetId },
      // ctx.assets.attach() requires the caller principal to match the
      // asset's owner (ctx.auth.userId at upload time, resolved as 'lin'
      // by --user above).
      userId: 'lin',
    });
    const feed = await app.client.query(api.conversationMessages, { args: { conversationId: groupId } });
    const row = feed.rows.find((m) => m._id === sent.result);
    assert(typeof row.image === 'string' && row.image.length > 0, 'message carries a verified asset reference');
  });

  await suite.check('an empty message with no image refuses without a write', async () => {
    const before = (await app.client.query(api.conversationMessages, { args: { conversationId: dmId } })).rows.length;
    let threw = false;
    try {
      await app.client.mutate(api.sendMessage, { args: { conversationId: dmId, authorHandle: 'lin', authorName: 'Lin Chen', body: '   ' } });
    } catch {
      threw = true;
    }
    assert(threw, 'empty message refused');
    const after = (await app.client.query(api.conversationMessages, { args: { conversationId: dmId } })).rows.length;
    assertEqual(after, before, 'refused message wrote no row');
  });

  await suite.check('typing presence: a second persona publishing typing is visible over the ephemeral overlay', async () => {
    const { ephemeral } = await import('../../snapback/generated/api.mjs');
    const typingRef = ephemeral.typing;
    const overlay = await app.client.subscribeEphemeral(typingRef, {
      connectionId: 'acceptance-watcher',
      scope: { conversationId: dmId },
    });
    const otherOverlay = await app.client.subscribeEphemeral(typingRef, {
      connectionId: 'acceptance-typer',
      scope: { conversationId: dmId },
    });
    await otherOverlay.publish({ userHandle: 'ada', name: 'Ada Lovelace' }, { ttlMs: typingRef.maxTtlMs });
    await new Promise((resolve) => setTimeout(resolve, 150));
    const entries = overlay.currentEntries();
    assert(entries.some((e) => e.value.userHandle === 'ada'), 'watcher sees ada typing over the live overlay');
    overlay.dispose();
    otherOverlay.dispose();
  });
}, { cleanups: [app.close], reportFile: join(app.appDir, 'acceptance-report.json') });
