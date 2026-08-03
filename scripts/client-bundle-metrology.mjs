#!/usr/bin/env node

import assert from 'node:assert/strict';
import { brotliCompressSync, constants as zlibConstants, gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';

import { build, version as esbuildVersion } from 'esbuild';

// @ref LLP 0145#phase-a--establish-a-size-ratchet — freeze reproducible
// public-profile closures and module/package attribution before optimization.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — the
// committed baseline is CI-diffable, absolute at first run, and never loosened.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURE_DIR = join(ROOT, 'tests', 'fixtures', 'client-bundle-metrology');
const PROFILE_PATH = join(FIXTURE_DIR, 'profiles.v1.json');
const BASELINE_PATH = join(FIXTURE_DIR, 'baseline.v1.json');
const CURRENT_PATH = join(FIXTURE_DIR, 'current.v1.json');
const PACKAGE_DIR = join(ROOT, 'packages');
const METRICS = ['minifiedBytes', 'gzipBytes', 'brotliBytes'];
const PUSH_REGISTRY_MODULE = 'packages/snapback-client/push-registry.mjs';
const PUSH_INSTALLATION_EXPO_MODULE = 'packages/snapback-client/push-installation-expo.mjs';
const MICRO_CORE_MODULE = 'packages/snapback-client/micro-core.mjs';
const MICRO_LIVE_MODULE = 'packages/snapback-client/micro-live.mjs';
const BEHAVIOR_COMMANDS = Object.freeze([
  ['node', ['packages/snapback-client/package.test.mjs']],
  ['node', ['packages/snapback-client/browser-closure.test.mjs']],
  ['node', ['packages/snapback-react/package.test.mjs']],
]);
// Additive workloads append immutable ledgers; no future workload mutates an
// earlier workload's first-run receipt.
const SUPPLEMENTAL_LEDGER_SPECS = Object.freeze([
  Object.freeze({
    filename: 'baseline.push-registry.v1.json',
    profileFilename: 'push-registry-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-push-registry',
      'push-registry-attach',
      'push-registry-root-negative',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0143#d6-activation-migration-and-the-no-op-posture',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/push-registry.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.push-installation-expo.v1.json',
    profileFilename: 'push-installation-expo-profiles.v1.json',
    profileIds: Object.freeze([
      'public-subpath-push-installation-expo',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0143#d1-device-token-custody',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/push-registry.test.mjs']],
    ]),
  }),
  Object.freeze({
    filename: 'baseline.micro-phase-b.v1.json',
    profileFilename: 'micro-phase-b-profiles.v1.json',
    profileIds: Object.freeze([
      'micro-core-runtime',
      'micro-core-generated-entry',
      'micro-live-runtime',
      'micro-live-generated-entry',
      'micro-root-negative',
      'public-subpath-micro',
      'public-subpath-micro-core',
      'public-subpath-micro-live',
    ]),
    authorities: Object.freeze([
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
      'LLP 0147#implementation-sequence',
    ]),
    behaviorCommands: Object.freeze([
      ['node', ['packages/snapback-client/micro.test.mjs']],
      ['node', ['packages/snapback-codegen/micro-profile.test.mjs']],
    ]),
  }),
]);

function fail(message) {
  throw new Error(`SNAPBACK_CLIENT_BUNDLE_RATCHET_FAILED: ${message}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function gitText(args) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();
}

function baselineSourceProvenance() {
  const revision = gitText(['rev-parse', 'HEAD']);
  return {
    revision,
    packageTrees: Object.fromEntries(
      ['snapback-client', 'snapback-contract', 'snapback-react'].map((name) => [
        `packages/${name}`,
        gitText(['rev-parse', `${revision}:packages/${name}`]),
      ]),
    ),
  };
}

function validateBaselineSource(source) {
  assert.match(source?.revision ?? '', /^[0-9a-f]{40}$/u, 'baseline source revision');
  for (const [path, expected] of Object.entries(source?.packageTrees ?? {})) {
    assert.equal(
      gitText(['rev-parse', `${source.revision}:${path}`]),
      expected,
      `baseline package tree provenance for ${path}`,
    );
  }
}

function normalizePath(path) {
  const absolute = resolve(path);
  const rootPrefix = `${ROOT}${sep}`;
  if (absolute === ROOT) return '.';
  if (absolute.startsWith(rootPrefix)) return relative(ROOT, absolute).split(sep).join('/');
  return absolute.split(sep).join('/');
}

function packageForModule(path) {
  const normalized = normalizePath(path);
  const workspace = normalized.match(/^packages\/([^/]+)\//u);
  if (workspace) return `@expo/${workspace[1]}`;
  const dependency = normalized.match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/u);
  if (dependency) return dependency[1];
  if (normalized.startsWith('tests/fixtures/client-bundle-metrology/')) return '<fixture>';
  return '<repository>';
}

function exportedTarget(manifest, exportKey) {
  const target = manifest.exports?.[exportKey];
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') fail(`${manifest.name} does not export ${exportKey}`);
  return target.browser ?? target.import ?? target.default ?? fail(
    `${manifest.name} export ${exportKey} has no browser/import/default target`,
  );
}

const packageManifests = new Map();
for (const directory of ['snapback-client', 'snapback-contract', 'snapback-react']) {
  const manifestPath = join(PACKAGE_DIR, directory, 'package.json');
  const manifest = readJson(manifestPath);
  packageManifests.set(manifest.name, { directory: dirname(manifestPath), manifest });
}

function resolveWorkspaceSpecifier(specifier) {
  const match = specifier.match(/^(@expo\/[^/]+)(\/.*)?$/u);
  if (!match) return null;
  const record = packageManifests.get(match[1]);
  if (!record) return null;
  const exportKey = match[2] ? `.${match[2]}` : '.';
  const target = exportedTarget(record.manifest, exportKey);
  return resolve(record.directory, target);
}

const workspaceExports = {
  name: 'snapback-client-metrology-workspace-exports',
  setup(buildContext) {
    buildContext.onResolve({ filter: /^@expo\/(?:snapback-client|snapback-contract|snapback-react)(?:\/.*)?$/ }, (args) => {
      const path = resolveWorkspaceSpecifier(args.path);
      return path ? { path } : null;
    });
  },
};

function profileSource(profile) {
  if (profile.fixture === 'micro-core-runtime') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      'export { createMicroCoreRuntime };',
      'export function __snapbackMetrologyBehavior() {',
      "  return typeof createMicroCoreRuntime === 'function' ? 1 : 0;",
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-live-runtime') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "import { withMicroLive } from '@expo/snapback-client/micro/live';",
      'export { createMicroCoreRuntime, withMicroLive };',
      'export function __snapbackMetrologyBehavior() {',
      "  return typeof createMicroCoreRuntime === 'function' && typeof withMicroLive === 'function' ? 1 : 0;",
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-core-generated-entry') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "const generation = Object.freeze({ schemaVersion: 'snapback.v0', appId: 'metrology', schemaHash: 'sha256:schema', bundleHash: 'sha256:bundle', inputsHash: 'sha256:inputs' });",
      "const list = Object.freeze({ name: 'listTodos', kind: 'Query' });",
      "const create = Object.freeze({ name: 'createTodo', kind: 'Mutation' });",
      "const echoRef = Object.freeze({ name: 'echo', kind: 'Action' });",
      'export function createClient(options) { return createMicroCoreRuntime({ ...options, expectedGeneration: generation }); }',
      'export function listTodos(client, args) { return client.invoke(list, args); }',
      'export function createTodo(client, args) { return client.invoke(create, args); }',
      'export function echo(client, args) { return client.invoke(echoRef, args); }',
      'export function __snapbackMetrologyBehavior() {',
      "  const client = createClient({ endpoint: 'http://127.0.0.1:9' });",
      "  if (typeof client.invoke !== 'function' || 'subscribe' in client) throw new Error('core selection drifted');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-live-generated-entry') {
    return [
      "import { createMicroCoreRuntime } from '@expo/snapback-client/micro/core';",
      "import { withMicroLive } from '@expo/snapback-client/micro/live';",
      "const generation = Object.freeze({ schemaVersion: 'snapback.v0', appId: 'metrology', schemaHash: 'sha256:schema', bundleHash: 'sha256:bundle', inputsHash: 'sha256:inputs' });",
      "const watch = Object.freeze({ name: 'watchTodos', kind: 'LiveQuery' });",
      'export function createClient(options) { return withMicroLive(createMicroCoreRuntime({ ...options, expectedGeneration: generation })); }',
      'export function watchTodos(client, args, options) { return client.subscribe(watch, args, options); }',
      'export function __snapbackMetrologyBehavior() {',
      "  const client = createClient({ endpoint: 'http://127.0.0.1:9' });",
      "  if (typeof client.invoke !== 'function' || typeof client.subscribe !== 'function') throw new Error('live selection drifted');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'micro-root-negative') {
    return [
      "import * as root from '@expo/snapback-client';",
      "import * as online from '@expo/snapback-client/online';",
      'export function __snapbackMetrologyBehavior() {',
      "  for (const surface of [root, online]) if ('createMicroRuntime' in surface || 'createMicroCoreRuntime' in surface || 'withMicroLive' in surface) throw new Error('Micro leaked into a compatibility surface');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'push-registry-attach') {
    return [
      "import { SnapbackClient } from '@expo/snapback-client';",
      "import { attachPushRegistry, newPushInstallationId } from '@expo/snapback-client/push-registry';",
      'export function __snapbackMetrologyBehavior() {',
      "  const storage = { read: () => null, write: () => {}, clear: () => {} };",
      "  const client = attachPushRegistry(new SnapbackClient('http://127.0.0.1:9'), { pushInstallationStorage: storage });",
      "  if (typeof client.push?.registerToken !== 'function') throw new Error('push registry did not attach');",
      "  if (!/^inst_[0-7][0-9a-hjkmnp-tv-z]{25}$/u.test(newPushInstallationId())) throw new Error('push installation id is invalid');",
      '  return 1;',
      '}',
    ].join('\n');
  }
  if (profile.fixture === 'push-registry-root-negative') {
    return [
      "import * as root from '@expo/snapback-client';",
      'export function __snapbackMetrologyBehavior() {',
      "  if ('attachPushRegistry' in root || 'newPushInstallationId' in root) throw new Error('push leaked into the root export');",
      "  const client = new root.SnapbackClient('http://127.0.0.1:9');",
      "  if ('push' in client) throw new Error('push leaked into the root client');",
      "  if (root.SnapbackClient.prototype.health.length !== 0) throw new Error('root health signature changed');",
      "  if (root.SnapbackClient.auth.length !== 1) throw new Error('root auth signature changed');",
      "  if (root.SnapbackClient.roomPermission.length !== 2) throw new Error('root roomPermission signature changed');",
      "  const auth = root.SnapbackClient.auth('fixture', { permissions: ['read'] });",
      "  if (auth.principal !== 'fixture' || auth.permissions[0] !== 'read') throw new Error('root auth behavior changed');",
      "  if (root.SnapbackClient.roomPermission('room', { id: 1 }) !== 'room:2:id=1:1') throw new Error('root roomPermission behavior changed');",
      '  return Object.keys(root).length;',
      '}',
    ].join('\n');
  }
  if (profile.namespace === true) {
    return [
      `import * as measured from ${JSON.stringify(profile.package)};`,
      'export function __snapbackMetrologyBehavior() {',
      '  const keys = Object.keys(measured);',
      `  if (keys.length === 0) throw new Error(${JSON.stringify(`${profile.id}: empty public surface`)});`,
      '  return keys.length;',
      '}',
    ].join('\n');
  }
  const imports = profile.imports ?? [];
  const uses = profile.uses ?? [];
  return [
    `import { ${imports.join(', ')} } from ${JSON.stringify(profile.package)};`,
    'export function __snapbackMetrologyBehavior() {',
    `  const selected = [${uses.map((use) => `typeof ${use}`).join(', ')}];`,
    `  if (selected.some((value) => value !== 'function')) throw new Error(${JSON.stringify(`${profile.id}: selected surface is not callable`)});`,
    '  return selected.length;',
    '}',
  ].join('\n');
}

function publicSubpathProfiles(config) {
  const record = packageManifests.get(config.publicSubpaths.package);
  const excluded = new Set(config.publicSubpaths.exclude ?? []);
  return Object.keys(record.manifest.exports)
    .filter((key) => !excluded.has(key))
    .sort()
    .map((key) => ({
      id: `public-subpath-${key === '.' ? 'root' : key.slice(2).replaceAll('/', '-')}`,
      package: key === '.' ? record.manifest.name : `${record.manifest.name}/${key.slice(2)}`,
      namespace: true,
    }));
}

function normalizedMetafile(metafile, outputBytes) {
  const inputs = Object.fromEntries(
    Object.entries(metafile.inputs)
      .map(([path, input]) => [normalizePath(path), {
        bytes: input.bytes,
        imports: input.imports
          .map((entry) => ({
            path: entry.external ? entry.path : normalizePath(entry.path),
            kind: entry.kind,
            external: entry.external === true,
          }))
          .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      }])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  const output = Object.values(metafile.outputs)[0];
  const entryPoint = output.entryPoint ? normalizePath(output.entryPoint) : '<stdin>';
  return {
    inputs,
    output: {
      bytes: outputBytes,
      entryPoint,
      imports: output.imports
        .map((entry) => ({ path: entry.path, kind: entry.kind, external: entry.external === true }))
        .sort((left, right) => left.path.localeCompare(right.path) || left.kind.localeCompare(right.kind)),
      inputs: Object.fromEntries(
        Object.entries(output.inputs)
          .map(([path, value]) => [normalizePath(path), { bytesInOutput: value.bytesInOutput }])
          .sort(([left], [right]) => left.localeCompare(right)),
      ),
    },
  };
}

function attributionFor(metafile) {
  const modules = Object.entries(metafile.output.inputs)
    .map(([path, value]) => ({
      module: path,
      package: packageForModule(path),
      bytes: value.bytesInOutput,
    }))
    .sort((left, right) => right.bytes - left.bytes || left.module.localeCompare(right.module));
  const packages = new Map();
  for (const module of modules) packages.set(module.package, (packages.get(module.package) ?? 0) + module.bytes);
  return {
    packages: [...packages]
      .map(([name, bytes]) => ({ name, bytes }))
      .sort((left, right) => right.bytes - left.bytes || left.name.localeCompare(right.name)),
    modules,
  };
}

async function executeBundle(profile, contents) {
  // Keep the transient module below the workspace node_modules directory so
  // intentionally external peer dependencies (React) resolve exactly as they
  // do for the package tests. The directory is removed in the same turn.
  const directory = mkdtempSync(join(ROOT, 'node_modules', '.snapback-client-metrology-'));
  const path = join(directory, `${profile.id}.mjs`);
  try {
    writeFileSync(path, contents);
    const module = await import(`${pathToFileURL(path).href}?sha256=${sha256(contents)}`);
    assert.equal(typeof module.__snapbackMetrologyBehavior, 'function', `${profile.id}: behavior export`);
    assert.ok(await module.__snapbackMetrologyBehavior(), `${profile.id}: behavior assertion`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

async function measureProfile(profile) {
  const source = profileSource(profile);
  const result = await build({
    stdin: {
      contents: source,
      resolveDir: FIXTURE_DIR,
      sourcefile: `tests/fixtures/client-bundle-metrology/${profile.id}.fixture.mjs`,
      loader: 'js',
    },
    absWorkingDir: ROOT,
    bundle: true,
    conditions: ['browser', 'import', 'default'],
    define: { 'process.env.NODE_ENV': '"production"' },
    external: profile.external ?? [],
    format: 'esm',
    legalComments: 'none',
    logLevel: 'silent',
    metafile: true,
    minify: true,
    platform: 'browser',
    plugins: [workspaceExports],
    target: 'es2022',
    treeShaking: true,
    write: false,
  });
  assert.equal(result.outputFiles.length, 1, `${profile.id}: exactly one output`);
  const bytes = result.outputFiles[0].contents;
  await executeBundle(profile, bytes);
  const metafile = normalizedMetafile(result.metafile, bytes.byteLength);
  return {
    id: profile.id,
    package: profile.package,
    fixtureSha256: sha256(source),
    externals: [...(profile.external ?? [])].sort(),
    minifiedBytes: bytes.byteLength,
    gzipBytes: gzipSync(bytes, { level: 9 }).byteLength,
    brotliBytes: brotliCompressSync(bytes, {
      params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 11 },
    }).byteLength,
    outputSha256: sha256(bytes),
    attribution: attributionFor(metafile),
    metafile,
  };
}

function commandStrings(commands) {
  return commands.map(([command, args]) => [command, ...args].join(' '));
}

function runBehaviorCommands(commands) {
  for (const [command, args] of commands) {
    execFileSync(command, args, { cwd: ROOT, stdio: 'inherit' });
  }
}

function additiveProfileIds() {
  return SUPPLEMENTAL_LEDGER_SPECS.flatMap((spec) => spec.profileIds);
}

function assertDeclaredAdditiveProfiles(additiveConfigs, profiles) {
  const measured = new Set(profiles.map((profile) => profile.id));
  for (const { spec, config } of additiveConfigs) {
    const declared = [
      ...config.profiles.map((profile) => profile.id),
      ...spec.profileIds.filter((id) => id.startsWith('public-subpath-')),
    ].sort();
    assert.deepEqual(declared, spec.profileIds.toSorted(), `${spec.filename}: declared ids`);
    for (const id of declared) assert.ok(measured.has(id), `${id}: additive profile exists`);
  }
}

function assertPushRegistryClosure(profiles) {
  const positive = new Set(['public-subpath-push-registry', 'push-registry-attach']);
  const negative = new Set(['push-registry-root-negative']);
  const additive = new Set(additiveProfileIds());
  for (const profile of profiles) {
    const includesPushRegistry = Object.hasOwn(
      profile.metafile.inputs,
      PUSH_REGISTRY_MODULE,
    );
    if (positive.has(profile.id)) {
      assert.equal(includesPushRegistry, true, `${profile.id}: positive push closure`);
    } else if (negative.has(profile.id) || !additive.has(profile.id)) {
      assert.equal(includesPushRegistry, false, `${profile.id}: negative push closure`);
    }
  }
}

function assertExpoPushInstallationClosure(profiles) {
  const profile = profiles.find(
    (candidate) => candidate.id === 'public-subpath-push-installation-expo',
  );
  assert.ok(profile, 'Expo push installation storage profile is present');
  assert.equal(
    Object.hasOwn(profile.metafile.inputs, PUSH_INSTALLATION_EXPO_MODULE),
    true,
    'Expo push installation subpath includes its storage adapter',
  );
  assert.equal(
    Object.hasOwn(profile.metafile.inputs, PUSH_REGISTRY_MODULE),
    false,
    'Expo push installation subpath keeps the push registry runtime type-only',
  );
}

function assertMicroClosure(profiles) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const core = byId.get('micro-core-generated-entry');
  const live = byId.get('micro-live-generated-entry');
  const coreRuntime = byId.get('micro-core-runtime');
  const liveRuntime = byId.get('micro-live-runtime');
  const negative = byId.get('micro-root-negative');
  assert.ok(core && live && coreRuntime && liveRuntime && negative, 'Micro supplemental profiles are present');
  assert.ok(Object.hasOwn(core.metafile.inputs, MICRO_CORE_MODULE), 'Micro core includes its core module');
  assert.equal(Object.hasOwn(core.metafile.inputs, MICRO_LIVE_MODULE), false, 'Micro core excludes live');
  assert.ok(Object.hasOwn(live.metafile.inputs, MICRO_CORE_MODULE), 'Micro live includes core');
  assert.ok(Object.hasOwn(live.metafile.inputs, MICRO_LIVE_MODULE), 'Micro live includes live');
  for (const profile of [core, live]) {
    for (const forbidden of [
      'packages/snapback-client/index.mjs',
      'packages/snapback-client/rqs.mjs',
      'packages/snapback-client/outbox-shared.mjs',
      'packages/snapback-client/rqs-store-file.mjs',
    ]) {
      assert.equal(Object.hasOwn(profile.metafile.inputs, forbidden), false, `${profile.id}: excludes ${forbidden}`);
    }
  }
  assert.ok(coreRuntime.gzipBytes <= 20_000, `Micro core runtime ${coreRuntime.gzipBytes} <= 20 kB gzip`);
  assert.ok(liveRuntime.gzipBytes <= 20_000, `Micro live runtime ${liveRuntime.gzipBytes} <= 20 kB gzip`);
  assert.ok(core.gzipBytes <= 25_000, `Micro core generated entry ${core.gzipBytes} <= 25 kB gzip`);
  assert.ok(live.gzipBytes <= 25_000, `Micro live generated entry ${live.gzipBytes} <= 25 kB gzip`);
  assert.equal(Object.hasOwn(negative.metafile.inputs, MICRO_CORE_MODULE), false, 'root/online exclude Micro core');
  assert.equal(Object.hasOwn(negative.metafile.inputs, MICRO_LIVE_MODULE), false, 'root/online exclude Micro live');
}

async function measure() {
  const configBytes = readFileSync(PROFILE_PATH);
  const config = JSON.parse(configBytes);
  assert.equal(config.schemaVersion, 'snapback.client-bundle-metrology-profiles.v1');
  const additiveConfigs = SUPPLEMENTAL_LEDGER_SPECS.map((spec) => {
    const bytes = readFileSync(join(FIXTURE_DIR, spec.profileFilename));
    const config = JSON.parse(bytes);
    assert.equal(
      config.schemaVersion,
      'snapback.client-bundle-metrology-additive-profiles.v1',
    );
    return { spec, bytes, config };
  });
  const profiles = [
    ...config.profiles,
    ...additiveConfigs.flatMap((entry) => entry.config.profiles),
    ...publicSubpathProfiles(config),
  ];
  const ids = profiles.map((profile) => profile.id);
  assert.equal(new Set(ids).size, ids.length, 'profile ids must be unique');
  assertDeclaredAdditiveProfiles(additiveConfigs, profiles);
  const measured = [];
  for (const profile of profiles) measured.push(await measureProfile(profile));
  measured.sort((left, right) => left.id.localeCompare(right.id));
  assertPushRegistryClosure(measured);
  assertExpoPushInstallationClosure(measured);
  assertMicroClosure(measured);
  runBehaviorCommands(BEHAVIOR_COMMANDS);
  for (const { spec } of additiveConfigs) runBehaviorCommands(spec.behaviorCommands);
  return {
    schemaVersion: 'snapback.client-bundle-metrology.v1',
    authorities: [
      'LLP 0145#phase-a--establish-a-size-ratchet',
      'LLP 0063#workstream-8--performance-and-packaging-budgets',
    ],
    method: {
      runtime: {
        node: process.version,
        zlib: process.versions.zlib,
        brotli: process.versions.brotli,
      },
      bundler: `esbuild@${esbuildVersion}`,
      bundle: true,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      minify: true,
      treeShaking: true,
      legalComments: 'none',
      conditions: ['browser', 'import', 'default'],
      gzipLevel: 9,
      brotliQuality: 11,
      reactExternal: true,
      attribution: 'esbuild module-own bytesInOutput grouped by stable package boundary',
    },
    inputs: {
      profilesSha256: sha256(configBytes),
      lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
    },
    behaviorCommands: commandStrings(BEHAVIOR_COMMANDS),
    additiveLedgers: additiveConfigs.map(({ spec, bytes }) => ({
      filename: spec.filename,
      inputs: {
        profilesSha256: sha256(bytes),
        lockfileSha256: sha256(readFileSync(join(ROOT, 'bun.lock'))),
      },
      behaviorCommands: commandStrings(spec.behaviorCommands),
    })),
    profiles: measured,
  };
}

function compactSupplementalBaseline(report, spec, profiles) {
  const evidence = report.additiveLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: additive evidence`);
  return {
    schemaVersion: 'snapback.client-bundle-metrology-supplemental-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: spec.authorities,
    frozenRule: 'prospective additive profile first run; valid ceilings never loosen',
    method: report.method,
    inputs: evidence.inputs,
    behaviorCommands: evidence.behaviorCommands,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      package: profile.package,
      fixtureSha256: profile.fixtureSha256,
      externals: profile.externals,
      minifiedBytes: profile.minifiedBytes,
      gzipBytes: profile.gzipBytes,
      brotliBytes: profile.brotliBytes,
      outputSha256: profile.outputSha256,
      attribution: profile.attribution,
      metafile: profile.metafile,
    })),
  };
}

