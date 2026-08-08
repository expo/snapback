import { strict as assert } from 'node:assert';
import {
  appendFileSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generate } from '@expo/snapback-codegen';

import {
  VERIFY_RECEIPT_SCHEMA_VERSION,
  aggregateConformance,
  defaultVerifyConfig,
  defineStarterVerifyProfile,
  loadVerifyConfig,
  probeAdmission,
  probeArtifactFreshness,
  runVerify,
  validateVerifyReceipt,
} from './verify.mjs';

const thisFile = fileURLToPath(import.meta.url);
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
  now: (() => { let now = 100; return () => ++now; })(),
  ...overrides,
});

let cases = 0;

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
  cases += 1;
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-starter-verify-profile-'));
  const acceptanceFile = join(scratch, 'acceptance.mjs');
  writeFileSync(acceptanceFile, `process.stdout.write(JSON.stringify({
  schemaVersion: 'snapback.starter-acceptance.v1',
  status: 'passed',
  expectedCheckCount: 2,
  executedCheckCount: 2,
  checks: [{ status: 'passed' }, { status: 'passed' }],
  identity: {
    artifact: { appId: 'starter', bundleHash: 'bundle' },
    loaded: { appId: 'starter', bundleHash: 'bundle' },
  },
  lifecycle: {
    owned: true,
    readyDescriptorObserved: true,
    generatedAndLoadedObserved: true,
  },
  operations: { queryFunctionId: 'app:list', mutationFunctionId: 'app:create' },
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
      { id: 'starter-query', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
      { id: 'starter-mutation', kind: 'success', targetProfileId: 'local-dev-sqlite-ibex' },
    ];
    const starter = defineStarterVerifyProfile({
      id: 'starter-acceptance',
      acceptanceFile,
      additionalTestFiles: [thisFile],
      paths,
    });
    assert.deepEqual(starter.testFiles, [realpathSync(acceptanceFile), thisFile]);
    const identityContext = config().context;
    const outcome = await starter.run({ identityContext });
    assert.equal(outcome.ok, true);
    assert.equal(outcome.context, identityContext);
    assert.deepEqual(outcome.conformance.map(({ pathId }) => pathId), paths.map(({ id }) => id));
    assert.ok(outcome.conformance.every(({ report }) => (
      report.readProvenance === 'unsupported' && report.writeProvenance === 'unsupported'
    )));
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

for (const [template, pathCount] of [
  ['todo-contract', 2],
  ['react', 2],
  ['expo-chat', 6],
  ['crud-dashboard', 4],
  ['media-feed', 4],
]) {
  const scratch = mkdtempSync(join(tmpdir(), `snapback-${template}-verify-config-`));
  const scaffold = join(scratch, template);
  try {
    mkdirSync(join(scaffold, 'node_modules', '@expo'), { recursive: true });
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
    symlinkSync(
      dirname(thisFile),
      join(scaffold, 'node_modules', '@expo', 'snapback-cli'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const templateConfig = await loadVerifyConfig(join(scaffold, 'snapback.verify.config.mjs'));
    assert.equal(templateConfig.profiles.length, 1);
    assert.equal(templateConfig.profiles[0].paths.length, pathCount);
    assert.equal(templateConfig.profiles[0].testFiles.length, 3);
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /acceptance\.mjs$/u.test(file)));
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /carrier\.mjs$/u.test(file)));
    assert.ok(templateConfig.profiles[0].testFiles.some((file) => /carrier-kit\.mjs$/u.test(file)));
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
  assert.equal(receipt.context.seed.identity, 'sha256:seed');
  assert.match(receipt.profileSet.testBytes.sha256, /^sha256:[0-9a-f]{64}$/);
  assert.equal(receipt.profileSet.testBytes.files[0].bytes, readFileSync(thisFile).byteLength);
  assert.equal(receipt.recommendedNext, undefined);
  validateVerifyReceipt(receipt);
  cases += 1;
}

{
  const scratch = mkdtempSync(join(tmpdir(), 'snapback-verify-sessions-admission-'));
  const backend = join(scratch, 'app', 'snapback');
  mkdirSync(dirname(backend), { recursive: true });
  cpSync(new URL('./fixtures/push-seam/app/snapback', import.meta.url), backend, {
    recursive: true,
    filter(source) { return !source.split('/').includes('generated'); },
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
  const receipt = await runVerify(config([]), passOptions());
  assert.equal(receipt.ok, true);
  assert.equal(receipt.stages[2].evidence.conformance.status, 'not-claimed');
  assert.equal(receipt.stages[2].evidence.conformance.complete, false);
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
    filter(source) { return !source.split('/').includes('generated'); },
  });
  try {
    const generated = await generate(backend);
    assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
    const fresh = await probeArtifactFreshness(defaultVerifyConfig({ backendDirectory: backend }));
    assert.equal(fresh.ok, true);
    assert.equal(fresh.identity.inputsHash, generated.inputsHash);
    appendFileSync(join(backend, 'functions.mjs'), '\n// verify freshness witness\n');
    const stale = await probeArtifactFreshness(defaultVerifyConfig({ backendDirectory: backend }));
    assert.equal(stale.ok, false);
    assert.equal(stale.diagnostics[0].code, 'SNAPBACK_VERIFY_ARTIFACT_STALE');
    cases += 2;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

console.log(`verify.test.mjs: ${cases} D2 cases passed`);
