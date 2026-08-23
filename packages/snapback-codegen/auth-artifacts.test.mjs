import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
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
import { defineAuth, defineSchema, defineTable, v } from './define.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(packageDir, '../..');
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const patternsUrl = pathToFileURL(join(packageDir, 'standard-patterns.mjs')).href;
const guideManifest = JSON.parse(readFileSync(
  join(packageDir, '..', '..', 'guide', 'guide-manifest.generated.json'),
  'utf8',
));
const dirs = [];
const recoveryPolicy = Object.freeze({
  recoveryCodes: Object.freeze({
    enabled: true,
    requiredWhen: 'no-independent-recovery',
    rotateAfterUse: true,
    plaintextCustody: 'one-time-response',
  }),
  lastAuthenticator: 'enforce',
});
const recoveryPolicySource = `
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },`;

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

const tables = `
todoPermissions: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).permissionBacking(['title']),
todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).index('by_title', ['title']).sync()
`;
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
  authoredSourceItems: ['schema-source', '{}', 'function-source', '[]'],
};
assert.deepEqual(
  computeArtifactIdentityStrings({ artifactVersion: 'snapback.v0', authMode: 'dev', ...vectorInput }),
  {
    inputsHash: 'e68fa67402c7456616c3114c2618e782dbf7ea85f6c5258c2ad0159fc3eb07a6',
    schemaHash: 'sha256:b96a1a0ff7f1ad59',
    bundleHash: 'sha256:98f69379a4caeee4',
    authoredSourceHash: 'sha256:656d96371b255e8f038a304acc8bb714feb9b23fdf10a764c09ab4269d2192ed',
  },
);
assert.deepEqual(
  computeArtifactIdentityStrings({ artifactVersion: 'snapback.v1', authMode: 'sessions', ...vectorInput }),
  {
    inputsHash: 'snapback.v1:sessions:inputs:sha256:98b7ef54d181f80dcc0ca44a76f1e4a1ce8cf5df3670339f6872710af40c3446',
    schemaHash: 'snapback.v1:sessions:schema:sha256:9b696dcdb46833979823201437168432a8a445e73bccb6b7795a8ea492abfe51',
    bundleHash: 'snapback.v1:sessions:function:sha256:c3d4907b4ebace0ac0e5a6e126e17fc87b4c1f9e288d1cf1c4baf93ea4bd8e1e',
    authoredSourceHash: 'sha256:656d96371b255e8f038a304acc8bb714feb9b23fdf10a764c09ab4269d2192ed',
  },
);
assert.throws(
  () => computeArtifactIdentityStrings({ artifactVersion: 'snapback.v1', authMode: 'dev', ...vectorInput }),
  /unsupported artifact\/auth identity tuple/,
);

assert.throws(
  () => defineAuth({
    version: 1,
    mechanisms: { guest: { kind: 'guest' } },
    providers: { mail: { clientSecret: 'literal-must-not-enter-an-artifact' } },
    assuranceRequirements: {},
    recoveryPolicy,
    guestPolicy: { enabled: false },
    secretReferences: {},
  }),
  (error) => error?.code === 'SNAPBACK_AUTH_LITERAL_SECRET_FORBIDDEN',
);

assert.throws(
  () => defineAuth({
    version: 1,
    mechanisms: {
      usernamePassword: { kind: 'password', identifier: 'username', provider: 'builtIn', recovery: 'recoveryCodes' },
      emailPassword: { kind: 'password', identifier: 'email', provider: 'builtIn', recovery: 'recoveryCodes' },
    },
    assuranceRequirements: {},
    guestPolicy: { enabled: false },
    secretReferences: {},
  }),
  (error) => error?.code === 'SNAPBACK_AUTH_PASSWORD_IDENTIFIER_MODE_CONFLICT',
);

