#!/usr/bin/env node

// @ref LLP 0295#program-invariant-vertical-paved-path-coherence — keep the
// Guide, packed profile entrypoints, first generation, runtime, and clients on
// one Familiar document-result contract.
// @ref LLP 0253#s43-returns-lowering-kind-partitioned-refusing — supported
// document result kinds cross every phase; composite mutation/action document
// values refuse before artifacts with one stable repair route.

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { coldInstallStagedPackageClosure } from './snapback-package-cold-install-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixtureRoot = join(root, 'tests', 'fixtures', 'familiar-vdoc-vertical');
const explicitPlanFixtureRoot = join(root, 'tests', 'fixtures', 'explicit-plan-economy');
const familiarAssetFixtureRoot = join(
  root,
  'tests',
  'acceptance',
  'fixtures',
  'familiar-video-asset',
);
const packageRoots = Object.freeze([
  'snapback-contract',
  'snapback-codegen',
  'snapback-client',
  'snapback-react',
  'snapback-umbrella',
  'snapback-cli',
  'snapback-runtime-darwin-arm64',
]);
const guideSpelling = 'returns: v.union([v.doc("todos"), v.null()])';
const negativeCode = 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE';
const negativeGuideAnchor = '/_snapback/guide/backend/familiar-profile.md#translate-the-familiar-handler-dialect';
const runtimeContractCode = 'SNAPBACK_HANDLER_RESULT_CONTRACT_VIOLATION';

function usage() {
  return `Usage: node scripts/familiar-vdoc-vertical-contract.mjs [options]

Options:
  --runtime-binary <path>  Qualified Snapback binary
                           (default: SNAPBACK_RUNTIME_BINARY or target/debug/snapback)
  --keep                   Keep the packed external application
  -h, --help               Print this help
`;
}

