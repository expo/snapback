// Todo demo — Contract/Exact acceptance (run with bun; imports Exact TS source).
//
// @ref LLP 0010#first-contractexact-fixture — the same todo app expressed through
//   the current Exact default path: a .contract surface with a contract block and
//   stable testId handles, consuming generated Snapback artifacts, validated
//   through Exact's structured tree against the same backend facts headless reports.
// @ref LLP 0012#validation-requirements — one generated Snapback app consumed by
//   two surfaces; a mutation from one surface updates data observed by the other;
//   tsc/compile is honest (green means resolvable, typed artifacts).
// @ref LLP 0015#exact-dependency-policy — if Exact's capability is absent, the
//   Contract surface is an explicit expected-missing skip with a structured
//   diagnostic, never a silent pass.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { resolveExact, exactModulePaths } from '../../../_kit/exact-resolver.mjs';
import {
  createSnapbackContractSurface,
  validateSnapbackContractArtifacts,
} from '../../../../packages/snapback-contract/index.mjs';
import { assert, assertEqual, createSuite } from '../../../_kit/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const contractDir = join(here, '..', '..', 'surfaces', 'contract');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const demoManifest = JSON.parse(readFileSync(join(here, '..', '..', 'demo.snapback.json'), 'utf8'));

const ADA = 'user_ada';
const artifactIndex = gen('artifacts.json');
const schemaManifest = gen('schema.manifest.json');
const functionsManifest = gen('functions.manifest.json');
const contractDataManifest = gen('contract-data.manifest.json');

