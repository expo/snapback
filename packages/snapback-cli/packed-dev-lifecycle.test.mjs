// @ref LLP 0223#dated-amendment--2026-08-21-d01-ruling--the-canonical-development-lifecycle — packed Expo-provider, real-Vite, and headless consumers share the receipt-bound dev lifecycle and prove additive sessions continuity without their own carrier or binding environment. Exact-runtime evidence remains LLP 0295 W7.
// @ref LLP 0295#r1-cheap-external-journey — the optional arm/profile driver
// runs each client/profile cell from a fresh package closure and emits the
// password-custody, two-client-live, and additive-successor receipt R1 needs.

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, webcrypto } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, relative, resolve, sep } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const packagesRoot = join(repoRoot, 'packages');
const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
  ?? join(repoRoot, 'target', 'debug', 'snapback');
const runtimeReadiness = `${runtimeBinary}.runtime-readiness.json`;

const selectedArm = process.env.SNAPBACK_R1_ARM ?? 'all';
const selectedProfile = process.env.SNAPBACK_R1_PROFILE ?? 'explicit';
const r1ReceiptPath = process.env.SNAPBACK_R1_RECEIPT_PATH ?? null;
assert.ok(
  ['all', 'headless', 'vite-exact', 'expo'].includes(selectedArm),
  `SNAPBACK_R1_ARM must be all, headless, vite-exact, or expo (received ${selectedArm})`,
);
assert.ok(
  ['explicit', 'familiar'].includes(selectedProfile),
  `SNAPBACK_R1_PROFILE must be explicit or familiar (received ${selectedProfile})`,
);
assert.ok(
  selectedArm !== 'all' || selectedProfile === 'explicit',
  'the legacy all-arm control is Explicit; R1 Familiar probes select one arm',
);
const r1Mode = selectedArm !== 'all';
const authoringProfile = selectedProfile === 'familiar'
  ? 'snapback-familiar-ts-v1'
  : 'snapback-explicit-v1';
const runArm = (arm) => selectedArm === 'all' || selectedArm === arm;

assert.ok(
  existsSync(runtimeBinary) && existsSync(runtimeReadiness),
  'packed lifecycle proof requires the bootstrap-qualified native runtime',
);

const scratchRoot = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-packed-dev-lifecycle-')));
const externalRoot = join(scratchRoot, 'external-consumer');
const artifactRoot = join(externalRoot, '.snapback', 'packed-packages');
const externalRuntimeRoot = join(scratchRoot, 'qualified-runtime');
const qualifiedRuntimeBinary = join(externalRuntimeRoot, 'bin', 'snapback');
const metroScript = join(externalRoot, 'packed-metro.mjs');
const packageManager = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).packageManager;
const expectedBun = /^bun@(.+)$/u.exec(packageManager)?.[1];
assert.ok(expectedBun, 'repository packageManager must pin Bun');
const r1Receipts = [];

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? externalRoot,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    timeout: options.timeout ?? 600_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed:\n${result.stderr || result.stdout || result.error?.message}`,
  );
  return result;
}

function resolveCommandPath(command) {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    if (!directory) continue;
    const candidate = join(directory, command);
    if (existsSync(candidate)) return resolve(candidate);
  }
  assert.fail(`${command} must resolve from PATH for the structured R1 setup receipt`);
}

function setupReceipt(packageClosure) {
  // @ref LLP 0295#w6-instrument-and-context-economy — setup/toolchain facts
  // stay machine-readable beside the result so a local harness mismatch cannot
  // be misclassified as a packed-product failure.
  return Object.freeze({
    schemaVersion: 'snapback.r1-probe-setup.v1',
    observedAtProbe: true,
    toolchain: Object.freeze({
      node: Object.freeze({
        path: realpathSync(process.execPath),
        version: process.version,
      }),
      bun: Object.freeze({
        path: resolveCommandPath('bun'),
        version: run('bun', ['--version']).stdout.trim(),
      }),
      cargo: Object.freeze({
        path: resolveCommandPath('cargo'),
        version: run('cargo', ['--version'], { cwd: repoRoot }).stdout.trim(),
      }),
      rustc: Object.freeze({
        path: resolveCommandPath('rustc'),
        version: run('rustc', ['--version'], { cwd: repoRoot }).stdout.trim(),
      }),
    }),
    packedPackages: packageClosure,
  });
}

function packageInventory() {
  const inventory = new Map();
  for (const entry of readdirSync(packagesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const root = join(packagesRoot, entry.name);
    const manifestPath = join(root, 'package.json');
    if (!existsSync(manifestPath)) continue;
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    inventory.set(manifest.name, { manifest, root: realpathSync(root) });
  }
  return inventory;
}

function packedDependencyClosure(rootNames) {
  const inventory = packageInventory();
  const closure = new Map();
  const pending = [...rootNames];
  while (pending.length > 0) {
    const name = pending.shift();
    if (closure.has(name)) continue;
    const source = inventory.get(name);
    assert.ok(source, `local packed closure is missing ${name}`);
    closure.set(name, source);
    for (const dependency of Object.keys({
      ...(source.manifest.dependencies ?? {}),
      ...(source.manifest.optionalDependencies ?? {}),
    })) {
      if (dependency.startsWith('@expo/snapback-')) pending.push(dependency);
    }
  }
  return closure;
}

function localSpecifier(from, path) {
  let value = relative(from, path).split(sep).join('/');
  if (!value.startsWith('.')) value = `./${value}`;
  return `file:${value}`;
}

function materializePackedPackages() {
  assert.equal(run('bun', ['--version']).stdout.trim(), expectedBun);
  mkdirSync(artifactRoot, { recursive: true });
  const closure = packedDependencyClosure([
    '@expo/snapback-cli',
    '@expo/snapback-client',
    '@expo/snapback-expo',
    '@expo/snapback-vite',
  ]);
  const specifiers = {};
  const tarballs = {};
  for (const [name, source] of [...closure].sort(([left], [right]) => left.localeCompare(right))) {
    if (name === '@expo/snapback-codegen') {
      run(process.execPath, ['prepare-runtime-artifacts.mjs'], { cwd: source.root });
    }
    const filename = `${name.slice('@expo/snapback-'.length)}.tgz`;
    const artifact = join(artifactRoot, filename);
    run('bun', [
      'pm',
      'pack',
      '--ignore-scripts',
      '--filename', artifact,
      '--quiet',
    ], { cwd: source.root });
    assert.ok(existsSync(artifact), `${name} produced a package tarball`);
    specifiers[name] = localSpecifier(externalRoot, artifact);
    tarballs[name] = artifact;
  }

  writeFileSync(join(externalRoot, 'package.json'), `${JSON.stringify({
    name: 'snapback-packed-dev-lifecycle-consumer',
    version: '1.0.0',
    private: true,
    type: 'module',
    packageManager,
    dependencies: {
      '@expo/snapback-cli': specifiers['@expo/snapback-cli'],
      '@expo/snapback-client': specifiers['@expo/snapback-client'],
      '@expo/snapback-expo': specifiers['@expo/snapback-expo'],
      '@expo/snapback-vite': specifiers['@expo/snapback-vite'],
      'fake-indexeddb': '^6.2.5',
      'vite': '^8.0.0',
    },
    overrides: specifiers,
  }, null, 2)}\n`);
  run('bun', ['install']);

  for (const name of closure.keys()) {
    const installed = join(externalRoot, 'node_modules', ...name.split('/'));
    if (!existsSync(installed)) continue;
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} is materialized`);
    assert.ok(
      !realpathSync(installed).startsWith(packagesRoot),
      `${name} must not resolve into the source workspace`,
    );
  }
  return Object.freeze(tarballs);
}

