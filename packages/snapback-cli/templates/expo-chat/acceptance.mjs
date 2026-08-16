import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createSnapbackAppClient } from '@expo/snapback-client';
import { runExpoDev } from '@expo/snapback-cli/expo-dev';
import {
  createSnapbackExpoBoot,
  createSupervisedExpoEnvironment,
} from '@expo/snapback-expo';
import {
  createSnapbackReactProvider,
  observeSnapbackSurface,
  skip,
} from '@expo/snapback-react';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

// @ref LLP 0010#test-surfaces-and-harness — the generated default test owns
// a real isolated server, drives the product client, and cannot report a
// vacuous success. Static scaffold coherence lives in acceptance.static.mjs.

const EXPECTED_CHECKS = Object.freeze([
  'zero-config-supervised-connect',
  'managed-lifecycle',
  'anonymous-ready',
  'password-signup-recovery',
  'password-signout',
  'password-signin',
  'artifact-identity',
  'membership-and-conversation-shape',
  'test-persona-membership-switch',
  'surface-query',
  'surface-mutation-and-observation',
  'reply-and-observation',
  'reaction-and-observation',
]);
const MAX_CHILD_OUTPUT_BYTES = 64 * 1024;
const CONVERSATION_ID = 'conversation_engine_room';
const root = resolve(import.meta.dirname);
const stateRoot = mkdtempSync(join(tmpdir(), 'snapback-expo-chat-acceptance-'));
const readyFile = join(stateRoot, 'dev.ready.json');
const database = join(stateRoot, 'dev.sqlite3');
const executable = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'snapback.cmd' : 'snapback',
);

let stdout = '';
let stderr = '';
let stdoutRemainder = '';
const lifecycleEvents = [];
const checks = [];
const cleanup = {
  attempted: false,
  clientResourcesReleased: false,
  devExited: false,
  temporaryStateRemoved: false,
  ok: false,
};
let failure = null;
let surface = null;
let provider = null;
let client = null;
let appClient = null;
let childSpawnError = null;
let child = null;

const appendBounded = (current, chunk) =>
  `${current}${chunk.toString('utf8')}`.slice(-MAX_CHILD_OUTPUT_BYTES);

const startManagedChild = () => {
  child = spawn(executable, [
    'dev', 'snapback', '--db', database, '--ready-file', readyFile,
  ], {
    cwd: root,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString('utf8');
    stdout = appendBounded(stdout, chunk);
    stdoutRemainder = `${stdoutRemainder}${text}`.slice(-MAX_CHILD_OUTPUT_BYTES);
    for (;;) {
      const newline = stdoutRemainder.indexOf('\n');
      if (newline === -1) break;
      const line = stdoutRemainder.slice(0, newline).trim();
      stdoutRemainder = stdoutRemainder.slice(newline + 1);
      if (!line) continue;
      try {
        const event = JSON.parse(line);
        if (event?.schemaVersion === 'snapback.dev.v1') lifecycleEvents.push(event);
      } catch {
        // Non-event output is retained only in the bounded failure diagnostic.
      }
    }
  });
  child.stderr.on('data', (chunk) => { stderr = appendBounded(stderr, chunk); });
  child.on('error', (error) => { childSpawnError = error; });
};

