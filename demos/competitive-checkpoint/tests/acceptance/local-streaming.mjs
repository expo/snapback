// @ref LLP 0075#stream-gate — the frozen 16-chunk source must become at least
// three authoritative commits observed by a second client with fallback off.
// @ref LLP 0076#acceptance — exercise the real action → nested mutation →
// commit → native live-push path, including cancellation and settlement kinds.

import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const ADA = 'user_checkpoint_ada';
const GRACE = 'user_checkpoint_grace';

const source = await startStreamSource();
const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  env: { SNAPBACK_OUTBOUND_ACTIONS: '1' },
  provenance: {
    appId: 'competitive-checkpoint',
    artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
  },
});
const client = new SnapbackClient(server.baseUrl, server.clientOptions);
// @ref LLP 0075#author-adjudication--2026-07-22 — protocol amendment v0.1: target identity
// is derived from the served capability manifest (never a hand-written alias)
// and the receipt pins the manifest digest it was derived from.
const servedIdentity = await deriveServedTargetIdentity(server.baseUrl);
const cleanups = [() => source.close(), () => server.stop()];
const suite = createSuite('competitive checkpoint / local streamed actions', { expectedChecks: 8 });
let conversationId;

await runAcceptance(suite, async () => {
  const functionManifest = generated('functions.manifest.json');
  const capabilityManifest = generated('capability.manifest.json');
  assertEqual(
    servedIdentity.targetProfile,
    capabilityManifest.targetProfileId,
    'served target identity must match the generated artifact pair',
  );
  const streamedAction = functionManifest.functions.find((fn) => fn.name === 'streamReply');
  assert(
    streamedAction?.requiredCapabilities?.includes('bounded_response_stream_v1'),
    'streamReply must carry its target capability requirement in the generated artifact',
  );
  assert(
    capabilityManifest.outboundActions === true &&
      capabilityManifest.supportedCapabilities?.includes('bounded_response_stream_v1'),
    'the paired generated target artifact must describe the enabled outbound stream instance',
  );
  await client.loadSchema(generated('schema.manifest.json'));
  await client.loadFunctions(functionManifest);
  await client.reset();

  const created = await client.mutate(api.createConversation, {
    userId: ADA,
    args: { slug: 'first-chat', title: 'First chat', model: 'deterministic-v0' },
  });
  const conversation = created.result;
  conversationId = conversation._id;

  await suite.check('generated owner CRUD, unique lookup, and keyset pages retain negative authorization', async () => {
    assertEqual((await client.query(api.listConversations, { userId: ADA })).rows.length, 1, 'owner list');
    assertEqual(
      (await client.query(api.conversationBySlug, { userId: ADA, args: { slug: 'first-chat' } })).rows[0]._id,
      conversationId,
      'owner unique lookup',
    );
    assertEqual(
      (await client.query(api.firstConversationPage, { userId: ADA })).rows[0]._id,
      conversationId,
      'owner first page',
    );
    assertEqual((await client.query(api.listConversations, { userId: GRACE })).rows, [], 'other actor list');
    assertEqual(
      (await client.query(api.conversationBySlug, { userId: GRACE, args: { slug: 'first-chat' } })).rows,
      [],
      'other actor unique lookup',
    );
    assertEqual((await client.query(api.firstConversationPage, { userId: GRACE })).rows, [], 'other actor page');
    await assertThrows(
      () => client.mutate(api.updateConversation, {
        userId: GRACE,
        args: { id: conversationId, title: 'stolen', model: 'stolen' },
      }),
      // @ref LLP 0065#3-common-pattern-contracts — the Accepted
      // anti-probing posture (protocol amendment v0.5): a cross-user write
      // refuses with the same code and body as a missing row, so a caller
      // probing another user's ids learns nothing.
      'SNAPBACK_ROW_NOT_FOUND',
      'other actor update must fail closed',
    );
    // @ref LLP 0065#2-the-v1-visibility-floor — cross-user delete refusal is part of the
    // required negative-authorization set; the row must survive untouched.
    await assertThrows(
      () => client.mutate(api.deleteConversation, {
        userId: GRACE,
        args: { id: conversationId },
      }),
      'SNAPBACK_ROW_NOT_FOUND',
      'other actor delete must fail closed',
    );
    assertEqual(
      (await client.query(api.listConversations, { userId: ADA })).rows.length,
      1,
      'owner row survives the refused cross-user delete',
    );
    return {
      generatedOperations: 8,
      visibility: { kind: 'owner', field: 'ownerId' },
      crossUserDenialsWitnessed: ['list', 'uniqueLookup', 'keysetPage', 'update', 'delete'],
    };
  });

  // @ref LLP 0080#5-transactionally-maintained-projections — the projection
  // output materializes inside each SOURCE mutation's own commit: the root
  // insert projects a card immediately (left join, null modelName), the
  // joined-side insert fans out through the reverse index, and the output
  // table is readable only through its owner-composed query.
  await suite.check('maintained projection materializes cards in the source commits', async () => {
    const before = await client.query(api.listConversationCards, { userId: ADA });
    assertEqual(before.rows.length, 1, 'root insert already projected the card');
    assertEqual(before.rows[0].title, 'First chat', 'card mirrors the root leaf');
    assertEqual(before.rows[0].modelName ?? null, null, 'unregistered model projects null');

    await client.mutate(api.registerModel, {
      userId: ADA,
      args: { slug: 'deterministic-v0', displayName: 'Deterministic v0' },
    });
    const after = await client.query(api.listConversationCards, { userId: ADA });
    assertEqual(
      after.rows[0].modelName,
      'Deterministic v0',
      'the joined-side insert fanned out to the card in its own commit',
    );
    assertEqual(
      (await client.query(api.listConversationCards, { userId: GRACE })).rows,
      [],
      'cards stay owner-scoped',
    );
    return {
      projection: 'conversation-cards',
      fanOut: 'reverse-index by_model',
      readPath: 'owner-composed live query',
    };
  });

  await suite.check('16 upstream chunks become multiple authoritative native-push commits', async () => {
    const started = await startReply('complete-1', 'stream the fixture');
    const observer = await observeAttempt(started.attemptId, conversationId, ADA, 'complete-observer');
    const blocked = await observeAttempt(started.attemptId, conversationId, GRACE, 'blocked-observer');
    try {
      assertEqual(blocked.initialRows, [], 'other actor initial live rows');
      const action = client.action(api.streamReply, {
        userId: ADA,
        args: {
          attemptId: started.attemptId,
          streamUrl: `${source.url}/stream`,
          method: 'GET',
          upstreamIdempotent: true,
        },
      });
      const observed = await collectUntilTerminal(observer, started.attemptId, 'complete');
      const result = await action;
      assert(result.ok, `stream action failed: ${JSON.stringify(result.diagnostic)}`);
      assertEqual(result.result.outcome, 'complete', 'action outcome');
      const intermediate = [...new Set(observed
        .filter((row) => row.status === 'running' && row.sequence > 0)
        .map((row) => row.sequence))];
      assert(intermediate.length >= 3, `expected at least three authoritative progress commits, got ${intermediate}`);
      const terminal = observed.at(-1);
      assertEqual(terminal.content, source.expectedBody, 'ordered streamed content');
      assertEqual(terminal.status, 'complete', 'terminal status');
      await expectNoUpdate(blocked.stream, 200, 'other actor received a private progress commit');
      return {
        sourceChunks: 16,
        sourceDurationMsMinimum: 800,
        intermediateAuthoritativeCommits: intermediate.length,
        transport: 'native-websocket-push',
        fallback: false,
      };
    } finally {
      await observer.close();
      await blocked.close();
    }
  });

  await suite.check('reply start retries are idempotent and cross-user progress mutation is refused', async () => {
    const first = await startReply('retry-1', 'retry me');
    const second = await startReply('retry-1', 'retry me');
    assertEqual(second.attemptId, first.attemptId, 'attempt identity');
    assertEqual(second.assistantMessageId, first.assistantMessageId, 'assistant identity');
    assertEqual(second.replayed, true, 'retry replay fact');
    const rows = (await client.query(api.listMessages, { userId: ADA, args: { conversationId } })).rows;
    assertEqual(rows.filter((row) => row.idempotencyKey === 'retry-1').length, 1, 'one assistant row');
    const before = await attemptRow(first.attemptId, ADA);
    await assertThrows(
      () => client.mutate(api.applyReplyProgress, {
        userId: GRACE,
        args: { attemptId: first.attemptId, sequence: 1, delta: 'stolen' },
      }),
      'SNAPBACK_HANDLER_FAILED',
      'other actor progress mutation must fail closed',
    );
    assertEqual(await attemptRow(first.attemptId, ADA), before, 'refused progress leaves owner row unchanged');
  });

  await suite.check('durable cancellation stops the reader and fences every late patch', async () => {
    const started = await startReply('cancel-1', 'cancel me');
    const observer = await observeAttempt(started.attemptId, conversationId, ADA, 'cancel-observer');
    try {
      const action = client.action(api.streamReply, {
        userId: ADA,
        args: {
          attemptId: started.attemptId,
          streamUrl: `${source.url}/stream`,
          method: 'GET',
          upstreamIdempotent: true,
        },
      });
      await collectUntilSequence(observer, started.attemptId, 1);
      const cancelled = await client.mutate(api.cancelReply, {
        userId: ADA,
        args: { attemptId: started.attemptId },
      });
      assertEqual(cancelled.result.status, 'cancelled', 'durable cancel status');
      const result = await action;
      assert(result.ok, `cancelled action envelope failed: ${JSON.stringify(result.diagnostic)}`);
      assertEqual(result.result.outcome, 'cancelled', 'action cancellation outcome');
      const after = await attemptRow(started.attemptId, ADA);
      const sequence = after.sequence;
      await delay(250);
      const settled = await attemptRow(started.attemptId, ADA);
      assertEqual(settled.status, 'cancelled', 'terminal cancellation persists');
      assertEqual(settled.sequence, sequence, 'no late progress after action observes cancellation');
      return { terminal: settled.status, sequence, latePatches: 0 };
    } finally {
      await observer.close();
    }
  });

  await suite.check('idle response settles timed_out distinctly', async () => {
    const started = await startReply('timeout-1', 'time out');
    const result = await client.action(api.streamReply, {
      userId: ADA,
      args: {
        attemptId: started.attemptId,
        streamUrl: `${source.url}/slow`,
        method: 'GET',
        upstreamIdempotent: true,
      },
    });
    assert(result.ok, `timeout action envelope failed: ${JSON.stringify(result.diagnostic)}`);
    assertEqual(result.result.outcome, 'timed_out', 'action timeout settlement');
    assertEqual((await attemptRow(started.attemptId, ADA)).status, 'timed_out', 'durable timeout status');
  });

  await suite.check('GET transport failure and unkeyed POST ambiguity remain distinct', async () => {
    const failed = await startReply('failed-1', 'fail');
    const failedResult = await client.action(api.streamReply, {
      userId: ADA,
      args: {
        attemptId: failed.attemptId,
        streamUrl: `${source.url}/failed`,
        method: 'GET',
        upstreamIdempotent: true,
      },
    });
    assertEqual(failedResult.result.outcome, 'failed', 'GET failure settlement');
    assertEqual((await attemptRow(failed.attemptId, ADA)).status, 'failed', 'durable failed status');

    const ambiguous = await startReply('ambiguous-1', 'ambiguous');
    const ambiguousResult = await client.action(api.streamReply, {
      userId: ADA,
      args: {
        attemptId: ambiguous.attemptId,
        streamUrl: `${source.url}/ambiguous`,
        method: 'POST',
        upstreamIdempotent: false,
      },
    });
    assertEqual(ambiguousResult.result.outcome, 'ambiguous', 'POST ambiguity settlement');
    assertEqual((await attemptRow(ambiguous.attemptId, ADA)).status, 'ambiguous', 'durable ambiguous status');
    return { failed: 'failed', ambiguous: 'ambiguous' };
  });

  // @ref LLP 0076#author-decisions--2026-07-23 — decisions 2 and 3, authorized
  // for this fixture by protocol amendment v0.5: the authored row mirrors the
  // HOST-derived effect certainty read-only. Every one of these attempts
  // passed `initiation_possible` (the cancel and timeout legs observed
  // response metadata; the ambiguous leg lost transport after initiation), so
  // each terminal row must carry the effect-may-have-executed fact.
  await suite.check('terminal rows mirror the host-derived effect certainty', async () => {
    const facts = {};
    for (const [label, key] of [
      ['cancelled', 'cancel-1'],
      ['timed_out', 'timeout-1'],
      ['ambiguous', 'ambiguous-1'],
    ]) {
      const replayed = await startReply(key, 'reread');
      const row = await attemptRow(replayed.attemptId, ADA);
      assertEqual(row.status, label, `terminal status for ${key}`);
      assertEqual(
        row.effectMayHaveExecuted,
        true,
        `host certainty mirror for ${key} (initiation was host-provable)`
      );
      facts[label] = row.effectMayHaveExecuted;
    }
    return facts;
  });
}, {
  cleanups,
  reportExtra: {
    schemaVersion: 'snapback.competitive-checkpoint.local-streaming.v0',
    protocol: 'llp-0075-convex-checkpoint-v0',
    // Derived, never authored: the alias mistake recorded in
    // knownInstrumentDefects (hardcoded `local-ibex-sqlite.v1`) is structurally
    // unrepeatable because the receipt carries the served identity plus the
    // digest of the manifest it came from.
    targetProfile: servedIdentity.targetProfile,
    targetIdentitySource: servedIdentity.source,
    capabilityManifestSha256: servedIdentity.capabilityManifestSha256,
  },
  reportFile: join(here, '..', '..', 'acceptance', 'results', 'local-streaming.v0.json'),
});