function compactBaseline(report, profiles) {
  return {
    schemaVersion: 'snapback.client-bundle-metrology-baseline.v1',
    source: baselineSourceProvenance(),
    authorities: report.authorities,
    frozenRule: 'first attributed run before optimization; valid ceilings never loosen',
    method: report.method,
    inputs: report.inputs,
    behaviorCommands: report.behaviorCommands,
    profiles: profiles.map((profile) => ({
      id: profile.id,
      package: profile.package,
      fixtureSha256: profile.fixtureSha256,
      externals: profile.externals,
      minifiedBytes: profile.minifiedBytes,
      gzipBytes: profile.gzipBytes,
      brotliBytes: profile.brotliBytes,
      outputSha256: profile.outputSha256,
      attribution: profile.attribution,
      metafile: profile.metafile,
    })),
  };
}

function validateMainBaseline(report, baseline) {
  assert.equal(baseline.schemaVersion, 'snapback.client-bundle-metrology-baseline.v1');
  validateBaselineSource(baseline.source);
  assert.deepEqual(report.authorities, baseline.authorities, 'baseline authorities');
  assert.deepEqual(report.method, baseline.method, 'baseline measurement method');
  assert.deepEqual(report.inputs, baseline.inputs, 'baseline input digests');
  assert.deepEqual(report.behaviorCommands, baseline.behaviorCommands, 'baseline behavior commands');
}

