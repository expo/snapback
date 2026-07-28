import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { SnapbackClient } from '@snapback/client';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
} from '@snapback/react';
import api from './snapback/generated/api.mjs';
import functions from './snapback/generated/functions.manifest.json' with { type: 'json' };
import capabilityManifest from './snapback/generated/capability.manifest.json' with { type: 'json' };
import schema from './snapback/generated/schema.manifest.json' with { type: 'json' };
import seed from './snapback/seed.json' with { type: 'json' };

const root = resolve(import.meta.dirname);
const readyFile = join(root, '.snapback', 'dev.ready.json');
const executable = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'snapback.cmd' : 'snapback',
);
const child = spawn(executable, ['dev', 'snapback', '--no-watch'], {
  cwd: root,
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stdout = '';
let stderr = '';
child.stdout.on('data', (chunk) => { stdout += chunk; });
child.stderr.on('data', (chunk) => { stderr += chunk; });

const until = async (predicate, label, timeoutMs = 30_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = await predicate();
    if (value) return value;
    if (child.exitCode !== null) {
      throw new Error(`${label}: dev exited ${child.exitCode}\n${stdout}\n${stderr}`);
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  throw new Error(`${label}: timed out\n${stdout}\n${stderr}`);
};

try {
  const ready = await until(() => {
    if (!existsSync(readyFile)) return null;
    try { return JSON.parse(readFileSync(readyFile, 'utf8')); } catch { return null; }
  }, 'managed Snapback ready file');
  const adminToken = readFileSync(ready.adminTokenFile, 'utf8').trim();
  const client = new SnapbackClient(ready.serverUrl, { adminToken });
  await client.ensureApp({ schema, functions, seed });
  const binding = await client.prepareReactBinding({
    generatedManifest: { functions, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(binding, {
    connectionId: 'react_starter_live_acceptance',
  });
  let latest = null;
  const observer = observeSnapbackQueries(provider, {
    todos: { ref: api.listTodos, args: {} },
  }, (snapshot) => { latest = snapshot; });
  await until(() => latest?.queries.todos.status === 'ready', 'initial React starter query');
  const created = await invokeSnapbackMutation(provider, api.createTodo, {
    title: 'Packed live acceptance',
  });
  assert.equal(typeof created, 'string');
  await until(
    () => latest?.queries.todos.status === 'ready'
      && latest.queries.todos.data.some((row) => row.title === 'Packed live acceptance'),
    'React starter live mutation',
  );
  observer.dispose();
  await provider.dispose();
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
  assert.equal((await client.inspect()).subscriptions.length, 0);
  console.log('react starter live acceptance: query, mutation, delivery, and cleanup pass');
} finally {
  if (child.exitCode === null) {
    child.stdin.end();
    const deadline = Date.now() + 10_000;
    while (child.exitCode === null && Date.now() < deadline) {
      await new Promise((resolveWait) => setTimeout(resolveWait, 25));
    }
  }
  if (child.exitCode === null) child.kill('SIGKILL');
}
