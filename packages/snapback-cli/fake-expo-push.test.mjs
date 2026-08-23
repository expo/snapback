import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../demos/_kit/server-process.mjs';
import { SnapbackClient } from '../snapback-client/index.mjs';
import { attachPushRegistry } from '../snapback-client/push-registry.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../snapback-contract/index.mjs';
import { api } from './fixtures/push-seam/app/snapback/generated/api.mjs';
import { startFakeExpoPushService } from './fake-expo-push.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const generatedRoot = join(here, 'fixtures', 'push-seam', 'app', 'snapback', 'generated');

async function fixtureProtocolProof() {
  const fixture = await startFakeExpoPushService();
  try {
    fixture.enqueueTickets([
      'ok',
      { ticketError: 'DeviceNotRegistered' },
      { receiptError: 'DeviceNotRegistered' },
    ]);
    const send = await fetch(`${fixture.baseUrl}/--/api/v2/push/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([
        { to: 'ExponentPushToken[a]' },
        { to: 'ExponentPushToken[b]' },
        { to: 'ExponentPushToken[c]' },
      ]),
    });
    assert.equal(send.status, 200);
    const tickets = await send.json();
    assert.equal(tickets.data[0].status, 'ok');
    assert.equal(tickets.data[1].details.error, 'DeviceNotRegistered');
    assert.equal(tickets.data[2].status, 'ok');

    const receipts = await fetch(`${fixture.baseUrl}/--/api/v2/push/getReceipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [tickets.data[0].id, tickets.data[2].id] }),
    });
    const receiptBody = await receipts.json();
    assert.equal(receiptBody.data[tickets.data[0].id].status, 'ok');
    assert.equal(
      receiptBody.data[tickets.data[2].id].details.error,
      'DeviceNotRegistered',
    );

    fixture.enqueueSocketDrop();
    await assert.rejects(fetch(`${fixture.baseUrl}/--/api/v2/push/send`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify([{ to: 'ExponentPushToken[ambiguous]' }]),
    }));
    assert.deepEqual(fixture.sends.map((entry) => entry.planKind), ['tickets', 'socket-drop']);
    assert.deepEqual(fixture.receiptPolls, [{ ticketCount: 2 }]);
  } finally {
    await fixture.close();
  }
}

async function mintSession(server, appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage(),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    clientStoreId,
    // This proof owns the server-side push registry, handoff ledger, and
    // provider seam. Client RQS/outbox transition custody has an independent
    // conformance suite and must not preempt the push assertions here.
    rqsStore: null,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  return { client, coordinator, credential };
}

async function driveReceipts(server, nowMs) {
  const response = await fetch(`${server.baseUrl}/_snapback/api/push/maintenance`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-admin-token': server.adminToken,
    },
    body: JSON.stringify({ nowMs }),
  });
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.artifactKind, 'snapback.push-maintenance/v1');
}

