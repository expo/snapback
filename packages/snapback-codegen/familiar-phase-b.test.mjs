import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import vm from 'node:vm';

import ts from 'typescript';

import {
  action,
  lowerFamiliarReturns,
  mutation,
  query,
  v,
} from './familiar.mjs';
import {
  generate,
  renderFamiliarHandlerRuntime,
} from './index.mjs';
import { renderInlineHandlerModule } from './inline-handlers.mjs';
import {
  buildNormalizedApplicationDefinitionV1,
  FAMILIAR_AUTHORING_PROFILE,
} from './semantic-generation.mjs';
import {
  applyDeclarationSuggestion,
  suggestDeclarations,
} from './declaration-suggestion.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(packageRoot, '..', '..');
const ctxBootstrap = readFileSync(join(repoRoot, 'packages', 'snapback-harness', 'ctx-bootstrap.js'), 'utf8');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const familiarFixture = join(repoRoot, 'tests', 'fixtures', 'familiar-todo');
const explicitFixture = join(repoRoot, 'tests', 'fixtures', 'familiar-todo-explicit');
const temporaryRoots = [];
const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const expoRequire = createRequire(new URL('../snapback-expo/package.json', import.meta.url));
const expoPackagePath = expoRequire.resolve('expo/package.json');
const expoDependencyRequire = createRequire(expoPackagePath);
const metroTransformer = expoDependencyRequire('metro-babel-transformer');
const expoPackage = readJson(expoPackagePath);
const metroPackage = readJson(expoDependencyRequire.resolve('metro/package.json'));

after(() => {
  for (const root of temporaryRoots) rmSync(root, { recursive: true, force: true });
});

function emittedModules(root) {
  const modules = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) modules.push(path);
    }
  };
  visit(root);
  return modules.sort();
}

function temporaryFamiliarFixture() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-familiar-phase-b-'));
  temporaryRoots.push(root);
  for (const name of ['codegen.policy.json', 'contracts.ts', 'schema.ts', 'todos.ts']) {
    cpSync(join(familiarFixture, name), join(root, name));
  }
  return root;
}

const GUIDE_POINT_READ_FUNCTION = `
export const byId = query({
  args: { id: v.id("todos") },
  returns: v.array(v.doc("todos")),
  auth: "public",
  reads: ["todos"],
  handler: async (ctx, args) => ctx.db
    .query("todos")
    .withIndex("_id")
    .eq("_id", args.id)
    .take(1)
    .collect(),
});
`;

function runtimeHandler(name, expressionSource, contextKind, apiDigest = 'sha256:test-api') {
  const canonical = {
    source: renderInlineHandlerModule(name, expressionSource),
    segments: [],
  };
  const source = renderFamiliarHandlerRuntime(
    name,
    { expressionSource },
    canonical,
    contextKind,
    apiDigest,
  ).source;
  const sandbox = Object.create(null);
  vm.runInNewContext(source, sandbox, { filename: `${name}.familiar-runtime.js` });
  return sandbox.__snapbackHandlers[name];
}

async function settledRuntimeFailure(name, expressionSource, contextKind) {
  const canonical = {
    source: renderInlineHandlerModule(name, expressionSource),
    segments: [],
  };
  const source = renderFamiliarHandlerRuntime(
    name,
    { expressionSource },
    canonical,
    contextKind,
    'sha256:test-api',
  ).source;
  const context = vm.createContext({});
  vm.runInContext(ctxBootstrap, context, { filename: 'ctx-bootstrap.js' });
  vm.runInContext(source, context, { filename: `${name}.familiar-runtime.js` });
  const envelope = await context.__snapbackSettle(
    name,
    '{}',
    '{}',
    contextKind,
    null,
    null,
    '1',
    (operation) => {
      assert.match(operation, /\|action\.metadata$/u);
      return {};
    },
  );
  return JSON.parse(envelope).r;
}