function materializeQualifiedRuntime() {
  const receipt = JSON.parse(readFileSync(runtimeReadiness, 'utf8'));
  mkdirSync(dirname(qualifiedRuntimeBinary), { recursive: true });
  symlinkSync(runtimeBinary, qualifiedRuntimeBinary);
  copyFileSync(runtimeReadiness, `${qualifiedRuntimeBinary}.runtime-readiness.json`);
  for (const artifact of receipt.artifacts) {
    const target = join(externalRuntimeRoot, artifact.path);
    mkdirSync(dirname(target), { recursive: true });
    symlinkSync(join(repoRoot, artifact.path), target);
  }
}

function writeMetroFixture() {
  writeFileSync(metroScript, `
import { existsSync } from 'node:fs';
import { createServer } from 'node:http';

const port = Number(process.env.SNAPBACK_EXPO_METRO_PORT);
const supervisorDescriptor = process.env.SNAPBACK_PACKED_SUPERVISOR_DESCRIPTOR;
const server = createServer((_request, response) => {
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ ok: true }));
});
server.listen(port, '127.0.0.1', () => {
  console.log(JSON.stringify({ event: 'metro-ready', host: '127.0.0.1', port }));
});
let closing = false;
let observedSupervisorDescriptor = false;
const close = () => {
  if (closing) return;
  closing = true;
  clearInterval(supervisorWatch);
  server.close(() => process.exit(0));
};
const supervisorWatch = setInterval(() => {
  if (existsSync(supervisorDescriptor)) observedSupervisorDescriptor = true;
  else if (observedSupervisorDescriptor) close();
}, 50);
supervisorWatch.unref();
process.once('SIGINT', close);
process.once('SIGTERM', close);
`);
}

async function freeLoopbackPort() {
  const server = createNetServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolveClose, rejectClose) => {
    server.close((error) => (error ? rejectClose(error) : resolveClose()));
  });
  return address.port;
}

async function eventually(check, { timeoutMs = 15_000, label = 'condition' } = {}) {
  const deadline = Date.now() + timeoutMs;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const value = await check();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ''}`);
}

function scaffoldLane(scaffoldApp, name, template = 'react') {
  const projectRoot = join(externalRoot, name);
  const scaffolded = scaffoldApp(projectRoot, { template });
  assert.equal(scaffolded.ok, true);
  assert.deepEqual(
    scaffolded.lifecycle.stages,
    ['scaffold', 'install', 'generate', 'dev', 'prove'],
    `${template} must bind W1's runtime lifecycle to VCF-E-L1's scaffolded command path`,
  );
  const backendRoot = join(projectRoot, 'snapback');
  return {
    name,
    projectRoot,
    backendRoot,
    schemaPath: join(backendRoot, 'schema.mjs'),
    generatedApiPath: join(backendRoot, 'generated', 'api.mjs'),
    stateRoot: join(projectRoot, '.snapback'),
    readyFile: join(projectRoot, '.snapback', 'dev.ready.json'),
    database: join(projectRoot, '.snapback', 'dev.sqlite3'),
  };
}

function installScaffoldLane(lane, packedTarballs) {
  const manifestPath = join(lane.projectRoot, 'package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const requiredPackages = new Set();
  const overrides = Object.fromEntries(
    Object.entries(packedTarballs).map(([name, tarball]) => [name, `file:${tarball}`]),
  );
  for (const section of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[section] ?? {})) {
      const tarball = packedTarballs[name];
      if (tarball === undefined) continue;
      const specifier = `file:${tarball}`;
      manifest[section][name] = specifier;
      requiredPackages.add(name);
    }
  }
  manifest.overrides = { ...(manifest.overrides ?? {}), ...overrides };
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  run('bun', ['install'], { cwd: lane.projectRoot });
  for (const name of requiredPackages) {
    const installed = join(lane.projectRoot, 'node_modules', ...name.split('/'));
    assert.ok(existsSync(installed), `${lane.name} install materializes ${name}`);
    assert.equal(lstatSync(installed).isSymbolicLink(), false, `${name} must not be a workspace link`);
  }
}

function configureAuthoringProfile(lane) {
  if (!r1Mode) return;
  for (const name of ['schema.mjs', 'functions.mjs', 'seed.json']) {
    rmSync(join(lane.backendRoot, name), { force: true });
  }
  rmSync(join(lane.backendRoot, 'generated'), { recursive: true, force: true });
  if (selectedProfile === 'explicit') {
    writeFileSync(join(lane.backendRoot, 'schema.mjs'), `
import { defineAuth, defineSchema, defineTable, v } from '@expo/snapback-codegen/define';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
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

export default defineSchema({
  records: defineTable({ value: v.string() })
    .visibility({ kind: 'public-read' })
    .index('by_value', ['value']),
}, { auth: { mode: 'sessions' }, authProgram });
`);
    writeFileSync(join(lane.backendRoot, 'functions.mjs'), `
import {
  arg,
  bindingRef,
  defineLiveQuery,
  defineMutation,
  insert,
  returnDocument,
  v,
} from '@expo/snapback-codegen/define';

const listRecords = defineLiveQuery({
  args: {},
  auth: 'authenticated',
  table: 'records',
  index: 'by_value',
});

const createRecord = defineMutation({
  args: { value: v.string() },
  auth: 'authenticated',
  plan: insert('records', { value: arg('value') }, { bindIdAs: 'recordId' }),
  returns: returnDocument('records', bindingRef('recordId')),
});

export { listRecords as 'records.listRecords', createRecord as 'records.createRecord' };
`);
    lane.schemaPath = join(lane.backendRoot, 'schema.mjs');
    return;
  }
  writeFileSync(join(lane.backendRoot, 'codegen.policy.json'), `${JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }, null, 2)}\n`);
  writeFileSync(join(lane.backendRoot, 'schema.ts'), `