function validateSupplementalBaseline(report, spec, supplemental) {
  assert.equal(
    supplemental.schemaVersion,
    'snapback.client-bundle-metrology-supplemental-baseline.v1',
  );
  validateBaselineSource(supplemental.source);
  const evidence = report.additiveLedgers.find((entry) => entry.filename === spec.filename);
  assert.ok(evidence, `${spec.filename}: additive evidence`);
  assert.deepEqual(spec.authorities, supplemental.authorities, 'supplemental authorities');
  assert.deepEqual(report.method, supplemental.method, 'supplemental measurement method');
  assert.deepEqual(evidence.inputs, supplemental.inputs, 'supplemental inputs');
  assert.deepEqual(
    evidence.behaviorCommands,
    supplemental.behaviorCommands,
    'supplemental behavior commands',
  );
  assert.deepEqual(
    supplemental.profiles.map((profile) => profile.id).toSorted(),
    spec.profileIds.toSorted(),
    `${spec.filename}: exact additive profile ids`,
  );
}

function compareProfiles(report, baselines, { requireComplete = true } = {}) {
  const currentById = new Map(report.profiles.map((profile) => [profile.id, profile]));
  const baselineById = new Map();
  for (const baseline of baselines) {
    for (const profile of baseline.profiles) {
      if (baselineById.has(profile.id)) fail(`profile ${profile.id} has overlapping baselines`);
      baselineById.set(profile.id, profile);
    }
  }
  const regressions = [];
  for (const [id, profile] of currentById) {
    const frozen = baselineById.get(id);
    if (!frozen) {
      if (requireComplete) {
        fail(`profile ${id} has no frozen baseline; add it prospectively before changing its closure`);
      }
      continue;
    }
    for (const metric of METRICS) {
      if (profile[metric] > frozen[metric]) {
        regressions.push(`${id} ${metric} regressed from ${frozen[metric]} to ${profile[metric]} bytes`);
      }
    }
  }
  for (const id of baselineById.keys()) {
    if (!currentById.has(id)) fail(`frozen profile ${id} disappeared`);
  }
  if (regressions.length > 0) fail(regressions.join('; '));
}

