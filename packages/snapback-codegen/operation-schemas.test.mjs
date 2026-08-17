import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-operation-schemas-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { arg, defineMutation, patch, returnChangedCount, v } from '${defineUrl}';
export const updateTodo = defineMutation({
  args: {
    id: v.string(),
    completed: v.boolean(),
    count: v.integer(),
    score: v.real(),
    metadata: v.optional(v.object({ note: v.string(), pinned: v.optional(v.boolean()) })),
    payload: v.json(),
  },
  plan: patch('todos', arg('id'), { title: arg('id') }),
  returns: returnChangedCount(),
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, `expected clean generation, got: ${JSON.stringify(result.diagnostics)}`);
  const schema = JSON.parse(readFileSync(join(dir, 'generated', 'operations', 'updateTodo.args.schema.json'), 'utf8'));
  assert.deepEqual(schema.required, ['id', 'completed', 'count', 'score', 'payload']);
  assert.deepEqual(schema.properties.id, { type: 'string' });
  assert.deepEqual(schema.properties.completed, { type: 'boolean' });
  assert.deepEqual(schema.properties.count, { type: 'integer' });
  assert.deepEqual(schema.properties.score, { type: 'number' });
  assert.deepEqual(schema.properties.payload, {});
  assert.deepEqual(schema.properties.metadata, {
    additionalProperties: false,
    properties: {
      note: { type: 'string' },
      pinned: { type: 'boolean' },
    },
    required: ['note'],
    type: 'object',
  });

  const index = JSON.parse(readFileSync(join(dir, 'generated', 'artifacts.json'), 'utf8'));
  assert(index.artifacts.includes('operations/updateTodo.args.schema.json'));
  const api = await import(pathToFileURL(join(dir, 'generated', 'api.mjs')).href);
  assert.deepEqual(api.default.updateTodo.argumentSchema, {
    type: 'object',
    additionalProperties: false,
    properties: schema.properties,
    required: schema.required,
  });
  const packageJson = JSON.parse(readFileSync(join(dir, 'generated', 'package.json'), 'utf8'));
  assert.equal(packageJson.exports['./operations/*'], './operations/*');
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('operation-schemas.test.mjs: all cases passed');