assert.throws(
  () => defineSchema({
    drafts: defineTable({ ownerId: v.principal() }),
  }, {
    auth: { mode: 'sessions' },
    authProgram: defineAuth({
      version: 1,
      mechanisms: { guest: { kind: 'guest' } },
      assuranceRequirements: {},
      recoveryPolicy,
      guestPolicy: {
        enabled: true,
        claiming: [],
        reaping: {
          afterMs: 604800000,
          cleanup: { kind: 'declarative', default: 'tombstone', tables: {} },
        },
      },
      abuseBudgets: { version: 1, preset: 'guest-entry-v1' },
      secretReferences: {},
    }),
  }),
  (error) => error?.code === 'SNAPBACK_AUTH_GUEST_CLEANUP_UNCLASSIFIED',
);

{
  const emailPasswordSchema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: { password: { kind: 'password', identifier: 'email', provider: 'builtIn', recovery: 'recoveryCodes', minimumLength: 8 } },
  assuranceRequirements: {},
  ${recoveryPolicySource}
  guestPolicy: { enabled: false },
  secretReferences: {},
});
export default defineSchema({ ${tables} }, { auth: { mode: 'sessions' }, authProgram });
`;
  const dir = backend(emailPasswordSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = readJson(join(dir, 'generated', 'schema.manifest.json'));
  assert.equal(manifest.auth.passwordIdentifierMode, 'email-v1');
  assert.equal(manifest.auth.passwordMinimumLength, 8);
}

for (const minimumLength of [7, 129, 8.5]) {
  assert.throws(
    () => defineAuth({
      version: 1,
      mechanisms: {
        password: {
          kind: 'password',
          identifier: 'email',
          provider: 'builtIn',
          recovery: 'recoveryCodes',
          minimumLength,
        },
      },
      assuranceRequirements: {},
      guestPolicy: { enabled: false },
      secretReferences: {},
    }),
    (error) => error?.code === 'SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_INVALID',
  );
}

assert.throws(
  () => defineAuth({
    version: 1,
    mechanisms: {
      primary: {
        kind: 'password',
        identifier: 'email',
        provider: 'builtIn',
        recovery: 'recoveryCodes',
        minimumLength: 8,
      },
      secondary: {
        kind: 'password',
        identifier: 'email',
        provider: 'builtIn',
        recovery: 'recoveryCodes',
        minimumLength: 12,
      },
    },
    assuranceRequirements: {},
    guestPolicy: { enabled: false },
    secretReferences: {},
  }),
  (error) => error?.code === 'SNAPBACK_AUTH_PASSWORD_MINIMUM_LENGTH_CONFLICT',
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
  assert(
    problems
      .filter((problem) => problem.code === 'SNAPBACK_CAPABILITY_UNSUPPORTED')
      .every((problem) => problem.message.includes(
        'https://github.com/expo/snapback/blob/main/guide/operating/diagnostics.md#diagnose-snapbackcapabilityunsupported',
      )),
    JSON.stringify(problems),
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
  const permissionTable = schema.tables.find(({ name }) => name === 'todoPermissions');
  assert.equal(permissionTable.permissionBacking, true);
  assert.deepEqual(permissionTable.permissionFields, ['title']);
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
  assert.equal(Object.hasOwn(create, 'authorityCreating'), false);

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

// @ref LLP 0204#d95--approval-gated-effects — approval is a closed compiled
// exposure fact; it requires exposure and may name only mutations/actions.
{
  const approvalSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    functions: { createTodo: { expose: true, approval: 'external' } },
  },
});
`;
  const dir = backend(approvalSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const functions = readJson(join(dir, 'generated', 'functions.manifest.json')).functions;
  assert.deepEqual(functions.find(({ name }) => name === 'createTodo').apiExposure, {
    expose: true,
    approval: 'external',
  });
}

