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

async function invalidCase({ schema = validSchema, functions, handlers = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  for (const [path, source] of Object.entries(handlers)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated', 'sentinel.txt'), 'pre-existing output\n');
  const result = await generate(dir);
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result.diagnostics)}`);
  assert.equal(readFileSync(join(dir, 'generated', 'sentinel.txt'), 'utf8'), 'pre-existing output\n');
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false, 'failure must not partially replace output');
  return result.diagnostics;
}

async function validCase({ schema = validSchema, functions, handlers = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  for (const [path, source] of Object.entries(handlers)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  const result = await generate(dir);
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.diagnostics)}`);
  return result;
}

const jsActionFunctions = `
import { defineAction } from '${defineUrl}';
export const probe = defineAction({
  args: {},
  js: { source: 'handler.mjs', exportName: 'probe' },
});
`;

const tsActionFunctions = `
import { defineAction } from '${defineUrl}';
export const probe = defineAction({
  args: {},
  js: { source: 'handler.ts', exportName: 'probe' },
});
`;

function handlerWith(statement) {
  return `// scanner location prelude\n${statement}\nglobalThis.__snapbackHandlers = { async probe() { return {}; } };\n`;
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
  const result = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ rsvps: defineTable({ eventId: v.string(), userId: v.principal() }).index('by_event_user', ['eventId', 'userId'], { unique: true }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tables[0].indexes, [{ name: 'by_event_user', fields: ['eventId', 'userId'], unique: true }]);
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ rsvps: defineTable({ eventId: v.string(), userId: v.optional(v.principal()) }).index('by_event_user', ['eventId', 'userId'], { unique: true }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_UNIQUE_INDEX_OPTIONAL_FIELD' && d.field === 'userId'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).permissionBacking(['missing', 'missing']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELD_UNKNOWN' && d.field === 'missing'));
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELD_DUPLICATE' && d.field === 'missing'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
const todos = defineTable({ title: v.string() });
todos.permissionFields = ['title'];
export default defineSchema({ todos });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING'));
}

// LLP 0057 reservation is ASCII-case-insensitive at both codegen scopes.
for (const table of ['_auth', '_auth_users', '_AUTH_USERS', '_AuTh_Users']) {
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${JSON.stringify(table)}: defineTable({ title: v.string() }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.table === table),
    `expected protected auth table ${table} to be rejected`,
  );
}

