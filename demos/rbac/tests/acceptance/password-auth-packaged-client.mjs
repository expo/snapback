#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  api,
  assertCredentialProjection,
  closeClients,
  createScratch,
  passwordReadiness,
  publicClient,
  publicSurfaceDeclaration,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';
import {
  closeAcceptanceSession,
  TerminalAcceptanceWatchdog,
} from './owned-live-subscriptions.mjs';

const AUTH_CHURN_CLIENTS = 32;
const AUTH_CHURN_WATCHDOG_MS = 5 * 60_000;
const AUTH_CHURN_PHASE_WATCHDOG_MS = 20_000;
const AUTH_CHURN_TERMINAL_GRACE_MS = 10_000;

const scratch = await createScratch('snapback-password-packaged-client-');
const clients = [];
let server = null;
let activeChurnSession = null;
let activeChurnPhase = 'not-started';
let maximumChurnPhaseMs = 0;
let churnWatchdog = null;

const runChurnPhase = async (phase, operation) => {
  activeChurnPhase = phase;
  const startedAt = Date.now();
  const stall = new Error(
    `RBAC auth churn made no progress during ${phase} for ${AUTH_CHURN_PHASE_WATCHDOG_MS}ms`,
  );
  stall.code = 'SNAPBACK_RBAC_AUTH_CHURN_STALL';
  const timer = setTimeout(() => churnWatchdog.trigger(stall), AUTH_CHURN_PHASE_WATCHDOG_MS);
  timer.unref?.();
  try {
    return await operation();
  } finally {
    clearTimeout(timer);
    maximumChurnPhaseMs = Math.max(maximumChurnPhaseMs, Date.now() - startedAt);
  }
};

try {
  server = await startRbacServer({ scratch });
  const { readiness } = await passwordReadiness(server.baseUrl);
  const fixture = publicClient(server.baseUrl, 'password-packaged-client');
  clients.push(fixture);

  const email = 'packaged-client@example.com';
  const password = 'packaged-client-password-123!';
  const successor = 'packaged-client-password-456!';
  const signup = await fixture.client.authPasswordSignup({ email, password });
  assertCredentialProjection(signup, { recovery: true });
  await fixture.client.mutate(api.joinApp, { args: {} });
  await fixture.client.mutate(api.postAnnouncement, { args: { message: 'packaged client row' } });
  assert.deepEqual(
    (await fixture.client.query(api.listAnnouncements, { args: {} })).rows.map(({ message }) => message),
    ['packaged client row'],
  );

  await fixture.client.authLogout();
  const signin = await fixture.client.authPasswordSignIn({ email, password });
  assertCredentialProjection(signin);
  assert.equal(signin.session.userId, signup.session.userId);
  const changed = await fixture.client.authPasswordChange({
    currentPassword: password,
    newPassword: successor,
  });
  assertCredentialProjection(changed);
  assert.deepEqual(
    (await fixture.client.query(api.listAnnouncements, { args: {} })).rows.map(({ message }) => message),
    ['packaged client row'],
  );

  // A downstream acceptance runner repeatedly creates short-lived headless
  // clients against one backend. Keep that exact lifecycle here: authenticate,
  // mutate, attach realtime, then close the client without separately disposing
  // its live handle. closeAuth() owns that terminal drain.
  churnWatchdog = new TerminalAcceptanceWatchdog({
    deadlineMs: AUTH_CHURN_WATCHDOG_MS,
    terminalGraceMs: AUTH_CHURN_TERMINAL_GRACE_MS,
    onDeadline(error) {
      error.message += ` (stalled during ${activeChurnPhase})`;
      process.stderr.write(`${error.code}: ${error.message}\n`);
      const backendTail = server.outputTail({ lines: 80 });
      if (backendTail !== '') process.stderr.write(`backend trace:\n${backendTail}\n`);
      return Promise.allSettled([
        activeChurnSession === null
          ? Promise.resolve()
          : closeAcceptanceSession(activeChurnSession),
        server.stop(),
      ]);
    },
    onTerminal(error) {
      process.stderr.write(
        `${error.code}: ${error.message}; forced terminal exit after teardown grace\n`,
      );
      process.exit(124);
    },
  });
  for (let index = 0; index < AUTH_CHURN_CLIENTS; index += 1) {
    const churn = publicClient(server.baseUrl, `password-auth-churn-${index}`);
    clients.push(churn);
    activeChurnSession = { ...churn };
    await runChurnPhase(
      `client ${index + 1}/${AUTH_CHURN_CLIENTS}: password signin`,
      () => churn.client.authPasswordSignIn({ email, password: successor }),
    );
    await runChurnPhase(
      `client ${index + 1}/${AUTH_CHURN_CLIENTS}: mutation`,
      () => churn.client.mutate(api.postAnnouncement, {
        args: { message: `auth churn ${index}` },
      }),
    );
    await runChurnPhase(
      `client ${index + 1}/${AUTH_CHURN_CLIENTS}: realtime attach`,
      () => churn.client.liveQuery(api.listAnnouncements, {
        connectionId: `password-auth-churn-${index}`,
        args: {},
        transport: 'stream',
        fallbackToPoll: false,
      }),
    );
    await runChurnPhase(
      `client ${index + 1}/${AUTH_CHURN_CLIENTS}: closeAuth`,
      () => closeAcceptanceSession(activeChurnSession),
    );
    activeChurnSession = null;
  }
  activeChurnPhase = 'complete';
  await churnWatchdog.close();
  churnWatchdog = null;

  const exclusions = publicSurfaceDeclaration();
  assert.deepEqual(Object.values(exclusions), Array(Object.keys(exclusions).length).fill(false));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 6,
    packageImports: ['@expo/snapback-client', '@expo/snapback-contract'],
    clientMethods: [
      'authPasswordSignup',
      'authPasswordSignIn',
      'authPasswordChange',
      'authLogout',
      'query',
      'mutate',
    ],
    identifierModeObserved: readiness.identifierMode,
    protectedRows: 1,
    authChurnClients: AUTH_CHURN_CLIENTS,
    maximumAuthChurnPhaseMs: maximumChurnPhaseMs,
    exclusions,
  })}\n`);
} finally {
  if (churnWatchdog !== null) {
    try { await churnWatchdog.close(); } catch { /* preserve the primary failure */ }
  }
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}