for (const [exposure, code] of [
  ["{ expose: false, approval: 'required' }", 'SNAPBACK_API_APPROVAL_REQUIRES_EXPOSURE'],
  ["{ expose: true, approval: 'sometimes' }", 'CODEGEN_MODULE_EVALUATION_FAILED'],
]) {
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, functions: { createTodo: ${exposure} } },
});
`;
  const result = await generate(backend(schema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some((diagnostic) => diagnostic.code === code));
}

{
  const queryApprovalSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    functions: { listTodos: { expose: true, approval: 'required' } },
  },
});
`;
  const result = await generate(backend(queryApprovalSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(
    (diagnostic) => diagnostic.code === 'SNAPBACK_API_APPROVAL_QUERY_INVALID',
  ));
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

// @ref LLP 0204#d8--authority-acquisition-the-ceremony-and-the-facade — v1
// bearer transport is explicit, and OQ3 bundle names compile from function
// names rather than exposing canonical grant-scope syntax to OAuth clients.
{
  const implicitBearerSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'open' } },
  api: {
    enabled: true,
    functions: { listTodos: { expose: true } },
    oauth: { enabled: true, bundles: { todos: { functions: ['listTodos'] } } },
  },
});
`;
  const result = await generate(backend(implicitBearerSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(
    ({ code, message }) => code === 'SNAPBACK_API_OAUTH_BEARER_OPT_IN_REQUIRED'
      && /api\.oauth\.bearer true/u.test(message),
  ));
}

{
  const oauthSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'open' } },
  api: {
    enabled: true,
    functions: { listTodos: { expose: true }, createTodo: { expose: true } },
    oauth: {
      enabled: true,
      bearer: true,
      bundles: {
        todos: { functions: ['listTodos'] },
        'todos.write': { functions: ['createTodo'] },
      },
    },
  },
});
`;
  const dir = backend(oauthSchema, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.deepEqual(readJson(join(dir, 'generated', 'schema.manifest.json')).api.oauth, {
    enabled: true,
    bearer: true,
    bundles: {
      todos: { functions: ['listTodos'] },
      'todos.write': { functions: ['createTodo'] },
    },
  });
}

{
  const invalidBundleSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'open' } },
  api: {
    enabled: true,
    functions: { listTodos: { expose: true } },
    oauth: {
      enabled: true,
      bearer: true,
      bundles: { todos: { functions: ['missing'] } },
    },
  },
});
`;
  const result = await generate(backend(invalidBundleSchema, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_OAUTH_FUNCTION_UNKNOWN'));
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
  api: {
    enabled: true,
    budgets: { ask: {
      perRequest: { maxTokens: 100, maxSteps: 4, maxWallMs: 5000 },
      perPrincipalDay: { maxTokens: 1000 },
      appMonthly: { maxTokens: 10000 },
      resultVolume: { maxBytes: 10000, maxRows: 100, perPrincipalDayBytes: 100000 },
    } },
  },
});
`;
  const result = await generate(backend(budgetsSchema, ordinaryFunctions));
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
}

{
  const askWithoutBudgets = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, ask: { enabled: true, billing: 'caller-key' } },
});
`;
  const result = await generate(backend(askWithoutBudgets, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(
    ({ code, message }) => code === 'SNAPBACK_API_ASK_BUDGETS_REQUIRED'
      && /perRequest/u.test(message) && /resultVolume/u.test(message),
  ));
}

{
  const callerKeyAsk = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    ask: { enabled: true, billing: 'caller-key', model: { provider: 'openai-compatible', model: 'stub' } },
    budgets: { ask: {
      perRequest: { maxTokens: 100, maxSteps: 4, maxWallMs: 5000 },
      perPrincipalDay: { maxTokens: 1000 },
      perIntegrationDay: { maxTokens: 500 },
      appMonthly: { maxTokens: 10000 },
      resultVolume: { maxBytes: 10000, maxRows: 100, perPrincipalDayBytes: 100000 },
    } },
  },
});
`;
  const dir = backend(callerKeyAsk, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(readJson(join(dir, 'generated', 'schema.manifest.json')).api.ask.billing, 'caller-key');
}

