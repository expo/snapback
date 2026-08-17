import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { resolveHandlerSourceCapability } from './file-read-capability.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const codegenPath = join(packageRoot, 'index.mjs');
const codegenUrl = pathToFileURL(codegenPath).href;
const dirs = [];

// The isolated evaluator's filesystem backstop depends on the stable Node 24+
// permission model. Pin an actual denied read, not only permission.has().
{
  const deniedPath = join(packageRoot, 'define.mjs');
  const probe = spawnSync(process.execPath, [
    '--permission',
    '--input-type=module',
    '--eval',
    `
import fs from 'node:fs';
const finish = (code) => { console.log(code); process.exit(code === 'ERR_ACCESS_DENIED' ? 0 : 2); };
try {
  fs.readFileSync(${JSON.stringify(deniedPath)}, 'utf8');
  finish('READ_ALLOWED');
} catch (error) {
  finish(error.code ?? 'UNKNOWN_ERROR');
}
`,
  ], { encoding: 'utf8' });
  assert.equal(probe.status, 0, probe.stderr || probe.stdout);
  assert.equal(probe.stdout.trim(), 'ERR_ACCESS_DENIED');
}

function makeBackend() {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-graph-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable } from '${defineUrl}';
import { titleValidator } from './schema-helper.mjs';
export default defineSchema({
  todos: defineTable({ title: titleValidator }).visibility({ kind: 'public-read' }).sync(),
  notes: defineTable({ title: titleValidator }).visibility({ kind: 'public-read' }).sync(),
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

function assertChildGeneration(child, label) {
  assert.equal(child.status, 0, `${label}: ${child.stderr || child.stdout}`);
  const result = JSON.parse(child.stdout.trim());
  assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.diagnostics)}`);
}

function moduleGenerationScript(dir) {
  return `
import { generate } from ${JSON.stringify(codegenUrl)};
const result = await generate(${JSON.stringify(dir)});
process.stdout.write(JSON.stringify(result));
if (!result.ok) process.exitCode = 2;
`;
}

// The cache-busting worker starts from an explicit process contract. CLI flags
// accepted by a string/stdin parent must never be replayed against the worker
// filename, and preload/debug authority must not cross through execArgv or
// NODE_OPTIONS. Each case failed or ran the preload twice before the worker
// pinned execArgv/cwd/env.
{
  const dir = makeBackend();

  const inputType = spawnSync(process.execPath, ['--input-type=module'], {
    cwd: dir,
    env: process.env,
    input: moduleGenerationScript(dir),
    encoding: 'utf8',
  });
  assertChildGeneration(inputType, '--input-type parent');

  const evalScript = `
if (process.env.SNAPBACK_CODEGEN_EVAL_PARENT !== '1') process.exit(23);
delete process.env.SNAPBACK_CODEGEN_EVAL_PARENT;
import(${JSON.stringify(codegenUrl)}).then(async ({ generate }) => {
  const result = await generate(${JSON.stringify(dir)});
  process.stdout.write(JSON.stringify(result));
  if (!result.ok) process.exitCode = 2;
}).catch((error) => { console.error(error); process.exitCode = 3; });
`;
  const evalParent = spawnSync(process.execPath, ['--eval', evalScript], {
    cwd: dir,
    env: { ...process.env, SNAPBACK_CODEGEN_EVAL_PARENT: '1' },
    encoding: 'utf8',
  });
  assertChildGeneration(evalParent, '--eval parent');

  const preloadPath = join(dir, 'preload.cjs');
  const preloadLog = join(dir, 'preload.log');
  const runnerPath = join(dir, 'runner.mjs');
  writeFileSync(preloadPath, `
require('node:fs').appendFileSync(process.env.SNAPBACK_PRELOAD_LOG, String(process.pid) + '\\n');
`);
  writeFileSync(runnerPath, moduleGenerationScript(dir));
  const preloadEnv = { ...process.env, SNAPBACK_PRELOAD_LOG: preloadLog };

  const inspectParent = spawnSync(process.execPath, ['--inspect=0', runnerPath], {
    cwd: dir,
    env: process.env,
    encoding: 'utf8',
  });
  assertChildGeneration(inspectParent, '--inspect parent');
  assert.equal(
    inspectParent.stderr.match(/Debugger listening on/g)?.length ?? 0,
    1,
    'only the explicitly inspected caller may open a debug endpoint',
  );

  const requireParent = spawnSync(process.execPath, ['--require', preloadPath, runnerPath], {
    cwd: dir,
    env: preloadEnv,
    encoding: 'utf8',
  });
  assertChildGeneration(requireParent, '--require parent');
  assert.equal(readFileSync(preloadLog, 'utf8').trim().split('\n').length, 1, '--require preload must run only in the caller');

  writeFileSync(preloadLog, '');
  const nodeOptionsParent = spawnSync(process.execPath, [runnerPath], {
    cwd: dir,
    env: { ...preloadEnv, NODE_OPTIONS: `--require=${preloadPath}` },
    encoding: 'utf8',
  });
  assertChildGeneration(nodeOptionsParent, 'NODE_OPTIONS parent');
  assert.equal(readFileSync(preloadLog, 'utf8').trim().split('\n').length, 1, 'NODE_OPTIONS preload must run only in the caller');
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

// Source is byte input, so its framing must not rely on a byte that source may
// itself contain. These two variants used to collide under `items.join("\0")`:
// the `\0z-handler.mjs\0` boundary is moved from the second handler into the
// first, while the second handler changes from one all-comment line to live
// runtime code. The emitted manifests are intentionally different, and both
// the whole-input identity and runtime bundle identity must say so.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineJsQuery } from '${defineUrl}';
export const alpha = defineJsQuery({ source: 'a-handler.mjs', exportName: 'alpha', reads: ['todos'] });
export const zeta = defineJsQuery({ source: 'z-handler.mjs', exportName: 'zeta', reads: ['todos'] });
`);
  const firstHandler = "globalThis.__snapbackHandlers = { alpha() { return 'alpha'; } };\n//";
  const secondPath = 'z-handler.mjs';
  const liveSecondHandler = "globalThis.__snapbackHandlers = { zeta() { return 'live'; } };";
  const commentedSecondHandler = `//\0${secondPath}\0${liveSecondHandler}`;
  const shiftedFirstHandler = `${firstHandler}\0${secondPath}\0//`;
  assert.equal(
    ['a-handler.mjs', firstHandler, secondPath, commentedSecondHandler].join('\0'),
    ['a-handler.mjs', shiftedFirstHandler, secondPath, liveSecondHandler].join('\0'),
    'the fixture must collide under the retired delimiter-only framing',
  );

  writeFileSync(join(dir, 'a-handler.mjs'), firstHandler);
  writeFileSync(join(dir, secondPath), commentedSecondHandler);
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const firstManifestSource = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const firstManifest = JSON.parse(firstManifestSource);

  writeFileSync(join(dir, 'a-handler.mjs'), shiftedFirstHandler);
  writeFileSync(join(dir, secondPath), liveSecondHandler);
  const second = await generate(dir);
  assert.equal(second.ok, true, JSON.stringify(second.diagnostics));
  const secondManifestSource = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const secondManifest = JSON.parse(secondManifestSource);

  assert.notEqual(secondManifestSource, firstManifestSource, 'the runtime handler bytes must actually differ');
  assert.notEqual(second.inputsHash, first.inputsHash, 'NUL-containing sources must not collide in the complete input identity');
  assert.notEqual(secondManifest.bundleHash, firstManifest.bundleHash, 'NUL-containing runtime handlers must not collide in bundle identity');
}