function mockQueryContext(rows, trace) {
  const matches = (row, [method, field, value]) => {
    if (method === 'eq') return row[field] === value;
    if (method === 'in') return value.includes(row[field]);
    if (method === 'lt') return row[field] < value;
    if (method === 'lte') return row[field] <= value;
    if (method === 'gt') return row[field] > value;
    if (method === 'gte') return row[field] >= value;
    throw new Error(`unexpected filter method ${method}`);
  };
  const builder = () => {
    const value = {
      withIndex(name) { trace.index = name; return value; },
      eq(field, operand) { trace.filters.push(['eq', field, operand]); return value; },
      in(field, operand) { trace.filters.push(['in', field, operand]); return value; },
      lt(field, operand) { trace.filters.push(['lt', field, operand]); return value; },
      lte(field, operand) { trace.filters.push(['lte', field, operand]); return value; },
      gt(field, operand) { trace.filters.push(['gt', field, operand]); return value; },
      gte(field, operand) { trace.filters.push(['gte', field, operand]); return value; },
      order() { return value; },
      take() { return value; },
      collect() { return rows.filter((row) => trace.filters.every((filter) => matches(row, filter))); },
      first() { return value.collect()[0] ?? null; },
    };
    return value;
  };
  return {
    auth: Object.freeze({ userId: 'human-1' }),
    runtime: Object.freeze({}),
    db: { query: () => builder() },
  };
}

