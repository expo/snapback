import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

async function generateCase(schema, functions = 'export const nothing = 0;\n') {
  const root = mkdtempSync(join(tmpdir(), 'snapback-stored-enum-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), schema);
  writeFileSync(join(root, 'functions.mjs'), functions);
  return { root, result: await generate(root) };
}

async function invalidSchema(body) {
  const { root, result } = await generateCase(`
import { defineSchema, defineTable, v } from '${defineUrl}';
${body}
`);
  mkdirSync(join(root, 'generated'), { recursive: true });
  writeFileSync(join(root, 'generated', 'sentinel.txt'), 'pre-existing output\n');
  const rerun = await generate(root);
  assert.equal(rerun.ok, false, JSON.stringify(rerun.diagnostics));
  assert.equal(readFileSync(join(root, 'generated', 'sentinel.txt'), 'utf8'), 'pre-existing output\n');
  assert.equal(existsSync(join(root, 'generated', 'artifacts.json')), false);
  assert(rerun.diagnostics.some((diagnostic) => (
    diagnostic.code === 'SCHEMA_INVALID_VALIDATOR'
    && diagnostic.message.includes('stored unions must be closed string-literal domains')
  )), JSON.stringify(rerun.diagnostics));
  assert.equal(result.ok, false);
  return rerun.diagnostics;
}

async function structuredSchema(body) {
  const { result } = await generateCase(`
import { defineSchema, defineTable, v } from '${defineUrl}';
${body}
`);
  // @ref LLP 0211#capability-and-maturity-the-llp-0134-publication-contract
  // — non-enum unions take the Structured row and the reviewed local support
  // flip admits that carrier while retaining its explicit requirement.
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert(
    result.schemaManifest.requiredCapabilities.includes('structured_stored_value_v1'),
    JSON.stringify(result.schemaManifest),
  );
  assert(!result.diagnostics.some(({ code }) => code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'));
  assert(!result.diagnostics.some(({ code }) => code === 'SCHEMA_INVALID_VALIDATOR'));
}

try {
  const { root, result } = await generateCase(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({
    role: v.union([v.literal('crew'), v.literal('user')]),
    visibility: v.optional(v.union([v.literal('internal'), v.literal('public')])),
    title: v.string(),
  }).index('by_role', ['role']).visibility({ kind: 'public-read' }).sync(),
});
`, `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: {} });
`);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(root, 'generated', 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tables[0].fields.slice(0, 2), [
    { field_type: { Enum: { values: ['crew', 'user'] } }, name: 'role', optional: false },
    { field_type: { Enum: { values: ['internal', 'public'] } }, name: 'visibility', optional: true },
  ]);
  assert.deepEqual(manifest.tables[0].indexes, [
    { name: 'by_role', fields: ['role'] },
  ]);

  const functions = JSON.parse(readFileSync(join(root, 'generated', 'functions.manifest.json'), 'utf8'));
  const list = functions.functions.find((candidate) => candidate.name === 'listTodos');
  const documentFields = list.resultContract.document.fields;
  assert.deepEqual(documentFields.find((field) => field.name === 'role').value, {
    kind: 'union',
    variants: [
      { kind: 'literal', value: 'crew' },
      { kind: 'literal', value: 'user' },
    ],
  });
  assert.deepEqual(documentFields.find((field) => field.name === 'visibility').value, {
    kind: 'union',
    variants: [
      { kind: 'null' },
      { kind: 'literal', value: 'internal' },
      { kind: 'literal', value: 'public' },
    ],
  });

  const apiTypes = readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /role: "crew" \| "user"/u);
  assert.match(apiTypes, /visibility: null \| "internal" \| "public"/u);
  const introspection = JSON.parse(readFileSync(
    join(root, 'generated', 'provider-introspection.json'),
    'utf8',
  ));
  const introspectionJson = JSON.stringify(introspection);
  assert(introspectionJson.includes('"shape":"literal","value":"crew"'));
  assert(introspectionJson.includes('"shape":"literal","value":"user"'));

  await invalidSchema(`
const domain = v.union([v.literal('a'), v.literal('b')]);
domain.variants.pop();
export default defineSchema({ rows: defineTable({ state: domain }) });
`);
  // Eight refuses even though v.union() itself admits eight variants: the
  // stored bound is seven so an optional field's null|… document contract
  // stays inside LLP 0108's eight-variant union bound.
  await invalidSchema(`
export default defineSchema({
  rows: defineTable({
    state: v.union([
      v.literal('a'), v.literal('b'), v.literal('c'), v.literal('d'),
      v.literal('e'), v.literal('f'), v.literal('g'), v.literal('h'),
    ]),
  }),
});
`);
  await structuredSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.literal('a'), v.integer()]) })
    .visibility({ kind: 'public-read' }),
});
`);
  await structuredSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.literal(1), v.literal(2)]) })
    .visibility({ kind: 'public-read' }),
});
`);
  await invalidSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.literal('a'), v.literal('a')]) }),
});
`);
  await invalidSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.literal(''), v.literal('a')]) }),
});
`);
  await invalidSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.literal('é'.repeat(33)), v.literal('a')]) }),
});
`);
  await invalidSchema(`
export default defineSchema({
  rows: defineTable({ state: v.union([v.optional(v.literal('a')), v.literal('b')]) }),
});
`);

  // The boundary the seven-value bound exists for: an optional seven-value
  // domain expands to an eight-variant document contract, exactly LLP 0108's
  // union ceiling. An eighth value would overflow it, which is why the stored
  // bound is one below the argument grammar's.
  const boundary = await generateCase(`
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  rows: defineTable({
    state: v.optional(v.union([
      v.literal('a'), v.literal('b'), v.literal('c'), v.literal('d'),
      v.literal('e'), v.literal('f'), v.literal('g'),
    ])),
  }).visibility({ kind: 'public-read' }),
});
`, `
import { defineQuery } from '${defineUrl}';
export const listRows = defineQuery({ table: 'rows', args: {} });
`);
  assert.equal(boundary.result.ok, true, JSON.stringify(boundary.result.diagnostics));
  const boundaryFunctions = JSON.parse(readFileSync(
    join(boundary.root, 'generated', 'functions.manifest.json'),
    'utf8',
  ));
  const boundaryContract = boundaryFunctions.functions
    .find((candidate) => candidate.name === 'listRows')
    .resultContract.document.fields
    .find((field) => field.name === 'state').value;
  assert.equal(boundaryContract.kind, 'union');
  assert.equal(boundaryContract.variants.length, 8);
  assert.deepEqual(boundaryContract.variants[0], { kind: 'null' });

  const ephemeral = await generateCase(`
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, {
  ephemeral: defineEphemeral({
    cursors: ephemeral.collection({
      scope: { room: v.string() }, routing: ['room'], key: 'connection',
      ttlMs: 1000, maxTtlMs: 2000, maxValueBytes: 128,
      publishRate: { sustainedHz: 1, burst: 2 },
      delivery: { mode: 'latest', dispatchMs: 10 },
      value: v.union([v.literal('open'), v.literal('closed')]),
      publish: allow.all(), subscribe: allow.all(), targets: ['local-dev-sqlite-ibex'],
    }),
  }),
});
`);
  assert.equal(ephemeral.result.ok, false);
  assert(ephemeral.result.diagnostics.some((diagnostic) => (
    diagnostic.code === 'EPHEMERAL_INVALID_VALIDATOR'
  )));

  const legacyResult = await generateCase(`
import { defineSchema } from '${defineUrl}';
export default defineSchema({});
`, `
import { defineAction, v } from '${defineUrl}';
export const probe = defineAction({
  args: {},
  js: { source: 'handler.mjs', exportName: 'probe' },
});
probe.result = v.union([v.literal('open'), v.literal('closed')]);
`);
  writeFileSync(join(legacyResult.root, 'handler.mjs'),
    'globalThis.__snapbackHandlers = { async probe() { return "open"; } };\n');
  const legacyRerun = await generate(legacyResult.root);
  assert.equal(legacyRerun.ok, false);
  assert(legacyRerun.diagnostics.some((diagnostic) => (
    diagnostic.code === 'FUNCTION_INVALID_VALIDATOR'
  )));
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log('stored-enum-authoring.test.mjs: 12 cases passed');