async function deriveServedTargetIdentity(baseUrl) {
  const response = await fetch(`${baseUrl}/inspect`);
  if (!response.ok) {
    throw new Error(`GET /inspect failed: ${response.status}`);
  }
  const inspect = await response.json();
  const targetProfile = inspect?.targetProfileId ?? inspect?.capabilityManifest?.targetProfileId;
  if (typeof targetProfile !== 'string' || targetProfile.length === 0) {
    throw new Error('served /inspect payload carries no targetProfileId');
  }
  return {
    targetProfile,
    source: 'GET /inspect targetProfileId',
    capabilityManifestSha256: createHash('sha256')
      .update(JSON.stringify(inspect.capabilityManifest))
      .digest('hex'),
  };
}

async function startReply(idempotencyKey, content) {
  const result = await client.mutate(api.startReply, {
    userId: ADA,
    args: { conversationId, content, idempotencyKey },
  });
  return result.result;
}

async function attemptRow(attemptId, userId) {
  const rows = (await client.query(api.listMessages, {
    userId,
    args: { conversationId },
  })).rows;
  return rows.find((row) => row.attemptId === attemptId) ?? null;
}

async function observeAttempt(attemptId, conversationIdValue, userId, connectionId) {
  const initialRows = (await client.query(api.listMessages, {
    userId,
    args: { conversationId: conversationIdValue },
  })).rows;
  const stream = client.openLiveStream(connectionId);
  await stream.ready;
  const subscription = await client.subscribeLive(api.listMessages, {
    connectionId,
    userId,
    args: { conversationId: conversationIdValue },
  });
  return {
    attemptId,
    stream,
    subscriptionId: subscription.subscription_id,
    initialRows,
    close: async () => {
      await client.unsubscribeLive(api.listMessages, {
        connectionId,
        userId,
        subscriptionId: subscription.subscription_id,
      }).catch(() => {});
      await stream.close();
    },
  };
}