// Handler declarations are an app-rooted file capability, not a privileged
// read primitive. Lexical aliases and realpath escapes fail before reading;
// the last proven artifact survives. An in-root symlink is accepted but its
// fd-attested target supplies the canonical POSIX identity and exact bytes.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const outside = mkdtempSync(join(tmpdir(), 'snapback-codegen-outside-'));
  dirs.push(outside);
  const outsideHandler = join(outside, 'secret.mjs');
  writeFileSync(outsideHandler, "globalThis.__snapbackHandlers = { escaped() { return 'LOCAL_SECRET'; } };\n");
  symlinkSync(outsideHandler, join(dir, 'outside-link.mjs'));
  mkdirSync(join(dir, 'directory.mjs'));
  writeFileSync(join(dir, 'handler.txt'), "globalThis.__snapbackHandlers = { escaped() { return 'text'; } };\n");
  assert.throws(
    () => resolveHandlerSourceCapability(dir, ''),
    (error) => error.codegenCode === 'BUNDLE_SOURCE_PATH_INVALID',
  );

  const rejectedPaths = [
    '../secret.mjs',
    '%2e%2e/secret.mjs',
    '..\\secret.mjs',
    outsideHandler,
    pathToFileURL(outsideHandler).href,
    '.',
    'nested//handler.mjs',
    'outside-link.mjs',
    'directory.mjs',
    'handler.txt',
  ];
  for (const sourcePath of rejectedPaths) {
    writeFileSync(join(dir, 'functions.mjs'), `
import { defineJsQuery } from '${defineUrl}';
export const escaped = defineJsQuery({ source: ${JSON.stringify(sourcePath)}, exportName: 'escaped', reads: ['todos'] });
`);
    const rejected = await generate(dir);
    assert.equal(rejected.ok, false, `${sourcePath}: escaped handler path unexpectedly succeeded`);
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code.startsWith('BUNDLE_SOURCE_')),
      `${sourcePath}: ${JSON.stringify(rejected.diagnostics)}`,
    );
    assert.equal(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'), before);
  }

  mkdirSync(join(dir, 'handlers'));
  const realHandler = join(dir, 'handlers', 'real.mjs');
  writeFileSync(realHandler, "globalThis.__snapbackHandlers = { escaped() { return 'inside'; } };\n");
  symlinkSync(realHandler, join(dir, 'inside-link.mjs'));
  assert.equal(
    resolveHandlerSourceCapability(dir, 'inside-link.mjs').identity,
    'handlers/real.mjs',
  );
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineJsQuery } from '${defineUrl}';
export const escaped = defineJsQuery({ source: 'inside-link.mjs', exportName: 'escaped', reads: ['todos'] });
`);
  const accepted = await generate(dir);
  assert.equal(accepted.ok, true, JSON.stringify(accepted.diagnostics));
  assert(accepted.functionManifest.functions[0].runtime.IbexModule.source.includes("return 'inside'"));

  const swapPath = join(dir, 'swap.mjs');
  const replacementPath = join(dir, 'replacement.mjs');
  writeFileSync(swapPath, "globalThis.__snapbackHandlers = { swap() { return 'old'; } };\n");
  writeFileSync(replacementPath, "globalThis.__snapbackHandlers = { swap() { return 'new'; } };\n");
  const finalSwap = resolveHandlerSourceCapability(dir, 'swap.mjs', {
    beforeOpen() {
      rmSync(swapPath);
      renameSync(replacementPath, swapPath);
    },
  });
  assert.throws(
    () => finalSwap.read(),
    (error) => error.codegenCode === 'BUNDLE_SOURCE_CHANGED_DURING_READ',
  );

  mkdirSync(join(dir, 'parent'));
  mkdirSync(join(dir, 'replacement-parent'));
  writeFileSync(join(dir, 'parent', 'handler.mjs'), "globalThis.__snapbackHandlers = { swap() { return 'old-parent'; } };\n");
  writeFileSync(join(dir, 'replacement-parent', 'handler.mjs'), "globalThis.__snapbackHandlers = { swap() { return 'new-parent'; } };\n");
  const parentSwap = resolveHandlerSourceCapability(dir, 'parent/handler.mjs', {
    beforeOpen() {
      renameSync(join(dir, 'parent'), join(dir, 'retired-parent'));
      renameSync(join(dir, 'replacement-parent'), join(dir, 'parent'));
    },
  });
  assert.throws(
    () => parentSwap.read(),
    (error) => error.codegenCode === 'BUNDLE_SOURCE_CHANGED_DURING_READ',
  );
}

// Optional fixed-name inputs use the same containment boundary. A seed symlink
// outside the backend is rejected without replacing the prior artifacts.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'artifacts.json'), 'utf8');
  const outside = mkdtempSync(join(tmpdir(), 'snapback-codegen-seed-outside-'));
  dirs.push(outside);
  const outsideSeed = join(outside, 'seed.json');
  writeFileSync(outsideSeed, '{"todos":[]}\n');
  symlinkSync(outsideSeed, join(dir, 'seed.json'));
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(rejected.diagnostics.some((diagnostic) => diagnostic.code === 'SEED_SOURCE_OUTSIDE_ROOT'), JSON.stringify(rejected.diagnostics));
  assert.equal(readFileSync(join(dir, 'generated', 'artifacts.json'), 'utf8'), before);
}

// Definition entry/transitive modules use the same root policy. A relative
// import symlink cannot turn the AST graph builder into an outside-file reader.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const outside = mkdtempSync(join(tmpdir(), 'snapback-codegen-module-outside-'));
  dirs.push(outside);
  const outsideHelper = join(outside, 'function-helper.mjs');
  writeFileSync(outsideHelper, "export const selectedTable = 'notes';\n");
  rmSync(join(dir, 'function-helper.mjs'));
  symlinkSync(outsideHelper, join(dir, 'function-helper.mjs'));
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_IMPORT_OUTSIDE_IDENTITY_ROOT'), JSON.stringify(rejected.diagnostics));
  assert.equal(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'), before);
}

// Evaluated definitions cross a strict JSON-data boundary. JSON.stringify's
// coercions are not validation: they would turn non-finite numbers and array
// `undefined` into null, drop object properties, and flatten containers such
// as Map/RegExp to `{}`. Every such value must fail with a structured
// evaluation diagnostic while preserving the last proven artifacts.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const invalidValues = [
    ['NaN', 'NaN', 'SNAPBACK_CODEGEN_DEFINITION_NUMBER_INVALID'],
    ['positive infinity', 'Infinity', 'SNAPBACK_CODEGEN_DEFINITION_NUMBER_INVALID'],
    ['negative infinity', '-Infinity', 'SNAPBACK_CODEGEN_DEFINITION_NUMBER_INVALID'],
    ['negative zero', '-0', 'SNAPBACK_CODEGEN_DEFINITION_NUMBER_INVALID'],
    ['undefined', 'undefined', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['object undefined', '{ kept: 1, dropped: undefined }', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['array undefined', '[1, undefined, 3]', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['sparse array', '[1, , 3]', 'SNAPBACK_CODEGEN_DEFINITION_ARRAY_SHAPE_INVALID'],
    ['array extra property', "Object.assign([1], { extra: 2 })", 'SNAPBACK_CODEGEN_DEFINITION_ARRAY_SHAPE_INVALID'],
    ['function', '() => 1', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['symbol', "Symbol('not-json')", 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['symbol property', "Object.assign({}, { [Symbol('not-json')]: 1 })", 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_SYMBOL_KEY_INVALID'],
    ['bigint', '1n', 'SNAPBACK_CODEGEN_DEFINITION_VALUE_UNSERIALIZABLE'],
    ['map', "new Map([['key', 1]])", 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID'],
    ['set', 'new Set([1])', 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID'],
    ['regexp', '/not-json/', 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID'],
    ['typed array', 'new Uint8Array([1])', 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID'],
    ['date', 'new Date(0)', 'CODEGEN_MODULE_EVALUATION_FAILED'],
    ['custom prototype', 'Object.create({ inherited: true })', 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_PROTOTYPE_INVALID'],
    ['hidden property', "Object.defineProperty({}, 'hidden', { value: 1, enumerable: false })", 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_DESCRIPTOR_INVALID'],
    ['accessor', "Object.defineProperty({}, 'value', { enumerable: true, get() { throw new Error('ACCESSOR_EXECUTED'); } })", 'SNAPBACK_CODEGEN_DEFINITION_OBJECT_DESCRIPTOR_INVALID'],
  ];
  for (const [name, expression, expectedCode] of invalidValues) {
    writeFileSync(join(dir, 'functions.mjs'), `
