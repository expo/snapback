import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  computeArtifactIdentityStrings,
  formatCodegenSummary,
  generate,
  targetArtifactAuthProblems,
} from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const guideManifest = JSON.parse(readFileSync(
  join(packageDir, '..', '..', 'guide', 'guide-manifest.generated.json'),
  'utf8',
));
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

const tables = `todos: defineTable({ title: v.string() }).index('by_title', ['title']).sync().permissionBacking(['title'])`;
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
const omittedAuthFunctions = `
import { defineAction, defineMutation, insert, lit } from '${defineUrl}';
export const omittedPlan = defineMutation({
  plan: insert('todos', { title: lit('implicit plan') }),
});
export const omittedJavaScript = defineAction({
  args: {},
  writes: [],
  js: { source: 'omitted-handler.mjs', exportName: 'omittedJavaScript' },
});
export const omittedTypeScript = defineAction({
  args: {},
  writes: [],
  js: { source: 'omitted-handler.ts', exportName: 'omittedTypeScript' },
});
`;

// LLP 0012/0058 golden vectors: domains, the four leading items, full digest
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
  assert.equal(schema.tables[0].permissionBacking, true);
  assert.deepEqual(schema.tables[0].permissionFields, ['title']);
  assert(schema.requiredCapabilities.includes('auth.sessions.v1'));
  assert.equal(functions.schemaVersion, 'snapback.v1');
  assert.equal(schema.inputsHash, functions.inputsHash);
  assert.match(schema.schemaHash, /^snapback\.v1:sessions:schema:sha256:[0-9a-f]{64}$/);
  assert.match(functions.bundleHash, /^snapback\.v1:sessions:function:sha256:[0-9a-f]{64}$/);
  assert.match(schema.inputsHash, /^snapback\.v1:sessions:inputs:sha256:[0-9a-f]{64}$/);
  const generatedApi = await import(pathToFileURL(join(dir, 'generated', 'api.mjs')).href);
  assert.deepEqual(generatedApi.api.listTodos.expectedGeneration, {
    schemaVersion: schema.schemaVersion,
    appId: schema.appId,
    schemaHash: schema.schemaHash,
    bundleHash: functions.bundleHash,
    inputsHash: schema.inputsHash,
  });

  const list = functions.functions.find((fn) => fn.name === 'listTodos');
  const create = functions.functions.find((fn) => fn.name === 'createTodo');
  assert.equal(list.authRequirement, 'public');
  assert.equal(list.authorityIndependent, true);
  assert.equal(create.authRequirement, 'authenticated');
  assert.equal(Object.hasOwn(create, 'authorityIndependent'), false);
  assert.equal(
    create.authorityCreating,
    true,
    'declared writes to permission-backing tables derive the consent marker',
  );

  // Contract and the codegen-owned review index are bound to the exact paired
  // schema/function identity and move with it. The Rust-owned capability keeps
  // its independent v0 format.
  assert.equal(capabilities.schemaVersion, 'snapback.v0');
  assert.deepEqual(capabilities.hostedAuth, {
    authenticationThrottle: 'processLocal',
    clientCredentialPosture: 'bearerV1XssExposed',
    effectiveSource: 'unavailable',
    externalTls: 'unavailable',
    sessionInvalidation: 'singleProcess',
  });
  assert.equal(contract.schemaVersion, 'snapback.v1');
  assert.equal(artifacts.schemaVersion, 'snapback.v1');
  assert.equal(
    result.diagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT'),
    false,
    'every explicit sessions requirement suppresses the compatibility advisory',
  );
  assert.deepEqual(result.summary.implicitAuthRequirements, []);
}

// @ref LLP 0055#registration — codegen preserves the closed sessions-only
// registration policy, defaults its nested fields, and makes the unserviced
// operator-invitation posture visible without refusing the artifact.
{
  const invitedSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'invited' } },
});
`;
  const dir = backend(invitedSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(readJson(join(dir, 'generated', 'schema.manifest.json')).auth, {
    mode: 'sessions',
    agents: { mode: 'invited', invitedBy: 'operators' },
  });
  assert(result.diagnostics.some(
    ({ code, severity }) => code === 'SNAPBACK_AUTH_AGENT_ONBOARDING_PROD_UNAVAILABLE'
      && severity === 'warning',
  ));
}

{
  const openSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'open', invitedBy: 'users' } },
});
`;
  const dir = backend(openSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(readJson(join(dir, 'generated', 'schema.manifest.json')).auth.agents, {
    mode: 'open',
    invitedBy: 'users',
  });
}