function parseArguments(argv) {
  const parsed = {
    runtimeBinary: process.env.SNAPBACK_RUNTIME_BINARY ?? join(root, 'target', 'debug', 'snapback'),
    keep: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '-h' || argument === '--help') parsed.help = true;
    else if (argument === '--keep') parsed.keep = true;
    else if (argument === '--runtime-binary') {
      const value = argv[++index];
      if (!value || value.startsWith('-')) throw new TypeError('--runtime-binary requires a path');
      parsed.runtimeBinary = value;
    } else throw new TypeError(`unrecognized argument: ${argument}`);
  }
  return parsed;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: options.timeout ?? 240_000,
  });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed (${result.status ?? result.signal}):\n${result.stderr || result.stdout}`,
  );
  return result;
}

const sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));

function cleanRuntimeEnvironment() {
  const environment = {
    ...process.env,
    SNAPBACK_CRON_DISABLED: '1',
    SNAPBACK_JOBS_DISABLED: '1',
    SNAPBACK_PACKAGED_STORE_QUALIFICATION_MODE: '1',
  };
  for (const key of Object.keys(environment)) {
    if (key.startsWith('DYLD_') || key === 'LD_LIBRARY_PATH') delete environment[key];
  }
  return environment;
}

async function startRuntime(binary, stateRoot, { schema = null, functions = null } = {}) {
  mkdirSync(stateRoot, { recursive: true });
  const readyFile = join(stateRoot, 'snapback.ready.json');
  const database = join(stateRoot, 'snapback.sqlite3');
  const args = ['start', '--port', '0', '--ready-file', readyFile, '--db', database];
  if (schema !== null || functions !== null) {
    assert(schema && functions, 'sessions startup requires both schema and functions manifests');
    const startupArtifacts = join(stateRoot, 'startup-artifacts.json');
    writeFileSync(startupArtifacts, `${JSON.stringify({
      formatVersion: 1,
      schema,
      functions,
    })}\n`, { mode: 0o600 });
    args.push('--startup-artifacts', startupArtifacts);
  }
  const child = spawn(binary, args, {
    cwd: stateRoot,
    env: cleanRuntimeEnvironment(),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout = `${stdout}${chunk}`.slice(-32_000); });
  child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-32_000); });
  const deadline = Date.now() + 60_000;
  while (!existsSync(readyFile)) {
    if (child.exitCode !== null) {
      throw new Error(`runtime exited ${child.exitCode}\n${stderr || stdout}`);
    }
    if (Date.now() >= deadline) {
      child.kill('SIGTERM');
      throw new Error(`runtime did not publish readiness\n${stderr || stdout}`);
    }
    await sleep(50);
  }
  const ready = readJson(readyFile);
  assert.equal(ready.ready, true);
  const adminToken = ready.adminTokenFile
    ? readFileSync(ready.adminTokenFile, 'utf8').trim()
    : process.env.SNAPBACK_ADMIN_TOKEN;
  const devIdentityCapability = ready.devIdentityCapabilityFile
    ? readFileSync(ready.devIdentityCapabilityFile, 'utf8').trim()
    : null;
  const impersonationCapability = ready.impersonationCapabilityFile
    ? readFileSync(ready.impersonationCapabilityFile, 'utf8').trim()
    : null;
  assert(adminToken, 'runtime readiness must expose an admin token');
  return {
    adminToken,
    baseUrl: ready.serverUrl,
    child,
    devIdentityCapability,
    impersonationCapability,
    async stop() {
      if (child.exitCode !== null) return;
      child.kill('SIGTERM');
      const closed = new Promise((resolveClose) => child.once('close', resolveClose));
      const graceful = await Promise.race([
        closed.then(() => true),
        sleep(10_000).then(() => false),
      ]);
      if (!graceful && child.exitCode === null) {
        child.kill('SIGKILL');
        await closed;
      }
    },
  };
}

function copyFixtureFiles(target, names) {
  mkdirSync(target, { recursive: true });
  for (const name of names) cpSync(join(fixtureRoot, name), join(target, name));
}

async function waitFor(predicate, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function proveDocumentArrayRefusal(codegen, negativeRoot, fixtureName) {
  copyFixtureFiles(negativeRoot, ['codegen.policy.json', 'schema.ts']);
  cpSync(join(fixtureRoot, fixtureName), join(negativeRoot, 'negative.ts'));
  assert.equal(existsSync(join(negativeRoot, 'generated')), false);
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(({ code }) => code === negativeCode);
  assert(diagnostic, JSON.stringify(refused.diagnostics));
  assert.equal(
    diagnostic.guideAnchor,
    negativeGuideAnchor,
    `${fixtureName} refusal must route to the Familiar handler-dialect table`,
  );
  assert.match(
    diagnostic.message,
    /document-containing composite values require the explicit profile's result: grammar/u,
  );
  assert.equal(diagnostic.profileSwitchSuggestion?.route, 'result:');
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    'unsupported Familiar document arrays must refuse before publishing generated artifacts',
  );
  assert.deepEqual(
    readdirSync(join(negativeRoot, 'generated')).sort(),
    ['api.d.mts', 'api.d.ts', 'api.mjs', 'server.d.ts', 'server.mjs'],
    'a clean refusal may retain only LLP 0253 S2 bootstrap imports, never activation output',
  );
}

async function proveUnknownTableRefusal(codegen, negativeRoot, fixtureName) {
  copyFixtureFiles(negativeRoot, [
    'codegen.policy.json',
    fixtureName,
    'schema.ts',
  ]);
  assert.equal(existsSync(join(negativeRoot, 'generated')), false);
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID',
  );
  assert(diagnostic, JSON.stringify(refused.diagnostics));
  assert.match(diagnostic.message, /unknown table missingTable/u);
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    'an unknown schema-derived document table must refuse before activation output',
  );
}

async function proveLegacyGeneratedImportRefusal(codegen, negativeRoot) {
  copyFixtureFiles(negativeRoot, [
    'codegen.policy.json',
    'negativeLegacyGenerated.ts',
    'schema.ts',
  ]);
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_CODEGEN_LEGACY_GENERATED_IMPORT',
  );
  assert(diagnostic, JSON.stringify(refused.diagnostics));
  assert.match(diagnostic.message, /\.\/generated\/server/u);
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    'the retired generated import must refuse before activation output',
  );
}

async function proveMembershipResourceFieldRefusal(codegen, negativeRoot) {
  copyFixtureFiles(negativeRoot, [
    'codegen.policy.json',
    'negativeMembershipSchema.ts',
  ]);
  cpSync(
    join(negativeRoot, 'negativeMembershipSchema.ts'),
    join(negativeRoot, 'schema.ts'),
  );
  rmSync(join(negativeRoot, 'negativeMembershipSchema.ts'));
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN',
  );
  assert(diagnostic, JSON.stringify(refused.diagnostics));
  assert.match(diagnostic.message, /missingRoomId/u);
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    'a misspelled membership resource field must refuse before activation output',
  );
}

async function proveFamiliarDialectRefusal(
  codegen,
  negativeRoot,
  fixtureName,
  expectedCode,
) {
  copyFixtureFiles(negativeRoot, ['codegen.policy.json', 'schema.ts', fixtureName]);
  const refused = await codegen.generate(negativeRoot);
  assert.equal(refused.ok, false);
  const diagnostic = refused.diagnostics.find(({ code }) => code === expectedCode);
  assert(diagnostic, `${fixtureName}: ${JSON.stringify(refused.diagnostics)}`);
  assert.equal(
    existsSync(join(negativeRoot, 'generated', 'artifacts.json')),
    false,
    `${fixtureName} must refuse before activation output`,
  );
  return diagnostic;
}

function assetBox(kind, payload) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(payload.length + 8, 0);
  header.write(kind, 4, 4, 'ascii');
  return Buffer.concat([header, payload]);
}

function smallMp4() {
  const ftyp = Buffer.concat([
    Buffer.from('isom', 'ascii'),
    Buffer.alloc(4),
    Buffer.from('isommp42', 'ascii'),
  ]);
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1_000, 12);
  mvhd.writeUInt32BE(2_000, 16);
  const tkhd = Buffer.alloc(84);
  tkhd.writeUInt32BE(640 << 16, 76);
  tkhd.writeUInt32BE(480 << 16, 80);
  const moov = assetBox('moov', Buffer.concat([
    assetBox('mvhd', mvhd),
    assetBox('trak', assetBox('tkhd', tkhd)),
  ]));
  return Buffer.concat([assetBox('ftyp', ftyp), moov, assetBox('mdat', Buffer.alloc(32, 0x5a))]);
}

function assetFile(bytes, {
  name = 'packed.mp4',
  type = 'video/mp4',
  size = bytes.length,
} = {}) {
  return {
    name,
    type,
    size,
    slice: (start, end) => ({
      arrayBuffer: async () => bytes.subarray(start ?? 0, end ?? bytes.length),
    }),
  };
}

async function provePackedFamiliarAsset({
  appRoot,
  packedCli,
  packedRuntimeBinary,
  temporary,
}) {
  const backendRoot = join(appRoot, 'asset-snapback');
  cpSync(familiarAssetFixtureRoot, backendRoot, { recursive: true });
  writeFileSync(join(backendRoot, 'tsconfig.json'), `${JSON.stringify({
    compilerOptions: {
      module: 'ESNext',
      moduleResolution: 'Bundler',
      noEmit: true,
      skipLibCheck: true,
      strict: true,
      target: 'ES2022',
    },
    include: ['*.ts', 'generated/*.d.ts'],
  }, null, 2)}\n`);
  run(packedCli, ['generate', backendRoot, '--json']);
  run(join(appRoot, 'node_modules', '.bin', 'tsc'), ['--project', 'tsconfig.json'], {
    cwd: backendRoot,
  });
  const guide = JSON.parse(run(packedCli, ['guide', 'asset upload', '--json'], {
    env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
  }).stdout);
  assert.equal(
    guide.matches.some(({ path }) => path === 'backend/assets.md'),
    true,
    'plausible asset-upload vocabulary must retrieve the asset guide',
  );

  let assetRuntime = null;
  let adminClient = null;
  let sessionClient = null;
  let coordinator = null;
  try {
    const clientPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'index.mjs',
    )).href);
    const contractPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-contract',
      'index.mjs',
    )).href);
    const { SnapbackAssetClient } = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'assets.mjs',
    )).href);
    const schema = readJson(join(backendRoot, 'generated', 'schema.manifest.json'));
    const functions = readJson(join(backendRoot, 'generated', 'functions.manifest.json'));
    assetRuntime = await startRuntime(
      packedRuntimeBinary,
      join(temporary, 'asset-runtime'),
      { schema, functions },
    );
    assert(assetRuntime.impersonationCapability, 'sessions mailbox proof needs process-bound impersonation');
    adminClient = new clientPackage.SnapbackClient(assetRuntime.baseUrl, {
      adminToken: assetRuntime.adminToken,
      authClientProtocol: 1,
      custody: 'anonymous-public',
      rqsStore: null,
      offlineQueue: false,
    });
    coordinator = new contractPackage.AuthCoordinator({
      appId: schema.appId,
      storage: contractPackage.createMemoryAuthCustodyStorage({ state: { custody: {} } }),
      broadcastChannelFactory: null,
      hintStorage: null,
    });
    sessionClient = new clientPackage.SnapbackClient(assetRuntime.baseUrl, {
      authCoordinator: coordinator,
      authInvalidationProtocol: 1,
      authorityDescriptorProtocol: 1,
      authorizedLeaseProtocol: 1,
      rqsStore: null,
      offlineQueue: false,
    });
    const requested = await sessionClient.authRequestCode('packed-asset@example.test');
    const mailboxResponse = await fetch(
      `${assetRuntime.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
      {
        headers: {
          'x-snapback-admin-token': assetRuntime.adminToken,
          'x-snapback-impersonation-capability': assetRuntime.impersonationCapability,
        },
      },
    );
    const mailbox = await mailboxResponse.json();
    assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
    await sessionClient.authExchange({ challengeId: requested.challengeId, code: mailbox.code });

    const generatedApi = await import(`${pathToFileURL(join(
      backendRoot,
      'generated',
      'api.mjs',
    )).href}?asset-vertical`);
    assert.strictEqual(
      generatedApi.api.media.videoUpload,
      generatedApi.app.api.assets['media.videoUpload'],
    );
    const bytes = smallMp4();
    const assets = new SnapbackAssetClient(sessionClient, { chunkBytes: 64 });
    const finished = await assets.start({
      upload: generatedApi.api.media.videoUpload,
      file: assetFile(bytes),
    }).done;
    assert.equal(finished.status, 'ready', JSON.stringify(finished.diagnostic));
    assert.equal(finished.integrityBasis, 'end-to-end-verified');
    const record = await assets.record(finished.assetId);
    assert.equal(record.availability, 'ready');
    const bearer = coordinator.credentialFor(coordinator.capture()).bearer;
    const response = await fetch(
      assets.deliveryUrl(finished.assetId, { variant: 'primary' }),
      {
        headers: {
          authorization: `Bearer ${bearer}`,
          'x-snapback-auth-client-protocol': '1',
        },
      },
    );
    const returned = Buffer.from(await response.arrayBuffer());
    assert.equal(response.status, 200, returned.toString('utf8'));
    assert.equal(response.headers.get('content-type'), 'video/mp4');
    assert.deepEqual(returned, bytes);

    const wrongMedia = await assets.start({
      upload: generatedApi.api.media.videoUpload,
      file: assetFile(Buffer.from('not an mp4'), {
        name: 'packed-invalid.mp4',
        type: 'video/mp4',
      }),
    }).done;
    assert.equal(wrongMedia.status, 'failed', JSON.stringify(wrongMedia));
    assert.equal(wrongMedia.diagnostic?.code, 'SNAPBACK_ASSET_TRANSFER_FAILED');
    assert.equal(
      wrongMedia.diagnostic?.diagnostic?.code,
      'SNAPBACK_ASSET_MEDIA_TYPE_UNSUPPORTED',
    );
    const oversized = await assets.start({
      upload: generatedApi.api.media.videoUpload,
      file: assetFile(Buffer.from('declared oversized'), {
        name: 'packed-oversized.mp4',
        type: 'video/mp4',
        size: 1_000_001,
      }),
    }).done;
    assert.equal(oversized.status, 'failed', JSON.stringify(oversized));
    assert.equal(oversized.diagnostic?.code, 'SNAPBACK_ASSET_TRANSFER_FAILED');
    assert.equal(
      oversized.diagnostic?.diagnostic?.code,
      'SNAPBACK_ASSET_MEDIA_BOUNDS_EXCEEDED',
    );
    return {
      intent: 'media.videoUpload',
      bytes: bytes.length,
      negativeCodes: [
        wrongMedia.diagnostic.diagnostic.code,
        oversized.diagnostic.diagnostic.code,
      ],
    };
  } finally {
    try { await sessionClient?.closeAuth?.(); } catch { /* retain primary proof failure */ }
    try { await coordinator?.close?.(); } catch { /* retain primary proof failure */ }
    try { await adminClient?.close?.(); } catch { /* retain primary proof failure */ }
    try { await assetRuntime?.stop?.(); } catch { /* retain primary proof failure */ }
  }
}

