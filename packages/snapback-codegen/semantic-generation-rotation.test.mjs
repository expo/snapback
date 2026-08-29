import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate, generateInProcess } from './index.mjs';
import { generationEnvelopeRoot } from './semantic-generation.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function backend() {
  const project = mkdtempSync(join(tmpdir(), 'snapback-semantic-generation-'));
  roots.push(project);
  const root = join(project, 'snapback');
  writeFileSync(join(project, 'demo.snapback.json'), JSON.stringify({ id: 'semantic-generation' }));
  // mkdir is implicit in the caller so every source mutation stays explicit.
  return { project, root };
}

function writeSchema(root, changed = false) {
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({
    value: v.integer(),
    ${changed ? 'label: v.optional(v.string()),' : ''}
  }).visibility({ kind: 'public-read' }).sync(),
});
`);
}

function functionSource({
  helper = 'plusOne',
  comment = '',
  changedContract = false,
  behavior = '+ 1',
} = {}) {
  const argument = changedContract ? 'step' : 'increment';
  return `
import { defineJsQuery, results, v } from '${defineUrl}';
function ${helper}(value) { ${comment}return value ${behavior}; }
export const listTodos = defineJsQuery({
  auth: '${changedContract ? 'authenticated' : 'public'}',
  args: { ${argument}: v.integer() },
  reads: ['todos'],
  result: results.records(v.object({
    value: v.integer(),
    ${changedContract ? 'label: v.optional(v.string()),' : ''}
  })),
  handler: async (_ctx, { ${argument} }) => [{ value: ${helper}(${argument}) }],
});
`;
}

function initializeBackend() {
  const fixture = backend();
  mkdirSync(fixture.root);
  writeSchema(fixture.root);
  writeFileSync(join(fixture.root, 'functions.mjs'), functionSource());
  return fixture;
}

function digest(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function operationImplementationHash(result) {
  return result.functionManifest.functions.find(({ name }) => name === 'listTodos').implementationHash;
}

function generationDirectories(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sha256%3A'))
    .map((entry) => entry.name)
    .sort();
}

function pathIsInside(parent, candidate) {
  const parentRelative = relative(parent, candidate);
  return parentRelative === '' || (
    parentRelative !== '..'
    && !parentRelative.startsWith(`..${sep}`)
    && !isAbsolute(parentRelative)
  );
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('rotation matrix and deterministic immutable dual emission', async () => {
  const { project, root } = initializeBackend();
  const envelopeRoot = generationEnvelopeRoot(root);

  const checked = await generate(root, { check: true });
  assert.equal(checked.ok, true, JSON.stringify(checked.diagnostics));
  assert.equal(checked.generationEnvelopeRoot, null);
  assert.equal(existsSync(envelopeRoot), false, '--check wrote a generation envelope');

  let baselineEnvelopeTemporaryRoot = null;
  let baselineLatestTemporaryPath = null;
  const baseline = await generateInProcess(root, {}, {
    generationEnvelope: {
      beforeRename({ temporaryRoot }) {
        baselineEnvelopeTemporaryRoot = temporaryRoot;
        assert.equal(existsSync(temporaryRoot), true);
      },
      beforeLatestRename({ temporaryPath }) {
        baselineLatestTemporaryPath = temporaryPath;
        assert.equal(existsSync(temporaryPath), true);
      },
    },
  });
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  assert.equal(pathIsInside(project, baselineEnvelopeTemporaryRoot), false);
  assert.equal(pathIsInside(project, baselineLatestTemporaryPath), false);
  assert.equal(
    dirname(baselineEnvelopeTemporaryRoot),
    dirname(baselineLatestTemporaryPath),
    'envelope and latest-pointer candidates share the external publication staging root',
  );
  assert.equal(
    existsSync(dirname(baselineEnvelopeTemporaryRoot)),
    false,
    'successful generation removes the external publication staging root',
  );
  assert.equal(
    readdirSync(envelopeRoot).some((name) => (
      name.startsWith('.tmp-') || name.startsWith('.latest-emitted.tmp-')
    )),
    false,
    'stable generation custody never contains transient publication entries',
  );
  const baselineLegacy = operationImplementationHash(baseline);
  const baselineGenerationBytes = readFileSync(join(
    baseline.generationEnvelopeRoot,
    'generation.json',
  ));
  const baselineIntegrityBytes = readFileSync(join(
    baseline.generationEnvelopeRoot,
    'integrity.json',
  ));
  const baselineEnvelope = JSON.parse(baselineGenerationBytes);
  const baselineIntegrity = JSON.parse(baselineIntegrityBytes);
  assert.deepEqual(baseline.artifactIndex.identities, baseline.identities);
  assert.deepEqual(baselineEnvelope.identities, baseline.identities);
  assert.equal(baselineEnvelope.predecessorGenerationId, null);
  assert.equal(baselineEnvelope.custody.class, 'gitignored-cache');
  assert.equal(baselineEnvelope.members.at(-1).path > '', true);
  assert.equal(baselineIntegrity.generation.sha256, digest(baselineGenerationBytes));
  for (const member of baselineIntegrity.members) {
    const bytes = readFileSync(join(root, 'generated', ...member.path.split('/')));
    assert.equal(bytes.byteLength, member.bytes, member.path);
    assert.equal(digest(bytes), member.sha256, member.path);
  }

  writeFileSync(join(root, 'functions.mjs'), functionSource({
    comment: '/* review evidence only; @ref LLP 0241#d1-split-identity-by-what-changed */ ',
  }));
  const commentOnly = await generate(root);
  assert.equal(commentOnly.ok, true, JSON.stringify(commentOnly.diagnostics));
  assert.equal(commentOnly.identities.semanticId, baseline.identities.semanticId);
  assert.equal(commentOnly.identities.executableId, baseline.identities.executableId);
  assert.notEqual(commentOnly.identities.evidenceId, baseline.identities.evidenceId);
  assert.notEqual(commentOnly.identities.bundleId, baseline.identities.bundleId);
  assert.notEqual(commentOnly.identities.generationId, baseline.identities.generationId);
  assert.equal(operationImplementationHash(commentOnly), baselineLegacy);
  assert.equal(
    JSON.parse(readFileSync(join(commentOnly.generationEnvelopeRoot, 'generation.json')))
      .predecessorGenerationId,
    baseline.identities.generationId,
  );

  writeFileSync(join(root, 'functions.mjs'), functionSource({ helper: 'incrementOne' }));
  const graphChange = await generate(root);
  assert.equal(graphChange.ok, true, JSON.stringify(graphChange.diagnostics));
  assert.notEqual(graphChange.identities.semanticId, baseline.identities.semanticId);
  assert.notEqual(graphChange.identities.executableId, baseline.identities.executableId);
  assert.notEqual(operationImplementationHash(graphChange), baselineLegacy);

  writeSchema(root, true);
  writeFileSync(join(root, 'functions.mjs'), functionSource({
    helper: 'incrementOne',
    changedContract: true,
  }));
  const contractChange = await generate(root);
  assert.equal(contractChange.ok, true, JSON.stringify(contractChange.diagnostics));
  assert.notEqual(contractChange.identities.semanticId, graphChange.identities.semanticId);
  assert.notEqual(operationImplementationHash(contractChange), operationImplementationHash(graphChange));

  const identical = await generate(root);
  assert.equal(identical.ok, true, JSON.stringify(identical.diagnostics));
  assert.deepEqual(identical.identities, contractChange.identities);
  assert(readFileSync(join(identical.generationEnvelopeRoot, 'generation.json')).equals(
    readFileSync(join(contractChange.generationEnvelopeRoot, 'generation.json')),
  ));
  assert(readFileSync(join(baseline.generationEnvelopeRoot, 'generation.json')).equals(baselineGenerationBytes));
  assert(readFileSync(join(baseline.generationEnvelopeRoot, 'integrity.json')).equals(baselineIntegrityBytes));

  writeSchema(root);
  writeFileSync(join(root, 'functions.mjs'), functionSource());
  const rollback = await generate(root);
  assert.equal(rollback.ok, true, JSON.stringify(rollback.diagnostics));
  assert.deepEqual(rollback.identities, baseline.identities);
  assert(readFileSync(join(rollback.generationEnvelopeRoot, 'generation.json')).equals(baselineGenerationBytes));

  console.log('semantic generation rotation matrix:', JSON.stringify({
    baseline: { ...baseline.identities, implementationHash: baselineLegacy },
    commentOnly: { ...commentOnly.identities, implementationHash: operationImplementationHash(commentOnly) },
    graphChange: { ...graphChange.identities, implementationHash: operationImplementationHash(graphChange) },
    contractChange: { ...contractChange.identities, implementationHash: operationImplementationHash(contractChange) },
    identical: identical.identities,
    rollback: rollback.identities,
  }));
});

test('failed envelope candidate is atomic and leaves prior output untouched', async () => {
  const { project, root } = initializeBackend();
  const baseline = await generate(root);
  assert.equal(baseline.ok, true, JSON.stringify(baseline.diagnostics));
  const envelopeRoot = generationEnvelopeRoot(root);
  const priorDirectories = generationDirectories(envelopeRoot);
  const priorReviewBytes = readFileSync(join(root, 'generated', 'artifacts.json'));
  const priorLatestBytes = readFileSync(join(envelopeRoot, 'latest-emitted.json'));

  writeFileSync(join(root, 'functions.mjs'), functionSource({ behavior: '+ 2' }));
  let failedTemporaryRoot = null;
  const failed = await generateInProcess(root, {}, {
    generationEnvelope: {
      beforeRename({ temporaryRoot }) {
        failedTemporaryRoot = temporaryRoot;
        const error = new Error('injected pre-rename envelope failure');
        error.code = 'CODEGEN_WRITE_FAILED';
        throw error;
      },
    },
  });
  assert.equal(failed.ok, false);
  assert.equal(pathIsInside(project, failedTemporaryRoot), false);
  assert.equal(existsSync(failedTemporaryRoot), false);
  assert.equal(
    existsSync(dirname(failedTemporaryRoot)),
    false,
    'failed generation removes the external publication staging root',
  );
  assert(failed.diagnostics.some(({ message }) => /injected pre-rename envelope failure/u.test(message)));
  assert.deepEqual(generationDirectories(envelopeRoot), priorDirectories);
  assert(readFileSync(join(root, 'generated', 'artifacts.json')).equals(priorReviewBytes));
  assert(readFileSync(join(envelopeRoot, 'latest-emitted.json')).equals(priorLatestBytes));
  assert.equal(
    readdirSync(envelopeRoot).some((name) => name.startsWith('.tmp-')),
    false,
  );
  assert.match(digest(priorReviewBytes), /^sha256:[0-9a-f]{64}$/u);
});
