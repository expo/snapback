import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate, generateInProcess } from './index.mjs';
import { createCodegenSummary } from './codegen-summary.mjs';
import {
  CUSTODY,
  artifactConsumer,
  codegenCacheGraphRoot,
  logicalArtifactKind,
  resolveGeneratedArtifact,
  validateReviewManifest,
  verifyGeneratedGraph,
} from './review-surface.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const project = mkdtempSync(join(tmpdir(), 'snapback-review-surface-'));
const canonicalProject = realpathSync.native(project);
const backend = join(project, 'snapback');
mkdirSync(backend);

const schemaSource = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  items: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`;
const functionsSource = `
import { defineJsQuery } from '${defineUrl}';
export const unknownResult = defineJsQuery({
  args: {},
  source: 'handler.mjs',
  exportName: 'unknownResult',
  reads: ['items'],
});
`;
writeFileSync(join(project, 'demo.snapback.json'), JSON.stringify({ id: 'review-surface' }, null, 2));
const policySource = JSON.stringify({
  schemaVersion: 'snapback.codegen-policy.v1',
  committedProjections: ['api.d.ts', 'app.d.ts'],
}, null, 2);
writeFileSync(join(backend, 'codegen.policy.json'), policySource);
writeFileSync(join(backend, 'schema.mjs'), schemaSource);
writeFileSync(join(backend, 'functions.mjs'), functionsSource);
writeFileSync(
  join(backend, 'handler.mjs'),
  'globalThis.__snapbackHandlers = { async unknownResult() { return []; } };\n',
);

const fieldDegradation = createCodegenSummary({
  appId: 'summary-fixture',
  inputsHash: 'fixture-input',
  tables: { items: {} },
  functions: [{ name: 'listItems', kind: 'Query', declaredReads: ['items'] }],
  ephemeralCollections: [],
  fileRecords: [],
  diagnostics: [{
    code: 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED',
    severity: 'warning',
    path: 'queries.listItems.result.row.payload',
  }],
  schemaFieldSpans: { 'items.payload': { path: 'schema.mjs', line: 7, column: 5 } },
});
assert.deepEqual(fieldDegradation.degradedResults[0].source, {
  path: 'schema.mjs',
  line: 7,
  column: 5,
});
assert.match(fieldDegradation.degradedResults[0].remediation, /unknown validator for `payload`/);

const operationDegradation = createCodegenSummary({
  appId: 'summary-fixture',
  inputsHash: 'fixture-input',
  tables: { items: {} },
  functions: [{
    name: 'createItem',
    kind: 'Mutation',
    declaredReads: [],
    declaredWrites: ['items'],
  }],
  ephemeralCollections: [],
  fileRecords: [],
  diagnostics: [{
    code: 'SNAPBACK_HANDLER_RESULT_CONTRACT_DEGRADED',
    severity: 'info',
    function: 'createItem',
    details: { function: 'createItem' },
  }],
  sourceSpans: { createItem: { path: 'functions.mjs', line: 9, column: 14 } },
});
assert.equal(operationDegradation.counts.degradedResults, 1);
assert.deepEqual(operationDegradation.degradedResults[0].source, {
  path: 'functions.mjs',
  line: 9,
  column: 14,
});
assert.match(
  operationDegradation.degradedResults[0].remediation,
  /results\.document.*results\.value/u,
);

try {
  const first = await generate(backend);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  assert.equal(first.artifactIndex.manifestVersion, 2);
  assert.equal(first.summary.counts.tables, 1);
  assert.deepEqual(first.summary.counts.operations, {
    total: 1,
    query: 1,
    liveQuery: 0,
    mutation: 0,
    action: 0,
    live: 0,
  });
  // Explicit table visibility leaves only the deliberately degraded-result warning.
  assert.equal(
    first.summary.counts.warnings,
    1,
    JSON.stringify(first.diagnostics, null, 2),
  );
  assert.equal(first.summary.counts.degradedResults, 1);
  assert.deepEqual(first.summary.degradedResults[0].source, {
    path: 'functions.mjs',
    line: 3,
    column: 14,
  });
  assert.equal(first.summary.degradedResults[0].output.path, 'generated/api.d.ts');
  assert.match(first.summary.degradedResults[0].remediation, /results\.documents.*results\.records/u);
  assert.equal(
    first.artifactIndex.files.find(({ path }) => path === 'api.d.ts').custody,
    CUSTODY.consumerCommitted,
  );
  const apiModuleDeclaration = first.artifactIndex.files.find(
    ({ path }) => path === 'api.d.mts',
  );
  assert.equal(apiModuleDeclaration.logicalKind, 'typed-api');
  assert.equal(apiModuleDeclaration.consumer, 'client-bundler');
  assert.equal(apiModuleDeclaration.custody, CUSTODY.consumerCommitted);
  const appModuleDeclaration = first.artifactIndex.files.find(
    ({ path }) => path === 'app.d.mts',
  );
  assert.equal(appModuleDeclaration.logicalKind, 'typed-app-descriptor');
  assert.equal(appModuleDeclaration.consumer, 'client-bundler');
  assert.equal(appModuleDeclaration.custody, CUSTODY.consumerCommitted);
  const handlerProfileRecord = first.artifactIndex.files.find(
    ({ path }) => path === 'handler-runtime-profile.v1.json',
  );
  assert.equal(handlerProfileRecord.logicalKind, 'handler-runtime-profile');
  assert.equal(handlerProfileRecord.consumer, 'developer-tooling');
  const clientLifecycleRecord = first.artifactIndex.files.find(
    ({ path }) => path === 'client-lifecycle.v1.json',
  );
  assert.equal(clientLifecycleRecord.logicalKind, 'client-lifecycle');
  assert.equal(clientLifecycleRecord.consumer, 'developer-tooling');
  assert.equal(clientLifecycleRecord.custody, CUSTODY.regenerableCache);
  assert.equal(handlerProfileRecord.custody, CUSTODY.regenerableCache);
  assert(first.artifactIndex.files.every(({ sha256, logicalKind, consumer, regeneration }) => (
    /^sha256:[0-9a-f]{64}$/u.test(sha256)
    && logicalKind.length > 0
    && consumer.length > 0
    && regeneration.rule === 'complete-inputs-hash'
  )));
  const digest = '0'.repeat(64);
  assert.equal(logicalArtifactKind(`app.descriptor.${digest}.json`), 'app-descriptor');
  assert.equal(artifactConsumer(`app.descriptor.${digest}.json`), 'client-bundler');
  assert.equal(logicalArtifactKind(`app.binding.${digest}.mjs`), 'typed-app-descriptor');
  assert.equal(artifactConsumer(`app.binding.${digest}.mjs`), 'client-bundler');
  assert.equal(logicalArtifactKind(`app.binding.${digest.slice(1)}.mjs`), 'generated-projection');
  const traversalManifest = structuredClone(first.artifactIndex);
  traversalManifest.inputsHash = '..';
  traversalManifest.cache.key = '..';
  traversalManifest.summary.inputsHash = '..';
  assert.match(validateReviewManifest(traversalManifest).join('; '), /canonical content identity/);
  assert.throws(
    () => codegenCacheGraphRoot(backend, '..'),
    ({ code }) => code === 'SNAPBACK_CODEGEN_INPUTS_HASH_INVALID',
  );
  assert.equal(
    existsSync(join(project, '.snapback', 'artifacts.json')),
    false,
    'invalid inputsHash must never escape the codegen-cache directory',
  );

  const reviewBytes = readFileSync(join(first.outDir, 'artifacts.json'));
  const summaryBytes = Buffer.from(JSON.stringify(first.summary));
  const second = await generate(backend);
  assert.equal(second.ok, true);
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(reviewBytes), 'identical review manifests are byte-identical');
  assert(Buffer.from(JSON.stringify(second.summary)).equals(summaryBytes), 'identical summaries are byte-identical');

  const presentUndefinedOutputRoot = await generate(backend, { outputRoot: undefined });
  assert.equal(
    presentUndefinedOutputRoot.ok,
    true,
    JSON.stringify(presentUndefinedOutputRoot.diagnostics),
  );
  assert.equal(
    presentUndefinedOutputRoot.outDir,
    second.outDir,
    'a present undefined outputRoot is the same as an absent outputRoot',
  );

  const sourceGenerationPointer = join(project, '.snapback', 'generations', 'latest-emitted.json');
  const sourceGenerationBytes = readFileSync(sourceGenerationPointer);
  const isolatedOutputRoot = join(project, 'release-output');
  let isolatedLockPath = null;
  const isolated = await generateInProcess(
    backend,
    { outputRoot: isolatedOutputRoot },
    { generationLock: { afterAcquire: ({ lockPath }) => { isolatedLockPath = lockPath; } } },
  );
  assert.equal(isolated.ok, true, JSON.stringify(isolated.diagnostics));
  assert.equal(isolated.outDir, join(isolatedOutputRoot, 'snapback', 'generated'));
  assert.equal(
    isolatedLockPath,
    join(isolatedOutputRoot, 'snapback', '.generated.regenerate.lock'),
  );
  assert.equal(
    isolated.cacheGraphRoot,
    codegenCacheGraphRoot(join(isolatedOutputRoot, 'snapback'), isolated.inputsHash),
  );
  assert.equal(isolated.artifactIndex.cache.graphPath, second.artifactIndex.cache.graphPath);
  assert.deepEqual(isolated.identities, second.identities);
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(reviewBytes));
  assert(readFileSync(sourceGenerationPointer).equals(sourceGenerationBytes));
  verifyGeneratedGraph(isolated.outDir);

  const authoredGeneratedSentinel = join(second.outDir, '.output-root-overlap-sentinel');
  const authoredLockPath = join(backend, '.generated.regenerate.lock');
  const assertOutputRootBoundaryRefusal = async (options, label, expectedCode = 'SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID') => {
    writeFileSync(authoredGeneratedSentinel, `${label}: authored generated surface must survive refusal\n`);
    assert.equal(existsSync(authoredLockPath), false, `${label}: authored lock starts absent`);
    const refused = await generate(backend, options);
    assert.equal(refused.ok, false, `${label}: invalid outputRoot must refuse`);
    assert.equal(
      refused.diagnostics[0]?.code,
      expectedCode,
      `${label}: refusal must occur at the generate boundary`,
    );
    assert.equal(
      existsSync(authoredGeneratedSentinel),
      true,
      `${label}: refusal must preserve the authored generated sentinel`,
    );
    assert.equal(
      existsSync(authoredLockPath),
      false,
      `${label}: refusal must not acquire the authored lock`,
    );
    rmSync(authoredGeneratedSentinel);
  };
  await assertOutputRootBoundaryRefusal(
    { outputRoot() {} },
    'method-valued outputRoot',
  );
  await assertOutputRootBoundaryRefusal(
    { outputRoot: Symbol('x') },
    'symbol-valued outputRoot',
  );

  // An option record whose value cannot be seen by own-descriptor inspection is
  // indistinguishable from an absent option, and an absent outputRoot selects
  // the authored backend as the publication root — so a silently discarded
  // option is a silent write into authored source. Refuse the shape instead.
  class PrototypeOutputRootOptions {
    get outputRoot() { return join(project, 'prototype-disjoint'); }
  }
  await assertOutputRootBoundaryRefusal(
    new PrototypeOutputRootOptions(),
    'class instance exposing outputRoot through its prototype',
    'CODEGEN_TARGET_PROFILE_UNSUPPORTED',
  );
  await assertOutputRootBoundaryRefusal(
    Object.create({ outputRoot: join(project, 'inherited-disjoint') }),
    'own-less record inheriting outputRoot',
    'CODEGEN_TARGET_PROFILE_UNSUPPORTED',
  );
  await assertOutputRootBoundaryRefusal(
    new Proxy({}, {
      get: (target, key, receiver) => (key === 'outputRoot'
        ? join(project, 'proxied-disjoint')
        : Reflect.get(target, key, receiver)),
    }),
    'proxy exposing outputRoot as a virtual property',
    'CODEGEN_TARGET_PROFILE_UNSUPPORTED',
  );

  for (const [label, erasedOptions] of [
    ['method-valued targetProfile', { targetProfile() {} }],
    ['symbol-valued appBindingMode', { appBindingMode: Symbol('x') }],
    ['method-valued check', { check() {} }],
    ['function-valued unknown option', { futureOption() {} }],
  ]) {
    const refused = await generate(join(project, 'missing-backend'), erasedOptions);
    assert.equal(refused.ok, false, `${label}: erased option value must refuse`);
    assert.equal(
      refused.diagnostics[0]?.code,
      'CODEGEN_TARGET_PROFILE_UNSUPPORTED',
      `${label}: complete option validation must run before backend resolution`,
    );
  }

  writeFileSync(authoredGeneratedSentinel, 'authored generated surface must survive refusal\n');
  const overlappingProgrammatic = await generate(backend, { outputRoot: project });
  assert.equal(overlappingProgrammatic.ok, false);
  assert.equal(
    overlappingProgrammatic.diagnostics[0]?.code,
    'SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID',
  );
  assert.equal(
    existsSync(authoredGeneratedSentinel),
    true,
    'an aliasing outputRoot must refuse before replacing the authored generated directory',
  );

  const relativeAliasingOutputRoot = relative(process.cwd(), project);
  assert.notEqual(relativeAliasingOutputRoot, project);
  const overlappingRelative = await generateInProcess(
    backend,
    { outputRoot: relativeAliasingOutputRoot },
  );
  assert.equal(overlappingRelative.ok, false);
  assert.equal(
    overlappingRelative.diagnostics[0]?.code,
    'SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID',
  );
  assert.equal(
    existsSync(authoredGeneratedSentinel),
    true,
    'a relative spelling of an aliasing outputRoot must preserve the authored sentinel',
  );
  rmSync(authoredGeneratedSentinel);

  const callerCwd = process.cwd();
  let relativeProgrammatic;
  try {
    process.chdir(project);
    relativeProgrammatic = await generate(backend, { outputRoot: 'relative-api-output' });
  } finally {
    process.chdir(callerCwd);
  }
  assert.equal(relativeProgrammatic.ok, true, JSON.stringify(relativeProgrammatic.diagnostics));
  assert.equal(
    relativeProgrammatic.outDir,
    join(canonicalProject, 'relative-api-output', 'snapback', 'generated'),
    'a genuinely disjoint string outputRoot succeeds and resolves against the caller cwd',
  );
  verifyGeneratedGraph(relativeProgrammatic.outDir);

  const explicitNullOutputRoot = await generate(backend, { outputRoot: null });
  assert.equal(explicitNullOutputRoot.ok, false);
  assert.equal(
    explicitNullOutputRoot.diagnostics[0]?.code,
    'SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID',
  );
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(reviewBytes));
  assert(readFileSync(sourceGenerationPointer).equals(sourceGenerationBytes));

  let verified = verifyGeneratedGraph(second.outDir);
  assert.equal(verified.layout, 'review-cache');
  const committedApiBytes = readFileSync(join(second.outDir, 'api.d.ts'));
  rmSync(verified.graphRoot, { recursive: true, force: true });
  rmSync(second.outDir, { recursive: true, force: true });
  mkdirSync(second.outDir);
  writeFileSync(join(second.outDir, 'artifacts.json'), reviewBytes);
  writeFileSync(join(second.outDir, 'api.d.ts'), committedApiBytes);
  assert.throws(
    () => resolveGeneratedArtifact(second.outDir, 'schema.manifest.json'),
    ({ code }) => code === 'SNAPBACK_CODEGEN_CACHE_INVALID',
  );
  assert.equal(
    resolveGeneratedArtifact(second.outDir, 'api.d.ts'),
    join(second.outDir, 'api.d.ts'),
    'a verified consumer-committed projection is the only cache-miss fallback',
  );

  const cold = await generate(backend);
  assert.equal(cold.ok, true);
  assert(readFileSync(join(cold.outDir, 'artifacts.json')).equals(reviewBytes), 'cold-cache regeneration preserves manifest bytes');
  verified = verifyGeneratedGraph(cold.outDir);
  writeFileSync(join(verified.graphRoot, 'unreviewed.txt'), 'not in manifest\n');
  assert.throws(
    () => verifyGeneratedGraph(cold.outDir),
    ({ code }) => code === 'SNAPBACK_CODEGEN_CACHE_INVALID',
  );
  rmSync(join(verified.graphRoot, 'unreviewed.txt'));
  writeFileSync(join(verified.graphRoot, 'schema.manifest.json'), '{}\n');
  assert.throws(
    () => verifyGeneratedGraph(cold.outDir),
    ({ code }) => code === 'SNAPBACK_CODEGEN_CACHE_INVALID',
  );
  const repaired = await generate(backend);
  assert.equal(repaired.ok, true);
  verifyGeneratedGraph(repaired.outDir);
  writeFileSync(join(repaired.outDir, 'api.mjs'), 'export const stale = true;\n');
  assert.throws(
    () => verifyGeneratedGraph(repaired.outDir),
    ({ code }) => code === 'SNAPBACK_CODEGEN_MATERIALIZATION_INVALID',
  );
  const rematerialized = await generate(backend);
  assert.equal(rematerialized.ok, true);

  const priorReview = readFileSync(join(rematerialized.outDir, 'artifacts.json'));
  const priorSchema = readFileSync(resolveGeneratedArtifact(rematerialized.outDir, 'schema.manifest.json'));
  writeFileSync(join(backend, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: ['not-produced.txt'],
  }));
  const invalidPolicyProjection = await generate(backend);
  assert.equal(invalidPolicyProjection.ok, false);
  assert(invalidPolicyProjection.diagnostics.some(({ code }) => code === 'SNAPBACK_CODEGEN_COMMITTED_PROJECTION_UNKNOWN'));
  assert(readFileSync(join(rematerialized.outDir, 'artifacts.json')).equals(priorReview));
  writeFileSync(join(backend, 'codegen.policy.json'), policySource);
  writeFileSync(join(backend, 'functions.mjs'), 'export const broken = ;\n');
  const failed = await generate(backend);
  assert.equal(failed.ok, false);
  assert(readFileSync(join(rematerialized.outDir, 'artifacts.json')).equals(priorReview));
  assert(readFileSync(resolveGeneratedArtifact(rematerialized.outDir, 'schema.manifest.json')).equals(priorSchema));
  writeFileSync(join(backend, 'functions.mjs'), functionsSource);

  const legacy = join(project, 'legacy');
  mkdirSync(legacy);
  writeFileSync(join(legacy, 'functions.manifest.json'), '{}\n');
  writeFileSync(join(legacy, 'artifacts.json'), JSON.stringify({
    artifactKind: 'artifactIndex',
    artifacts: ['functions.manifest.json'],
  }));
  assert.equal(resolveGeneratedArtifact(legacy, 'functions.manifest.json'), join(legacy, 'functions.manifest.json'));

  const cliJson = spawnSync(process.execPath, [join(packageRoot, 'index.mjs'), backend, '--json'], {
    encoding: 'utf8',
  });
  assert.equal(cliJson.status, 0, cliJson.stderr);
  const jsonResult = JSON.parse(cliJson.stdout);
  assert.equal(jsonResult.summary.degradedResults[0].source.line, 3);
  assert.match(cliJson.stderr, /PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED/);

  const cliText = spawnSync(process.execPath, [join(packageRoot, 'index.mjs'), backend], {
    encoding: 'utf8',
  });
  assert.equal(cliText.status, 0, cliText.stderr);
  assert.match(cliText.stdout, /Codegen summary for review-surface/);
  assert.match(cliText.stdout, /degraded unknownResult/);
  assert.match(cliText.stdout, /results\.documents.*results\.records/u);
  assert.equal(existsSync(join(project, '.snapback', 'codegen-cache')), true);
  const sourceReviewBeforeCliOutputRoot = readFileSync(join(second.outDir, 'artifacts.json'));
  const sourceGenerationBeforeCliOutputRoot = readFileSync(sourceGenerationPointer);

  const equalsOutputRoot = join(project, 'cli-release-output');
  const equalsOutputRootResult = spawnSync(
    process.execPath,
    [join(packageRoot, 'index.mjs'), backend, '--json', `--output-root=${equalsOutputRoot}`],
    { encoding: 'utf8' },
  );
  assert.equal(equalsOutputRootResult.status, 0, equalsOutputRootResult.stderr);
  const equalsOutputRootJson = JSON.parse(equalsOutputRootResult.stdout);
  assert.equal(equalsOutputRootJson.outDir, join(equalsOutputRoot, 'snapback', 'generated'));
  verifyGeneratedGraph(equalsOutputRootJson.outDir);
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(sourceReviewBeforeCliOutputRoot));
  assert(readFileSync(sourceGenerationPointer).equals(sourceGenerationBeforeCliOutputRoot));

  const relativeOutputRootResult = spawnSync(
    process.execPath,
    [join(packageRoot, 'index.mjs'), backend, '--json', '--output-root=relative-cli-output'],
    { cwd: project, encoding: 'utf8' },
  );
  assert.equal(relativeOutputRootResult.status, 0, relativeOutputRootResult.stderr);
  const relativeOutputRootJson = JSON.parse(relativeOutputRootResult.stdout);
  assert.equal(
    relativeOutputRootJson.outDir,
    join(canonicalProject, 'relative-cli-output', 'snapback', 'generated'),
    'a relative CLI output root resolves against the caller cwd',
  );
  verifyGeneratedGraph(relativeOutputRootJson.outDir);
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(sourceReviewBeforeCliOutputRoot));
  assert(readFileSync(sourceGenerationPointer).equals(sourceGenerationBeforeCliOutputRoot));

  const unknownArgument = spawnSync(
    process.execPath,
    [join(packageRoot, 'index.mjs'), backend, '--json', '--future-output-spelling'],
    { encoding: 'utf8' },
  );
  assert.equal(unknownArgument.status, 1, unknownArgument.stderr);
  const unknownArgumentResult = JSON.parse(unknownArgument.stdout);
  assert.equal(unknownArgumentResult.ok, false);
  assert.equal(unknownArgumentResult.diagnostics[0]?.code, 'SNAPBACK_CLI_ARGUMENT_INVALID');
  assert.equal(unknownArgumentResult.diagnostics[0]?.subsystem, 'cli');
  assert(readFileSync(join(second.outDir, 'artifacts.json')).equals(sourceReviewBeforeCliOutputRoot));
  assert(readFileSync(sourceGenerationPointer).equals(sourceGenerationBeforeCliOutputRoot));

  const missingOutputRoot = spawnSync(
    process.execPath,
    [join(packageRoot, 'index.mjs'), backend, '--json', '--output-root'],
    { encoding: 'utf8' },
  );
  assert.equal(missingOutputRoot.status, 1, missingOutputRoot.stderr);
  const missingOutputRootResult = JSON.parse(missingOutputRoot.stdout);
  assert.equal(missingOutputRootResult.ok, false);
  assert.equal(
    missingOutputRootResult.diagnostics[0]?.code,
    'SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID',
  );
  assert.match(missingOutputRoot.stderr, /SNAPBACK_CODEGEN_OUTPUT_ROOT_INVALID/u);
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log('codegen review surface: option-boundary sentinel/lock refusals, undefined omission, disjoint publication, cold cache, tamper, legacy, custody, failure atomicity, and summaries verified');
