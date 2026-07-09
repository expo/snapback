// Todo v2 — Contract/Exact acceptance (run with bun; imports Exact TS source).
//
// @ref LLP 0015#exact-dependency-policy — if Exact's capability is absent, the
//   Contract surface is an explicit expected-missing skip with a structured
//   diagnostic, never a silent pass.
// @ref LLP 0021#phase-2-ship-the-snapback-contract-adapter — v2 verifies the
//   adapter exposes the full generated mutation set, including setPriority.

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { SnapbackClient } from '../../../_kit/client.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import { resolveExact } from '../../../_kit/exact-resolver.mjs';
import {
  createSnapbackContractSurface,
  validateSnapbackContractArtifacts,
} from '../../../../packages/snapback-contract/index.mjs';
import {
  importExactContractCompiler,
  importExactContractRuntime,
} from '../../../../packages/snapback-contract/exact-package.mjs';
import {
  checkSnapbackContractDescriptors,
} from '../../../../packages/snapback-contract/exact-project-check.mjs';
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

const exact = resolveExact({ repoRoot });
if (exact.sourceKind === 'missing') {
  const expected = demoManifest.surfaces.contract;
  const report = {
    title: 'todo-v2 / contract',
    skipped: true,
    reason: 'SNAPBACK_CAPABILITY_EXACT_MISSING',
    requirement: expected.requirement,
    expectedDiagnostic: expected.expectedDiagnostic,
    diagnostics: exact.diagnostics,
  };
  console.log(JSON.stringify(report, null, 2));
  const valid =
    ['optional', 'expected_missing', 'blocked'].includes(expected.requirement) &&
    expected.expectedDiagnostic === 'SNAPBACK_CAPABILITY_EXACT_MISSING';
  console.log(valid ? '\nSKIP (valid, expected_missing): todo-v2 / contract' : '\nFAIL: unexpected missing capability');
  process.exit(valid ? 0 : 1);
}

console.log(`Exact resolved via ${exact.sourceKind}@${exact.path} (commit ${exact.commit ?? 'n/a'})`);
console.log(`  capabilities: ${JSON.stringify(exact.capabilities)}`);

const compilerMod = await importExactContractCompiler({ exactRoot: exact.path });
const runtimeMod = await importExactContractRuntime({ exactRoot: exact.path });

const server = await startServer({ port: 4404, db: ':memory:', cwd: repoRoot,
  provenance: { appId: 'todo-v2', artifactsPath: join(repoRoot, 'demos', 'todo-v2', 'snapback', 'generated', 'artifacts.json') } });