{
  const devAgentsSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'dev', agents: { mode: 'open' } },
});
`;
  const dir = backend(devAgentsSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ message }) => /auth\.agents requires auth\.mode sessions/u.test(message)));
  assert.equal(existsSync(join(dir, 'generated')), false);
}

// @ref LLP 0204#d1--the-exposure-declaration-keystone — authoring validates
// registration posture and compiles the default-closed fact onto every
// function entry before either invocation or disclosure consumes it.
{
  const apiWithoutSessions = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, { api: { enabled: false } });
`;
  const result = await generate(backend(apiWithoutSessions, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_AUTH_MODE_INVALID'));
}

{
  const enabledWithoutRegistration = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions' },
  api: { enabled: true },
});
`;
  const result = await generate(backend(enabledWithoutRegistration, ordinaryFunctions));
  assert.equal(result.ok, false);
  const diagnostic = result.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_API_REGISTRATION_POSTURE_REQUIRED',
  );
  assert(diagnostic);
  assert.match(diagnostic.message, /auth\.mode sessions/u);
  assert.match(diagnostic.message, /auth\.agents\.mode/u);
}

{
  const exposedSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  },
});
`;
  const dir = backend(exposedSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const schema = readJson(join(dir, 'generated', 'schema.manifest.json'));
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json')).functions;
  assert.deepEqual(schema.api, {
    enabled: true,
    disclosure: 'exposed-only',
    functions: { listTodos: { expose: true, since: 'v1' } },
    origins: ['https://example.com:8443'],
  });
  assert.deepEqual(functions.find(({ name }) => name === 'listTodos').apiExposure, {
    expose: true,
    since: 'v1',
  });
  assert.deepEqual(functions.find(({ name }) => name === 'createTodo').apiExposure, {
    expose: false,
  });
  assert.deepEqual(
    Object.values(readJson(join(dir, 'generated', 'api-envelope.members.json')).operations)
      .map(({ name }) => name),
    ['listTodos'],
  );
}

{
  const unknownFunctionSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, functions: { missing: { expose: true } } },
});
`;
  const result = await generate(backend(unknownFunctionSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_FUNCTION_UNKNOWN'));
}

{
  const fullDisclosureSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    disclosure: 'full',
    functions: { listTodos: { expose: true } },
  },
});
`;
  const dir = backend(fullDisclosureSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(
    Object.values(readJson(join(dir, 'generated', 'api-envelope.members.json')).operations)
      .map(({ name }) => name)
      .sort(),
    ['createTodo', 'listTodos'],
  );
}

{
  const budgetsSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, budgets: {} },
});
`;
  const result = await generate(backend(budgetsSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(
    ({ code, message }) => code === 'SNAPBACK_API_BUDGETS_UNAVAILABLE'
      && /api\.budgets lands with LLP 0204 S2/u.test(message),
  ));
}

{
  const wildcardOriginSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, origins: ['*'] },
});
`;
  const result = await generate(backend(wildcardOriginSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_ORIGIN_INVALID'));
}

{
  const paginatedSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, functions: { largeList: { expose: true } } },
});
`;
  const largeQuery = `