async function provePackedExplicitPlanEconomy({
  appRoot,
  packedCli,
  packedRuntimeBinary,
  temporary,
}) {
  const backendRoot = join(appRoot, 'explicit-plan-economy');
  mkdirSync(backendRoot, { recursive: true });
  for (const name of ['schema.mjs', 'functions.mjs', 'client-projection.ts', 'tsconfig.json']) {
    cpSync(join(explicitPlanFixtureRoot, name), join(backendRoot, name));
  }
  const generatedRoot = join(backendRoot, 'generated');
  assert.equal(existsSync(generatedRoot), false, 'VCF-E-P1 positive starts without generated output');
  run(packedCli, ['generate', backendRoot, '--json']);
  run(join(appRoot, 'node_modules', '.bin', 'tsc'), ['--project', 'tsconfig.json'], {
    cwd: backendRoot,
  });

  const manifest = readJson(join(generatedRoot, 'functions.manifest.json'));
  const byName = new Map(manifest.functions.map((definition) => [definition.name, definition]));
  const create = byName.get('createTodo');
  const authoredControl = byName.get('createTodoAuthoredControl');
  const changed = byName.get('markDone');
  const changedAuthoredControl = byName.get('markDoneAuthoredControl');
  const document = byName.get('createAndRead');
  const authoredDocument = byName.get('createAndReadAuthoredControl');
  const missingOther = byName.get('patchAndReadMissingOther');
  const shadowedInsert = byName.get('shadowedInsert');
  const shadowedInsertAuthored = byName.get('shadowedInsertAuthoredControl');
  const shadowedGet = byName.get('shadowedGet');
  const shadowedLet = byName.get('shadowedLet');
  const opaque = byName.get('echoOpaqueExpression');
  assert.deepEqual(create.resultContract, authoredControl.resultContract);
  assert.deepEqual(create.readSetSummary, authoredControl.readSetSummary);
  assert.deepEqual(create.writeSetSummary, authoredControl.writeSetSummary);
  assert.deepEqual(create.authorityProfileDependence, authoredControl.authorityProfileDependence);
  assert.deepEqual(create.resultContract, {
    kind: 'value',
    value: { kind: 'id', table: 'todos' },
  });
  assert.deepEqual(changed.resultContract, {
    kind: 'value',
    value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
  });
  assert.deepEqual(changed.resultContract, changedAuthoredControl.resultContract);
  assert.deepEqual(changed.readSetSummary, changedAuthoredControl.readSetSummary);
  assert.deepEqual(changed.writeSetSummary, changedAuthoredControl.writeSetSummary);
  assert.deepEqual(
    changed.authorityProfileDependence,
    changedAuthoredControl.authorityProfileDependence,
  );
  assert.equal(document.resultContract.kind, 'value');
  assert.deepEqual(document.resultContract, authoredDocument.resultContract);
  assert.deepEqual(document.resultContract.value.variants.map(({ kind }) => kind), ['null', 'object']);
  assert.deepEqual(missingOther.resultContract.value.variants.map(({ kind }) => kind), ['null', 'object']);
  assert.deepEqual(shadowedInsert.resultContract, {
    kind: 'value',
    value: { kind: 'id', table: 'otherTodos' },
  });
  assert.deepEqual(shadowedInsert.resultContract, shadowedInsertAuthored.resultContract);
  assert.deepEqual(shadowedGet.resultContract, { kind: 'unknown' });
  assert.deepEqual(shadowedLet.resultContract, { kind: 'unknown' });
  assert.deepEqual(opaque.resultContract, { kind: 'unknown' });
  assert.deepEqual(changed.readSetSummary.tables, ['todos']);
  assert.deepEqual(changed.writeSetSummary.tables, ['todos']);

  const facts = new Map(
    manifest.unsupportedDependencyDiagnostics
      .filter(({ code }) => code === 'SNAPBACK_PLAN_FACTS_DERIVED')
      .map((diagnostic) => [diagnostic.details.function, diagnostic.details]),
  );
  assert.equal(facts.get('createTodo').resultContractProvenance, 'plan-derived');
  assert.equal(
    facts.get('createTodoAuthoredControl').resultContractProvenance,
    'authored-compatible-plan-derived',
  );
  assert.equal(facts.get('echoOpaqueExpression').resultContractProvenance, 'unknown');
  assert.equal(facts.get('markDone').dependencySetProvenance, 'plan-derived');
  assert.equal(
    facts.get('markDoneAuthoredControl').resultContractProvenance,
    'authored-compatible-plan-derived',
  );
  assert.deepEqual(facts.get('markDone').dependencySet, {
    reads: ['todos'],
    writes: ['todos'],
  });
  assert.deepEqual(facts.get('patchAndReadMissingOther').dependencySet, {
    reads: ['otherTodos', 'todos'],
    writes: ['todos'],
  });
  assert.equal(
    facts.get('createAndReadAuthoredControl').resultContractProvenance,
    'authored-compatible-plan-derived',
  );

  let runtime = null;
  let client = null;
  try {
    runtime = await startRuntime(packedRuntimeBinary, join(temporary, 'explicit-plan-runtime'));
    const clientPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'index.mjs',
    )).href);
    client = new clientPackage.SnapbackClient(runtime.baseUrl, {
      adminToken: runtime.adminToken,
      rqsStore: null,
      offlineQueue: false,
    });
    await client.ensureApp({
      schema: readJson(join(generatedRoot, 'schema.manifest.json')),
      functions: manifest,
    });
    const { api } = await import(
      `${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?explicit-plan-economy`
    );
    const created = await client.mutate(api.createTodo, {
      args: { title: 'derived id' },
      queue: false,
    });
    assert.equal(typeof created.result, 'string');
    const authoredCreated = await client.mutate(api.createTodoAuthoredControl, {
      args: { title: 'authored control id' },
      queue: false,
    });
    assert.equal(typeof authoredCreated.result, 'string');
    const marked = await client.mutate(api.markDone, {
      args: { id: created.result },
      queue: false,
    });
    assert.equal(marked.result, 1);
    const authoredMarked = await client.mutate(api.markDoneAuthoredControl, {
      args: { id: authoredCreated.result },
      queue: false,
    });
    assert.equal(authoredMarked.result, 1);
    const returnedDocument = await client.mutate(api.createAndRead, {
      args: { title: 'derived document' },
      queue: false,
    });
    assert.equal(returnedDocument.result.title, 'derived document');
    assert.equal(returnedDocument.result.done, false);
    const authoredReturnedDocument = await client.mutate(api.createAndReadAuthoredControl, {
      args: { title: 'authored document control' },
      queue: false,
    });
    assert.equal(authoredReturnedDocument.result?.title, 'authored document control');
    const absentDocument = await client.mutate(api.patchAndReadMissingOther, {
      args: { id: created.result, title: 'patch A, return absent B' },
      queue: false,
    });
    assert.equal(absentDocument.result, null);
    const shadowedId = await client.mutate(api.shadowedInsert, {
      args: { title: 'last insert wins' },
      queue: false,
    });
    assert.equal(typeof shadowedId.result, 'string');
    const authoredShadowedId = await client.mutate(api.shadowedInsertAuthoredControl, {
      args: { title: 'authored last insert wins' },
      queue: false,
    });
    assert.equal(typeof authoredShadowedId.result, 'string');
    const shadowedRead = await client.mutate(api.shadowedGet, {
      args: { id: created.result, title: 'get overwrites insert binding' },
      queue: false,
    });
    assert.equal(shadowedRead.result._id, created.result);
    const shadowedLiteral = await client.mutate(api.shadowedLet, {
      args: { title: 'let overwrites insert binding' },
      queue: false,
    });
    assert.equal(shadowedLiteral.result, 'replacement');
    const opaqueResult = await client.mutate(api.echoOpaqueExpression, {
      args: { id: created.result, title: 'unknown stays runtime-exact' },
      queue: false,
    });
    assert.equal(opaqueResult.result, 'unknown stays runtime-exact');
  } finally {
    try { await client?.close?.(); } catch { /* retain primary proof failure */ }
    try { await runtime?.stop?.(); } catch { /* retain primary proof failure */ }
  }

  const conflictRoot = join(appRoot, 'explicit-plan-conflicting-result');
  mkdirSync(conflictRoot, { recursive: true });
  cpSync(join(explicitPlanFixtureRoot, 'schema.mjs'), join(conflictRoot, 'schema.mjs'));
  cpSync(join(explicitPlanFixtureRoot, 'conflicting-result.mjs'), join(conflictRoot, 'functions.mjs'));
  const resultConflict = spawnSync(packedCli, ['generate', conflictRoot, '--json'], {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(resultConflict.status, 1, resultConflict.stderr || resultConflict.stdout);
  assert.match(
    `${resultConflict.stdout}\n${resultConflict.stderr}`,
    /authored result contract conflicts with the closed plan-derived contract/u,
  );
  assert.equal(existsSync(join(conflictRoot, 'generated', 'functions.manifest.json')), false);

  const shadowConflictRoot = join(appRoot, 'explicit-plan-shadowed-result-conflict');
  mkdirSync(shadowConflictRoot, { recursive: true });
  cpSync(join(explicitPlanFixtureRoot, 'schema.mjs'), join(shadowConflictRoot, 'schema.mjs'));
  cpSync(
    join(explicitPlanFixtureRoot, 'conflicting-shadowed-result.mjs'),
    join(shadowConflictRoot, 'functions.mjs'),
  );
  const shadowConflict = spawnSync(packedCli, ['generate', shadowConflictRoot, '--json'], {
    cwd: appRoot,
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  });
  assert.equal(shadowConflict.status, 1, shadowConflict.stderr || shadowConflict.stdout);
  assert.match(
    `${shadowConflict.stdout}\n${shadowConflict.stderr}`,
    /authored result contract conflicts with the closed plan-derived contract/u,
  );

  const dependencyTranscriptionRoot = join(appRoot, 'explicit-plan-dependency-transcription');
  mkdirSync(dependencyTranscriptionRoot, { recursive: true });
  cpSync(join(explicitPlanFixtureRoot, 'schema.mjs'), join(dependencyTranscriptionRoot, 'schema.mjs'));
  cpSync(
    join(explicitPlanFixtureRoot, 'conflicting-dependency.mjs'),
    join(dependencyTranscriptionRoot, 'functions.mjs'),
  );
  const dependencyTranscription = spawnSync(
    packedCli,
    ['generate', dependencyTranscriptionRoot, '--json'],
    { cwd: appRoot, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(
    dependencyTranscription.status,
    1,
    dependencyTranscription.stderr || dependencyTranscription.stdout,
  );
  assert.match(
    `${dependencyTranscription.stdout}\n${dependencyTranscription.stderr}`,
    /SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN/u,
  );
  assert.equal(
    existsSync(join(dependencyTranscriptionRoot, 'generated', 'functions.manifest.json')),
    false,
  );

  return {
    verified: ['VCF-E-P1', 'VCF-E-P2', 'VCF-E-P3', 'VCF-E-P4'],
    generatedWithoutAuthoredTranscription: ['result', 'reads', 'writes'],
    effectiveContractMatchesAuthoredControl: true,
    authorityEvidenceMatchesAuthoredControl: true,
    runtime: {
      id: true,
      changedCount: true,
      nullableDocument: { present: true, absent: true },
      shadowing: { insert: true, get: true, let: true },
      authoredControls: true,
      opaqueUnknown: true,
    },
    negative: {
      resultConflict: 'pre-output',
      shadowedResultConflict: 'pre-output',
      dependencyTranscription: 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN',
    },
  };
}

async function expectRuntimeRefusal(operation, label, code = runtimeContractCode) {
  await assert.rejects(operation, (error) => {
    assert.equal(error?.code, code, `${label}: ${error?.stack ?? error}`);
    assert.equal(error?.diagnostic?.code, code, label);
    return true;
  }, label);
}

function proveRegenerationRefusalPreservesLastCompleteGraph(
  packedCli,
  backendRoot,
  generatedRoot,
  fixtureName,
) {
  const authoredName = fixtureName === 'negative-action.ts'
    ? 'watchNegativeAction.ts'
    : 'watchNegative.ts';
  const authoredPath = join(backendRoot, authoredName);
  const artifactsPath = join(generatedRoot, 'artifacts.json');
  const functionsPath = join(generatedRoot, 'functions.manifest.json');
  const artifactsBefore = readFileSync(artifactsPath);
  const functionsBefore = readFileSync(functionsPath);
  cpSync(join(fixtureRoot, fixtureName), authoredPath);
  try {
    const refused = spawnSync(packedCli, ['generate', backendRoot, '--json'], {
      cwd: root,
      env: process.env,
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      timeout: 240_000,
    });
    assert.notEqual(
      refused.status,
      0,
      `regeneration with ${fixtureName} must refuse instead of replacing the complete graph`,
    );
    assert.match(`${refused.stdout}\n${refused.stderr}`, new RegExp(negativeCode, 'u'));
    assert(
      readFileSync(artifactsPath).equals(artifactsBefore),
      `${fixtureName} refusal must preserve artifacts.json byte-for-byte`,
    );
    assert(
      readFileSync(functionsPath).equals(functionsBefore),
      `${fixtureName} refusal must preserve the prior function manifest`,
    );
    const retainedFunctions = readJson(functionsPath).functions.map(({ name }) => name);
    assert.equal(
      retainedFunctions.some((name) => name.includes('unsupportedDocumentArray')),
      false,
      `${fixtureName} must not enter the retained activation manifest`,
    );
  } finally {
    rmSync(authoredPath, { force: true });
  }
}

async function main() {
  const args = parseArguments(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(usage());
    return;
  }
  const runtimeBinary = resolve(args.runtimeBinary);
  const runtimeMetadata = lstatSync(runtimeBinary);
  assert.equal(runtimeMetadata.isFile(), true, `runtime binary must be a file: ${runtimeBinary}`);
  assert.equal(runtimeMetadata.isSymbolicLink(), false, 'runtime binary must not be a symlink');

  const temporary = mkdtempSync(join(tmpdir(), 'snapback-familiar-vdoc-vertical-'));
  const stagedRoot = join(temporary, 'staged');
  const appRoot = join(temporary, 'external-app');
  const backendRoot = join(appRoot, 'snapback');
  const generatedRoot = join(backendRoot, 'generated');
  mkdirSync(stagedRoot, { recursive: true });
  mkdirSync(appRoot, { recursive: true });

  let runtime = null;
  let client = null;
  let renderer = null;
  let preparedBinding = null;
  let presentLiveHandle = null;
  let absentLiveHandle = null;
  let summaryLiveHandle = null;
  let memberTypingOverlay = null;
  let memberTypingObserver = null;
  let memberCoordinator = null;
  let outsiderCoordinator = null;
  try {
    // This acceptance carrier is intentionally not a publication candidate:
    // bootstrap already qualified the exact dirty-worktree binary, while the
    // production package sealer correctly accepts only clean 40-hex revisions.
    // Recreate the npm loader-relative layout in temporary custody and prove
    // the installed binary remains byte-identical to that qualified input.
    const runtimePackageDirectory = join(temporary, 'runtime-package-source');
    const runtimePackageSource = join(root, 'packages', 'snapback-runtime-darwin-arm64');
    mkdirSync(runtimePackageDirectory, { recursive: true });
    cpSync(join(runtimePackageSource, 'package.json'), join(runtimePackageDirectory, 'package.json'));
    cpSync(join(runtimePackageSource, 'README.md'), join(runtimePackageDirectory, 'README.md'));
    mkdirSync(join(runtimePackageDirectory, 'bin'), { recursive: true });
    cpSync(runtimeBinary, join(runtimePackageDirectory, 'bin', 'snapback'));
    chmodSync(join(runtimePackageDirectory, 'bin', 'snapback'), 0o755);
    cpSync(
      join(root, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
      join(runtimePackageDirectory, 'Frameworks', 'hermesvm.framework', 'Versions', '1'),
      { recursive: true },
    );
    mkdirSync(join(runtimePackageDirectory, 'include', 'hermes'), { recursive: true });
    cpSync(
      join(root, 'vendor', 'ibex', 'ios', 'Frameworks', 'hermes-headers', 'hermes', 'hermes.h'),
      join(runtimePackageDirectory, 'include', 'hermes', 'hermes.h.artifact'),
    );
    for (const packageRoot of packageRoots) {
      const packageDirectory = packageRoot === 'snapback-runtime-darwin-arm64'
        ? runtimePackageDirectory
        : join(root, 'packages', packageRoot);
      const tarball = join(stagedRoot, `${packageRoot}.tgz`);
      run('bun', [
        'pm',
        'pack',
        ...(packageRoot === 'snapback-runtime-darwin-arm64' ? ['--ignore-scripts'] : []),
        '--filename',
        tarball,
        '--quiet',
      ], {
        cwd: packageDirectory,
        // The qualified debug binary is intentionally unstripped and can
        // approach 500 MiB. Give only that tarball enough time to compress on
        // a loaded developer machine; all semantic fixture timeouts stay
        // narrow below.
        timeout: packageRoot === 'snapback-runtime-darwin-arm64' ? 600_000 : 300_000,
      });
      assert.equal(lstatSync(tarball).isFile(), true, `${basename(tarball)} was not packed`);
    }

    writeFileSync(join(appRoot, 'package.json'), `${JSON.stringify({
      name: 'familiar-vdoc-packed-vertical-contract',
      private: true,
      type: 'module',
      dependencies: {
        react: '19.1.0',
        'react-test-renderer': '19.1.0',
      },
    }, null, 2)}\n`);
    const installed = await coldInstallStagedPackageClosure({
      stagedDir: stagedRoot,
      appDir: appRoot,
      environment: {
        ...process.env,
        npm_config_audit: 'false',
        npm_config_cache: join(temporary, 'npm-cache'),
        npm_config_fund: 'false',
      },
      timeoutMs: 300_000,
    });
    assert.equal(installed.packageClosure.length, packageRoots.length);
    const packedRuntimeBinary = join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-runtime-darwin-arm64',
      'bin',
      'snapback',
    );
    const packedRuntimeMetadata = lstatSync(packedRuntimeBinary);
    assert.equal(packedRuntimeMetadata.isFile(), true, 'packed runtime must be a materialized file');
    assert.equal(packedRuntimeMetadata.isSymbolicLink(), false, 'packed runtime must not be a symlink');
    assert.equal(
      sha256(packedRuntimeBinary),
      sha256(runtimeBinary),
      'packed runtime must remain byte-identical to the bootstrap-qualified input',
    );

    copyFixtureFiles(backendRoot, [
      'client-projection.ts',
      'codegen.policy.json',
      'entrypoint-projection.ts',
      'schema.ts',
      'todos.ts',
      'tsconfig.json',
    ]);
    cpSync(join(fixtureRoot, 'helpers'), join(backendRoot, 'helpers'), { recursive: true });
    assert.equal(existsSync(generatedRoot), false, 'positive fixture must begin without generated output');

    const packedCli = join(appRoot, 'node_modules', '.bin', 'snapback');
    const positiveGeneration = JSON.parse(
      run(packedCli, ['generate', backendRoot, '--json']).stdout,
    );
    assert.equal(
      positiveGeneration.diagnostics?.some(
        (diagnostic) => diagnostic.profileSwitchSuggestion !== undefined,
      ) ?? false,
      false,
      'successful Familiar generation must not suggest a profile switch',
    );
    const codegen = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-codegen',
      'index.mjs',
    )).href);
    const functions = readJson(join(generatedRoot, 'functions.manifest.json'));
    const functionByName = new Map(functions.functions.map((definition) => [definition.name, definition]));
    assert.equal(functionByName.get('todos.get').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.getRequired').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.list').resultContract.kind, 'documents');
    assert.equal(functionByName.get('todos.recordList').resultContract.kind, 'records');
    assert.deepEqual(
      functionByName.get('todos.boundedRecords').resultContract.rows,
      { minItems: 0, maxItems: 2 },
    );
    assert.equal(functionByName.get('todos.unionRecords').resultContract.kind, 'records');
    assert.deepEqual(
      functionByName.get('todos.singletonRecord').resultContract.rows,
      { minItems: 1, maxItems: 1 },
    );
    assert.equal(functionByName.get('todos.summary').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.count').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.create').resultContract.kind, 'document');
    assert.equal(functionByName.get('todos.remove').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.returnTodoId').resultContract.kind, 'value');
    assert.equal(functionByName.get('todos.createFromAction').resultContract.kind, 'document');

    const packedServer = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback',
      'server.mjs',
    )).href);
    const packedValues = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback',
      'values.mjs',
    )).href);
    const packedFamiliar = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-codegen',
      'familiar.mjs',
    )).href);
    const packedDefine = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-codegen',
      'define.mjs',
    )).href);
    const generatedServer = await import(pathToFileURL(join(generatedRoot, 'server.mjs')).href);
    const advertisedServerNames = [
      'action',
      'allow',
      'defineAssetUpload',
      'defineEphemeral',
      'defineSchema',
      'defineTable',
      'ephemeral',
      'membershipResource',
      'mutation',
      'query',
    ];
    for (const name of advertisedServerNames) {
      const umbrellaOwner = ['action', 'mutation', 'query'].includes(name)
        ? packedFamiliar
        : packedDefine;
      assert.equal(packedServer[name], umbrellaOwner[name], `@expo/snapback/server ${name}`);
      assert.equal(generatedServer[name], packedFamiliar[name], `generated/server ${name}`);
    }
    for (const name of [
      'action',
      'defineAssetUpload',
      'defineEphemeral',
      'defineSchema',
      'defineTable',
      'mutation',
      'query',
    ]) assert.equal(typeof packedServer[name], 'function', `${name} constructor`);
    for (const name of ['allow', 'ephemeral', 'membershipResource']) {
      assert.equal(typeof packedServer[name], 'object', `${name} namespace`);
      assert.notEqual(packedServer[name], null, `${name} namespace`);
    }
    assert.equal(packedValues.v, packedFamiliar.v, '@expo/snapback/values v');
    assert.equal(generatedServer.v, packedFamiliar.v, 'generated/server v');

    run(join(appRoot, 'node_modules', '.bin', 'tsc'), ['--project', 'tsconfig.json'], {
      cwd: backendRoot,
    });

    proveRegenerationRefusalPreservesLastCompleteGraph(
      packedCli,
      backendRoot,
      generatedRoot,
      'negative.ts',
    );
    proveRegenerationRefusalPreservesLastCompleteGraph(
      packedCli,
      backendRoot,
      generatedRoot,
      'negative-action.ts',
    );

    await proveDocumentArrayRefusal(
      codegen,
      join(appRoot, 'negative-mutation-snapback'),
      'negative.ts',
    );
    await proveDocumentArrayRefusal(
      codegen,
      join(appRoot, 'negative-action-snapback'),
      'negative-action.ts',
    );
    await proveUnknownTableRefusal(
      codegen,
      join(appRoot, 'negative-unknown-document-snapback'),
      'negativeUnknownDocument.ts',
    );
    await proveUnknownTableRefusal(
      codegen,
      join(appRoot, 'negative-unknown-document-array-snapback'),
      'negativeUnknownTable.ts',
    );
    await proveLegacyGeneratedImportRefusal(
      codegen,
      join(appRoot, 'negative-legacy-generated-snapback'),
    );
    await proveMembershipResourceFieldRefusal(
      codegen,
      join(appRoot, 'negative-membership-resource-snapback'),
    );
    const dynamicAccessDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-dynamic-access-snapback'),
      'negativeDynamicAccess.ts',
      'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
    );
    const importedHelperDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-imported-helper-snapback'),
      'negativeImportedHelper.ts',
      'SNAPBACK_CODEGEN_FAMILIAR_HELPER_IMPORT_UNAVAILABLE',
    );
    const capturedConstantDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-captured-constant-snapback'),
      'negativeCapturedConstant.ts',
      'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER',
    );
    const ambientClockDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-ambient-clock-snapback'),
      'negativeAmbientClock.ts',
      'BUNDLE_UNSUPPORTED_TIME',
    );
    const ambientDateDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-ambient-date-snapback'),
      'negativeAmbientDate.ts',
      'BUNDLE_UNSUPPORTED_TIME',
    );
    const ordinaryClockDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-ordinary-clock-snapback'),
      'negativeOrdinaryClock.ts',
      'BUNDLE_UNSUPPORTED_TIME',
    );
    const missingReturnsDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-missing-returns-snapback'),
      'negativeMissingReturns.ts',
      'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
    );
    const sequenceDiagnostic = await proveFamiliarDialectRefusal(
      codegen,
      join(appRoot, 'negative-sequence-snapback'),
      'negativeSequence.ts',
      'SNAPBACK_CODEGEN_FAMILIAR_SEQUENCE_UNSUPPORTED',
    );
    for (const diagnostic of [
      dynamicAccessDiagnostic,
      importedHelperDiagnostic,
      capturedConstantDiagnostic,
      ambientClockDiagnostic,
      ambientDateDiagnostic,
      sequenceDiagnostic,
    ]) {
      assert.equal(
        diagnostic.guideAnchor,
        negativeGuideAnchor,
        `${diagnostic.code} must route to the first-read Familiar dialect table`,
      );
    }
    assert.match(dynamicAccessDiagnostic.message, /static\/destructured access.*through args/u);
    assert.match(importedHelperDiagnostic.message, /helper subdirectory.*import it relatively/u);
    assert.match(capturedConstantDiagnostic.message, /inline the value.*through args/u);
    for (const diagnostic of [ambientClockDiagnostic, ambientDateDiagnostic]) {
      assert.match(
        diagnostic.message,
        /persisted application state.*through a mutation.*query that stored state/u,
      );
      assert.equal(
        diagnostic.profileSwitchSuggestion,
        undefined,
        'the executable persisted-state repair remains in Familiar and is not a profile switch',
      );
    }
    assert.match(ordinaryClockDiagnostic.message, /ctx\.runtime\.now\(\)/u);
    assert.equal(
      ordinaryClockDiagnostic.profileSwitchSuggestion,
      undefined,
      'an ordinary timestamp rewrite is supported Familiar vocabulary, not a profile switch',
    );
    assert.equal(
      missingReturnsDiagnostic.profileSwitchSuggestion,
      undefined,
      'a malformed missing-returns declaration is not a disposition-4 profile switch',
    );
    assert.match(sequenceDiagnostic.message, /Explicit profile declared sequences surface/u);
    for (const diagnostic of [
      dynamicAccessDiagnostic,
      importedHelperDiagnostic,
      capturedConstantDiagnostic,
    ]) {
      assert.equal(
        diagnostic.profileSwitchSuggestion,
        undefined,
        `${diagnostic.code} is a supported-rewrite site, not a disposition-4 switch site`,
      );
    }
    assert.equal(sequenceDiagnostic.profileSwitchSuggestion?.route, 'sequences');

    const guideLookup = run(packedCli, ['guide', 'point query', '--json'], {
      env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
    });
    const guideResult = JSON.parse(guideLookup.stdout);
    assert.equal(guideResult.mode, 'section-search');
    assert.equal(
      guideResult.matches.some(({ path }) => path === 'backend/familiar-profile.md'),
      true,
      'plausible point-query vocabulary must retrieve the Familiar Guide page',
    );
    for (const query of ['dynamic computed access', 'captured constants', 'monotonic counter']) {
      const retrieval = JSON.parse(run(packedCli, ['guide', query, '--json'], {
        env: { ...process.env, SNAPBACK_RUNTIME_BINARY: packedRuntimeBinary },
      }).stdout);
      assert.equal(
        retrieval.matches.some(({ path }) => path === 'backend/familiar-profile.md'),
        true,
        `plausible diary vocabulary must retrieve the Familiar page: ${query}`,
      );
    }

    const schema = readJson(join(generatedRoot, 'schema.manifest.json'));
    const descriptor = readJson(join(generatedRoot, 'app.descriptor.json'));
    runtime = await startRuntime(
      packedRuntimeBinary,
      join(temporary, 'runtime'),
      { schema, functions },
    );
    const guideResponse = await fetch(`${runtime.baseUrl}/_snapback/guide/backend/familiar-profile.md`);
    assert.equal(guideResponse.ok, true);
    assert.match(await guideResponse.text(), new RegExp(guideSpelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'));

    const clientPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-client',
      'index.mjs',
    )).href);
    const contractPackage = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback-contract',
      'index.mjs',
    )).href);
    client = new clientPackage.SnapbackClient(runtime.baseUrl, {
      adminToken: runtime.adminToken,
      authClientProtocol: 1,
      custody: 'anonymous-public',
      rqsStore: null,
      offlineQueue: false,
    });
    const openSession = async (email) => {
      const coordinator = new contractPackage.AuthCoordinator({
        appId: schema.appId,
        storage: contractPackage.createMemoryAuthCustodyStorage({ state: { custody: {} } }),
        broadcastChannelFactory: null,
        hintStorage: null,
      });
      const sessionClient = new clientPackage.SnapbackClient(runtime.baseUrl, {
        authCoordinator: coordinator,
        authInvalidationProtocol: 1,
        authorityDescriptorProtocol: 1,
        authorizedLeaseProtocol: 1,
        rqsStore: null,
        offlineQueue: false,
      });
      const requested = await sessionClient.authRequestCode(email);
      const mailboxResponse = await fetch(
        `${runtime.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
        {
          headers: {
            'x-snapback-admin-token': runtime.adminToken,
            'x-snapback-impersonation-capability': runtime.impersonationCapability,
          },
        },
      );
      const mailbox = await mailboxResponse.json();
      assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
      const credential = await sessionClient.authExchange({
        challengeId: requested.challengeId,
        code: mailbox.code,
      });
      assert.equal(credential.session.userId, coordinator.authority.userId);
      return { client: sessionClient, coordinator, userId: credential.session.userId };
    };
    await client.reset({
      tables: {
        todos: [{ _id: 'todo_welcome', title: 'packed seed', completed: false, visible: false }],
        otherTodos: [{ _id: 'other_seed', title: 'foreign seed' }],
      },
    });
    const memberSession = await openSession('packed-member@example.test');
    memberCoordinator = memberSession.coordinator;
    client.memberClient = memberSession.client;
    const outsiderSession = await openSession('packed-outsider@example.test');
    outsiderCoordinator = outsiderSession.coordinator;
    client.outsiderClient = outsiderSession.client;
    const generatedApi = await import(
      `${pathToFileURL(join(generatedRoot, 'api.mjs')).href}?vertical`,
    );
    const { api, ephemeral: generatedEphemeral } = generatedApi;
    const createdRoom = await memberSession.client.mutate(api.todos.createRoom, {
      args: { title: 'Packed room' },
      queue: false,
    });
    const roomId = createdRoom.result;
    assert.equal(typeof roomId, 'string', 'member bootstrap mints a resource and membership carrier');
    const addedNote = await memberSession.client.mutate(api.todos.addRoomNote, {
      args: { roomId, body: 'member only' },
      queue: false,
    });
    assert.equal(typeof addedNote.result, 'string', 'member authority admits the child write');

    const seeded = (await client.query(api.todos.get, { args: { id: 'todo_welcome' } })).rows;
    assert.equal(seeded.title, 'packed seed');
    assert.equal((await client.query(api.todos.get, { args: { id: 'todo_missing' } })).rows, null);
    const requiredSeeded = (await client.query(api.todos.getRequired, {
      args: { id: 'todo_welcome' },
    })).rows;
    assert.equal(requiredSeeded.title, 'packed seed');
    const listed = (await client.query(api.todos.list, { args: {} })).rows;
    assert.deepEqual(listed.map(({ title }) => title), ['packed seed']);
    assert.deepEqual(
      (await client.query(api.todos.recordList, { args: {} })).rows,
      [{ title: 'record' }],
    );
    assert.deepEqual(
      (await client.query(api.todos.boundedRecords, { args: {} })).rows,
      [{ rank: 1 }, { rank: 2 }],
    );
    assert.deepEqual(
      (await client.query(api.todos.unionRecords, { args: {} })).rows,
      [{ kind: 'title', title: 'union' }, { kind: 'count', count: 2 }],
    );
    assert.deepEqual(
      (await client.query(api.todos.singletonRecord, { args: {} })).rows,
      [{ title: 'singleton' }],
    );
    assert.deepEqual(
      (await client.query(api.todos.summary, { args: {} })).rows,
      { label: 'summary', total: 1 },
    );
    assert.equal((await client.query(api.todos.count, { args: {} })).rows, 2);
    assert.equal(
      (await client.query(api.todos.firstTitle, {
        args: { titles: ['first', 'second'] },
      })).rows,
      'first',
      'VCF-F-D1 static literal access rewrite executes end to end',
    );
    assert.equal(
      (await client.query(api.todos.prefixedTitle, { args: { title: 'title' } })).rows,
      'packed:title',
      'VCF-F-D3 handler-local value rewrite executes end to end',
    );
    assert.equal(
      (await client.query(api.todos.helperTitle, { args: { title: '  helper title  ' } })).rows,
      'helper title',
      'VCF-F-D2 bounded relative helper module executes end to end',
    );
    assert.deepEqual(
      (await client.query(api.todos.visibleTodos, { args: {} })).rows,
      [],
      'VCF-F-D4 persisted visibility starts false/absent without consulting a clock',
    );
    assert.equal(
      (await client.mutate(api.todos.setVisible, {
        args: { id: 'todo_welcome' },
        queue: false,
      })).result,
      null,
      'VCF-F-D4 supported mutation rewrite persists the visibility transition',
    );
    assert.deepEqual(
      (await client.query(api.todos.visibleTodos, { args: {} })).rows.map(({ _id }) => _id),
      ['todo_welcome'],
      'VCF-F-D4 supported query rewrite reads persisted visibility state end to end',
    );

    const memberClient = memberSession.client;
    const outsiderClient = outsiderSession.client;
    client.memberClient = memberClient;
    client.outsiderClient = outsiderClient;
    assert.equal(
      (await memberClient.query(api.todos.getRoom, {
        args: { id: roomId },
      })).rows?.title,
      'Packed room',
      'membership visibility accepts resourceField _id on the resource table',
    );
    assert.deepEqual(
      (await memberClient.query(api.todos.listRoomNotes, {
        args: { roomId },
      })).rows.map(({ body }) => body),
      ['member only'],
      'membership visibility accepts the child resource-id field',
    );
    assert.equal(
      (await outsiderClient.query(api.todos.getRoom, {
        args: { id: roomId },
      })).rows,
      null,
      'non-members cannot read the membership-visible resource row',
    );
    assert.deepEqual(
      (await outsiderClient.query(api.todos.listRoomNotes, {
        args: { roomId },
      })).rows,
      [],
      'non-members cannot read membership-visible child rows',
    );

    const typingRef = generatedEphemeral.typing;
    const typingScope = { roomId };
    memberTypingObserver = await memberClient.subscribeEphemeral(typingRef, {
      connectionId: 'packed-typing-observer',
      scope: typingScope,
      transport: 'poll',
    });
    memberTypingOverlay = await memberClient.subscribeEphemeral(typingRef, {
      connectionId: 'packed-typing-publisher',
      scope: typingScope,
      transport: 'poll',
    });
    await memberTypingOverlay.publish({ name: 'Packed member' }, { ttlMs: 6_000 });
    await memberTypingObserver.drain();
    assert.deepEqual(
      memberTypingObserver.currentEntries().map(({ value }) => value),
      [{ name: 'Packed member' }],
      'membership-backed presence roundtrips through the advertised Familiar entrypoints',
    );
    await expectRuntimeRefusal(
      outsiderClient.subscribeEphemeral(typingRef, {
        connectionId: 'packed-typing-outsider',
        scope: typingScope,
        transport: 'poll',
      }),
      'VCF-F-E1 membership-backed non-member subscribe',
      'SNAPBACK_AUTH_PERMISSION_DENIED',
    );

    await expectRuntimeRefusal(
      client.query(api.todos.invalidRecordList, { args: {} }),
      'VCF-F-Q2 extra record field',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.overBoundRecords, { args: {} }),
      'VCF-F-Q3 over-bound record array',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.invalidUnionRecords, { args: {} }),
      'VCF-F-Q4 unmatched record union',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.emptySingletonRecord, { args: {} }),
      'VCF-F-Q5 empty one-tuple',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.wrongTablePoint, { args: { id: 'other_seed' } }),
      'VCF-F-Q6 wrong-table document',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.invalidSummary, { args: {} }),
      'VCF-F-Q7 extra value-object field',
    );
    await expectRuntimeRefusal(
      client.query(api.todos.invalidCount, { args: {} }),
      'VCF-F-Q8 wrong scalar kind',
    );

    const presentLiveUpdates = [];
    const absentLiveUpdates = [];
    presentLiveHandle = await client.liveQuery(api.todos.get, {
      connectionId: 'packed-point-present',
      args: { id: 'todo_welcome' },
      onUpdate: (todo) => presentLiveUpdates.push(todo),
    });
    absentLiveHandle = await client.liveQuery(api.todos.get, {
      connectionId: 'packed-point-absent',
      args: { id: 'todo_missing' },
      onUpdate: (todo) => absentLiveUpdates.push(todo),
    });
    assert.equal(presentLiveHandle.rows.title, 'packed seed');
    assert.equal(Array.isArray(presentLiveHandle.rows), false);
    assert.equal(absentLiveHandle.rows, null);
    const summaryLiveUpdates = [];
    summaryLiveHandle = await client.liveQuery(api.todos.summary, {
      connectionId: 'packed-value-object',
      args: {},
      onUpdate: (summary) => summaryLiveUpdates.push(summary),
    });
    assert.deepEqual(summaryLiveHandle.rows, { label: 'summary', total: 1 });
    await waitFor(
      () => presentLiveUpdates.some((todo) => todo?.title === 'packed seed')
        && absentLiveUpdates.includes(null)
        && summaryLiveUpdates.some((summary) => summary?.label === 'summary'),
      'headless live single-value projections',
    );

    const mutation = await client.mutate(api.todos.create, {
      args: { title: 'packed mutation' },
      queue: false,
    });
    assert.equal(mutation.result.title, 'packed mutation');
    const storedMutation = (await client.query(api.todos.get, {
      args: { id: mutation.result._id },
    })).rows;
    assert.deepEqual(
      mutation.result,
      storedMutation,
      'mutation settlement returns the exact committed document including system fields',
    );
    for (const field of ['_version', '_createdAt', '_updatedAt']) {
      assert.equal(Number.isSafeInteger(mutation.result[field]), true, field);
    }
    assert.equal(
      (await client.mutate(api.todos.returnTodoId, {
        args: { id: mutation.result._id },
        queue: false,
      })).result,
      mutation.result._id,
    );
    await expectRuntimeRefusal(
      client.mutate(api.todos.returnForeignId, { args: {}, queue: false }),
      'VCF-F-M2 foreign-table id',
    );
    await expectRuntimeRefusal(
      client.mutate(api.todos.partialDocument, { args: {}, queue: false }),
      'VCF-F-M1 partial document',
    );
    const action = await client.run(api.todos.createFromAction, {
      args: { title: 'packed action' },
    });
    assert.equal(action.title, 'packed action');
    const storedAction = (await client.query(api.todos.get, {
      args: { id: action._id },
    })).rows;
    assert.deepEqual(
      action,
      storedAction,
      'nested action settlement preserves the committed mutation document',
    );
    await expectRuntimeRefusal(
      client.run(api.todos.createFromRawString, { args: { title: 'raw string' } }),
      'VCF-F-A1 raw-string mutation reference',
      'SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED',
    );

    preparedBinding = await client.prepareReactBinding({ generatedManifest: descriptor });
    const React = await import(pathToFileURL(join(appRoot, 'node_modules', 'react', 'index.js')).href);
    const TestRenderer = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      'react-test-renderer',
      'index.js',
    )).href);
    const familiarReact = await import(pathToFileURL(join(
      appRoot,
      'node_modules',
      '@expo',
      'snapback',
      'react.mjs',
    )).href);
    const projected = [];
    const Probe = () => {
      projected.push({
        point: familiarReact.useQuery(api.todos.get, { id: 'todo_welcome' }),
        records: familiarReact.useQuery(api.todos.recordList, {}),
        bounded: familiarReact.useQuery(api.todos.boundedRecords, {}),
        union: familiarReact.useQuery(api.todos.unionRecords, {}),
        singleton: familiarReact.useQuery(api.todos.singletonRecord, {}),
        summary: familiarReact.useQuery(api.todos.summary, {}),
        count: familiarReact.useQuery(api.todos.count, {}),
      });
      return null;
    };
    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(React.createElement(
        familiarReact.SnapbackProvider,
        { binding: preparedBinding },
        React.createElement(Probe),
      ));
    });
    await waitFor(
      () => projected.some((value) => value.point?.title === 'packed seed'
        && value.records?.[0]?.title === 'record'
        && value.bounded?.length === 2
        && value.union?.[1]?.kind === 'count'
        && value.singleton?.[0]?.title === 'singleton'
        && value.summary?.label === 'summary'
        && value.count === 2),
      'Familiar React result-partition projection',
    );
    const projectedValues = projected.find((value) => value.point?.title === 'packed seed');
    assert.equal(Array.isArray(projectedValues.point), false, 'useQuery projects one document, not one row array');
    assert.equal(Array.isArray(projectedValues.summary), false, 'useQuery projects one value object, not one row array');

    const assetReceipt = await provePackedFamiliarAsset({
      appRoot,
      packedCli,
      packedRuntimeBinary,
      temporary,
    });
    const explicitEconomyReceipt = await provePackedExplicitPlanEconomy({
      appRoot,
      packedCli,
      packedRuntimeBinary,
      temporary,
    });

    await client.mutate(api.todos.remove, {
      args: { id: 'todo_welcome' },
      queue: false,
    });
    const deleteDeadline = Date.now() + 15_000;
    while (presentLiveHandle.rows !== null && Date.now() < deleteDeadline) {
      await presentLiveHandle.poll();
      if (presentLiveHandle.rows !== null) await sleep(25);
    }
    assert.equal(
      presentLiveHandle.rows,
      null,
      'deleting the point row transitions the typed headless live handle to null',
    );
    await waitFor(
      () => presentLiveUpdates.at(-1) === null,
      'headless live delete transition callback',
    );

    process.stdout.write(`${JSON.stringify({
      schemaVersion: 'snapback.familiar-result-partition-vertical-contract.v3',
      ok: true,
      catalogue: {
        verified: [
          'VCF-F-G1',
          'VCF-F-Q1',
          'VCF-F-Q2',
          'VCF-F-Q3',
          'VCF-F-Q4',
          'VCF-F-Q5',
          'VCF-F-Q6',
          'VCF-F-Q7',
          'VCF-F-Q8',
          'VCF-F-M1',
          'VCF-F-M2',
          'VCF-F-N1',
          'VCF-F-A1',
          'VCF-F-E1',
          'VCF-F-MB1',
          'VCF-F-D1',
          'VCF-F-D2',
          'VCF-F-D3',
          'VCF-F-D4',
          'VCF-F-SQ1',
          'VCF-F-AS1',
        ],
        pending: [],
      },
      packageClosure: installed.packageClosure,
      guide: { query: guideResult.query, path: 'backend/familiar-profile.md', spelling: guideSpelling },
      generation: {
        cleanFirstPass: true,
        resultKinds: Object.fromEntries(
          [...functionByName].map(([name, definition]) => [name, definition.resultContract.kind]),
        ),
      },
      runtime: {
        packedByteIdenticalCarrier: true,
        bareDocumentQuery: true,
        nullablePoint: true,
        documentMutation: true,
        documentAction: true,
        documentArrayQuery: true,
        recordArrayQuery: true,
        boundedRecordArrayQuery: true,
        recordUnionQuery: true,
        singletonTupleQuery: true,
        valueObjectLiveQuery: true,
        scalarQuery: true,
        valueMutation: true,
        nominalId: { sameTable: true, foreignTableAdmission: 'refused' },
      },
      entrypoints: {
        umbrellaServer: advertisedServerNames,
        umbrellaValues: ['v'],
        generatedServer: [...advertisedServerNames, 'v'],
        identityPreserving: true,
      },
      authority: {
        membershipResourceField: { resource: '_id', child: 'roomId' },
        memberRead: true,
        nonMemberHidden: true,
        membershipBackedPresence: true,
      },
      asset: assetReceipt,
      explicitEconomy: explicitEconomyReceipt,
      clients: {
        headless: true,
        headlessLive: { present: true, absent: true, deleteTransition: true },
        react: true,
      },
      negative: {
        codes: [
          'SNAPBACK_HANDLER_RESULT_CONTRACT_INVALID',
          negativeCode,
          runtimeContractCode,
          'SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED',
          'SNAPBACK_CODEGEN_LEGACY_GENERATED_IMPORT',
          'SNAPBACK_TABLE_VISIBILITY_RESOURCE_FIELD_UNKNOWN',
          'SNAPBACK_AUTH_PERMISSION_DENIED',
          'BUNDLE_UNSUPPORTED_TIME',
          'SNAPBACK_CODEGEN_FAMILIAR_SEQUENCE_UNSUPPORTED',
          'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER',
          'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN',
        ],
        functionKinds: ['query', 'mutation', 'action'],
        activationOutput: false,
        bootstrapImportsOnly: true,
        regenerationPreservesCompleteGraph: true,
        rewrite: "explicit profile's result: grammar",
      },
    })}\n`);
  } finally {
    try { await presentLiveHandle?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { await absentLiveHandle?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { await summaryLiveHandle?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { memberTypingOverlay?.dispose?.(); } catch { /* retain the primary proof failure */ }
    try { memberTypingObserver?.dispose?.(); } catch { /* retain the primary proof failure */ }
    if (renderer !== null) {
      try {
        const TestRenderer = await import(pathToFileURL(join(
          appRoot,
          'node_modules',
          'react-test-renderer',
          'index.js',
        )).href);
        await TestRenderer.act(async () => { renderer.unmount(); });
      } catch { /* retain the primary proof failure */ }
    }
    try { await client?.memberClient?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await client?.outsiderClient?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await memberCoordinator?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await outsiderCoordinator?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await client?.close?.(); } catch { /* retain the primary proof failure */ }
    try { await runtime?.stop?.(); } catch { /* retain the primary proof failure */ }
    if (args.keep) process.stderr.write(`kept packed fixture at ${temporary}\n`);
    else rmSync(temporary, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
