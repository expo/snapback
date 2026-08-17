import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { build } from 'esbuild';

import {
  generate,
  microProfileCapabilityProblems,
  verifyMicroProfileArtifacts,
} from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const backend = mkdtempSync(join(packageDir, '.micro-profile-test-'));
mkdirSync(join(backend, 'node_modules', '@expo'), { recursive: true });
symlinkSync(join(packageDir, '..', 'snapback-client'), join(backend, 'node_modules', '@expo', 'snapback-client'));
const profilePath = join(backend, 'micro.profile.json');
const generatedPath = (name) => join(backend, 'generated', name);
const nonclaims = [
  'admin',
  'assets',
  'capability-class',
  'ephemeral-state',
  'generic-storage',
  'hosted-carrier',
  'offline-replay',
  'optimistic-settlement',
  'query-groups',
  'retained-reads',
  'rqs',
  'sessions-auth',
];
const validProfile = {
  formatVersion: 'snapback.micro-profile-input.v1',
  profileName: 'incident-room',
  packagingProfile: 'micro.v1',
  selectedOperations: ['listTodos', 'createTodo', 'echo', 'watchTodos'],
  modules: ['core', 'operations', 'authority-fence', 'live'],
  arm: 'local-dev',
  lane: 'poll',
  authProfileSet: [],
  custodyOwner: 'none',
  carriers: [],
  explicitNonclaims: nonclaims,
};