import { defineJsQuery, results, v } from '${defineUrl}';
export const largeList = defineJsQuery({
  args: {},
  reads: ['todos'],
  auth: 'public',
  result: results.records(v.object({ value: v.string() }), { minItems: 0, maxItems: 101 }),
  handler: async () => [],
});
`;
  const result = await generate(backend(paginatedSchema, largeQuery));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warning = result.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_API_PAGINATION_RECOMMENDED',
  );
  assert(warning);
  assert.match(warning.message, /largeList/u);
  assert.match(warning.message, /101/u);
}

// @ref LLP 0172#3-compatibility-phases — Phase W preserves the legacy
// optional-user result while making each sessions-mode omission visible.
// JavaScript and TypeScript handler bodies share the same function-definition
// diagnostic because auth belongs to the generated operation, not its body.
{
  const dir = backend(sessionsSchema, omittedAuthFunctions);
  writeFileSync(
    join(dir, 'omitted-handler.mjs'),
    'globalThis.__snapbackHandlers = { async omittedJavaScript() { return null; } };\n',
  );
  writeFileSync(
    join(dir, 'omitted-handler.ts'),
    'globalThis.__snapbackHandlers = { async omittedTypeScript(): Promise<null> { return null; } };\n',
  );
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const warnings = result.diagnostics.filter(
    ({ code }) => code === 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT',
  );
  assert.deepEqual(
    warnings.map(({ function: functionName }) => functionName).sort(),
    ['omittedJavaScript', 'omittedPlan', 'omittedTypeScript'],
  );
  for (const warning of warnings) {
    assert.equal(warning.severity, 'warning');
    assert.equal(warning.subsystem, 'auth');
    assert.equal(warning.details.function, warning.function);
    assert.equal(warning.details.authMode, 'sessions');
    assert.equal(warning.details.effectiveLegacyRequirement, 'optional-user');
    assert.deepEqual(warning.details.allowed, ['public', 'optional-user', 'authenticated']);
    assert.match(warning.message, /sessions-mode functions must explicitly set auth/u);
    assert.match(warning.message, /auth: 'public'.*auth: 'optional-user'.*auth: 'authenticated'/u);
    assert.match(warning.message, /guide\/auth\/sessions-and-principals\.md#choose-each-functions-auth-requirement/u);
    assert.equal(warning.sourceSpan.file, 'functions.mjs');
    assert(warning.sourceSpan.line > 0);
    const policyOptions = warning.details.remediations.filter(
      (remediation) => remediation.kind === 'setFunctionAuthRequirement',
    );
    assert.deepEqual(
      policyOptions.map(({ requirement }) => requirement),
      ['public', 'optional-user', 'authenticated'],
    );
    assert(policyOptions.every((remediation) => (
      remediation.kind === 'setFunctionAuthRequirement'
      && remediation.riskClass === 'policy'
      && remediation.machineApplicable === false
      && remediation.requiresApproval === true
      && remediation.precondition.function === warning.function
      && remediation.precondition.authMode === 'sessions'
      && remediation.precondition.authoredRequirement === 'omitted'
    )));
    const guidePointer = warning.details.remediations.find(
      (remediation) => remediation.kind === 'guidePointer',
    );
    assert.deepEqual(
      {
        pageId: guidePointer.pageId,
        path: guidePointer.path,
        anchor: guidePointer.anchor,
        riskClass: guidePointer.riskClass,
        machineApplicable: guidePointer.machineApplicable,
        requiresApproval: guidePointer.requiresApproval,
        authorityEffect: guidePointer.authorityEffect,
        precondition: guidePointer.precondition,
      },
      {
        pageId: 'auth.sessions-and-principals',
        path: 'guide/auth/sessions-and-principals.md',
        anchor: 'choose-each-functions-auth-requirement',
        riskClass: 'policy',
        machineApplicable: false,
        requiresApproval: true,
        authorityEffect: 'none',
        precondition: {
          function: warning.function,
          authMode: 'sessions',
          authoredRequirement: 'omitted',
          effectiveLegacyRequirement: 'optional-user',
        },
      },
    );
    assert.equal(
      guideManifest.pages[guidePointer.pageId]?.path,
      guidePointer.path,
      'auth guidePointer resolves through the generated guide manifest',
    );
    assert.equal(typeof guidePointer.reason, 'string');
    assert.equal(guidePointer.reason.includes('\n'), false, 'guidePointer reason stays one line');
  }
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json'));
  assert(functions.functions.every(({ authRequirement }) => authRequirement === 'optional-user'));
  assert.equal(result.summary.counts.implicitAuthRequirements, 3);
  assert.deepEqual(
    result.summary.implicitAuthRequirements.map(({ operation }) => operation),
    ['omittedJavaScript', 'omittedPlan', 'omittedTypeScript'],
  );
  assert.match(formatCodegenSummary(result.summary), /auth omittedPlan: functions\.mjs:/u);
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
  const dir = backend(devSchema, `
import { defineMutation, insert, lit } from '${defineUrl}';
export const omittedInDev = defineMutation({
  plan: insert('todos', { title: lit('trusted local') }),
});
`);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(
    result.diagnostics.some(({ code }) => code === 'SNAPBACK_AUTH_REQUIREMENT_IMPLICIT'),
    false,
    'dev mode is the documented compatibility suppression context',
  );
  assert.deepEqual(result.summary.implicitAuthRequirements, []);
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json'));
  assert.equal(functions.functions[0].authRequirement, 'optional-user');
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

{
  const invalidScopedIndependent = `
import { defineLiveQuery } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  authScopeField: 'title',
  auth: 'public',
  authorityIndependent: true,
});
`;
  const dir = backend(sessionsSchema, invalidScopedIndependent);
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'));
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log(`auth-artifacts.test.mjs: ${basename(packageDir)} cases passed`);
