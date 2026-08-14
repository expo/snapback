import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { DATA_TRANSACTION_CEILINGS } from './data-transaction.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

function fixture(transactionSource) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-data-transaction-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), title: v.string(), done: v.boolean() })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner_done', ['ownerId', 'done'])
    .data(),
  notes: defineTable({ ownerId: v.principal(), body: v.string() })
    .visibility({ kind: 'owner', field: 'ownerId' })
    .index('by_owner', ['ownerId'])
    .data(),
});
`);
  writeFileSync(join(root, 'functions.mjs'), 'export const nothing = 0;\n');
  writeFileSync(join(root, 'transactions.ts'), transactionSource);
  return root;
}

test('one chunk resolves to the exact ordinary generated mutation and enters semantic identity', async () => {
  const result = await generate(fixture(`
declare const db: any;
db.transact(db.tx.todos.create({ title: 'a', done: false }));
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.dataTransactions.length, 1);
  const [transaction] = result.dataTransactions;
  assert.equal(transaction.core.format, 'snapback.normalized-data-transaction.v1');
  assert.equal(transaction.resolution.kind, 'chunk-mutation');
  assert.equal(transaction.resolution.exportedName, 'todos.create');
  assert.equal(transaction.functionReference.name, 'todos.create');
  assert.deepEqual(transaction.chunkFunctionReferences.map(({ name }) => name), ['todos.create']);
  assert.deepEqual(result.semanticInput.dataSurface.transactionCatalog, [{
    id: transaction.normalizedDataTransactionId,
    core: transaction.core,
  }]);
  assert.deepEqual(transaction.core.ceilings, DATA_TRANSACTION_CEILINGS);
});

test('multi-chunk lowering emits one atomic ordinary HostPlan with renamed bindings and closed results', async () => {
  const result = await generate(fixture(`
declare const db: any;
db.transact(
  db.tx.todos.create({ title: 'a', done: false }),
  db.tx.todos.update({ id: 'todo-1', title: 'b', done: true }),
  db.tx.notes.delete({ id: 'note-1' }),
);
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const [transaction] = result.dataTransactions;
  assert.equal(transaction.resolution.kind, 'synthesized-batch');
  assert.match(transaction.resolution.exportedName, /^data\.tx_[0-9a-f]{16}$/u);
  const mutation = result.functionManifest.functions.find(
    ({ name }) => name === transaction.resolution.exportedName,
  );
  assert(mutation, 'the transaction must be one ordinary generated Mutation');
  assert.equal(mutation.kind, 'Mutation');
  assert.equal(mutation.runtime.HostPlan.Mutation.steps.length, 9);
  assert.deepEqual(mutation.argsContract.fields.map(({ name }) => name), [
    'c0_title', 'c0_done', 'c1_id', 'c1_title', 'c1_done', 'c2_id',
  ]);
  const planText = JSON.stringify(mutation.runtime.HostPlan.Mutation);
  assert.match(planText, /__dataTx0_/u);
  assert.match(planText, /__dataTx1_/u);
  assert.match(planText, /__dataTx2_/u);
  assert.deepEqual(
    Object.keys(mutation.runtime.HostPlan.Mutation.return_value.Expr.Record.fields),
    ['c0', 'c1', 'c2'],
  );
  assert.equal(mutation.resultContract.kind, 'value');
  assert.equal(mutation.resultContract.value.allowExtra, false);
  assert.equal(
    transaction.functionReference.mutationIr.capabilityClass,
    'local-executable',
    JSON.stringify(transaction.functionReference.mutationIr),
  );
  assert.equal(transaction.functionReference.mutationIr.mintSites.length, 1);
});

test('generated runtime exposes inert tx witnesses without freezing before metadata attachment', async () => {
  const result = await generate(fixture(`
declare const db: any;
db.transact(db.tx.todos.create({ title: 'a', done: false }));
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const generated = await import(
    `${pathToFileURL(join(result.outDir, 'data.mjs')).href}?test=${Date.now()}`,
  );
  assert.equal(Object.isFrozen(generated.data), true);
  assert.equal(Object.keys(generated.data).includes('__snapbackDataBinding'), false);
  assert.equal(generated.data.__snapbackDataBinding.dataTransactionCatalog.length, 1);
  assert.equal(generated.data.__snapbackDataBinding.operations.todos.create.kind, 'Mutation');
  const types = readFileSync(join(result.outDir, 'data.d.ts'), 'utf8');
  assert(types.includes('DataTransactionBuilderV1'));
  assert.match(
    types,
    /"create": \(args: Readonly<\{ readonly "title": string; readonly "done": boolean \}>\)/u,
  );
  assert.match(types, /DataTransactionResultTupleV1/u);
  assert.doesNotMatch(
    types,
    /"create": \(args: Readonly<Record<string, unknown>>\)/u,
  );
});

test('static composition refusals are typed and first-violated', async () => {
  const cases = [
    {
      code: 'SNAPBACK_DATA_TRANSACTION_BOUND_EXCEEDED',
      source: 'declare const db:any; db.transact();',
    },
    {
      code: 'SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED',
      source: 'declare const db:any; declare const chunk:any; db.transact(chunk);',
    },
    {
      code: 'SNAPBACK_DATA_TRANSACTION_NOT_CATALOGUED',
      source: "declare const db:any; db.transact(db.tx.todos.create({}), db.tx.todos.custom({}));",
    },
  ];
  for (const { code, source } of cases) {
    const result = await generate(fixture(source));
    assert.equal(result.ok, false, JSON.stringify(result.diagnostics));
    assert.equal(result.diagnostics[0].code, code);
  }
});

test('duplicate static shapes deduplicate while chunk order remains semantic', async () => {
  const result = await generate(fixture(`
declare const db: any;
db.transact(db.tx.todos.create({ title: 'a', done: false }), db.tx.notes.delete({ id: 'n' }));
db.transact(db.tx.todos.create({ title: 'b', done: true }), db.tx.notes.delete({ id: 'm' }));
db.transact(db.tx.notes.delete({ id: 'n' }), db.tx.todos.create({ title: 'a', done: false }));
`));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(result.dataTransactions.length, 2);
  assert.notEqual(
    result.dataTransactions[0].normalizedDataTransactionId,
    result.dataTransactions[1].normalizedDataTransactionId,
  );
});