import { defineMutation, insert, lit } from '${defineUrl}';
const invalidValue = ${expression};
export const mutate = defineMutation({ args: {}, plan: insert('todos', { title: lit(invalidValue) }) });
`);
    const rejected = await generate(dir);
    assert.equal(rejected.ok, false, `${name}: generation unexpectedly succeeded`);
    const diagnostic = rejected.diagnostics.find((candidate) => candidate.code === expectedCode);
    assert(diagnostic, `${name}: ${JSON.stringify(rejected.diagnostics)}`);
    if (expectedCode.startsWith('SNAPBACK_CODEGEN_')) {
      assert.equal(
        diagnostic.path.endsWith('/functions.mjs'),
        true,
        `${name}: source file is retained (${diagnostic.path})`,
      );
    }
    assert(
      rejected.diagnostics.every((diagnostic) => !diagnostic.message.includes('ACCESSOR_EXECUTED')),
      `${name}: normalization must inspect descriptors without invoking accessors`,
    );
    assert.equal(
      readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
      before,
      `${name}: rejected definition data must preserve the last proven artifact`,
    );
  }
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
// alias. Its node:module capability edge is rejected by the AST resolver
// regardless of the requested specifier.
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
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_AMBIENT_IMPORT_UNHASHABLE'),
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

// Package scope lookup stops at node_modules. Without that boundary this
// manifest-less package inherited the app's `type: module`, while Node loaded
// it as CommonJS; its computed module['require'] leaf could then change emitted
// semantics without joining the graph hash. Both hidden-leaf values are now
// refused and the last proven output (including its hashes) remains byte-for-byte.
{
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ type: 'module' }));
  const helperDir = join(dir, 'node_modules', 'manifestless-helper');
  mkdirSync(helperDir, { recursive: true });
  writeFileSync(join(helperDir, 'index.js'), "module.exports = module['require']('./selected-table.cjs');\n");
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineQuery } from '${defineUrl}';
import helper from './node_modules/manifestless-helper/index.js';
export const listRows = defineQuery({ table: helper.selectedTable, args: {} });
`);

  for (const selectedTable of ['todos', 'notes']) {
    writeFileSync(join(helperDir, 'selected-table.cjs'), `module.exports = { selectedTable: ${JSON.stringify(selectedTable)} };\n`);
    const rejected = await generate(dir);
    assert.equal(rejected.ok, false);
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_COMMONJS_MODULE_UNHASHABLE'),
      JSON.stringify(rejected.diagnostics),
    );
    assert.equal(
      readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
      before,
      'a hidden CommonJS leaf must not change output while absent from identity',
    );
  }
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