// --- Resolve Exact (capability-probed) --------------------------------------
const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  const report = {
    title: 'todo / contract',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    requirement: expected.requirement,
    expectedDiagnostic: expected.expectedDiagnostic,
    diagnostics: exact.diagnostics,
  };
  console.log(JSON.stringify(report, null, 2));
  // A valid skip per LLP 0015: surface is expected_missing and the emitted code
  // matches the manifest's expected missing-capability code.
  const valid =
    ['optional', 'expected_missing', 'blocked'].includes(expected.requirement) &&
    expected.expectedDiagnostic === 'SNAPBACK_CAPABILITY_EXACT_MISSING';
  console.log(valid ? '\nSKIP (valid, expected_missing): todo / contract' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path} (commit ${exact.commit ?? 'n/a'})`);
console.log(`  capabilities: ${JSON.stringify(exact.capabilities)}`);

const paths = exactModulePaths(exact.path);
const compilerMod = await import(pathToFileURL(paths.compiler).href);
const runtimeMod = await import(pathToFileURL(paths.runtime).href);

const importSemantics = {
  listTodos: { kind: 'query', reads: ['todos'], readMode: 'sync' },
  createTodo: { kind: 'mutation', effects: ['todos.write'], invalidates: ['todos'] },
  setCompleted: { kind: 'mutation', effects: ['todos.write'], invalidates: ['todos'] },
  deleteTodo: { kind: 'mutation', effects: ['todos.write'], invalidates: ['todos'] },
};

// --- Live backend ------------------------------------------------------------
const server = await startServer({ port: 4401, db: ':memory:', cwd: repoRoot });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('todo / contract');

const collectByTestId = (root, testId) => {
  const out = [];
  const walk = (n) => {
    if (n.text !== undefined) return;
    const props = n.originalProps ?? {};
    if (props.testId === testId || props.testID === testId) out.push(n);
    for (const c of n.children ?? []) walk(c);
  };
  for (const c of root.children ?? []) walk(c);
  return out;
};
const textUnder = (node) => {
  const out = [];
  const walk = (n) => { if (n.text !== undefined) out.push(n.text); for (const c of n.children ?? []) walk(c); };
  walk(node);
  return out.join('');
};
const settle = async () => { await new Promise((r) => setTimeout(r, 0)); await new Promise((r) => setTimeout(r, 0)); };

try {
  await db.loadSchema(schemaManifest);
  await db.loadFunctions(functionsManifest);
  await db.reset();
  await db.seed(JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8')));

  let compiled;
  await suite.check('the .contract compiles against generated descriptors (honest compile)', async () => {
    const source = readFileSync(join(contractDir, 'todo.contract'), 'utf8');
    const { file, diagnostics } = compilerMod.compileContractSource(source, 'todo.contract', {
      importBoundaryMode: 'project',
      importSemantics,
    });
    const errors = diagnostics.filter((d) => d.severity === 'error');
    assertEqual(errors, [], `compile errors: ${JSON.stringify(errors)}`);
    compiled = file;
    const component = file.components[0];
    return { queries: component.queries.map((q) => q.name), mutations: component.mutations.map((m) => m.name) };
  });

  await suite.check('contract bindings resolve to generated Snapback descriptors', async () => {
    // The `use X from` import names ARE the generated descriptor names.
    const source = readFileSync(join(contractDir, 'todo.contract'), 'utf8');
    const used = [...source.matchAll(/^use (\w+) from/gm)].map((m) => m[1]);
    for (const name of ['listTodos', 'createTodo', 'setCompleted', 'deleteTodo']) {
      assert(used.includes(name), `missing ${name} import`);
      assert(source.includes(`../../snapback/generated/contract/${name}.`), `${name} does not import generated Contract module`);
    }
    const localDataDir = join(contractDir, 'data');
    const localBindingFiles = existsSync(localDataDir)
      ? readdirSync(localDataDir).filter((name) => name.endsWith('.contract-meta.ts') || name.endsWith('.query.ts') || name.endsWith('.mutation.ts'))
      : [];
    assertEqual(localBindingFiles, [], 'demo-local Contract sidecars should be gone');
    assert(contractDataManifest.queries.listTodos, 'generated manifest lacks listTodos query');
    assert(contractDataManifest.mutations.createTodo, 'generated manifest lacks createTodo mutation');
    assert(contractDataManifest.mutations.setCompleted, 'generated manifest lacks setCompleted mutation');
    assert(contractDataManifest.mutations.deleteTodo, 'generated manifest lacks deleteTodo mutation');
    assertEqual(contractDataManifest.queries.listTodos.subscription, 'initial-snapshot', 'listTodos not syncable-live');
    return { used, provider: contractDataManifest.provider, localBindingFiles };
  });

  await suite.check('stale Contract data manifest produces a structured diagnostic', async () => {
    const staleManifest = { ...contractDataManifest, inputsHash: 'stale-contract-data' };
    const diagnostics = validateSnapbackContractArtifacts({
      manifest: staleManifest,
      artifactIndex,
      schemaManifest,
      functionManifest: functionsManifest,
    });
    const diagnostic = diagnostics.find((d) => d.code === 'SNAPBACK_STALE_CONTRACT_DATA_INPUTS_HASH');
    assert(diagnostic, `expected stale inputs hash diagnostic, got ${JSON.stringify(diagnostics)}`);
    assertEqual(diagnostic.details.target_surface, 'Contract/Exact', 'target surface');
    assertEqual(diagnostic.details.expectedInputsHash, artifactIndex.inputsHash, 'expected inputs hash');
    assertEqual(diagnostic.details.actualInputsHash, 'stale-contract-data', 'actual inputs hash');
    return { code: diagnostic.code, target_surface: diagnostic.details.target_surface };
  });

  let surface;
  let handle;
  await suite.check('mounts against the live Snapback backend; renders the live snapshot', async () => {
    surface = await createSnapbackContractSurface({
      runtime: runtimeMod,
      client: db,
      userId: ADA,
      manifest: contractDataManifest,
      artifactIndex,
      schemaManifest,
      functionManifest: functionsManifest,
    });
    const component = runtimeMod.defineComponent(compiled, surface.links);
    handle = surface.mount(component);
    await settle();
    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assertEqual(items, ['Read the Snapback explainer', 'Build the todo demo', 'Write the diary'], 'rendered live rows');
    assertEqual(collectByTestId(handle.container, 'todos-empty').length, 0, 'should not be empty');
    return { items };
  });

  await suite.check('Contract action drives a Snapback mutation; tree updates optimistically', async () => {
    const input = collectByTestId(handle.container, 'todo-input')[0];
    const add = collectByTestId(handle.container, 'todo-add')[0];
    assert(input && add, 'input/button not found');
    const props = input.originalProps ?? {};
    const changeFn = props.onChange ?? props.onChangeText ?? props.change;
    assert(typeof changeFn === 'function', `no change handler on input (keys: ${Object.keys(props)})`);
    changeFn('Ship the Contract surface');
    const press = (add.originalProps ?? {}).onPress;
    assert(typeof press === 'function', 'no press handler on button');
    press();
    await settle();
    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assert(items.includes('Ship the Contract surface'), `optimistic row missing: ${JSON.stringify(items)}`);
    return { items, pending: surface.pendingCount() };
  });

  await suite.check('mutation is server-authoritative and visible to the headless surface (cross-surface)', async () => {
    await surface.flush(); // await server persist
    // A *different* surface (headless client) reads the SAME backend.
    const headlessRows = (await db.query('listTodos', { userId: ADA })).rows.map((r) => r.title);
    assert(headlessRows.includes('Ship the Contract surface'), `cross-surface row missing: ${JSON.stringify(headlessRows)}`);
    // The Contract tree now shows the authoritative (non-optimistic) row set.
    await settle();
    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assertEqual(items.length, 4, 'authoritative count');
    return { headlessRows, contractItems: items };
  });

  await suite.check('Contract actions toggle completion and delete through Snapback mutations', async () => {
    await surface.flush();
    const beforeRows = (await db.query('listTodos', { userId: ADA })).rows;
    const target = beforeRows.find((row) => row.completed === false);
    assert(target, 'no incomplete row to toggle/delete');

    const toggle = collectByTestId(handle.container, `todo-toggle-${target._id}`)[0];
    assert(toggle, `toggle button missing for ${target._id}`);
    const togglePress = (toggle.originalProps ?? {}).onPress;
    assert(typeof togglePress === 'function', 'toggle has no press handler');
    togglePress();
    await settle();
    assertEqual(textUnder(collectByTestId(handle.container, `todo-status-${target._id}`)[0]), '✓', 'optimistic completed status');

    await surface.flush();
    const completedRows = (await db.query('listTodos', { userId: ADA })).rows;
    assertEqual(completedRows.find((row) => row._id === target._id)?.completed, true, 'server completion state');

    const del = collectByTestId(handle.container, `todo-delete-${target._id}`)[0];
    assert(del, `delete button missing for ${target._id}`);
    const deletePress = (del.originalProps ?? {}).onPress;
    assert(typeof deletePress === 'function', 'delete has no press handler');
    deletePress();
    await settle();
    assertEqual(collectByTestId(handle.container, `todo-row-${target._id}`).length, 0, 'optimistic row removal');

    await surface.flush();
    const afterRows = (await db.query('listTodos', { userId: ADA })).rows;
    assert(!afterRows.some((row) => row._id === target._id), 'deleted row still on server');
    return { toggledAndDeleted: target._id, remaining: afterRows.length };
  });

  await suite.check('provider seam: subscribe ready cell + provider.mutate on live backend', async () => {
    const cells = [];
    const sub = surface.provider.subscribe('listTodos', {}, (cell) => cells.push(cell));
    assert(cells[0]?.status === 'ready', 'no initial ready cell');
    const before = cells[0].value.length;
    const result = await surface.provider.mutate('createTodo', { title: 'Via provider seam' });
    assertEqual(result, { ok: true }, 'provider mutate failed');
    assert(cells.at(-1).value.length === before + 1, 'cell did not grow after mutate');
    const added = cells.at(-1).value.at(-1);
    const completed = await surface.provider.mutate('setCompleted', { id: added._id, completed: true });
    assertEqual(completed, { ok: true }, 'provider setCompleted failed');
    assert(cells.at(-1).value.find((row) => row._id === added._id)?.completed === true, 'provider completion not reflected');
    const deleted = await surface.provider.mutate('deleteTodo', { id: added._id });
    assertEqual(deleted, { ok: true }, 'provider deleteTodo failed');
    assert(!cells.at(-1).value.some((row) => row._id === added._id), 'provider deletion not reflected');
    sub.dispose();
    const headless = (await db.query('listTodos', { userId: ADA })).rows.map((r) => r.title);
    assert(!headless.includes('Via provider seam'), 'provider deletion not persisted');
    return { cells: cells.length };
  });

  surface?.dispose?.();
  runtimeMod.reset();
  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify({ ...report, exact: { sourceKind: exact.sourceKind, commit: exact.commit } }));
  await server.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('contract acceptance crashed:', error);
  await server.stop();
  process.exit(2);
}
