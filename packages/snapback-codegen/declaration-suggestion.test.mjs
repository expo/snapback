import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  applyDeclarationSuggestion,
  DECLARATION_SUGGESTION_REASON_CODES,
  suggestDeclarations,
} from './declaration-suggestion.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const schema = JSON.parse(readFileSync(join(packageRoot, 'declaration-suggestion.schema.json'), 'utf8'));
const validateProtocol = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
const roots = [];
let assertions = 0;
const check = (value, message) => {
  assertions += 1;
  assert(value, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  assertions += 1;
  assert.deepEqual(actual, expected, message);
};

function fixture({ explicitStoredResult = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-declaration-suggestion-'));
  roots.push(root);
  const appRoot = join(root, 'app');
  const backend = join(appRoot, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(appRoot, 'demo.snapback.json'), JSON.stringify({ id: 'suggestion-golden' }));
  const modules = join(appRoot, 'node_modules', '@expo');
  mkdirSync(modules, { recursive: true });
  symlinkSync(packageRoot, join(modules, 'snapback-codegen'), 'dir');
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  todos: defineTable({ title: v.string(), completed: v.boolean() }).sync().visibility({ kind: 'public-read' }),
});
`);
  const storedResult = explicitStoredResult
    ? '  result: results.records(v.object({ "doc": v.doc("todos"), "computed": v.boolean() })),\n'
    : '';
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineJsMutation, defineJsQuery, v${explicitStoredResult ? ', results' : ''} } from '@expo/snapback-codegen/define';
export const storedWithComputed = defineJsQuery({
  args: { id: v.id('todos') },
  reads: ['todos'],
${storedResult}  handler: async (ctx, args) => {
    const doc = await ctx.db.get('todos', args.id);
    return doc ? [{ doc, computed: true }] : [];
  },
});
export const anyResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'anyResult',
});
export const recursiveResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'recursiveResult',
});
export const literalResult = defineJsMutation({
  args: {},
  writes: ['todos'],
  handler: async () => true,
});
export const optionalNullable = defineJsMutation({
  args: {},
  writes: ['todos'],
  source: 'handlers.ts',
  exportName: 'optionalNullable',
});
export const primitiveTupleQuery = defineJsQuery({
  args: {},
  reads: ['todos'],
  source: 'handlers.ts',
  exportName: 'primitiveTupleQuery',
});
`);
  writeFileSync(join(backend, 'handlers.ts'), `
interface RecursiveNode {
  ok: true;
  next?: RecursiveNode;
}
globalThis.__snapbackHandlers = {
  async anyResult(): Promise<any> {
    return { ok: true };
  },
  async recursiveResult(): Promise<RecursiveNode> {
    return { ok: true };
  },
  async optionalNullable(): Promise<{ maybe?: true | null }> {
    return { maybe: null };
  },
  async primitiveTupleQuery(): Promise<readonly [true]> {
    return [true] as const;
  },
};
`);
  return backend;
}

function onlySuggestion(backend, operation) {
  const result = suggestDeclarations({ backendDir: backend, operation });
  equal(result.ok, true, JSON.stringify(result.diagnostics));
  equal(result.suggestions.length, 1);
  return { result, suggestion: result.suggestions[0] };
}

function resultHash(backend, name) {
  const manifest = JSON.parse(readFileSync(join(backend, 'generated', 'functions.manifest.json'), 'utf8'));
  return manifest.functions.find((entry) => entry.name === name).resultContractHash;
}

