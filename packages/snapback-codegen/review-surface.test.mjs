import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
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
  committedProjections: ['api.d.ts'],
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
  // This fixture declares public-read visibility, so only the deliberately
  // degraded query result contributes a warning.
  assert.equal(first.summary.counts.warnings, 1);
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
} finally {
  rmSync(project, { recursive: true, force: true });
}

console.log('codegen review surface: cold cache, tamper, legacy, custody, failure atomicity, and summaries verified');
