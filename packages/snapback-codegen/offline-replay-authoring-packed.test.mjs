// LLP 0307 S3: one npm-packed closure binds offline replay authorability from
// both schema profiles through target facts, supervised binding offers, and
// the queue-aware React/headless client admission seam.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-offline-replay-packed-')));
const consumer = join(scratch, 'consumer');
const nodeModules = join(consumer, 'node_modules');
const expoModules = join(nodeModules, '@expo');
const npmCache = join(scratch, 'npm-cache');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? consumer,
    encoding: 'utf8',
    env: { ...process.env, npm_config_cache: npmCache, ...(options.env ?? {}) },
  });
  assert.equal(
    result.status,
    options.status ?? 0,
    `${command} ${args.join(' ')} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result;
}

function installPacked(packageName, sourceDirectory) {
  const target = join(nodeModules, ...packageName.split('/'));
  mkdirSync(target, { recursive: true });
  const packed = run('npm', ['pack', '--json', '--pack-destination', scratch], {
    cwd: sourceDirectory,
  });
  const records = JSON.parse(packed.stdout.slice(packed.stdout.indexOf('[')));
  assert.equal(records.length, 1, `${packageName} npm pack returned ${records.length} records`);
  run('tar', [
    '-xzf', join(scratch, records[0].filename), '-C', target, '--strip-components=1',
  ], { cwd: scratch });
  return target;
}

function explicitSchemaSource() {
  return `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export const todos = defineTable({ title: v.string() })
  .visibility({ kind: 'public-read' })
  .sync();
export default defineSchema({ todos }, {
  requiredCapabilities: ['offline_mutation_replay'],
});
`;
}

function explicitFunctionsSource() {
  return `
import { defineJsMutation, results, v } from '@expo/snapback-codegen/define';
export const setTodo = defineJsMutation({
  auth: 'public',
  args: { title: v.string() },
  reads: [],
  writes: ['todos'],
  result: results.value(v.boolean()),
  handler: async (ctx, args) => {
    await ctx.db.insert('todos', { title: args.title });
    return true;
  },
});
`;
}

function familiarSchemaSource() {
  return `
import { defineSchema, defineTable, v } from './generated/server';
export const todos = defineTable({ title: v.string() })
  .visibility({ kind: 'public-read' })
  .sync();
export default defineSchema({ todos }, {
  requiredCapabilities: ['offline_mutation_replay'],
});
`;
}

function familiarFunctionsSource() {
  return `
import { mutation, v } from './generated/server';
export const setTodo = mutation({
  auth: 'public',
  args: { title: v.string() },
  returns: v.boolean(),
  reads: [],
  writes: ['todos'],
  handler: async (ctx, args) => {
    await ctx.db.insert('todos', { title: args.title });
    return true;
  },
});
`;
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

try {
  mkdirSync(expoModules, { recursive: true });
  const installed = new Map();
  for (const [name, directory] of [
    ['@expo/snapback-contract', 'packages/snapback-contract'],
    ['@expo/snapback-codegen', 'packages/snapback-codegen'],
    ['@expo/snapback-client', 'packages/snapback-client'],
    ['@expo/snapback-react', 'packages/snapback-react'],
    ['@expo/snapback-expo', 'packages/snapback-expo'],
    ['@expo/snapback-cli', 'packages/snapback-cli'],
  ]) {
    installed.set(name, installPacked(name, resolve(repoRoot, directory)));
  }

  for (const dependency of ['acorn', 'ajv', 'esbuild', 'typescript']) {
    symlinkSync(
      realpathSync(join(packageRoot, 'node_modules', dependency)),
      join(nodeModules, dependency),
    );
  }
  const rendererRoot = realpathSync(join(repoRoot, 'node_modules', 'react-test-renderer'));
  const rendererDependencies = dirname(rendererRoot);
  for (const [name, source] of [
    ['react', realpathSync(join(repoRoot, 'node_modules', 'react'))],
    ['react-test-renderer', rendererRoot],
    ['react-is', realpathSync(join(rendererDependencies, 'react-is'))],
    ['scheduler', realpathSync(join(rendererDependencies, 'scheduler'))],
  ]) {
    symlinkSync(source, join(nodeModules, name));
  }
  writeFileSync(join(consumer, 'package.json'), '{"private":true,"type":"module"}\n');

  const explicit = join(consumer, 'explicit');
  mkdirSync(explicit);
  writeFileSync(join(explicit, 'schema.mjs'), explicitSchemaSource());
  writeFileSync(join(explicit, 'functions.mjs'), explicitFunctionsSource());

  const familiar = join(consumer, 'familiar');
  mkdirSync(familiar);
  writeFileSync(join(familiar, 'schema.ts'), familiarSchemaSource());
  writeFileSync(join(familiar, 'todos.ts'), familiarFunctionsSource());
  writeFileSync(join(familiar, 'codegen.policy.json'), `${JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: ['normalized-definition.v1.json'],
    authoringProfile: 'snapback-familiar-ts-v1',
  }, null, 2)}\n`);

  const codegen = await import(pathToFileURL(join(
    installed.get('@expo/snapback-codegen'),
    'index.mjs',
  )).href);
  for (const backend of [explicit, familiar]) {
    const generated = await codegen.generate(backend, { appBindingMode: 'development' });
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const output = join(backend, 'generated');
    const schema = readJson(join(output, 'schema.manifest.json'));
    const functions = readJson(join(output, 'functions.manifest.json'));
    const capability = readJson(join(output, 'capability.manifest.json'));
    const descriptor = readJson(join(output, 'app.descriptor.json'));
    assert(schema.requiredCapabilities.includes('offline_mutation_replay'));
    assert(functions.acknowledgedExperimentalCapabilities.includes('offline_mutation_replay'));
    assert(capability.supportedCapabilities.includes('offline_mutation_replay'));
    assert(descriptor.capabilities.required.includes('offline_mutation_replay'));
  }

  // A selected target without the ledger refuses before replacing or creating
  // any output, with all four vocabulary layers present in one diagnostic.
  const unsupported = join(consumer, 'unsupported');
  mkdirSync(unsupported);
  writeFileSync(join(unsupported, 'schema.mjs'), explicitSchemaSource());
  writeFileSync(join(unsupported, 'functions.mjs'), explicitFunctionsSource());
  const supportedManifest = readJson(join(explicit, 'generated', 'capability.manifest.json'));
  const ledgerlessManifest = {
    ...supportedManifest,
    supportedCapabilities: supportedManifest.supportedCapabilities
      .filter((capability) => capability !== 'offline_mutation_replay'),
    capabilityGaps: [...new Set([
      ...(supportedManifest.capabilityGaps ?? []),
      'offline_mutation_replay',
    ])].sort(),
  };
  const refused = await codegen.generateInProcess(
    unsupported,
    { appBindingMode: 'development' },
    { capabilityManifest: ledgerlessManifest },
  );
  assert.equal(refused.ok, false);
  const refusal = refused.diagnostics.find(
    ({ code, capability }) => code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
      && capability === 'offline_mutation_replay',
  );
  assert(refusal, JSON.stringify(refused.diagnostics));
  assert.deepEqual(refusal.vocabulary, {
    targetFacts: 'not-supported',
    authorableSet: 'authorable',
    bindingOffers: 'not-offered',
    clientAdmission: 'not-admitted',
  });
  for (const label of ['target facts=', 'authorable set=', 'binding offers=', 'client admission=']) {
    assert(refusal.message.includes(label), `missing ${label} from ${refusal.message}`);
  }
  assert.equal(existsSync(join(unsupported, 'generated')), false);

  const familiarOutput = join(familiar, 'generated');
  const schema = readJson(join(familiarOutput, 'schema.manifest.json'));
  const functions = readJson(join(familiarOutput, 'functions.manifest.json'));
  const capabilityManifest = readJson(join(familiarOutput, 'capability.manifest.json'));
  const descriptor = readJson(join(familiarOutput, 'app.descriptor.json'));
  const { createSupervisedBindingPublisher } = await import(pathToFileURL(join(
    installed.get('@expo/snapback-cli'),
    'expo-binding-refresh.mjs',
  )).href);
  const { admitAppBindingV1 } = await import(pathToFileURL(join(
    installed.get('@expo/snapback-expo'),
    'app-binding.mjs',
  )).href);
  const bindingPublisher = createSupervisedBindingPublisher({
    generation: 'packed-offline-replay',
    now: () => Date.parse('2026-08-25T12:00:00.000Z'),
  });
  const appBinding = bindingPublisher.issue({
    descriptor,
    capabilityManifest,
    origin: 'http://127.0.0.1:4400',
    routing: 'loopback',
  });
  assert(appBinding.capabilities.offered.includes('offline_mutation_replay'));
  await admitAppBindingV1(appBinding, descriptor, {
    now: Date.parse('2026-08-25T12:00:00.000Z'),
    delivery: { channel: 'local-supervised-ipc' },
  });

  const React = (await import('react')).default;
  const TestRenderer = await import('react-test-renderer');
  const {
    SnapbackClient,
    createMemoryRqsResumeStore,
  } = await import(pathToFileURL(join(
    installed.get('@expo/snapback-client'),
    'index.mjs',
  )).href);
  const { prepareReactBindingForClient } = await import(pathToFileURL(join(
    installed.get('@expo/snapback-client'),
    'react-binding.mjs',
  )).href);
  const {
    SnapbackProvider,
    createSnapbackReactProvider,
    useSnapbackMutation,
  } = await import(pathToFileURL(join(
    installed.get('@expo/snapback-react'),
    'index.mjs',
  )).href);
  const { api } = await import(pathToFileURL(join(familiarOutput, 'api.mjs')).href);
  const mutationReference = api.todos.setTodo;
  assert.equal(mutationReference.kind, 'Mutation');

  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const originalFetch = globalThis.fetch;
  let online = false;
  const delivered = [];
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (!online) throw new TypeError('packed fixture offline');
    if (path === '/connection/open') {
      const body = JSON.parse(init.body);
      return Response.json({
        connectionId: body.connectionId,
        connectionToken: `sct_${body.connectionId}`,
        wireVersion: 'snapback.v1',
      });
    }
    delivered.push(JSON.parse(init.body));
    return Response.json({ result: true, version: 1 });
  };

  const store = createMemoryRqsResumeStore();
  store.durability = () => ({ implementation: 'packed-memory-ledger-fixture', durable: true });
  const client = new SnapbackClient('http://127.0.0.1:4400', {
    rqsStore: store,
    offlineQueue: true,
  });
  client.inspect = async () => ({
    targetProfileId: capabilityManifest.targetProfileId,
    target: capabilityManifest.targetProfileId,
    schema,
    functions,
    capabilityManifest,
  });
  client.authSession = async () => ({ activeMode: 'dev' });
  client.releaseConnection = async () => ({ released: true, attached: true });
  const prepared = await prepareReactBindingForClient(client, {
    generatedManifest: { schema, functions, capabilityManifest },
  });
  const provider = createSnapbackReactProvider(prepared, { outboxDrain: 'manual' });
  let mutate = null;
  function Probe() {
    mutate = useSnapbackMutation(mutationReference);
    return null;
  }
  let renderer;
  await TestRenderer.act(async () => {
    renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(Probe),
    ));
  });
  let queued;
  await TestRenderer.act(async () => {
    queued = await mutate({ title: 'packed stable intent' });
  });
  assert.equal(queued.status, 'queued');
  assert.match(queued.clientMutationId, /^mut_/u);
  assert.equal((await store.outboxPending()).length, 1);
  online = true;
  const replay = await client.replayQueuedMutations();
  assert.deepEqual(
    { replayed: replay.replayed, failed: replay.failed, remaining: replay.remaining },
    { replayed: 1, failed: 0, remaining: 0 },
  );
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].clientMutationId, queued.clientMutationId);

  await TestRenderer.act(async () => { renderer.unmount(); });
  await provider.dispose();
  bindingPublisher.close();

  let ledgerlessTransportCalls = 0;
  globalThis.fetch = async () => {
    ledgerlessTransportCalls += 1;
    throw new Error('ledger-less client must refuse before transport');
  };
  const ledgerlessStore = createMemoryRqsResumeStore();
  ledgerlessStore.durability = () => ({ implementation: 'packed-memory-ledgerless-fixture', durable: true });
  const ledgerlessClient = new SnapbackClient('https://ledgerless.packed.test', {
    rqsStore: ledgerlessStore,
    offlineQueue: true,
  });
  ledgerlessClient.inspect = async () => ({
    targetProfileId: 'cloudflare-do-sqlite-v8',
    capabilityManifest: {
      targetProfileId: 'cloudflare-do-sqlite-v8',
      supportedCapabilities: [],
      capabilityGaps: ['offline_mutation_replay'],
    },
  });
  await assert.rejects(
    () => ledgerlessClient.mutate(mutationReference, {
      args: { title: 'must refuse' },
      queue: true,
    }),
    (error) => (
      error.code === 'SNAPBACK_OFFLINE_QUEUE_SETTLEMENT_LEDGER_REQUIRED'
      && error.diagnostic.details.capability === 'offline_mutation_replay'
      && error.diagnostic.details.targetProfileId === 'cloudflare-do-sqlite-v8'
    ),
  );
  assert.equal(ledgerlessTransportCalls, 0);
  assert.deepEqual(await ledgerlessStore.outboxRecords(), []);
  await ledgerlessClient.close();
  globalThis.fetch = originalFetch;

  console.log(
    'offline-replay-authoring-packed.test.mjs: 2 profiles + 4 vocabulary layers + stable hook replay + ledger-less pre-transport refusal passed',
  );
} finally {
  rmSync(scratch, { recursive: true, force: true });
}
