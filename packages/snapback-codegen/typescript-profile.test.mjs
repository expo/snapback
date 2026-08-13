import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { generate } from './index.mjs';
import {
  HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
  HANDLER_TYPESCRIPT_COMPILER_VERSION,
  HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES,
  HANDLER_TYPESCRIPT_PROFILE,
  HANDLER_TYPESCRIPT_SOURCE_PROFILE,
  HANDLER_TYPESCRIPT_TRANSFORM_VERSION,
} from './typescript-profile.mjs';
import {
  emittedTypeScriptPaths,
  transformTypeScriptHandler,
} from './typescript-transform.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
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

function backendFixture(handlerFile, handlerSource) {
  const root = mkdtempSync(join(tmpdir(), 'snapback-typescript-profile-'));
  roots.push(root);
  const appRoot = join(root, 'app');
  const backend = join(appRoot, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(
    join(appRoot, 'demo.snapback.json'),
    JSON.stringify({ id: 'typescript-profile-golden' }),
  );
  const modules = join(appRoot, 'node_modules', '@expo');
  mkdirSync(modules, { recursive: true });
  symlinkSync(packageRoot, join(modules, 'snapback-codegen'), 'dir');
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  items: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineAction } from '@expo/snapback-codegen/define';
export const probe = defineAction({
  args: {},
  js: { source: ${JSON.stringify(handlerFile)}, exportName: 'probe' },
});
`);
  writeFileSync(join(backend, handlerFile), handlerSource);
  return backend;
}

try {
  equal(HANDLER_TYPESCRIPT_SOURCE_PROFILE, 'bounded-handler-typescript-v1');
  equal(HANDLER_TYPESCRIPT_TRANSFORM_VERSION, 'snapback-typescript-syntax-erasure-v1');
  equal(HANDLER_TYPESCRIPT_COMPILER_VERSION, '5.9.3');
  equal(
    HANDLER_TYPESCRIPT_COMPILER_INTEGRITY,
    'sha512-jl1vZzPDinLr9eUt3J/t7V6FgNEw9QjvBPdysz9KfQDD41fQrC2Y4vKQdiaUpFT4bXlb1RHhLpp8wtm6M5TgSw==',
  );
  deepEqual(HANDLER_TYPESCRIPT_PROFILE.moduleExtensions, { '.ts': '.js', '.mts': '.mjs' });
  deepEqual(HANDLER_TYPESCRIPT_PROFILE.effectiveOptions, {
    allowJs: false,
    allowSyntheticDefaultImports: false,
    alwaysStrict: false,
    checkJs: false,
    customTransformers: false,
    emitDecoratorMetadata: false,
    erasableSyntaxOnly: true,
    experimentalDecorators: false,
    importHelpers: false,
    inlineSourceMap: false,
    inlineSources: true,
    isolatedModules: true,
    jsx: false,
    module: 'ESNext',
    moduleDetection: 'auto',
    moduleResolution: 'Bundler',
    noEmitHelpers: true,
    noImplicitAny: false,
    plugins: false,
    preserveConstEnums: true,
    rewriteRelativeImportExtensions: true,
    sourceMap: true,
    strict: true,
    target: 'ES2022',
    useDefineForClassFields: true,
    verbatimModuleSyntax: true,
  });

  const schema = JSON.parse(readFileSync(join(packageRoot, 'handler-typescript-profile.schema.json')));
  const validate = new Ajv2020({ allErrors: true, strict: false }).compile(schema);
  equal(validate(HANDLER_TYPESCRIPT_PROFILE), true, JSON.stringify(validate.errors));

  const refusalCases = [
    ['enum', 'enum State { Ready }', 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.enum],
    ['namespace', 'namespace Values { export const x = 1; }', 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.namespace],
    ['decorator', '@sealed class Value {}', 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.decorator],
    ['parameter property', 'class Value { constructor(public value: string) {} }', 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.parameterProperty],
    ['const enum', 'const enum State { Ready }', 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.constEnum],
    ['tsx', 'const value = <div />;', 'handler.tsx', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.tsx],
    ['dynamic import', "void import('./value.mts');", 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.dynamicImport],
    ['bare import', "import { value } from 'package-name';", 'handler.ts', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.bareImport],
  ];
  for (const [label, source, sourcePath, code] of refusalCases) {
    const transformed = transformTypeScriptHandler({ source, sourcePath });
    equal(transformed.ok, false, `${label} must refuse`);
    check(
      transformed.diagnostics.some((entry) => entry.code === code),
      `${label} must use ${code}: ${JSON.stringify(transformed.diagnostics)}`,
    );
  }

  const authored = [
    'type Result = { ok: boolean };',
    'const initial: Result = { ok: true };',
    'globalThis.__snapbackHandlers = {',
    '  async probe(): Promise<Result> { return initial; },',
    '};',
    '',
  ].join('\n');
  const erased = transformTypeScriptHandler({ source: authored, sourcePath: 'handler.ts' });
  equal(erased.ok, true, JSON.stringify(erased.diagnostics));
  equal(
    erased.javascript,
    [
      'const initial = { ok: true };',
      'globalThis.__snapbackHandlers = {',
      '    async probe() { return initial; },',
      '};',
      '',
    ].join('\n'),
    'syntax erasure bytes changed',
  );
  equal(erased.sourceMap.file, 'handler.js');
  deepEqual(erased.sourceMap.sources, ['handler.ts']);
  check(!erased.sourceMapText.includes(resolve('.')), 'source map must not contain an absolute checkout path');

  deepEqual(emittedTypeScriptPaths('nested/handler.mts'), {
    javascriptPath: 'nested/handler.mjs',
    sourceMapPath: 'nested/handler.mjs.map',
  });
  const mts = transformTypeScriptHandler({
    source: "import { value } from './value.mts';\nglobalThis.__snapbackHandlers = { probe() { return value; } };\n",
    sourcePath: 'nested/handler.mts',
  });
  equal(mts.ok, true, JSON.stringify(mts.diagnostics));
  equal(
    mts.javascript,
    'import { value } from "./value.mjs";\nglobalThis.__snapbackHandlers = { probe() { return value; } };\n',
    '.mts relative specifier mapping changed',
  );
  equal(mts.sourceMap.file, 'handler.mjs');
  deepEqual(mts.sourceMap.sources, ['handler.mts']);

  const jsSource = 'globalThis.__snapbackHandlers = { async probe() { return { ok: true }; } };\n';
  const jsBackend = backendFixture('handler.mjs', jsSource);
  const jsFirst = await generate(jsBackend);
  equal(jsFirst.ok, true, JSON.stringify(jsFirst.diagnostics));
  const jsFunction = jsFirst.functionManifest.functions[0];
  equal(jsFunction.runtime.IbexModule.source, jsSource, 'JS runtime bytes must remain authored bytes');
  equal(
    jsFunction.implementationHash,
    'sha256:1a04a912efa52117f05dd783ddc6786f2e9d90689289a3245f0af4fe976ad73a',
    'legacy JS implementation identity changed',
  );
  // Artifact-level inputsHash/bundleHash legitimately rotate whenever any
  // sibling surface changes the capability registry or emitted-manifest
  // content, so this test asserts their format and cross-generation
  // determinism rather than absolute values. The unchanged-JS-custody claims
  // are the absolute implementationHash/runtime-bytes pins above and the
  // byte-identical regeneration below.
  check(/^[0-9a-f]{64}$/u.test(jsFirst.inputsHash), 'inputsHash must be a full sha256 digest');
  check(/^sha256:[0-9a-f]{16}$/u.test(jsFirst.functionManifest.bundleHash), 'bundleHash must keep its truncated sha256 format');
  const generatedProfile = JSON.parse(readFileSync(
    join(jsBackend, 'generated', 'handler-typescript-profile.v1.json'),
    'utf8',
  ));
  deepEqual(generatedProfile, HANDLER_TYPESCRIPT_PROFILE);
  const artifactIndex = JSON.parse(readFileSync(join(jsBackend, 'generated', 'artifacts.json')));
  check(
    artifactIndex.artifacts.includes('handler-typescript-profile.v1.json'),
    'profile artifact must be registered in the generated set',
  );
  const jsManifestBytes = readFileSync(join(jsBackend, 'generated', 'functions.manifest.json'));
  const jsSecond = await generate(jsBackend);
  equal(jsSecond.ok, true, JSON.stringify(jsSecond.diagnostics));
  deepEqual(
    readFileSync(join(jsBackend, 'generated', 'functions.manifest.json')),
    jsManifestBytes,
    'JS function artifact must regenerate byte-identically',
  );

  const tsBackend = backendFixture('handler.ts', authored);
  const tsResult = await generate(tsBackend);
  equal(tsResult.ok, true, JSON.stringify(tsResult.diagnostics));
  equal(tsResult.functionManifest.functions[0].runtime.IbexModule.source, erased.javascript);
  check(
    tsResult.functionManifest.functions[0].implementationHash !== jsFunction.implementationHash,
    'TypeScript source profile must rotate executable identity',
  );

  const mtsBackend = backendFixture('handler.mts', authored);
  const mtsResult = await generate(mtsBackend);
  equal(mtsResult.ok, true, JSON.stringify(mtsResult.diagnostics));
  equal(
    mtsResult.functionManifest.functions[0].runtime.IbexModule.source,
    erased.javascript,
    '.mts runtime bytes must contain no compiler-only export marker',
  );

  const refusedHandlerFiles = [
    ['handler.tsx', 'const value = <div />;\n', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.tsx],
    ['handler.cts', 'globalThis.__snapbackHandlers = {};\n', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.commonJs],
    ['handler.d.ts', 'declare const value: string;\n', HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.declarationFile],
  ];
  for (const [handlerFile, handlerSource, diagnosticCode] of refusedHandlerFiles) {
    const refusedBackend = backendFixture(handlerFile, handlerSource);
    const refused = await generate(refusedBackend);
    equal(refused.ok, false, `${handlerFile} must be refused by the TypeScript profile`);
    check(
      refused.diagnostics.some((entry) => entry.code === diagnosticCode),
      `${handlerFile} must use ${diagnosticCode}: ${JSON.stringify(refused.diagnostics)}`,
    );
  }

  const priorBytes = readFileSync(join(tsBackend, 'generated', 'functions.manifest.json'));
  writeFileSync(join(tsBackend, 'handler.ts'), [
    'const impossible: string = 1;',
    'globalThis.__snapbackHandlers = { probe() { return impossible; } };',
    '',
  ].join('\n'));
  const invalid = await generate(tsBackend);
  equal(invalid.ok, false, 'single-file TypeScript type errors must refuse generation');
  const typeError = invalid.diagnostics.find(
    (entry) => entry.code === HANDLER_TYPESCRIPT_DIAGNOSTIC_RULES.typecheckFailed,
  );
  check(typeError, JSON.stringify(invalid.diagnostics));
  deepEqual(typeError.sourceSpan, { file: 'handler.ts', line: 1, column: 7 });
  deepEqual(
    readFileSync(join(tsBackend, 'generated', 'functions.manifest.json')),
    priorBytes,
    'failed type-check must preserve the prior generated graph',
  );
  check(existsSync(join(tsBackend, 'generated', 'handler-typescript-profile.v1.json')));
} finally {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
}

console.log(`typescript-profile.test.mjs: ${assertions} assertions passed`);
