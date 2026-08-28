// LLP 0317 O29 reproduction: same-mode provisioning currently accepts a
// defineAuth minimumLength successor while the live provider silently retains
// its predecessor bound. A backend restart (without a store reset) then
// activates the successor policy, as LLP 0227 requires.
//
// @ref LLP 0227#password-policy-declaration — password admission consumes
// the exact startup declaration; changing this boot-time policy requires a
// backend restart, not a store reset or catalog migration.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { __startServerForTests } from '../../demos/_kit/server-process.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(here, '..', '..');
const defineUrl = pathToFileURL(join(
  repositoryRoot,
  'packages',
  'snapback-codegen',
  'define.mjs',
)).href;
const serverBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(repositoryRoot, 'target', 'debug', 'snapback'),
);
const scratch = await mkdtemp(join(tmpdir(), 'snapback-auth-policy-successor-'));
const backendRoot = join(scratch, 'snapback');
const databasePath = join(scratch, 'app.sqlite3');
const startupArtifacts = join(scratch, 'startup-artifacts.json');
let server = null;
let runtimeBinary = null;

async function generateCarrier(minimumLength) {
  await writeFile(join(backendRoot, 'schema.mjs'), `
import { defineAuth, defineSchema } from '${defineUrl}';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
      minimumLength: ${minimumLength},
    },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});

export default defineSchema({}, { auth: { mode: 'sessions' }, authProgram });
`);
  await writeFile(join(backendRoot, 'functions.mjs'), 'export {};\n');
  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const schema = JSON.parse(await readFile(
    join(backendRoot, 'generated', 'schema.manifest.json'),
    'utf8',
  ));
  const functions = JSON.parse(await readFile(
    join(backendRoot, 'generated', 'functions.manifest.json'),
    'utf8',
  ));
  const apiEnvelope = JSON.parse(await readFile(
    join(backendRoot, 'generated', 'api-envelope.members.json'),
    'utf8',
  ));
  assert.equal(schema.auth.passwordMinimumLength, minimumLength);
  await writeFile(
    startupArtifacts,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );
  return { schema, functions, apiEnvelope };
}

async function start() {
  server = await __startServerForTests({
    port: 0,
    db: databasePath,
    cwd: repositoryRoot,
    startupArtifacts,
    serverBinary,
  });
  const healthResponse = await fetch(`${server.baseUrl}/health`);
  assert.equal(healthResponse.status, 200);
  const health = await healthResponse.json();
  assert.equal(health.ok, true, JSON.stringify(health));
  assert.match(health.binary?.gitCommit ?? '', /^[0-9a-f]{40}$/u);
  assert.equal(health.binary?.gitDirty, false, JSON.stringify(health.binary));
  if (runtimeBinary === null) {
    runtimeBinary = {
      gitCommit: health.binary.gitCommit,
      gitDirty: health.binary.gitDirty,
    };
  } else {
    assert.equal(health.binary.gitCommit, runtimeBinary.gitCommit);
    assert.equal(health.binary.gitDirty, runtimeBinary.gitDirty);
  }
}

async function stop() {
  await server?.stop();
  server = null;
}