{
  const unknownAskKey = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: { enabled: true, ask: { enabled: false, billing: 'app', mutationTools: true } },
});
`;
  const result = await generate(backend(unknownAskKey, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_ASK_MANIFEST_INVALID'));
}

{
  const callerKeyWithAppSecret = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    ask: { enabled: false, billing: 'caller-key', model: { provider: 'openai-compatible', model: 'stub', secret: 'providerKey' } },
  },
});
`;
  const result = await generate(backend(callerKeyWithAppSecret, ordinaryFunctions));
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(({ code }) => code === 'SNAPBACK_API_ASK_MODEL_INVALID'));
}

{
  const appPaidAsk = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${tables} }, {
  auth: { mode: 'sessions', agents: { mode: 'disabled' } },
  api: {
    enabled: true,
    ask: { enabled: true, billing: 'app', model: { provider: 'openai-compatible', model: 'stub' } },
    budgets: { ask: {
      perRequest: { maxTokens: 10, maxSteps: 2, maxWallMs: 1000 },
      perPrincipalDay: { maxTokens: 20 },
      appMonthly: { maxTokens: 30 },
      resultVolume: { maxBytes: 100, maxRows: 5, perPrincipalDayBytes: 200 },
    } },
  },
});
`;
  const dir = backend(appPaidAsk, ordinaryFunctions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  assert.equal(readJson(join(dir, 'generated', 'schema.manifest.json')).api.ask.billing, 'app');
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
  const invalidAuthCoupling = `
import { defineLiveQuery } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  auth: 'authenticated',
  authorityIndependent: true,
});
`;
  const dir = backend(sessionsSchema, invalidAuthCoupling);
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(
    result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'
      && diagnostic.message === 'listTodos: authorityIndependent requires a public HostPlan query with no auth, membership, auth-scope, runtime-clock, or runtime-id dependency'
    )),
    `invalid authority/auth pair omitted its stable diagnostic: ${JSON.stringify(result.diagnostics)}`,
  );
}

{
  const castOrSkewedAuthCoupling = `
import { defineLiveQuery } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  auth: 'public',
  authorityIndependent: true,
});
listTodos.auth = 'authenticated';
`;
  const dir = backend(sessionsSchema, castOrSkewedAuthCoupling);
  const result = await generate(dir);
  assert.equal(result.ok, false);
  assert(
    result.diagnostics.some((diagnostic) => (
      diagnostic.code === 'FUNCTION_AUTHORITY_INDEPENDENT_INVALID'
      && diagnostic.authRequirement === 'authenticated'
    )),
    `mutated/cast declaration bypassed the stable codegen diagnostic: ${JSON.stringify(result.diagnostics)}`,
  );
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

// @ref LLP 0214#10-v6-no-delivery-readiness — wave 1c publishes honest producer
// facts while keeping delivery enforcement false until wave 2a.
{
  const schema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    guest: { kind: 'guest' },
    emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'transactionalEmail' },
  },
  assuranceRequirements: { sensitive: { allOf: ['email_verified', 'recent_auth'] } },
  ${recoveryPolicySource}
  guestPolicy: { enabled: true, claiming: ['emailCode'], reaping: { afterMs: 604800000, cleanup: { kind: 'declarative', default: 'tombstone', tables: {} } } },
  abuseBudgets: { version: 1, preset: 'guest-entry-v1' },
  secretReferences: {},
});
export default defineSchema({ ${tables} }, { auth: { mode: 'sessions' }, authProgram });
`;
  const functions = `
import { defineMutation, insert, lit } from '${defineUrl}';
export const sensitiveWrite = defineMutation({
  auth: 'authenticated',
  requires: ['sensitive'],
  plan: insert('todos', { title: lit('ready') }),
});
`;
  const dir = backend(schema, functions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = readJson(join(dir, 'generated', 'schema.manifest.json'));
  assert.equal(manifest.authProgram.version, 1);
  assert.deepEqual(manifest.authProgramReadiness.requiredAssuranceProducers.email_verified.requiredBy, ['sensitiveWrite']);
  assert.deepEqual(manifest.authProgramReadiness.requiredAssuranceProducers.email_verified.declaredDeliveryAdapters, ['transactionalEmail']);
  assert.deepEqual(manifest.authProgramReadiness.requiredAssuranceProducers.recent_auth.requiredBy, ['sensitiveWrite']);
  assert.deepEqual(manifest.authProgramReadiness.deliveryChannels, {
    email: {
      declared: true,
      configured: false,
      available: false,
      assuranceClass: 'contact-ownership',
      missingSecretReferences: [],
    },
  });
  assert.deepEqual(manifest.authProgramReadiness.noDeliveryCheck, { enforced: false, satisfied: false });
}

