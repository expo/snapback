import { strict as assert } from 'node:assert';
import {
  appendFileSync,
  cpSync,
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
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';
import { generate } from '@expo/snapback-codegen';

import {
  VERIFY_CONFIG_CONVENTION,
  VERIFY_RECEIPT_SCHEMA_VERSION,
  aggregateConformance,
  defaultVerifyConfig,
  defineCloudflareVerifyProfile,
  defineRepositoryVerifyProfiles,
  defineStarterVerifyProfile,
  discoverVerifyConfig,
  loadVerifyConfig,
  probeAdmission,
  probeArtifactFreshness,
  probeCapabilities,
  probeServedTarget,
  runVerify,
  validateVerifyReceipt,
} from './verify.mjs';

const thisFile = fileURLToPath(import.meta.url);
const receiptSchema = JSON.parse(readFileSync(new URL('./verify-receipt.schema.json', import.meta.url), 'utf8'));
const validateReceiptSchema = new Ajv2020({ allErrors: true, strict: false }).compile(receiptSchema);
const emptyReport = (overrides = {}) => ({
  missingReads: [],
  missingWrites: [],
  extraReads: [],
  extraWrites: [],
  readProvenance: 'complete',
  writeProvenance: 'complete',
  ...overrides,
});

const path = Object.freeze({
  id: 'query-success',
  kind: 'success',
  targetProfileId: 'local-dev-sqlite-ibex',
  functionId: 'app:list',
});

const profile = (run = async () => ({
  ok: true,
  conformance: [{ pathId: path.id, status: 'observed', report: emptyReport() }],
})) => Object.freeze({
  id: 'local-acceptance',
  title: 'local acceptance',
  testFiles: Object.freeze([thisFile]),
  requiredCapabilities: Object.freeze(['result_contract_v1']),
  paths: Object.freeze([path]),
  run,
});

const config = (profiles = [profile()]) => Object.freeze({
  ...defaultVerifyConfig({ backendDirectory: '.' }),
  context: Object.freeze({
    target: Object.freeze({ kind: 'local-generated-artifact', identity: null }),
    data: Object.freeze({ kind: 'sqlite-fixture', identity: 'sha256:data-1' }),
    authority: Object.freeze({ kind: 'dev-asserted', identity: 'actor-1', principalClass: 'dev' }),
    seed: Object.freeze({ kind: 'authored-seed-bytes', identity: 'sha256:seed' }),
  }),
  profiles: Object.freeze(profiles),
});

const artifact = (overrides = {}) => ({
  ok: true,
  identity: {
    appId: 'app',
    schemaVersion: 'snapback.v0',
    schemaHash: 'sha256:schema',
    bundleHash: 'sha256:bundle',
    inputsHash: 'inputs-1',
  },
  seedIdentity: { kind: 'authored-seed-bytes', identity: 'sha256:seed' },
  generatedRoot: '/generated',
  verifiedGraph: { inputsHash: 'inputs-1', files: 3 },
  manifests: {
    artifactIndex: { artifactKind: 'artifactIndex' },
    schema: {
      artifactKind: 'schemaManifest', appId: 'app', schemaVersion: 'snapback.v0',
      schemaHash: 'sha256:schema', inputsHash: 'inputs-1', requiredCapabilities: [],
    },
    functions: {
      artifactKind: 'functionManifest', appId: 'app', schemaVersion: 'snapback.v0',
      bundleHash: 'sha256:bundle', inputsHash: 'inputs-1',
      functions: [{ id: 'app:list', requiredCapabilities: ['result_contract_v1'] }],
    },
    capability: {
      artifactKind: 'capabilityManifest', targetProfileId: 'local-dev-sqlite-ibex',
      supportedCapabilities: ['result_contract_v1'],
    },
  },
  diagnostics: [],
  ...overrides,
});

const passOptions = (overrides = {}) => ({
  artifactProbe: async () => artifact(),
  runtimeProbe: async () => ({ ok: true, receipt: { digest: 'runtime-1' }, diagnostics: [] }),
  servedTargetProbe: async () => ({
    ok: true,
    claimed: false,
    evidence: { disposition: 'not-configured', claim: false },
    diagnostics: [],
  }),
  now: (() => { let now = 100; return () => ++now; })(),
  ...overrides,
});

let cases = 0;

const validStarterAcceptanceReceipt = () => ({
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: 'passed',
  expectedCheckCount: 2,
  executedCheckCount: 2,
  checks: [
    { id: 'starter-query', status: 'passed' },
    { id: 'starter-mutation', status: 'passed' },
  ],
  identity: {
    artifact: {
      appId: 'app',
      inputsHash: 'inputs-1',
      schemaHash: 'sha256:schema',
      bundleHash: 'sha256:bundle',
    },
    loaded: { appId: 'app', bundleHash: 'sha256:bundle' },
  },
  lifecycle: {
    owned: true,
    applicationReadyObserved: true,
    waitLevel: 'application',
    firstQueryRetries: 0,
  },
  operations: { 'starter-query': 'app:list', 'starter-mutation': 'app:create' },
  cleanup: {
    attempted: true,
    clientResourcesReleased: true,
    devExited: true,
    temporaryStateRemoved: true,
    ok: true,
  },
  diagnostic: null,
});

const starterReceiptPaths = Object.freeze([
  Object.freeze({
    id: 'starter-query',
    kind: 'success',
    targetProfileId: 'local-dev-sqlite-ibex',
    functionId: 'app:list',
  }),
  Object.freeze({
    id: 'starter-mutation',
    kind: 'success',
    targetProfileId: 'local-dev-sqlite-ibex',
    functionId: 'app:create',
  }),
]);

const starterArtifact = (functionIds = ['app:list', 'app:create']) => artifact({
  manifests: {
    ...artifact().manifests,
    functions: {
      ...artifact().manifests.functions,
      functions: functionIds.map((id) => ({ id })),
    },
  },
});

async function runStarterReceiptFixture({
  receipt = null,
  source = null,
  paths = starterReceiptPaths,
  artifactValue = starterArtifact(),
  timeoutMs = 10_000,
  removeBeforeRun = false,
} = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-starter-receipt-fixture-'));
  const acceptanceFile = join(scratch, 'acceptance.mjs');
  writeFileSync(
    acceptanceFile,
    source ?? `process.stdout.write(${JSON.stringify(`${JSON.stringify(receipt)}\n`)});\n`,
  );
  try {
    const starter = defineStarterVerifyProfile({
      id: 'starter-receipt-fixture',
      acceptanceFile,
      paths,
      timeoutMs,
    });
    if (removeBeforeRun) rmSync(scratch, { recursive: true, force: true });
    return await starter.run({ artifact: artifactValue, identityContext: config().context });
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-repository-verify-adapter-'));
  const catalogFile = join(scratch, 'catalog.v1.json');
  writeFileSync(catalogFile, `${JSON.stringify({
    schemaVersion: 'snapback.demo-catalog.v1',
    entries: [
      {
        id: 'legacy-demo',
        directory: dirname(thisFile),
        targets: ['local'],
        proof: 'node legacy-demo.mjs',
        evidence: [thisFile, fileURLToPath(new URL('./verify.mjs', import.meta.url))],
      },
      {
        id: 'hosted-only',
        directory: '.',
        targets: ['cloudflare'],
        proof: 'node hosted.mjs',
        evidence: [thisFile],
      },
    ],
  }, null, 2)}\n`);
  try {
    let invocation = null;
    let commandOutcome = { ok: true, exit: { code: 0, signal: null, error: null }, stderr: '' };
    const profiles = defineRepositoryVerifyProfiles({
      catalogFile,
      repositoryRoot: '/',
      runCommand: async (input) => {
        invocation = input;
        return commandOutcome;
      },
    });
    assert.equal(profiles.length, 1);
    assert.equal(profiles[0].id, 'repository-demo:legacy-demo');
    assert.deepEqual(profiles[0].paths.map(({ id }) => id), ['repository:legacy-demo:proof']);
    assert.equal(profiles[0].testFiles.length, 2, 'only catalog plus executed proof evidence are bound');
    const outcome = await profiles[0].run({ identityContext: config().context });
    assert.equal(outcome.ok, true);
    assert.equal(invocation.command, 'node legacy-demo.mjs');
    assert.equal(invocation.cwd, dirname(thisFile));
    assert.equal(outcome.conformance[0].report.readProvenance, 'unsupported');
    assert.equal(outcome.conformance[0].report.writeProvenance, 'unsupported');

    commandOutcome = {
      ok: false,
      exit: { code: null, signal: null, error: new Error('spawn refused') },
      stderr: 'spawn refused',
    };
    const notExecuted = await profiles[0].run({ identityContext: config().context });
    assert.equal(notExecuted.ok, false);
    assert.deepEqual(notExecuted.conformance, [], 'a command that never executed observes no path');
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const repositoryRoot = resolve(dirname(thisFile), '../..');
  const catalogFile = join(repositoryRoot, 'demos/catalog.v1.json');
  const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
  const expected = catalog.entries.filter(({ targets }) => targets.includes('local'));
  const profiles = defineRepositoryVerifyProfiles({ catalogFile, repositoryRoot });
  assert.equal(profiles.length, expected.length);
  assert.deepEqual(
    profiles.map(({ id }) => id),
    expected.map(({ id }) => `repository-demo:${id}`),
  );
  assert.ok(profiles.every(({ paths }) => paths.length > 0));
  assert.ok(profiles.every(({ paths }) => paths.length === 1));
  const rbac = profiles.find(({ id }) => id === 'repository-demo:rbac');
  assert.equal(rbac.paths.length, 1, 'RBAC runs one proof and registers one observed path');
  cases += 1;
}

{
  const packageRoot = dirname(thisFile);
  const repositoryRoot = resolve(packageRoot, '../..');
  const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(repositoryRoot, 'target', 'debug', 'snapback');
  assert.ok(
    existsSync(runtimeBinary),
    `native snapback binary missing at ${runtimeBinary}; run cargo build --bin snapback or set SNAPBACK_RUNTIME_BINARY`,
  );
  const { managedAdminToken, readReadyDescriptor, runDev, scaffoldApp } = await import('./index.mjs');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-verify-live-target-')));
  const projectRoot = join(scratch, 'app');
  const backend = join(projectRoot, 'snapback');
  const readyFile = join(projectRoot, '.snapback', 'verify.ready.json');
  const database = join(projectRoot, '.snapback', 'verify.sqlite3');
  let dev = null;
  try {
    assert.equal(scaffoldApp(projectRoot).ok, true);
    const schemaPath = join(backend, 'schema.mjs');
    const sessionsSchema = readFileSync(schemaPath, 'utf8');
    const devSchema = sessionsSchema
      .replace(
        /auth:\s*\{\s*mode:\s*['"]sessions['"]\s*\}/u,
        "auth: { mode: 'dev' }",
      )
      .replace(/,\s*authProgram(?=\s*\})/u, '');
    assert.notEqual(devSchema, sessionsSchema, 'positive live probe fixture must use dev auth');
    writeFileSync(schemaPath, devSchema);
    dev = await runDev({
      backendDirectory: backend,
      projectRoot,
      readyFile,
      database,
      runtimeBinary,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    assert.equal(dev.ok, true, JSON.stringify(dev));
    const descriptor = readReadyDescriptor(readyFile);
    const adminToken = managedAdminToken(descriptor, database);
    const liveConfig = Object.freeze({
      ...defaultVerifyConfig({ backendDirectory: backend }),
      servedTarget: Object.freeze({
        url: descriptor.serverUrl,
        adminTokenEnv: 'SNAPBACK_TEST_ADMIN_TOKEN',
        authorityMode: 'admin-token',
        timeoutMs: 10_000,
      }),
    });
    const fresh = await probeArtifactFreshness(liveConfig);
    assert.equal(fresh.ok, true, JSON.stringify(fresh.diagnostics));
    const live = await probeServedTarget(fresh, liveConfig, {
      env: { SNAPBACK_TEST_ADMIN_TOKEN: adminToken },
    });
    assert.equal(live.ok, true, JSON.stringify(live.diagnostics));
    assert.equal(live.claimed, true);
    assert.equal(live.evidence.authorityMode, 'admin-token');
    assert.match(live.evidence.limitation, /sessions-mode/u);
    assert.equal(live.observation.serverUrl, descriptor.serverUrl);
    assert.equal(live.observation.appId, fresh.identity.appId);
    assert.equal(live.observation.schemaHash, fresh.identity.schemaHash);
    assert.equal(live.observation.bundleHash, fresh.identity.bundleHash);
    assert.equal(probeAdmission(fresh, live).ok, true);
    assert.equal(probeCapabilities(fresh, [], live).ok, true);
    assert.equal(JSON.stringify(live).includes(adminToken), false);

    const receipt = await runVerify(liveConfig, {
      runtimeProbe: async () => ({ ok: true, receipt: { digest: 'runtime-live' }, diagnostics: [] }),
      env: { SNAPBACK_TEST_ADMIN_TOKEN: adminToken },
    });
    assert.equal(receipt.ok, true, JSON.stringify(receipt.diagnostics));
    assert.equal(receipt.stages[2].evidence.admissionMode, 'authenticated-live-served-target-admission');
    assert.equal(receipt.stages[3].evidence.resolutionMode, 'authenticated-live-served-target');
    assert.equal(receipt.stages[2].evidence.servedTarget.authorityMode, 'admin-token');
    cases += 1;
  } finally {
    await dev?.close?.();
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const loaded = await loadVerifyConfig(fileURLToPath(
    new URL('./fixtures/verify/snapback.verify.config.mjs', import.meta.url),
  ));
  const receipt = await runVerify(loaded, passOptions());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.acceptanceProfiles[0].profileId, 'local-headless');
  assert.equal(receipt.acceptanceProfiles[0].status, 'passed');
  assert.equal(receipt.acceptanceProfiles[0].context.target.identity, 'inputs-1');
  assert.equal(
    receipt.acceptanceProfiles[0].context.data.identity,
    `sha256:${'d'.repeat(64)}`,
  );
  assert.equal(receipt.stages[2].evidence.conformance.status, 'partial');
  assert.equal(receipt.stages[2].evidence.conformance.pathEvidence[0].status, 'unsupported');
  assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));
  cases += 1;
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-starter-verify-profile-'));
  const acceptanceFile = join(scratch, 'acceptance.mjs');
  writeFileSync(acceptanceFile, `process.stdout.write(JSON.stringify({
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: 'passed',
  expectedCheckCount: 2,
  executedCheckCount: 2,
  checks: [
    { id: 'starter-query', status: 'passed' },
    { id: 'starter-mutation', status: 'passed' },
  ],
  identity: {
    artifact: {
      appId: 'app',
      inputsHash: 'inputs-1',
      schemaHash: 'sha256:schema',
      bundleHash: 'sha256:bundle',
    },
    loaded: { appId: 'app', bundleHash: 'sha256:bundle' },
  },
  lifecycle: {
    owned: true,
    applicationReadyObserved: true,
    waitLevel: 'application',
    firstQueryRetries: 0,
  },
  operations: { 'starter-query': 'app:list', 'starter-mutation': 'app:create' },
  cleanup: {
    attempted: true,
    clientResourcesReleased: true,
    devExited: true,
    temporaryStateRemoved: true,
    ok: true,
  },
  diagnostic: null,
}) + '\\n');\n`);
  try {
    const paths = [
      { id: 'starter-query', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'app:list' },
      { id: 'starter-mutation', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex', functionId: 'app:create' },
    ];
    const starter = defineStarterVerifyProfile({
      id: 'starter-acceptance',
      acceptanceFile,
      additionalTestFiles: [thisFile],
      paths,
      provenanceBaseline: paths.map(({ id }) => id),
    });
    assert.deepEqual(starter.testFiles, [realpathSync(acceptanceFile), thisFile]);
    const identityContext = config().context;
    const outcome = await starter.run({ artifact: starterArtifact(), identityContext });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.context, identityContext);
    assert.deepEqual(outcome.conformance.map(({ pathId }) => pathId), paths.map(({ id }) => id));
    assert.ok(outcome.conformance.every(({ report }) => (
      report.readProvenance === 'unsupported' && report.writeProvenance === 'unsupported'
    )));
    assert.deepEqual(starter.coverageCapability, {
      claim: 'identity-bound-path-observation',
      baselinePathIds: ['starter-mutation', 'starter-query'],
      readProvenance: 'unsupported',
      writeProvenance: 'unsupported',
    });

    const receipt = await runVerify(config([starter]), passOptions({
      artifactProbe: async () => starterArtifact(),
    }));
    const conformance = receipt.stages[2].evidence.conformance;
    assert.equal(receipt.ok, true, JSON.stringify(receipt));
    assert.equal(conformance.status, 'partial');
    assert.equal(conformance.complete, false);
    assert.equal(conformance.coverageRequirement, 'path-observation');
    assert.ok(conformance.pathEvidence.every(({ status, report }) => (
      status === 'unsupported'
      && report.readProvenance === 'unsupported'
      && report.writeProvenance === 'unsupported'
    )));
    assert.deepEqual(conformance.diagnostics, []);
    assert.deepEqual(conformance.overDeclarations, []);
    assert.equal(receipt.acceptanceProfiles[0].coverageCapability.claim, 'identity-bound-path-observation');
    assert.equal(receipt.nonclaims.filter((entry) => entry.includes('identity-bound path observation only')).length, 1);
    assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));

    const strictReceipt = await runVerify(Object.freeze({
      ...config([starter]),
      coverageRequirement: 'complete-operation-provenance',
    }), passOptions({
      artifactProbe: async () => starterArtifact(),
    }));
    assert.equal(strictReceipt.ok, false);
    assert.equal(strictReceipt.stages[2].status, 'failed');
    assert.equal(strictReceipt.stages[2].evidence.conformance.complete, false);
    assert.equal(
      strictReceipt.stages[2].evidence.conformance.coverageRequirement,
      'complete-operation-provenance',
    );
    assert.deepEqual(
      strictReceipt.stages[2].diagnostics.map(({ code }) => code),
      ['SNAPBACK_VERIFY_COVERAGE_PROVENANCE_REQUIRED'],
    );
    assert.equal(validateReceiptSchema(strictReceipt), true, JSON.stringify(validateReceiptSchema.errors));

    const expandedWithoutBaseline = defineStarterVerifyProfile({
      id: 'starter-expanded-without-baseline',
      acceptanceFile,
      paths,
      provenanceBaseline: ['starter-query'],
    });
    const expandedReceipt = await runVerify(config([expandedWithoutBaseline]), passOptions({
      artifactProbe: async () => starterArtifact(),
    }));
    assert.equal(expandedReceipt.ok, true, JSON.stringify(expandedReceipt));
    assert.deepEqual(
      expandedReceipt.stages[2].diagnostics.map(({ code, details }) => ({ code, details })),
      [{
        code: 'SNAPBACK_VERIFY_COVERAGE_EVIDENCE_UNSUPPORTED',
        details: {
          profileId: 'starter-expanded-without-baseline',
          pathId: 'starter-mutation',
          readProvenance: 'unsupported',
          writeProvenance: 'unsupported',
        },
      }],
    );

    const configOnlyPath = Object.freeze({
      id: 'config-only-path',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: null,
    });
    assert.throws(
      () => defineStarterVerifyProfile({
        id: 'starter-config-only-baseline',
        acceptanceFile,
        paths: [...paths, configOnlyPath],
        provenanceBaseline: [...paths.map(({ id }) => id), configOnlyPath.id],
      }),
      /baselinePathIds must name paths with receipt-addressed observation identities/u,
    );
    const configOnlyUnbaselined = defineStarterVerifyProfile({
      id: 'starter-config-only-unbaselined',
      acceptanceFile,
      paths: [...paths, configOnlyPath],
      provenanceBaseline: paths.map(({ id }) => id),
    });
    const configOnlyReceipt = await runVerify(config([configOnlyUnbaselined]), passOptions({
      artifactProbe: async () => starterArtifact(),
    }));
    assert.equal(configOnlyReceipt.ok, false);
    assert.deepEqual(
      configOnlyReceipt.stages[2].diagnostics.map(({ code, details }) => ({
        code,
        pathId: details.pathId,
      })),
      [{ code: 'SNAPBACK_VERIFY_COVERAGE_PATH_INCOMPLETE', pathId: configOnlyPath.id }],
    );
    assert.equal(
      configOnlyReceipt.stages[2].evidence.conformance.pathEvidence.find(({ id }) => (
        id === configOnlyPath.id
      )).report,
      null,
    );
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-starter-verify-invalid-receipt-'));
  const acceptanceFile = join(scratch, 'acceptance.mjs');
  writeFileSync(acceptanceFile, `process.stdout.write(JSON.stringify({
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: 'passed',
  expectedCheckCount: 1,
  executedCheckCount: 1,
  checks: [],
  cleanup: { ok: true },
}) + '\\n');\n`);
  try {
    const starter = defineStarterVerifyProfile({ id: 'invalid-starter', acceptanceFile });
    const outcome = await starter.run({ identityContext: config().context });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.diagnostics[0].code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED');
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const omissionCases = [
    ['$.schemaVersion', (receipt) => { delete receipt.schemaVersion; }, 'malformed-receipt'],
    ['$.status', (receipt) => { delete receipt.status; }, 'malformed-receipt'],
    ['$.expectedCheckCount', (receipt) => { delete receipt.expectedCheckCount; }],
    ['$.executedCheckCount', (receipt) => { delete receipt.executedCheckCount; }],
    ['$.checks', (receipt) => { delete receipt.checks; }],
    ['$.checks[0].id', (receipt) => { delete receipt.checks[0].id; }],
    ['$.checks[1].id', (receipt) => { delete receipt.checks[1].id; }],
    ['$.checks[0].status', (receipt) => { delete receipt.checks[0].status; }],
    ['$.checks[1].status', (receipt) => { delete receipt.checks[1].status; }],
    ['$.identity.artifact.appId', (receipt) => { delete receipt.identity.artifact.appId; }],
    ['$.identity.loaded.appId', (receipt) => { delete receipt.identity.loaded.appId; }],
    ['$.lifecycle.applicationReadyObserved', (receipt) => { delete receipt.lifecycle.applicationReadyObserved; }],
    ['$.cleanup.attempted', (receipt) => { delete receipt.cleanup.attempted; }],
    ['$.cleanup.clientResourcesReleased', (receipt) => { delete receipt.cleanup.clientResourcesReleased; }],
    ['$.cleanup.devExited', (receipt) => { delete receipt.cleanup.devExited; }],
    ['$.cleanup.temporaryStateRemoved', (receipt) => { delete receipt.cleanup.temporaryStateRemoved; }],
    ['$.cleanup.ok', (receipt) => { delete receipt.cleanup.ok; }],
    ['$.diagnostic', (receipt) => { delete receipt.diagnostic; }],
  ];
  for (const [expectedPath, omit, expectedOutcome = 'incomplete-passing-receipt'] of omissionCases) {
    const receipt = validStarterAcceptanceReceipt();
    omit(receipt);
    const outcome = await runStarterReceiptFixture({ receipt });
    assert.equal(outcome.ok, false, expectedPath);
    const failure = outcome.diagnostics[0];
    assert.equal(failure.code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED', expectedPath);
    assert.equal(failure.details.outcome, expectedOutcome, expectedPath);
    assert.ok(failure.details.invalidPaths.some(({ path: invalidPath }) => invalidPath === expectedPath), expectedPath);
    assert.ok(failure.details.invalidPaths.every(({ expected, observed }) => (
      typeof expected.kind === 'string'
      && typeof expected.state === 'string'
      && typeof observed.kind === 'string'
      && typeof observed.state === 'string'
    )), expectedPath);
    if (expectedOutcome === 'incomplete-passing-receipt') {
      assert.equal(Object.hasOwn(failure.details, 'exitCode'), false, expectedPath);
      assert.equal(Object.hasOwn(failure.details, 'receiptStatus'), false, expectedPath);
    }
  }
  cases += 1;
}

{
  const missingRegisteredOperation = validStarterAcceptanceReceipt();
  delete missingRegisteredOperation.operations['starter-query'];
  const missingOperation = await runStarterReceiptFixture({ receipt: missingRegisteredOperation });
  assert.equal(missingOperation.ok, false);
  assert.ok(missingOperation.diagnostics[0].details.invalidPaths.some(({ path: invalidPath }) => (
    invalidPath === '$.operations'
  )));

  const aliasedOperations = validStarterAcceptanceReceipt();
  aliasedOperations.operations = {
    listTodos: 'app:list',
    createTodo: 'app:create',
  };
  const aliased = await runStarterReceiptFixture({ receipt: aliasedOperations });
  assert.equal(aliased.ok, false);
  assert.ok(aliased.diagnostics[0].details.invalidPaths.some(({ path: invalidPath }) => (
    invalidPath.includes('starter-query')
  )));

  const expoChatReceipt = validStarterAcceptanceReceipt();
  expoChatReceipt.checks = [
    { id: 'conversation-surface-read', status: 'passed' },
    { id: 'send-message', status: 'passed' },
  ];
  expoChatReceipt.operations = {
    'conversation-surface-read': 'expo-chat:messagesForConversation',
    'send-message': 'expo-chat:sendMessage',
  };
  const expoChat = await runStarterReceiptFixture({
    receipt: expoChatReceipt,
    paths: [
      {
        id: 'conversation-surface-read',
        kind: 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        functionId: 'expo-chat:messagesForConversation',
      },
      {
        id: 'send-message',
        kind: 'success',
        targetProfileId: 'local-dev-sqlite-ibex',
        functionId: 'expo-chat:sendMessage',
      },
    ],
    artifactValue: starterArtifact([
      'expo-chat:messagesForConversation',
      'expo-chat:sendMessage',
      'expo-chat:sendReply',
      'expo-chat:addReaction',
    ]),
  });
  assert.equal(expoChat.ok, true, JSON.stringify(expoChat.diagnostics));
  assert.deepEqual(
    expoChat.conformance.map(({ pathId }) => pathId),
    ['conversation-surface-read', 'send-message'],
  );
  cases += 1;
}

{
  const absentBundleHashes = validStarterAcceptanceReceipt();
  delete absentBundleHashes.identity.artifact.bundleHash;
  delete absentBundleHashes.identity.loaded.bundleHash;
  const absentBoth = await runStarterReceiptFixture({ receipt: absentBundleHashes });
  assert.equal(absentBoth.ok, false);
  assert.ok(absentBoth.diagnostics[0].details.invalidPaths.some(({ path: invalidPath }) => (
    invalidPath === '$.identity.artifact.bundleHash'
  )));

  const invalidBundleHashes = [
    ['null', null, 'null'],
    ['number', 7, 'integer'],
    ['object', { digest: 'bundle' }, 'object'],
  ];
  for (const [label, bundleHash, observedKind] of invalidBundleHashes) {
    const invalidBundleHashReceipt = validStarterAcceptanceReceipt();
    invalidBundleHashReceipt.identity.artifact.bundleHash = bundleHash;
    invalidBundleHashReceipt.identity.loaded.bundleHash = bundleHash;
    const invalidBundleHash = await runStarterReceiptFixture({ receipt: invalidBundleHashReceipt });
    assert.equal(invalidBundleHash.ok, false, label);
    assert.equal(
      invalidBundleHash.diagnostics[0].code,
      'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED',
      label,
    );
    assert.deepEqual(
      invalidBundleHash.diagnostics[0].details.invalidPaths.map(({ path, expected, observed }) => ({
        path,
        expectedKind: expected.kind,
        observedKind: observed.kind,
      })),
      [
        {
          path: '$.identity.artifact.bundleHash',
          expectedKind: 'string',
          observedKind,
        },
        {
          path: '$.identity.loaded.bundleHash',
          expectedKind: 'string',
          observedKind,
        },
      ],
      label,
    );
  }

  const missingLoadedBundleHash = validStarterAcceptanceReceipt();
  delete missingLoadedBundleHash.identity.loaded.bundleHash;
  const missingLoaded = await runStarterReceiptFixture({ receipt: missingLoadedBundleHash });
  assert.equal(missingLoaded.ok, false);
  assert.equal(
    missingLoaded.diagnostics[0].details.invalidPaths[0].path,
    '$.identity.loaded.bundleHash',
  );
  cases += 1;
}

{
  const receipt = validStarterAcceptanceReceipt();
  receipt.operations = {
    'starter-query': 'app:list',
    'starter-mutation': 'app:create',
    expensesQuery: 'app:expenses',
    addExpense: 'app:addExpense',
    applicationPayload: 'application-payload-must-not-appear',
  };
  const outcome = await runStarterReceiptFixture({
    receipt,
    artifactValue: starterArtifact(['app:expenses', 'app:addExpense']),
  });
  assert.equal(outcome.ok, false);
  const failure = outcome.diagnostics[0];
  assert.equal(failure.code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED');
  assert.equal(failure.details.outcome, 'incomplete-passing-receipt');
  assert.equal(failure.details.invalidPathCount, 4);
  assert.ok(failure.details.invalidPaths.some(({ path: invalidPath, observed }) => (
    invalidPath === '$.operations' && observed.state === 'stale-registration'
  )));
  assert.deepEqual(failure.details.remediation, {
    kind: 'refresh-generated-operation-registration',
    staleRegistrationPaths: [
      {
        pathId: 'starter-query',
        pathIdTruncated: false,
        functionId: 'app:list',
        functionIdTruncated: false,
      },
      {
        pathId: 'starter-mutation',
        pathIdTruncated: false,
        functionId: 'app:create',
        functionIdTruncated: false,
      },
    ],
    staleRegistrationPathsTruncated: false,
    registeredPaths: [
      {
        pathId: 'starter-query',
        pathIdTruncated: false,
        functionId: 'app:list',
        functionIdTruncated: false,
      },
      {
        pathId: 'starter-mutation',
        pathIdTruncated: false,
        functionId: 'app:create',
        functionIdTruncated: false,
      },
    ],
    registeredPathsTruncated: false,
    unclaimedOperationPaths: [
      {
        receiptPath: '$.operations.addExpense',
        functionId: 'app:addExpense',
        functionIdTruncated: false,
      },
      {
        receiptPath: '$.operations.expensesQuery',
        functionId: 'app:expenses',
        functionIdTruncated: false,
      },
    ],
    unclaimedOperationPathsTruncated: false,
    instruction: 'Refresh the starter acceptance registration from generated operation references and rerun snapback verify.',
  });
  assert.equal(JSON.stringify(failure).includes('application-payload-must-not-appear'), false);
  assert.deepEqual(outcome.conformance, []);
  cases += 1;
}

{
  const stalePathId = `stale-path-${'p'.repeat(300)}`;
  const staleFunctionId = `app:${'s'.repeat(300)}`;
  const replacementFunctionId = `app:${'r'.repeat(300)}`;
  const receipt = validStarterAcceptanceReceipt();
  receipt.operations = { replacement: replacementFunctionId };
  const outcome = await runStarterReceiptFixture({
    receipt,
    paths: [{
      id: stalePathId,
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      functionId: staleFunctionId,
    }],
    artifactValue: starterArtifact([replacementFunctionId]),
  });
  const remediation = outcome.diagnostics[0].details.remediation;
  assert.equal(remediation.staleRegistrationPaths[0].pathId.length, 256);
  assert.equal(remediation.staleRegistrationPaths[0].pathIdTruncated, true);
  assert.equal(remediation.staleRegistrationPaths[0].functionId.length, 256);
  assert.equal(remediation.staleRegistrationPaths[0].functionIdTruncated, true);
  assert.equal(remediation.unclaimedOperationPaths[0].functionId.length, 256);
  assert.equal(remediation.unclaimedOperationPaths[0].functionIdTruncated, true);
  cases += 1;
}

{
  const processFailure = await runStarterReceiptFixture({
    source: `process.stderr.write('x'.repeat(20_000)); process.exitCode = 7;\n`,
  });
  const missingReceipt = await runStarterReceiptFixture({ source: '// no receipt\n' });
  const malformedReceipt = await runStarterReceiptFixture({
    source: `process.stdout.write('{"schemaVersion":');\n`,
  });
  const malformedNullReceipt = await runStarterReceiptFixture({
    source: `process.stdout.write('null\\n');\n`,
  });
  const failedReceiptValue = validStarterAcceptanceReceipt();
  failedReceiptValue.status = 'failed';
  failedReceiptValue.diagnostic = {
    code: 'SNAPBACK_STARTER_CHECK_FAILED',
    message: 'm'.repeat(10_000),
  };
  const failedReceipt = await runStarterReceiptFixture({
    source: `process.stdout.write(${JSON.stringify(`${JSON.stringify(failedReceiptValue)}\n`)}); process.exitCode = 1;\n`,
  });
  const passingReceiptProcessFailureValue = validStarterAcceptanceReceipt();
  const passingReceiptProcessFailure = await runStarterReceiptFixture({
    source: `process.stdout.write(${JSON.stringify(`${JSON.stringify(passingReceiptProcessFailureValue)}\n`)}); process.exitCode = 9;\n`,
  });
  const cleanupFailedReceiptValue = validStarterAcceptanceReceipt();
  cleanupFailedReceiptValue.status = 'failed';
  cleanupFailedReceiptValue.cleanup.ok = false;
  cleanupFailedReceiptValue.diagnostic = {
    code: 'SNAPBACK_STARTER_CLEANUP_FAILED',
    message: 'application cleanup value must remain unsafe',
  };
  const cleanupFailedReceipt = await runStarterReceiptFixture({
    source: `process.stdout.write(${JSON.stringify(`${JSON.stringify(cleanupFailedReceiptValue)}\n`)}); process.exitCode = 1;\n`,
  });
  const identityFailedReceiptValue = validStarterAcceptanceReceipt();
  identityFailedReceiptValue.status = 'failed';
  identityFailedReceiptValue.identity.loaded.bundleHash = 'different-bundle';
  identityFailedReceiptValue.diagnostic = {
    code: 'SNAPBACK_STARTER_ARTIFACT_IDENTITY_MISMATCH',
    message: 'application identity value must remain unsafe',
  };
  const identityFailedReceipt = await runStarterReceiptFixture({
    source: `process.stdout.write(${JSON.stringify(`${JSON.stringify(identityFailedReceiptValue)}\n`)}); process.exitCode = 1;\n`,
  });
  const childError = await runStarterReceiptFixture({ removeBeforeRun: true });
  const incompleteReceiptValue = validStarterAcceptanceReceipt();
  delete incompleteReceiptValue.lifecycle.applicationReadyObserved;
  const incompleteReceipt = await runStarterReceiptFixture({ receipt: incompleteReceiptValue });

  assert.deepEqual([
    processFailure,
    missingReceipt,
    malformedReceipt,
    failedReceipt,
    incompleteReceipt,
  ].map((outcome) => outcome.diagnostics[0].details.outcome), [
    'process-failure',
    'missing-receipt',
    'malformed-receipt',
    'failed-receipt',
    'incomplete-passing-receipt',
  ]);
  assert.ok([
    processFailure,
    missingReceipt,
    malformedReceipt,
    failedReceipt,
    incompleteReceipt,
  ].every((outcome) => outcome.diagnostics[0].code === 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED'));
  assert.equal(processFailure.diagnostics[0].details.exitCode, 7);
  assert.equal(Object.hasOwn(processFailure.diagnostics[0].details, 'stderr'), false);
  assert.equal(processFailure.unsafeDebug.stderr.length, 16_384);
  assert.equal(processFailure.unsafeDebug.stderrTruncated, true);
  assert.equal(malformedNullReceipt.diagnostics[0].details.outcome, 'malformed-receipt');
  assert.equal(malformedNullReceipt.diagnostics[0].details.invalidPaths[0].path, '$');
  assert.equal(failedReceipt.diagnostics[0].details.causeCode, 'SNAPBACK_STARTER_CHECK_FAILED');
  assert.equal(failedReceipt.diagnostics[0].message, 'starter acceptance returned a failed receipt');
  assert.equal(failedReceipt.unsafeDebug.receiptDiagnosticMessage.length, 4_096);
  assert.equal(failedReceipt.unsafeDebug.receiptDiagnosticMessageTruncated, true);
  assert.equal(
    passingReceiptProcessFailure.diagnostics[0].message,
    'starter acceptance process failed despite returning a passing receipt',
  );
  assert.equal(cleanupFailedReceipt.diagnostics[0].details.outcome, 'failed-receipt');
  assert.equal(cleanupFailedReceipt.diagnostics[0].details.causeCode, 'SNAPBACK_STARTER_CLEANUP_FAILED');
  assert.equal(cleanupFailedReceipt.diagnostics[0].details.receiptStatus, 'failed');
  assert.equal(identityFailedReceipt.diagnostics[0].details.outcome, 'failed-receipt');
  assert.equal(
    identityFailedReceipt.diagnostics[0].details.causeCode,
    'SNAPBACK_STARTER_ARTIFACT_IDENTITY_MISMATCH',
  );
  assert.equal(identityFailedReceipt.diagnostics[0].details.receiptStatus, 'failed');
  assert.equal(
    JSON.stringify([cleanupFailedReceipt.diagnostics, identityFailedReceipt.diagnostics])
      .includes('application cleanup value must remain unsafe'),
    false,
  );
  assert.equal(
    JSON.stringify([cleanupFailedReceipt.diagnostics, identityFailedReceipt.diagnostics])
      .includes('application identity value must remain unsafe'),
    false,
  );
  assert.equal(childError.diagnostics[0].details.outcome, 'process-failure');
  assert.equal(childError.diagnostics[0].details.causeCode, 'ENOENT');
  assert.equal(childError.diagnostics[0].message, 'starter acceptance process failed before returning a receipt');
  assert.notEqual(childError.unsafeDebug.childErrorMessage, '');
  cases += 1;
}

{
  const cleanupFailureValue = validStarterAcceptanceReceipt();
  cleanupFailureValue.cleanup.ok = false;
  const cleanupFailure = await runStarterReceiptFixture({ receipt: cleanupFailureValue });
  const identityMismatchValue = validStarterAcceptanceReceipt();
  identityMismatchValue.identity.loaded.bundleHash = 'different-bundle';
  const identityMismatch = await runStarterReceiptFixture({ receipt: identityMismatchValue });
  assert.equal(cleanupFailure.diagnostics[0].code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED');
  assert.equal(cleanupFailure.diagnostics[0].details.invalidPaths[0].path, '$.cleanup.ok');
  assert.equal(identityMismatch.diagnostics[0].code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_FAILED');
  assert.equal(identityMismatch.diagnostics[0].details.invalidPaths[0].path, '$.identity.loaded.bundleHash');

  const multipleFailuresValue = validStarterAcceptanceReceipt();
  delete multipleFailuresValue.lifecycle.applicationReadyObserved;
  delete multipleFailuresValue.cleanup.ok;
  const multipleFailures = await runStarterReceiptFixture({ receipt: multipleFailuresValue });
  assert.equal(multipleFailures.diagnostics[0].details.invalidPathCount, 2);
  assert.deepEqual(
    multipleFailures.diagnostics[0].details.invalidPaths.map(({ path: invalidPath }) => invalidPath),
    ['$.lifecycle.applicationReadyObserved', '$.cleanup.ok'],
  );

  const boundedFailuresValue = validStarterAcceptanceReceipt();
  boundedFailuresValue.expectedCheckCount = 100;
  boundedFailuresValue.executedCheckCount = 100;
  boundedFailuresValue.checks = Array.from({ length: 100 }, () => ({}));
  const boundedFailures = await runStarterReceiptFixture({ receipt: boundedFailuresValue });
  assert.ok(boundedFailures.diagnostics[0].details.invalidPathCount > 64);
  assert.equal(boundedFailures.diagnostics[0].details.invalidPaths.length, 64);
  assert.equal(boundedFailures.diagnostics[0].details.invalidPathsTruncated, true);
  cases += 1;
}

{
  const timeoutReceipt = validStarterAcceptanceReceipt();
  const timeout = await runStarterReceiptFixture({
    source: `
const timer = setInterval(() => {}, 1_000);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.stdout.write(${JSON.stringify(`${JSON.stringify(timeoutReceipt)}\n`)});
});
`,
    timeoutMs: 20,
  });
  const outputLimit = await runStarterReceiptFixture({
    source: `process.stdout.write('x'.repeat(${2 * 1024 * 1024 + 1024}));\n`,
  });
  assert.equal(timeout.diagnostics[0].code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_TIMEOUT');
  assert.equal(timeout.diagnostics[0].details.outcome, 'process-failure');
  assert.equal(outputLimit.diagnostics[0].code, 'SNAPBACK_VERIFY_STARTER_ACCEPTANCE_OUTPUT_LIMIT');
  assert.equal(outputLimit.diagnostics[0].details.outcome, 'process-failure');
  assert.equal(Object.hasOwn(timeout.diagnostics[0].details, 'stderr'), false);
  assert.equal(Object.hasOwn(outputLimit.diagnostics[0].details, 'stderr'), false);
  assert.ok(timeout.unsafeDebug.stderr.length <= 16_384);
  assert.ok(outputLimit.unsafeDebug.stderr.length <= 16_384);
  cases += 1;
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-cloudflare-verify-profile-'));
  const acceptanceFile = join(scratch, 'cloudflare-acceptance.mjs');
  const digest = `sha256:${'a'.repeat(64)}`;
  writeFileSync(acceptanceFile, `
const receipt = {
  schemaVersion: 'snapback.cloudflare-acceptance.v1',
  status: 'passed-with-nonclaims',
  expectedCheckCount: 2,
  executedCheckCount: 2,
  checks: [
    { label: 'remote query', status: 'passed' },
    { label: 'provider route', status: 'skipped' },
  ],
  target: { origin: process.env.SNAPBACK_PROOF_URL, platformBuildId: 'build-fixture-1' },
  artifact: { appId: 'app', schemaHash: 'sha256:schema', bundleHash: 'sha256:bundle' },
  dataIdentity: '${digest}',
  seedIdentity: '${digest}',
  diagnostic: null,
};
process.stdout.write('human output\\n' + JSON.stringify(receipt) + '\\n');
`);
  try {
    const paths = [{
      id: 'cloudflare-query',
      kind: 'success',
      targetProfileId: 'cloudflare-do-sqlite-v8',
    }];
    const cloudflare = defineCloudflareVerifyProfile({
      id: 'cloudflare-all-aboard',
      acceptanceFile,
      additionalTestFiles: [thisFile],
      proofUrl: 'https://proof.example.test/',
      adminToken: 'test-secret-token',
      expectedCheckCount: 2,
      paths,
    });
    assert.deepEqual(cloudflare.testFiles, [realpathSync(acceptanceFile), thisFile]);
    const outcome = await cloudflare.run({ artifact: artifact(), identityContext: config().context });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.context.target.kind, 'cloudflare-deployment');
    assert.equal(outcome.context.target.identity, 'https://proof.example.test#build-fixture-1');
    assert.equal(outcome.context.data.identity, digest);
    assert.equal(outcome.context.seed.identity, digest);
    assert.equal(outcome.diagnostics[0].code, 'SNAPBACK_VERIFY_CLOUDFLARE_ACCEPTANCE_NONCLAIM');
    assert.deepEqual(outcome.conformance.map(({ pathId }) => pathId), ['cloudflare-query']);
    cases += 1;

    const missingCredentials = defineCloudflareVerifyProfile({
      id: 'cloudflare-missing-credentials',
      acceptanceFile,
      expectedCheckCount: 2,
    });
    const previousProofUrl = process.env.SNAPBACK_PROOF_URL;
    const previousAdminToken = process.env.SNAPBACK_ADMIN_TOKEN;
    delete process.env.SNAPBACK_PROOF_URL;
    delete process.env.SNAPBACK_ADMIN_TOKEN;
    try {
      const refused = await missingCredentials.run({ artifact: artifact(), identityContext: config().context });
      assert.equal(refused.ok, false);
      assert.equal(refused.diagnostics[0].code, 'SNAPBACK_VERIFY_CLOUDFLARE_CREDENTIALS_MISSING');
      cases += 1;
    } finally {
      if (previousProofUrl === undefined) delete process.env.SNAPBACK_PROOF_URL;
      else process.env.SNAPBACK_PROOF_URL = previousProofUrl;
      if (previousAdminToken === undefined) delete process.env.SNAPBACK_ADMIN_TOKEN;
      else process.env.SNAPBACK_ADMIN_TOKEN = previousAdminToken;
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

for (const [template, expectedPathIds, expectedBaselinePathIds] of [
  [
    'todo-contract',
    ['list-todos', 'create-todo'],
    ['create-todo', 'list-todos'],
  ],
  [
    'react',
    [
      'anonymous-ready',
      'password-signup-recovery',
      'reload-restores-principal',
      'authenticated-entry-refusal',
      'sign-out',
      'list-todos',
      'create-todo',
    ],
    ['create-todo', 'list-todos'],
  ],
  [
    'expo-chat',
    [
      'zero-config-supervised-connect',
      'web-anonymous-ready',
      'password-signup-recovery',
      'reload-clears-volatile-principal',
      'authenticated-entry-refusal',
      'sign-out',
      'native-refusal',
      'membership-dm-group-shape',
      'test-persona-membership-switch',
      'conversation-surface-read',
      'send-message',
      'reply',
      'reaction',
    ],
    ['conversation-surface-read', 'send-message'],
  ],
  [
    'crud-dashboard',
    [
      'relational-project-directory',
      'create-project',
      'update-project-live-detail',
      'delete-project',
    ],
    ['create-project', 'relational-project-directory'],
  ],
  [
    'media-feed',
    [
      'retained-live-feed-pages',
      'session-upload-and-typed-attach',
      'thumbnail-rendition-delivery',
      'display-rendition-delivery',
    ],
    ['retained-live-feed-pages', 'session-upload-and-typed-attach'],
  ],
]) {
  const scratch = mkdtempSync(join(tmpdir(), `snapback-${template}-verify-config-`));
  const scaffold = join(scratch, template);
  const sharedDeclaration = template !== 'todo-contract';
  try {
    mkdirSync(scaffold, { recursive: true });
    cpSync(
      new URL(`./templates/${template}/snapback.verify.config.mjs`, import.meta.url),
      join(scaffold, 'snapback.verify.config.mjs'),
    );
    cpSync(
      new URL(`./templates/${template}/acceptance.mjs`, import.meta.url),
      join(scaffold, 'acceptance.mjs'),
    );
    cpSync(
      new URL(`./templates/${template}/carrier.mjs`, import.meta.url),
      join(scaffold, 'carrier.mjs'),
    );
    if (sharedDeclaration) {
      cpSync(
        new URL(`./templates/${template}/snapback/generated`, import.meta.url),
        join(scaffold, 'snapback', 'generated'),
        { recursive: true },
      );
      mkdirSync(join(scaffold, 'node_modules', '@expo'), { recursive: true });
      for (const packageName of [
        'snapback-acceptance',
        'snapback-cli',
        'snapback-client',
        'snapback-expo',
        'snapback-react',
      ]) {
        symlinkSync(
          resolve(dirname(thisFile), '..', packageName),
          join(scaffold, 'node_modules', '@expo', packageName),
          process.platform === 'win32' ? 'junction' : 'dir',
        );
      }
      symlinkSync(
        resolve(dirname(thisFile), '..', '..', 'node_modules', 'fake-indexeddb'),
        join(scaffold, 'node_modules', 'fake-indexeddb'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    } else {
      mkdirSync(join(scaffold, 'node_modules', '@expo'), { recursive: true });
      symlinkSync(
        dirname(thisFile),
        join(scaffold, 'node_modules', '@expo', 'snapback-cli'),
        process.platform === 'win32' ? 'junction' : 'dir',
      );
    }
    const templateConfig = await loadVerifyConfig(join(scaffold, 'snapback.verify.config.mjs'));
    assert.equal(templateConfig.profiles.length, 1);
    assert.deepEqual(
      templateConfig.profiles[0].paths.map(({ id }) => id),
      expectedPathIds,
    );
    assert.deepEqual(
      templateConfig.profiles[0].coverageCapability.baselinePathIds,
      expectedBaselinePathIds,
    );
    assert.equal(templateConfig.profiles[0].testFiles.length, sharedDeclaration ? 4 : 3);
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /acceptance\.mjs$/u.test(file)));
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /carrier\.mjs$/u.test(file)));
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /carrier-kit\.mjs$/u.test(file)));
    if (sharedDeclaration) {
      assert.ok(templateConfig.profiles[0].testFiles.some(
        (file) => /snapback-acceptance\/index\.mjs$/u.test(file),
      ));
    }
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const receipt = await runVerify(config(), passOptions());
  assert.equal(receipt.schemaVersion, VERIFY_RECEIPT_SCHEMA_VERSION);
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.stages.map(({ status }) => status), Array(5).fill('passed'));
  assert.equal(receipt.context.target.identity, 'inputs-1');
  assert.equal(receipt.context.data.identity, 'sha256:data-1');
  assert.equal(
    receipt.stages[2].evidence.admissionMode,
    'generated-artifact-local-admission',
  );
  assert.equal(
    receipt.stages[3].evidence.resolutionMode,
    'generated-capability-manifest',
  );
  assert.equal(
    receipt.nonclaims.includes('generated-artifact-local-admission does not claim a live target admitted the same bytes'),
    true,
  );
  assert.equal(receipt.context.seed.identity, 'sha256:seed');
  assert.match(receipt.profileSet.testBytes.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.profileSet.testBytes.files[0].bytes, readFileSync(thisFile).byteLength);
  assert.equal(receipt.recommendedNext, undefined);
  validateVerifyReceipt(receipt);
  assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));
  cases += 1;
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-verify-convention-'));
  const conventional = join(scratch, VERIFY_CONFIG_CONVENTION);
  writeFileSync(conventional, `export default { schemaVersion: 'snapback.verify-config.v1', profiles: [] };\n`);
  try {
    assert.equal(discoverVerifyConfig(scratch), conventional);
    assert.equal(discoverVerifyConfig(join(scratch, 'missing')), null);
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const packageRoot = dirname(thisFile);
  const repositoryRoot = resolve(packageRoot, '../..');
  const runtimeBinary = process.env.SNAPBACK_RUNTIME_BINARY
    ?? join(repositoryRoot, 'target', 'debug', 'snapback');
  assert.ok(
    existsSync(runtimeBinary),
    `native snapback binary missing at ${runtimeBinary}; run cargo build --bin snapback or set SNAPBACK_RUNTIME_BINARY`,
  );
  const { managedAdminToken, readReadyDescriptor, runDev, scaffoldApp } = await import('./index.mjs');
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-verify-live-sessions-target-')));
  const projectRoot = join(scratch, 'react-sessions');
  const backend = join(projectRoot, 'snapback');
  const readyFile = join(projectRoot, '.snapback', 'verify.ready.json');
  const database = join(projectRoot, '.snapback', 'verify.sqlite3');
  let dev = null;
  try {
    assert.equal(scaffoldApp(projectRoot, { template: 'react' }).ok, true);
    const schemaPath = join(backend, 'schema.mjs');
    const devSchema = readFileSync(schemaPath, 'utf8');
    // The react template now scaffolds in sessions mode already
    // (80ff4864f); rewrite only a template that still scaffolds without it.
    if (!devSchema.includes("auth: { mode: 'sessions' }")) {
      const sessionsSchema = devSchema.replace(
        /\n\}\);\s*$/u,
        "\n}, { auth: { mode: 'sessions' } });\n",
      );
      assert.notEqual(sessionsSchema, devSchema, 'fixture schema must switch to sessions mode');
      writeFileSync(schemaPath, sessionsSchema);
    }

    dev = await runDev({
      backendDirectory: backend,
      projectRoot,
      readyFile,
      database,
      runtimeBinary,
      watch: false,
      serverStdio: ['ignore', 'ignore', 'ignore'],
    });
    assert.equal(dev.ok, true, JSON.stringify(dev));
    assert.equal(dev.managed, true);

    const sessionResponse = await fetch(`${dev.serverUrl}/auth/session`, {
      headers: { 'x-snapback-auth-client-protocol': '1' },
    });
    assert.equal(sessionResponse.ok, true);
    const session = await sessionResponse.json();
    assert.equal(session.activeMode, 'sessions', 'the live target must not be a dev-auth fixture');

    const descriptor = readReadyDescriptor(readyFile);
    const adminToken = managedAdminToken(descriptor, database);
    const liveConfig = Object.freeze({
      ...defaultVerifyConfig({ backendDirectory: backend }),
      servedTarget: Object.freeze({
        url: descriptor.serverUrl,
        adminTokenEnv: 'SNAPBACK_TEST_ADMIN_TOKEN',
        authorityMode: 'admin-token',
        timeoutMs: 10_000,
      }),
    });
    const fresh = await probeArtifactFreshness(liveConfig);
    assert.equal(fresh.ok, true, JSON.stringify(fresh.diagnostics));
    const live = await probeServedTarget(fresh, liveConfig, {
      env: { SNAPBACK_TEST_ADMIN_TOKEN: adminToken },
    });
    assert.equal(live.ok, false, JSON.stringify(live));
    assert.equal(live.claimed, false);
    assert.equal(
      live.diagnostics[0].code,
      'SNAPBACK_VERIFY_SERVED_TARGET_AUTHORITY_PROFILE_UNSUPPORTED',
    );
    assert.equal(
      live.diagnostics[0].details.limitation,
      'sessions-secret-read-lease-not-supported',
    );
    assert.deepEqual(
      live.diagnostics[0].details.codes,
      ['SNAPBACK_ADMIN_SECRET_READ_REQUIRED'],
      'the singular non-2xx ErrorResponse diagnostic must drive classification',
    );
    cases += 1;
  } finally {
    await dev?.close?.();
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'snapback-verify-backend-resolution-')));
  const configDirectory = join(scratch, 'config');
  mkdirSync(configDirectory, { recursive: true });
  const configPath = join(configDirectory, 'verify.mjs');
  writeFileSync(configPath, `export default { schemaVersion: 'snapback.verify-config.v1', backendDirectory: 'authored-backend', profiles: [] };\n`);
  const previousCwd = process.cwd();
  try {
    process.chdir(scratch);
    const authored = await loadVerifyConfig(configPath);
    assert.equal(authored.backendDirectory, join(configDirectory, 'authored-backend'));
    const positional = await loadVerifyConfig(configPath, { backendDirectory: 'positional-backend' });
    assert.equal(positional.backendDirectory, join(scratch, 'positional-backend'));
    cases += 1;
  } finally {
    process.chdir(previousCwd);
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-verify-sessions-admission-'));
  const backend = join(scratch, 'app', 'snapback');
  mkdirSync(dirname(backend), { recursive: true });
  cpSync(new URL('./fixtures/push-seam/app/snapback', import.meta.url), backend, {
    recursive: true,
  });
  try {
    const generated = await generate(backend);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const fresh = await probeArtifactFreshness(defaultVerifyConfig({ backendDirectory: backend }));
    assert.equal(fresh.ok, true, JSON.stringify(fresh.diagnostics));
    const admission = probeAdmission(fresh);
    assert.equal(admission.ok, true, JSON.stringify(admission.diagnostics));
    assert.equal(fresh.identity.schemaVersion, 'snapback.v1');
    assert.equal(fresh.manifests.schema.schemaVersion, 'snapback.v1');
    assert.equal(fresh.manifests.functions.schemaVersion, 'snapback.v1');
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const failureMatrix = [
  ['artifact-freshness', {
    artifactProbe: async () => ({ ok: false, diagnostics: [{ code: 'stale', severity: 'error', subsystem: 'verify', message: 'stale' }] }),
  }, 'SNAPBACK_VERIFY_REGENERATE_ARTIFACTS'],
  ['runtime-readiness', {
    runtimeProbe: async () => ({ ok: false, diagnostics: [{ code: 'runtime', severity: 'error', subsystem: 'verify', message: 'not ready' }] }),
  }, 'SNAPBACK_VERIFY_QUALIFY_RUNTIME'],
  ['admission-and-conformance', {
    admissionProbe: async () => ({ ok: false, diagnostics: [{ code: 'admission', severity: 'error', subsystem: 'verify', message: 'refused' }] }),
  }, 'SNAPBACK_VERIFY_FIX_ADMISSION_OR_COVERAGE'],
  ['capability-resolution', {
    capabilityProbe: async () => ({
      ok: false, required: ['x'], supported: [], missing: ['x'],
      diagnostics: [{ code: 'capability', severity: 'error', subsystem: 'verify', message: 'gap' }],
    }),
  }, 'SNAPBACK_VERIFY_SELECT_CAPABLE_TARGET'],
  ['acceptance-profiles', {}, 'SNAPBACK_VERIFY_FIX_ACCEPTANCE'],
];

for (const [stageId, overrides, nextCode] of failureMatrix) {
  const selectedConfig = stageId === 'acceptance-profiles'
    ? config([profile(async () => ({
      ok: false,
      diagnostics: [{ code: 'acceptance', severity: 'error', subsystem: 'verify', message: 'failed' }],
      conformance: [{ pathId: path.id, status: 'observed', report: emptyReport() }],
    }))])
    : config();
  const receipt = await runVerify(selectedConfig, passOptions(overrides));
  assert.equal(receipt.ok, false, stageId);
  assert.equal(receipt.stages.find(({ id }) => id === stageId).status, 'failed', stageId);
  assert.equal(receipt.next.length, 1, stageId);
  assert.equal(receipt.recommendedNext.code, nextCode, stageId);
  assert.equal(Object.hasOwn(receipt.recommendedNext, 'instruction'), true, stageId);
  if (['admission-and-conformance', 'capability-resolution', 'acceptance-profiles'].includes(stageId)) {
    assert.equal(receipt.recommendedNext.command, null, stageId);
  } else {
    assert.match(receipt.recommendedNext.command, /^snapback /u, stageId);
  }
  cases += 1;
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-verify-failed-starter-profile-'));
  const acceptanceFile = join(scratch, 'acceptance.mjs');
  const failedReceiptValue = validStarterAcceptanceReceipt();
  failedReceiptValue.status = 'failed';
  failedReceiptValue.checks[1].status = 'failed';
  failedReceiptValue.diagnostic = {
    code: 'SNAPBACK_STARTER_CHECK_FAILED',
    message: 'm'.repeat(10_000),
  };
  writeFileSync(acceptanceFile, `
process.stderr.write('x'.repeat(20_000));
process.stdout.write(${JSON.stringify(`${JSON.stringify(failedReceiptValue)}\n`)});
process.exitCode = 1;
`);
  try {
    const starter = defineStarterVerifyProfile({
      id: 'failed-starter-profile',
      acceptanceFile,
      paths: starterReceiptPaths,
    });
    const receipt = await runVerify(config([starter]), passOptions({
      artifactProbe: async () => starterArtifact(),
    }));
    const profileResult = receipt.acceptanceProfiles[0];
    const conformanceStage = receipt.stages.find(({ id }) => id === 'admission-and-conformance');
    assert.equal(profileResult.status, 'failed');
    assert.equal(Object.isFrozen(profileResult), true);
    assert.equal(profileResult.unsafeDebug.stderr.length, 16_384);
    assert.equal(profileResult.unsafeDebug.stderrTruncated, true);
    assert.equal(profileResult.unsafeDebug.receiptDiagnosticMessage.length, 4_096);
    assert.equal(profileResult.unsafeDebug.receiptDiagnosticMessageTruncated, true);
    assert.equal(Object.hasOwn(profileResult.diagnostics[0].details, 'unsafeDebug'), false);
    assert.equal(Object.hasOwn(profileResult.diagnostics[0].details, 'stderr'), false);
    assert.equal(Object.hasOwn(profileResult.diagnostics[0].details, 'receiptDiagnosticMessage'), false);
    assert.equal(conformanceStage.status, 'passed');
    assert.equal(conformanceStage.evidence.conformance.status, 'partial');
    assert.ok(conformanceStage.evidence.conformance.pathEvidence.every(({ status, report }) => (
      status === 'unsupported' && report !== null
    )));
    assert.equal(receipt.next.length, 1);
    assert.equal(receipt.recommendedNext.code, 'SNAPBACK_VERIFY_FIX_ACCEPTANCE');
    assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));
    cases += 1;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

{
  const receipt = await runVerify(config(), passOptions({
    artifactProbe: async () => { throw Object.assign(new Error('missing artifact'), { code: 'ENOENT' }); },
  }));
  assert.equal(receipt.stages[0].diagnostics[0].code, 'SNAPBACK_VERIFY_PROBE_FAILED');
  assert.equal(receipt.stages[0].diagnostics[0].details.causeCode, 'ENOENT');
  cases += 1;
}

{
  const receipt = await runVerify(config([profile(() => new Promise(() => {}))]), passOptions({
    profileTimeoutMs: 5,
  }));
  assert.equal(receipt.acceptanceProfiles[0].diagnostics[0].code, 'SNAPBACK_VERIFY_PROFILE_TIMEOUT');
  assert.equal(receipt.stages[4].status, 'failed');
  cases += 1;
}

{
  let localRuntimeProbeCalls = 0;
  const remoteArtifact = artifact({
    manifests: {
      ...artifact().manifests,
      capability: {
        ...artifact().manifests.capability,
        targetProfileId: 'cloudflare-do-sqlite-v8',
      },
    },
  });
  const receipt = await runVerify(config([]), passOptions({
    artifactProbe: async () => remoteArtifact,
    runtimeProbe: async () => { localRuntimeProbeCalls += 1; return { ok: false, diagnostics: [] }; },
    servedTargetProbe: async () => ({
      ok: true,
      claimed: false,
      evidence: { disposition: 'not-configured', claim: false },
      diagnostics: [],
    }),
  }));
  assert.equal(localRuntimeProbeCalls, 0);
  assert.equal(receipt.status, 'passed-without-acceptance');
  assert.equal(receipt.stages[1].evidence.disposition, 'not-applicable-non-local-target');
  assert.equal(receipt.stages[1].evidence.claim, false);
  assert.ok(receipt.nonclaims.some((entry) => entry.includes('non-local target runtime')));
  cases += 1;
}

{
  const malformed = profile(async () => ({
    ok: true,
    conformance: [
      { pathId: path.id, status: 'observed', report: emptyReport() },
      { pathId: path.id, status: 'observed', report: emptyReport() },
    ],
  }));
  const receipt = await runVerify(config([malformed]), passOptions());
  const conformanceStage = receipt.stages.find(({ id }) => id === 'admission-and-conformance');
  assert.equal(receipt.ok, false);
  assert.equal(conformanceStage.status, 'failed');
  assert.equal(conformanceStage.evidence.conformance.status, 'failed');
  assert.equal(
    conformanceStage.diagnostics[0].code,
    'SNAPBACK_VERIFY_CONFORMANCE_INVALID',
  );
  cases += 1;
}

{
  const receipt = await runVerify(config(), passOptions({
    runtimeProbe: async () => ({ ok: false, diagnostics: [] }),
    admissionProbe: async () => ({ ok: false, diagnostics: [] }),
  }));
  assert.equal(receipt.next.length, 1);
  assert.equal(Object.hasOwn(receipt, 'recommendedNext'), true);
  assert.deepEqual(receipt.stages.slice(2).map(({ status }) => status), ['blocked', 'blocked', 'blocked']);
  cases += 1;
}

{
  const under = profile(async () => ({
    ok: true,
    conformance: [{
      pathId: path.id,
      status: 'observed',
      report: emptyReport({ missingReads: ['secret'], missingWrites: ['audit'] }),
    }],
  }));
  const receipt = await runVerify(config([under]), passOptions());
  assert.equal(receipt.stages[2].status, 'failed');
  assert.deepEqual(receipt.stages[2].evidence.conformance.underDeclarations[0].missingReads, ['secret']);
  assert.deepEqual(receipt.stages[2].evidence.conformance.underDeclarations[0].missingWrites, ['audit']);
  cases += 1;
}

{
  const receipt = await runVerify(config([profile(async () => ({
    ok: false,
    diagnostics: [{ code: 'acceptance', severity: 'error', subsystem: 'verify', message: 'failed' }],
    conformance: [{
      pathId: path.id,
      status: 'observed',
      report: emptyReport({ missingReads: ['undeclared'] }),
    }],
  }))]), passOptions());
  assert.equal(receipt.next.length, 2);
  assert.equal(Object.hasOwn(receipt, 'recommendedNext'), false);
  cases += 1;
}

{
  const paths = [path, { ...path, id: 'query-failure', kind: 'failure' }];
  const conditional = {
    ...profile(),
    paths,
    run: async () => ({
      ok: true,
      conformance: [
        { pathId: 'query-success', status: 'observed', report: emptyReport({ extraReads: ['conditional', 'dead'] }) },
        { pathId: 'query-failure', status: 'observed', report: emptyReport({ extraReads: ['dead'] }) },
      ],
    }),
  };
  const receipt = await runVerify(config([conditional]), passOptions());
  assert.equal(receipt.ok, true);
  assert.deepEqual(receipt.stages[2].evidence.conformance.overDeclarations, [{
    functionId: 'app:list',
    completeObservedPaths: { reads: 2, writes: 2 },
    extraReads: ['dead'],
    extraWrites: [],
    severity: 'warning',
  }]);
  cases += 1;
}

{
  const incomplete = profile(async () => ({
    ok: true,
    conformance: [{
      pathId: path.id,
      status: 'observed',
      report: emptyReport({ readProvenance: 'unsupported', writeProvenance: 'unsupported' }),
    }],
  }));
  const receipt = await runVerify(config([incomplete]), passOptions());
  assert.equal(receipt.stages[2].status, 'passed');
  assert.equal(receipt.stages[2].evidence.conformance.status, 'partial');
  assert.equal(receipt.stages[2].evidence.conformance.pathEvidence[0].status, 'unsupported');
  cases += 1;
}

{
  const identityBoundProfile = {
    ...profile(),
    id: 'starter-acceptance',
    coverageCapability: {
      claim: 'identity-bound-path-observation',
      baselinePathIds: [path.id],
      readProvenance: 'unsupported',
      writeProvenance: 'unsupported',
    },
  };
  const legacyProfile = { ...profile(), id: 'repository-demo:legacy-demo' };
  const unsupported = emptyReport({
    readProvenance: 'unsupported',
    writeProvenance: 'unsupported',
  });
  const result = aggregateConformance(
    [identityBoundProfile, legacyProfile],
    [identityBoundProfile, legacyProfile].map(({ id }) => ({
      profileId: id,
      conformance: [{ pathId: path.id, status: 'observed', report: unsupported }],
    })),
  );
  assert.equal(result.status, 'partial');
  assert.equal(
    result.limitationReason,
    'identity-bound path-observation profiles ["starter-acceptance"] do not supply complete read/write operation provenance; profiles ["repository-demo:legacy-demo"] remain partial until they emit complete D1 read/write operation provenance',
  );
  cases += 1;
}

{
  const receipt = await runVerify(config([]), passOptions());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.status, 'passed-without-acceptance');
  assert.equal(receipt.stages[2].evidence.conformance.status, 'not-claimed');
  assert.equal(receipt.stages[2].evidence.conformance.complete, false);
  assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));
  cases += 1;
}

{
  const registeredProfileWithoutPaths = { ...profile(), paths: [] };
  const result = aggregateConformance([registeredProfileWithoutPaths], [{
    profileId: registeredProfileWithoutPaths.id,
    conformance: [],
  }]);
  assert.equal(result.status, 'not-claimed');
  assert.equal(result.scope, 'registered-or-repository-adapted-paths');
  assert.equal(result.expectedPaths, 0);
  assert.equal(result.complete, false);
  cases += 1;
}

{
  const registeredProfileWithoutPaths = { ...profile(), paths: [] };
  const receipt = await runVerify(config([registeredProfileWithoutPaths]), passOptions({
    artifactProbe: async () => ({ ok: false, diagnostics: [] }),
  }));
  const conformanceStage = receipt.stages[2];
  assert.equal(conformanceStage.status, 'blocked');
  assert.equal(conformanceStage.evidence.conformance.status, 'not-claimed');
  assert.equal(conformanceStage.evidence.conformance.expectedPaths, 0);
  assert.deepEqual(conformanceStage.evidence.conformance.pathEvidence, []);
  assert.equal(validateReceiptSchema(receipt), true, JSON.stringify(validateReceiptSchema.errors));
  cases += 1;
}

{
  const incompleteIdentityConfig = Object.freeze({
    ...defaultVerifyConfig({ backendDirectory: '.' }),
    profiles: Object.freeze([profile()]),
  });
  const receipt = await runVerify(incompleteIdentityConfig, passOptions());
  assert.equal(receipt.stages[4].status, 'failed');
  assert.equal(receipt.acceptanceProfiles[0].diagnostics.at(-1).code, 'SNAPBACK_VERIFY_PROFILE_IDENTITY_INCOMPLETE');
  cases += 1;
}

{
  const result = aggregateConformance([profile()], [{
    profileId: 'local-acceptance',
    conformance: [{ pathId: path.id, status: 'observed', report: emptyReport({
      missingReads: ['declared-write'],
      missingWrites: ['declared-read'],
      readProvenance: 'complete',
      writeProvenance: 'complete',
    }) }],
  }]);
  assert.deepEqual(result.pathEvidence[0].report.missingReads, ['declared-write']);
  assert.deepEqual(result.pathEvidence[0].report.missingWrites, ['declared-read']);
  assert.equal(result.pathEvidence[0].report.readProvenance, 'complete');
  assert.equal(result.pathEvidence[0].report.writeProvenance, 'complete');
  cases += 1;
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-verify-artifact-'));
  const backend = join(scratch, 'app', 'snapback');
  mkdirSync(dirname(backend), { recursive: true });
  cpSync(new URL('./fixtures/comparator/app/snapback', import.meta.url), backend, {
    recursive: true,
  });
  try {
    const generated = await generate(backend);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const fresh = await probeArtifactFreshness(defaultVerifyConfig({ backendDirectory: backend }));
    assert.equal(fresh.ok, true, JSON.stringify(fresh.diagnostics));
    appendFileSync(join(backend, 'functions.mjs'), '\n// verify freshness witness\n');
    const stale = await probeArtifactFreshness(defaultVerifyConfig({ backendDirectory: backend }));
    assert.equal(stale.ok, false);
    assert.equal(stale.diagnostics[0].code, 'SNAPBACK_VERIFY_ARTIFACT_STALE');

    const schemaPath = join(backend, 'schema.mjs');
    const schema = readFileSync(schemaPath, 'utf8');
    const mismatchedSchema = schema.replace(
      '    rejectionRows: valueTable(),',
      '    rejectionRows: valueTable(),\n    unapprovedRows: valueTable(),',
    );
    assert.notEqual(mismatchedSchema, schema, 'governance mismatch fixture must add one public table');
    writeFileSync(schemaPath, mismatchedSchema);
    const governanceMismatch = await probeArtifactFreshness(
      defaultVerifyConfig({ backendDirectory: backend }),
    );
    assert.equal(governanceMismatch.ok, false);
    assert.ok(
      governanceMismatch.diagnostics.some(({ code }) => (
        code === 'SNAPBACK_TABLE_VISIBILITY_POLICY_RATCHET_GROWTH'
      )),
      JSON.stringify(governanceMismatch.diagnostics),
    );
    cases += 3;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`verify.test.mjs: ${cases} D2 cases passed`);