const db = new SnapbackClient(server.baseUrl);
const suite = createSuite('todo-v2 / contract');

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
    const contractFile = join(contractDir, 'todo.contract');
    const projectCheck = checkSnapbackContractDescriptors({
      compiler: compilerMod,
      runtime: runtimeMod,
      contractFile,
      manifest: contractDataManifest,
      expectedInputsHash: artifactIndex.inputsHash,
      exactRoot: exact.path,
    });
    const { file, diagnostics } = projectCheck.compiled;
    const allDiagnostics = [
      ...projectCheck.staticSemantics.diagnostics,
      ...diagnostics,
      ...projectCheck.doctorReport.diagnostics,
    ];
    const errors = allDiagnostics.filter((d) => d.severity === 'error');
    assertEqual(errors, [], `compile errors: ${JSON.stringify(errors)}`);
    compiled = file;
    const component = file.components[0];
    return {
      queries: component.queries.map((q) => q.name),
      mutations: component.mutations.map((m) => m.name),
      descriptorUses: projectCheck.descriptorUses,
    };
  });

  await suite.check('Exact row-shape analysis catches generated descriptor field mistakes', async () => {
    const contractFile = join(contractDir, 'todo.contract');
    const source = readFileSync(contractFile, 'utf8').replace('todo.priority', 'todo.notAField');
    const parsed = compilerMod.parseContractSource(source, contractFile);
    const staticSemantics = compilerMod.resolveStaticContractImportSemantics(parsed, { rootDir: exact.path });
    const { diagnostics } = compilerMod.compileContractSource(source, contractFile, {
      diagnosticsMode: 'accumulate',
      importBoundaryMode: 'project',
      importSemantics: staticSemantics.descriptors,
    });
    const diagnostic = diagnostics.find((entry) => entry.code === 'shape_unknown_member');
    assert(diagnostic, `expected shape_unknown_member, got ${JSON.stringify(diagnostics)}`);
    return { code: diagnostic.code, message: diagnostic.message };
  });

  await suite.check('contract bindings resolve to generated Snapback descriptors', async () => {
    const source = readFileSync(join(contractDir, 'todo.contract'), 'utf8');
    const used = [...source.matchAll(/^use (\w+) from/gm)].map((m) => m[1]);
    for (const name of ['listTodos', 'createTodo', 'setCompleted', 'setPriority', 'deleteTodo']) {
      assert(used.includes(name), `missing ${name} import`);
      assert(source.includes(`../../snapback/generated/contract/${name}.`), `${name} does not import generated Contract module`);
    }
    const localDataDir = join(contractDir, 'data');
    const localBindingFiles = existsSync(localDataDir)
      ? readdirSync(localDataDir).filter((name) => name.endsWith('.contract-meta.ts') || name.endsWith('.query.ts') || name.endsWith('.mutation.ts'))
      : [];
    assertEqual(localBindingFiles, [], 'demo-local Contract sidecars should be gone');
    assert(contractDataManifest.queries.listTodos, 'generated manifest lacks listTodos query');
    for (const name of ['createTodo', 'setCompleted', 'setPriority', 'deleteTodo']) {
      assert(contractDataManifest.mutations[name], `generated manifest lacks ${name} mutation`);
    }
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
  await suite.check('adapter exposes generated runtime links, including setPriority', async () => {
    surface = await createSnapbackContractSurface({
      queryName: 'listTodos',
      boundaryKey: 'todos',
      // Derived overlays (Exact LLP 0329 E-B): no hand reducers — the
      // optimistic assertions below ride the plan-derived defaults.
      runtime: runtimeMod,
      client: db,
      userId: ADA,
      manifest: contractDataManifest,
      artifactIndex,
      schemaManifest,
      functionManifest: functionsManifest,
    });
    assert(surface.declaredMutations.includes('setPriority'), 'manifest mutation set missing setPriority');
    assert(typeof surface.links.setPriority === 'function', 'runtime links missing setPriority');
    return { declaredMutations: surface.declaredMutations };
  });

  await suite.check('mounts against the live Snapback backend; renders priority snapshot', async () => {
    const component = runtimeMod.defineComponent(compiled, surface.links);
    handle = surface.mount(component);
    await settle();
    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assertEqual(items, ['Read the Snapback explainer', 'Build Todo v2', 'Record LLP 0021 notes'], 'rendered live rows');
    assertEqual(textUnder(collectByTestId(handle.container, 'todo-priority-seed_todo_2')[0]), 'high', 'seed priority');
    return { items };
  });

  await suite.check('Contract UI disables empty-title submits', async () => {
    const input = collectByTestId(handle.container, 'todo-input')[0];
    assert(input, 'input not found');
    const changeFn = (input.originalProps ?? {}).onChange ?? (input.originalProps ?? {}).onChangeText ?? (input.originalProps ?? {}).change;
    assert(typeof changeFn === 'function', 'no change handler on input');
    changeFn('   ');
    await settle();
    const add = collectByTestId(handle.container, 'todo-add')[0];
    assert(add, 'add button not found');
    assertEqual((add.originalProps ?? {}).disabled, true, 'empty title must disable submit');
  });

  await suite.check('Contract action drives createTodo with priority; tree updates optimistically', async () => {
    const input = collectByTestId(handle.container, 'todo-input')[0];
    const high = collectByTestId(handle.container, 'draft-priority-high')[0];
    const add = collectByTestId(handle.container, 'todo-add')[0];
    assert(input && high && add, 'input/priority/button not found');
    const changeFn = (input.originalProps ?? {}).onChange ?? (input.originalProps ?? {}).onChangeText ?? (input.originalProps ?? {}).change;
    assert(typeof changeFn === 'function', 'no change handler on input');
    changeFn('Ship Todo v2 from Contract');
    const highPress = (high.originalProps ?? {}).onPress;
    assert(typeof highPress === 'function', 'no high-priority press handler');
    highPress();
    const addPress = (add.originalProps ?? {}).onPress;
    assert(typeof addPress === 'function', 'no add press handler');
    addPress();
    await settle();
    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assert(items.includes('Ship Todo v2 from Contract'), `optimistic row missing: ${JSON.stringify(items)}`);
    return { items, pending: surface.pendingCount() };
  });

  await suite.check('created priority is server-authoritative and visible to headless surface', async () => {
    await surface.flush();
    const rows = (await db.query('listTodos', { userId: ADA })).rows;
    const created = rows.find((row) => row.title === 'Ship Todo v2 from Contract');
    assert(created, 'created row missing from server');
    assertEqual(created.priority, 'high', 'server priority');
    await settle();
    return { id: created._id, priority: created.priority };
  });

  await suite.check('Contract actions toggle completion, reprioritize, and delete through Snapback', async () => {
    await surface.flush();
    const beforeRows = (await db.query('listTodos', { userId: ADA })).rows;
    const target = beforeRows.find((row) => row.completed === false && row.priority !== 'high');
    assert(target, 'no incomplete non-high row to exercise');

    const toggle = collectByTestId(handle.container, `todo-toggle-${target._id}`)[0];
    assert(toggle, `toggle button missing for ${target._id}`);
    const togglePress = (toggle.originalProps ?? {}).onPress;
    assert(typeof togglePress === 'function', 'toggle has no press handler');
    togglePress();
    await settle();
    assertEqual(textUnder(collectByTestId(handle.container, `todo-status-${target._id}`)[0]), '✓', 'optimistic completed status');

    const priority = collectByTestId(handle.container, `todo-priority-high-${target._id}`)[0];
    assert(priority, `priority button missing for ${target._id}`);
    const priorityPress = (priority.originalProps ?? {}).onPress;
    assert(typeof priorityPress === 'function', 'priority has no press handler');
    priorityPress();
    await settle();
    assertEqual(textUnder(collectByTestId(handle.container, `todo-priority-${target._id}`)[0]), 'high', 'optimistic priority');

    await surface.flush();
    const changedRows = (await db.query('listTodos', { userId: ADA })).rows;
    const changed = changedRows.find((row) => row._id === target._id);
    assertEqual(changed?.completed, true, 'server completion state');
    assertEqual(changed?.priority, 'high', 'server priority state');

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
    return { toggledReprioritizedAndDeleted: target._id, remaining: afterRows.length };
  });

  await suite.check('provider seam: subscribe ready cell + provider.mutate priority on live backend', async () => {
    const cells = [];
    const sub = surface.provider.subscribe('listTodos', {}, (cell) => cells.push(cell));
    assert(cells[0]?.status === 'ready', 'no initial ready cell');
    const before = cells[0].value.length;
    const result = await surface.provider.mutate('createTodo', { title: 'Via v2 provider', priority: 'normal' });
    assertEqual(result, { ok: true }, 'provider mutate failed');
    assert(cells.at(-1).value.length === before + 1, 'cell did not grow after mutate');
    const added = cells.at(-1).value.at(-1);
    const priority = await surface.provider.mutate('setPriority', { id: added._id, priority: 'low' });
    assertEqual(priority, { ok: true }, 'provider setPriority failed');
    assert(cells.at(-1).value.find((row) => row._id === added._id)?.priority === 'low', 'provider priority not reflected');
    const deleted = await surface.provider.mutate('deleteTodo', { id: added._id });
    assertEqual(deleted, { ok: true }, 'provider deleteTodo failed');
    assert(!cells.at(-1).value.some((row) => row._id === added._id), 'provider deletion not reflected');
    sub.dispose();
    return { cells: cells.length };
  });

  await suite.check('server-authored delta reaches the Contract boundary with no local mutation (LLP 0034 D1/C1)', async () => {
    // The C1 fix (Exact LLP 0284 §5.3): another client's write must reach this
    // surface's boundary through the paved adapter — no local mutation, no
    // hand-written pump. Pre-D1 the adapter was reconcile-on-mutate only and
    // this check would hang forever.
    assert(surface.livePush === true, 'surface should bind listTodos with livePush (manifest v2 mode:"live")');
    const title = 'Authored by another client (C1)';
    const cells = [];
    let resolveArrival;
    const arrival = new Promise((resolve) => { resolveArrival = resolve; });
    const sub = surface.provider.subscribe('listTodos', {}, (cell) => {
      cells.push(cell);
      if (cell.status === 'ready' && cell.value.some((row) => row.title === title)) resolveArrival(cell);
    });
    try {
      assert(cells[0]?.status === 'ready', 'no initial ready cell');
      assert('connection' in cells[0], 'live-bound cell should carry the connection axis (Exact LLP 0284 §2.2)');
      const otherClient = new SnapbackClient(server.baseUrl);
      await otherClient.mutate('createTodo', { args: { title, priority: 'normal' }, userId: ADA });
      const timeout = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('server-authored delta never reached the Contract boundary')), 5_000).unref?.();
      });
      const cell = await Promise.race([arrival, timeout]);
      assert(cell.value.some((row) => row.title === title), 'pushed row missing from boundary cell');
      await settle();
      const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
      assert(items.includes(title), `pushed row missing from mounted tree: ${JSON.stringify(items)}`);
      return { connection: cell.connection, cells: cells.length };
    } finally {
      sub.dispose();
    }
  });

  await suite.check('rejected runtime-link mutation surfaces diagnostic and authoritative rows', async () => {
    await surface.flush();
    const title = 'Rejected missing priority from Contract';
    const task = surface.links.createTodo({ title });

    let rejected = null;
    try {
      await task;
    } catch (error) {
      rejected = error;
    }
    assert(rejected, 'expected createTodo without priority to reject');
    await settle();

    const items = collectByTestId(handle.container, 'todo-item').map(textUnder);
    assert(!items.includes(title), `rejected optimistic row was not rolled back: ${JSON.stringify(items)}`);
    const rows = (await db.query('listTodos', { userId: ADA })).rows;
    assert(!rows.some((row) => row.title === title), 'rejected row persisted on server');
    const diagnostic = surface.diagnostics.find(
      (entry) => entry.code === 'SNAPBACK_CONTRACT_MUTATION_FAILED' && entry.details?.mutation === 'createTodo',
    );
    assert(diagnostic, `missing rejected mutation diagnostic: ${JSON.stringify(surface.diagnostics)}`);
    assertEqual(surface.pendingCount(), 0, 'pending count after rejected mutation');
    return { diagnostic: diagnostic.code, message: rejected.message };
  });

  await suite.check('adapter exposes one combined pending mutation count', async () => {
    const gate = createMutationGate(db);
    const pendingSurface = await createSnapbackContractSurface({
      queryName: 'listTodos',
      boundaryKey: 'todos',
      // Derived overlays (Exact LLP 0329 E-B): no hand reducers — the
      // optimistic assertions below ride the plan-derived defaults.
      runtime: runtimeMod,
      client: gate.client,
      userId: ADA,
      manifest: contractDataManifest,
      artifactIndex,
      schemaManifest,
      functionManifest: functionsManifest,
    });

    try {
      const linkTask = pendingSurface.links.setPriority({ id: 'seed_todo_1', priority: 'low' });
      const providerTask = pendingSurface.provider.mutate('setPriority', { id: 'seed_todo_2', priority: 'normal' });
      assertEqual(gate.pendingCount(), 2, 'held server mutations');
      assertEqual(pendingSurface.pendingCount(), 2, 'combined pending count while held');
      await gate.releaseAll();
      await Promise.all([linkTask, providerTask]);
      assertEqual(pendingSurface.pendingCount(), 0, 'combined pending count after release');
      return { heldMutations: 2 };
    } finally {
      pendingSurface.dispose();
    }
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

function createMutationGate(client) {
  const pending = [];
  return {
    client: {
      query: (...args) => client.query(...args),
      mutate: (...args) =>
        new Promise((resolve, reject) => {
          pending.push({ args, resolve, reject });
        }),
    },
    pendingCount: () => pending.length,
    async releaseAll() {
      while (pending.length > 0) {
        const job = pending.shift();
        try {
          job.resolve(await client.mutate(...job.args));
        } catch (error) {
          job.reject(error);
        }
      }
    },
  };
}