const waitForApplicationReady = async () => {
  // @ref LLP 0224#phases — Phase 1 proof: the harness waits on the application-readiness receipt; the first authority-bearing call runs un-retried.
  const waiter = spawn(executable, [
    'wait', '--ready-file', readyFile,
    '--level', 'application', '--timeout-ms', '60000',
  ], {
    cwd: root,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let waitStdout = '';
  let waitStderr = '';
  waiter.stdout.on('data', (chunk) => { waitStdout = appendBounded(waitStdout, chunk); });
  waiter.stderr.on('data', (chunk) => { waitStderr = appendBounded(waitStderr, chunk); });
  const exit = await new Promise((resolveExit, reject) => {
    waiter.once('error', reject);
    waiter.once('close', (code, signal) => resolveExit({ code, signal }));
  });
  let envelope = null;
  try { envelope = JSON.parse(waitStdout); } catch {}
  if (exit.code !== 0) {
    throw new Error(
      `application readiness wait failed (${exit.code ?? exit.signal}): ${JSON.stringify(envelope?.diagnostics ?? waitStdout.trim())}${waitStderr ? `\n${waitStderr}` : ''}`,
    );
  }
  assert.equal(envelope?.ok, true, `application readiness wait returned an invalid envelope: ${waitStdout}`);
};

const until = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childSpawnError) throw childSpawnError;
    if (child === null) throw new Error(`${label}: managed dev was not started`);
    const value = await predicate();
    if (value) return value;
    if (child.exitCode !== null) {
      throw new Error(`${label}: dev exited ${child.exitCode}\n${stdout}\n${stderr}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label}: timed out\n${stdout}\n${stderr}`);
};

const pass = (id, details = null) => {
  assert.equal(EXPECTED_CHECKS[checks.length], id, `unexpected acceptance check order: ${id}`);
  checks.push({ id, status: 'passed', details });
};

const waitForExit = async (timeoutMs) => {
  if (child === null) return true;
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return child.exitCode !== null || child.signalCode !== null;
};

const snapshotEnvFiles = (directory) => {
  const files = {};
  const visit = (current, prefix = '') => {
    const entries = readdirSync(current, { withFileTypes: true })
      .sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const path = join(current, entry.name);
      const relativePath = join(prefix, entry.name);
      if (entry.isDirectory()) {
        visit(path, relativePath);
      } else if (/^\.env/u.test(entry.name)) {
        files[relativePath] = readFileSync(path).toString('base64');
      }
    }
  };
  visit(directory);
  return files;
};

// @ref LLP 0223#design-detail — the scaffold itself proves the supervised
// process carrier, Sessions readiness, transient descriptor, and app round trip.
const runZeroConfigSupervisedConnect = async () => {
  const supervisedReadyFile = join(stateRoot, 'supervised.ready.json');
  const supervisedDatabase = join(stateRoot, 'supervised.sqlite3');
  const supervisorDescriptor = join(stateRoot, 'expo-supervisor.json');
  const metroScript = join(stateRoot, 'headless-metro.mjs');
  const environmentBefore = snapshotEnvFiles(root);
  const events = [];
  writeFileSync(metroScript, `
import { createServer } from 'node:http';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const supervisorOrigin = process.env.EXPO_PUBLIC_SNAPBACK_SUPERVISOR_ORIGIN;
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true, supervisorOrigin }));
});
server.listen(port, '127.0.0.1');
const stop = () => server.close(() => process.exit(0));
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
`);

  let supervisor = null;
  let roundTripBoot = null;
  let details = null;
  try {
    supervisor = await runExpoDev({
      backendDirectory: join(root, 'snapback'),
      projectRoot: root,
      expoDirectory: root,
      readyFile: supervisedReadyFile,
      database: supervisedDatabase,
      platform: 'ios',
      email: 'zero-config@expo-chat.test',
      metroCommand: { command: process.execPath, args: [metroScript] },
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent(event) { events.push(event); },
    });
    assert.equal(supervisor.state, 'ready');
    assert.equal(supervisor.connectCarrier, 'supervisor-rendezvous');
    const readiness = events.find((event) => event.state === 'ready');
    assert(readiness, 'supervised acceptance must observe the final readiness event');
    assert.equal(readiness.connectCarrier, 'supervisor-rendezvous');
    assert.equal(readiness.authority.status, 'ready');
    assert.equal(readiness.authority.authMode, 'sessions');
    assert.deepEqual(snapshotEnvFiles(root), environmentBefore);
    assert.equal(existsSync(supervisorDescriptor), true);
    assert.equal(statSync(supervisorDescriptor).mode & 0o777, 0o600);

    const metroResponse = await fetch(supervisor.metroOrigin);
    assert.equal(metroResponse.ok, true);
    const metroFacts = await metroResponse.json();
    assert.equal(metroFacts.supervisorOrigin, readiness.bootstrap.origin);

    const environment = createSupervisedExpoEnvironment({
      exchangeOrigin: readiness.bootstrap.origin,
      bindingCache: null,
      appState: {
        currentState: 'active',
        addEventListener() { return { remove() {} }; },
      },
    });
    roundTripBoot = createSnapbackExpoBoot({ app, environment });
    const bootState = await roundTripBoot.start();
    assert.equal(bootState.status, 'ready');
    assert.equal(bootState.binding.source, 'supervised-dev');
    assert.equal(bootState.binding.target.origin, readiness.binding.target.origin);
    const roundTripClient = roundTripBoot.appClient().client;
    const before = (await roundTripClient.query(api.messagesForConversation, {
      args: { conversationId: CONVERSATION_ID },
    })).rows;
    const body = `Zero-config supervised acceptance ${process.pid}`;
    const mutation = await roundTripClient.mutate(api.sendMessage, {
      args: {
        conversationId: CONVERSATION_ID,
        senderId: 'user_ada',
        body,
      },
      clientMutationId: `zero-config-supervised-${process.pid}`,
    });
    assert.equal(typeof mutation.result, 'string');
    const after = (await roundTripClient.query(api.messagesForConversation, {
      args: { conversationId: CONVERSATION_ID },
    })).rows;
    assert.equal(before.some((row) => row.text === body), false);
    assert(after.some((row) => row._id === mutation.result && row.text === body));
    details = {
      connectCarrier: readiness.connectCarrier,
      authMode: readiness.authority.authMode,
      queryFunctionId: api.messagesForConversation.id,
      mutationFunctionId: api.sendMessage.id,
      descriptorMode: '0600',
    };
  } finally {
    await roundTripBoot?.dispose();
    await supervisor?.close();
  }
  assert.deepEqual(snapshotEnvFiles(root), environmentBefore);
  assert.equal(existsSync(supervisorDescriptor), false);
  return details;
};

