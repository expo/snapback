import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExternalSessionClient, SnapbackClient } from '@expo/snapback-client';
import { createAssetClient, createMemoryAssetTaskStore } from '@expo/snapback-client/assets';
import { generate } from '@expo/snapback-codegen';

import { importGeneratedModule } from '../../../_kit/generated-artifacts.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { resolveHeadlessAppLayout } from '../../../_kit/repo-layout.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { makeSolidPng } from '../../scripts/make-png.mjs';

const suite = createSuite('messaging-snapback / headless', { expectedChecks: 11 });
const { appDir, backendDir, repoRoot } = resolveHeadlessAppLayout(import.meta.url);
const scratch = mkdtempSync(join(tmpdir(), 'messaging-sessions-acceptance-'));
const fixtureBackendDir = join(scratch, 'snapback');
cpSync(backendDir, fixtureBackendDir, { recursive: true });

// @ref LLP 0176#g0--baseline-truth-and-mechanical-repair — G0's receipt must
// boot the existing fixture in settled Sessions mode without changing the
// interactive demo's deliberately dev-mode persona surface.
const fixtureSchemaPath = join(fixtureBackendDir, 'schema.mjs');
const fixtureSchemaSource = readFileSync(fixtureSchemaPath, 'utf8');
const sessionsSchemaSource = fixtureSchemaSource.replace(
  /\n  \}\),\n\}\);\s*$/u,
  "\n  }),\n  auth: { mode: 'sessions' },\n});\n",
);
if (sessionsSchemaSource === fixtureSchemaSource) {
  throw new Error('messaging sessions fixture could not select auth.mode=sessions');
}
writeFileSync(fixtureSchemaPath, sessionsSchemaSource);

const generated = await generate(fixtureBackendDir);
if (!generated.ok) {
  throw new Error(`messaging sessions fixture codegen failed: ${JSON.stringify(generated.diagnostics)}`);
}
const generatedDir = join(fixtureBackendDir, 'generated');
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const schema = readJson(join(generatedDir, 'schema.manifest.json'));
const functions = readJson(join(generatedDir, 'functions.manifest.json'));
assertEqual(schema.auth?.mode, 'sessions', 'fixture generated in sessions mode');
const startupArtifacts = join(scratch, 'startup-artifacts.json');
writeFileSync(startupArtifacts, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });

const operatorServer = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  startupArtifacts,
  captureImpersonationCapability: true,
});

