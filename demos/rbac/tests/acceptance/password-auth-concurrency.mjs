#!/usr/bin/env node

import assert from 'node:assert/strict';

import {
  assertCredentialProjection,
  closeClients,
  createScratch,
  diagnosticCode,
  expectRefusal,
  publicClient,
  removeScratch,
  startRbacServer,
} from './password-auth-kit.mjs';

const scratch = await createScratch('snapback-password-concurrency-');
const clients = [];
let server = null;

// @ref LLP 0227#principal-binding-same-sessions-no-parallel-identity — racing
// verification must fence the exact credential and attempt-ledger predecessor;
// stale proof neither mints nor accounts a failure.

try {
  server = await startRbacServer({ scratch });

  const parallelEmail = 'parallel-signins@example.com';
  const parallelPassword = 'parallel-signins-password-123!';
  const signupClient = publicClient(server.baseUrl, 'parallel-signins-signup');
  clients.push(signupClient);
  const signup = await signupClient.client.authPasswordSignup({
    email: parallelEmail,
    password: parallelPassword,
  });
  assertCredentialProjection(signup, { recovery: true });
  await signupClient.client.authLogout();

  const signinClients = Array.from({ length: 6 }, (_, index) => (
    publicClient(server.baseUrl, `parallel-signin-${index}`)
  ));
  clients.push(...signinClients);
  const signins = await Promise.all(signinClients.map(({ client }) => (
    client.authPasswordSignIn({ email: parallelEmail, password: parallelPassword })
  )));
  assert.equal(new Set(signins.map(({ session }) => session.userId)).size, 1);
  assert.equal(new Set(signins.map(({ session }) => session.id)).size, signins.length);
  for (const signin of signins) assertCredentialProjection(signin);

  const changeEmail = 'parallel-changes@example.com';
  const originalPassword = 'parallel-changes-password-123!';
  const successorPasswords = [
    'parallel-changes-winner-a-456!',
    'parallel-changes-winner-b-789!',
  ];
  const changing = publicClient(server.baseUrl, 'parallel-change-acting');
  const competing = publicClient(server.baseUrl, 'parallel-change-competing');
  clients.push(changing, competing);
  const changeSignup = await changing.client.authPasswordSignup({
    email: changeEmail,
    password: originalPassword,
  });
  await competing.client.authPasswordSignIn({ email: changeEmail, password: originalPassword });
  const changes = await Promise.allSettled([
    changing.client.authPasswordChange({
      currentPassword: originalPassword,
      newPassword: successorPasswords[0],
    }),
    competing.client.authPasswordChange({
      currentPassword: originalPassword,
      newPassword: successorPasswords[1],
    }),
  ]);
  assert.equal(
    changes.filter(({ status }) => status === 'fulfilled').length,
    1,
    `parallel change outcomes: ${JSON.stringify(changes.map((outcome) => outcome.status === 'fulfilled' ? { status: outcome.status } : { status: outcome.status, code: diagnosticCode(outcome.reason), message: outcome.reason?.message }))}`,
  );
  assert.equal(changes.filter(({ status }) => status === 'rejected').length, 1);
  const rejectedChange = changes.find(({ status }) => status === 'rejected');
  assert(
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID', 'SNAPBACK_AUTH_SESSION_EXPIRED'].includes(
      diagnosticCode(rejectedChange.reason),
    ),
    `parallel change returned a non-uniform refusal: ${rejectedChange.reason}`,
  );
  const winningIndex = changes.findIndex(({ status }) => status === 'fulfilled');
  const winnerPassword = successorPasswords[winningIndex];
  const loserPassword = successorPasswords[1 - winningIndex];
  const winnerSignin = publicClient(server.baseUrl, 'parallel-change-winner-signin');
  const loserSignin = publicClient(server.baseUrl, 'parallel-change-loser-signin');
  const oldSignin = publicClient(server.baseUrl, 'parallel-change-old-password');
  clients.push(winnerSignin, loserSignin, oldSignin);
  assertCredentialProjection(await winnerSignin.client.authPasswordSignIn({
    email: changeEmail,
    password: winnerPassword,
  }));
  await expectRefusal(
    () => loserSignin.client.authPasswordSignIn({ email: changeEmail, password: loserPassword }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'losing parallel password change',
  );
  await expectRefusal(
    () => oldSignin.client.authPasswordSignIn({
      email: changeEmail,
      password: originalPassword,
    }),
    ['SNAPBACK_AUTH_CREDENTIAL_INVALID'],
    'predecessor password after parallel changes',
  );

  const raceOutcomes = [];
  for (let index = 0; index < 4; index += 1) {
    const email = `signin-change-race-${index}@example.com`;
    const predecessor = `signin-change-predecessor-${index}-123!`;
    const successor = `signin-change-successor-${index}-456!`;
    const actor = publicClient(server.baseUrl, `signin-change-actor-${index}`);
    const racer = publicClient(server.baseUrl, `signin-change-racer-${index}`);
    clients.push(actor, racer);
    await actor.client.authPasswordSignup({ email, password: predecessor });
    const [signinResult, changeResult] = await Promise.allSettled([
      racer.client.authPasswordSignIn({ email, password: predecessor }),
      actor.client.authPasswordChange({ currentPassword: predecessor, newPassword: successor }),
    ]);
    assert.equal(changeResult.status, 'fulfilled', `race ${index} password change lost unexpectedly`);
    if (signinResult.status === 'rejected') {
      assert.equal(diagnosticCode(signinResult.reason), 'SNAPBACK_AUTH_CREDENTIAL_INVALID');
      raceOutcomes.push('uniform-refusal');
    } else {
      let settled = null;
      let terminalCode = null;
      try {
        settled = await racer.client.authSession({ force: true });
      } catch (error) {
        terminalCode = diagnosticCode(error);
      }
      if (terminalCode !== null) {
        assert.equal(
          terminalCode,
          'SNAPBACK_AUTH_SESSION_EXPIRED',
          `race ${index} predecessor session returned a non-terminal result`,
        );
      } else {
        assert.notEqual(
          settled.authority?.isAuthenticated,
          true,
          `SNAPBACK_ACCEPTANCE_STALE_PASSWORD_FENCE_BROKEN: race ${index} predecessor-password signin succeeded and its minted session survived the password change`,
        );
      }
      raceOutcomes.push('linearized-before-change-then-revoked');
    }
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    row: 3,
    parallelSignins: signins.length,
    distinctParallelSessions: new Set(signins.map(({ session }) => session.id)).size,
    parallelChanges: { fulfilled: 1, refused: 1, winningIndex },
    signinChangeRaces: raceOutcomes,
    limitation: 'The public surface has no KDF rendezvous or authenticated attempt-ledger projection, so this witness cannot prove that a refusal happened specifically after predecessor KDF or that the stale refusal charged zero failures.',
  })}\n`);
} finally {
  await closeClients(clients);
  if (server) await server.stop();
  await removeScratch(scratch);
}