for (const index of ['_auth', '_auth_lookup', '_AUTH_LOOKUP', '_AuTh_Lookup']) {
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).index(${JSON.stringify(index)}, ['title']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.index === index),
    `expected protected auth index ${index} to be rejected`,
  );
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
  maxValueBytes: -1,
  hardMaxValueBytes: -1,
  publishRate: { sustainedHz: -1, burst: -1 },
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

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const collection = ephemeral.collection({
  scope: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [\`field_\${index}\`, v.string()])),
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  publish: allow.all(),
  subscribe: allow.all(),
});
export default defineSchema({}, { ephemeral: defineEphemeral({ cursors: collection }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_SCOPE_TOO_WIDE'
    && d.fields === 17
    && d.maximum === 16
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const collection = ephemeral.collection({
  scope: { ${'s'.repeat(65)}: v.string() },
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  publish: allow.all(),
  subscribe: allow.all(),
});
export default defineSchema({}, { ephemeral: defineEphemeral({ ${'c'.repeat(65)}: collection }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_IDENTIFIER'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { ${'s'.repeat(65)}: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_SCOPE_FIELD'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    maxTtlMs: 30_001,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_BUDGET'
    && d.field === 'maxTtlMs'
    && d.maximum === 30_000
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    routing: ['roomId', 'roomId'],
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    maxPendingEphemeralKeys: 1_025,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_UNSAFE_ROUTING'
    && d.field === 'roomId'
  )));
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_BUDGET'
    && d.field === 'maxPendingEphemeralKeys'
    && d.maximum === 1_024
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    publish: allow.roomPermission('room:admin'),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_AUTH'
    && d.operation === 'publish'
    && d.prefix === 'room:admin'
  )));
}

// Handler admission is an AST walk, not a token blacklist. Every direct
// dynamic-code/ambient spelling receives a stable code and authored span.
// Reflective aliases and constructor walks are still denied by the runtime;
// this authoring pass deliberately diagnoses only explicit global spellings.
const unsupportedHandlerCases = [
  ["eval('1')", 'BUNDLE_UNSUPPORTED_EVAL', 'eval', 1],
  ["(0, eval)('1')", 'BUNDLE_UNSUPPORTED_EVAL', 'eval', 5],
  ["Function('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 1],
  ["new Function('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 5],
  ["AsyncFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncFunction', 1],
  ["new AsyncFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncFunction', 5],
  ["GeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'GeneratorFunction', 1],
  ["new GeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'GeneratorFunction', 5],
  ["AsyncGeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncGeneratorFunction', 1],
  ["new AsyncGeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncGeneratorFunction', 5],
  ["Reflect.construct(Function, ['return 1'])", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 19],
  ['with ({ allowed: false }) {}', 'BUNDLE_UNSUPPORTED_WITH', 'with', 1],
  ["import './forbidden.mjs'", 'BUNDLE_UNSUPPORTED_IMPORT', 'import', 1],
  ["import('./forbidden.mjs')", 'BUNDLE_UNSUPPORTED_IMPORT', 'import', 1],
  ['export const forbidden = true', 'BUNDLE_UNSUPPORTED_EXPORT', 'export', 1],
  ["require('forbidden')", 'BUNDLE_UNSUPPORTED_REQUIRE', 'require', 1],
  ['process.env.FORBIDDEN', 'BUNDLE_UNSUPPORTED_PROCESS', 'process', 1],
  ["fetch('https://example.com')", 'BUNDLE_UNSUPPORTED_FETCH', 'fetch', 1],
  ['setTimeout(function () {}, 1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['setInterval(function () {}, 1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['clearTimeout(1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['clearInterval(1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['requestAnimationFrame(function () {})', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['Math.random()', 'BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', 1],
  ['Date.now()', 'BUNDLE_UNSUPPORTED_TIME', 'Date', 1],
  ['new Date()', 'BUNDLE_UNSUPPORTED_TIME', 'Date', 5],
  ['WebAssembly.compile(new Uint8Array())', 'BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', 1],
];

for (const [statement, code, token, column] of unsupportedHandlerCases) {
  const diagnostics = await invalidCase({
    functions: jsActionFunctions,
    handlers: { 'handler.mjs': handlerWith(statement) },
  });
  const hit = diagnostics.find((diagnostic) => diagnostic.code === code && diagnostic.token === token);
  assert.ok(hit, `${statement}: expected ${code}/${token}, got ${JSON.stringify(diagnostics)}`);
  assert.deepEqual(
    hit.sourceSpan,
    { file: 'handler.mjs', line: 2, column },
    `${statement}: authored source span drifted`,
  );
}

// `.ts`/`.mts` are first-class handler extensions. Type-only syntax is parsed
// structurally, while runtime ambient uses retain exact authored locations.
await validCase({
  functions: tsActionFunctions,
  handlers: {
    'handler.ts': `
type Result = { ok: boolean };
const initial: Result = { ok: true };
globalThis.__snapbackHandlers = {
  async probe(): Promise<Result> { return initial; },
};
`,
  },
});

{
  const diagnostics = await invalidCase({
    functions: tsActionFunctions,
    handlers: {
      'handler.ts': `type Result = { value: string };\nconst value: Result = { value: 'x' };\nFunction('return 1');\nglobalThis.__snapbackHandlers = { async probe(): Promise<Result> { return value; } };\n`,
    },
  });
  const hit = diagnostics.find((diagnostic) => (
    diagnostic.code === 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR'
    && diagnostic.token === 'Function'
  ));
  assert.deepEqual(hit?.sourceSpan, { file: 'handler.ts', line: 3, column: 1 });
}

// Strings, comments, regex literals, template raw text, object keys, and
// non-global member names are data/member access rather than ambient globals.
await validCase({
  functions: jsActionFunctions,
  handlers: {
    'handler.mjs': `
// eval('x'); new Function(''); process fetch setTimeout Math.random Date.now WebAssembly
const tokens = "eval Function AsyncFunction GeneratorFunction AsyncGeneratorFunction require process fetch timers Math.random Date.now WebAssembly import export with";
const template = \`eval('x') new Function('') process.env fetch() WebAssembly\`;
const pattern = /eval|Function|require|process|fetch|setTimeout|WebAssembly/;
const local = {
  eval() {}, Function() {}, AsyncFunction() {}, GeneratorFunction() {}, AsyncGeneratorFunction() {},
  require() {}, process: { env: {} }, fetch() {}, setTimeout() {},
  Math: { random() {} }, Date: { now() {} }, WebAssembly: { compile() {} },
  import: 'member', export: 'member', with: 'member',
};
local.eval(); local['Function'](); local.AsyncFunction(); local.GeneratorFunction();
local.AsyncGeneratorFunction(); local.require(); local.process.env; local.fetch();
local.setTimeout(); local.Math.random(); local.Date.now(); local.WebAssembly.compile();
globalThis.__snapbackHandlers = { async probe() { return { tokens, template, pattern: String(pattern) }; } };
`,
  },
});

// The outbound-actions switch relaxes only fetch/timer authoring diagnostics.
// It never reopens dynamic evaluation, Wasm, process/module access, entropy,
// or wall-clock reads.
const previousOutboundActions = process.env.SNAPBACK_OUTBOUND_ACTIONS;
process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
try {
  await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
globalThis.__snapbackHandlers = {
  async probe() {
    var timer = setTimeout(function () {}, 1);
    clearTimeout(timer);
    return { fetchType: typeof fetch };
  }
};
`,
    },
  });

  const diagnostics = await invalidCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
eval('1');
Function('return 1');
WebAssembly.compile(new Uint8Array());
process.env.FORBIDDEN;
require('forbidden');
Math.random();
Date.now();
fetch('https://example.com');
setTimeout(function () {}, 1);
globalThis.__snapbackHandlers = { async probe() { return {}; } };
`,
    },
  });
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  for (const code of [
    'BUNDLE_UNSUPPORTED_EVAL',
    'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
    'BUNDLE_UNSUPPORTED_WEBASSEMBLY',
    'BUNDLE_UNSUPPORTED_PROCESS',
    'BUNDLE_UNSUPPORTED_REQUIRE',
    'BUNDLE_UNSUPPORTED_RANDOM',
    'BUNDLE_UNSUPPORTED_TIME',
  ]) {
    assert(codes.has(code), `egress must retain ${code}: ${JSON.stringify(diagnostics)}`);
  }
  assert.equal(codes.has('BUNDLE_UNSUPPORTED_FETCH'), false, 'egress should allow fetch authoring');
  assert.equal(codes.has('BUNDLE_UNSUPPORTED_TIMER'), false, 'egress should allow timer authoring');
} finally {
  if (previousOutboundActions === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = previousOutboundActions;
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('authoring-validation.test.mjs: all cases passed');
