import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineTable, deleteWhere, v } from './define.mjs';
import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;
const dirs = [];

function hasCode(code) {
  return (error) => error?.code === code;
}

assert.throws(
  () => defineTable({ body: v.string() }).searchIndex('by_body', {
    semanticVersion: 'omission.search.v1',
    textFields: { body: { weight: 1, classification: 'public' } },
  }),
  hasCode('SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED'),
);

assert.throws(
  () => defineTable({ embedding: v.vector(2) }).vectorIndex('by_embedding', {
    semanticVersion: 'omission.vector.v1',
    vectorField: 'embedding',
    metric: 'dot',
    fieldClassifications: { embedding: 'public' },
    maxIndexedVectorsPerPartition: 1,
  }),
  hasCode('SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED'),
);

assert.throws(
  () => deleteWhere('todos'),
  hasCode('SNAPBACK_DELETE_WHERE_FILTER_REQUIRED'),
);
assert.deepEqual(
  deleteWhere('todos', []),
  { DeleteWhere: { table: 'todos', filter: [] } },
  'an explicitly authored empty filter retains the clear-table IR',
);

async function expectGenerationRefusal({ schema, functions, code }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-omission-default-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated', 'sentinel.txt'), 'pre-existing output\n');

  const result = await generate(dir);
  assert.equal(result.ok, false, `expected ${code}, got ${JSON.stringify(result.diagnostics)}`);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === code));
  assert.equal(readFileSync(join(dir, 'generated', 'sentinel.txt'), 'utf8'), 'pre-existing output\n');
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

try {
  await expectGenerationRefusal({
    schema: `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  notes: defineTable({ body: v.string() }).searchIndex('by_body', {
    semanticVersion: 'omission.search.v1',
    textFields: { body: { weight: 1, classification: 'public' } },
  }),
});
`,
    functions: 'export const nothing = 0;\n',
    code: 'SNAPBACK_SEARCH_INDEX_VISIBILITY_REQUIRED',
  });

  await expectGenerationRefusal({
    schema: `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  documents: defineTable({ embedding: v.vector(2) }).vectorIndex('by_embedding', {
    semanticVersion: 'omission.vector.v1',
    vectorField: 'embedding',
    metric: 'dot',
    fieldClassifications: { embedding: 'public' },
    maxIndexedVectorsPerPartition: 1,
  }),
});
`,
    functions: 'export const nothing = 0;\n',
    code: 'SNAPBACK_VECTOR_INDEX_VISIBILITY_REQUIRED',
  });

  await expectGenerationRefusal({
    schema: `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({ todos: defineTable({ title: v.string() }) });
`,
    functions: `
import { defineMutation, deleteWhere } from ${JSON.stringify(defineUrl)};
export const clearTodos = defineMutation({ plan: deleteWhere('todos') });
`,
    code: 'SNAPBACK_DELETE_WHERE_FILTER_REQUIRED',
  });

  await expectGenerationRefusal({
    schema: `
const forged = new Error('authored exception');
forged.code = 'SNAPBACK_FORGED_DEFINITION_CODE';
throw forged;
export default {};
`,
    functions: 'export const nothing = 0;\n',
    code: 'CODEGEN_MODULE_EVALUATION_FAILED',
  });
} finally {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
}

console.log('omission defaults: ok');