async function passwordRequest(operation, email, password) {
  const response = await fetch(`${server.baseUrl}/auth/password/${operation}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-snapback-auth-client-protocol': '1',
      'x-snapback-authority-descriptor-protocol': '1',
    },
    body: JSON.stringify({ email, password }),
  });
  return { response, body: await response.json() };
}

try {
  await mkdir(backendRoot, { recursive: true });
  const predecessor = await generateCarrier(8);
  await start();
  const refusedBelowPredecessor = await passwordRequest(
    'signup',
    'below-predecessor-policy@example.com',
    'seven!!',
  );
  assert.equal(
    refusedBelowPredecessor.response.status,
    400,
    JSON.stringify(refusedBelowPredecessor.body),
  );
  assert.equal(
    refusedBelowPredecessor.body.diagnostic?.code,
    'SNAPBACK_AUTH_PASSWORD_POLICY',
  );
  assert.equal(refusedBelowPredecessor.body.diagnostic?.details?.minimumLength, 8);

  const predecessorEmail = 'predecessor-policy@example.com';
  const predecessorPassword = 'ten-chars!';
  const acceptedByPredecessor = await passwordRequest(
    'signup',
    predecessorEmail,
    predecessorPassword,
  );
  assert.equal(
    acceptedByPredecessor.response.status,
    200,
    JSON.stringify(acceptedByPredecessor.body),
  );

  const successor = await generateCarrier(20);
  assert.equal(successor.schema.appId, predecessor.schema.appId, 'successor changed app identity');
  assert.notEqual(
    successor.schema.schemaHash,
    predecessor.schema.schemaHash,
    'successor kept schema identity',
  );
  const admin = new SnapbackClient(server.baseUrl, {
    adminToken: server.adminToken,
    rqsStore: null,
  });
  try {
    const provision = await admin.ensureApp({
      intent: 'provision',
      requestedMode: 'sessions',
      schema: successor.schema,
      functions: successor.functions,
      apiEnvelope: successor.apiEnvelope,
    });
    assert.equal(provision.schema, 'provisioned', JSON.stringify(provision));
  } finally {
    await admin.closeAuth();
  }

  const refusedBelowPredecessorAfterProvision = await passwordRequest(
    'signup',
    'below-predecessor-policy-after-provision@example.com',
    'seven!!',
  );
  assert.equal(
    refusedBelowPredecessorAfterProvision.response.status,
    400,
    JSON.stringify(refusedBelowPredecessorAfterProvision.body),
  );
  assert.equal(
    refusedBelowPredecessorAfterProvision.body.diagnostic?.code,
    'SNAPBACK_AUTH_PASSWORD_POLICY',
  );
  assert.equal(
    refusedBelowPredecessorAfterProvision.body.diagnostic?.details?.minimumLength,
    8,
  );

  const silentlyAcceptedAfterProvision = await passwordRequest(
    'signup',
    'successor-live-short-policy@example.com',
    'ten-chars!',
  );
  assert.equal(
    silentlyAcceptedAfterProvision.response.status,
    200,
    `same-mode provisioning stopped reproducing O29: ${JSON.stringify(silentlyAcceptedAfterProvision.body)}`,
  );

  // The design supports a restart-bound policy change. Restarting on the
  // already-provisioned successor carrier must apply it without resetting the
  // database or auth catalog.
  await stop();
  await start();
  const predecessorSignInAfterRestart = await passwordRequest(
    'signin',
    predecessorEmail,
    predecessorPassword,
  );
  assert.equal(
    predecessorSignInAfterRestart.response.status,
    200,
    `predecessor account did not survive restart: ${JSON.stringify(predecessorSignInAfterRestart.body)}`,
  );

  const refusedBySuccessor = await passwordRequest(
    'signup',
    'successor-restarted-short-policy@example.com',
    'ten-chars!',
  );
  assert.equal(refusedBySuccessor.response.status, 400, JSON.stringify(refusedBySuccessor.body));
  assert.equal(refusedBySuccessor.body.diagnostic?.code, 'SNAPBACK_AUTH_PASSWORD_POLICY');
  assert.equal(refusedBySuccessor.body.diagnostic?.details?.minimumLength, 20);

  const acceptedBySuccessor = await passwordRequest(
    'signup',
    'successor-long-policy@example.com',
    'twenty-characters-ok!',
  );
  assert.equal(
    acceptedBySuccessor.response.status,
    200,
    JSON.stringify(acceptedBySuccessor.body),
  );

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.auth-password-policy-successor.v1',
    ok: true,
    predecessorMinimumLength: 8,
    successorMinimumLength: 20,
    predecessorMinimumActivelyEnforcedAfterProvision: true,
    liveSuccessorSilentlyRetainedPredecessor: true,
    predecessorAccountSurvivedRestart: true,
    shortPasswordSuccessorCode: refusedBySuccessor.body.diagnostic.code,
    storeReset: false,
    runtimeBinary,
  })}\n`);
} finally {
  await stop();
  await rm(scratch, { recursive: true, force: true });
}