test('familiar returns lowering preserves row shapes and admits exact scalar values', () => {
  const record = v.object({ title: v.string() });
  assert.deepEqual(lowerFamiliarReturns('query', v.array(v.doc('todos'))), {
    __resultContract: true,
    kind: 'documents',
    table: 'todos',
  });
  assert.equal(lowerFamiliarReturns('query', v.array(record)).kind, 'records');
  assert.deepEqual(
    lowerFamiliarReturns('query', v.array(record, { maxItems: 7 })).rows,
    { minItems: 0, maxItems: 7 },
  );
  assert.equal(lowerFamiliarReturns('query', v.array(v.union([
    v.object({ kind: v.literal('a') }),
    v.object({ kind: v.literal('b'), count: v.integer() }),
  ]))).kind, 'records');
  assert.deepEqual(
    lowerFamiliarReturns('query', v.tuple([record])).rows,
    { minItems: 1, maxItems: 1 },
  );
  assert.equal(lowerFamiliarReturns('query', record).kind, 'value');
  assert.equal(lowerFamiliarReturns('query', v.doc('todos')).kind, 'value');
  assert.equal(lowerFamiliarReturns('mutation', v.doc('todos')).kind, 'document');
  assert.equal(lowerFamiliarReturns('action', v.doc('todos')).kind, 'document');
  assert.equal(lowerFamiliarReturns('action', v.array(v.string())).kind, 'value');

  for (const validator of [
    v.string(),
    v.id('todos'),
    v.doc('todos'),
    v.array(v.string()),
    v.array(v.id('todos')),
    v.array(v.doc('todos'), { maxItems: 1 }),
    v.tuple([v.doc('todos')]),
  ]) {
    assert.equal(lowerFamiliarReturns('query', validator).kind, 'value');
  }
  assert.equal(
    lowerFamiliarReturns('query', v.union([v.doc('todos'), v.null()])).kind,
    'value',
  );
  assert.throws(
    () => lowerFamiliarReturns('mutation', v.array(v.doc('todos'))),
    ({ code, message }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE'
      && /document-containing composite values require the explicit profile's result: grammar/u.test(message),
  );
  assert.throws(
    () => lowerFamiliarReturns('action', v.array(v.doc('todos'))),
    ({ code, message }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE'
      && /document-containing composite values require the explicit profile's result: grammar/u.test(message),
  );
});

test('Guide point-read spelling generates as an empty-capable relational document set', async () => {
  const root = temporaryFamiliarFixture();
  const sourcePath = join(root, 'todos.ts');
  writeFileSync(
    sourcePath,
    `${readFileSync(sourcePath, 'utf8')}\n${GUIDE_POINT_READ_FUNCTION}`,
  );
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const pointRead = generated.functionManifest.functions.find(({ name }) => name === 'todos.byId');
  assert.ok(pointRead, 'Guide point-read function was not generated');
  assert.equal(pointRead.resultContract.kind, 'documents');
  assert.equal(pointRead.resultContract.table, 'todos');
  assert.equal(
    lowerFamiliarReturns('query', v.array(v.doc('todos'), { maxItems: 1 })).kind,
    'value',
    'the bounded spelling must stay a value carrier, not silently become a relational row-set',
  );
});

test('familiar constructors enforce the closed matrix, auth, delivery, and suggestion route', () => {
  const handler = async () => [];
  assert.throws(
    () => query({ args: {}, returns: v.array(v.object({})), reads: ['todos'], handler }),
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_AUTH_MISSING',
  );
  assert.throws(
    () => query({ args: {}, returns: v.array(v.object({})), auth: 'public', reads: ['todos'], delivery: 'poll', handler }),
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_DELIVERY_INVALID',
  );
  assert.throws(
    () => query({ args: {}, returns: v.array(v.object({})), auth: 'public', reads: ['todos'], effects: [], handler }),
    (error) => error.code === 'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED'
      && /LLP 0249 explicit action profile/u.test(error.message),
  );
  assert.throws(
    () => mutation({ args: {}, auth: 'public', reads: [], writes: ['todos'], handler: async () => null }),
    (error) => error.code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE'
      && /LLP 0245 declaration suggestion/u.test(error.message),
  );
  assert.equal(query({
    args: {}, returns: v.array(v.object({})), auth: 'public', reads: ['todos'], handler,
  }).__kind, 'LiveQuery');
  assert.equal(query({
    args: {}, returns: v.array(v.object({})), auth: 'public', reads: ['todos'], delivery: 'read', handler,
  }).__kind, 'Query');
  assert.equal(action({
    args: {}, returns: v.null(), auth: 'public', handler: async () => null,
  }).__kind, 'Action');
});

test('familiar explicit video intents occupy the same two-segment api namespace', async () => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-familiar-video-'));
  temporaryRoots.push(root);
  cpSync(join(familiarFixture, 'codegen.policy.json'), join(root, 'codegen.policy.json'));
  writeFileSync(join(root, 'schema.ts'), `
import { defineSchema, defineTable, v } from './generated/server';
export default defineSchema({
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — the upload fixture carries
  // an owner principal, so table and asset visibility use the same owner field.
  videos: defineTable({
    ownerId: v.principal(),
    clip: v.assetRef({ upload: 'media.videoUpload' }),
  })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .assetSharing({ kind: 'owner', field: 'ownerId' }),
});
`);
  writeFileSync(join(root, 'media.ts'), `
import { defineAssetUpload } from './generated/server';
export const videoUpload = defineAssetUpload({
  args: {},
  auth: 'authenticated',
  reads: [],
  accept: { mediaTypes: ['video/mp4'], maxBytes: 1_000_000 },
  delivery: { kind: 'private-strict' },
  access: { read: 'via-references' },
  video: { location: 'retain' },
  authorize: async (ctx) => ({ owner: ctx.auth.userId }),
});
`);
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const intent = generated.functionManifest.assetUploadIntents.find(
    ({ name }) => name === 'media.videoUpload',
  );
  assert.ok(intent, JSON.stringify(generated.functionManifest.assetUploadIntents));
  assert.deepEqual(intent.accept.mediaTypes, ['video/mp4']);
  assert.deepEqual(intent.video, { location: 'retain' });
  const generatedApi = await import(
    `${pathToFileURL(join(root, 'generated', 'api.mjs')).href}?video=${Date.now()}`,
  );
  assert.strictEqual(
    generatedApi.api.media.videoUpload,
    generatedApi.app.api.assets['media.videoUpload'],
  );
  assert.match(
    readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8'),
    /readonly "media": Readonly<\{ "videoUpload": GeneratedApi\["media\.videoUpload"\] \}>/u,
  );
});

test('dual-profile todo fixtures normalize equally and emit lawful dotted surfaces', async () => {
  const familiar = await generate(familiarFixture);
  const explicit = await generate(explicitFixture);
  assert.equal(familiar.ok, true, JSON.stringify(familiar.diagnostics));
  assert.equal(explicit.ok, true, JSON.stringify(explicit.diagnostics));
  assert.equal(familiar.identities.normalizedContractId, explicit.identities.normalizedContractId);
  assert.equal(familiar.identities.normalizedSchemaId, explicit.identities.normalizedSchemaId);
  assert.notEqual(familiar.identities.semanticId, explicit.identities.semanticId);
  assert.notEqual(familiar.identities.generationId, explicit.identities.generationId);
  assert.equal(
    familiar.identities.normalizedContractId,
    'sha256:ac25b4c219ee1162b82925a4283afe4235ca0a200a25c33c5989704a64e7c30d',
  );
  assert.equal(
    familiar.identities.normalizedSchemaId,
    'sha256:1215a502ea9d20eecd894a24e7c75c3a75867ae1d912cf2a742688be2b67e2bb',
  );

  const familiarOutput = join(familiarFixture, 'generated');
  const explicitOutput = join(explicitFixture, 'generated');
  for (const name of ['server.mjs', 'server.d.ts', 'api.mjs', 'api.d.ts', 'api.d.mts']) {
    assert.equal(readFileSync(join(familiarOutput, name), 'utf8').length > 0, true, name);
  }
  const familiarApi = await import(`${pathToFileURL(join(familiarOutput, 'api.mjs')).href}?phase-b=${Date.now()}`);
  assert(Object.isFrozen(familiarApi.api));
  assert(Object.isFrozen(familiarApi.api.todos));
  assert.strictEqual(familiarApi.api.todos.list, familiarApi.app.api.queries['todos.list']);
  assert.strictEqual(familiarApi.api.todos.create, familiarApi.app.api.mutations['todos.create']);
  const familiarDescriptorSource = readFileSync(join(familiarOutput, 'app.descriptor.json'), 'utf8');
  const familiarDescriptor = JSON.parse(familiarDescriptorSource);
  assert.equal((familiarDescriptorSource.match(/"authoringProfile":/gu) ?? []).length, 1);
  for (const reference of [
    familiarDescriptor.api.queries['todos.list'],
    familiarDescriptor.api.mutations['todos.create'],
  ]) {
    assert.equal(Object.hasOwn(reference, 'authoringProfile'), false);
    assert.equal(Object.hasOwn(reference, 'delivery'), false);
    assert.equal(Object.hasOwn(reference, 'retention'), false);
  }
  assert.equal(familiarApi.api.todos.list.authoringProfile, FAMILIAR_AUTHORING_PROFILE);
  assert.equal(familiarApi.api.todos.list.delivery, 'live');
  assert.equal(familiarApi.api.todos.list.retention, 'none');
  for (const fact of ['authoringProfile', 'delivery', 'retention']) {
    assert.equal(Object.hasOwn(familiarApi.api.todos.list, fact), true, fact);
  }
  assert.equal(familiarApi.api.todos.create.authoringProfile, FAMILIAR_AUTHORING_PROFILE);
  assert.equal(familiarApi.api.todos.create.retention, 'none');
  assert.equal(Object.hasOwn(familiarApi.api.todos.create, 'authoringProfile'), true);
  assert.equal(Object.hasOwn(familiarApi.api.todos.create, 'retention'), true);
  assert.equal(Object.hasOwn(familiarApi.api.todos.create, 'delivery'), false);
  assert.equal(familiarApi.api.todos.createFromAction.authoringProfile, FAMILIAR_AUTHORING_PROFILE);
  assert.equal(familiarApi.api.todos.createFromAction.retention, 'none');
  assert.equal(Object.hasOwn(familiarApi.api.todos.createFromAction, 'authoringProfile'), true);
  assert.equal(Object.hasOwn(familiarApi.api.todos.createFromAction, 'retention'), true);
  assert.equal(Object.hasOwn(familiarApi.api.todos.createFromAction, 'delivery'), false);
  const familiarApiModuleSource = readFileSync(join(familiarOutput, 'api.mjs'), 'utf8');
  assert.doesNotMatch(familiarApiModuleSource, /"authoringProfile":/u);
  assert.doesNotMatch(familiarApiModuleSource, /"delivery":/u);
  assert.doesNotMatch(familiarApiModuleSource, /"retention":/u);
  const familiarApiTypesSource = readFileSync(join(familiarOutput, 'api.d.ts'), 'utf8');
  assert.match(familiarApiTypesSource, /readonly __snapbackAuthoringProfile\?: Profile;/u);
  assert.match(familiarApiTypesSource, /Familiar `useMutation` is settled-only \(`queue:false`\)/u);
  assert.match(
    familiarApiTypesSource,
    /`useSnapbackMutationDispatch` \+ `useSnapbackMutationStatus`/u,
  );

  const actionRuntime = familiar.functionManifest.functions.find(
    ({ name }) => name === 'todos.createFromAction',
  ).runtime.IbexModule.source;
  const actionSandbox = Object.create(null);
  vm.runInNewContext(actionRuntime, actionSandbox, { filename: 'familiar-generated-action.js' });
  assert.deepEqual(
    JSON.parse(JSON.stringify(await actionSandbox.__snapbackHandlers['todos.createFromAction']({
      auth: Object.freeze({}),
      runtime: Object.freeze({}),
      secrets: Object.freeze({}),
      refuse() {},
      isDirectHuman() { return true; },
      runMutation(name, args) { return { name, args }; },
    }, { title: 'captured helper' }))),
    { name: 'todos.create', args: { title: 'captured helper' } },
  );

  const explicitApi = await import(`${pathToFileURL(join(explicitOutput, 'api.mjs')).href}?phase-b=${Date.now()}`);
  assert.equal(Object.hasOwn(explicitApi, 'todos.list'), false);
  assert.equal(Object.hasOwn(explicitApi, 'todos.create'), false);
  assert.equal(explicitApi.api['todos.list'].name, 'todos.list');
  assert.equal(explicitApi.api['todos.create'].name, 'todos.create');
  const explicitAction = explicitApi.api['todos.createFromAction'];
  assert.equal(explicitAction.authoringProfile, 'snapback-explicit-v1');
  assert.equal(explicitAction.retention, 'none');
  assert.equal(Object.hasOwn(explicitAction, 'authoringProfile'), true);
  assert.equal(Object.hasOwn(explicitAction, 'retention'), true);
  assert.equal(Object.hasOwn(explicitAction, 'delivery'), false);
  const explicitApiModuleSource = readFileSync(join(explicitOutput, 'api.mjs'), 'utf8');
  assert.doesNotMatch(explicitApiModuleSource, /"authoringProfile":/u);
  assert.doesNotMatch(explicitApiModuleSource, /"delivery":/u);
  assert.doesNotMatch(explicitApiModuleSource, /"retention":/u);

  for (const output of [familiarOutput, explicitOutput]) {
    const modules = spawnSync(
      'sh',
      ['-c', 'find "$1" -name "*.mjs" -print0 | xargs -0 -n1 node --check', 'phase-b', output],
      { encoding: 'utf8' },
    );
    assert.equal(modules.status, 0, `${modules.stdout}\n${modules.stderr}`);
    assert.match(expoPackage.version, /^57\./u);
    for (const modulePath of emittedModules(output)) {
      assert.doesNotThrow(
        () => metroTransformer.transform({
          filename: modulePath,
          src: readFileSync(modulePath, 'utf8'),
          plugins: [],
          options: {
            dev: true,
            enableBabelRCLookup: false,
            hermesParser: true,
            platform: 'ios',
            projectRoot: output,
          },
        }),
        `Expo ${expoPackage.version} / Metro ${metroPackage.version} could not parse ${modulePath}`,
      );
    }
    const typeScriptFiles = spawnSync('find', [output, '-name', '*.ts', '-type', 'f'], {
      encoding: 'utf8',
    });
    assert.equal(typeScriptFiles.status, 0, typeScriptFiles.stderr);
    for (const declaration of typeScriptFiles.stdout.trim().split('\n').filter(Boolean)) {
      const transpiled = ts.transpileModule(readFileSync(declaration, 'utf8'), {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
        reportDiagnostics: true,
      });
      assert.equal(
        (transpiled.diagnostics ?? []).some(({ category }) => category === ts.DiagnosticCategory.Error),
        false,
        `${declaration}: ${JSON.stringify(transpiled.diagnostics)}`,
      );
    }
  }
  const familiarTypes = spawnSync(
    join(repoRoot, 'node_modules', '.bin', 'tsc'),
    ['--project', join(familiarFixture, 'tsconfig.json')],
    { encoding: 'utf8' },
  );
  assert.equal(familiarTypes.status, 0, `${familiarTypes.stdout}\n${familiarTypes.stderr}`);
  const dottedBinding = readFileSync(
    join(familiarOutput, 'contract', 'todos.list.query.ts'),
    'utf8',
  );
  assert.match(dottedBinding, /function __snapbackTodosList/u);
  assert.match(dottedBinding, /__snapbackTodosList as "todos\.list"/u);
  assert.doesNotMatch(
    readFileSync(join(familiarOutput, 'app.d.ts'), 'utf8'),
    /export \{ .* as "todos\.list"/u,
  );
});

test('familiar read-reference JSDoc follows compatibilityAliases data', async () => {
  const root = temporaryFamiliarFixture();
  const sourcePath = join(root, 'todos.ts');
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace(
      '  reads: ["todos"],\n  handler:',
      '  reads: ["todos"],\n  delivery: "read",\n  handler:',
    ),
  );
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  assert.match(
    readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8'),
    /Familiar delivery `read` has no v1 hook; call `client\.query` \(planned `client\.read`\)/u,
  );
});

test('normalized witness diverges for every contract-bearing adversarial axis', async () => {
  const generated = await generate(familiarFixture);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const baselineArgs = {
    schemaManifest: generated.schemaManifest,
    functionManifest: generated.functionManifest,
    routesManifest: null,
  };
  const baseline = buildNormalizedApplicationDefinitionV1(baselineArgs).normalizedContractId;
  const mutateAxis = (name, update) => {
    const functionManifest = structuredClone(generated.functionManifest);
    const operation = functionManifest.functions.find(({ name: candidate }) => candidate === name);
    update(operation);
    return buildNormalizedApplicationDefinitionV1({
      ...baselineArgs,
      functionManifest,
    }).normalizedContractId;
  };
  const divergences = {
    auth: mutateAxis('todos.list', (operation) => { operation.authRequirement = 'authenticated'; }),
    reads: mutateAxis('todos.list', (operation) => { operation.readSetSummary = { tables: [] }; }),
    secrets: mutateAxis('todos.createFromAction', (operation) => { operation.uses = ['NEW_SECRET']; }),
    planVsHandler: mutateAxis('todos.create', (operation) => { operation.runtime = { HostPlan: { Mutation: { steps: [] } } }; }),
    delivery: mutateAxis('todos.list', (operation) => { operation.kind = 'Query'; }),
  };
  for (const [axis, identity] of Object.entries(divergences)) {
    assert.notEqual(identity, baseline, axis);
  }
});

test('withIndex recorder is no-drop and action facade is an exact frozen table', async () => {
  const trace = { index: null, filters: [] };
  const rows = [
    { owner: 'a', score: 2 },
    { owner: 'a', score: 8 },
    { owner: 'b', score: 9 },
  ];
  const narrowed = runtimeHandler(
    'todos.range',
    'async (ctx, args) => ctx.db.query("todos").withIndex("by_owner_score", (q) => q.eq("owner", args.owner).gte("score", args.min)).collect()',
    'query',
  );
  assert.deepEqual(
    await narrowed(mockQueryContext(rows, trace), { owner: 'a', min: 5 }),
    [{ owner: 'a', score: 8 }],
  );
  assert.deepEqual(trace.filters, [['eq', 'owner', 'a'], ['gte', 'score', 5]]);

  const unsupported = runtimeHandler(
    'todos.unsupportedRange',
    'async (ctx) => ctx.db.query("todos").withIndex("by_owner", (q) => q.between("owner", "a")).collect()',
    'query',
  );
  await assert.rejects(
    unsupported(mockQueryContext(rows, { index: null, filters: [] }), {}),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED',
  );
  const nonChained = runtimeHandler(
    'todos.nonChainedRange',
    'async (ctx) => ctx.db.query("todos").withIndex("by_owner", (q) => { q.eq("owner", "a"); return q; }).collect()',
    'query',
  );
  await assert.rejects(
    nonChained(mockQueryContext(rows, { index: null, filters: [] }), {}),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED',
  );

  const actionContext = {
    auth: Object.freeze({ userId: 'human-1' }),
    runtime: Object.freeze({}),
    secrets: Object.freeze({}),
    refuse() {},
    isDirectHuman() { return true; },
    runMutation(name, args) { return { name, args }; },
    db: {}, run: {}, cron: {}, assets: {}, jobs: {}, realtime: {}, stream: {}, push: {},
  };
  const inspectFacade = runtimeHandler(
    'todos.facade',
    '(ctx) => ({ frozen: Object.isFrozen(ctx), ownProperties: Object.getOwnPropertyNames(ctx).sort() })',
    'action',
  );
  assert.deepEqual(JSON.parse(JSON.stringify(await inspectFacade(actionContext, {}))), {
    frozen: true,
    ownProperties: [
      'auth', 'fetch', 'fetchStream', 'isDirectHuman', 'refuse', 'runMutation', 'runQuery', 'runtime', 'secrets',
    ],
  });

  const apiDigest = 'sha256:frozen-api';
  const compose = runtimeHandler(
    'todos.compose',
    `(ctx, args) => ctx.runMutation(Object.freeze({__snapbackFamiliarApiReference:Object.freeze({name:"todos.create",apiDigest:${JSON.stringify(apiDigest)}})}), { title: args.title })`,
    'action',
    apiDigest,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await compose(actionContext, { title: 'one' }))),
    { name: 'todos.create', args: { title: 'one' } },
  );
  const foreignMarker = Object.freeze({
    __snapbackFamiliarApiReference: Object.freeze({ name: 'todos.create', apiDigest }),
  });
  const foreignCompose = runtimeHandler(
    'todos.foreignCompose',
    '(ctx, args) => ctx.runMutation(args.reference, { title: args.title })',
    'action',
    apiDigest,
  );
  await assert.rejects(
    async () => foreignCompose(actionContext, { reference: foreignMarker, title: 'one' }),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED',
  );
  await assert.rejects(
    async () => foreignCompose(actionContext, { reference: 'todos.create', title: 'one' }),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED',
  );
  const settledRawReference = await settledRuntimeFailure(
    'todos.rawReference',
    '(ctx) => ctx.runMutation("todos.create", {})',
    'action',
  );
  assert.equal(
    settledRawReference.code,
    'SNAPBACK_FAMILIAR_RUNMUTATION_REF_REQUIRED',
    `the generated facade must carry its stable refusal through the trusted settle envelope: ${JSON.stringify(settledRawReference)}`,
  );
  const runQuery = runtimeHandler('todos.runQuery', '(ctx) => ctx.runQuery()', 'action');
  await assert.rejects(
    async () => runQuery(actionContext, {}),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_RUNQUERY_UNSUPPORTED',
  );
  const hostEffect = runtimeHandler('todos.fetch', '(ctx) => ctx.fetch({ url: "https://example.com" })', 'action');
  await assert.rejects(
    async () => hostEffect(actionContext, {}),
    ({ code }) => code === 'SNAPBACK_FAMILIAR_HOST_EFFECT_UNSUPPORTED',
  );
});

