import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import {
  CLIENT_COMPATIBILITY_ALIASES,
  renderReferenceJSDoc,
} from './client-lifecycle.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function backend() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-client-lifecycle-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).sync() });
`);
  writeFileSync(join(root, 'functions.mjs'), `
import { defineAction, defineCommand, defineJsLiveQuery, defineJsMutation, defineJsQuery, v } from '${defineUrl}';
export const readTodos = defineJsQuery({ args: {}, reads: ['todos'], handler: async (ctx) => ctx.db.query('todos').collect() });
export const watchTodos = defineJsLiveQuery({ args: {}, reads: ['todos'], handler: async (ctx) => ctx.db.query('todos').collect() });
export const createTodo = defineJsMutation({ args: { title: v.string() }, writes: ['todos'], handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }) });
export const rebuildTodos = defineAction({ args: {}, handler: async () => null });
export const createTodoCommand = defineCommand({ mutation: createTodo });
`);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('manifest vocabulary, generated types, and JSDoc share one lifecycle projection', async () => {
  const root = backend();
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const manifest = JSON.parse(readFileSync(join(root, 'generated', 'client-lifecycle.v1.json'), 'utf8'));
  const apiTypes = readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8');
  const appTypes = readFileSync(join(root, 'generated', 'app.d.ts'), 'utf8');
  const envelope = JSON.parse(readFileSync(join(root, 'generated', 'api-envelope.members.json'), 'utf8'));

  assert.equal(manifest.schemaVersion, 'snapback.client-lifecycle.v1');
  assert.deepEqual(manifest.surfaceFamilies, ['query', 'liveQuery', 'mutate', 'action', 'commands']);
  assert.deepEqual(
    manifest.mutationSettlement.dispositions,
    ['pending', 'settled', 'failed', 'stranded', 'quarantined', 'resultGone', 'unknown'],
  );
  assert.equal(manifest.custody.consumer, 'developer-tooling');
  assert.equal(manifest.custody.storageClass, 'regenerable-cache');
  assert.equal(manifest.futureClassM.snapshotVersionMeaning, 'authorized principal/query viewRevision');
  assert.deepEqual(manifest.compatibilityAliases, CLIENT_COMPATIBILITY_ALIASES);
  assert.deepEqual(
    manifest.compatibilityAliases.map(({ current, plannedCanonical }) => [current, plannedCanonical]),
    [
      ['useSnapbackQuery', 'useSnapbackLiveQuery'],
      ['useSnapbackMutation', 'useSnapbackMutationDispatch'],
      ['useSnapbackOutbox().mutationStatus', 'useSnapbackMutationStatus'],
      ['useSnapbackCommand', 'useSnapbackTask'],
      ['client.query', 'client.read'],
    ],
  );
  assert.equal(manifest.compatibilityAliases[0].emittedInRollout1, false);
  assert.equal(manifest.compatibilityAliases[0].removalEpoch, 'declared-major-after-stage-2-measurement');
  assert.equal(manifest.commands.length, 1);
  assert.equal(manifest.commands[0].semanticIdentity, `${manifest.appId}:command:createTodoCommand`);

  for (const operation of manifest.operations) {
    const start = apiTypes.indexOf(`reference \`${operation.semanticIdentity}\``);
    assert.notEqual(start, -1, operation.semanticIdentity);
    const declaration = apiTypes.slice(start, start + 1_000);
    for (const verb of operation.legalVerbs) {
      assert.ok(declaration.includes(`\`${verb}\``), `${operation.semanticIdentity} omits ${verb}`);
    }
    assert.match(declaration, /required capabilities:/u);
    assert.match(declaration, /headless\.md#generated-reference-kinds/u);
    assert.ok(envelope.declarations.appBindings.includes(operation.semanticIdentity));
  }
  assert.match(apiTypes, /readonly __snapbackReferenceKind: Kind;/u);
  for (const alias of ['QueryRef', 'LiveQueryRef', 'MutationRef', 'ActionRef']) {
    assert.ok(apiTypes.includes(`export type ${alias}<`));
  }
  assert.match(appTypes, /readonly __snapbackReferenceKind: 'Command';/u);
  assert.ok(appTypes.includes(`Command reference \`${manifest.appId}:command:createTodoCommand\``));
  assert.ok(appTypes.includes('`commandClient.start`'));
  assert.ok(appTypes.includes('`useSnapbackCommand`'));
  const readReference = manifest.operations.find(({ name }) => name === 'readTodos');
  assert.match(
    renderReferenceJSDoc(
      { kind: 'Query', id: readReference.semanticIdentity, name: readReference.name },
      manifest,
      'snapback-familiar-ts-v1',
    ),
    /call `client\.query` \(planned `client\.read`\)/u,
  );
  const mutationReference = manifest.operations.find(({ name }) => name === 'createTodo');
  const mutationJSDoc = renderReferenceJSDoc(
    { kind: 'Mutation', id: mutationReference.semanticIdentity, name: mutationReference.name },
    manifest,
    'snapback-familiar-ts-v1',
  );
  assert.match(mutationJSDoc, /settled-only \(`queue:false`\)/u);
  assert.match(mutationJSDoc, /`useSnapbackMutationDispatch` \+ `useSnapbackMutationStatus`/u);
  const record = generated.artifactIndex.files.find(({ path }) => path === 'client-lifecycle.v1.json');
  assert.equal(record.logicalKind, 'client-lifecycle');
  assert.equal(record.consumer, 'developer-tooling');
  assert.equal(record.custody, 'regenerable-cache');
});