async function collectUntilTerminal(observer, attemptId, terminalStatus) {
  const rows = [];
  for (;;) {
    const update = await observer.stream.nextUpdate(10_000);
    if (update.subscription_id !== observer.subscriptionId) continue;
    const row = update.rows.find((candidate) => candidate.attemptId === attemptId);
    if (!row) continue;
    rows.push(row);
    if (row.status === terminalStatus) return rows;
  }
}

async function collectUntilSequence(observer, attemptId, minimum) {
  for (;;) {
    const update = await observer.stream.nextUpdate(10_000);
    if (update.subscription_id !== observer.subscriptionId) continue;
    const row = update.rows.find((candidate) => candidate.attemptId === attemptId);
    if (row && row.sequence >= minimum) return row;
  }
}

async function expectNoUpdate(stream, timeoutMs, message) {
  try {
    await stream.nextUpdate(timeoutMs);
  } catch (error) {
    if (/timed out waiting/.test(String(error.message))) return;
    throw error;
  }
  throw new Error(message);
}

async function startStreamSource() {
  const sockets = new Set();
  const expectedBody = Array.from({ length: 16 }, (_, index) => `chunk-${String(index).padStart(2, '0')}\n`).join('');
  const http = createServer(async (request, response) => {
    if (request.url === '/stream') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      for (let index = 0; index < 16; index += 1) {
        if (response.destroyed) return;
        response.write(`chunk-${String(index).padStart(2, '0')}\n`);
        await delay(80);
      }
      response.end();
      return;
    }
    if (request.url === '/slow') {
      response.writeHead(200, { 'content-type': 'application/octet-stream' });
      response.flushHeaders();
      await delay(6_000);
      if (!response.destroyed) response.end('late');
      return;
    }
    if (request.url === '/failed' || request.url === '/ambiguous') {
      request.socket.destroy();
      return;
    }
    response.writeHead(404).end();
  });
  http.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise((resolveListen, rejectListen) => {
    http.once('error', rejectListen);
    http.listen(0, '127.0.0.1', resolveListen);
  });
  const address = http.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    expectedBody,
    close: async () => {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolveClose) => http.close(resolveClose));
    },
  };
}
