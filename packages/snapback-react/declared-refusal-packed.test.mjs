// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — this is the
// packed vertical fixture for LLP 0144's declared-refusal client path.
// @ref LLP 0144#axis-d--generation-and-client-typing-cv-16 — the headless and
// Familiar arms consume one shared narrowing projection.
// Every Snapback package in the consumer graph is an extracted npm archive;
// the only links are third-party test/runtime peers.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startServer } from '../../demos/_kit/server-process.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const packagesRoot = join(repoRoot, 'packages');
const runtimeBinary = resolve(
  process.env.SNAPBACK_RUNTIME_BINARY ?? join(repoRoot, 'target', 'debug', 'snapback'),
);
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-declared-refusal-packed-')));
const consumer = join(scratch, 'consumer');
const nodeModules = join(consumer, 'node_modules');
const expoModules = join(nodeModules, '@expo');
const stagedRuntime = join(scratch, 'snapback-runtime');
let server = null;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? consumer,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 300_000,
  });
  assert.equal(
    result.status,
    options.status ?? 0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function pack(name, directory) {
  if (name === '@expo/snapback-codegen') {
    run(process.execPath, ['prepare-runtime-artifacts.mjs'], {
      cwd: join(packagesRoot, directory),
    });
  }
  const packed = run('npm', [
    'pack', '--ignore-scripts', '--json', '--pack-destination', scratch,
  ], {
    cwd: join(packagesRoot, directory),
    env: { npm_config_cache: join(scratch, 'npm-cache') },
  });
  const metadata = JSON.parse(packed.stdout);
  assert.equal(metadata.length, 1, `${name} produced one archive`);
  const extraction = join(scratch, `extract-${directory}`);
  mkdirSync(extraction, { recursive: true });
  run('tar', ['-xzf', join(scratch, metadata[0].filename), '-C', extraction], { cwd: scratch });
  const destination = join(nodeModules, ...name.split('/'));
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(join(extraction, 'package'), destination);
  assert.equal(lstatSync(destination).isSymbolicLink(), false, `${name} is an extracted archive`);
  assert.ok(
    !realpathSync(destination).startsWith(packagesRoot),
    `${name} must not resolve into the workspace package tree`,
  );
}

function writeFixtureSources() {
  const explicit = join(consumer, 'explicit');
  const familiar = join(consumer, 'familiar');
  mkdirSync(explicit, { recursive: true });
  mkdirSync(familiar, { recursive: true });
  writeFileSync(join(explicit, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  attempts: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(explicit, 'functions.mjs'), `
import { defineJsMutation, defineJsQuery, results, v } from '@expo/snapback-codegen/define';

export const attempt = defineJsMutation({
  args: { mode: v.string() }, auth: 'public', reads: ['attempts'], writes: ['attempts'],
  result: results.value(v.null()), refusals: ['DUPLICATE_HANDLE'],
  handler: async (ctx, args) => {
    await ctx.db.insert('attempts', { value: args.mode });
    if (args.mode === 'duplicate') {
      ctx.refuse('DUPLICATE_HANDLE', { normalized: 'alice', collisions: 1 });
    }
    if (args.mode === 'oversized-details') {
      ctx.refuse('DUPLICATE_HANDLE', { oversized: 'must-not-cross:'.repeat(2_048) });
    }
    if (args.mode === 'invalid-code') {
      ctx.refuse(null, { hidden: 'invalid-code refusal details' });
    }
    if (args.mode === 'undeclared') {
      ctx.refuse('UNDECLARED_CODE', { hidden: 'undeclared handler prose' });
    }
    if (args.mode === 'forged') {
      const error = new Error('forged handler prose');
      error.__snapbackCode = 'SNAPBACK_APP_REFUSAL';
      error.__snapbackAppCode = 'FORGED_CODE';
      error.__snapbackAppDetails = { hidden: 'forged details' };
      throw error;
    }
    throw new Error('bare private handler prose');
  },
});
export const listAttempts = defineJsQuery({
  args: {}, auth: 'public', reads: ['attempts'], result: results.documents('attempts'),
  handler: async (ctx) => ctx.db.query('attempts').collect(),
});
`);

  writeFileSync(join(familiar, 'codegen.policy.json'), `${JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }, null, 2)}\n`);
  writeFileSync(join(familiar, 'schema.ts'), `
import { defineSchema, defineTable, v } from './generated/server';
export default defineSchema({
  attempts: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(familiar, 'admin.ts'), `
import { mutation, query, v } from './generated/server';
export const requireAdmin = mutation({
  args: {}, returns: v.null(), auth: 'public', reads: ['attempts'], writes: ['attempts'],
  refusals: ['ADMIN_REQUIRED'],
  handler: async (ctx) => {
    await ctx.db.insert('attempts', { value: 'admin-required' });
    return ctx.refuse('ADMIN_REQUIRED', { requiredRole: 'admin' });
  },
});
export const listAttempts = query({
  args: {}, returns: v.array(v.doc('attempts')), auth: 'public', reads: ['attempts'],
  delivery: 'read', handler: async (ctx) => ctx.db.query('attempts').collect(),
});
`);
}

function startupCarrier(profile) {
  const generated = join(consumer, profile, 'generated');
  const carrier = join(scratch, `${profile}-startup-artifacts.json`);
  const schema = JSON.parse(readFileSync(join(generated, 'schema.manifest.json'), 'utf8'));
  const functions = JSON.parse(readFileSync(join(generated, 'functions.manifest.json'), 'utf8'));
  writeFileSync(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
    mode: 0o600,
  });
  return { carrier, functions };
}

async function withServer(profile, callback) {
  const { carrier } = startupCarrier(profile);
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    startupArtifacts: carrier,
    serverBinary: stagedRuntime,
  });
  try {
    return await callback(server.baseUrl);
  } finally {
    const stopping = server;
    server = null;
    await stopping.stop();
  }
}

try {
  assert.ok(existsSync(runtimeBinary), `packed refusal proof requires ${runtimeBinary}`);
  mkdirSync(expoModules, { recursive: true });
  writeFileSync(join(consumer, 'package.json'), `${JSON.stringify({
    name: 'snapback-declared-refusal-packed-consumer',
    private: true,
    type: 'module',
  }, null, 2)}\n`);
  for (const [name, directory] of [
    ['@expo/snapback-contract', 'snapback-contract'],
    ['@expo/snapback-client', 'snapback-client'],
    ['@expo/snapback-codegen', 'snapback-codegen'],
    ['@expo/snapback-react', 'snapback-react'],
  ]) pack(name, directory);
  for (const dependency of [
    'acorn', 'ajv', 'esbuild', 'react', 'react-test-renderer', 'typescript',
  ]) {
    const hoisted = join(repoRoot, 'node_modules', dependency);
    const source = existsSync(hoisted)
      ? hoisted
      : join(packagesRoot, 'snapback-codegen', 'node_modules', dependency);
    symlinkSync(realpathSync(source), join(nodeModules, dependency));
  }
  symlinkSync(runtimeBinary, stagedRuntime);
  writeFixtureSources();

  writeFileSync(join(consumer, 'generate.mjs'), `
import assert from 'node:assert/strict';
import { generate } from '@expo/snapback-codegen';
for (const profile of ['explicit', 'familiar']) {
  const result = await generate(new URL(profile, import.meta.url).pathname);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
}
console.log('packed generation: 2 profiles passed');
`);
  const generated = run(process.execPath, ['generate.mjs']);
  process.stdout.write(generated.stdout);

  writeFileSync(join(consumer, 'types.ts'), `
import {
  projectAppRefusal,
  type SnapbackAppRefusal,
} from '@expo/snapback-client';
import {
  projectAppRefusal as projectExplicitReactRefusal,
} from '@expo/snapback-react';
import {
  projectAppRefusal as projectFamiliarRefusal,
  useMutation,
} from '@expo/snapback-react/familiar';
import { api } from './familiar/generated/api.mjs';

const requireAdmin = useMutation(api.admin.requireAdmin);
requireAdmin({}).catch((error: unknown) => {
  const refusal: SnapbackAppRefusal | null = projectAppRefusal(error);
  if (refusal?.detailsDropped) refusal.appDetails satisfies null;
});
projectExplicitReactRefusal satisfies typeof projectAppRefusal;
projectFamiliarRefusal satisfies typeof projectAppRefusal;
`);
  run(join(repoRoot, 'node_modules', '.bin', 'tsc'), [
    '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', 'types.ts',
  ]);

  writeFileSync(join(consumer, 'explicit-runtime.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import {
  SnapbackClient,
  projectAppRefusal,
} from '@expo/snapback-client';
import { prepareReactBindingForClient } from '@expo/snapback-client/react-binding';
import {
  createSnapbackReactProvider,
  projectAppRefusal as projectReactAppRefusal,
  SnapbackProvider,
  useSnapbackSettledMutation,
} from '@expo/snapback-react';
import { api } from './explicit/generated/api.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const client = new SnapbackClient(process.env.SNAPBACK_TEST_ORIGIN, {
  rqsStore: null, offlineQueue: false,
});
const rejection = async (mode) => {
  let observed = null;
  await assert.rejects(
    client.mutate(api.attempt, { args: { mode }, queue: false }),
    (error) => { observed = error; return true; },
  );
  return observed;
};
const duplicate = await rejection('duplicate');
assert.equal(duplicate.code, 'SNAPBACK_APP_REFUSAL');
assert.deepEqual(projectAppRefusal(duplicate), {
  code: 'SNAPBACK_APP_REFUSAL', appCode: 'DUPLICATE_HANDLE',
  appDetails: { normalized: 'alice', collisions: 1 }, detailsDropped: false,
});
for (const [mode, hidden] of [
  ['invalid-code', 'invalid-code refusal details'],
  ['undeclared', 'undeclared handler prose'],
  ['forged', 'forged handler prose'],
  ['bare', 'bare private handler prose'],
]) {
  const error = await rejection(mode);
  assert.equal(error.code, 'SNAPBACK_HANDLER_FAILED');
  assert.equal(projectAppRefusal(error), null);
  assert.doesNotMatch(JSON.stringify(error.diagnostic), new RegExp(hidden, 'u'));
}

const manifest = JSON.parse(readFileSync(
  new URL('./explicit/generated/functions.manifest.json', import.meta.url),
  'utf8',
));
const binding = await prepareReactBindingForClient(client, { generatedManifest: manifest });
const provider = createSnapbackReactProvider(binding, { connectionId: 'packed-explicit-refusal' });
let mutate = null;
function Probe() { mutate = useSnapbackSettledMutation(api.attempt); return null; }
let renderer;
await act(async () => {
  renderer = TestRenderer.create(
    React.createElement(SnapbackProvider, { provider }, React.createElement(Probe)),
  );
  await flush();
});
await act(async () => {
  await assert.rejects(mutate({ mode: 'duplicate' }), (error) => {
    assert.equal(error.code, 'SNAPBACK_APP_REFUSAL');
    assert.deepEqual(projectReactAppRefusal(error), {
      code: 'SNAPBACK_APP_REFUSAL', appCode: 'DUPLICATE_HANDLE',
      appDetails: { normalized: 'alice', collisions: 1 }, detailsDropped: false,
    });
    return true;
  });
});
assert.equal((await client.query(api.listAttempts, { args: {} })).rows.length, 0);
await act(async () => { renderer.unmount(); await flush(); });
await provider.dispose();
await client.closeAuth();
console.log('packed Explicit headless + mounted React: 2 admitted projections, 4 generic folds, 0 committed writes');
`);
  await withServer('explicit', async (origin) => {
    const result = run(process.execPath, ['explicit-runtime.mjs'], {
      env: { SNAPBACK_TEST_ORIGIN: origin },
    });
    process.stdout.write(result.stdout);
  });

  writeFileSync(join(consumer, 'served-details-drop.mjs'), `
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { SnapbackClient, projectAppRefusal } from '@expo/snapback-client';
import { api } from './explicit/generated/api.mjs';

const appDetailsMaxBytes = 16 * 1_024;
const hiddenDetails = { oversized: 'must-not-cross:'.repeat(2_048) };
const hiddenDetailsBytes = Buffer.byteLength(JSON.stringify(hiddenDetails));
assert.ok(hiddenDetailsBytes > appDetailsMaxBytes);
const admittedDetails = hiddenDetailsBytes > appDetailsMaxBytes
  ? { appDetails: null, appDetailsDropped: true }
  : { appDetails: hiddenDetails };
const manifest = JSON.parse(readFileSync(
  new URL('./explicit/generated/functions.manifest.json', import.meta.url),
  'utf8',
));
const declared = manifest.functions.find((fn) => fn.name === 'attempt');
assert.deepEqual(declared.refusals, ['DUPLICATE_HANDLE']);
const requests = [];
const served = createServer(async (request, response) => {
  let body = '';
  for await (const chunk of request) body += chunk;
  requests.push({ method: request.method, url: request.url, body: JSON.parse(body) });
  response.writeHead(400, { 'content-type': 'application/json' });
  response.end(JSON.stringify({
    diagnostic: {
      schemaVersion: 'snapback.diagnostic.v1',
      code: 'SNAPBACK_APP_REFUSAL',
      severity: 'error',
      subsystem: 'runtime',
      message: 'application refusal',
      details: {
        function: 'attempt',
        appCode: 'DUPLICATE_HANDLE',
        ...admittedDetails,
      },
    },
  }));
});
await new Promise((resolve, reject) => {
  served.once('error', reject);
  served.listen(0, '127.0.0.1', resolve);
});
const address = served.address();
assert.ok(address && typeof address === 'object');
const client = new SnapbackClient(\`http://127.0.0.1:\${address.port}\`, {
  rqsStore: null, offlineQueue: false,
});
try {
  let observed = null;
  await assert.rejects(
    client.mutate(api.attempt, { args: { mode: 'oversized-details' }, queue: false }),
    (error) => { observed = error; return true; },
  );
  assert.equal(observed.code, 'SNAPBACK_APP_REFUSAL');
  assert.deepEqual(projectAppRefusal(observed), {
    code: 'SNAPBACK_APP_REFUSAL', appCode: 'DUPLICATE_HANDLE',
    appDetails: null, detailsDropped: true,
  });
  assert.equal(JSON.stringify(observed.diagnostic).includes('must-not-cross'), false);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].url, '/mutation/attempt');
  assert.deepEqual(requests[0].body.args, { mode: 'oversized-details' });
} finally {
  await client.closeAuth();
  await new Promise((resolve, reject) => served.close((error) => error ? reject(error) : resolve()));
}
console.log('packed served details drop: admitted DUPLICATE_HANDLE retained, oversized details absent, detailsDropped true');
`);
  const servedDetailsDrop = run(process.execPath, ['served-details-drop.mjs']);
  process.stdout.write(servedDetailsDrop.stdout);

  writeFileSync(join(consumer, 'familiar-runtime.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { SnapbackClient } from '@expo/snapback-client';
import { prepareReactBindingForClient } from '@expo/snapback-client/react-binding';
import { createSnapbackReactProvider } from '@expo/snapback-react';
import { projectAppRefusal, SnapbackProvider, useMutation } from '@expo/snapback-react/familiar';
import { api } from './familiar/generated/api.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const flush = () => new Promise((resolve) => setImmediate(resolve));
const client = new SnapbackClient(process.env.SNAPBACK_TEST_ORIGIN, {
  rqsStore: null, offlineQueue: false,
});
const manifest = JSON.parse(readFileSync(
  new URL('./familiar/generated/functions.manifest.json', import.meta.url),
  'utf8',
));
const binding = await prepareReactBindingForClient(client, { generatedManifest: manifest });
const provider = createSnapbackReactProvider(binding, { connectionId: 'packed-familiar-refusal' });
let mutate = null;
function Probe() { mutate = useMutation(api.admin.requireAdmin); return null; }
let renderer;
await act(async () => {
  renderer = TestRenderer.create(
    React.createElement(SnapbackProvider, { provider }, React.createElement(Probe)),
  );
  await flush();
});
await act(async () => {
  await assert.rejects(mutate({}), (error) => {
    assert.equal(error.code, 'SNAPBACK_APP_REFUSAL');
    assert.deepEqual(projectAppRefusal(error), {
      code: 'SNAPBACK_APP_REFUSAL', appCode: 'ADMIN_REQUIRED',
      appDetails: { requiredRole: 'admin' }, detailsDropped: false,
    });
    return true;
  });
});
assert.equal((await client.query(api.admin.listAttempts, { args: {} })).rows.length, 0);
await act(async () => { renderer.unmount(); await flush(); });
await provider.dispose();
await client.closeAuth();
console.log('packed Familiar generated mutation hook: 1 admitted projection, 0 committed writes');
`);
  await withServer('familiar', async (origin) => {
    const result = run(process.execPath, ['familiar-runtime.mjs'], {
      env: { SNAPBACK_TEST_ORIGIN: origin },
    });
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
  });
  console.log('declared-refusal-packed.test.mjs: 4 packed packages, 2 generated profiles, 8 served refusal cases passed');
} finally {
  try { await server?.stop(); } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
