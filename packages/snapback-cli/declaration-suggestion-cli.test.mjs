import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
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
import { generate } from '@expo/snapback-codegen';

import { PACKAGED_CLI_COMMANDS, PACKAGED_CLI_SUBCOMMANDS } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const codegenRoot = join(packageRoot, '..', 'snapback-codegen');
const cli = join(packageRoot, 'cli.mjs');
const protocolSchema = JSON.parse(readFileSync(join(codegenRoot, 'declaration-suggestion.schema.json'), 'utf8'));
const validateProtocol = new Ajv2020({ allErrors: true, strict: false }).compile(protocolSchema);
const root = mkdtempSync(join(tmpdir(), 'snapback-declaration-suggestion-cli-'));
const appRoot = join(root, 'app');
const backend = join(appRoot, 'snapback');
let assertions = 0;
const check = (value, message) => {
  assertions += 1;
  assert(value, message);
};
const equal = (actual, expected, message) => {
  assertions += 1;
  assert.equal(actual, expected, message);
};

function invoke(args, { cwd = appRoot } = {}) {
  const child = spawnSync(process.execPath, [cli, ...args], { cwd, encoding: 'utf8' });
  const output = child.stdout.trim();
  return { child, output, json: output.startsWith('{') ? JSON.parse(output) : null };
}

function assertProtocol(result) {
  equal(validateProtocol(result), true, JSON.stringify(validateProtocol.errors));
}

try {
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(appRoot, 'demo.snapback.json'), JSON.stringify({ id: 'suggestion-cli' }));
  const modules = join(appRoot, 'node_modules', '@expo');
  mkdirSync(modules, { recursive: true });
  symlinkSync(codegenRoot, join(modules, 'snapback-codegen'), 'dir');
  writeFileSync(join(backend, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export default defineSchema({
  items: defineTable({ value: v.string() }).visibility({ kind: 'public-read' }),
});
`);
  writeFileSync(join(backend, 'functions.mjs'), `
import { defineJsMutation, v } from '@expo/snapback-codegen/define';
export const exactResult = defineJsMutation({
  args: {}, writes: ['items'], handler: async () => true,
});
export const anyResult = defineJsMutation({
  args: {}, writes: ['items'], source: 'handlers.ts', exportName: 'anyResult',
});
export const recursiveResult = defineJsMutation({
  args: {}, writes: ['items'], source: 'handlers.ts', exportName: 'recursiveResult',
});
`);
  writeFileSync(join(backend, 'handlers.ts'), `
interface Node { ok: true; next?: Node }
globalThis.__snapbackHandlers = {
  async anyResult(): Promise<any> { return { ok: true }; },
  async recursiveResult(): Promise<Node> { return { ok: true }; },
};
`);
  const generated = await generate(backend);
  equal(generated.ok, true, JSON.stringify(generated.diagnostics));

  check(PACKAGED_CLI_COMMANDS.some(({ name }) => name === 'author'));
  check(PACKAGED_CLI_SUBCOMMANDS.some(({ name }) => name === 'author suggestion apply'));
  const rootHelp = invoke(['--help']);
  equal(rootHelp.child.status, 0, rootHelp.child.stderr);
  check(/^  author\s/m.test(rootHelp.output), rootHelp.output);

  const success = invoke(['author', 'suggest', 'snapback/functions.mjs', '--json']);
  equal(success.child.status, 0, success.child.stderr);
  assertProtocol(success.json);
  equal(success.json.ok, true);
  equal(success.json.suggestions.find(({ operation }) => operation.name === 'anyResult').status, 'holed');
  equal(success.json.suggestions.find(({ operation }) => operation.name === 'recursiveResult').status, 'refused');

  const patch = invoke(['author', 'suggest', 'snapback/functions.mjs#exactResult', '--format', 'patch']);
  equal(patch.child.status, 0, patch.child.stderr);
  check(patch.output.includes('--- a/functions.mjs'));
  check(patch.output.includes('Runtime validation:'));

  const invalidArgs = invoke(['author', 'suggest', '--json']);
  equal(invalidArgs.child.status, 1);
  assertProtocol(invalidArgs.json);
  equal(invalidArgs.json.diagnostics[0].code, 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID');

  const invalidMode = invoke(['author', 'suggest', 'snapback/functions.mjs', '--format', 'patch', '--json']);
  equal(invalidMode.child.status, 1);
  assertProtocol(invalidMode.json);
  equal(invalidMode.json.diagnostics[0].code, 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID');

  const notFound = invoke(['author', 'suggest', 'snapback/functions.mjs#missing', '--json']);
  equal(notFound.child.status, 1);
  assertProtocol(notFound.json);
  equal(notFound.json.diagnostics[0].code, 'SNAPBACK_AUTHORING_OPERATION_NOT_FOUND');

  const missingTarget = invoke(['author', 'suggest', 'not-a-backend-or-operation', '--json']);
  equal(missingTarget.child.status, 1);
  assertProtocol(missingTarget.json);
  equal(missingTarget.json.diagnostics[0].code, 'SNAPBACK_AUTHORING_OPERATION_NOT_FOUND');

  const invalidApply = invoke(['author', 'suggestion', 'apply', 'missing.json', '--json']);
  equal(invalidApply.child.status, 1);
  assertProtocol(invalidApply.json);
  equal(invalidApply.json.diagnostics[0].code, 'SNAPBACK_AUTHORING_SUGGESTION_INPUT_INVALID');

  const exactSuggestion = success.json.suggestions.find(({ operation }) => operation.name === 'exactResult');
  const suggestionPath = join(appRoot, 'suggestion.json');
  writeFileSync(suggestionPath, JSON.stringify(exactSuggestion, null, 2));
  writeFileSync(join(backend, 'functions.mjs'), `${readFileSync(join(backend, 'functions.mjs'), 'utf8')}\n// make retained suggestion stale\n`);
  const staleBytes = readFileSync(join(backend, 'functions.mjs'));
  const stale = invoke(['author', 'suggestion', 'apply', 'suggestion.json', '--json']);
  equal(stale.child.status, 1);
  assertProtocol(stale.json);
  equal(stale.json.diagnostics[0].code, 'SNAPBACK_DECLARATION_SUGGESTION_STALE');
  check(readFileSync(join(backend, 'functions.mjs')).equals(staleBytes));

  writeFileSync(join(backend, 'functions.mjs'), readFileSync(join(backend, 'functions.mjs'), 'utf8').replace('\n// make retained suggestion stale\n', ''));
  const fresh = invoke(['author', 'suggest', 'snapback/functions.mjs#exactResult', '--json']);
  equal(fresh.child.status, 0, fresh.child.stderr);
  writeFileSync(suggestionPath, JSON.stringify(fresh.json.suggestions[0], null, 2));
  const applied = invoke(['author', 'suggestion', 'apply', 'suggestion.json', '--json']);
  equal(applied.child.status, 0, applied.child.stderr);
  assertProtocol(applied.json);
  equal(applied.json.ok, true);
  equal((await generate(backend)).ok, true);

  console.log(`declaration-suggestion-cli.test.mjs: ${assertions} assertions passed`);
} finally {
  rmSync(root, { recursive: true, force: true });
}