import { defineAuth } from '@expo/snapback-codegen/define';
import { defineSchema, defineTable, v } from './generated/server';

const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: {
      kind: 'password',
      identifier: 'email',
      provider: 'builtIn',
      recovery: 'recoveryCodes',
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

export default defineSchema({
  records: defineTable({ value: v.string() })
    .visibility({ kind: 'public-read' })
    .index('by_value', ['value']),
}, { auth: { mode: 'sessions' }, authProgram });
`);
  writeFileSync(join(lane.backendRoot, 'records.ts'), `
import { mutation, query, v } from './generated/server';

export const listRecords = query({
  args: {},
  returns: v.array(v.doc('records')),
  auth: 'authenticated',
  reads: ['records'],
  handler: async (ctx) => ctx.db.query('records').withIndex('by_value').collect(),
});

export const createRecord = mutation({
  args: { value: v.string() },
  returns: v.doc('records'),
  auth: 'authenticated',
  reads: ['records'],
  writes: ['records'],
  handler: async (ctx, args) => {
    const id = await ctx.db.insert('records', args);
    const created = await ctx.db.get('records', id);
    if (created === null) return ctx.refuse('R1_RECORD_INSERT_NOT_OBSERVED');
    return created;
  },
});
`);
  lane.schemaPath = join(lane.backendRoot, 'schema.ts');
}

function packageClosureReceipt(packedTarballs) {
  const inventory = packageInventory();
  return Object.entries(packedTarballs)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, path]) => {
      const version = inventory.get(name)?.manifest?.version;
      assert.equal(typeof version, 'string', `${name} must declare its packed version`);
      return {
        name,
        version,
        sha256: `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`,
      };
    });
}

function journeyReferences(generated) {
  if (r1Mode) {
    const create = selectedProfile === 'familiar'
      ? generated.api?.records?.createRecord
      : generated.api?.['records.createRecord'];
    const list = selectedProfile === 'familiar'
      ? generated.api?.records?.listRecords
      : generated.api?.['records.listRecords'];
    assert.ok(create && list, JSON.stringify({
      moduleKeys: Object.keys(generated),
      apiKeys: Object.keys(generated.api ?? {}),
      defaultKeys: Object.keys(generated.default ?? {}),
    }));
    return {
      create,
      list,
      args: (value) => ({ value }),
      matches: (row, value) => row.value === value,
    };
  }
  return {
    create: generated.default.createTodo,
    list: generated.default.listTodos,
    args: (value) => ({ title: value }),
    matches: (row, value) => row.title === value,
  };
}

function writeAdditiveSchema(lane) {
  const predecessor = readFileSync(lane.schemaPath, 'utf8');
  const anchor = predecessor.includes('  records: defineTable({')
    ? '  records: defineTable({'
    : predecessor.includes('    todos: defineTable({')
    ? '    todos: defineTable({'
    : '    users: defineTable({';
  const indentation = anchor.startsWith('  records') ? '  ' : '    ';
  const successor = predecessor.replace(
    anchor,
    `${indentation}lifecycleLabels: defineTable({
${indentation}  name: v.string(),
${indentation}}).visibility({ kind: 'public-read' }).sync(),
${anchor}`,
  );
  assert.notEqual(successor, predecessor, `${lane.name} must add one compatible table`);
  writeFileSync(lane.schemaPath, successor);
}

function deploymentEvent(events, requestId) {
  const candidates = [];
  for (const event of events) {
    const candidate = event?.backend ?? event;
    if (candidate?.state === 'startup-successor-activated' && candidate.requestId === requestId) {
      return candidate;
    }
    if (candidate?.state === 'startup-successor-activated') candidates.push(candidate);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function importGeneratedApp(lane, generation) {
  return import(`${pathToFileURL(lane.generatedApiPath).href}?generation=${generation}-${Date.now()}`);
}

async function proveM1ToM2({
  lane,
  IDBFactory,
  createSnapbackAppClient,
  readApplicationReadyReceipt,
  binding,
  refreshBinding = async () => {},
  reload,
  events,
  expectedClientOrigins,
  expectedBindingOrigin = null,
  platformKind = 'browser',
  afterM2 = async () => null,
}) {
  const applicationReadyFile = `${lane.readyFile}.application-ready`;
  const m1Receipt = readApplicationReadyReceipt(applicationReadyFile);
  const m1Generated = await importGeneratedApp(lane, 'm1');
  const m1Binding = binding(m1Generated.app);
  assert.equal(m1Receipt.formatVersion, 'snapback.application-ready.v1');
  assert.deepEqual([...m1Receipt.clientOrigins].sort(), [...expectedClientOrigins].sort());
  assert.equal(m1Receipt.binding.descriptorIdentity, m1Binding.descriptorIdentity);
  if (expectedBindingOrigin !== null) assert.equal(m1Binding.target.origin, expectedBindingOrigin);
  assert.equal(m1Receipt.runtimeIdentity.wrapper.package, '@expo/snapback-cli');
  assert.equal(m1Receipt.runtimeIdentity.qualifiedBinary.path, qualifiedRuntimeBinary);

  const platformA = Object.freeze({
    kind: platformKind,
    broadcastChannelFactory: null,
    hintStorage: null,
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-packed-lifecycle-${lane.name}-a`,
  });
  const platformB = Object.freeze({
    kind: platformKind,
    broadcastChannelFactory: null,
    hintStorage: null,
    indexedDB: new IDBFactory(),
    cryptoObject: webcrypto,
    databaseName: `snapback-packed-lifecycle-${lane.name}-b`,
  });
  let appClientA = await createSnapbackAppClient({
    app: m1Generated.app,
    binding: m1Binding,
    platform: platformA,
    storagePartition: `${lane.name}:r1:writer`,
  });
  let appClientB = await createSnapbackAppClient({
    app: m1Generated.app,
    binding: m1Binding,
    platform: platformB,
    storagePartition: `${lane.name}:r1:observer`,
  });
  let liveHandle = null;
  const email = `${lane.name}@packed-lifecycle.test`;
  const password = 'PackedLifecyclePassword!2026';
  const value = `${lane.name} M1 row`;
  const m1References = journeyReferences(m1Generated);
  assert.equal(
    appClientA.auth.currentPrincipal().status,
    'anonymous',
    `R1 client A must begin anonymous: ${JSON.stringify(appClientA.auth.currentPrincipal())}`,
  );
  assert.equal(
    appClientB.auth.currentPrincipal().status,
    'anonymous',
    `R1 client B must begin anonymous: ${JSON.stringify(appClientB.auth.currentPrincipal())}`,
  );
  await appClientA.auth.signUpWithPassword({
    email,
    password,
  });
  assert.equal(
    appClientB.auth.currentPrincipal().status,
    'anonymous',
    `R1 client B must remain independently anonymous: ${JSON.stringify(appClientB.auth.currentPrincipal())}`,
  );
  await appClientB.auth.signInWithPassword({ email, password });
  const originalPrincipalA = appClientA.auth.currentPrincipal();
  const originalPrincipalB = appClientB.auth.currentPrincipal();
  assert.equal(originalPrincipalA.status, 'authenticated');
  assert.equal(originalPrincipalB.status, 'authenticated');
  assert.equal(originalPrincipalB.userId, originalPrincipalA.userId);
  const originalSessionA = await appClientA.client.authSession();
  const originalSessionB = await appClientB.client.authSession();
  assert.equal(originalSessionA.authority.userId, originalPrincipalA.userId);
  assert.equal(originalSessionB.authority.userId, originalPrincipalA.userId);
  assert.equal(typeof originalSessionA.authority.sessionId, 'string');
  assert.equal(typeof originalSessionB.authority.sessionId, 'string');
  assert.notEqual(originalSessionA.authority.sessionId, originalSessionB.authority.sessionId);
  const liveUpdates = [];
  liveHandle = await appClientB.client.liveQuery(m1References.list, {
    args: {},
    connectionId: `${lane.name}-r1-observer`,
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate: (rows) => liveUpdates.push(rows),
  });
  await eventually(() => {
    if (liveHandle.error) throw liveHandle.error;
    if (liveHandle.connection !== 'live') {
      throw new Error(JSON.stringify({
        connection: liveHandle.connection,
        freshness: liveHandle.freshness,
        rowCount: liveHandle.rows?.length ?? null,
      }));
    }
    return true;
  }, { label: `${lane.name} observer live-query readiness` });
  await appClientA.client.mutate(m1References.create, {
    args: m1References.args(value),
    queue: false,
  });
  await eventually(
    () => liveUpdates.some((rows) => rows.some((row) => m1References.matches(row, value)))
      || liveHandle.rows.some((row) => m1References.matches(row, value)),
    { label: `${lane.name} two-client live M1 delivery` },
  );
  assert.ok(
    (await appClientA.client.query(m1References.list)).rows.some(
      (row) => m1References.matches(row, value),
    ),
    `${lane.name} reaches M1 green before schema evolution`,
  );
  await liveHandle.dispose();
  liveHandle = null;
  await appClientA.dispose();
  await appClientB.dispose();
  appClientA = null;
  appClientB = null;

  writeAdditiveSchema(lane);
  const requestId = `${lane.name}-m2-additive`;
  const result = await reload({ requestId });
  assert.equal(result.state, 'generated-and-loaded', JSON.stringify(result));
  const advance = deploymentEvent(events, requestId);
  assert.ok(advance, `${lane.name} reports its M1 -> M2 deployment identity advance`);
  assert.notDeepEqual(advance.fromDeployment, advance.toDeployment);
  assert.notEqual(advance.fromDeployment.schemaHash, advance.toDeployment.schemaHash);
  assert.deepEqual(advance.continuity, {
    database: 'preserved',
    accounts: 'preserved',
    sessions: 'preserved',
    stores: 'preserved',
  });
  const m2Receipt = readApplicationReadyReceipt(applicationReadyFile);
  assert.deepEqual(m2Receipt.application.deployment, advance.toDeployment);
  assert.deepEqual(m1Receipt.application.deployment, advance.fromDeployment);
  assert.notEqual(m2Receipt.binding.descriptorIdentity, m1Receipt.binding.descriptorIdentity);
  const m2Generated = await importGeneratedApp(lane, 'm2');
  await refreshBinding(m2Generated.app);
  const m2Binding = binding(m2Generated.app);
  assert.equal(m2Binding.descriptorIdentity, m2Generated.app.identity.descriptor);
  assert.equal(m2Binding.descriptorIdentity, m2Receipt.binding.descriptorIdentity);
  assert.notEqual(m2Binding.descriptorIdentity, m1Binding.descriptorIdentity);
  if (expectedBindingOrigin !== null) assert.equal(m2Binding.target.origin, expectedBindingOrigin);
  const m2References = journeyReferences(m2Generated);
  appClientA = await createSnapbackAppClient({
    app: m2Generated.app,
    binding: m2Binding,
    platform: platformA,
    storagePartition: `${lane.name}:r1:writer`,
  });
  appClientB = await createSnapbackAppClient({
    app: m2Generated.app,
    binding: m2Binding,
    platform: platformB,
    storagePartition: `${lane.name}:r1:observer`,
  });
  try {
    const survivingPrincipalA = appClientA.auth.currentPrincipal();
    const survivingPrincipalB = appClientB.auth.currentPrincipal();
    assert.equal(survivingPrincipalA.status, 'authenticated');
    assert.equal(survivingPrincipalB.status, 'authenticated');
    assert.equal(survivingPrincipalA.userId, originalPrincipalA.userId);
    assert.equal(survivingPrincipalB.userId, originalPrincipalB.userId);
    const survivingSessionA = await appClientA.client.authSession();
    const survivingSessionB = await appClientB.client.authSession();
    assert.equal(survivingSessionA.authority.sessionId, originalSessionA.authority.sessionId);
    assert.equal(survivingSessionB.authority.sessionId, originalSessionB.authority.sessionId);
    assert.ok(
      (await appClientA.client.query(m2References.list)).rows.some(
        (row) => m2References.matches(row, value),
      ),
      `${lane.name} preserves the original product row through M2`,
    );
  } finally {
    await appClientA.dispose();
    await appClientB.dispose();
  }
  const extension = await afterM2({
    app: m2Generated.app,
    platformA,
    originalPrincipalA,
    originalSessionA,
  });
  return {
    m1: {
      passwordAuth: true,
      durableCustody: true,
      twoClientLive: true,
      principalId: originalPrincipalA.userId,
      sessionIds: [
        originalSessionA.authority.sessionId,
        originalSessionB.authority.sessionId,
      ].map((sessionId) => `sha256:${createHash('sha256').update(sessionId).digest('hex')}`),
    },
    additiveSchema: {
      table: 'lifecycleLabels',
      continuity: advance.continuity,
      deploymentAdvanced: true,
      principalsPreserved: true,
      sessionsPreserved: true,
      productRowsPreserved: true,
    },
    lifecycle: {
      fromDeployment: advance.fromDeployment,
      toDeployment: advance.toDeployment,
      readyReceipt: m2Receipt,
    },
    extension,
  };
}