async function seamAcceptanceProof() {
  const fixture = await startFakeExpoPushService();
  const scratch = await mkdtemp(join(tmpdir(), 'snapback-push-seam-'));
  const sessions = [];
  let server = null;
  try {
    const schema = JSON.parse(await readFile(join(generatedRoot, 'schema.manifest.json'), 'utf8'));
    const functions = JSON.parse(await readFile(join(generatedRoot, 'functions.manifest.json'), 'utf8'));
    const carrier = join(scratch, 'startup-artifacts.json');
    await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
      mode: 0o600,
    });
    server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      serverBinary: join(repoRoot, 'target', 'debug', 'snapback'),
      startupArtifacts: carrier,
      captureImpersonationCapability: true,
      env: {
        SNAPBACK_OUTBOUND_ACTIONS: '1',
        SNAPBACK_EXPO_PUSH_BASE_URL: fixture.baseUrl,
      },
    });

    const host = await mintSession(server, schema.appId, 'host@push-fixture.test', 'push-host');
    const guest = await mintSession(server, schema.appId, 'guest@push-fixture.test', 'push-guest');
    const outsider = await mintSession(server, schema.appId, 'outsider@push-fixture.test', 'push-outsider');
    sessions.push(host, guest, outsider);
    await host.client.mutate(api.joinAsHost, { args: {} });

    let installation = null;
    attachPushRegistry(guest.client, {
      pushInstallationStorage: {
        async read() { return installation; },
        async write(value) { installation = value; },
        async clear() { installation = null; },
      },
    });
    const guestId = guest.credential.session.userId;
    await guest.client.push.registerToken({ token: 'ExponentPushToken[fixture_success]' });

    const denied = await outsider.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'forged', body: 'forged', dedupeKey: 'forged-1',
      },
    });
    assert.equal(denied.ok, false);
    assert.equal(
      denied.diagnostic.code,
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      JSON.stringify(denied),
    );
    assert.equal(fixture.sends.length, 0, 'authorization refusal occurs before provider I/O');

    fixture.enqueueTickets(['ok']);
    const first = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'acceptance title', body: 'acceptance body', dedupeKey: 'ok-1',
      },
    });
    assert.equal(first.ok, true, JSON.stringify(first.diagnostic));
    assert.equal(first.result.state, 'handed-to-expo');
    assert.equal(first.result.targetCount, 1);
    const firstSendCount = fixture.sends.length;

    const duplicate = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'acceptance title', body: 'acceptance body', dedupeKey: 'ok-1',
      },
    });
    assert.equal(duplicate.result.deduplicated, true);
    assert.equal(fixture.sends.length, firstSendCount, 'same dedupe key performs no second handoff');

    let ledger = await host.client.query(api.pushLedger, {
      args: { intentId: first.result.intentId },
    });
    assert.equal(ledger.rows[0].messageState, 'handed-to-expo');
    const privateProjection = JSON.stringify(ledger.rows);
    assert(!privateProjection.includes('fixture_success'));
    assert(!privateProjection.includes('acceptance title'));
    assert(!privateProjection.includes('acceptance body'));
    assert(!privateProjection.includes('ok-1'));
    await driveReceipts(server, ledger.rows[0].handedToExpoAtMs + 900_001);
    ledger = await host.client.query(api.pushLedger, { args: { intentId: first.result.intentId } });
    assert.equal(ledger.rows[0].messageState, 'expo-accepted');
    assert.equal(ledger.rows[0].intentState, 'expo-accepted');

    fixture.enqueueTickets([{ ticketError: 'DeviceNotRegistered' }]);
    const ticketRetirement = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'ticket retirement', body: 'ticket retirement', dedupeKey: 'dnr-ticket',
      },
    });
    ledger = await host.client.query(api.pushLedger, {
      args: { intentId: ticketRetirement.result.intentId },
    });
    assert.equal(ledger.rows[0].expoErrorCode, 'DeviceNotRegistered');
    assert.equal(ledger.rows[0].retirementEffect, true);
    const afterTicketRetirement = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'no target', body: 'no target', dedupeKey: 'after-ticket-dnr',
      },
    });
    assert.equal(afterTicketRetirement.result.state, 'zero-target');
    assert.equal(afterTicketRetirement.result.targetCount, 0);

    await guest.client.push.registerToken({ token: 'ExponentPushToken[fixture_receipt_dnr]' });
    fixture.enqueueTickets([{ receiptError: 'DeviceNotRegistered' }]);
    const receiptRetirement = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'receipt retirement', body: 'receipt retirement', dedupeKey: 'dnr-receipt',
      },
    });
    ledger = await host.client.query(api.pushLedger, {
      args: { intentId: receiptRetirement.result.intentId },
    });
    await driveReceipts(server, ledger.rows[0].handedToExpoAtMs + 900_001);
    ledger = await host.client.query(api.pushLedger, {
      args: { intentId: receiptRetirement.result.intentId },
    });
    assert.equal(ledger.rows[0].messageState, 'expo-error');
    assert.equal(ledger.rows[0].expoErrorCode, 'DeviceNotRegistered');
    assert.equal(ledger.rows[0].retirementEffect, true);

    await guest.client.push.registerToken({ token: 'ExponentPushToken[fixture_ambiguous]' });
    fixture.enqueueSocketDrop();
    const ambiguous = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'ambiguous', body: 'ambiguous', dedupeKey: 'ambiguous-1',
      },
    });
    assert.equal(ambiguous.result.state, 'ambiguous');
    const ambiguousSendCount = fixture.sends.length;
    const ambiguousReplay = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'ambiguous', body: 'ambiguous', dedupeKey: 'ambiguous-1',
      },
    });
    assert.equal(ambiguousReplay.result.deduplicated, true);
    assert.equal(ambiguousReplay.result.state, 'ambiguous');
    await driveReceipts(server, Date.now() + 60_000);
    assert.equal(fixture.sends.length, ambiguousSendCount, 'ambiguous attempts are never auto-retried');

    fixture.enqueueTickets(['ok']);
    const explicitRedrive = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId],
        title: 'ambiguous',
        body: 'ambiguous',
        dedupeKey: 'ambiguous-1',
        redriveAmbiguous: true,
      },
    });
    assert.equal(explicitRedrive.result.attempt, 2);
    assert.equal(explicitRedrive.result.deduplicated, false);
    assert.equal(
      explicitRedrive.result.state,
      'ambiguous',
      'the intent chain keeps its unresolved predecessor ambiguity',
    );
    assert.equal(fixture.sends.length, ambiguousSendCount + 1);
    ledger = await host.client.query(api.pushLedger, {
      args: { intentId: ambiguous.result.intentId },
    });
    assert.equal(ledger.rows[0].attemptCount, 2);
    assert.equal(
      ledger.rows.find((row) => row.attemptNumber === 2).previousAmbiguous,
      true,
      'an explicit re-drive records the duplicate-delivery risk on its new attempt',
    );

    await guest.client.push.unregisterToken();
    const afterUnregister = await host.client.action(api.sendSelected, {
      args: {
        principalIds: [guestId], title: 'unregistered', body: 'unregistered', dedupeKey: 'after-unregister',
      },
    });
    assert.equal(afterUnregister.result.state, 'zero-target');
  } finally {
    await Promise.allSettled(sessions.map(({ coordinator }) => coordinator.close()));
    await server?.stop();
    await fixture.close();
    await rm(scratch, { recursive: true, force: true });
  }
}

await fixtureProtocolProof();
await seamAcceptanceProof();

console.log('fake-expo-push.test.mjs: shared fixture and full local seam acceptance passed');