function writeProfile(profile) {
  writeFileSync(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
}

async function bundle(entryPoint) {
  const result = await build({
    entryPoints: [entryPoint],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: true,
    treeShaking: true,
    metafile: true,
    write: false,
  });
  const bytes = result.outputFiles[0].contents;
  return {
    raw: bytes.byteLength,
    gzip: gzipSync(bytes, { level: 9 }).byteLength,
    brotli: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    inputs: Object.keys(result.metafile.inputs).sort(),
  };
}

async function diagnosticFor(profile) {
  writeProfile(profile);
  const result = await generate(backend);
  assert.equal(result.ok, false, 'negative Micro fixture must fail generation');
  return result.diagnostics.map(({ code }) => code);
}

try {
  writeFileSync(join(backend, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
    });
  `);
  writeFileSync(join(backend, 'functions.mjs'), `
    import { defineAction, defineJsLiveQuery, defineJsMutation, defineJsQuery, results, v } from ${JSON.stringify(defineUrl)};
    export const listTodos = defineJsQuery({ args: {}, reads: ['todos'], result: results.documents('todos'), handler: async (ctx) => ctx.db.query('todos').collect() });
    export const createTodo = defineJsMutation({ args: { title: v.string() }, writes: ['todos'], result: results.value(v.id('todos')), handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }) });
    export const echo = defineAction({ args: { value: v.string() }, result: results.value(v.string()), handler: async (_ctx, args) => args.value });
    export const watchTodos = defineJsLiveQuery({ args: {}, reads: ['todos'], result: results.documents('todos'), handler: async (ctx) => ctx.db.query('todos').collect() });
    export const unknownResult = defineJsQuery({ args: {}, reads: ['todos'], handler: async () => [] });
  `);
  writeProfile(validProfile);
  let result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const runtime = readFileSync(generatedPath('micro.mjs'), 'utf8');
  const declaration = readFileSync(generatedPath('micro.d.ts'), 'utf8');
  const profile = JSON.parse(readFileSync(generatedPath('micro.profile.json'), 'utf8'));
  assert.equal(profile.formatVersion, 'microProfile.v1');
  assert.equal(profile.capabilityClass, null);
  assert.deepEqual(profile.carriers, []);
  assert.equal(profile.selectedOperations.length, 4);
  assert.deepEqual(verifyMicroProfileArtifacts(profile, runtime, declaration), []);
  for (const forbidden of [
    'SnapbackClient',
    'functions.manifest',
    'argumentSchema',
    'resultContract',
    'rqs',
    'outbox-store',
    'node:fs',
    'handler:',
  ]) {
    assert.equal(runtime.includes(forbidden), false, `Micro runtime excludes ${forbidden}`);
  }
  const first = {
    runtime,
    declaration,
    profile: readFileSync(generatedPath('micro.profile.json'), 'utf8'),
  };
  result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual({
    runtime: readFileSync(generatedPath('micro.mjs'), 'utf8'),
    declaration: readFileSync(generatedPath('micro.d.ts'), 'utf8'),
    profile: readFileSync(generatedPath('micro.profile.json'), 'utf8'),
  }, first, 'Micro regeneration is byte-identical');

  writeFileSync(join(backend, 'micro-usage.ts'), `
    import { createClient, createTodo, echo, listTodos, watchTodos } from './generated/micro.js';
    const client = createClient({ endpoint: 'http://127.0.0.1:1' });
    void listTodos(client, {});
    void createTodo(client, { title: 'typed' });
    void echo(client, { value: 'typed' });
    void watchTodos(client, {}, { onUpdate(rows) { rows[0]?.title satisfies string; } });
    // @ts-expect-error missing title
    void createTodo(client, {});
    // @ts-expect-error wrong result argument type
    void echo(client, { value: 3 });
    // @ts-expect-error the unchecked implementation seam forbids caller-selected result generics
    void client.invoke<string>({ name: 'echo', kind: 'Action' }, {});
    // @ts-expect-error only the generated wrapper projects a result; raw invoke is unknown
    void client.invoke({ name: 'echo', kind: 'Action' }, {}).then((value) => value.length);
    // @ts-expect-error raw live subscribe likewise has no caller-selected result generic
    void client.subscribe<string>({ name: 'watchTodos', kind: 'LiveQuery' }, {});
  `);
  execFileSync(join(packageDir, '..', '..', 'node_modules', '.bin', 'tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    join(backend, 'micro-usage.ts'),
  ], { cwd: join(packageDir, '..', '..'), stdio: 'inherit' });

  const liveBundle = await bundle(generatedPath('micro.mjs'));
  assert.ok(liveBundle.inputs.some((path) => path.endsWith('/micro-core.mjs')));
  assert.ok(liveBundle.inputs.some((path) => path.endsWith('/micro-live.mjs')));
  for (const forbidden of ['index.mjs', 'rqs', 'outbox-store', 'node:fs']) {
    assert.equal(
      liveBundle.inputs.some((path) => path.includes(forbidden)),
      false,
      `live Micro closure excludes ${forbidden}`,
    );
  }
  assert.ok(liveBundle.gzip <= 25_000, `live Micro generated entry is ${liveBundle.gzip} gzip bytes`);
  const coreRuntimeEntry = join(backend, 'micro-core-runtime.mjs');
  const liveRuntimeEntry = join(backend, 'micro-live-runtime.mjs');
  writeFileSync(coreRuntimeEntry, "export { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';\n");
  writeFileSync(liveRuntimeEntry, [
    "export { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
    "export { withMicroLive } from '@expo/snapback-client/micro/live';",
    '',
  ].join('\n'));
  const coreRuntimeBundle = await bundle(coreRuntimeEntry);
  const liveRuntimeBundle = await bundle(liveRuntimeEntry);
  assert.ok(coreRuntimeBundle.gzip <= 20_000, `core runtime is ${coreRuntimeBundle.gzip} gzip bytes`);
  assert.ok(liveRuntimeBundle.gzip <= 20_000, `live runtime is ${liveRuntimeBundle.gzip} gzip bytes`);

  const coreProfile = {
    ...validProfile,
    profileName: 'incident-room-core',
    selectedOperations: ['listTodos', 'createTodo', 'echo'],
    modules: ['core', 'operations', 'authority-fence'],
  };
  writeProfile(coreProfile);
  result = await generate(backend);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const coreRuntime = readFileSync(generatedPath('micro.mjs'), 'utf8');
  assert.equal(coreRuntime.includes('@expo/snapback-client/micro/live'), false);
  const coreBundle = await bundle(generatedPath('micro.mjs'));
  assert.ok(coreBundle.inputs.some((path) => path.endsWith('/micro-core.mjs')));
  assert.equal(
    coreBundle.inputs.some((path) => path.endsWith('/micro-live.mjs')),
    false,
    'core-only profile cannot reach the live/outbox module',
  );
  assert.ok(coreBundle.gzip <= 25_000, `core Micro generated entry is ${coreBundle.gzip} gzip bytes`);
  console.log(JSON.stringify({
    microBundleMetrology: {
      runtime: { core: coreRuntimeBundle, live: liveRuntimeBundle },
      runtimePlusGeneratedEntry: { core: coreBundle, live: liveBundle },
    },
  }));

  assert.ok((await diagnosticFor({ ...validProfile, selectedOperations: ['listTodos', 'listTodos'] }))
    .includes('CODEGEN_MICRO_SELECTED_OPERATIONS_INVALID'));
  assert.ok((await diagnosticFor({ ...validProfile, selectedOperations: ['missing'] }))
    .includes('CODEGEN_MICRO_OPERATION_UNKNOWN'));
  assert.ok((await diagnosticFor({ ...validProfile, selectedOperations: ['unknownResult'], modules: ['core', 'operations', 'authority-fence'] }))
    .includes('CODEGEN_MICRO_OPERATION_CONTRACT_REQUIRED'));
  assert.ok((await diagnosticFor({ ...validProfile, modules: ['core', 'operations', 'authority-fence'] }))
    .includes('CODEGEN_MICRO_LIVE_MODULE_REQUIRED'));
  assert.ok((await diagnosticFor({ ...validProfile, lane: 'stream', authProfileSet: ['auth/rr@1'] }))
    .includes('CODEGEN_MICRO_AUTH_LANE_UNSUPPORTED'));
  assert.ok((await diagnosticFor({ ...validProfile, custodyOwner: 'client-first-party' }))
    .includes('CODEGEN_MICRO_CUSTODY_MODULE_REQUIRED'));
  assert.ok((await diagnosticFor({ ...validProfile, modules: [...validProfile.modules, 'file-store'] }))
    .includes('CODEGEN_MICRO_MODULE_SET_INVALID'));
  assert.ok((await diagnosticFor({ ...validProfile, modules: 3 }))
    .includes('CODEGEN_MICRO_MODULE_SET_INVALID'));
  assert.deepEqual(
    microProfileCapabilityProblems(
      { selectedKinds: ['LiveQuery'] },
      { capabilityMaturity: {}, liveSubscriptions: false },
    ).map(({ code }) => code),
    [
      'CODEGEN_MICRO_ARGS_CONTRACT_CAPABILITY_REQUIRED',
      'CODEGEN_MICRO_RESULT_CONTRACT_CAPABILITY_REQUIRED',
      'CODEGEN_MICRO_LIVE_CAPABILITY_REQUIRED',
    ],
  );
  assert.equal(
    verifyMicroProfileArtifacts(profile, `${runtime}\n// drift`, declaration)[0].code,
    'CODEGEN_MICRO_RUNTIME_DIGEST_DRIFT',
  );
} finally {
  rmSync(backend, { recursive: true, force: true });
}

console.log('micro profile tests passed');
