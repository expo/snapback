import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { importsExactPackage } from './contract-emitter.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const backend = mkdtempSync(join(tmpdir(), 'snapback-contract-output-mode-'));

function artifactPaths(result) {
  return result.artifactIndex.files.map(({ path }) => path).sort();
}

function contractTypeScriptSources(result) {
  return artifactPaths(result)
    .filter((path) => path.startsWith('contract/') && path.endsWith('.ts'))
    .map((path) => ({
      path,
      source: readFileSync(join(result.outDir, path), 'utf8'),
    }));
}

try {
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};
export default defineSchema({
  todos: defineTable({ title: v.string() }).sync(),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { arg, defineLiveQuery, defineMutation, insert, v } from ${JSON.stringify(defineUrl)};
export const listTodos = defineLiveQuery({ table: 'todos', args: {} });
export const createTodo = defineMutation({
  args: { title: v.string() },
  plan: insert('todos', { title: arg('title') }),
});
`);

  const neutral = await generate(backend);
  assert.equal(neutral.ok, true, JSON.stringify(neutral.diagnostics));
  const neutralPaths = artifactPaths(neutral);
  assert(neutralPaths.includes('contract-data.manifest.json'));
  assert(neutralPaths.includes('contract/runtime-links.ts'));
  assert(neutralPaths.includes('contract/listTodos.query.ts'));
  assert(neutralPaths.includes('contract/createTodo.mutation.ts'));
  assert.equal(
    neutralPaths.some((path) => path.endsWith('.contract-meta.ts')),
    false,
    'ordinary generation must omit Exact-dependent metadata sidecars',
  );
  assert(
    contractTypeScriptSources(neutral).every(({ source }) => !importsExactPackage(source)),
    'the default Contract artifact set must contain no Exact imports',
  );

  // An installed Exact package is intentionally invisible to generation.
  // Identical declared inputs must retain both their identity and output set.
  mkdirSync(join(backend, 'node_modules', '@exact', 'contract'), { recursive: true });
  writeFileSync(join(backend, 'node_modules', '@exact', 'contract', 'package.json'), JSON.stringify({
    name: '@exact/contract',
    version: '999.0.0-test-fixture',
  }));
  const neutralWithExactInstalled = await generate(backend);
  assert.equal(neutralWithExactInstalled.ok, true, JSON.stringify(neutralWithExactInstalled.diagnostics));
  assert.equal(neutralWithExactInstalled.inputsHash, neutral.inputsHash);
  assert.deepEqual(artifactPaths(neutralWithExactInstalled), neutralPaths);

  writeFileSync(join(backend, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    contractMetadata: 'exact',
  }, null, 2));
  const exact = await generate(backend);
  assert.equal(exact.ok, true, JSON.stringify(exact.diagnostics));
  const exactPaths = artifactPaths(exact);
  assert.notEqual(exact.inputsHash, neutral.inputsHash);
  assert.notDeepEqual(exactPaths, neutralPaths);
  assert(exactPaths.includes('contract/listTodos.query.contract-meta.ts'));
  assert(exactPaths.includes('contract/createTodo.mutation.contract-meta.ts'));
  const exactDependentSources = contractTypeScriptSources(exact)
    .filter(({ source }) => importsExactPackage(source));
  assert.deepEqual(
    exactDependentSources.map(({ path }) => path),
    [
      'contract/createTodo.mutation.contract-meta.ts',
      'contract/listTodos.query.contract-meta.ts',
    ],
  );

  const repeatedExact = await generate(backend);
  assert.equal(repeatedExact.ok, true, JSON.stringify(repeatedExact.diagnostics));
  assert.equal(repeatedExact.inputsHash, exact.inputsHash);
  assert.deepEqual(artifactPaths(repeatedExact), exactPaths);
} finally {
  rmSync(backend, { recursive: true, force: true });
}

// The classifier is the guard the whole output split rests on, and everything
// above uses it as an oracle over emitted output — so it needs its own cases.
// A false negative here silently returns an Exact-importing module to the
// neutral default set and reopens the npm-only typecheck defect; the re-export
// and dynamic-import forms are not emitted today and exist to catch template
// drift before it ships.
for (const [label, source, expected] of [
  ['default import', 'import x from "@exact/contract/exports";', true],
  ['named import', 'import { a } from "@exact/contract";', true],
  ['side-effect import', 'import "@exact/contract";', true],
  ['type-only import', 'import type { T } from "@exact/contract/exports";', true],
  ['named re-export', 'export { a } from "@exact/contract";', true],
  ['star re-export', 'export * from "@exact/contract";', true],
  ['dynamic import', 'const m = await import("@exact/contract");', true],
  ['relative import', 'import x from "./runtime-links";', false],
  ['neutral re-export', 'export { a } from "./local";', false],
  ['lookalike scope', 'import x from "@exactly/other";', false],
  ['commented out', '// import x from "@exact/contract";', false],
  ['string literal', 'const s = "import x from @exact/contract";', false],
]) {
  assert.equal(
    importsExactPackage(source),
    expected,
    `importsExactPackage misclassified ${label}: ${source}`,
  );
}

console.log('contract-output-mode.test.mjs: all cases passed');
