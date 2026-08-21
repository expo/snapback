// Focused codegen regression suite for generated artifact correctness.
//
// Run: node demos/_kit/tests/codegen-regressions.mjs

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, assertEqual, createSuite } from '../harness.mjs';
import { generate } from '../codegen.mjs';

const repoRoot = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..', '..');
const suite = createSuite('snapback codegen regressions');
const roots = [];

function fixture(name) {
  const root = mkdtempSync(join(repoRoot, 'demos', `.tmp-codegen-${name}-`));
  const backend = join(root, 'snapback');
  mkdirSync(backend, { recursive: true });
  roots.push(root);
  return { root, backend };
}

function writeBackend(backend, {
  schema,
  functions,
  handler = null,
  demo = null,
  contractMetadata = null,
}) {
  writeFileSync(join(backend, 'schema.mjs'), schema);
  writeFileSync(join(backend, 'functions.mjs'), functions);
  if (handler !== null) writeFileSync(join(backend, 'handlers.mjs'), handler);
  if (demo !== null) writeFileSync(join(backend, '..', 'demo.snapback.json'), JSON.stringify(demo, null, 2));
  if (contractMetadata !== null) {
    writeFileSync(join(backend, 'codegen.policy.json'), JSON.stringify({
      schemaVersion: 'snapback.codegen-policy.v1',
      committedProjections: [],
      contractMetadata,
    }, null, 2));
  }
}

const baseSchema = `
import { defineSchema, defineTable, v } from '../../_kit/define.mjs';
export default defineSchema({
  things: defineTable({
    title: v.string(),
    note: v.optional(v.string()),
  }).visibility({ kind: 'public-read' }).sync(),
});
`;