async function assertOwnerStillRunning(owner, consumerLabel) {
  const response = await fetch(`${owner.serverUrl}/health`);
  assert.equal(response.ok, true, `${consumerLabel} shutdown must leave the lifecycle owner's backend running`);
}

async function closeOwner(owner, consumerLabel) {
  const origin = owner.serverUrl;
  await owner.close();
  await eventually(async () => {
    try {
      await fetch(`${origin}/health`);
      return false;
    } catch {
      return true;
    }
  }, { label: `${consumerLabel} owned backend shutdown` });
}

let activeOwner = null;
let activeConsumer = null;
let packedClosure = [];
let r1Setup = null;
try {
  mkdirSync(externalRoot, { recursive: true });
  const packedTarballs = materializePackedPackages();
  packedClosure = packageClosureReceipt(packedTarballs);
  if (r1Mode) r1Setup = setupReceipt(packedClosure);
  materializeQualifiedRuntime();
  writeMetroFixture();

  const installedCli = join(externalRoot, 'node_modules', '@expo', 'snapback-cli');
  const installedClient = join(externalRoot, 'node_modules', '@expo', 'snapback-client');
  const installedExpo = join(externalRoot, 'node_modules', '@expo', 'snapback-expo');
  const installedVite = join(externalRoot, 'node_modules', '@expo', 'snapback-vite');
  const cli = await import(pathToFileURL(join(installedCli, 'index.mjs')).href);
  const expoDev = await import(pathToFileURL(join(installedCli, 'expo-dev.mjs')).href);
  const client = await import(pathToFileURL(join(installedClient, 'index.mjs')).href);
  const expo = await import(pathToFileURL(join(installedExpo, 'index.mjs')).href);
  const vite = await import(pathToFileURL(join(installedVite, 'index.mjs')).href);
  const consumerRequire = createRequire(join(externalRoot, 'package.json'));
  const installedViteEntry = consumerRequire.resolve('vite');
  const { createServer: createViteServer } = await import(pathToFileURL(
    installedViteEntry,
  ).href);
  const { IDBFactory } = await import(pathToFileURL(
    consumerRequire.resolve('fake-indexeddb'),
  ).href);

  if (!r1Mode) {
    // VCF-E-L1 negative: corrupt the materialized packed template, not the
    // source workspace, and prove the shipped scaffold entrypoint refuses
    // before creating output with the missing stage named.
    const packedReactManifestPath = join(installedCli, 'templates', 'react', 'package.json');
    const packedReactManifestBytes = readFileSync(packedReactManifestPath, 'utf8');
    const packedReactManifest = JSON.parse(packedReactManifestBytes);
    delete packedReactManifest.scripts.prove;
    const missingLifecycleTarget = join(externalRoot, 'missing-lifecycle-stage');
    try {
      writeFileSync(
        packedReactManifestPath,
        `${JSON.stringify(packedReactManifest, null, 2)}\n`,
      );
      assert.throws(
        () => cli.scaffoldApp(missingLifecycleTarget, { template: 'react' }),
        (error) => error?.code === 'SNAPBACK_SCAFFOLD_LIFECYCLE_STAGE_MISSING'
          && error?.diagnostic?.details?.stage === 'prove',
      );
      assert.equal(existsSync(missingLifecycleTarget), false);
    } finally {
      writeFileSync(packedReactManifestPath, packedReactManifestBytes);
    }
  }

  // Headless: a second packed CLI instance attaches to the receipt-bound owner,
  // advances the schema, and closes without terminating the owner.
  if (runArm('headless')) {
    const lane = scaffoldLane(cli.scaffoldApp, 'react');
    installScaffoldLane(lane, packedTarballs);
    configureAuthoringProfile(lane);
    const events = [];
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    activeConsumer = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      attach: true,
      watch: true,
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });
    assert.ok(activeConsumer.verbs?.reload, JSON.stringify({
      state: activeConsumer.state ?? null,
      keys: Object.keys(activeConsumer),
      diagnostic: activeConsumer.diagnostic ?? null,
      diagnostics: activeConsumer.diagnostics ?? null,
    }));
    const receipt = await proveM1ToM2({
      lane,
      IDBFactory,
      createSnapbackAppClient: client.createSnapbackAppClient,
      readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
      binding: () => cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`).binding,
      reload: activeConsumer.verbs.reload,
      events,
      expectedClientOrigins: [],
    });
    r1Receipts.push({ arm: 'headless', ...receipt });
    await activeConsumer.close();
    activeConsumer = null;
    await assertOwnerStillRunning(activeOwner, 'headless attach');
    await closeOwner(activeOwner, 'headless');
    activeOwner = null;
    const projectReadiness = cli.packagedRuntimeReadiness({
      runtimeBinary: qualifiedRuntimeBinary,
      projectRoot: lane.projectRoot,
    });
    assert.equal(projectReadiness.ok, true, JSON.stringify(projectReadiness.diagnostic));
    if (!r1Mode) {
      const prove = run('npm', ['run', 'prove'], {
        cwd: lane.projectRoot,
        timeout: 180_000,
        env: { SNAPBACK_RUNTIME_BINARY: qualifiedRuntimeBinary },
      });
      const proveReceipt = JSON.parse(readFileSync(
        join(lane.projectRoot, '.snapback', 'verify-receipt.json'),
        'utf8',
      ));
      assert.equal(proveReceipt.ok, true, prove.stdout);
    }
  }

  // Vite: a real Vite server loads the packed plugin. Its configure cut
  // consumes the application receipt through the shared CLI attach path; no
  // direct lifecycle controller, fake host descriptor, or custom relay stands
  // in for the shipped arm.
  if (runArm('vite-exact')) {
    const lane = scaffoldLane(cli.scaffoldApp, 'vite-exact');
    configureAuthoringProfile(lane);
    const viteEvents = [];
    const backendPort = await freeLoopbackPort();
    const clientPort = await freeLoopbackPort();
    const clientOrigin = `http://127.0.0.1:${clientPort}`;
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      port: backendPort,
      externalClientOrigin: clientOrigin,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });

    const startViteConsumer = async (mode) => {
      const server = await createViteServer({
        root: lane.projectRoot,
        configFile: false,
        logLevel: 'silent',
        plugins: [vite.snapbackDev({
          server: {
            mode,
            db: lane.database,
            readyFile: lane.readyFile,
            runtimeBinary,
            qualifiedRuntimeBinary,
            stdio: 'ignore',
          },
          projectRoot: lane.projectRoot,
          setup: { backendDirectory: lane.backendRoot, reset: 'never' },
          onEvent: (event) => viteEvents.push(event),
          logJson: false,
        })],
        server: { host: '127.0.0.1', port: clientPort, strictPort: true },
      });
      await server.listen();
      return server;
    };

    if (!r1Mode) {
      // Same host, same browser origin, stale capability identity: the actual
      // packed Vite attach refuses before changing the owner receipt or child.
      const applicationReadyFile = `${lane.readyFile}.application-ready`;
      const correctReceiptBytes = readFileSync(applicationReadyFile, 'utf8');
      const staleReceipt = JSON.parse(correctReceiptBytes);
      staleReceipt.capabilityManifestDigest = `sha256:${'0'.repeat(64)}`;
      writeFileSync(applicationReadyFile, `${JSON.stringify(staleReceipt, null, 2)}\n`, { mode: 0o600 });
      const staleViteWitness = join(lane.stateRoot, 'stale-vite-witness.mjs');
      writeFileSync(staleViteWitness, `
import { createServer } from ${JSON.stringify(pathToFileURL(installedViteEntry).href)};
import { snapbackDev } from ${JSON.stringify(pathToFileURL(join(installedVite, 'index.mjs')).href)};
try {
  await createServer({
    root: ${JSON.stringify(lane.projectRoot)},
    configFile: false,
    logLevel: 'silent',
    plugins: [snapbackDev({
      server: {
        mode: 'attach',
        db: ${JSON.stringify(lane.database)},
        readyFile: ${JSON.stringify(lane.readyFile)},
        runtimeBinary: ${JSON.stringify(runtimeBinary)},
        qualifiedRuntimeBinary: ${JSON.stringify(qualifiedRuntimeBinary)},
        stdio: 'ignore',
      },
      projectRoot: ${JSON.stringify(lane.projectRoot)},
      setup: { backendDirectory: ${JSON.stringify(lane.backendRoot)}, reset: 'never' },
      logJson: false,
    })],
    server: { host: '127.0.0.1', port: ${clientPort}, strictPort: true },
  });
  process.exitCode = 2;
} catch (error) {
  if (error?.code !== 'SNAPBACK_DEV_APPLICATION_READY_STALE') throw error;
  process.stdout.write(error.code + '\\n');
  process.exitCode = 0;
}
process.exit();
`);
      assert.equal(
        run(process.execPath, [staleViteWitness], { cwd: lane.projectRoot }).stdout.trim(),
        'SNAPBACK_DEV_APPLICATION_READY_STALE',
      );
      assert.equal(readFileSync(applicationReadyFile, 'utf8').includes(`sha256:${'0'.repeat(64)}`), true);
      await assertOwnerStillRunning(activeOwner, 'stale Vite attach');
      writeFileSync(applicationReadyFile, correctReceiptBytes, { mode: 0o600 });
      await closeOwner(activeOwner, 'stale Vite attach owner');
      activeOwner = null;
    } else {
      await closeOwner(activeOwner, 'R1 pre-managed Vite owner');
      activeOwner = null;
    }

    activeConsumer = await startViteConsumer('managed');
    const originalViteServer = activeConsumer;
    let virtual = await activeConsumer.ssrLoadModule('virtual:snapback/dev');
    const m1App = await importGeneratedApp(lane, 'vite-real-m1');
    assert.equal(virtual.snapbackDevState.ready, true);
    assert.equal(
      virtual.createSnapbackDevAppBinding(m1App.app).descriptorIdentity,
      m1App.app.identity.descriptor,
    );
    assert.equal((await fetch(`${clientOrigin}/__snapback/health`)).status, 200);
    const originalFetch = globalThis.fetch;
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, 'location');
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: new URL(`${clientOrigin}/`),
    });
    globalThis.fetch = (input, init) => {
      const resolved = typeof input === 'string' && input.startsWith('/')
        ? new URL(input, clientOrigin).href
        : input;
      return originalFetch(resolved, init);
    };
    try {
      const receipt = await proveM1ToM2({
        lane,
        IDBFactory,
        createSnapbackAppClient: client.createSnapbackAppClient,
        readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
        binding: (app) => virtual.createSnapbackDevAppBinding(app),
        refreshBinding: async (m2App) => {
          assert.equal(activeConsumer, originalViteServer, 'M2 keeps the same Vite server alive');
          virtual = await eventually(async () => {
            const projected = await activeConsumer.ssrLoadModule('virtual:snapback/dev');
            try {
              projected.createSnapbackDevAppBinding(m2App);
              return projected;
            } catch {
              return false;
            }
          }, { label: 'Vite virtual module M2 binding projection' });
        },
        reload: async () => {
          const eventStart = viteEvents.length;
          return eventually(() => viteEvents.slice(eventStart)
            .map((event) => event.backend)
            .find((event) => event?.state === 'generated-and-loaded') ?? false, {
            label: 'managed Vite M2 generated-and-loaded event',
          });
        },
        events: viteEvents,
        expectedClientOrigins: [clientOrigin],
        expectedBindingOrigin: '/__snapback',
      });
      r1Receipts.push({ arm: 'vite-exact', ...receipt });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLocation === undefined) delete globalThis.location;
      else Object.defineProperty(globalThis, 'location', originalLocation);
    }
    assert.ok(viteEvents.some((event) => event.event === 'server-ready' && event.shape === 'managed'));
    const managedServerUrl = cli.readReadyDescriptor(lane.readyFile).serverUrl;
    await activeConsumer.close();
    activeConsumer = null;
    await eventually(async () => {
      try {
        await fetch(`${managedServerUrl}/health`);
        return false;
      } catch {
        return true;
      }
    }, { label: 'managed Vite backend shutdown' });
  }

  // Expo: the actual packed Expo provider boots through the supervisor
  // rendezvous. Metro's complete loopback-alias set is declared before the
  // backend cut, and two sequential supervisors prove attach-after-projection
  // remains idempotent without Expo rewriting the application-ready carrier.
  if (runArm('expo')) {
    const lane = scaffoldLane(cli.scaffoldApp, 'expo', 'expo-chat');
    configureAuthoringProfile(lane);
    const events = [];
    const backendPort = await freeLoopbackPort();
    const metroPort = await freeLoopbackPort();
    const metroClientOrigins = expoDev.expoBackendClientOrigins(metroPort);
    let expoNowMs = Date.now();
    activeOwner = await cli.runDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      qualifiedRuntimeBinary,
      port: backendPort,
      externalClientOrigins: metroClientOrigins,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });

    const startExpoConsumer = () => expoDev.runExpoDev({
      backendDirectory: lane.backendRoot,
      projectRoot: lane.projectRoot,
      expoDirectory: lane.projectRoot,
      readyFile: lane.readyFile,
      database: lane.database,
      runtimeBinary,
      devOptions: { qualifiedRuntimeBinary },
      attach: true,
      platform: 'web',
      metroPort,
      ...(r1Mode ? {
        now: () => expoNowMs,
        bindingTtlMs: 60_000,
        bindingRefreshWindowMs: 15_000,
      } : {}),
      ...(!r1Mode ? { email: 'expo-supervisor@packed-lifecycle.test' } : {}),
      metroCommand: { command: process.execPath, args: [metroScript] },
      env: {
        ...process.env,
        SNAPBACK_PACKED_SUPERVISOR_DESCRIPTOR: join(
          dirname(lane.readyFile),
          'expo-supervisor.json',
        ),
      },
      serverStdio: ['ignore', 'ignore', 'ignore'],
      onEvent: (event) => events.push(event),
    });

    activeConsumer = await startExpoConsumer();
    assert.equal(activeConsumer.connectCarrier, 'supervisor-rendezvous');
    assert.equal(activeConsumer.applicationReady.formatVersion, 'snapback.application-ready.v1');
    assert.deepEqual(activeConsumer.applicationReady.clientOrigins, metroClientOrigins);
    assert.notEqual(
      activeConsumer.applicationReady.binding.provenance.supervisorGeneration,
      activeConsumer.binding.provenance.supervisorGeneration,
    );
    const expoReadyDescriptor = cli.readReadyDescriptor(lane.readyFile);
    const expoReadiness = await cli.readOperationalReadiness(
      expoReadyDescriptor,
      cli.managedAdminToken(expoReadyDescriptor, lane.database),
    );
    assert.deepEqual(
      [...activeConsumer.applicationReady.clientOrigins].sort(),
      [...expoReadiness.clientOrigins].sort(),
      'Metro aliases are admitted by the Rust dev-body origin predicate and projected unchanged',
    );

    const firstReceipt = cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`);
    const firstProjectionBytes = readFileSync(`${lane.readyFile}.application-ready`, 'utf8');
    await activeConsumer.close();
    activeConsumer = null;
    assert.equal(
      readFileSync(`${lane.readyFile}.application-ready`, 'utf8'),
      firstProjectionBytes,
      'closing the Expo projection must not rewrite/remove the CLI-owned receipt',
    );
    await assertOwnerStillRunning(activeOwner, 'first Expo attach');
    activeConsumer = await startExpoConsumer();
    const secondReceipt = cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`);
    assert.equal(secondReceipt.startupNonce, firstReceipt.startupNonce);
    assert.deepEqual(secondReceipt.application, firstReceipt.application);
    assert.deepEqual(secondReceipt.clientOrigins, metroClientOrigins);

    const indexedDB = new IDBFactory();
    const lockManager = Object.freeze({
      request: (_name, _options, operation) => operation(),
    });
    const expoPlatform = Object.freeze({
      kind: 'expo-web',
      indexedDB,
      lockManager,
      cryptoObject: webcrypto,
      databaseName: 'snapback-packed-lifecycle-expo',
    });
    const appState = () => {
      const listeners = new Set();
      return {
        currentState: 'active',
        addEventListener(_event, listener) {
          listeners.add(listener);
          return { remove: () => listeners.delete(listener) };
        },
      };
    };
    const bootEnvironment = () => Object.freeze({
      ...expo.createSupervisedExpoEnvironment({
        exchangeOrigin: activeConsumer.exchangeOrigin,
        appState: appState(),
        clientOptions: {
          rqsStore: null,
          offlineQueue: false,
          clientStoreId: 'packed-expo-provider',
        },
      }),
      resolveAppClientPlatform: () => expoPlatform,
    });

    if (r1Mode) {
      const createExpoProviderClient = async ({ app, platform }) => {
        const supervisedEnvironment = expo.createSupervisedExpoEnvironment({
          exchangeOrigin: activeConsumer.exchangeOrigin,
          appState: appState(),
          clientOptions: {
            rqsStore: null,
            offlineQueue: false,
            clientStoreId: platform.databaseName,
          },
        });
        const environment = Object.freeze({
          ...supervisedEnvironment,
          // R1 is a password-entry journey. Keep the shipped supervised
          // binding exchange while declining its convenience session so the
          // first-party app client begins at its documented anonymous state.
          resolveSupervisedAuthority: async () => ({ status: 'unavailable' }),
          resolveAppClientPlatform: () => platform,
        });
        const providerBoot = expo.createSnapbackExpoBoot({
          app,
          environment,
          rqsStore: null,
          createApplicationClient: async (input, observer) => {
            const applicationClient = await client.createSnapbackAppClient({
              ...input,
              rqsStore: null,
              storagePartition: `${lane.name}:r1:${platform.databaseName}`,
            });
            observer(applicationClient.bootstrapState());
            return applicationClient;
          },
        });
        const state = await providerBoot.start();
        assert.equal(state.status, 'ready', JSON.stringify(state));
        assert.ok(providerBoot.reactProvider(), 'R1 Expo clients construct the canonical React provider');
        const providerClient = providerBoot.appClient();
        assert.ok(providerClient, 'R1 Expo provider constructs the application client');
        return {
          auth: providerClient.auth,
          client: providerClient.client,
          dispose: () => providerBoot.dispose(),
        };
      };
      const receipt = await proveM1ToM2({
        lane,
        IDBFactory,
        createSnapbackAppClient: createExpoProviderClient,
        readApplicationReadyReceipt: cli.readApplicationReadyReceipt,
        binding: () => activeConsumer.binding,
        refreshBinding: async (m2App) => eventually(
          () => activeConsumer.binding.descriptorIdentity === m2App.identity.descriptor,
          { label: 'Expo M2 binding projection' },
        ),
        reload: activeConsumer.verbs.reload,
        events,
        expectedClientOrigins: metroClientOrigins,
        platformKind: 'expo-web',
        afterM2: async ({ app, platformA, originalPrincipalA, originalSessionA }) => {
          const predecessorBinding = activeConsumer.binding;
          expoNowMs = Date.parse(predecessorBinding.provenance.expiresAt) + 1;
          const coldBoot = await createExpoProviderClient({ app, platform: platformA });
          try {
            const principal = coldBoot.auth.currentPrincipal();
            assert.equal(principal.status, 'authenticated');
            assert.equal(principal.userId, originalPrincipalA.userId);
            const session = await coldBoot.client.authSession();
            assert.equal(session.authority.sessionId, originalSessionA.authority.sessionId);
            const successorBinding = activeConsumer.binding;
            assert.equal(
              successorBinding.provenance.supervisorGeneration,
              predecessorBinding.provenance.supervisorGeneration,
            );
            assert.equal(successorBinding.descriptorIdentity, predecessorBinding.descriptorIdentity);
            assert.deepEqual(successorBinding.target, predecessorBinding.target);
            assert.deepEqual(successorBinding.capabilities, predecessorBinding.capabilities);
            assert.notEqual(successorBinding.provenance.issuedAt, predecessorBinding.provenance.issuedAt);
            assert.notEqual(successorBinding.provenance.expiresAt, predecessorBinding.provenance.expiresAt);
            return {
              bindingTtlRefresh: true,
              coldProviderReattach: true,
              originalSessionPreserved: true,
              originalSupervisorPreserved: true,
              nativePlatformBoot: false,
            };
          } finally {
            await coldBoot.dispose();
          }
        },
      });
      r1Receipts.push({ arm: 'expo', ...receipt });
    } else {
      const m1Generated = await importGeneratedApp(lane, 'expo-provider-m1');
      let boot = expo.createSnapbackExpoBoot({
        app: m1Generated.app,
        environment: bootEnvironment(),
        adoptSupervisedSession: true,
      });
      let bootState = await boot.start();
      assert.equal(bootState.status, 'ready', JSON.stringify(bootState));
      assert.ok(boot.reactProvider(), 'packed Expo arm must construct the canonical React provider');
      let appClient = boot.appClient();
      assert.ok(appClient, 'packed Expo arm must construct the application client');
      const principal = appClient.auth.currentPrincipal();
      assert.equal(principal.status, 'authenticated');
      const originalSession = await appClient.client.authSession();
      const conversations = (await appClient.client.query(m1Generated.conversations)).rows;
      const users = (await appClient.client.query(m1Generated.users)).rows;
      assert.ok(conversations.length > 0 && users.length > 0);
      const conversationId = conversations[0]._id;
      const senderId = users[0]._id;
      const text = 'Packed Expo provider survives M1 to M2';
      await appClient.client.mutate(m1Generated.sendText, {
        args: { conversationId, senderId, text },
        queue: false,
      });
      assert.ok(
        (await appClient.client.query(m1Generated.messagesForConversation, {
          args: { conversationId },
        }))
          .rows.some((row) => row.text === text),
      );
      await boot.dispose();
      boot = null;
      appClient = null;

      writeAdditiveSchema(lane);
      const requestId = 'expo-m2-additive';
      const reloaded = await activeConsumer.verbs.reload({ requestId });
      assert.equal(reloaded.state, 'generated-and-loaded', JSON.stringify(reloaded));
      const advance = deploymentEvent(events, requestId);
      assert.ok(advance, 'Expo reports the M1 -> M2 deployment identity advance');
      assert.deepEqual(advance.continuity, {
        database: 'preserved',
        accounts: 'preserved',
        sessions: 'preserved',
        stores: 'preserved',
      });
      const m2Generated = await importGeneratedApp(lane, 'expo-provider-m2');
      assert.equal(activeConsumer.binding.descriptorIdentity, m2Generated.app.identity.descriptor);
      boot = expo.createSnapbackExpoBoot({
        app: m2Generated.app,
        environment: bootEnvironment(),
        adoptSupervisedSession: true,
      });
      bootState = await boot.start();
      assert.equal(bootState.status, 'ready', JSON.stringify(bootState));
      assert.ok(boot.reactProvider());
      appClient = boot.appClient();
      const survivingPrincipal = appClient.auth.currentPrincipal();
      assert.equal(survivingPrincipal.userId, principal.userId);
      const survivingSession = await appClient.client.authSession();
      assert.notEqual(
        survivingSession.authority.sessionId,
        originalSession.authority.sessionId,
        'volatile custody explicitly adopts a fresh session after the M2 boot while server rows survive',
      );
      assert.ok(
        (await appClient.client.query(m2Generated.messagesForConversation, {
          args: { conversationId },
        }))
          .rows.some((row) => row.text === text),
        'packed Expo provider preserves its product row through M2',
      );
      await boot.dispose();
    }
    assert.equal(
      activeConsumer.inspection().applicationReady.hostReadyDescriptorDigest,
      cli.readApplicationReadyReceipt(`${lane.readyFile}.application-ready`).hostReadyDescriptorDigest,
    );
    await activeConsumer.close();
    activeConsumer = null;
    await assertOwnerStillRunning(activeOwner, 'Expo attach');
    await closeOwner(activeOwner, 'Expo');
    activeOwner = null;
  }

  if (r1Mode) {
    assert.equal(r1Receipts.length, 1, 'one selected R1 arm emits one receipt');
    const readiness = JSON.parse(readFileSync(runtimeReadiness, 'utf8'));
    const receipt = {
      schemaVersion: 'snapback.r1-cold-probe.v1',
      ok: true,
      arm: selectedArm,
      profile: authoringProfile,
      cold: {
        freshPackedPackages: true,
        isolatedExternalDirectory: true,
        freshStore: true,
        packageClosure: packedClosure,
      },
      setup: r1Setup,
      constraints: {
        snapbackSourceInspections: 0,
        exactSourceInspections: 0,
        customRelayOrBindingMiddleware: 0,
        destructiveReseeds: 0,
        outOfScopeSkillPackets: 0,
      },
      accounting: {
        tokens: {
          available: false,
          reason: 'deterministic Node acceptance carrier has no model-harness token stream',
        },
        actions: {
          taxonomy: 'LLP 0186 2026-08-21',
          phases: {
            m1: {
              'guide-lookup': 0,
              'source-inspection': 0,
              edit: 0,
              generate: 1,
              process: 1,
              reseed: 0,
              suite: 0,
              choreography: 1,
              retry: 0,
            },
            additiveSchema: {
              'guide-lookup': 0,
              'source-inspection': 0,
              edit: 1,
              generate: 1,
              process: 0,
              reseed: 0,
              suite: 0,
              choreography: 0,
              retry: 0,
            },
            verification: {
              'guide-lookup': 0,
              'source-inspection': 0,
              edit: 0,
              generate: 0,
              process: 0,
              reseed: 0,
              suite: 1,
              choreography: 0,
              retry: 0,
            },
          },
        },
      },
      runtime: {
        platform: readiness.platform,
        buildIdentity: readiness.buildIdentity,
        binary: readiness.binary,
        qualification: readiness.qualification,
      },
      failures: [],
      probe: r1Receipts[0],
    };
    if (r1ReceiptPath !== null) {
      const resolvedReceiptPath = resolve(r1ReceiptPath);
      mkdirSync(dirname(resolvedReceiptPath), { recursive: true });
      writeFileSync(resolvedReceiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    }
    process.stdout.write(`${JSON.stringify(receipt)}\n`);
  } else {
    console.log(
      'packed-dev-lifecycle.test.mjs: VCF-E-L1 scaffold -> install -> generate -> dev -> prove plus packed headless, real Vite, and Expo provider M1 -> M2 continuity passes',
    );
  }
} finally {
  await activeConsumer?.close?.().catch(() => {});
  await activeOwner?.close?.().catch(() => {});
  rmSync(scratchRoot, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