// @ref LLP 0214#53-sealed-invocation-authority — one declaration produces
// the storage guard and removes the table from ordinary generated mutations.
{
  const schema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: { emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'mail' } },
  assuranceRequirements: {},
  ${recoveryPolicySource}
  guestPolicy: { enabled: false },
  secretReferences: {},
  verifiedProvisioning: {
    handler: 'provisionBinding', requires: [], reads: ['users'],
    writes: [{ table: 'identityBindings', mode: 'identity-binding', principalField: 'principal', identityField: 'sourceUserID' }],
  },
});
export default defineSchema({
  users: defineTable({ principal: v.principal(), sourceUserID: v.string() })
    .visibility({ kind: 'owner', field: 'principal' })
    .index('by_source', ['sourceUserID'], { unique: true }),
  identityBindings: defineTable({ principal: v.principal(), sourceUserID: v.string() })
    .visibility({ kind: 'owner', field: 'principal' })
    .index('by_principal', ['principal'], { unique: true })
    .index('by_source', ['sourceUserID'], { unique: true }),
}, { auth: { mode: 'sessions' }, authProgram });
`;
  const functions = `
import { defineAction } from '${defineUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
`;
  const dir = backend(schema, functions);
  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = readJson(join(dir, 'generated', 'schema.manifest.json'));
  assert.deepEqual(manifest.identityBindingTables, [{
    table: 'identityBindings', principalField: 'principal', identityField: 'sourceUserID',
  }]);
  assert.equal(manifest.authProgramReadiness.verifiedProvisioningDeclared, true);
  assert.equal(manifest.authProgramReadiness.verifiedProvisioningCompiled, false);
  const apiTypes = readFileSync(join(dir, 'generated', 'api.d.ts'), 'utf8');
  assert.match(apiTypes, /GeneratedInsertableTableName = Exclude<GeneratedReadableTableName, "identityBindings">/);
  assert.match(apiTypes, /GeneratedPatchableTableName = Exclude<GeneratedReadableTableName, "identityBindings">/);
  assert.doesNotMatch(apiTypes, /"identityBindings": \{ "principal"/);

  writeFileSync(join(dir, 'ctx.d.mts'), readFileSync(join(packageDir, 'ctx.d.mts'), 'utf8'));
  writeFileSync(join(dir, 'claims-consumer.ts'), `
import type { AuthClaimIdentity } from './ctx.mjs';