try {
  const golden = fixture();
  const primed = await generate(golden);
  equal(primed.ok, true, JSON.stringify(primed.diagnostics));

  const all = suggestDeclarations({ backendDir: golden });
  equal(all.ok, true, JSON.stringify(all.diagnostics));
  equal(validateProtocol(all), true, JSON.stringify(validateProtocol.errors));
  deepEqual(DECLARATION_SUGGESTION_REASON_CODES, schema.$defs.reasonCode.enum);

  const stored = all.suggestions.find(({ operation }) => operation.name === 'storedWithComputed');
  equal(stored.status, 'schema-derived', JSON.stringify(stored));
  equal(
    stored.declaration.after,
    'result: results.records(v.object({ "doc": v.doc("todos"), "computed": v.boolean() }))',
  );
  check(stored.evidence.some(({ contractExpression }) => contractExpression === 'v.doc("todos")'));
  check(stored.evidence.some(({ confidence }) => confidence === 'schema-derived'));

  const any = all.suggestions.find(({ operation }) => operation.name === 'anyResult');
  equal(any.status, 'holed');
  equal(any.declaration.after, null);
  equal(any.holes[0].code, 'SNAPBACK_AUTHORING_RETURN_ANY_UNRESOLVED');
  check(!JSON.stringify(any).includes('result: any'), 'an any return must never produce an any contract');

  const recursive = all.suggestions.find(({ operation }) => operation.name === 'recursiveResult');
  equal(recursive.status, 'refused');
  equal(recursive.diagnostics[0].code, 'SNAPBACK_AUTHORING_RECURSIVE_RETURN_UNSUPPORTED');

  const optionalNullable = all.suggestions.find(({ operation }) => operation.name === 'optionalNullable');
  equal(optionalNullable.status, 'exact');
  check(optionalNullable.declaration.after.includes('v.optional('));
  check(optionalNullable.declaration.after.includes('v.null()'));

  const primitiveTuple = all.suggestions.find(({ operation }) => operation.name === 'primitiveTupleQuery');
  equal(primitiveTuple.status, 'refused');
  equal(primitiveTuple.diagnostics[0].code, 'SNAPBACK_AUTHORING_RESULT_SHAPE_UNSUPPORTED');

  const applied = applyDeclarationSuggestion(stored);
  equal(applied.ok, true, JSON.stringify(applied.diagnostics));
  equal(validateProtocol(applied), true, JSON.stringify(validateProtocol.errors));
  const generatedAfterApply = await generate(golden);
  equal(generatedAfterApply.ok, true, JSON.stringify(generatedAfterApply.diagnostics));
  const suggestedHash = resultHash(golden, 'storedWithComputed');

  const handwritten = fixture({ explicitStoredResult: true });
  const generatedHandwritten = await generate(handwritten);
  equal(generatedHandwritten.ok, true, JSON.stringify(generatedHandwritten.diagnostics));
  equal(
    suggestedHash,
    resultHash(handwritten, 'storedWithComputed'),
    'suggest/apply must enter the normal result-contract hash path byte-for-byte equivalently',
  );

  const sourceCas = fixture();
  equal((await generate(sourceCas)).ok, true);
  const sourceSuggestion = onlySuggestion(sourceCas, 'storedWithComputed').suggestion;
  const sourcePath = join(sourceCas, 'functions.mjs');
  writeFileSync(sourcePath, `${readFileSync(sourcePath, 'utf8')}\n// concurrent source edit\n`);
  const changedSource = readFileSync(sourcePath);
  const sourceStale = applyDeclarationSuggestion(sourceSuggestion);
  equal(sourceStale.ok, false);
  equal(sourceStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(sourcePath), changedSource, 'stale apply changed source bytes');

  const schemaCas = fixture();
  equal((await generate(schemaCas)).ok, true);
  const schemaSuggestion = onlySuggestion(schemaCas, 'storedWithComputed').suggestion;
  const schemaPath = join(schemaCas, 'schema.mjs');
  writeFileSync(schemaPath, `${readFileSync(schemaPath, 'utf8')}\n// concurrent schema edit\n`);
  const schemaSourceBeforeApply = readFileSync(join(schemaCas, 'functions.mjs'));
  const schemaStale = applyDeclarationSuggestion(schemaSuggestion);
  equal(schemaStale.ok, false);
  equal(schemaStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(join(schemaCas, 'functions.mjs')), schemaSourceBeforeApply);

  const boundaryCas = fixture();
  equal((await generate(boundaryCas)).ok, true);
  const boundarySuggestion = onlySuggestion(boundaryCas, 'storedWithComputed').suggestion;
  const boundarySourcePath = join(boundaryCas, 'functions.mjs');
  const boundarySourceBeforeApply = readFileSync(boundarySourcePath);
  let boundaryHookCalls = 0;
  const boundaryStale = applyDeclarationSuggestion(boundarySuggestion, {
    testHooks: {
      beforeFinalAnalysis() {
        boundaryHookCalls += 1;
        const boundarySchemaPath = join(boundaryCas, 'schema.mjs');
        writeFileSync(
          boundarySchemaPath,
          `${readFileSync(boundarySchemaPath, 'utf8')}\n// write-boundary schema edit\n`,
        );
      },
    },
  });
  equal(boundaryHookCalls, 1, 'the non-target edit must occur after the temporary file is built');
  equal(boundaryStale.ok, false);
  equal(boundaryStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(
    readFileSync(boundarySourcePath),
    boundarySourceBeforeApply,
    'write-boundary stale apply changed target source bytes',
  );

  const compilerCas = fixture();
  equal((await generate(compilerCas)).ok, true);
  const compilerSuggestion = structuredClone(onlySuggestion(compilerCas, 'storedWithComputed').suggestion);
  compilerSuggestion.compiler.effectiveOptions.strict = false;
  const compilerSourceBeforeApply = readFileSync(join(compilerCas, 'functions.mjs'));
  const compilerStale = applyDeclarationSuggestion(compilerSuggestion);
  equal(compilerStale.ok, false);
  equal(compilerStale.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  deepEqual(readFileSync(join(compilerCas, 'functions.mjs')), compilerSourceBeforeApply);

  const cleanCas = fixture();
  equal((await generate(cleanCas)).ok, true);
  const cleanSuggestion = onlySuggestion(cleanCas, 'storedWithComputed').suggestion;
  const cleanApply = applyDeclarationSuggestion(cleanSuggestion);
  equal(cleanApply.ok, true, JSON.stringify(cleanApply.diagnostics));
  check(readFileSync(join(cleanCas, 'functions.mjs'), 'utf8').includes(cleanSuggestion.declaration.after));
  equal((await generate(cleanCas)).ok, true, 'ordinary generation must accept the atomic source write');

  const allOperationsCas = fixture();
  equal((await generate(allOperationsCas)).ok, true);
  const allOperationSuggestions = suggestDeclarations({ backendDir: allOperationsCas });
  equal(allOperationSuggestions.ok, true, JSON.stringify(allOperationSuggestions.diagnostics));
  const laterOperationSuggestion = allOperationSuggestions.suggestions.find(
    ({ operation }) => operation.name === 'literalResult',
  );
  equal(laterOperationSuggestion.status, 'exact');
  const laterOperationApply = applyDeclarationSuggestion(laterOperationSuggestion);
  equal(laterOperationApply.ok, true, JSON.stringify(laterOperationApply.diagnostics));
  equal((await generate(allOperationsCas)).ok, true);

  console.log(`declaration-suggestion.test.mjs: ${assertions} assertions passed`);
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}
