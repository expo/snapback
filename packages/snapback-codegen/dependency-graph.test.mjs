import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const codegenPath = join(packageRoot, 'index.mjs');
const dirs = [];

function makeBackend() {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-graph-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable } from '${defineUrl}';
import { titleValidator } from './schema-helper.mjs';
export default defineSchema({
  todos: defineTable({ title: titleValidator }).sync(),
  notes: defineTable({ title: titleValidator }).sync(),
});
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import { selectedTable } from './function-helper.mjs';
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);
  writeFileSync(join(dir, 'schema-helper.mjs'), `
import { v } from '${defineUrl}';
export const titleValidator = v.string();
`);
  writeFileSync(join(dir, 'function-helper.mjs'), "export const selectedTable = 'todos';\n");
  return dir;
}

function manifests(dir) {
  return {
    schema: JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8')),
    functions: JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8')),
  };
}

// Same-process regeneration: neither entry source changes, only transitive
// helpers. Every affected identity and emitted semantic must change.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = manifests(dir);

  writeFileSync(join(dir, 'schema-helper.mjs'), `
import { v } from '${defineUrl}';
export const titleValidator = v.boolean();
`);
  writeFileSync(join(dir, 'function-helper.mjs'), "export const selectedTable = 'notes';\n");
  const second = await generate(dir);
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const after = manifests(dir);

  assert.notEqual(second.inputsHash, first.inputsHash);
  assert.notEqual(after.schema.schemaHash, before.schema.schemaHash);
  assert.notEqual(after.functions.bundleHash, before.functions.bundleHash);
  assert.equal(after.schema.tables[0].fields[0].field_type, 'Boolean');
  assert.equal(after.functions.functions[0].runtime.HostPlan.Query.table, 'notes');
}

// Across-process regeneration follows the same graph identity contract.
{
  const dir = makeBackend();
  const run = () => spawnSync(process.execPath, [codegenPath, dir], {
    cwd: packageRoot,
    encoding: 'utf8',
  });
  const firstRun = run();
  assert.equal(firstRun.status, 0, firstRun.stderr);
  const before = manifests(dir);
  writeFileSync(join(dir, 'function-helper.mjs'), "export const selectedTable = 'notes';\n");
  const secondRun = run();
  assert.equal(secondRun.status, 0, secondRun.stderr);
  const after = manifests(dir);
  assert.notEqual(after.functions.inputsHash, before.functions.inputsHash);
  assert.notEqual(after.functions.bundleHash, before.functions.bundleHash);
  assert.equal(after.functions.functions[0].runtime.HostPlan.Query.table, 'notes');
}

// Dynamic and query/hash-qualified local imports are unprovable graph edges;
// fail before evaluation and preserve existing generated output.
for (const [source, expectedCode] of [
  [`
const helperPath = './schema-helper.mjs';
const helper = await import(helperPath);
export default helper.default;
`, 'CODEGEN_DYNAMIC_IMPORT_UNHASHABLE'],
  [`
import schema from './schema-helper.mjs?stale=1';
export default schema;
`, 'CODEGEN_AMBIGUOUS_IMPORT'],
]) {
  const dir = makeBackend();
  writeFileSync(join(dir, 'schema.mjs'), source);
  writeFileSync(join(dir, 'schema-helper.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }) });
`);
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated', 'sentinel.txt'), 'keep\n');
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === expectedCode), JSON.stringify(result.diagnostics));
  assert.equal(readFileSync(join(dir, 'generated', 'sentinel.txt'), 'utf8'), 'keep\n');
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// A CommonJS helper may hide arbitrary transitive require() edges from the ESM
// graph. Reject it before evaluation so changing the hidden leaf can never
// leave a successful generation carrying the old identity.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');

  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import helper from './function-helper.cjs';
export const listRows = defineQuery({ table: helper.selectedTable, args: {} });
`);
  writeFileSync(join(dir, 'function-helper.cjs'), "module.exports = require('./selected-table.cjs');\n");
  writeFileSync(join(dir, 'selected-table.cjs'), "module.exports = { selectedTable: 'notes' };\n");

  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_COMMONJS_MODULE_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
    before,
    'a rejected unprovable graph must not publish a misleading new identity',
  );
}