declare const identity: AuthClaimIdentity;
if (identity.kind === 'oidc') {
  identity.issuer.toUpperCase();
  // @ts-expect-error OIDC identities do not expose mutable profile values.
  identity.value.toUpperCase();
}
if (identity.kind === 'email') {
  identity.value.toUpperCase();
  // @ts-expect-error email identities have no issuer field.
  identity.issuer.toUpperCase();
}
// @ts-expect-error the OIDC variant cannot express value.
const invalidOidc: AuthClaimIdentity = {
  kind: 'oidc', providerKey: 'workforce', issuer: 'https://issuer.example',
  subject: 'subject-1',
  value: 'mutable@example.test',
};
// @ts-expect-error the email variant cannot express issuer.
const invalidEmail: AuthClaimIdentity = {
  kind: 'email', providerKey: 'email-code', subject: 'person@example.test',
  value: 'person@example.test',
  issuer: 'https://issuer.example',
};
const structuralOidcSource = {
  kind: 'oidc' as const,
  providerKey: 'workforce',
  issuer: 'https://issuer.example',
  subject: 'subject-2',
  value: 'structural@example.test',
};
// @ts-expect-error negative variant fields must reject non-fresh structural assignments.
const structuralOidc: AuthClaimIdentity = structuralOidcSource;
const structuralEmailSource = {
  kind: 'email' as const,
  providerKey: 'email-code',
  subject: 'subject-3',
  value: 'person@example.test',
  issuer: 'https://issuer.example',
};
// @ts-expect-error negative variant fields must reject non-fresh structural assignments.
const structuralEmail: AuthClaimIdentity = structuralEmailSource;
void invalidOidc;
void invalidEmail;
void structuralOidc;
void structuralEmail;
`);
  execFileSync(join(repoRoot, 'node_modules/.bin/tsc'), [
    '--noEmit', '--strict', '--target', 'es2022', '--module', 'esnext',
    '--moduleResolution', 'bundler', 'claims-consumer.ts',
  ], { cwd: dir, stdio: 'pipe' });
}

// @ref LLP 0214#59-relationship-to-the-guide-binding-gap — every generated
// non-provisioning writer role is refused once the schema seals the target.
{
  const schema = `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: { emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'mail' } },
  assuranceRequirements: {}, ${recoveryPolicySource} guestPolicy: { enabled: false }, secretReferences: {},
  verifiedProvisioning: {
    handler: 'provisionBinding', requires: [], reads: ['roots'],
    writes: [{ table: 'identityBindings', mode: 'identity-binding', principalField: 'principal', identityField: 'sourceUserID' }],
  },
});
export const roots = defineTable({ principal: v.principal(), sourceUserID: v.string(), joinedKey: v.string() })
  .visibility({ kind: 'owner', field: 'principal' })
  .index('by_joined', ['joinedKey']);
export const joined = defineTable({ key: v.string() })
  .visibility({ kind: 'public-read' })
  .index('by_key', ['key'], { unique: true });
export const identityBindings = defineTable({ principal: v.principal(), sourceUserID: v.string() })
  .visibility({ kind: 'owner', field: 'principal' })
  .index('by_principal', ['principal'], { unique: true })
  .index('by_source', ['sourceUserID'], { unique: true });
export default defineSchema({ roots, joined, identityBindings }, { auth: { mode: 'sessions' }, authProgram });
`;
  const cases = [
    {
      role: 'direct declared handler write',
      functions: `
import { defineAction } from '${defineUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
export const forged = defineAction({ args: {}, auth: 'authenticated', writes: ['identityBindings'], handler: async () => null });
`,
    },
    {
      role: 'HostPlan write',
      functions: `
import { defineAction, defineMutation, insert, lit } from '${defineUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
export const forged = defineMutation({ auth: 'authenticated', plan: insert('identityBindings', { principal: lit('principal_1'), sourceUserID: lit('source_1') }) });
`,
    },
    {
      role: 'synthesized standard-pattern writers',
      schema: `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: { emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'mail' } },
  assuranceRequirements: {}, ${recoveryPolicySource} guestPolicy: { enabled: false }, secretReferences: {},
  verifiedProvisioning: {
    handler: 'provisionBinding', requires: [], reads: [],
    writes: [{ table: 'identityBindings', mode: 'identity-binding', principalField: 'principal', identityField: 'principal' }],
  },
});
export const identityBindings = defineTable({ principal: v.principal(), label: v.string() })
  .index('by_principal', ['principal'], { unique: true })
  .visibility({ kind: 'owner', field: 'principal' });
