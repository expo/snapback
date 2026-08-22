import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

const makeBackend = (functionsSource) => {
  const root = mkdtempSync(join(tmpdir(), 'snapback-plan-derived-facts-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ title: v.string(), done: v.boolean() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
  writeFileSync(join(root, 'functions.mjs'), functionsSource);
  return root;
};

const positiveSource = `
import {
  arg, bindingRef, defineMutation, insert, lit, patch,
  results, returnBinding, returnChangedCount, returnDocument, returnExpr, v,
} from ${JSON.stringify(defineUrl)};

const createPlan = (binding) => insert('todos', {
  title: arg('title'), done: lit(false),
}, { bindIdAs: binding });

export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: createPlan('todoId'),
  returns: returnBinding('todoId'),
});

export const createTodoAuthored = defineMutation({
  args: { title: v.string() },
  plan: createPlan('authoredTodoId'),
  returns: returnBinding('authoredTodoId'),
  result: results.value(v.id('todos')),
});

export const markDone = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
});

export const markDoneAuthored = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
  result: results.value(v.integer()),
});

export const createAndRead = defineMutation({
  args: { title: v.string() },
  plan: createPlan('readTodoId'),
  returns: returnDocument('todos', bindingRef('readTodoId')),
});

export const echoOpaqueExpression = defineMutation({
  args: { id: v.id('todos'), title: v.string() },
  plan: patch('todos', arg('id'), { title: arg('title') }),
  returns: returnExpr(arg('title')),
});
`;

try {
  const positiveRoot = makeBackend(positiveSource);
  const generated = await generate(positiveRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const manifest = JSON.parse(readFileSync(
    join(positiveRoot, 'generated', 'functions.manifest.json'),
    'utf8',
  ));
  const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
  const create = byName.get('createTodo');
  const authored = byName.get('createTodoAuthored');
  const changed = byName.get('markDone');
  const changedAuthored = byName.get('markDoneAuthored');
  const document = byName.get('createAndRead');
  const opaque = byName.get('echoOpaqueExpression');

  // @ref LLP 0275#d8-explicit-profile-classification-under-llp-0295-d03-2026-08-21
  // — P1-P4 eliminate only closed-plan transcription. Authored policy and
  // the existing result/dependency carrier stay byte-for-byte equivalent.
  assert.deepEqual(create.resultContract, authored.resultContract);
  assert.deepEqual(create.readSetSummary, authored.readSetSummary);
  assert.deepEqual(create.writeSetSummary, authored.writeSetSummary);
  assert.deepEqual(create.authorityProfileDependence, authored.authorityProfileDependence);
  assert.deepEqual(create.resultContract, {
    kind: 'value',
    value: { kind: 'id', table: 'todos' },
  });
  assert.deepEqual(changed.resultContract, {
    kind: 'value',
    value: { kind: 'integer', min: 0, max: Number.MAX_SAFE_INTEGER },
  });
  assert.deepEqual(changedAuthored.resultContract, changed.resultContract);
  assert.equal(document.resultContract.kind, 'document');
  assert.equal(document.resultContract.table, 'todos');
  assert.equal(document.resultContract.document.allowExtra, false);
  assert.deepEqual(opaque.resultContract, { kind: 'unknown' });
  assert.deepEqual(changed.readSetSummary.tables, ['todos']);
  assert.deepEqual(changed.writeSetSummary.tables, ['todos']);

  const facts = new Map(
    manifest.unsupportedDependencyDiagnostics
      .filter(({ code }) => code === 'SNAPBACK_PLAN_FACTS_DERIVED')
      .map((diagnostic) => [diagnostic.details.function, diagnostic.details]),
  );
  assert.equal(facts.get('createTodo').resultContractProvenance, 'plan-derived');
  assert.equal(
    facts.get('createTodoAuthored').resultContractProvenance,
    'authored-compatible-plan-derived',
  );
  assert.equal(facts.get('echoOpaqueExpression').resultContractProvenance, 'unknown');
  assert.equal(
    facts.get('markDoneAuthored').resultContractProvenance,
    'authored-compatible-plan-derived',
  );
  assert.deepEqual(facts.get('markDone').dependencySet, {
    reads: ['todos'],
    writes: ['todos'],
  });
  assert.equal(facts.get('markDone').dependencySetProvenance, 'plan-derived');

  const apiTypes = readFileSync(join(positiveRoot, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /"createTodo": FunctionReference<[^\n]+Id<"todos">/u);
  assert.match(apiTypes, /"markDone": FunctionReference<[^\n]+number/u);
  assert.match(
    apiTypes,
    /"createAndRead": FunctionReference<[^\n]+\{ "_id": Id<"todos">/u,
  );
  assert.match(apiTypes, /"echoOpaqueExpression": FunctionReference<[^\n]+unknown/u);

  const conflictRoot = makeBackend(`
import {
  arg, defineMutation, insert, lit, results, returnBinding, v,
} from ${JSON.stringify(defineUrl)};
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title'), done: lit(false) }, { bindIdAs: 'todoId' }),
  returns: returnBinding('todoId'),
  result: results.value(v.string()),
});
`);
  const conflict = await generate(conflictRoot);
  assert.equal(conflict.ok, false);
  assert.match(
    conflict.diagnostics.map(({ message }) => message).join('\n'),
    /authored result contract conflicts with the closed plan-derived contract/u,
  );
  assert.equal(
    existsSync(join(conflictRoot, 'generated', 'functions.manifest.json')),
    false,
    'P1-P3 conflicts refuse before an active functions manifest is emitted',
  );

  const dependencyConflictRoot = makeBackend(`
import { arg, defineMutation, lit, patch, returnChangedCount, v } from ${JSON.stringify(defineUrl)};
export const markDone = defineMutation({
  args: { id: v.id('todos') },
  plan: patch('todos', arg('id'), { done: lit(true) }),
  returns: returnChangedCount(),
  reads: [],
});
`);
  const dependencyConflict = await generate(dependencyConflictRoot);
  assert.equal(dependencyConflict.ok, false);
  assert.ok(
    dependencyConflict.diagnostics.some(({ code }) => code === 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN'),
    JSON.stringify(dependencyConflict.diagnostics),
  );

  console.log('plan-derived-facts.test.mjs: P1-P4 exact facts and refusals pass');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
