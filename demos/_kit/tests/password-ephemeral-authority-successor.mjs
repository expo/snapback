#!/usr/bin/env node

// Residual-3 real witness: an awaited password sign-in is immediately followed
// by protected ephemeral subscribe + publish, repeatedly, against one actual
// sessions server. The server's bounded room-authority race may remain visible
// on the raw HTTP carrier, but SNAPBACK_EPHEMERAL_AUTHORITY_PENDING must never
// cross the public client promise boundary.
//
// @ref LLP 0059#dated-amendment-total-client-authority-transition-state-and-settlement-matrix-2026-08-21-llp-0295-d02 — immediate post-sign-in ephemeral work absorbs the finite successor wait client-side.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../client.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../../packages/snapback-contract/auth-coordinator.mjs';

import { startServer } from '../server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..');
const generatedRoot = join(repoRoot, 'demos', 'pointing-room', 'snapback', 'generated');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const iterations = Number.parseInt(
  process.env.SNAPBACK_PASSWORD_EPHEMERAL_ITERATIONS ?? '200',
  10,
);
assert(Number.isSafeInteger(iterations) && iterations > 0 && iterations <= 1_000);

const schema = JSON.parse(readFileSync(join(generatedRoot, 'schema.manifest.json'), 'utf8'));
const functions = JSON.parse(readFileSync(join(generatedRoot, 'functions.manifest.json'), 'utf8'));
assert.equal(schema.auth.mode, 'sessions');
assert(
  schema.ephemeralCollections.some(({ name }) => name === 'roomPresence'),
  'pointing-room fixture must retain its sessions + ephemeral composition',
);

const scratch = mkdtempSync(join(tmpdir(), 'snapback-password-ephemeral-successor-'));
const carrier = join(scratch, 'startup-artifacts.json');
writeFileSync(
  carrier,
  `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
  { mode: 0o600 },
);

const server = await startServer({
  port: 0,
  db: ':memory:',
  cwd: repoRoot,
  startupArtifacts: carrier,
  serverBinary: runtimeBinary,
});
const storage = createMemoryAuthCustodyStorage({ state: { custody: {} } });
const coordinator = new AuthCoordinator({
  appId: schema.appId,
  storage,
  broadcastChannelFactory: null,
  hintStorage: null,
});
const client = new SnapbackClient(server.baseUrl, {
  authCoordinator: coordinator,
  clientStoreId: 'password-ephemeral-authority-successor',
  rqsStore: null,
  offlineQueue: false,
  reservationRetryJitterMilliseconds: [0, 0],
});

const realFetch = globalThis.fetch;
let rawAuthorityPending = 0;
let controlledPendingPath = null;
let controlledAuthorityPendingAbsorbed = 0;
let completed = 0;
const appVisiblePending = [];
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
  if (url.pathname === controlledPendingPath) {
    controlledPendingPath = null;
    controlledAuthorityPendingAbsorbed += 1;
    // Deterministic effect-free carrier control: the first attempt is held at
    // the same typed pre-registration/pre-publish boundary as the real
    // server's room-authority refusal. The bounded retry must then complete
    // against this actual sessions server before the app promise settles.
    return Response.json({
      diagnostic: {
        code: 'SNAPBACK_EPHEMERAL_AUTHORITY_PENDING',
        message: 'controlled real-server authority boundary is pending',
        details: {},
      },
    }, { status: 503 });
  }
  const response = await realFetch(input, init);
  if (response.status === 503 && url.pathname.startsWith('/ephemeral/')) {
    try {
      const body = await response.clone().json();
      if (body?.diagnostic?.code === 'SNAPBACK_EPHEMERAL_AUTHORITY_PENDING') {
        rawAuthorityPending += 1;
      }
    } catch {
      // The public operation remains the witness authority for malformed
      // diagnostics; raw counting is observational only.
    }
  }
  return response;
};

try {
  const email = `password-ephemeral-${process.pid}@example.com`;
  const password = 'password-ephemeral-successor-123!';
  await client.authPasswordSignup({ email, password });

  // Positive non-vacuity control. Both public operations consume one
  // deterministic pending refusal and then succeed through the real server;
  // the naturally occurring counter below remains purely observational.
  const controlledScope = { roomId: 'room_password_ephemeral_controlled_pending' };
  let controlledOverlay = null;
  try {
    controlledPendingPath = '/ephemeral/subscribe';
    controlledOverlay = await client.subscribeEphemeral('roomPresence', {
      connectionId: 'password-ephemeral-authority-successor',
      scope: controlledScope,
      transport: 'stream',
    });
    controlledPendingPath = '/ephemeral/publish';
    const controlledPublish = await controlledOverlay.publish({
      name: 'controlled-successor',
      picking: true,
    });
    assert.equal(typeof controlledPublish.entry_version, 'number');
    assert.equal(
      controlledAuthorityPendingAbsorbed,
      2,
      'the real-server control must positively exercise subscribe and publish absorption',
    );
  } finally {
    controlledPendingPath = null;
    if (controlledOverlay !== null) {
      await client.unsubscribeEphemeral('roomPresence', {
        connectionId: 'password-ephemeral-authority-successor',
        scope: controlledScope,
      }).catch(() => {});
      controlledOverlay.dispose();
    }
  }

  for (let index = 0; index < iterations; index += 1) {
    await client.authLogout();
    await client.authPasswordSignIn({ email, password });
    const scope = { roomId: `room_password_ephemeral_${index}` };
    let overlay = null;
    try {
      overlay = await client.subscribeEphemeral('roomPresence', {
        connectionId: 'password-ephemeral-authority-successor',
        scope,
        transport: 'stream',
      });
      const published = await overlay.publish({
        name: `successor-${index}`,
        picking: index % 2 === 0,
      });
      assert.equal(typeof published.entry_version, 'number');
      completed += 1;
    } catch (error) {
      const code = error?.diagnostic?.code ?? error?.code ?? null;
      if (code === 'SNAPBACK_EPHEMERAL_AUTHORITY_PENDING') {
        appVisiblePending.push(index);
      }
      throw error;
    } finally {
      if (overlay !== null) {
        await client.unsubscribeEphemeral('roomPresence', {
          connectionId: 'password-ephemeral-authority-successor',
          scope,
        }).catch(() => {});
        overlay.dispose();
      }
    }
  }

  assert.equal(completed, iterations);
  assert.deepEqual(
    appVisiblePending,
    [],
    'no awaited sign-in successor may expose EPHEMERAL_AUTHORITY_PENDING to app code',
  );
  assert.equal(client.authTerminalStatus().terminated, false);
  console.log(JSON.stringify({
    ok: true,
    witness: 'awaited-password-signin-immediate-ephemeral-subscribe-publish',
    iterations,
    completed,
    controlledAuthorityPendingAbsorbed,
    rawAuthorityPendingAbsorbed: rawAuthorityPending,
    appVisibleAuthorityPending: appVisiblePending.length,
  }));
} finally {
  globalThis.fetch = realFetch;
  await client.closeAuth();
  await coordinator.close();
  await server.stop();
  rmSync(scratch, { recursive: true, force: true });
}