export default defineSchema({ identityBindings }, { auth: { mode: 'sessions' }, authProgram });
`,
      functions: `
import schema from './schema.mjs';
import { defineAction } from '${defineUrl}';
import { defineOwnedCrud } from '${patternsUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
export const { listBindings, getBinding, createBinding, updateBinding, deleteBinding } = defineOwnedCrud({
  table: schema.tables.identityBindings,
  names: {
    list: 'listBindings', get: 'getBinding', create: 'createBinding',
    update: 'updateBinding', delete: 'deleteBinding',
  },
  visibility: { kind: 'owner', field: 'principal' },
  listIndex: 'by_principal',
  discloseUniqueConflicts: ['by_principal'],
});
`,
    },
    {
      role: 'maintained projection output',
      functions: `
import schema from './schema.mjs';
import { defineAction, defineMaintainedProjection } from '${defineUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
export const forged = defineMaintainedProjection({
  id: 'forged-bindings', root: schema.tables.roots, joined: schema.tables.joined,
  output: schema.tables.identityBindings,
  join: [{ root: 'joinedKey', joined: 'key' }], kind: 'inner',
  visibility: { root: { kind: 'public-read' }, joined: { kind: 'public-read' }, output: { kind: 'public-read' } },
  projection: { principal: { root: 'principal' }, sourceUserID: { root: 'sourceUserID' } },
  rootReverseIndex: 'by_joined', fanOutLimit: 8,
});
`,
    },
  ];
  for (const testCase of cases) {
    const dir = backend(testCase.schema ?? schema, testCase.functions);
    const result = await generate(dir);
    assert.equal(result.ok, false, `${testCase.role} must refuse authoring`);
    assert(
      result.diagnostics.some((diagnostic) => (
        diagnostic.code === 'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN'
        && diagnostic.table === 'identityBindings'
      )),
      `${testCase.role} must emit the sealed-table refusal: ${JSON.stringify(result.diagnostics)}`,
    );
  }

  const seedFunctions = `
import { defineAction } from '${defineUrl}';
export const provisionBinding = defineAction({ args: {}, auth: 'authenticated', handler: async () => null });
`;
  const seedCases = [
    {
      role: 'versioned seed',
      writerRole: 'versionedSeed',
      seed: {
        seedVersion: '2026-08-16.1',
        tables: { identityBindings: [{ principal: 'principal_1', sourceUserID: 'source_1' }] },
      },
    },
    {
      role: 'legacy seed',
      writerRole: 'legacySeed',
      seed: {
        tables: { identityBindings: [{ principal: 'principal_1', sourceUserID: 'source_1' }] },
      },
    },
  ];
  for (const seedCase of seedCases) {
    const seedDir = backend(schema, seedFunctions);
    writeFileSync(join(seedDir, 'seed.json'), JSON.stringify(seedCase.seed));
    const seedResult = await generate(seedDir);
    assert.equal(seedResult.ok, false, `${seedCase.role} writer must refuse authoring`);
    assert(seedResult.diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_AUTH_BINDING_WRITE_FORBIDDEN'
      && diagnostic.writerRole === seedCase.writerRole
    )), JSON.stringify(seedResult.diagnostics));
  }

  const nonSealedLegacySeedDir = backend(schema, seedFunctions);
  writeFileSync(join(nonSealedLegacySeedDir, 'seed.json'), JSON.stringify({
    tables: {
      roots: [{ principal: 'principal_1', sourceUserID: 'source_1', joinedKey: 'joined_1' }],
    },
  }));
  const nonSealedLegacySeedResult = await generate(nonSealedLegacySeedDir);
  assert.equal(
    nonSealedLegacySeedResult.ok,
    true,
    `non-sealed legacy seed must author successfully: ${JSON.stringify(nonSealedLegacySeedResult.diagnostics)}`,
  );
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
console.log(`auth-artifacts.test.mjs: ${basename(packageDir)} cases passed`);
