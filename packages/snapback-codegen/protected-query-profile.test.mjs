import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dirs = [];

function backend({ schema, functions, handler }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-protected-profile-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  if (handler !== undefined) writeFileSync(join(dir, 'handler.js'), handler);
  return dir;
}

const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ ownerId: v.principal(), title: v.string() })
    .permissionBacking(['ownerId'])
    .visibility({ kind: 'owner', field: 'ownerId' })
    .sync(),
  audit: defineTable({ message: v.string() }).visibility({ kind: 'public-read' }),
});
`;

{
  const dir = backend({ schema, functions: 'export const nothing = 0;\n' });
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'));
  assert.equal(manifest.tables[0].permissionBacking, true);
  assert.deepEqual(manifest.tables[0].permissionFields, ['ownerId']);
}

{
  const invalidSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ ownerId: v.string() }).permissionBacking(['missing']),
});
`;
  const dir = backend({ schema: invalidSchema, functions: 'export const nothing = 0;\n' });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SCHEMA_PERMISSION_FIELD_UNKNOWN'
    && diagnostic.field === 'missing'
  )));
}

for (const [expression, code, inputKind] of [
  ['runtimeNow()', 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'RuntimeNow'],
  ['runtimeId()', 'SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'RuntimeId'],
]) {
  const functions = `
import { defineLiveQuery, eq, ${expression.slice(0, -2)} } from '${defineUrl}';
export const protectedTodos = defineLiveQuery({
  table: 'todos',
  filter: [eq('ownerId', ${expression})],
});
`;
  const dir = backend({ schema, functions });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === code && diagnostic.inputKind === inputKind
  )), JSON.stringify(result.diagnostics));
}

for (const [call, code, inputKind] of [
  ['ctx.runtime.now()', 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY', 'RuntimeNow'],
  ['ctx.runtime.id()', 'SNAPBACK_AUTH_MUTABLE_INPUT_DENIED', 'RuntimeId'],
]) {
  const functions = `
import { defineJsLiveQuery } from '${defineUrl}';
export const protectedJs = defineJsLiveQuery({
  source: 'handler.js',
  exportName: 'protectedJs',
  reads: ['todos'],
});
`;
  const handler = `globalThis.__snapbackHandlers = {
    async protectedJs(ctx) { return [{ value: await ${call} }]; },
  };\n`;
  const dir = backend({ schema, functions, handler });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === code && diagnostic.inputKind === inputKind
  )), JSON.stringify(result.diagnostics));
}

{
  const functions = `
import { defineJsLiveQuery, defineJsMutation } from '${defineUrl}';
export const protectedJs = defineJsLiveQuery({
  source: 'handler.js',
  exportName: 'protectedJs',
  reads: ['todos'],
});
export const writeWithClock = defineJsMutation({
  source: 'handler.js',
  exportName: 'writeWithClock',
  writes: ['audit'],
});
`;
  const handler = `globalThis.__snapbackHandlers = {
    async protectedJs(ctx) { return await ctx.db.query('todos').collect(); },
    async writeWithClock(ctx) { return await ctx.runtime.now(); },
  };\n`;
  const dir = backend({ schema, functions, handler });
  const result = await generate(dir);
  assert.equal(
    result.ok,
    true,
    `a sibling mutation's clock must not poison the protected query: ${JSON.stringify(result.diagnostics)}`,
  );
}

{
  const functions = `
import { defineJsLiveQuery } from '${defineUrl}';
export const protectedJs = defineJsLiveQuery({
  source: 'handler.js',
  exportName: 'protectedJs',
  reads: ['todos'],
});
`;
  const handler = `
async function clockedValue(context) { return await context.runtime.now(); }
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await clockedValue(ctx) }]; },
};\n`;
  const dir = backend({ schema, functions, handler });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY'
    && diagnostic.function === 'protectedJs'
  )), JSON.stringify(result.diagnostics));
}

for (const handler of [
  `
const helpers = {
  async clock(context) { return await context.runtime.now(); },
};
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await helpers.clock(ctx) }]; },
};`,
  `
const helpers = {
  async clock(context) { return await context.runtime.now(); },
};
const clockAlias = helpers.clock;
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await clockAlias(ctx) }]; },
};`,
  `
const helpers = {
  async clock(context) { return await context.runtime.now(); },
};
const selected = 'clock';
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await helpers[selected](ctx) }]; },
};`,
  `
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await this.clock(ctx) }]; },
  async clock(context) { return await context.runtime.now(); },
};`,
  `
async function clock(context) { return await context.runtime.now(); }
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) {
    const values = await Promise.all([ctx].map(clock));
    return [{ value: values[0] }];
  },
};`,
]) {
  const functions = `
import { defineJsLiveQuery } from '${defineUrl}';
export const protectedJs = defineJsLiveQuery({
  source: 'handler.js',
  exportName: 'protectedJs',
  reads: ['todos'],
});
`;
  const dir = backend({ schema, functions, handler });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY'
    && diagnostic.function === 'protectedJs'
  )), JSON.stringify(result.diagnostics));
}

for (const [label, handler] of [
  [
    'root context parameter destructures runtime',
    `
globalThis.__snapbackHandlers = {
  async protectedJs({ runtime }) { return [{ value: await runtime.now() }]; },
};`,
  ],
  [
    'root context parameter destructures the runtime method',
    `
globalThis.__snapbackHandlers = {
  async protectedJs({ runtime: { now } }) { return [{ value: await now() }]; },
};`,
  ],
  [
    'context reaches a helper second parameter',
    `
async function clock(_label, context) { return await context.runtime.now(); }
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await clock('protected', ctx) }]; },
};`,
  ],
  [
    'runtime reaches a helper directly',
    `
async function clock(runtime) { return await runtime.now(); }
globalThis.__snapbackHandlers = {
  async protectedJs(ctx) { return [{ value: await clock(ctx.runtime) }]; },
};`,
  ],
  [
    'renamed context is captured by a nested closure',
    `
globalThis.__snapbackHandlers = {
  async protectedJs(context) {
    const hidden = async () => context.runtime.now();
    return [{ value: await hidden() }];
  },
};`,
  ],
]) {
  const functions = `
import { defineJsLiveQuery } from '${defineUrl}';
export const protectedJs = defineJsLiveQuery({
  source: 'handler.js',
  exportName: 'protectedJs',
  reads: ['todos'],
});
`;
  const dir = backend({ schema, functions, handler });
  const result = await generate(dir);
  assert.equal(result.ok, false, `${label}: ${JSON.stringify(result.diagnostics)}`);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY'
    && diagnostic.function === 'protectedJs'
  )), `${label}: ${JSON.stringify(result.diagnostics)}`);
}

{
  const functions = `
import { defineLiveQuery } from '${defineUrl}';
export const badScope = defineLiveQuery({ table: 'todos', authScopeField: 'missing' });
`;
  const dir = backend({ schema, functions });
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'QUERY_UNKNOWN_FIELD' && diagnostic.field === 'missing'
  )));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log('protected query profile tests passed');
