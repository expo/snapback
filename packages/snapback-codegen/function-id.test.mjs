// Stable function ids (ENG-24905, LLP 0055 stage prerequisite).
//
// Grants and consent are keyed by function id, so codegen must emit a
// non-empty id for every function and the id must be deterministic:
// regenerating unchanged source produces byte-identical ids, and a rename is
// a different function (the old id is retired with the old name, never
// re-pointed at a different function).
//
// @ref LLP 0004#first-slice-api-decisions — Function ids: required,
//   `{appId}:{exportedName}`, deterministic across regeneration.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dirs = [];

const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).sync(),
});
`;

function functionsSource(queryName) {
  return `
import { defineLiveQuery, defineMutation, insert, arg, v } from '${defineUrl}';
export const ${queryName} = defineLiveQuery({ table: 'todos', args: {} });
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title') }),
});
`;
}

// The app id is the backend dir's parent directory name, so nest a named app
// root inside the mkdtemp dir to hold it fixed across regenerations.
function makeBackend(appName) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-function-id-'));
  dirs.push(root);
  const dir = join(root, appName, 'snapback');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functionsSource('listTodos'));
  return dir;
}

async function generatedFunctions(dir) {
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  return manifest.functions;
}

function idsByName(functions) {
  return Object.fromEntries(functions.map((fn) => [fn.name, fn.id]));
}

// 1. Every emitted function carries a non-empty stable id of the pinned
//    deterministic form `{appId}:{exportedName}`.
{
  const dir = makeBackend('id-app');
  const functions = await generatedFunctions(dir);
  assert(functions.length >= 2, 'fixture emits multiple functions');
  for (const fn of functions) {
    assert.equal(typeof fn.id, 'string');
    assert.notEqual(fn.id, '', `${fn.name} must carry a non-empty id`);
    assert.equal(fn.id, `id-app:${fn.name}`);
  }

  // 2. Regenerating unchanged source produces byte-identical ids.
  const first = idsByName(functions);
  const second = idsByName(await generatedFunctions(dir));
  assert.deepEqual(second, first, 'unchanged source must regenerate byte-identical ids');

  // 3. A rename is a different function: the new name mints a new id and the
  //    old id is retired from the manifest, never re-pointed.
  writeFileSync(join(dir, 'functions.mjs'), functionsSource('listAllTodos'));
  const renamed = idsByName(await generatedFunctions(dir));
  assert.equal(renamed.listAllTodos, 'id-app:listAllTodos');
  const renamedIds = Object.values(renamed);
  assert(!renamedIds.includes('id-app:listTodos'), 'a retired id must not be re-pointed at another function');
  // Untouched functions keep their exact ids across the rename generation.
  assert.equal(renamed.createTodo, first.createTodo);

  // 4. Deleting and re-adding a function with the same name reproduces the
  //    same deterministic id. This is by design — continuity of authority is
  //    NOT implied by id equality; the grant's durable basis generation
  //    (LLP 0055, scopes ticket) is the ABA defense this scheme leaves room
  //    for, so the id itself must stay deterministic.
  writeFileSync(join(dir, 'functions.mjs'), functionsSource('listTodos'));
  const restored = idsByName(await generatedFunctions(dir));
  assert.equal(restored.listTodos, first.listTodos);
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log('function id tests passed');