try {
  await suite.check('optional args and stored nullable row fields survive every generated surface', async () => {
    const { backend } = fixture('optional');
    writeBackend(backend, {
      schema: baseSchema,
      contractMetadata: 'exact',
      functions: `
import { argOpt, defineLiveQuery, eq, v } from '../../_kit/define.mjs';
export const listThings = defineLiveQuery({
  table: 'things',
  args: { title: v.optional(v.string()), nested: v.optional(v.object({ maybe: v.optional(v.number()) })) },
  filter: [eq('title', argOpt('title'))],
});
`,
    });
    const result = await generate(backend);
    assert(result.ok, `codegen failed: ${JSON.stringify(result.diagnostics)}`);
    const binding = result.contractManifest.queries.listThings;
    assertEqual(binding.args.title, { shape: 'primitive', name: 'string', optional: true }, 'optional arg descriptor');
    assertEqual(binding.args.nested.fields.maybe, { shape: 'primitive', name: 'number', optional: true }, 'nested arg descriptor');
    assertEqual(binding.result.row.fields.note, {
      shape: 'union',
      variants: [
        { shape: 'literal', value: null },
        { shape: 'primitive', name: 'string' },
      ],
    }, 'stored optional row descriptor is a required nullable scalar');
    const apiTypes = readFileSync(join(backend, 'generated', 'api.d.ts'), 'utf8');
    assert(/title\?: string/.test(apiTypes), 'top-level optional arg is omittable in api.d.ts');
    assert(/note: null \| string/.test(apiTypes), 'stored optional row field is required and nullable in api.d.ts');
    const meta = readFileSync(join(backend, 'generated', 'contract', 'listThings.query.contract-meta.ts'), 'utf8');
    assert(/"note":"null \| string"/.test(meta), 'Contract shape carries the stored nullable row field');
    return { inputsHash: result.inputsHash };
  });

  await suite.check('JS mutation Contract descriptors include invalidates', async () => {
    const { backend } = fixture('js-mutation');
    writeBackend(backend, {
      schema: baseSchema,
      contractMetadata: 'exact',
      functions: `
import { defineJsMutation, v } from '../../_kit/define.mjs';
export const saveThing = defineJsMutation({
  source: 'handlers.mjs',
  exportName: 'saveThing',
  writes: ['things'],
  args: { title: v.string() },
});
`,
      handler: 'function saveThing() { return { ok: true }; }\n',
    });
    const result = await generate(backend);
    assert(result.ok, `codegen failed: ${JSON.stringify(result.diagnostics)}`);
    assertEqual(result.contractManifest.mutations.saveThing.invalidates, ['things'], 'contract-data mutation invalidates');
    const meta = readFileSync(join(backend, 'generated', 'contract', 'saveThing.mutation.contract-meta.ts'), 'utf8');
    assert(/invalidates: \["things"\]/.test(meta), 'Contract mutation sidecar invalidates');
    return { mutation: 'saveThing' };
  });

  await suite.check('in-process generate cache-busts changed schema/function modules', async () => {
    const { backend } = fixture('cache-bust');
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const firstQuery = defineQuery({ table: 'things' });
`,
    });
    const first = await generate(backend);
    assert(first.ok, `first codegen failed: ${JSON.stringify(first.diagnostics)}`);
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const secondQuery = defineQuery({ table: 'things' });
`,
    });
    const second = await generate(backend);
    assert(second.ok, `second codegen failed: ${JSON.stringify(second.diagnostics)}`);
    assertEqual(second.functionManifest.functions.map((fn) => fn.name), ['secondQuery'], 'fresh module exports after rewrite');
    return { first: first.inputsHash, second: second.inputsHash };
  });

  await suite.check('demo manifest identity participates in inputsHash', async () => {
    const { backend } = fixture('demo-identity');
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const listThings = defineQuery({ table: 'things' });
`,
      demo: { id: 'first-demo', app: { name: 'Demo Identity' } },
    });
    const first = await generate(backend);
    assert(first.ok, `first codegen failed: ${JSON.stringify(first.diagnostics)}`);
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const listThings = defineQuery({ table: 'things' });
`,
      demo: { id: 'second-demo', app: { name: 'Demo Identity' } },
    });
    const second = await generate(backend);
    assert(second.ok, `second codegen failed: ${JSON.stringify(second.diagnostics)}`);
    assert(first.inputsHash !== second.inputsHash, 'demo manifest change should change inputsHash');
    return { first: first.inputsHash, second: second.inputsHash };
  });

  await suite.check('reserved generated API exports fail loudly', async () => {
    const { backend } = fixture('reserved');
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const ephemeral = defineQuery({ table: 'things' });
`,
    });
    const result = await generate(backend);
    assert(!result.ok, 'reserved export must fail codegen');
    assert(result.diagnostics.some((d) => d.code === 'FUNCTION_RESERVED_EXPORT'), `missing reserved diagnostic: ${JSON.stringify(result.diagnostics)}`);
    return { codes: result.diagnostics.map((d) => d.code) };
  });

  await suite.check('__proto__ authored names are emitted as own JSON keys', async () => {
    const { backend } = fixture('proto');
    writeBackend(backend, {
      schema: `
import { defineSchema, defineTable, v } from '../../_kit/define.mjs';
export default defineSchema({
  ['__proto__']: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const readProto = defineQuery({ table: '__proto__' });
`,
    });
    const result = await generate(backend);
    assert(result.ok, `codegen failed: ${JSON.stringify(result.diagnostics)}`);
    assert(result.schemaManifest.tables.some((table) => table.name === '__proto__'), '__proto__ table is present');
    assert(Object.prototype.hasOwnProperty.call(result.contractManifest.queries, 'readProto'), 'query map has own readProto key');
    return { tables: result.schemaManifest.tables.map((table) => table.name) };
  });

  await suite.check('case-insensitive Contract module filename collisions fail before emit', async () => {
    const { backend } = fixture('case-collision');
    writeBackend(backend, {
      schema: baseSchema,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const LISTTHINGS = defineQuery({ table: 'things' });
export const listthings = defineQuery({ table: 'things' });
`,
    });
    const result = await generate(backend);
    assert(!result.ok, 'case collision must fail codegen');
    assert(result.diagnostics.some((d) => d.code === 'CODEGEN_CONTRACT_MODULE_FILENAME_COLLISION'), `missing collision diagnostic: ${JSON.stringify(result.diagnostics)}`);
    return { codes: result.diagnostics.map((d) => d.code) };
  });

  await suite.check('handler source scanner preserves template expressions and masks regex literals', async () => {
    const bad = fixture('template-fetch');
    writeBackend(bad.backend, {
      schema: baseSchema,
      functions: `
import { defineJsQuery, v } from '../../_kit/define.mjs';
export const listThings = defineJsQuery({
  source: 'handlers.mjs',
  exportName: 'listThings',
  reads: ['things'],
  result: v.object({ title: v.string() }),
});
`,
      handler: 'function listThings() { return `${fetch("https://example.com")}`; }\n',
    });
    const badResult = await generate(bad.backend);
    assert(!badResult.ok && badResult.diagnostics.some((d) => d.code === 'BUNDLE_UNSUPPORTED_FETCH'), `template fetch was not caught: ${JSON.stringify(badResult.diagnostics)}`);

    const good = fixture('regex-fetch');
    writeBackend(good.backend, {
      schema: baseSchema,
      functions: `
import { defineJsQuery, v } from '../../_kit/define.mjs';
export const listThings = defineJsQuery({
  source: 'handlers.mjs',
  exportName: 'listThings',
  reads: ['things'],
  result: v.object({ title: v.string() }),
});
`,
      handler: 'function listThings() { const pattern = /fetch\\s*\\(/; return []; }\n',
    });
    const goodResult = await generate(good.backend);
    assert(goodResult.ok, `regex literal should not trip ambient fetch scan: ${JSON.stringify(goodResult.diagnostics)}`);
    return { bad: badResult.diagnostics.map((d) => d.code), good: goodResult.inputsHash };
  });

  await suite.check('invalid ephemeral key modes fail instead of defaulting to connection', async () => {
    const { backend } = fixture('ephemeral-key-mode');
    writeBackend(backend, {
      schema: `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '../../_kit/define.mjs';
export default defineSchema({
  things: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
}, {
  ephemeral: defineEphemeral({
    cursors: ephemeral.collection({
      scope: { boardId: v.string() },
      key: 'conection',
      ttlMs: 5_000,
      value: v.object({ x: v.number(), y: v.number() }),
      publish: allow.all(),
      subscribe: allow.all(),
    }),
  }),
});
`,
      functions: `
import { defineQuery } from '../../_kit/define.mjs';
export const listThings = defineQuery({ table: 'things' });
`,
    });
    const result = await generate(backend);
    assert(!result.ok, 'invalid ephemeral key mode must fail codegen');
    assert(result.diagnostics.some((d) => d.code === 'EPHEMERAL_UNSUPPORTED_KEY_MODE'), `missing key-mode diagnostic: ${JSON.stringify(result.diagnostics)}`);
    return { codes: result.diagnostics.map((d) => d.code) };
  });
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

const report = suite.finish();
process.exit(report.ok ? 0 : 1);
