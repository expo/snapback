// JS-handler query contract bindings must carry the author's declared `reads`
// (ENG-23421). `defineJsQuery`/`defineJsLiveQuery` require a non-empty `reads`
// and the functions manifest keeps it as `declaredReads`, but the contract
// binding used to omit the key entirely — so every JS query's
// .contract-meta.ts sidecar emitted `reads: []` with a per-function cacheKey,
// and Exact's table-dependency/invalidation mapping saw zero reads. This test
// pins parity with the HostPlan-query branch: both runtimes derive the meta
// sidecar's reads and cacheKey from the declared table.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;

const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-reads-'));
writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string(), completed: v.boolean() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`);
writeFileSync(join(dir, 'functions.mjs'), `
import { defineJsLiveQuery, defineLiveQuery, v } from '${defineUrl}';
export const listTodos = defineJsLiveQuery({
  args: {},
  source: 'handlers.mjs',
  exportName: 'listTodos',
  reads: ['todos'],
});
export const listTodosPlan = defineLiveQuery({ table: 'todos', args: {} });
`);
writeFileSync(join(dir, 'handlers.mjs'), 'globalThis.__snapbackHandlers = { async listTodos(ctx) { return []; } };\n');
writeFileSync(join(dir, 'codegen.policy.json'), JSON.stringify({
  schemaVersion: 'snapback.codegen-policy.v1',
  committedProjections: [],
  contractMetadata: 'exact',
}, null, 2));

const result = await generate(dir);
assert.equal(result.ok, true, `expected clean generation, got: ${JSON.stringify(result.diagnostics)}`);

// The contract-data manifest binding carries the declared reads for the JS
// handler, identical in shape to the HostPlan binding.
const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'contract-data.manifest.json'), 'utf8'));
const jsBinding = manifest.queries.listTodos;
const planBinding = manifest.queries.listTodosPlan;
assert.deepEqual(jsBinding.reads, ['todos'], `JS-query binding must carry declared reads, got: ${JSON.stringify(jsBinding)}`);
assert.deepEqual(planBinding.reads, ['todos']);

// The .contract-meta.ts sidecar derives reads and cacheKey from the table for
// both runtimes — never an empty read-set with a per-function cacheKey.
const jsMeta = readFileSync(join(dir, 'generated', 'contract', 'listTodos.query.contract-meta.ts'), 'utf8');
const planMeta = readFileSync(join(dir, 'generated', 'contract', 'listTodosPlan.query.contract-meta.ts'), 'utf8');
for (const [label, meta] of [['js', jsMeta], ['plan', planMeta]]) {
  assert.ok(meta.includes('reads: ["todos"]'), `${label} meta must declare reads: ["todos"], got:\n${meta}`);
  assert.ok(meta.includes("cacheKey: 'todos'"), `${label} meta cacheKey must derive from the table, got:\n${meta}`);
}

// A point-read handler whose direct return is visibly an object can be
// rejected before the runtime ever creates an error-shaped query cell. The
// runtime rows-array guard remains authoritative for dynamic return shapes.
writeFileSync(
  join(dir, 'handlers.mjs'),
  'globalThis.__snapbackHandlers = { async listTodos(ctx) { return { _id: "one", title: "wrong shape" }; } };\n',
);
const invalidPointRead = await generate(dir);
assert.equal(invalidPointRead.ok, false);
const resultShapeDiagnostic = invalidPointRead.diagnostics.find(
  (diagnostic) => diagnostic.code === 'FUNCTION_JS_QUERY_STATIC_RESULT_NOT_ROWS',
);
assert.ok(resultShapeDiagnostic, JSON.stringify(invalidPointRead.diagnostics));
assert.equal(resultShapeDiagnostic.function, 'listTodos');
assert.equal(resultShapeDiagnostic.handler, 'listTodos');
assert.equal(resultShapeDiagnostic.source, 'handlers.mjs');
assert.equal(resultShapeDiagnostic.sourceSpan.line, 1);
assert.match(resultShapeDiagnostic.message, /Wrap a point read as \[row\]/);

rmSync(dir, { recursive: true, force: true });

console.log('contract-binding-reads.test.mjs: all cases passed');