test('generation refuses unsupported familiar source and dynamic api references with stable codes', async () => {
  const atomicRoot = temporaryFamiliarFixture();
  const initial = await generate(atomicRoot);
  assert.equal(initial.ok, true, JSON.stringify(initial.diagnostics));
  const priorApi = readFileSync(join(atomicRoot, 'generated', 'api.mjs'), 'utf8');
  writeFileSync(
    join(atomicRoot, 'todos.ts'),
    readFileSync(join(atomicRoot, 'todos.ts'), 'utf8').replace(
      'reads: ["todos"],',
      'reads: ["todos"],\n  effects: [],',
    ),
  );
  const refusedAfterSuccess = await generate(atomicRoot);
  assert.equal(refusedAfterSuccess.ok, false);
  assert.equal(readFileSync(join(atomicRoot, 'generated', 'api.mjs'), 'utf8'), priorApi);

  const unsupportedRoot = temporaryFamiliarFixture();
  writeFileSync(
    join(unsupportedRoot, 'todos.ts'),
    readFileSync(join(unsupportedRoot, 'todos.ts'), 'utf8').replace(
      'reads: ["todos"],',
      'reads: ["todos"],\n  effects: [],',
    ),
  );
  const unsupported = await generate(unsupportedRoot);
  assert.equal(unsupported.ok, false);
  assert(unsupported.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_KEY_UNSUPPORTED',
  ));

  const dynamicRoot = temporaryFamiliarFixture();
  writeFileSync(
    join(dynamicRoot, 'todos.ts'),
    readFileSync(join(dynamicRoot, 'todos.ts'), 'utf8').replace(
      'api.todos.create;',
      'api.todos["create" + "dynamic"];',
    ),
  );
  const dynamic = await generate(dynamicRoot);
  assert.equal(dynamic.ok, false);
  assert(dynamic.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_FAMILIAR_API_REFERENCE_DYNAMIC',
  ));

  const escapingRecorderRoot = temporaryFamiliarFixture();
  writeFileSync(
    join(escapingRecorderRoot, 'todos.ts'),
    readFileSync(join(escapingRecorderRoot, 'todos.ts'), 'utf8').replace(
      '(q) => q.eq("completed", args.completed)',
      '(q) => { const escaped = q; return escaped.eq("completed", args.completed); }',
    ),
  );
  const escapingRecorder = await generate(escapingRecorderRoot);
  assert.equal(escapingRecorder.ok, false);
  assert(escapingRecorder.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_FAMILIAR_WITH_INDEX_UNSUPPORTED',
  ));

  const collisionRoot = mkdtempSync(join(tmpdir(), 'snapback-dotted-name-collision-'));
  temporaryRoots.push(collisionRoot);
  writeFileSync(join(collisionRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  // @ref LLP 0234#phase-g2--d2-enforcing-closure — this negative control has
  // only public operations; visibility must not preempt its name-collision diagnostic.
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(collisionRoot, 'functions.mjs'), `
import { defineQuery } from ${JSON.stringify(defineUrl)};
const dotted = defineQuery({ table: 'todos', args: {}, auth: 'public' });
const camel = defineQuery({ table: 'todos', args: {}, auth: 'public' });
export { dotted as "todos.list", camel as todosList };
`);
  const collision = await generate(collisionRoot);
  assert.equal(collision.ok, false);
  assert(collision.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_NAME_COLLISION',
  ));
});