function compareToBaselines(report, baseline, supplementals) {
  for (const { spec, baseline: supplemental } of supplementals) {
    validateSupplementalBaseline(report, spec, supplemental);
  }
  compareProfiles(report, [baseline, ...supplementals.map((entry) => entry.baseline)]);
}

function withSavings(report, baseline, supplementals) {
  const baselineById = new Map(
    [baseline, ...supplementals.map((entry) => entry.baseline)]
      .flatMap((entry) => entry.profiles)
      .map((profile) => [profile.id, profile]),
  );
  return {
    ...report,
    comparedTo: ['baseline.v1.json', ...supplementals.map(({ spec }) => spec.filename)],
    profiles: report.profiles.map((profile) => {
      const frozen = baselineById.get(profile.id);
      return {
        ...profile,
        savings: Object.fromEntries(METRICS.map((metric) => [metric, frozen[metric] - profile[metric]])),
      };
    }),
  };
}

function readSupplementalBaselines() {
  return SUPPLEMENTAL_LEDGER_SPECS.map((spec) => {
    const path = join(FIXTURE_DIR, spec.filename);
    if (!existsSync(path)) fail(`${spec.filename} is missing`);
    return { spec, baseline: readJson(path) };
  });
}

function assertExactProspectiveAdditions(report, baseline) {
  const covered = new Set(baseline.profiles.map((profile) => profile.id));
  const additions = report.profiles.filter((profile) => !covered.has(profile.id));
  assert.deepEqual(
    additions.map((profile) => profile.id).toSorted(),
    additiveProfileIds().toSorted(),
    'prospective additions exactly match the declared additive ledgers',
  );
  return additions;
}

