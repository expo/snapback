import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineJsMutation } from './define.mjs';
import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const roots = [];

function backend(functions) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-refusal-tracking-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
    import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
    export default defineSchema({
      todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
    });
  `);
  writeFileSync(join(root, 'functions.mjs'), functions);
  return root;
}

const validFunction = `
  import { defineJsMutation, v } from ${JSON.stringify(defineUrl)};
  export const moveTodo = defineJsMutation({
    args: { id: v.id('todos') },
    writes: ['todos'],
    refusals: ['INVITE_CONSUMED', 'STALE_MOVE'],
    trackedRefusals: ['STALE_MOVE'],
    handler: async () => null,
  });
  export const expectedRefusal = defineJsMutation({
    writes: ['todos'],
    refusals: ['EXPECTED_DOMAIN_OUTCOME'],
    handler: async () => null,
  });
`;

try {
  const root = backend(validFunction);
  let generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  const manifest = JSON.parse(
    readFileSync(join(root, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const moveTodo = manifest.functions.find(({ name }) => name === 'moveTodo');
  assert.deepEqual(moveTodo.refusals, ['INVITE_CONSUMED', 'STALE_MOVE']);
  assert.deepEqual(moveTodo.trackedRefusals, ['STALE_MOVE']);
  const expectedRefusal = manifest.functions.find(({ name }) => name === 'expectedRefusal');
  assert.deepEqual(expectedRefusal.refusals, ['EXPECTED_DOMAIN_OUTCOME']);
  assert.equal(
    Object.hasOwn(expectedRefusal, 'trackedRefusals'),
    false,
    'omission defaults to no tracked application refusals',
  );

  const introspection = JSON.parse(
    readFileSync(join(root, 'generated', 'provider-introspection.json'), 'utf8'),
  );
  const publicMutation = introspection.operations.mutations.find(({ name }) => name === 'moveTodo');
  assert.equal(Object.hasOwn(publicMutation, 'refusals'), false);
  assert.equal(Object.hasOwn(publicMutation, 'trackedRefusals'), false);

  assert.throws(
    () => defineJsMutation({
      writes: ['todos'],
      refusals: ['STALE_MOVE'],
      trackedRefusals: ['NOT_DECLARED'],
      handler: async () => null,
    }),
    /tracked refusal NOT_DECLARED must also appear in refusals/u,
  );
  assert.throws(
    () => defineJsMutation({
      writes: ['todos'],
      refusals: ['STALE_MOVE'],
      trackedRefusals: ['STALE_MOVE', 'STALE_MOVE'],
      handler: async () => null,
    }),
    /tracks duplicate refusal STALE_MOVE/u,
  );

  writeFileSync(join(root, 'functions.mjs'), `${validFunction}\nmoveTodo.trackedRefusals = ['NOT_DECLARED'];\n`);
  generated = await generate(root);
  assert.equal(generated.ok, false, 'defensive codegen validation must reject a mutated definition');
  assert(generated.diagnostics.some(({ code, message }) => (
    code === 'FUNCTION_TRACKED_REFUSAL_INVALID'
      && /tracked refusal NOT_DECLARED must also appear in refusals/u.test(message)
  )), JSON.stringify(generated.diagnostics));

  console.log('refusal-tracking-authoring.test.mjs: authoring, manifest, projection, and validation pass');
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