// Computed property names do not evade the ambient-capability boundary. These
// are deliberately not token-blacklisted: they reach the isolated evaluator,
// where no process capability exists (and its OS permission set denies reads
// even if a future VM escape recovered the evaluator's process object).
for (const escapeSource of [
  (secretPath) => `
const fs = process['get' + 'BuiltinModule']('node:fs');
export const selectedTable = fs.readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
  (secretPath) => `
const hostProcess = globalThis['pro' + 'cess'];
const fs = hostProcess['get' + 'BuiltinModule']('node:fs');
export const selectedTable = fs.readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
]) {
  const dir = makeBackend();
  const secretPath = join(dir, 'selected-table.txt');
  writeFileSync(secretPath, 'notes\n');
  writeFileSync(join(dir, 'function-helper.mjs'), escapeSource(secretPath));
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_MODULE_EVALUATION_FAILED'),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// Dynamic Function-family constructors and reflective global access are not a
// blacklist problem. Each source is admitted by the AST graph, then fails in a
// code-generation-disabled, capability-empty VM. Changing the unhashed file
// under the exact same source cannot change the last published semantics/hash.
for (const escapeSource of [
  (secretPath) => `
const host = Function('return process')();
export const selectedTable = host.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
  (secretPath) => `
const HostFunction = ({}).constructor['constr' + 'uctor'];
const host = HostFunction('return process')();
export const selectedTable = host.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
  (secretPath) => `
const AsyncFunction = (async () => {}).constructor;
const host = AsyncFunction('return process')();
export const selectedTable = host.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
  (secretPath) => `
const host = (0, eval)('process');
export const selectedTable = host.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
  (secretPath) => `
const host = Reflect.get(globalThis, 'pro' + 'cess');
export const selectedTable = host.getBuiltinModule('node:fs').readFileSync(${JSON.stringify(secretPath)}, 'utf8').trim();
`,
]) {
  const dir = makeBackend();
  const first = await generate(dir);
  assert.equal(first.ok, true, JSON.stringify(first.diagnostics));
  const before = readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8');
  const secretPath = join(dir, 'unhashed-selected-table.txt');
  writeFileSync(join(dir, 'function-helper.mjs'), escapeSource(secretPath));
  for (const selectedTable of ['todos', 'notes']) {
    writeFileSync(secretPath, `${selectedTable}\n`);
    const rejected = await generate(dir);
    assert.equal(rejected.ok, false);
    assert(
      rejected.diagnostics.some((diagnostic) => diagnostic.code === 'CODEGEN_MODULE_EVALUATION_FAILED'),
      JSON.stringify(rejected.diagnostics),
    );
    assert.equal(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'), before);
  }
}

// Network and process authority are absent at the VM layer on Node 24, where
// the OS permission model does not yet deny network syscalls.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'function-helper.mjs'), `
const deniedGlobals = ['fetch', 'WebSocket', 'process', 'require', 'module', 'net', 'global', 'Bun', 'Deno'];
export const selectedTable = deniedGlobals.every((name) => typeof globalThis[name] === 'undefined') ? 'notes' : 'todos';
`);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(manifests(dir).functions.functions[0].runtime.HostPlan.Query.table, 'notes');
}

// Ambient nondeterminism is denied too: identical sources cannot derive a
// definition from wall time, randomness, or the host locale/timezone.
for (const source of [
  "export const selectedTable = Date.now() % 2 ? 'todos' : 'notes';\n",
  "export const selectedTable = Math.random() < 0.5 ? 'todos' : 'notes';\n",
  "export const selectedTable = new Intl.DateTimeFormat().resolvedOptions().timeZone === 'UTC' ? 'todos' : 'notes';\n",
  "const method = Reflect.get(String.prototype, 'locale' + 'Compare'); export const selectedTable = Reflect.apply(method, 'ä', ['z']) < 0 ? 'todos' : 'notes';\n",
  "const method = Reflect.get(String.prototype, 'toLocale' + 'LowerCase'); export const selectedTable = Reflect.apply(method, 'I', []) === 'i' ? 'todos' : 'notes';\n",
  "const method = Reflect.get(String.prototype, 'toLocale' + 'UpperCase'); export const selectedTable = Reflect.apply(method, 'i', []) === 'I' ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Number.prototype, 'toLocale' + 'String'); export const selectedTable = Reflect.apply(method, 1234, []).includes(',') ? 'todos' : 'notes';\n",
  "const method = Reflect.get(BigInt.prototype, 'toLocale' + 'String'); export const selectedTable = Reflect.apply(method, 1234n, []).includes(',') ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Array.prototype, 'toLocale' + 'String'); export const selectedTable = Reflect.apply(method, [1234], []).includes(',') ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Object.prototype, 'toLocale' + 'String'); export const selectedTable = Reflect.apply(method, {}, []).length ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Uint8Array.prototype, 'toLocale' + 'String'); export const selectedTable = Reflect.apply(method, new Uint8Array([1]), []).length ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Date.prototype, 'toLocale' + 'String'); export const selectedTable = typeof method === 'function' ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Date.prototype, 'toLocale' + 'DateString'); export const selectedTable = typeof method === 'function' ? 'todos' : 'notes';\n",
  "const method = Reflect.get(Date.prototype, 'toLocale' + 'TimeString'); export const selectedTable = typeof method === 'function' ? 'todos' : 'notes';\n",
  "export const selectedTable = fetch('http://127.0.0.1:9') ? 'todos' : 'notes';\n",
]) {
  const dir = makeBackend();
  writeFileSync(join(dir, 'function-helper.mjs'), source);
  const rejected = await generate(dir);
  assert.equal(rejected.ok, false);
  assert(
    rejected.diagnostics.some((diagnostic) => [
      'CODEGEN_MODULE_EVALUATION_FAILED',
      'SNAPBACK_CODEGEN_DEFINITION_AMBIENT_UNAVAILABLE',
    ].includes(diagnostic.code)),
    JSON.stringify(rejected.diagnostics),
  );
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false);
}

// Harmless lexical/global names are allowed: isolation, not a token blacklist,
// is the authority boundary.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'function-helper.mjs'), `
const process = 'ordinary-local-binding';
globalThis.__definitionScratch = process;
export const selectedTable = globalThis.__definitionScratch === 'ordinary-local-binding' ? 'notes' : 'todos';
`);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(manifests(dir).functions.functions[0].runtime.HostPlan.Query.table, 'notes');
}

// The serializer uses captured intrinsics and prototype-less output. App code
// cannot redirect normalization through a poisoned array iterator, inherited
// index setter, or JSON toJSON hook after the bundle banner has installed the
// trusted references.
{
  const dir = makeBackend();
  writeFileSync(join(dir, 'function-helper.mjs'), `
Object.defineProperty(Array.prototype, '0', {
  configurable: true,
  set() { throw new Error('ARRAY_INDEX_SETTER_EXECUTED'); },
});
Object.defineProperty(Array.prototype, Symbol.iterator, {
  configurable: true,
  value() { throw new Error('ARRAY_ITERATOR_EXECUTED'); },
});
Object.defineProperty(Array.prototype, 'toJSON', {
  configurable: true,
  value() { throw new Error('ARRAY_TO_JSON_EXECUTED'); },
});
export const selectedTable = 'notes';
`);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(manifests(dir).functions.functions[0].runtime.HostPlan.Query.table, 'notes');
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