async function seedFixture(server) {
  const response = await fetch(`${server.baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify({
      schemaVersion: 'snapback.v0',
      requestId: 'messaging-sessions-seed-reset',
      operation: 'app.reset',
      seed: readJson(join(fixtureBackendDir, 'seed.json')),
    }),
  });
  const envelope = await response.json();
  if (!response.ok || envelope.ok !== true) {
    throw new Error(`messaging sessions seed reset failed: ${JSON.stringify(envelope)}`);
  }
}

async function mintOrdinarySession(server, email) {
  const binary = process.env.SNAPBACK_SERVER_BINARY
    ?? join(repoRoot, 'target', 'debug', process.platform === 'win32' ? 'snapback.exe' : 'snapback');
  const child = spawn(binary, [
    'session', 'mint',
    '--email', email,
    '--url', server.baseUrl,
    '--impersonation-capability-stdin',
  ], {
    cwd: repoRoot,
    env: { ...process.env, SNAPBACK_ADMIN_TOKEN: server.adminToken },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => { stdout += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdin.end(`${server.impersonationCapability}\n`);
  const exit = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (exit.code !== 0) {
    throw new Error(`snapback session mint failed (${exit.code ?? exit.signal}): ${stderr.trim()}`);
  }
  const envelope = JSON.parse(stdout);
  if (
    envelope.ok !== true
    || typeof envelope.data?.token !== 'string'
    || typeof envelope.data?.session?.userId !== 'string'
  ) {
    throw new Error('snapback session mint did not return an ordinary session envelope');
  }
  return envelope.data;
}

let app;
try {
  await seedFixture(operatorServer);
  const minted = await mintOrdinarySession(operatorServer, 'lin@messaging.test');
  const client = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: minted.token,
    clientStoreId: 'messaging-g0-lin',
  });
  const { default: api } = await importGeneratedModule(generatedDir, 'api.mjs');
  // The application-facing object deliberately carries no admin token,
  // impersonation capability, ready file, or operator client — only the
  // public origin and the ordinary external-session client.
  app = {
    appDir,
    client,
    mintedUserId: minted.session.userId,
    provisioned: { schema: 'current', functions: 'current', seed: 'seeded' },
    server: { baseUrl: operatorServer.baseUrl },
    close: async () => {
      try {
        await client.closeAuth();
      } finally {
        try {
          await operatorServer.stop();
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
    },
  };

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

  await suite.check('ordinary-session lane: minted bearer uploads, attaches, and publicly delivers a real image', async () => {
    assert(typeof app.mintedUserId === 'string' && app.mintedUserId.length > 0, 'CLI mint returned a server-issued principal');
    const png = makeSolidPng(12, 12, [220, 20, 60]);
    const upload = createAssetClient(app.client).start({
      upload: api.messageImageUpload,
      file: new Blob([png], { type: 'image/png' }),
      declaredFilename: 'acceptance.png',
      declaredContentType: 'image/png',
    });
    const finished = await upload.done;
    assertEqual(finished.status, 'ready', JSON.stringify(finished.diagnostic));
    assert(typeof finished.assetId === 'string' && finished.assetId.length > 0, 'ordinary client returned an asset id');
    assertEqual(finished.bytesTransferred, png.length, 'TUS transferred the complete PNG');
    const sent = await app.client.mutate(api.sendMessage, {
      args: {
        conversationId: groupId,
        authorHandle: 'lin',
        authorName: 'Lin Chen',
        body: '',
        assetId: finished.assetId,
      },
    });
    const feed = await app.client.query(api.conversationMessages, { args: { conversationId: groupId } });
    const row = feed.rows.find((m) => m._id === sent.result);
    assertEqual(row.image, finished.assetId, 'typed attach committed the uploaded asset reference');
    const delivered = await fetch(
      `${app.server.baseUrl}/assets/public/${encodeURIComponent(finished.assetId)}/primary`,
    );
    assertEqual(delivered.status, 200, 'public rendition serves');
    assertEqual(delivered.headers.get('content-type'), 'image/png', 'public rendition content type');
    assertEqual(
      delivered.headers.get('cross-origin-resource-policy'),
      'cross-origin',
      'public rendition is embeddable cross-origin',
    );
  });

  await suite.check('anonymous lane: the same image attempt refuses at the ownership boundary', async () => {
    const png = makeSolidPng(12, 12, [220, 20, 60]);
    const taskStore = createMemoryAssetTaskStore();
    const ownerAssets = createAssetClient(app.client, { taskStore });
    const ownerTask = ownerAssets.start({
      upload: api.messageImageUpload,
      file: new Blob([png], { type: 'image/png' }),
      declaredFilename: 'anonymous-ownership-probe.png',
      declaredContentType: 'image/png',
    });
    await new Promise((resolve) => {
      const unsubscribe = ownerTask.subscribe((snapshot) => {
        if (snapshot.status !== 'uploading') return;
        ownerTask.pause();
        unsubscribe();
        resolve();
      });
    });
    const reserved = ownerTask.snapshot();
    assert(typeof reserved.assetId === 'string', 'ordinary session reserved the ownership probe asset');
    assert(typeof reserved.attemptId === 'string', 'ordinary session reserved the ownership probe attempt');

    const anonymousClient = new SnapbackClient(app.server.baseUrl, {
      custody: 'anonymous-public',
      adminToken: null,
      rqsStore: null,
    });
    try {
      const anonymousAssets = createAssetClient(anonymousClient, { taskStore });
      const upload = anonymousAssets.resumePersisted({
        assetId: reserved.assetId,
        file: new Blob([png], { type: 'image/png' }),
      });
      assert(upload !== null, 'anonymous client discovered the ordinary session attempt');
      const refused = await upload.done;
      assertEqual(refused.status, 'failed', 'anonymous upload refuses');
      assertEqual(
        refused.diagnostic?.status,
        403,
        `ownership boundary returns 403: ${JSON.stringify(refused.diagnostic)}`,
      );
    } finally {
      await Promise.all([
        anonymousClient.closeAuth(),
        ownerTask.cancel(),
      ]);
    }
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
    const typingRef = api.ephemeral.typing;
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
} catch (error) {
  if (!app) {
    try {
      await operatorServer.stop();
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  }
  throw error;
}