function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

const mode = process.argv[2] ?? '--check';
if (![
  '--check',
  '--check-primary',
  '--write-baseline',
  '--write-current',
  '--write-supplemental-baseline',
].includes(mode)) {
  console.error('usage: node scripts/client-bundle-metrology.mjs [--check|--check-primary|--write-baseline|--write-current|--write-supplemental-baseline]');
  process.exit(2);
}

const report = await measure();
if (mode === '--write-baseline') {
  if (existsSync(BASELINE_PATH)) fail('baseline.v1.json already exists; the first-run baseline is immutable');
  const additiveIds = new Set(additiveProfileIds());
  const primaryProfiles = report.profiles.filter((profile) => !additiveIds.has(profile.id));
  const baseline = compactBaseline(report, primaryProfiles);
  writeFileSync(BASELINE_PATH, stableJson(baseline));
  const primaryReport = { ...report, profiles: primaryProfiles };
  writeFileSync(CURRENT_PATH, stableJson(withSavings(primaryReport, baseline, [])));
  console.log(`client bundle baseline frozen: ${primaryProfiles.length} primary profiles`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) fail('baseline.v1.json is missing');
const baseline = readJson(BASELINE_PATH);
validateMainBaseline(report, baseline);
if (mode === '--check-primary') {
  compareProfiles(report, [baseline], { requireComplete: false });
  const additions = assertExactProspectiveAdditions(report, baseline);
  console.log(`client bundle primary baseline passed; ${additions.length} additive profiles await a prospective baseline`);
  process.exit(0);
}
if (mode === '--write-supplemental-baseline') {
  compareProfiles(report, [baseline], { requireComplete: false });
  const additions = assertExactProspectiveAdditions(report, baseline);
  const missing = SUPPLEMENTAL_LEDGER_SPECS.filter(
    (spec) => !existsSync(join(FIXTURE_DIR, spec.filename)),
  );
  if (missing.length !== 1) {
    fail(`expected exactly one unfrozen supplemental ledger, found ${missing.length}`);
  }
  const spec = missing[0];
  const selected = additions.filter((profile) => spec.profileIds.includes(profile.id));
  const supplemental = compactSupplementalBaseline(report, spec, selected);
  writeFileSync(join(FIXTURE_DIR, spec.filename), stableJson(supplemental));
  const supplementals = readSupplementalBaselines();
  writeFileSync(CURRENT_PATH, stableJson(withSavings(report, baseline, supplementals)));
  console.log(`client bundle additive baseline frozen in ${spec.filename}: ${selected.length} profiles`);
  process.exit(0);
}
const supplementals = readSupplementalBaselines();
compareToBaselines(report, baseline, supplementals);
const current = withSavings(report, baseline, supplementals);
if (mode === '--write-current') {
  writeFileSync(CURRENT_PATH, stableJson(current));
  console.log(`client bundle current report updated: ${report.profiles.length} profiles`);
  process.exit(0);
}

if (!existsSync(CURRENT_PATH)) fail('current.v1.json is missing');
const committed = readFileSync(CURRENT_PATH, 'utf8');
const generated = stableJson(current);
if (committed !== generated) {
  fail('current.v1.json is stale; run node scripts/client-bundle-metrology.mjs --write-current');
}
console.log(`client bundle metrology passed: ${report.profiles.length} profiles, no frozen ceiling regressions`);
