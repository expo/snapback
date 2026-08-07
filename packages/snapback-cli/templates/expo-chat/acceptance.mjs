import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { SnapbackClient } from '@expo/snapback-client';
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
  'managed-lifecycle',
  'artifact-identity',
  'surface-query',
  'surface-mutation-and-observation',
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
const child = spawn(executable, [
  'dev', 'snapback', '--db', database, '--ready-file', readyFile,
], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
});

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
let childSpawnError = null;

const appendBounded = (current, chunk) =>
  `${current}${chunk.toString('utf8')}`.slice(-MAX_CHILD_OUTPUT_BYTES);

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

const until = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (childSpawnError) throw childSpawnError;
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
  const deadline = Date.now() + timeoutMs;
  while (child.exitCode === null && child.signalCode === null && Date.now() < deadline) {
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  return child.exitCode !== null || child.signalCode !== null;
};

try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'managed Snapback ready descriptor');
  const loaded = await until(
    () => lifecycleEvents.find(
      (event) => event.state === 'generated-and-loaded' && event.managed === true,
    ) ?? null,
    'managed Snapback generated-and-loaded lifecycle',
  );
  assert.equal(loaded.readyFile, readyFile);
  assert.equal(loaded.serverUrl, ready.serverUrl);
  assert.equal(ready.ready, true);
  pass('managed-lifecycle', {
    owned: true,
    readyDescriptorObserved: ready.ready === true,
    generatedAndLoadedObserved: true,
  });

  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  client = new SnapbackClient(ready.serverUrl, {
    adminToken,
    rqsStore: null,
    offlineQueue: false,
  });
  const inspected = await client.inspect();
  assert.equal(inspected.functions?.appId, artifacts.appId);
  assert.equal(inspected.functions?.bundleHash, artifacts.bundleHash);
  pass('artifact-identity', {
    appId: artifacts.appId,
    bundleHash: artifacts.bundleHash,
  });

  const binding = await client.prepareReactBinding({ generatedManifest: app });
  provider = createSnapbackReactProvider(binding, {
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
      && (latest.data.messages?.length ?? 0) >= 3
      && latest.data.details?.[0]?.title === 'Engine Room',
    'initial conversation surface reads',
  );
  pass('surface-query', {
    surface: 'conversation',
    messageRows: latest.data.messages.length,
    userRows: latest.data.users?.length ?? 0,
  });

  // The dev auth profile trusts the declared userId. sendMessage is the same
  // generated function the surface's send command commits through; the live
  // echo below is observed through the surface, not re-queried.
  const text = `Generated acceptance ${process.pid}`;
  const mutation = await client.mutate(api.sendMessage, {
    args: { conversationId: CONVERSATION_ID, senderId: 'user_ada', body: text },
    userId: 'user_ada',
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
    cleanup.clientResourcesReleased = true;
  } catch (error) {
    failure ??= {
      code: error?.code ?? 'SNAPBACK_STARTER_ACCEPTANCE_CLEANUP_FAILED',
      message: String(error?.message ?? error).slice(0, 4_096),
    };
  }

  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  if (!(await waitForExit(10_000))) child.kill('SIGKILL');
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
    readyDescriptorObserved: false,
    generatedAndLoadedObserved: false,
  },
  operations: {
    surface: 'conversation',
    queryFunctionId: api.messagesForConversation.id,
    mutationFunctionId: api.sendMessage.id,
  },
  cleanup,
  diagnostic: failure,
};
process.stdout.write(`${JSON.stringify(receipt)}\n`);
process.exitCode = passed ? 0 : 1;
