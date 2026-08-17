// Identifier validation for the function namespace (ENG-23378).
//
// Function export names, arg names, and nested v.object field names are
// interpolated raw into emitted TS/JS (`export function ${name}(`, unquoted
// property names) and contract module file paths (`${name}.query.ts`), so
// codegen must reject anything that is not a plain, non-reserved identifier —
// with a structured diagnostic and nothing written — instead of committing
// syntactically invalid or path-escaping output with exit 0.

import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const defineUrl = pathToFileURL(join(dirname(fileURLToPath(import.meta.url)), 'define.mjs')).href;

const defaultSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string(), completed: v.boolean() })
    .visibility({ kind: 'public-read' })
    .sync(),
});
`;

const tempDirs = [];

async function runCase({ functionsSource, schemaSource = defaultSchema, handlersSource = null }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-ident-'));
  tempDirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schemaSource);
  writeFileSync(join(dir, 'functions.mjs'), functionsSource);
  if (handlersSource !== null) writeFileSync(join(dir, 'handlers.mjs'), handlersSource);
  const result = await generate(dir);
  return { dir, result };
}

function assertRejected({ dir, result }, code, needle) {
  assert.equal(result.ok, false, `expected codegen failure, got ok=true (${needle})`);
  const hit = result.diagnostics.find((d) => d.code === code && d.message.includes(needle));
  assert.ok(
    hit,
    `expected a ${code} diagnostic mentioning ${JSON.stringify(needle)}, got: ${JSON.stringify(result.diagnostics)}`,
  );
  assert.equal(hit.severity, 'error');
  assert.ok(!existsSync(join(dir, 'generated')), 'failed codegen must write nothing');
}

// 1. Kebab-case arg name: previously emitted `{ user-id: string }` — invalid
//    TS in api.d.ts and runtime-links.ts — with exit 0.
assertRejected(
  await runCase({
    functionsSource: `
import { defineQuery, v } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: { 'user-id': v.string() } });
`,
  }),
  'FUNCTION_INVALID_IDENTIFIER',
  'user-id',
);

// 2. Reserved word as export name (export { f as delete }): previously
//    emitted `export function delete(args: DeleteArgs)`.
assertRejected(
  await runCase({
    functionsSource: `
import { defineMutation, insert, lit, v } from '${defineUrl}';
const removeTodo = defineMutation({
  args: {},
  plan: insert('todos', { title: lit('x'), completed: lit(false) }),
});
export { removeTodo as delete };
`,
  }),
  'FUNCTION_INVALID_IDENTIFIER',
  'delete',
);

// Object-prototype spellings are valid bindings but unsafe as keys in emitted
// object literals, so they share the reserved-name refusal.
for (const name of ['__proto__', 'constructor', 'prototype']) {
  assertRejected(
    await runCase({
      functionsSource: `
import { defineQuery } from '${defineUrl}';
const query = defineQuery({ table: 'todos', args: {} });
export { query as ${name} };
`,
    }),
    'FUNCTION_INVALID_IDENTIFIER',
    name,
  );
}

// 3. ES2022 arbitrary string export name with a path traversal: previously the
//    contract module writeFileSync escaped generated/contract/ entirely.
assertRejected(
  await runCase({
    functionsSource: `
import { defineQuery, v } from '${defineUrl}';
const q = defineQuery({ table: 'todos', args: {} });
export { q as '../evil' };
`,
  }),
  'FUNCTION_INVALID_IDENTIFIER',
  '../evil',
);

// 4. Nested v.object arg field name.
assertRejected(
  await runCase({
    functionsSource: `
import { defineQuery, v } from '${defineUrl}';
export const listTodos = defineQuery({
  table: 'todos',
  args: { payload: v.object({ inner: v.object({ 'bad-name': v.string() }) }) },
});
`,
  }),
  'FUNCTION_INVALID_IDENTIFIER',
  'bad-name',
);

// 5. Nested v.object field name in a declared JS-handler result row.
assertRejected(
  await runCase({
    functionsSource: `
import { defineJsLiveQuery, v } from '${defineUrl}';
export const listTodos = defineJsLiveQuery({
  args: {},
  source: 'handlers.mjs',
  exportName: 'listTodos',
  reads: ['todos'],
  result: v.object({ 'bad-field': v.string() }),
});
`,
    handlersSource: 'export const listTodos = (ctx) => [];\n',
  }),
  'FUNCTION_INVALID_IDENTIFIER',
  'bad-field',
);

// 6. Nested v.object field name in an ephemeral value validator (same
//    unescaped typeForValidator emission path).
assertRejected(
  await runCase({
    schemaSource: `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string(), completed: v.boolean() }).visibility({ kind: 'public-read' }).sync() },
  {
    ephemeral: defineEphemeral({
      cursors: ephemeral.collection({
        scope: { roomId: v.string() },
        value: v.object({ 'bad-value': v.number() }),
        ttlMs: 1000,
        publish: allow.all(),
        subscribe: allow.all(),
      }),
    }),
  },
);
`,
    functionsSource: `export const nothing = 0;\n`,
  }),
  'EPHEMERAL_INVALID_VALUE_FIELD',
  'bad-value',
);

// Ephemeral publish aliases are generated symbols and must not collide with
// authored functions or another collection's bare generated symbol.
assertRejected(
  await runCase({
    schemaSource: `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string(), completed: v.boolean() }).visibility({ kind: 'public-read' }).sync() },
  { ephemeral: defineEphemeral({
    cursors: ephemeral.collection({
      scope: { roomId: v.string() }, value: v.string(), ttlMs: 1000,
      publish: allow.all(), subscribe: allow.all(),
    }),
  }) },
);
`,
    functionsSource: `
import { defineMutation, insert, lit } from '${defineUrl}';
export const cursorsPublish = defineMutation({
  args: {}, plan: insert('todos', { title: lit('x'), completed: lit(false) }),
});
`,
  }),
  'EPHEMERAL_NAME_COLLISION',
  'cursorsPublish',
);

assertRejected(
  await runCase({
    schemaSource: `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
const collection = () => ephemeral.collection({
  scope: { roomId: v.string() }, value: v.string(), ttlMs: 1000,
  publish: allow.all(), subscribe: allow.all(),
});
export default defineSchema(
  { todos: defineTable({ title: v.string(), completed: v.boolean() }).visibility({ kind: 'public-read' }).sync() },
  { ephemeral: defineEphemeral({ cursors: collection(), cursorsPublish: collection() }) },
);
`,
    functionsSource: 'export const nothing = 0;\n',
  }),
  'EPHEMERAL_NAME_COLLISION',
  'cursorsPublish',
);

// 7. Valid identifiers (including a nested v.object arg and a reserved word in
//    property position, which is legal) still generate cleanly.
{
  const { dir, result } = await runCase({
    functionsSource: `
import { defineQuery, v } from '${defineUrl}';
export const listTodos = defineQuery({
  table: 'todos',
  args: { filterSpec: v.object({ delete: v.boolean(), completed: v.optional(v.boolean()) }) },
});
`,
  });
  assert.equal(result.ok, true, `expected clean generation, got: ${JSON.stringify(result.diagnostics)}`);
  assert.ok(existsSync(join(dir, 'generated', 'contract', 'listTodos.query.ts')));
  const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
  assert.ok(apiTypes.includes('filterSpec: { delete: boolean; completed?: boolean }'));
}

for (const dir of tempDirs) rmSync(dir, { recursive: true, force: true });

console.log('identifier-validation.test.mjs: all cases passed');