try {
  pass('zero-config-supervised-connect', await runZeroConfigSupervisedConnect());
  startManagedChild();
  await waitForApplicationReady();
  if (childSpawnError) throw childSpawnError;
  const ready = JSON.parse(readFileSync(readyFile, 'utf8'));
  assert.equal(ready.ready, true);
  pass('managed-lifecycle', {
    owned: true,
    applicationReadyObserved: true,
    waitLevel: 'application',
    firstQueryRetries: 0,
  });

  const now = Date.now();
  const binding = Object.freeze({
    format: 'snapback.app-binding.v1',
    source: 'supervised-dev',
    descriptorIdentity: app.identity.descriptor,
    target: Object.freeze({
      app: app.identity.app,
      schema: app.identity.schema,
      functions: app.identity.functions,
      origin: ready.serverUrl,
      routing: 'loopback',
    }),
    capabilities: Object.freeze({
      offered: Object.freeze([...new Set([
        ...app.capabilities.required,
        'auth.passwords',
      ])].sort()),
    }),
    provenance: Object.freeze({
      supervisorGeneration: `expo-chat-acceptance-${process.pid}`,
      issuedAt: new Date(now - 60_000).toISOString(),
      expiresAt: new Date(now + 60 * 60_000).toISOString(),
    }),
    integrity: Object.freeze({ channel: 'local-supervised-ipc' }),
  });
  appClient = await createSnapbackAppClient({
    app,
    binding,
    platform: 'memory',
    now: () => now,
  });
  client = appClient.client;
  assert.equal(appClient.bootstrapState().status, 'ready');
  assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
  pass('anonymous-ready', { custody: appClient.bootstrapState().custody.carrier });

  const identity = `expo-chat-${process.pid}@example.com`;
  const password = 'expo-chat-password';
  const signup = await appClient.auth.signUpWithPassword({ email: identity, password });
  assert.equal(signup.recoveryCodes.length, 8);
  assert.equal(Object.hasOwn(signup, 'token'), false);
  assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
  pass('password-signup-recovery', { recoveryCodeCount: signup.recoveryCodes.length });
  await appClient.auth.signOut();
  assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
  pass('password-signout');
  const signin = await appClient.auth.signInWithPassword({ email: identity, password });
  assert.equal(Object.hasOwn(signin, 'recoveryCodes'), false);
  assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
  pass('password-signin', { userId: signin.session.userId });
  const conversationRows = (await client.query(api.conversations, { args: {} })).rows;
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.appId, artifacts.appId);
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  pass('artifact-identity', {
    appId: artifacts.appId,
    bundleHash: artifacts.bundleHash,
  });

  const adaMemberships = (await client.query(api.membershipsForUser, {
    args: { userId: 'user_ada' },
  })).rows;
  assert.deepEqual(new Set(conversationRows.map((row) => row.kind)), new Set(['dm', 'group']));
  assert.deepEqual(
    new Set(adaMemberships.map((row) => row.conversationId)),
    new Set(['conversation_ada_grace', 'conversation_ada_alan', CONVERSATION_ID]),
  );
  pass('membership-and-conversation-shape', {
    conversationKinds: [...new Set(conversationRows.map((row) => row.kind))].sort(),
    adaConversationCount: adaMemberships.length,
  });

  const graceMemberships = (await client.query(api.membershipsForUser, {
    args: { userId: 'user_grace' },
  })).rows;
  const katherineMemberships = (await client.query(api.membershipsForUser, {
    args: { userId: 'user_katherine' },
  })).rows;
  assert.notDeepEqual(
    graceMemberships.map((row) => row.conversationId).sort(),
    katherineMemberships.map((row) => row.conversationId).sort(),
  );
  assert.deepEqual(katherineMemberships.map((row) => row.conversationId), [CONVERSATION_ID]);
  pass('test-persona-membership-switch', {
    graceConversationCount: graceMemberships.length,
    katherineConversationCount: katherineMemberships.length,
  });

  const preparedBinding = await client.prepareReactBinding({ generatedManifest: app });
  provider = createSnapbackReactProvider(preparedBinding, {
    connectionId: 'expo_chat_acceptance',
  });
  let latest = null;
  surface = observeSnapbackSurface(
    provider,
    app.surfaces.conversation,
    { conversationId: CONVERSATION_ID },
    { presence: { typing: skip } },
    (snapshot) => { latest = snapshot; },
  );
  await until(
    () => latest?.state.messages.status === 'ready'
      && latest?.state.memberships.status === 'ready'
      && latest?.state.reactions.status === 'ready'
      && (latest.data.messages?.length ?? 0) >= 3
      && latest.data.details?.[0]?.title === 'Engine Room',
    'initial conversation surface reads',
  );
  pass('surface-query', {
    surface: 'conversation',
    messageRows: latest.data.messages.length,
    membershipRows: latest.data.memberships?.length ?? 0,
    reactionRows: latest.data.reactions?.length ?? 0,
    userRows: latest.data.users?.length ?? 0,
  });

  // Sessions mode derives caller identity from the minted session. sendMessage
  // is the same generated function the surface's send command commits through;
  // the live echo below is observed through the surface, not re-queried.
  const text = `Generated acceptance ${process.pid}`;
  const mutation = await client.mutate(api.sendMessage, {
    args: { conversationId: CONVERSATION_ID, senderId: 'user_ada', body: text },
    clientMutationId: `generated-acceptance-${process.pid}`,
  });
  assert.equal(typeof mutation.result, 'string');
  await until(
    () => latest?.state.messages.status === 'ready'
      && latest.data.messages.some((row) => row.text === text),
    'conversation surface mutation observation',
  );
  pass('surface-mutation-and-observation', {
    functionId: api.sendMessage.id,
    observedBy: api.messagesForConversation.id,
  });

  const replyText = `Reply acceptance ${process.pid}`;
  const reply = await client.mutate(api.sendReply, {
    args: {
      conversationId: CONVERSATION_ID,
      senderId: 'user_grace',
      text: replyText,
      replyToId: mutation.result,
    },
    clientMutationId: `generated-reply-acceptance-${process.pid}`,
  });
  assert.equal(typeof reply.result?.messageId, 'string');
  await until(
    () => latest?.data.messages?.some(
      (row) => row._id === reply.result.messageId
        && row.replyToId === mutation.result
        && row.text === replyText,
    ),
    'reply pointer surface observation',
  );
  pass('reply-and-observation', {
    functionId: api.sendReply.id,
    observedBy: api.messagesForConversation.id,
  });

  const reaction = await client.mutate(api.addReaction, {
    args: {
      conversationId: CONVERSATION_ID,
      messageId: reply.result.messageId,
      userId: 'user_ada',
      emoji: '✅',
    },
    clientMutationId: `generated-reaction-acceptance-${process.pid}`,
  });
  assert.equal(typeof reaction.result?.reactionId, 'string');
  await until(
    () => latest?.data.reactions?.some(
      (row) => row._id === reaction.result.reactionId
        && row.messageId === reply.result.messageId
        && row.emoji === '✅',
    ),
    'reaction surface observation',
  );
  pass('reaction-and-observation', {
    functionId: api.addReaction.id,
    observedBy: api.reactionsForConversation.id,
  });
} catch (error) {
  failure = {
    code: error?.diagnostic?.code ?? error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_FAILED',
    message: String(error?.message ?? error).slice(0, 4_096),
  };
} finally {
  cleanup.attempted = true;
  try {
    await surface?.dispose();
    surface = null;
    await provider?.dispose();
    if (provider) {
      assert.deepEqual(
        {
          stores: provider.inspection().stores,
          consumers: provider.inspection().consumers,
          subscriptions: provider.inspection().serverSubscriptions,
          leases: provider.inspection().leases,
          timers: provider.inspection().timers,
          listeners: provider.inspection().listeners,
        },
        { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
      );
    }
    if (client) assert.equal((await client.inspect()).subscriptions.length, 0);
    await appClient?.dispose();
    appClient = null;
    cleanup.clientResourcesReleased = true;
  } catch (error) {
    failure ??= {
      code: error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: String(error?.message ?? error).slice(0, 4_096),
    };
  }

  if (child !== null && child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (!(await waitForExit(10_000))) child?.kill('SIGKILL');
  cleanup.devExited = await waitForExit(5_000);
  if (!cleanup.devExited) {
    failure ??= {
      code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: 'managed dev process did not exit during bounded cleanup',
    };
  }
  try {
    rmSync(stateRoot, { recursive: true, force: true });
    cleanup.temporaryStateRemoved = !existsSync(stateRoot);
  } catch (error) {
    failure ??= {
      code: 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: String(error?.message ?? error).slice(0, 4_096),
    };
  }
  cleanup.ok = cleanup.clientResourcesReleased
    && cleanup.devExited
    && cleanup.temporaryStateRemoved
    && failure === null;
}

const passed = failure === null
  && checks.length === EXPECTED_CHECKS.length
  && EXPECTED_CHECKS.every((id, index) => checks[index]?.id === id)
  && cleanup.ok;
const receipt = {
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: passed ? 'passed' : 'failed',
  expectedCheckCount: EXPECTED_CHECKS.length,
  executedCheckCount: checks.length,
  checks,
  identity: {
    artifact: {
      appId: artifacts.appId,
      inputsHash: artifacts.inputsHash,
      schemaHash: artifacts.schemaHash,
      bundleHash: artifacts.bundleHash,
    },
    loaded: checks.find(({ id }) => id === 'artifact-identity')?.details ?? null,
  },
  lifecycle: checks.find(({ id }) => id === 'managed-lifecycle')?.details ?? {
    owned: true,
    applicationReadyObserved: false,
    waitLevel: 'application',
    firstQueryRetries: 0,
  },
  operations: {
    surface: 'conversation',
    queryFunctionId: api.messagesForConversation.id,
    mutationFunctionId: api.sendMessage.id,
    replyFunctionId: api.sendReply.id,
    reactionFunctionId: api.addReaction.id,
  },
  cleanup,
  diagnostic: failure,
};
process.stdout.write(`${JSON.stringify(receipt)}\n`);
process.exitCode = passed ? 0 : 1;
