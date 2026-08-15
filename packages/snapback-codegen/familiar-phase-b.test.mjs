import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
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

test('familiar returns lowering implements every r3 success row and total refusals', () => {
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
  assert.equal(lowerFamiliarReturns('mutation', v.doc('todos')).kind, 'document');
  assert.equal(lowerFamiliarReturns('action', v.array(v.string())).kind, 'value');

  for (const validator of [
    v.string(),
    v.id('todos'),
    v.doc('todos'),
    v.object({ value: v.string() }),
    v.array(v.string()),
    v.array(v.id('todos')),
    v.array(v.doc('todos'), { maxItems: 1 }),
    v.tuple([v.doc('todos')]),
  ]) {
    assert.throws(
      () => lowerFamiliarReturns('query', validator),
      ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
    );
  }
  assert.throws(
    () => lowerFamiliarReturns('query', v.union([v.doc('todos'), v.null()])),
    (error) => error.code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE'
      && /canonical queries are list-shaped/u.test(error.message),
  );
  assert.throws(
    () => lowerFamiliarReturns('mutation', v.array(v.doc('todos'))),
    ({ code }) => code === 'SNAPBACK_CODEGEN_FAMILIAR_RETURNS_UNLOWERABLE',
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
    'sha256:6f55125e4b2dba403af01ec949afe11477ad3a2557ec1ab61f7f69656e040d33',
  );
  assert.equal(
    familiar.identities.normalizedSchemaId,
    'sha256:d0cbc1c39f98ca5a530a9d17124cd439be23dc61d3365d6cf511cfef63d731fb',
  );

  const familiarOutput = join(familiarFixture, 'generated');
  const explicitOutput = join(explicitFixture, 'generated');
  for (const name of ['server.mjs', 'server.d.ts', 'api.mjs', 'api.d.ts']) {
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
export default defineSchema({ todos: defineTable({ title: v.string() }) });
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
