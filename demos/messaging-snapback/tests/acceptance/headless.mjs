import { spawn } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExternalSessionClient, SnapbackClient } from '@expo/snapback-client';
import { createAssetClient, createMemoryAssetTaskStore } from '@expo/snapback-client/assets';
// Use the checkout-local generator so this fixture exercises the same
// admission surface as the grant primitive under test, not an older package
// closure that predates `grants: true`.
import { generate } from '../../../../packages/snapback-codegen/index.mjs';

import { importGeneratedModule } from '../../../_kit/generated-artifacts.mjs';
import {
  assert,
  assertEqual,
  createSuite,
  eventually,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import { resolveHeadlessAppLayout } from '../../../_kit/repo-layout.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { makeSolidPng } from '../../scripts/make-png.mjs';

const suite = createSuite('messaging-snapback / headless', { expectedChecks: 25 });
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
  // The sessions fixture is a scratch copy with a per-run appId, so the
  // governed-launch registry cannot resolve it; name its backend explicitly.
  governanceBackendRoot: fixtureBackendDir,
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

async function captureRejection(promise, label) {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(`${label} unexpectedly fulfilled`);
}

function assertAppRefusal(error, appCode, label) {
  assert(error && typeof error === 'object', `${label} returned an error object`);
  // The client error carries no top-level `code`: the platform envelope is
  // `diagnostic.code` and the declared refusal rides `diagnostic.details`
  // (guide/backend/mutations.md §Application refusals).
  assertEqual(error.diagnostic?.code, 'SNAPBACK_APP_REFUSAL', `${label} diagnostic code`);
  assertEqual(error.diagnostic?.details?.appCode, appCode, `${label} application code`);
  assert(
    error.diagnostic?.code !== 'SNAPBACK_ASSET_GRANT_STATE_INVALID',
    `${label} did not fall through to grant-state-invalid`,
  );
}

function assertPermissionDenied(error, label) {
  assert(error && typeof error === 'object', `${label} returned an error object`);
  assertEqual(
    error.diagnostic?.code,
    'SNAPBACK_AUTH_PERMISSION_DENIED',
    `${label} diagnostic code`,
  );
}

function ephemeralMessage(frame) {
  if (frame?.Ephemeral) return frame.Ephemeral;
  if (frame?.kind === 'ephemeral') return frame.message;
  return frame?.message ?? frame;
}

let app;
try {
  await seedFixture(operatorServer);
  // Four ordinary principals, with independent client stores. The repeated
  // and race probes also adopt the same recipient bearers into second stores
  // so every call has fresh client mutation identity rather than replaying.
  const ownerMinted = await mintOrdinarySession(operatorServer, 'lin@messaging.test');
  const recipientAMinted = await mintOrdinarySession(operatorServer, 'ada@messaging.test');
  const recipientBMinted = await mintOrdinarySession(operatorServer, 'grace@messaging.test');
  const outsiderMinted = await mintOrdinarySession(operatorServer, 'outsider@messaging.test');
  const ownerClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: ownerMinted.token,
    clientStoreId: 'messaging-view-once-owner',
    rqsStore: null,
    offlineQueue: false,
  });
  const recipientAClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: recipientAMinted.token,
    clientStoreId: 'messaging-view-once-recipient-a-1',
    rqsStore: null,
    offlineQueue: false,
  });
  const recipientASecondClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: recipientAMinted.token,
    clientStoreId: 'messaging-view-once-recipient-a-2',
    rqsStore: null,
    offlineQueue: false,
  });
  const recipientBClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: recipientBMinted.token,
    clientStoreId: 'messaging-view-once-recipient-b-1',
    rqsStore: null,
    offlineQueue: false,
  });
  const recipientBSecondClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: recipientBMinted.token,
    clientStoreId: 'messaging-view-once-recipient-b-2',
    rqsStore: null,
    offlineQueue: false,
  });
  const outsiderClient = createExternalSessionClient(operatorServer.baseUrl, {
    bearerToken: outsiderMinted.token,
    clientStoreId: 'messaging-view-once-outsider',
    rqsStore: null,
    offlineQueue: false,
  });
  const anonymousClient = new SnapbackClient(operatorServer.baseUrl, {
    custody: 'anonymous-public',
    authClientProtocol: 1,
    adminToken: null,
    rqsStore: null,
  });
  const { default: api } = await importGeneratedModule(generatedDir, 'api.mjs');
  // The application-facing object deliberately carries no admin token,
  // impersonation capability, ready file, or operator client — only the
  // public origin and the ordinary external-session client.
  app = {
    appDir,
    client: ownerClient,
    mintedUserId: ownerMinted.session.userId,
    clients: {
      owner: ownerClient,
      recipientA: recipientAClient,
      recipientASecond: recipientASecondClient,
      recipientB: recipientBClient,
      recipientBSecond: recipientBSecondClient,
      outsider: outsiderClient,
      anonymous: anonymousClient,
    },
    sessions: {
      owner: ownerMinted,
      recipientA: recipientAMinted,
      recipientB: recipientBMinted,
      outsider: outsiderMinted,
    },
    provisioned: { schema: 'current', functions: 'current', seed: 'seeded' },
    server: { baseUrl: operatorServer.baseUrl },
    close: async () => {
      try {
        await Promise.all([
          ownerClient.closeAuth(),
          recipientAClient.closeAuth(),
          recipientASecondClient.closeAuth(),
          recipientBClient.closeAuth(),
          recipientBSecondClient.closeAuth(),
          outsiderClient.closeAuth(),
          anonymousClient.closeAuth(),
        ]);
      } finally {
        try {
          await operatorServer.stop();
        } finally {
          rmSync(scratch, { recursive: true, force: true });
        }
      }
    },
  };

  const viewOnceAssets = createAssetClient(app.clients.owner);
  let viewOnceUploadSequence = 0;
  async function sendFreshViewOnce(recipients, caption) {
    viewOnceUploadSequence += 1;
    const png = makeSolidPng(12, 12, [
      30 + (viewOnceUploadSequence * 37) % 180,
      40 + (viewOnceUploadSequence * 53) % 170,
      50 + (viewOnceUploadSequence * 71) % 160,
    ]);
    const upload = viewOnceAssets.start({
      upload: api.viewOnceImageUpload,
      file: new Blob([png], { type: 'image/png' }),
      declaredFilename: `view-once-${viewOnceUploadSequence}.png`,
      declaredContentType: 'image/png',
    });
    const finished = await upload.done;
    assertEqual(finished.status, 'ready', JSON.stringify(finished.diagnostic));
    const sent = await app.clients.owner.mutate(api.sendViewOnce, {
      args: {
        conversationId: 'conv_group_founders',
        assetId: finished.assetId,
        recipients,
        caption,
      },
    });
    return { assetId: finished.assetId, messageId: sent.result };
  }

  const strictFetch = (assetId, session) => fetch(
    `${app.server.baseUrl}/assets/records/${encodeURIComponent(assetId)}/bytes/primary`,
    {
      headers: {
        'x-snapback-auth-client-protocol': '1',
        authorization: `Bearer ${session.token}`,
      },
    },
  );

  async function assertStrictDenied(response, label) {
    assertEqual(response.status, 403, `${label} is a real authorization denial`);
    const envelope = await response.json();
    const diagnostic = envelope?.diagnostics?.[0] ?? envelope?.diagnostic ?? envelope;
    assertEqual(diagnostic?.code, 'SNAPBACK_ASSET_FORBIDDEN', `${label} diagnostic`);
  }

  async function assertStrictAllowed(response, label) {
    assertEqual(response.status, 200, `${label} is authorized`);
    assertEqual(response.headers.get('content-type'), 'image/png', `${label} content type`);
  }

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
    const created = await app.client.mutate(api.startDirectMessage, {
      args: {
        selfHandle: 'caller-asserted-dedup-creator',
        selfName: 'Dedup creator',
        otherHandle: 'dedup-recipient',
        otherName: 'Dedup recipient',
      },
    });
    const again = await app.client.mutate(api.startDirectMessage, {
      args: {
        selfHandle: 'different-caller-asserted-creator',
        selfName: 'Dedup creator',
        otherHandle: 'dedup-recipient',
        otherName: 'Dedup recipient',
      },
    });
    assertEqual(again.result, created.result, 'authenticated principal reuses its existing dm');
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

  const ownerPrincipal = app.sessions.owner.session.userId;
  const recipientAPrincipal = app.sessions.recipientA.session.userId;
  const recipientBPrincipal = app.sessions.recipientB.session.userId;
  let hostileViewOnce;

  await suite.check('view-once send refuses empty and duplicate recipient sets', async () => {
    const empty = await captureRejection(app.clients.owner.mutate(api.sendViewOnce, {
      args: {
        conversationId: 'conv_group_founders',
        assetId: 'unused-empty-recipient-asset',
        recipients: [],
      },
    }), 'empty view-once recipient set');
    assertAppRefusal(empty, 'VIEW_ONCE_RECIPIENTS_EMPTY', 'empty view-once recipient set');

    const duplicate = await captureRejection(app.clients.owner.mutate(api.sendViewOnce, {
      args: {
        conversationId: 'conv_group_founders',
        assetId: 'unused-duplicate-recipient-asset',
        recipients: [recipientAPrincipal, recipientAPrincipal],
      },
    }), 'duplicate view-once recipient set');
    assertAppRefusal(duplicate, 'VIEW_ONCE_RECIPIENT_DUPLICATE', 'duplicate view-once recipient set');
  });

  await suite.check('view-once hostile sequence: outsider and pending recipient get 403, then open gets 200', async () => {
    hostileViewOnce = await sendFreshViewOnce(
      [recipientAPrincipal, recipientBPrincipal],
      'hostile sequence',
    );
    await assertStrictDenied(
      await strictFetch(hostileViewOnce.assetId, app.sessions.outsider),
      'outsider strict fetch',
    );
    await assertStrictDenied(
      await strictFetch(hostileViewOnce.assetId, app.sessions.recipientA),
      'pending recipient A strict fetch',
    );

    const outsiderOpen = await captureRejection(app.clients.outsider.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    }), 'outsider open');
    assertAppRefusal(outsiderOpen, 'VIEW_ONCE_NOT_RECIPIENT', 'outsider open');

    const opened = await app.clients.recipientA.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    });
    assertEqual(opened.result, true, 'recipient A open committed');
    await assertStrictAllowed(
      await strictFetch(hostileViewOnce.assetId, app.sessions.recipientA),
      'active recipient A strict fetch',
    );
  });

  await suite.check('view-once repeated second open refuses from product consumption state', async () => {
    // A second external client guarantees this is a fresh mutation call, not
    // replay of the first client's clientKey.
    const repeated = await captureRejection(app.clients.recipientASecond.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    }), 'repeated second open');
    assertAppRefusal(repeated, 'VIEW_ONCE_ALREADY_CONSUMED', 'repeated second open');
    assert(
      repeated.diagnostic?.code !== 'SNAPBACK_ASSET_GRANT_STATE_INVALID',
      'repeated second open is explicitly not grant-state-invalid',
    );
    await assertStrictAllowed(
      await strictFetch(hostileViewOnce.assetId, app.sessions.recipientA),
      'recipient A bytes remain active after refused second open',
    );
  });

  await suite.check('view-once concurrent race admits one open and refuses the loser from product state', async () => {
    const raced = await sendFreshViewOnce([recipientBPrincipal], 'race');
    const outcomes = await Promise.allSettled([
      app.clients.recipientB.mutate(api.openViewOnce, {
        args: { viewOnceMessageId: raced.messageId },
      }),
      app.clients.recipientBSecond.mutate(api.openViewOnce, {
        args: { viewOnceMessageId: raced.messageId },
      }),
    ]);
    const fulfilled = outcomes.filter((outcome) => outcome.status === 'fulfilled');
    const rejected = outcomes.filter((outcome) => outcome.status === 'rejected');
    assertEqual(fulfilled.length, 1, 'exactly one concurrent open fulfills');
    assertEqual(rejected.length, 1, 'exactly one concurrent open rejects');
    assertAppRefusal(
      rejected[0].reason,
      'VIEW_ONCE_ALREADY_CONSUMED',
      'concurrent second-open loser',
    );
    assert(
      rejected[0].reason?.diagnostic?.code !== 'SNAPBACK_ASSET_GRANT_STATE_INVALID',
      'race loser is explicitly not grant-state-invalid',
    );
    const state = await app.clients.owner.query(api.viewOnceMessageById, {
      args: { viewOnceMessageId: raced.messageId },
    });
    assertEqual(state.rows.length, 1, 'raced message remains owner-visible');
    assertEqual(
      state.rows[0].consumedPrincipals.filter((principal) => principal === recipientBPrincipal).length,
      1,
      'race commits exactly one consumption row',
    );
    await app.clients.owner.mutate(api.deleteViewOnceForEveryone, {
      args: { viewOnceMessageId: raced.messageId },
    });
  });

  await suite.check('view-once close revokes strict delivery and clears owner bookkeeping', async () => {
    const closed = await app.clients.recipientA.mutate(api.closeViewOnce, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    });
    assertEqual(closed.result, true, 'recipient A close committed');
    await assertStrictDenied(
      await strictFetch(hostileViewOnce.assetId, app.sessions.recipientA),
      'recipient A strict fetch after close',
    );
    const state = await app.clients.owner.query(api.viewOnceMessageById, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    });
    assertEqual(state.rows.length, 1, 'hostile-sequence row remains after one close');
    assert(
      !Object.hasOwn(state.rows[0].grants, recipientAPrincipal),
      'owner-visible grants map no longer contains recipient A',
    );
    assert(
      Object.hasOwn(state.rows[0].grants, recipientBPrincipal),
      'recipient B pending edge remains live until owner cleanup',
    );
    await app.clients.owner.mutate(api.deleteViewOnceForEveryone, {
      args: { viewOnceMessageId: hostileViewOnce.messageId },
    });
  });

  await suite.check('view-once two-recipient delete-for-everyone revokes both active edges and deletes product state', async () => {
    const deleted = await sendFreshViewOnce(
      [recipientAPrincipal, recipientBPrincipal],
      'delete for everyone',
    );
    await app.clients.recipientA.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: deleted.messageId },
    });
    await app.clients.recipientB.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: deleted.messageId },
    });
    await assertStrictAllowed(
      await strictFetch(deleted.assetId, app.sessions.recipientA),
      'recipient A before delete-for-everyone',
    );
    await assertStrictAllowed(
      await strictFetch(deleted.assetId, app.sessions.recipientB),
      'recipient B before delete-for-everyone',
    );

    const nonAuthorDelete = await captureRejection(
      app.clients.recipientA.mutate(api.deleteViewOnceForEveryone, {
        args: { viewOnceMessageId: deleted.messageId },
      }),
      'non-author delete-for-everyone',
    );
    assertAppRefusal(nonAuthorDelete, 'VIEW_ONCE_NOT_AUTHOR', 'non-author delete-for-everyone');

    const ownerDeleted = await app.clients.owner.mutate(api.deleteViewOnceForEveryone, {
      args: { viewOnceMessageId: deleted.messageId },
    });
    assertEqual(ownerDeleted.result, true, 'owner delete-for-everyone committed');
    await assertStrictDenied(
      await strictFetch(deleted.assetId, app.sessions.recipientA),
      'recipient A after delete-for-everyone',
    );
    await assertStrictDenied(
      await strictFetch(deleted.assetId, app.sessions.recipientB),
      'recipient B after delete-for-everyone',
    );
    const gone = await app.clients.owner.query(api.viewOnceMessageById, {
      args: { viewOnceMessageId: deleted.messageId },
    });
    assertEqual(gone.rows.length, 0, 'view-once row and its typed reference are gone');
  });

  await suite.check('view-once close-then-delete revokes only the still-live recipient edge', async () => {
    const closeThenDelete = await sendFreshViewOnce(
      [recipientAPrincipal, recipientBPrincipal],
      'close then delete',
    );
    await app.clients.recipientA.mutate(api.openViewOnce, {
      args: { viewOnceMessageId: closeThenDelete.messageId },
    });
    await app.clients.recipientA.mutate(api.closeViewOnce, {
      args: { viewOnceMessageId: closeThenDelete.messageId },
    });
    const afterClose = await app.clients.owner.query(api.viewOnceMessageById, {
      args: { viewOnceMessageId: closeThenDelete.messageId },
    });
    assert(!Object.hasOwn(afterClose.rows[0].grants, recipientAPrincipal), 'closed A edge is absent');
    assert(Object.hasOwn(afterClose.rows[0].grants, recipientBPrincipal), 'pending B edge is still live');

    const ownerDeleted = await app.clients.owner.mutate(api.deleteViewOnceForEveryone, {
      args: { viewOnceMessageId: closeThenDelete.messageId },
    });
    assertEqual(ownerDeleted.result, true, 'delete succeeds after a sibling close');
    await assertStrictDenied(
      await strictFetch(closeThenDelete.assetId, app.sessions.recipientB),
      'recipient B after close-then-delete',
    );
    const gone = await app.clients.owner.query(api.viewOnceMessageById, {
      args: { viewOnceMessageId: closeThenDelete.messageId },
    });
    assertEqual(gone.rows.length, 0, 'close-then-delete removes message and consumptions');
    assertEqual(ownerPrincipal, app.mintedUserId, 'owner query ran under the asset owner session');
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

  const typingRef = api.ephemeral.typing;
  let typingConversationId;
  let typingScope;
  let memberAOverlay;
  let memberBOverlay;
  let memberBFreshOverlay;
  let memberBEntryKey;
  const memberAFrames = [];
  const memberBFrames = [];
  let unregisterMemberAFrames;
  let unregisterMemberBFrames;
  let memberBTerminalFrameCount;
  let memberBTerminalMessage;

  await suite.check('typing membership (a): anonymous subscribe and publish are denied', async () => {
    const scope = { conversationId: dmId };
    const subscribeError = await captureRejection(app.clients.anonymous.subscribeEphemeral(typingRef, {
      connectionId: 'typing-anonymous-subscribe',
      scope,
      transport: 'poll',
    }), 'anonymous typing subscribe');
    assertPermissionDenied(subscribeError, 'anonymous typing subscribe');

    const publishError = await captureRejection(app.clients.anonymous.publishEphemeral(typingRef, {
      connectionId: 'typing-anonymous-publish',
      scope,
      value: { userHandle: 'anonymous', name: 'Anonymous' },
      ttlMs: typingRef.maxTtlMs,
    }), 'anonymous typing publish');
    assertPermissionDenied(publishError, 'anonymous typing publish');
    return {
      subscribe: subscribeError.diagnostic.code,
      publish: publishError.diagnostic.code,
    };
  });

  await suite.check('typing membership (b): an authenticated non-member is denied', async () => {
    const scope = { conversationId: dmId };
    const subscribeError = await captureRejection(app.clients.outsider.subscribeEphemeral(typingRef, {
      connectionId: 'typing-outsider-subscribe',
      scope,
      transport: 'poll',
    }), 'non-member typing subscribe');
    assertPermissionDenied(subscribeError, 'non-member typing subscribe');

    const publishError = await captureRejection(app.clients.outsider.publishEphemeral(typingRef, {
      connectionId: 'typing-outsider-publish',
      scope,
      value: { userHandle: 'outsider', name: 'Outsider' },
      ttlMs: typingRef.maxTtlMs,
    }), 'non-member typing publish');
    assertPermissionDenied(publishError, 'non-member typing publish');
    return {
      subscribe: subscribeError.diagnostic.code,
      publish: publishError.diagnostic.code,
    };
  });

  await suite.check('typing membership (c): Sessions creation binds the creator handle to the authenticated principal', async () => {
    const forgedCreatorHandle = 'caller-asserted-forged-creator';
    const created = await app.clients.owner.mutate(api.startDirectMessage, {
      args: {
        selfHandle: forgedCreatorHandle,
        selfName: 'Member A',
        otherHandle: recipientAPrincipal,
        otherName: 'Member B',
      },
    });
    typingConversationId = created.result;
    typingScope = { conversationId: typingConversationId };
    const conversation = await app.clients.owner.query(api.conversationById, {
      args: { conversationId: typingConversationId },
    });
    assertEqual(conversation.rows.length, 1, 'created conversation is queryable');
    assert(
      conversation.rows[0].memberHandles.includes(ownerPrincipal),
      'creator projection uses the authenticated principal',
    );
    assert(
      !conversation.rows[0].memberHandles.includes(forgedCreatorHandle),
      'caller-asserted creator handle is not stored',
    );
    const ownerInbox = await app.clients.owner.query(api.myConversations, {
      args: { viewerHandle: ownerPrincipal },
    });
    const forgedInbox = await app.clients.owner.query(api.myConversations, {
      args: { viewerHandle: forgedCreatorHandle },
    });
    assert(ownerInbox.rows.some((row) => row._id === typingConversationId), 'creator principal owns the inbox edge');
    assert(!forgedInbox.rows.some((row) => row._id === typingConversationId), 'forged creator has no inbox edge');
    return { creatorHandle: conversation.rows[0].memberHandles[0], forgedCreatorStored: false };
  });

  await suite.check('typing membership (d): member A sees member B typing', async () => {
    unregisterMemberAFrames = app.clients.owner.registerEphemeralConsumer(
      'typing-member-a',
      (frame) => memberAFrames.push(frame),
    );
    unregisterMemberBFrames = app.clients.recipientA.registerEphemeralConsumer(
      'typing-member-b',
      (frame) => {
        memberBFrames.push(frame);
        const message = ephemeralMessage(frame);
        if (
          memberBTerminalFrameCount === undefined
          && message?.Error?.error?.code === 'PermissionDenied'
        ) {
          memberBTerminalFrameCount = memberBFrames.length;
          memberBTerminalMessage = message;
        }
      },
    );
    memberAOverlay = await app.clients.owner.subscribeEphemeral(typingRef, {
      connectionId: 'typing-member-a',
      scope: typingScope,
      transport: 'poll',
    });
    memberBOverlay = await app.clients.recipientA.subscribeEphemeral(typingRef, {
      connectionId: 'typing-member-b',
      scope: typingScope,
      transport: 'poll',
    });
    const published = await memberBOverlay.publish(
      { userHandle: recipientAPrincipal, name: 'Member B' },
      { ttlMs: typingRef.maxTtlMs },
    );
    memberBEntryKey = published.key;
    await eventually(async () => {
      await memberAOverlay.drain();
      assert(
        memberAOverlay.currentEntries().some((entry) => (
          entry.key === memberBEntryKey
          && entry.value.userHandle === recipientAPrincipal
        )),
        'member A sees member B typing',
      );
    }, 'member A observes member B typing');
    return { memberAObservedMemberB: true };
  });

  await suite.check('typing membership (e): removing B revokes B and removes B from A', async () => {
    await app.clients.recipientA.mutate(api.leaveConversation, {
      args: { conversationId: typingConversationId },
    });

    await eventually(async () => {
      await Promise.all([memberAOverlay.drain(), memberBOverlay.drain()]);
      const denied = ephemeralMessage(memberBFrames.at(-1));
      assert(memberBTerminalMessage, 'removed member receives the PermissionDenied terminal frame');
      assertEqual(
        denied?.Error?.error?.code,
        'PermissionDenied',
        'PermissionDenied is the last frame received at revocation time',
      );
      assertEqual(
        memberBFrames.length,
        memberBTerminalFrameCount,
        'no frame follows the first PermissionDenied at the revocation checkpoint',
      );
      assertEqual(
        denied.Error.room_authority_generation,
        2,
        'removed member terminal frame carries the successor authority generation',
      );
      const revoked = memberAFrames
        .map(ephemeralMessage)
        .find((message) => (
          message?.Remove?.key === memberBEntryKey
          && message.Remove.reason === 'AuthRevoked'
        ));
      assert(revoked, 'surviving member receives the AuthRevoked removal frame');
      assert(
        !memberAOverlay.currentEntries().some((entry) => entry.key === memberBEntryKey),
        'member A no longer sees member B typing',
      );
    }, 'membership removal revokes B and deletes B typing');

    const publishError = await captureRejection(memberBOverlay.publish(
      { userHandle: recipientAPrincipal, name: 'Removed member B' },
      { ttlMs: typingRef.maxTtlMs },
    ), 'removed member typing publish');
    assertPermissionDenied(publishError, 'removed member typing publish');

    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'removed member receives zero frames between terminal denial and survivor probe',
    );
    await memberAOverlay.publish(
      { userHandle: ownerPrincipal, name: 'Member A after removal' },
      { ttlMs: typingRef.maxTtlMs },
    );
    await memberAOverlay.drain();
    await memberBOverlay.drain();
    assertEqual(
      memberBFrames.length,
      memberBTerminalFrameCount,
      'removed member subscription stays silent after its terminal frame',
    );
    const removal = memberAFrames
      .map(ephemeralMessage)
      .find((message) => (
        message?.Remove?.key === memberBEntryKey
        && message.Remove.reason === 'AuthRevoked'
      ));
    return {
      removedSubscriberFrameCode: memberBTerminalMessage.Error.error.code,
      successorAuthorityGeneration: memberBTerminalMessage.Error.room_authority_generation,
      survivorRemovalReason: removal.Remove.reason,
      formerMemberPublish: publishError.diagnostic.code,
      postTerminalFrames: memberBFrames.length - memberBTerminalFrameCount,
    };
  });

  await suite.check('typing membership (f): leave removes B from inbox and member-count projections', async () => {
    const departedInbox = await app.clients.recipientA.query(api.myConversations, {
      args: { viewerHandle: recipientAPrincipal },
    });
    const conversation = await app.clients.owner.query(api.conversationById, {
      args: { conversationId: typingConversationId },
    });
    assert(
      !departedInbox.rows.some((row) => row._id === typingConversationId),
      'departed member no longer sees the conversation in their inbox',
    );
    assert(
      !conversation.rows[0].memberHandles.includes(recipientAPrincipal),
      'departed member is removed from the denormalized member list',
    );
    return { departedInboxEdge: false, departedMemberHandle: false };
  });

  await suite.check('typing membership (g): add restores B to inbox and member-count projections', async () => {
    await app.clients.owner.mutate(api.addConversationMember, {
      args: {
        conversationId: typingConversationId,
        userHandle: recipientAPrincipal,
      },
    });
    const restoredInbox = await app.clients.recipientA.query(api.myConversations, {
      args: { viewerHandle: recipientAPrincipal },
    });
    const conversation = await app.clients.owner.query(api.conversationById, {
      args: { conversationId: typingConversationId },
    });
    assert(
      restoredInbox.rows.some((row) => row._id === typingConversationId),
      're-added member sees the conversation in their inbox',
    );
    assert(
      conversation.rows[0].memberHandles.includes(recipientAPrincipal),
      're-added member is restored to the denormalized member list',
    );
    return { restoredInboxEdge: true, restoredMemberHandle: true };
  });

  await suite.check('typing membership (h): B rejoins through a fresh subscription', async () => {
    memberBFreshOverlay = await eventually(async () => {
      await memberAOverlay.drain();
      return app.clients.recipientA.subscribeEphemeral(typingRef, {
        connectionId: 'typing-member-b-rejoined',
        scope: typingScope,
        transport: 'poll',
      });
    }, 'fresh member B subscribe clears the authority barrier');
    const republished = await memberBFreshOverlay.publish(
      { userHandle: recipientAPrincipal, name: 'Member B rejoined' },
      { ttlMs: typingRef.maxTtlMs },
    );
    await eventually(async () => {
      await memberAOverlay.drain();
      assert(
        memberAOverlay.currentEntries().some((entry) => (
          entry.key === republished.key
          && entry.value.name === 'Member B rejoined'
        )),
        'member A sees member B after rejoin',
      );
    }, 'member B rejoin becomes visible to member A');

    memberAOverlay.dispose();
    memberBOverlay.dispose();
    memberBFreshOverlay.dispose();
    unregisterMemberAFrames();
    unregisterMemberBFrames();
    return { freshSubscribe: true, memberAObservedMemberBAgain: true };
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