test('Familiar bounded helper modules execute in the admitted handler graph and refuse escapes', async () => {
  const positiveRoot = temporaryFamiliarFixture();
  mkdirSync(join(positiveRoot, 'helpers'));
  writeFileSync(join(positiveRoot, 'helpers', 'title.ts'), `
export function trimTitle(value: string): string { return value.trim(); }
`);
  writeFileSync(
    join(positiveRoot, 'todos.ts'),
    readFileSync(join(positiveRoot, 'todos.ts'), 'utf8')
      .replace(
        'import { titleValidator } from "./contracts";',
        'import { titleValidator } from "./contracts";\nimport { trimTitle } from "./helpers/title";',
      )
      .concat(`
export const helperTitle = query({
  args: { title: v.string() },
  returns: v.string(),
  auth: "public",
  reads: ["todos"],
  handler: async (_ctx, args) => trimTitle(args.title),
});
`),
  );
  const positive = await generate(positiveRoot);
  assert.equal(positive.ok, true, JSON.stringify(positive.diagnostics));
  const helperOperation = readJson(join(positiveRoot, 'generated', 'functions.manifest.json'))
    .functions.find(({ name }) => name === 'todos.helperTitle');
  assert.match(helperOperation.runtime.IbexModule.source, /function trimTitle/u);

  const negativeRoot = temporaryFamiliarFixture();
  writeFileSync(
    join(negativeRoot, 'todos.ts'),
    readFileSync(join(negativeRoot, 'todos.ts'), 'utf8')
      .replace(
        'import { titleValidator } from "./contracts";',
        'import { titleValidator } from "./contracts";\nimport { trimTitle } from "../outside/title";',
      )
      .replace(
        'api.todos.create;',
        'api.todos.create; trimTitle("probe");',
      ),
  );
  const negative = await generate(negativeRoot);
  assert.equal(negative.ok, false);
  const refusal = negative.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_HELPER_IMPORT_UNAVAILABLE',
  );
  assert(refusal, JSON.stringify(negative.diagnostics));
  assert.match(refusal.message, /helper subdirectory.*import it relatively/u);
  assert.match(refusal.guideAnchor, /familiar-profile\.md#translate-the-familiar-handler-dialect/u);
  assert.equal(refusal.profileSwitchSuggestion, undefined);
});

