import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dirs = [];

function backend(functions, handler = undefined) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-retainability-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ ownerId: v.string(), title: v.string(), delegated: v.boolean() }).sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  if (handler !== undefined) writeFileSync(join(dir, 'handler.js'), handler);
  return dir;
}

{
  const functions = `
import {
  authActorKind, authIsDelegated, authKind, authUserId,
  defineLiveQuery, defineQuery, eq,
} from '${defineUrl}';
export const kindScoped = defineQuery({
  table: 'todos',
  filter: [eq('ownerId', authUserId()), eq('title', authKind())],
  retainable: true,
});
export const actorAware = defineLiveQuery({
  table: 'todos',
  filter: [eq('title', authActorKind()), eq('delegated', authIsDelegated())],
});
`;
  const dir = backend(functions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));
  assert.deepEqual(byName.get('kindScoped').authorizationDependence, ['kind', 'userId']);
  assert.deepEqual(byName.get('actorAware').authorizationDependence, ['actorKind', 'isDelegated']);
  assert.equal(byName.get('actorAware').runtime.HostPlan.Query.filters[0].value, 'AuthActorKind');
  assert.equal(byName.get('actorAware').runtime.HostPlan.Query.filters[1].value, 'AuthIsDelegated');
}

{
  const functions = `
import { authUserId, defineQuery, eq } from '${defineUrl}';
export const myTodos = defineQuery({
  table: 'todos',
  filter: [eq('ownerId', authUserId())],
  retainable: true,
});
export const scopedTodos = defineQuery({
  table: 'todos',
  authScopeField: 'ownerId',
  retainable: true,
});
export const publicTodos = defineQuery({
  table: 'todos',
  auth: 'public',
  authorityIndependent: true,
  retainable: true,
});
`;
  const dir = backend(functions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const contract = JSON.parse(readFileSync(join(dir, 'generated', 'contract-data.manifest.json'), 'utf8'));
  const byName = new Map(manifest.functions.map((fn) => [fn.name, fn]));

  assert.equal(byName.get('myTodos').retainable, true);
  assert.deepEqual(byName.get('myTodos').authorizationDependence, ['userId']);
  assert.deepEqual(byName.get('myTodos').readSetSummary, {
    mode: 'singleTable',
    primaryTable: 'todos',
    tables: ['todos'],
    authScopeField: null,
  });
  assert.deepEqual(byName.get('scopedTodos').authorizationDependence, ['userId']);
  assert.equal(byName.get('scopedTodos').readSetSummary.authScopeField, 'ownerId');
  assert.equal(byName.get('publicTodos').retainable, true);
  assert.equal(byName.get('publicTodos').authorityIndependent, true);
  assert.equal(Object.hasOwn(byName.get('publicTodos'), 'authorizationDependence'), false);

  for (const name of ['myTodos', 'scopedTodos', 'publicTodos']) {
    assert.equal(contract.queries[name].retainable, true);
  }
}

const handler = `globalThis.__snapbackHandlers = {
  async retainedJs() { return []; },
};\n`;
for (const declaration of [
  '',
  "authorizationDependence: ['userId'],",
  "authorizationDependence: ['kind'],",
  "authorizationDependence: ['actorKind'],",
  "authorizationDependence: ['isDelegated'],",
  "authorizationDependence: ['sessionId'],",
  "authorizationDependence: ['provider'],",
  "authorizationDependence: ['opaque'],",
]) {
  const functions = `
import { defineJsQuery } from '${defineUrl}';
export const retainedJs = defineJsQuery({
  source: 'handler.js',
  exportName: 'retainedJs',
  reads: ['todos'],
  retainable: true,
  ${declaration}
});
`;
  const result = await generate(backend(functions, handler));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_AUTH_UNDECLARABLE_RETENTION'
    && diagnostic.reason === 'opaqueJavaScript'
  )), JSON.stringify(result.diagnostics));
}

for (const functions of [
  `
import { defineQuery } from '${defineUrl}';
export const typo = defineQuery({ table: 'todos', retianable: true });
`,
  `
import { defineJsQuery } from '${defineUrl}';
export const unknown = defineJsQuery({
  source: 'handler.js', exportName: 'retainedJs', reads: ['todos'],
  authorizationDependence: ['futureAuthority'],
});
`,
  `
import { defineMutation, insert, lit } from '${defineUrl}';
export const mutation = defineMutation({
  retainable: true,
  plan: insert('todos', { ownerId: lit('u'), title: lit('t') }),
});
`,
]) {
  const result = await generate(backend(functions, handler));
  assert.equal(result.ok, false, 'unknown/non-query retainability must fail loudly');
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'CODEGEN_MODULE_EVALUATION_FAILED'
  )), JSON.stringify(result.diagnostics));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log('retainability profile tests passed');
