import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  computeArtifactIdentityStrings,
  generate,
  targetArtifactAuthProblems,
} from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dirs = [];

function backend(schema, functions) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-auth-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  return dir;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

const tables = `todos: defineTable({ title: v.string() }).index('by_title', ['title']).sync()`;
const devSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} });
`;
const sessionsSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, { auth: { mode: 'sessions' } });
`;
const ordinaryFunctions = `
import { defineLiveQuery, defineMutation, eq, insert, lit } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  index: 'by_title',
  filter: [eq('title', lit('fixed'))],
  auth: 'public',
  authorityIndependent: true,
});
export const createTodo = defineMutation({
  auth: 'authenticated',
  plan: insert('todos', { title: lit('created') }),
});
`;

// LLP 0012/0055 golden vectors: domains, the four leading items, full digest
// width, and the legacy truncation/raw-input spellings are all pinned here.
const vectorInput = {
  appId: 'golden-app',
  sharedInputItems: ['alpha', 'βeta'],
  schemaContentItems: ['schema-source', '{}'],
  bundleContentItems: ['function-source', '[]'],
};
assert.deepEqual(
  computeArtifactIdentityStrings({ artifactVersion: 'snapback.v0', authMode: 'dev', ...vectorInput }),
  {
    inputsHash: 'e68fa67402c7456616c3114c2618e782dbf7ea85f6c5258c2ad0159fc3eb07a6',
    schemaHash: 'sha256:b96a1a0ff7f1ad59',
    bundleHash: 'sha256:98f69379a4caeee4',
  },
);
assert.deepEqual(
  computeArtifactIdentityStrings({ artifactVersion: 'snapback.v1', authMode: 'sessions', ...vectorInput }),
  {
    inputsHash: 'snapback.v1:sessions:inputs:sha256:98b7ef54d181f80dcc0ca44a76f1e4a1ce8cf5df3670339f6872710af40c3446',
    schemaHash: 'snapback.v1:sessions:schema:sha256:9b696dcdb46833979823201437168432a8a445e73bccb6b7795a8ea492abfe51',
    bundleHash: 'snapback.v1:sessions:function:sha256:c3d4907b4ebace0ac0e5a6e126e17fc87b4c1f9e288d1cf1c4baf93ea4bd8e1e',
  },
);
assert.throws(
  () => computeArtifactIdentityStrings({ artifactVersion: 'snapback.v1', authMode: 'dev', ...vectorInput }),
  /unsupported artifact\/auth identity tuple/,
);

{
  const oldOrForeignTarget = {
    targetProfileId: 'candidate-asserted',
    capabilityGaps: [],
    // Candidate prose and an absent gap are intentionally not authority.
    claimedSupportedCapabilities: ['auth.sessions.v1', 'candidate.asserted.future'],
  };
  const problems = targetArtifactAuthProblems(
    oldOrForeignTarget,
    'snapback.v1',
    'sessions',
    ['auth.sessions.v1', 'candidate.asserted.future'],
  );
  assert(problems.some((problem) => problem.code === 'CODEGEN_ARTIFACT_AUTH_PAIR_UNSUPPORTED'));
  assert.deepEqual(
    problems
      .filter((problem) => problem.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED')
      .map((problem) => problem.details.capability),
    ['auth.sessions.v1', 'candidate.asserted.future'],
  );
}

{
  const dir = backend(sessionsSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const schema = readJson(join(dir, 'generated', 'schema.manifest.json'));
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json'));
  const capabilities = readJson(join(dir, 'generated', 'capability.manifest.json'));
  const contract = readJson(join(dir, 'generated', 'contract-data.manifest.json'));
  const artifacts = readJson(join(dir, 'generated', 'artifacts.json'));

  assert.equal(schema.schemaVersion, 'snapback.v1');
  assert.deepEqual(schema.auth, { mode: 'sessions' });
  assert(schema.requiredCapabilities.includes('auth.sessions.v1'));
  assert.equal(functions.schemaVersion, 'snapback.v1');
  assert.equal(schema.inputsHash, functions.inputsHash);
  assert.match(schema.schemaHash, /^snapback\.v1:sessions:schema:sha256:[0-9a-f]{64}$/);
  assert.match(functions.bundleHash, /^snapback\.v1:sessions:function:sha256:[0-9a-f]{64}$/);
  assert.match(schema.inputsHash, /^snapback\.v1:sessions:inputs:sha256:[0-9a-f]{64}$/);

  const list = functions.functions.find((fn) => fn.name === 'listTodos');
  const create = functions.functions.find((fn) => fn.name === 'createTodo');
  assert.equal(list.authRequirement, 'public');
  assert.equal(list.authorityIndependent, true);
  assert.equal(create.authRequirement, 'authenticated');
  assert.equal(Object.hasOwn(create, 'authorityIndependent'), false);

  // Only the paired schema/function artifacts move to v1.
  assert.equal(capabilities.schemaVersion, 'snapback.v0');
  assert.equal(contract.schemaVersion, 'snapback.v0');
  assert.equal(artifacts.schemaVersion, 'snapback.v0');
}

{
  const dir = backend(devSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const schema = readJson(join(dir, 'generated', 'schema.manifest.json'));
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json'));
  assert.equal(schema.schemaVersion, 'snapback.v0');
  assert.equal(functions.schemaVersion, 'snapback.v0');
  assert.equal(Object.hasOwn(schema, 'auth'), false);
  assert.equal(Object.hasOwn(schema, 'requiredCapabilities'), false);
  assert.doesNotMatch(schema.schemaHash, /snapback\.v1:/);
  assert.doesNotMatch(functions.bundleHash, /snapback\.v1:/);
  assert.doesNotMatch(schema.inputsHash, /snapback\.v1:/);
}

{
  const cronFunctions = `
import { defineAction, defineCron, defineMutation, insert, lit, runMutation } from '${defineUrl}';
export const createTodo = defineMutation({ plan: insert('todos', { title: lit('cron') }) });
export const scheduled = defineAction({
  auth: 'authenticated',
  plan: runMutation('createTodo'),
});
export const jobs = defineCron({ tick: { schedule: { everyMs: 60000 }, action: 'scheduled' } });
`;
  const dir = backend(sessionsSchema, cronFunctions);
  writeFileSync(join(dir, 'generated-sentinel'), 'unchanged\n');
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'CRON_AUTH_REQUIREMENT_INVALID'));
  assert.equal(existsSync(join(dir, 'generated')), false, 'manifest-load refusal must write no artifacts');
}

{
  const invalidIndependent = `
import { authUserId, defineLiveQuery, eq } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  filter: [eq('title', authUserId())],
  auth: 'public',
  authorityIndependent: true,
});
`;
  const dir = backend(sessionsSchema, invalidIndependent);
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log(`auth-artifacts.test.mjs: ${basename(packageDir)} cases passed`);