// createRequire can hide both local and bare dependency resolution behind an
// alias. The token is rejected regardless of the requested specifier.
for (const required of ['./selected-table.cjs', 'environment-package']) {
  const dir = makeBackend();
  writeFileSync(join(dir, 'functions.mjs'), `
import { createRequire as makeRequire } from 'node:module';
import { defineQuery } from '${defineUrl}';
const load = makeRequire(import.meta.url);
const selectedTable = load(${JSON.stringify(required)}).selectedTable;
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);
  writeFileSync(join(dir, 'selected-table.cjs'), "module.exports = { selectedTable: 'notes' };\n");

  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_COMMONJS_LOADER_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// `.js` format is controlled by its nearest package scope. A CommonJS-scoped
// helper is rejected as a whole, including computed `module['require']` forms
// whose loader token cannot be found safely by scanning strings.
{
  const dir = makeBackend();
  const helperDir = join(dir, 'commonjs-helper');
  mkdirSync(helperDir);
  writeFileSync(join(helperDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));
  writeFileSync(join(helperDir, 'selected-table.js'), "module.exports = { selectedTable: 'notes' };\n");
  writeFileSync(
    join(helperDir, 'index.js'),
    "module.exports = module['require']('./selected-table.js');\n",
  );
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import helper from './commonjs-helper/index.js';
export const listRows = defineQuery({ table: helper.selectedTable, args: {} });
`);

  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_COMMONJS_MODULE_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// Supported ESM `.js` helpers retain their semantics, and the package manifest
// that establishes that format participates in identity.
{
  const dir = makeBackend();
  const helperDir = join(dir, 'esm-helper');
  mkdirSync(helperDir);
  const packagePath = join(helperDir, 'package.json');
  writeFileSync(packagePath, JSON.stringify({ type: 'module', version: '1' }));
  writeFileSync(join(helperDir, 'index.js'), "export const selectedTable = 'notes';\n");
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import { selectedTable } from './esm-helper/index.js';
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);

  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = manifests(dir);
  assert.equal(before.functions.functions[0].runtime.HostPlan.Query.table, 'notes');

  writeFileSync(packagePath, JSON.stringify({ type: 'module', version: '2' }));
  const second = await generate(dir);
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const after = manifests(dir);
  assert.notEqual(second.inputsHash, first.inputsHash, 'governing package.json must be hashed');
  assert.notEqual(after.functions.bundleHash, before.functions.bundleHash);

  writeFileSync(packagePath, JSON.stringify({ type: 'commonjs', version: '2' }));
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_COMMONJS_MODULE_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
    `${JSON.stringify(after.functions, null, 2)}\n`,
    'a package-scope format flip must not overwrite the last proven ESM identity',
  );
}

// Even computed access cannot hide a loader when the ESM source imports the
// node:module capability that makes it possible.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'functions.mjs'), `
import Module from 'node:module';
import { defineQuery } from '${defineUrl}';
const makeRequire = Module['create' + 'Require'];
const load = makeRequire(import.meta.url);
const selectedTable = load('./selected-table.cjs').selectedTable;
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);
  writeFileSync(join(dir, 'selected-table.cjs'), "module.exports = { selectedTable: 'notes' };\n");
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_AMBIENT_IMPORT_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// Pure ESM can still escape the graph through Node builtins. A local file read
// must fail before evaluation, and changing that untracked file must never
// publish a new identity or semantics.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  writeFileSync(join(dir, 'selected-table.txt'), 'todos\n');
  writeFileSync(join(dir, 'functions.mjs'), `
import { readFileSync } from 'node:fs';
import { defineQuery } from '${defineUrl}';
const selectedTable = readFileSync(new URL('./selected-table.txt', import.meta.url), 'utf8').trim();
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);

  for (const selectedTable of ['todos', 'notes']) {
    writeFileSync(join(dir, 'selected-table.txt'), `${selectedTable}\n`);
    const rejected = await generate(dir);
    assert.equal(rejected.ok, false);
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_AMBIENT_IMPORT_UNHASHABLE'),
      JSON.stringify(rejected.diagnostics),
    );
    assert.equal(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'), before);
  }
}

// Computed property names do not evade the ambient-capability boundary: the
// host-global root itself is rejected before it can recover a builtin loader.
for (const source of [
  `
const fs = process['get' + 'BuiltinModule']('node:fs');
export const selectedTable = fs.readFileSync(new URL('./selected-table.txt', import.meta.url), 'utf8').trim();
`,
  `
const hostProcess = globalThis['pro' + 'cess'];
const fs = hostProcess['get' + 'BuiltinModule']('node:fs');
export const selectedTable = fs.readFileSync(new URL('./selected-table.txt', import.meta.url), 'utf8').trim();
`,
]) {
  const dir = makeBackend();
  writeFileSync(join(dir, 'selected-table.txt'), 'notes\n');
  writeFileSync(join(dir, 'function-helper.mjs'), source);
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_AMBIENT_ACCESS_UNHASHABLE'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// Bare ESM dependencies remain environment-dependent and must fail before
// module evaluation just as they did before CommonJS hardening.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import { selectedTable } from 'environment-package';
export const listRows = defineQuery({ table: selectedTable, args: {} });
`);
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_AMBIGUOUS_IMPORT'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('dependency-graph.test.mjs: all cases passed');
