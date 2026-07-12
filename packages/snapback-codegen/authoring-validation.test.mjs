import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;
const dirs = [];
const validSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).sync() });
`;

async function invalidCase({ schema = validSchema, functions }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated', 'sentinel.txt'), 'pre-existing output\n');
  const result = await generate(dir);
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result.diagnostics)}`);
  assert.equal(readFileSync(join(dir, 'generated', 'sentinel.txt'), 'utf8'), 'pre-existing output\n');
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false, 'failure must not partially replace output');
  return result.diagnostics;
}

{
  const diagnostics = await invalidCase({
    functions: `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: { forged: {} } });
`,
  });
  assert(diagnostics.some((d) => d.code === 'FUNCTION_INVALID_VALIDATOR' && d.arg === 'forged'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
const todos = defineTable({ title: v.string() });
todos.fields.title = {};
export default defineSchema({ todos });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_INVALID_VALIDATOR' && d.field === 'title'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).index('bad-name', ['title']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.index === 'bad-name'));
}

{
  const diagnostics = await invalidCase({
    functions: `
import { defineMutation, deleteWhere, eq, lit } from '${defineUrl}';
export const clearTypo = defineMutation({ plan: deleteWhere('todos', [eq('_versoin', lit(1))]) });
`,
  });
  assert(diagnostics.some((d) => d.code === 'QUERY_UNKNOWN_FIELD' && d.field === '_versoin'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const cursors = ephemeral.collection({
  scope: { roomId: v.string() },
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  maxTtlMs: -1,
  maxValueBytes: NaN,
  hardMaxValueBytes: -1,
  publishRate: { sustainedHz: -1, burst: NaN },
  delivery: { mode: 'latest', dispatchMs: -1 },
  maxPendingEphemeralKeys: -1,
  publish: allow.all(),
  subscribe: allow.all(),
});
cursors.scope.roomId = {};
export default defineSchema({}, { ephemeral: defineEphemeral({ cursors }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_VALIDATOR' && d.field === 'roomId'));
  const invalidBudgetFields = new Set(
    diagnostics.filter((d) => d.code === 'EPHEMERAL_INVALID_BUDGET').map((d) => d.field),
  );
  assert.deepEqual(invalidBudgetFields, new Set([
    'maxTtlMs',
    'maxValueBytes',
    'hardMaxValueBytes',
    'sustainedHz',
    'burst',
    'dispatchMs',
    'maxPendingEphemeralKeys',
  ]));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('authoring-validation.test.mjs: all cases passed');
