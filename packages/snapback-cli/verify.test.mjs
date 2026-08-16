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
  checks: [{ status: 'passed' }, { status: 'passed' }],
  identity: {
    artifact: { appId: 'starter', bundleHash: 'bundle' },
    loaded: { appId: 'starter', bundleHash: 'bundle' },
  },
  lifecycle: {
    owned: true,
    applicationReadyObserved: true,
    waitLevel: 'application',
    firstQueryRetries: 0,
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

for (const [template, pathCount] of [
  ['todo-contract', 2],
  ['react', 2],
  ['expo-chat', 7],
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
    const sessionsSchema = devSchema.replace(
      /\n\}\);\s*$/u,
      "\n}, { auth: { mode: 'sessions' } });\n",
    );
    assert.notEqual(sessionsSchema, devSchema, 'fixture schema must switch to sessions mode');
    writeFileSync(schemaPath, sessionsSchema);

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
  assert.equal(Object.hasOwn(receipt.recommendedNext, 'instruction'), true, stageId);
  if (['admission-and-conformance', 'capability-resolution', 'acceptance-profiles'].includes(stageId)) {
    assert.equal(receipt.recommendedNext.command, null, stageId);
  } else {
    assert.match(receipt.recommendedNext.command, /^snapback /u, stageId);
  }
  cases += 1;
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