test('familiar generation refuses a literal take beyond the relational ceiling', async () => {
  const root = temporaryFamiliarFixture();
  const sourcePath = join(root, 'todos.ts');
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace(
      '    .collect(),',
      '    .take(4096)\n    .collect(),',
    ),
  );
  const generated = await generate(root);
  assert.equal(generated.ok, false, 'an impossible Familiar query must not emit artifacts');
  const refusal = generated.diagnostics.find(({ code }) => (
    code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN'
  ));
  assert.ok(
    refusal,
    `expected a structured Familiar take-ceiling refusal: ${JSON.stringify(generated.diagnostics)}`,
  );
  assert.match(refusal.message, /take\(4096\).*relational take ceiling 1024/u);
  assert.equal(refusal.ceiling, 'relationalTake');
  assert.equal(refusal.limit, 1_024);
  assert.equal(refusal.observed, 4_096);
  assert.equal(refusal.sourceSpan.file, 'todos.ts');
});

test('LLP 0245 suggestions render familiar returns source and apply addition-only', async () => {
  const root = temporaryFamiliarFixture();
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const sourcePath = join(root, 'todos.ts');
  writeFileSync(
    sourcePath,
    readFileSync(sourcePath, 'utf8').replace('  returns: v.array(v.doc("todos")),\n', ''),
  );
  const result = suggestDeclarations({
    backendDir: root,
    definitionFile: 'todos.ts',
    operation: 'todos.list',
  });
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const suggestion = result.suggestions[0];
  assert.equal(suggestion.declaration.after, 'returns: v.array(v.doc("todos"))');
  assert.match(suggestion.patch.unifiedDiff, /\+  returns: v\.array\(v\.doc\("todos"\)\),/u);
  assert.doesNotMatch(suggestion.patch.unifiedDiff, /\+.*result:/u);
  const applied = applyDeclarationSuggestion(suggestion);
  assert.equal(applied.ok, true, JSON.stringify(applied.diagnostics));
  assert.match(readFileSync(sourcePath, 'utf8'), /returns: v\.array\(v\.doc\("todos"\)\)/u);
  assert.equal((await generate(root)).ok, true);
});
