// @ref LLP 0075#stream-gate — the frozen 16-chunk source must become at least
// three authoritative commits observed by a second client with fallback off.
// @ref LLP 0076#author-decisions--2026-07-23 — decision 7: the gate-2 receipt
// is produced on LLP 0075's selected hosted target
// (single-instance-container-vm.v1), not the Cloudflare narrow proof.
//
// Remote twin of local-streaming.mjs: the same seven checks executed against a
// SERVED origin (one container-image Fly Machine behind the platform's
// TLS-terminating edge) instead of a locally spawned binary. The deterministic
// upstream source runs inside the machine on loopback
// (demos/competitive-checkpoint/acceptance/drill/stream-source.rs); its URL is
// ordinary action-argument data, exactly as in the local instrument.
//
// Required environment:
//   SNAPBACK_DRILL_ORIGIN       e.g. https://snapback-drill.fly.dev
//   SNAPBACK_DRILL_ADMIN_TOKEN  the machine's SNAPBACK_ADMIN_TOKEN secret
// Optional:
//   SNAPBACK_DRILL_SOURCE_URL   default http://127.0.0.1:4488 (machine-local)
//   SNAPBACK_DRILL_FLY_APP / SNAPBACK_DRILL_MACHINE_ID / SNAPBACK_DRILL_REGION
//                               provider identities recorded in the receipt
//
// The durable-row secret scan over the rows this run retains on the hosted
// target is a separate receipt (scan-durable-rows.mjs over an on-machine
// SQLite dump); this instrument's receipt records the run identity those scans
// bind to.

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { connect as tlsConnect } from 'node:tls';
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
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(readFileSync(join(backendDir, 'generated', name), 'utf8'));
const ADA = 'user_checkpoint_ada';
const GRACE = 'user_checkpoint_grace';

const origin = required('SNAPBACK_DRILL_ORIGIN');
const adminToken = required('SNAPBACK_DRILL_ADMIN_TOKEN');
const sourceBase = process.env.SNAPBACK_DRILL_SOURCE_URL ?? 'http://127.0.0.1:4488';

function required(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${name} is required to run the remote drill instrument`);
  }
  return value.replace(/\/+$/, '');
}

const client = new SnapbackClient(origin, { adminToken });
const tlsFacts = await probeTls(origin);
const servedIdentity = await deriveServedTargetIdentity(origin);
const suite = createSuite('competitive checkpoint / remote streamed actions (single-instance-container-vm.v1)', { expectedChecks: 7 });
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
      // @ref LLP 0065#3-common-pattern-contracts — the Accepted anti-probing
      // posture (protocol amendment v0.5): cross-user writes refuse with the
      // same code and body as a missing row.
      'SNAPBACK_ROW_NOT_FOUND',
      'other actor update must fail closed',
    );
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
          streamUrl: `${sourceBase}/stream`,
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
      const expectedBody = Array.from({ length: 16 }, (_, index) => `chunk-${String(index).padStart(2, '0')}\n`).join('');
      assertEqual(terminal.content, expectedBody, 'ordered streamed content');
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
          streamUrl: `${sourceBase}/stream`,
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
        streamUrl: `${sourceBase}/slow`,
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
        streamUrl: `${sourceBase}/failed`,
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
        streamUrl: `${sourceBase}/ambiguous`,
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
  // HOST-derived effect certainty read-only.
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
        `host certainty mirror for ${key} (initiation was host-provable)`,
      );
      facts[label] = row.effectMayHaveExecuted;
    }
    return facts;
  });
}, {
  reportExtra: {
    schemaVersion: 'snapback.competitive-checkpoint.remote-streaming.v0',
    protocol: 'llp-0075-convex-checkpoint-v0',
    adapterProfile: 'single-instance-container-vm.v1',
    // Derived, never authored (protocol amendment v0.1): the served instance
    // identity plus the digest of the manifest it came from. The adapter
    // profile above is the control-plane drill identity (LLP 0072/0075); the
    // served instance manifest keeps its own truthful identity.
    targetProfile: servedIdentity.targetProfile,
    targetIdentitySource: servedIdentity.source,
    capabilityManifestSha256: servedIdentity.capabilityManifestSha256,
    servedOrigin: origin,
    upstreamSource: `${sourceBase} (machine-loopback; never exposed through the edge)`,
    provider: {
      name: 'fly.io',
      app: process.env.SNAPBACK_DRILL_FLY_APP ?? null,
      machineId: process.env.SNAPBACK_DRILL_MACHINE_ID ?? null,
      region: process.env.SNAPBACK_DRILL_REGION ?? null,
    },
    tls: tlsFacts,
    authPosture: {
      mode: 'dev (client-asserted, drill fixture identities)',
      serverProfile: 'test',
      nonLoopbackDevAuthOverride: true,
      note: 'plaintext non-loopback bind behind the platform TLS edge; --allow-insecure-dev-auth is the recorded drill posture, refused by the prod profile',
    },
  },
  reportFile: join(here, '..', '..', 'acceptance', 'results', 'remote-streaming.v0.json'),
});

async function probeTls(originUrl) {
  const url = new URL(originUrl);
  if (url.protocol !== 'https:') {
    return { transport: url.protocol.replace(':', ''), verified: false };
  }
  const port = Number(url.port || 443);
  return await new Promise((resolveProbe, rejectProbe) => {
    const socket = tlsConnect({ host: url.hostname, port, servername: url.hostname }, () => {
      const certificate = socket.getPeerCertificate();
      const facts = {
        transport: 'https',
        verified: socket.authorized === true,
        protocol: socket.getProtocol(),
        servername: url.hostname,
        subject: certificate.subject?.CN ?? null,
        issuer: certificate.issuer?.O ?? certificate.issuer?.CN ?? null,
        subjectaltname: certificate.subjectaltname ?? null,
        validFrom: certificate.valid_from ?? null,
        validTo: certificate.valid_to ?? null,
        fingerprint256: certificate.fingerprint256 ?? null,
      };
      socket.end();
      resolveProbe(facts);
    });
    socket.on('error', rejectProbe);
    socket.setTimeout(10_000, () => {
      socket.destroy();
      rejectProbe(new Error('TLS probe timed out'));
    });
  });
}

async function deriveServedTargetIdentity(baseUrl) {
  const response = await fetch(`${baseUrl}/inspect`, {
    headers: { 'x-snapback-admin-token': adminToken },
  });
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
    source: 'GET /inspect targetProfileId (admin-authenticated on the non-loopback bind)',
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
    const update = await observer.stream.nextUpdate(20_000);
    if (update.subscription_id !== observer.subscriptionId) continue;
    const row = update.rows.find((candidate) => candidate.attemptId === attemptId);
    if (!row) continue;
    rows.push(row);
    if (row.status === terminalStatus) return rows;
  }
}

async function collectUntilSequence(observer, attemptId, minimum) {
  for (;;) {
    const update = await observer.stream.nextUpdate(20_000);
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
