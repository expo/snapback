import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import { formatCodegenSummary } from './codegen-summary.mjs';
import {
  allow,
  defineAction,
  defineMutation,
  defineQuery,
  insert,
  lit,
} from './define.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const guideManifest = JSON.parse(readFileSync(
  join(packageDir, '..', '..', 'guide', 'guide-manifest.generated.json'),
  'utf8',
));
const dirs = [];
const validSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
});
`;

{
  const policy = allow.members('conversation_members', { scopeField: 'conversationId' });
  assert.equal(Object.isFrozen(allow), true, 'allow must be a closed frozen namespace');
  assert.equal(Object.isFrozen(policy), true, 'allow.members() must return a frozen policy');
  assert.deepEqual(policy, {
    __accessPolicy: true,
    kind: 'RequireMembership',
    declaration: 'conversation_members',
    scopeField: 'conversationId',
  });
  assert.throws(
    () => allow.members('conversation_members', { scopeFiled: 'conversationId' }),
    /unknown field scopeFiled/u,
  );
  const narrowed = allow.members('conversation_members', { roles: ['owner', 'member'] });
  assert.deepEqual(narrowed.roles, ['owner', 'member']);
  assert.equal(Object.isFrozen(narrowed.roles), true, 'allow.members() roles must be copied and frozen');
  assert.throws(
    () => allow.members('conversation_members', { roles: [] }),
    (error) => error?.code === 'SNAPBACK_EPHEMERAL_MEMBERSHIP_ROLES_INVALID',
  );
}

// LLP 0010's no-silent-drops rule applies uniformly to the three primary
// function builders. In particular LLP 0249's proposed `runtime`/`effects`
// spelling must not compile into a portable action until that profile lands.
for (const [kind, field, build] of [
  ['Query', 'typo', () => defineQuery({ table: 'todos', typo: true })],
  ['Mutation', 'typo', () => defineMutation({ plan: insert('todos', { title: lit('x') }), typo: true })],
  ['Action', 'runtime', () => defineAction({ plan: [], runtime: {} })],
  ['Action', 'effects', () => defineAction({ plan: [], effects: ['delivery'] })],
]) {
  assert.throws(build, (error) => (
    error?.code === 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN'
      && error.message.includes(`${kind} has unknown field ${field}`)
  ));
}

async function invalidCase({ schema = validSchema, functions, handlers = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-authoring-'));
  dirs.push(dir);
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  for (const [path, source] of Object.entries(handlers)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  mkdirSync(join(dir, 'generated'));
  writeFileSync(join(dir, 'generated', 'sentinel.txt'), 'pre-existing output\n');
  const result = await generate(dir);
  assert.equal(result.ok, false, `expected failure, got ${JSON.stringify(result.diagnostics)}`);
  assert.equal(readFileSync(join(dir, 'generated', 'sentinel.txt'), 'utf8'), 'pre-existing output\n');
  assert.equal(existsSync(join(dir, 'generated', 'artifacts.json')), false, 'failure must not partially replace output');
  return result.diagnostics;
}

async function validCase({ schema = validSchema, functions, handlers = {} }) {
  const dir = mkdtempSync(join(tmpdir(), 'snapback-codegen-authoring-'));
  dirs.push(dir);
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(dir, 'schema.mjs'), schema);
  writeFileSync(join(dir, 'functions.mjs'), functions);
  for (const [path, source] of Object.entries(handlers)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), source);
  }
  const result = await generate(dir);
  assert.equal(result.ok, true, `expected success, got ${JSON.stringify(result.diagnostics)}`);
  return result;
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync(),
}, { requiredCapabilities: ['offline_mutation_replay'] });
`,
    functions: 'export {};\n',
  });
  const refusal = diagnostics.find(({ code }) => code === 'SNAPBACK_CAPABILITY_UNSUPPORTED');
  assert(refusal, JSON.stringify(diagnostics));
  assert.equal(refusal.capability, 'offline_mutation_replay');
  assert.equal(
    refusal.reason,
    'authorability is withheld until settlement-ledger binding offers and queue-aware client admission land as one owned unit',
  );
  assert.deepEqual(refusal.vocabulary, {
    targetFacts: 'registered',
    authorableSet: 'intentionally-non-authorable',
    bindingOffers: 'not-offered',
    clientAdmission: 'not-admitted',
  });
  for (const label of ['target facts=', 'authorable set=', 'binding offers=', 'client admission=']) {
    assert(refusal.message.includes(label), `missing ${label} from ${refusal.message}`);
  }
}

{
  const diagnostics = await invalidCase({
    functions: `
import { defineAction } from '${defineUrl}';
export const proposedButUnimplemented = defineAction({ runtime: { profile: 'isolated-node-action-v1' }, effects: ['delivery'] });
`,
  });
  assert(
    diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_FUNCTION_SPEC_FIELD_UNKNOWN'
        && diagnostic.message.includes('Action has unknown field runtime')
    )),
    JSON.stringify(diagnostics),
  );
}

// LLP 0231 D3/D5: an opaque JS query may declare its interim field-masking
// residual, but codegen projects it as a handler claim rather than proof.
{
  const declared = await validCase({
    functions: `
import { defineJsLiveQuery, results, v } from '${defineUrl}';
export const liveTally = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  reads: ['todos'],
  result: results.records(v.object({ value: v.union([v.string(), v.null()]) })),
  fieldBoundary: {
    fields: ['value'],
    condition: 'the round is revealed or the caller owns the vote',
  },
  handler: async () => [{ value: null }],
});
`,
  });
  assert.deepEqual(declared.functionManifest.functions[0].fieldBoundary, {
    fields: ['value'],
    condition: 'the round is revealed or the caller owns the vote',
  });
  assert.deepEqual(declared.summary.fieldBoundaries, [{
    function: 'liveTally',
    fields: ['value'],
    condition: 'the round is revealed or the caller owns the vote',
  }]);
  assert.equal(declared.summary.counts.fieldBoundaries, 1);
  assert.match(
    formatCodegenSummary(declared.summary),
    /field boundary liveTally: value — handler-enforced \(not proven\)/u,
  );

  const documentRows = await validCase({
    functions: `
import { defineJsQuery, results, v } from '${defineUrl}';
export const privateTodos = defineJsQuery({
  auth: 'authenticated',
  args: {},
  reads: ['todos'],
  result: results.documents('todos'),
  fieldBoundary: { fields: ['title'], condition: 'the caller owns the todo' },
  handler: async () => [],
});
`,
  });
  assert.deepEqual(documentRows.functionManifest.functions[0].fieldBoundary.fields, ['title']);

  const invalidBoundary = async (fieldBoundary, code, resultField = 'value') => {
    const diagnostics = await invalidCase({
      functions: `
import { defineJsLiveQuery, results, v } from '${defineUrl}';
export const liveTally = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  reads: ['todos'],
  result: results.records(v.object({ ${resultField}: v.union([v.string(), v.null()]) })),
  fieldBoundary: ${fieldBoundary},
  handler: async () => [],
});
`,
    });
    assert(
      diagnostics.some((diagnostic) => diagnostic.code === code),
      `missing ${code}: ${JSON.stringify(diagnostics)}`,
    );
  };
  await invalidBoundary(
    `{ fields: ['value'], condition: 'owner', extra: true }`,
    'SNAPBACK_FIELD_BOUNDARY_SPEC_INVALID',
  );
  await invalidBoundary(
    `{ fields: [], condition: 'owner' }`,
    'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
  );
  await invalidBoundary(
    `{ fields: ['value', 'value'], condition: 'owner' }`,
    'SNAPBACK_FIELD_BOUNDARY_FIELDS_INVALID',
  );
  await invalidBoundary(
    `{ fields: ['value'], condition: '   ' }`,
    'SNAPBACK_FIELD_BOUNDARY_CONDITION_INVALID',
  );
  await invalidBoundary(
    `{ fields: ['missing'], condition: 'owner' }`,
    'SNAPBACK_FIELD_BOUNDARY_FIELD_UNKNOWN',
  );
}

// Declarative mutation failures use the same closed app-code declaration as
// imperative ctx.refuse(). Both Get.elseError and Guard must be cross-checked
// before a functions manifest can be emitted.
{
  const declared = await validCase({
    functions: `
import { arg, defineMutation, get, guard, lit, v } from '${defineUrl}';
export const updateTodo = defineMutation({
  args: { id: v.string() },
  plan: [
    get('todos', arg('id'), 'todo', { elseError: 'TODO_NOT_FOUND' }),
    guard(lit(true), 'TODO_LOCKED'),
  ],
  refusals: ['TODO_NOT_FOUND', 'TODO_LOCKED'],
});
`,
  });
  assert.deepEqual(
    declared.functionManifest.functions[0].refusals,
    ['TODO_NOT_FOUND', 'TODO_LOCKED'],
  );

  const missingGuard = await invalidCase({
    functions: `
import { arg, defineMutation, get, guard, lit, v } from '${defineUrl}';
export const updateTodo = defineMutation({
  args: { id: v.string() },
  plan: [
    get('todos', arg('id'), 'todo', { elseError: 'TODO_NOT_FOUND' }),
    guard(lit(true), 'TODO_LOCKED'),
  ],
  refusals: ['TODO_NOT_FOUND'],
});
`,
  });
  const guardDiagnostic = missingGuard.find(
    (diagnostic) => diagnostic.code === 'FUNCTION_PLAN_REFUSAL_UNDECLARED',
  );
  assert.ok(guardDiagnostic, `expected undeclared Guard refusal: ${JSON.stringify(missingGuard)}`);
  assert.match(guardDiagnostic.message, /Guard step 1 emits app refusal TODO_LOCKED/u);
  assert.deepEqual(
    {
      refusal: guardDiagnostic.refusal,
      stepKind: guardDiagnostic.stepKind,
      stepIndex: guardDiagnostic.stepIndex,
    },
    { refusal: 'TODO_LOCKED', stepKind: 'Guard', stepIndex: 1 },
  );

  const missingGet = await invalidCase({
    functions: `
import { arg, defineMutation, get, v } from '${defineUrl}';
export const updateTodo = defineMutation({
  args: { id: v.string() },
  plan: get('todos', arg('id'), 'todo', { elseError: 'TODO_NOT_FOUND' }),
});
`,
  });
  const getDiagnostic = missingGet.find(
    (diagnostic) => diagnostic.code === 'FUNCTION_PLAN_REFUSAL_UNDECLARED',
  );
  assert.ok(getDiagnostic, `expected undeclared Get refusal: ${JSON.stringify(missingGet)}`);
  assert.match(getDiagnostic.message, /Get step 0 emits app refusal TODO_NOT_FOUND/u);
}

const jsActionFunctions = `
import { defineAction } from '${defineUrl}';
export const probe = defineAction({
  args: {},
  js: { source: 'handler.mjs', exportName: 'probe' },
});
`;

const tsActionFunctions = `
import { defineAction } from '${defineUrl}';
export const probe = defineAction({
  args: {},
  js: { source: 'handler.ts', exportName: 'probe' },
});
`;

// @ref LLP 0222#design-detail — target support is necessary but
// not sufficient: dev-auth generated actions omit the session-only predicate.
{
  const result = await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': 'globalThis.__snapbackHandlers = { async probe() { return null; } };\n',
    },
  });
  const apiTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  assert(apiTypes.includes(
    'GeneratedRuntimeContext, any, SecretsContext<any>, unknown, never, never>;',
  ));
  assert.equal(
    apiTypes.includes('never, RealtimeContext>;'),
    false,
    'dev-auth action contexts omit the connected-client predicate',
  );
}

// LLP 0143 registry declaration is explicit, session-only, and closed. It
// does not imply the later send/ledger slices.
{
  const result = await validCase({
    schema: `
import { definePushSeam, defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }) },
  {
    auth: { mode: 'sessions' },
    pushSeam: definePushSeam({
      appScope: {
        easProjectId: 'eas-project-fixture',
        applicationId: 'com.example.fixture',
        environment: 'preview',
      },
      registry: { idleRetentionMs: 2592000000 },
    }),
  },
);
`,
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.pushSeam, {
    appScope: {
      easProjectId: 'eas-project-fixture',
      applicationId: 'com.example.fixture',
      environment: 'preview',
    },
    registry: { idleRetentionMs: 2_592_000_000 },
  });
  const apiTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  assert(
    apiTypes.includes('GeneratedRuntimeContext, any, SecretsContext<any>, unknown, never, RealtimeContext>;'),
    'session target instantiates the connected-client action surface without inventing push send',
  );
}

// @ref LLP 0146#d1-declarationobservation-conformance — strict declaration
// conformance is a per-app boolean opt-in on defineSchema, carried on the
// schema manifest; per the 2026-08-03 OQ1 ruling it is NOT the default for
// newly generated apps, so an unoptioned schema must not emit the field.
{
  const optedIn = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
  { strictDeclarations: true },
);
`,
    functions: 'export const nothing = 0;\n',
  });
  const strictManifest = JSON.parse(
    readFileSync(join(optedIn.outDir, 'schema.manifest.json'), 'utf8'),
  );
  assert.equal(strictManifest.strictDeclarations, true);

  const defaulted = await validCase({ functions: 'export const nothing = 0;\n' });
  const defaultManifest = JSON.parse(
    readFileSync(join(defaulted.outDir, 'schema.manifest.json'), 'utf8'),
  );
  assert.equal('strictDeclarations' in defaultManifest, false, 'opt-in is not the default');

  // An explicit false is a valid spelling of the default posture.
  const explicitFalse = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
  { strictDeclarations: false },
);
`,
    functions: 'export const nothing = 0;\n',
  });
  const falseManifest = JSON.parse(
    readFileSync(join(explicitFalse.outDir, 'schema.manifest.json'), 'utf8'),
  );
  assert.equal('strictDeclarations' in falseManifest, false);

  const invalid = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema(
  { todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
  { strictDeclarations: 'yes' },
);
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    JSON.stringify(invalid).includes('strictDeclarations'),
    `non-boolean opt-in must refuse with the option named: ${JSON.stringify(invalid)}`,
  );
}

// The send lane admits only generated audience references. Membership
// resolvers bind to an installed declaration; explicit-principal resolvers
// are declaration-bounded and cannot become a deferred raw-list escape hatch.
{
  const result = await validCase({
    schema: `
import { definePushSeam, defineSchema, defineTable, v } from '${defineUrl}';
const eventMembers = defineTable({
  principal: v.principal(), eventId: v.id('events'), role: v.string(),
}).visibility({ kind: 'owner', field: 'principal' }).membership({
  id: 'event_members', principal: 'principal', resource: 'eventId', role: 'role',
  roles: ['host', 'guest'], transitions: [],
});
export const pushSeam = definePushSeam({
  appScope: { easProjectId: 'eas', applicationId: 'app', environment: 'test' },
  registry: { idleRetentionMs: 86400000 },
  audiences: {
    guests: {
      resolve: { membership: eventMembers, resourceArg: 'eventId', roles: ['guest'] },
      authorize: { membership: eventMembers, resourceArg: 'eventId', roles: ['host'] },
    },
    selectedGuests: {
      resolve: { principalsArg: 'principalIds', maxItems: 12 },
      authorize: { system: true },
    },
  },
  uses: ['expoPushAccessToken'],
  ledger: { retentionMs: 2592000000 },
});
export default defineSchema({
  events: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
  eventMembers,
}, {
  auth: { mode: 'sessions' }, pushSeam,
});
`,
    functions: `
import { defineConfig, definePushLedgerQuery } from '${defineUrl}';
export const config = defineConfig({
  expoPushAccessToken: { required: false, description: 'fixture Expo access token' },
});
export const pushLedger = definePushLedgerQuery({ auth: 'authenticated' });
`,
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.pushSeam.audiences.guests, {
    resolve: { kind: 'membership', declaration: 'event_members', resourceArg: 'eventId', roles: ['guest'] },
    authorize: { kind: 'membership', declaration: 'event_members', resourceArg: 'eventId', roles: ['host'] },
  });
  assert.deepEqual(manifest.pushSeam.audiences.selectedGuests, {
    resolve: { kind: 'explicitPrincipals', principalsArg: 'principalIds', maxItems: 12 },
    authorize: { kind: 'system' },
  });
  assert.deepEqual(manifest.pushSeam.uses, ['expoPushAccessToken']);
  assert.deepEqual(manifest.pushSeam.ledger, { retentionMs: 2_592_000_000 });
  assert(manifest.requiredCapabilities.includes('notifications.expoPushSeam'));
  const functions = JSON.parse(readFileSync(join(result.outDir, 'functions.manifest.json'), 'utf8'));
  const ledger = functions.functions.find((fn) => fn.name === 'pushLedger');
  assert.deepEqual(ledger.runtime, { HostPlan: { PushLedgerQuery: {} } });
  assert.deepEqual(ledger.readSetSummary.tables, ['_snapback_push_ledger_v1']);
  assert.deepEqual(ledger.effectCeiling.authorizationInputs, ['pushAudienceAuthorization']);
  assert(ledger.requiredCapabilities.includes('notifications.expoPushSeam'));
  assert.equal(ledger.resultContract.kind, 'records');
  const fields = ledger.resultContract.record.fields.map((field) => field.name);
  assert(fields.includes('handedToExpoAtMs'));
  assert(fields.includes('expoAcceptedAtMs'));
  assert(fields.includes('expoErrorCode'));
  assert(!fields.includes('tokenBytes'));
  assert(!fields.includes('payload'));
  const apiTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  assert(apiTypes.includes(
    'Readonly<{ audience: "guests"; args: Readonly<{ "eventId": string }> }>',
  ));
  assert(apiTypes.includes(
    'Readonly<{ audience: "selectedGuests"; args: Readonly<{ "principalIds": readonly Principal[] }> }>',
  ));
  assert(apiTypes.includes('export type GeneratedPushAudienceName = "guests" | "selectedGuests";'));
  assert(apiTypes.includes(
    'GeneratedRuntimeContext, any, SecretsContext<any>, unknown, GeneratedPush, RealtimeContext>;',
  ));
  assert(apiTypes.includes('send(request: GeneratedPushSendRequest): Promise<GeneratedPushSendResult>;'));
  assert(apiTypes.includes('readonly redriveAmbiguous?: boolean'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    withdrawalVisibilityDeadlineMs: 501,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => (
    diagnostic.code === 'EPHEMERAL_INVALID_BUDGET'
    && diagnostic.field === 'withdrawalVisibilityDeadlineMs'
    && diagnostic.maximum === 500
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { definePushSeam, defineSchema } from '${defineUrl}';
export default defineSchema({}, {
  auth: { mode: 'dev' },
  pushSeam: definePushSeam({
    appScope: { easProjectId: 'eas', applicationId: 'app', environment: 'dev' },
    registry: { idleRetentionMs: 86400000 },
  }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => /pushSeam requires auth\.mode sessions/u.test(
    diagnostic.message ?? '',
  )));
}

function handlerWith(statement) {
  return `// scanner location prelude\n${statement}\nglobalThis.__snapbackHandlers = { async probe() { return {}; } };\n`;
}

// 0137 a4-f1: an inline-form action whose handler performs a global fetch.
// Admission must follow the same SNAPBACK_OUTBOUND_ACTIONS seam the module
// scanner applies; before the fix the inline allowlist had no egress
// awareness and this refused with SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER
// even under the opt-in.
const inlineFetchActionFunctions = `
import { defineAction, results, v } from '${defineUrl}';
export const notify = defineAction({
  args: { url: v.string() },
  handler: async (ctx, args) => {
    const response = await fetch(args.url);
    return { ok: response !== null };
  },
  result: results.value(v.object({ ok: v.boolean() })),
  writes: [],
});
`;

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ body: v.string(), status: v.string() }).searchIndex('search_notes', {
    semanticVersion: 'notes.v1',
    textFields: { body: { weight: 1, classification: 'public' } },
    equalityFilters: ['status'],
    visibility: { kind: 'public-read' },
  }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID'
    && diagnostic.requiredFields?.includes('status')
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ body: v.string(), status: v.string() }).searchIndex('search_notes', {
    semanticVersion: 'notes.v1',
    textFields: { body: { weight: 1, classification: 'public' } },
    fieldClassifications: { status: 'private' },
    storedFields: ['status'],
    visibility: { kind: 'public-read' },
  }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID'
    && diagnostic.field === 'status'
  )));
}

{
  const diagnostics = await invalidCase({
    functions: `
import { defineQuery } from '${defineUrl}';
export const listTodos = defineQuery({ table: 'todos', args: { forged: {} } });
`,
  });
  assert(diagnostics.some((d) => d.code === 'FUNCTION_INVALID_VALIDATOR' && d.arg === 'forged'));
}

// @ref LLP 0178#v1--optional-plan-argument-contradiction — caller-optional
// arguments cannot feed strict Arg nodes. The positive case also exercises
// invalidCase's existing previous-output-preservation assertions.
{
  const schema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({
    title: v.string(),
    replyToId: v.optional(v.id('todos')),
  }).visibility({ kind: 'public-read' }),
});
`;
  const diagnostics = await invalidCase({
    schema,
    functions: `
import { arg, defineMutation, insert, lit, v } from '${defineUrl}';
export const createTodo = defineMutation({
  args: { replyToId: v.optional(v.id('todos')) },
  plan: insert('todos', { title: lit('hello'), replyToId: arg('replyToId') }),
});
`,
  });
  const contradiction = diagnostics.find(
    (diagnostic) => diagnostic.code === 'SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION',
  );
  assert.ok(contradiction, `expected optional-arg contradiction: ${JSON.stringify(diagnostics)}`);
  assert.equal(contradiction.severity, 'error');
  assert.equal(contradiction.function, 'createTodo');
  assert.equal(contradiction.argument, 'replyToId');
  assert.equal(contradiction.planSite, 'insert replyToId');
  assert.match(contradiction.message, /createTodo/u);
  assert.match(contradiction.message, /replyToId/u);
  assert.match(contradiction.message, /insert replyToId/u);
  assert.equal(contradiction.details.runtimeRefusal, 'SNAPBACK_ARG_MISSING');
  assert.deepEqual(
    contradiction.details.remediations.map((remediation) => remediation.kind),
    ['makeArgumentRequired', 'splitOperation', 'consumeViaArgOpt', 'guidePointer'],
  );
  const policyOptions = contradiction.details.remediations.filter(
    (remediation) => remediation.kind !== 'guidePointer',
  );
  assert(
    policyOptions.every((remediation) => (
      remediation.riskClass === 'policy'
      && remediation.machineApplicable === false
      && remediation.requiresApproval === true
      && remediation.authorityEffect === 'none'
    )),
    `repairs must remain human policy choices: ${JSON.stringify(contradiction.details.remediations)}`,
  );
  const guidePointer = contradiction.details.remediations.find(
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
      pageId: 'backend.mutations',
      path: 'guide/backend/mutations.md',
      anchor: 'define-the-write-boundary',
      riskClass: 'policy',
      machineApplicable: false,
      requiresApproval: true,
      authorityEffect: 'none',
      precondition: {
        function: 'createTodo',
        argument: 'replyToId',
        planSite: 'insert replyToId',
      },
    },
  );
  assert.equal(
    guideManifest.pages[guidePointer.pageId]?.path,
    guidePointer.path,
    'optional-arg guidePointer resolves through the generated guide manifest',
  );
  assert.equal(typeof guidePointer.reason, 'string');
  assert.equal(guidePointer.reason.includes('\n'), false, 'guidePointer reason stays one line');

  // Runtime front-run linkage: the committed LLP 0051 D5 conformance case
  // carries the same serialized ValueExpr::Arg node and pins the refusal.
  // The shared evaluator raises it at src/value_expr.rs:136.
  const runtimeCase = JSON.parse(readFileSync(join(
    dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'tests',
    'conformance',
    'data-tier',
    'reject-strict-arg-missing.case.json',
  ), 'utf8'));
  assert.deepEqual(Object.keys(runtimeCase.plan.return_value.Expr), [contradiction.details.expressionKind]);
  assert.equal(runtimeCase.expect.error.code, contradiction.details.runtimeRefusal);

  await validCase({
    schema,
    functions: `
import { arg, defineMutation, insert, lit, v } from '${defineUrl}';
export const createTodo = defineMutation({
  args: { replyToId: v.id('todos') },
  plan: insert('todos', { title: lit('hello'), replyToId: arg('replyToId') }),
});
`,
  });

  const omissionSafe = await validCase({
    schema,
    functions: `
import { arg, argOpt, cond, defineMutation, insert, lit, v } from '${defineUrl}';
export const createTodo = defineMutation({
  args: {
    replyToId: v.optional(v.id('todos')),
    clientNote: v.optional(v.string()),
  },
  plan: insert('todos', {
    title: cond(lit(false), arg('clientNote'), lit('hello')),
    replyToId: argOpt('replyToId'),
  }),
});
`,
  });
  assert.equal(
    omissionSafe.diagnostics.some(
      (diagnostic) => diagnostic.code === 'SNAPBACK_AUTHORING_OPTIONAL_ARG_CONTRADICTION',
    ),
    false,
    'argOpt and a strict Arg confined to one lazy branch are not presence-requiring plan uses',
  );
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
const todos = defineTable({ title: v.string() });
todos.fields.title = {};
export default defineSchema({ todos });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_INVALID_VALIDATOR' && d.field === 'title'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).index('bad-name', ['title']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.index === 'bad-name'));
}

{
  const result = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ rsvps: defineTable({ eventId: v.string(), userId: v.principal() }).index('by_event_user', ['eventId', 'userId'], { unique: true }).visibility({ kind: 'public-read' }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tables[0].indexes, [{ name: 'by_event_user', fields: ['eventId', 'userId'], unique: true }]);
}

{
  const result = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  rsvps: defineTable({
    eventId: v.string(),
    userId: v.optional(v.principal()),
  })
    .index('by_event_user', ['eventId', 'userId'], { unique: true })
    .visibility({ kind: 'public-read' }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tables[0].indexes, [{
    name: 'by_event_user',
    fields: ['eventId', 'userId'],
    unique: true,
    whereApplicable: true,
  }]);
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  rsvps: defineTable({ eventId: v.string(), userId: v.optional(v.principal()) })
    .index('by_event_user', ['eventId', 'userId'], { unique: true, whereApplicable: true }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => (
    diagnostic.code === 'CODEGEN_MODULE_EVALUATION_FAILED'
      && diagnostic.message.includes('index by_event_user options has unknown field whereApplicable')
      && diagnostic.message.includes('codegen derives whereApplicable when { unique: true } indexes a v.optional(...) field')
      && diagnostic.message.includes('.index("by_event_user", fields, { unique: true })')
  )), JSON.stringify(diagnostics));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).permissionBacking(['missing', 'missing']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELD_UNKNOWN' && d.field === 'missing'));
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELD_DUPLICATE' && d.field === 'missing'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
const todos = defineTable({ title: v.string() });
todos.permissionFields = ['title'];
export default defineSchema({ todos });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'SCHEMA_PERMISSION_FIELDS_WITHOUT_BACKING'));
}

// LLP 0057 reservation is ASCII-case-insensitive at both codegen scopes.
for (const table of ['_auth', '_auth_users', '_AUTH_USERS', '_AuTh_Users']) {
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ ${JSON.stringify(table)}: defineTable({ title: v.string() }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.table === table),
    `expected protected auth table ${table} to be rejected`,
  );
}

for (const index of ['_auth', '_auth_lookup', '_AUTH_LOOKUP', '_AuTh_Lookup']) {
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({ todos: defineTable({ title: v.string() }).index(${JSON.stringify(index)}, ['title']) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => d.code === 'SCHEMA_INVALID_IDENTIFIER' && d.index === index),
    `expected protected auth index ${index} to be rejected`,
  );
}

{
  const diagnostics = await invalidCase({
    functions: `
import { defineMutation, deleteWhere, eq, lit } from '${defineUrl}';
export const clearTypo = defineMutation({ plan: deleteWhere('todos', [eq('_versoin', lit(1))]) });
`,
  });
  assert(diagnostics.some((d) => d.code === 'QUERY_UNKNOWN_FIELD' && d.field === '_versoin'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const cursors = ephemeral.collection({
  scope: { roomId: v.string() },
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  maxTtlMs: -1,
  maxValueBytes: -1,
  hardMaxValueBytes: -1,
  publishRate: { sustainedHz: -1, burst: -1 },
  delivery: { mode: 'latest', dispatchMs: -1 },
  maxPendingEphemeralKeys: -1,
  publish: allow.all(),
  subscribe: allow.all(),
});
cursors.scope.roomId = {};
export default defineSchema({}, { ephemeral: defineEphemeral({ cursors }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_VALIDATOR' && d.field === 'roomId'));
  const invalidBudgetFields = new Set(
    diagnostics.filter((d) => d.code === 'EPHEMERAL_INVALID_BUDGET').map((d) => d.field),
  );
  assert.deepEqual(invalidBudgetFields, new Set([
    'maxTtlMs',
    'maxValueBytes',
    'hardMaxValueBytes',
    'sustainedHz',
    'burst',
    'dispatchMs',
    'maxPendingEphemeralKeys',
  ]));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const collection = ephemeral.collection({
  scope: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [\`field_\${index}\`, v.string()])),
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  publish: allow.all(),
  subscribe: allow.all(),
});
export default defineSchema({}, { ephemeral: defineEphemeral({ cursors: collection }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_SCOPE_TOO_WIDE'
    && d.fields === 17
    && d.maximum === 16
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
const collection = ephemeral.collection({
  scope: { ${'s'.repeat(65)}: v.string() },
  value: v.object({ x: v.number() }),
  ttlMs: 1000,
  publish: allow.all(),
  subscribe: allow.all(),
});
export default defineSchema({}, { ephemeral: defineEphemeral({ ${'c'.repeat(65)}: collection }) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_IDENTIFIER'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { ${'s'.repeat(65)}: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_INVALID_SCOPE_FIELD'));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    maxTtlMs: 30_001,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_BUDGET'
    && d.field === 'maxTtlMs'
    && d.maximum === 30_000
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    routing: ['roomId', 'roomId'],
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    maxPendingEphemeralKeys: 1_025,
    publish: allow.all(),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_UNSAFE_ROUTING'
    && d.field === 'roomId'
  )));
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_BUDGET'
    && d.field === 'maxPendingEphemeralKeys'
    && d.maximum === 1_024
  )));
}

{
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  cursors: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ x: v.number() }),
    ttlMs: 1000,
    publish: allow.roomPermission('room:admin'),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_AUTH'
    && d.operation === 'publish'
    && d.prefix === 'room:admin'
  )));
}

const ephemeralMembershipSchema = ({
  tables = `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  profiles: defineTable({ name: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(),
    conversationId: v.id('conversations'),
    role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members',
    principal: 'userId',
    resource: 'conversationId',
    role: 'role',
    roles: ['member'],
    transitions: [],
  }),
`,
  collections = `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members'),
    subscribe: allow.members('conversation_members'),
  }),
`,
} = {}) => `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from '${defineUrl}';
export default defineSchema({${tables}}, { ephemeral: defineEphemeral({${collections}}) });
`;

// Counterpart: src/ephemeral.rs:
// tests::codegen_emitted_membership_projection_parses_and_activates_in_sessions.
const CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256 =
  '115caa6b485d5b2d02fa7d3e2e2af810499da5359351540a1955795983535f19';

function canonicalJson(value) {
  const sort = (entry) => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (entry && typeof entry === 'object') {
      return Object.fromEntries(
        Object.keys(entry).sort().map((key) => [key, sort(entry[key])]),
      );
    }
    return entry;
  };
  return JSON.stringify(sort(value));
}

async function codegenEmittedMembershipManifestMatchesRustFixtureDigest() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-membership-digest-'));
  dirs.push(root);
  const backend = join(root, 'snapback');
  mkdirSync(backend);
  writeFileSync(join(root, 'demo.snapback.json'), '{"id":"membership-digest-fixture"}\n');
  const snapbackModules = join(backend, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(backend, 'schema.mjs'), `
import { allow, defineEphemeral, defineSchema, defineTable, ephemeral, v } from './node_modules/@expo/snapback-codegen/define.mjs';
export default defineSchema({
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(),
    conversationId: v.id('conversations'),
    role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members',
    principal: 'userId',
    resource: 'conversationId',
    role: 'role',
    roles: ['owner', 'member', 'moderator'],
    pendingRoles: ['invited'],
    transitions: [
      { op: 'remove', from: ['member'], by: ['owner'], target: 'other' },
      { op: 'setRole', from: ['member'], to: ['moderator'], by: ['owner'], target: 'other' },
    ],
  }),
}, { ephemeral: defineEphemeral({
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members', { roles: ['owner', 'member'] }),
    subscribe: allow.members('conversation_members', { roles: ['owner', 'member'] }),
  }),
}), auth: { mode: 'sessions' } });
`);
  writeFileSync(join(backend, 'functions.mjs'), 'export const nothing = 0;\n');

  const previousGeneratedAt = process.env.SNAPBACK_GENERATED_AT_MS;
  process.env.SNAPBACK_GENERATED_AT_MS = '0';
  let generated;
  try {
    generated = await generate(backend);
  } finally {
    if (previousGeneratedAt === undefined) delete process.env.SNAPBACK_GENERATED_AT_MS;
    else process.env.SNAPBACK_GENERATED_AT_MS = previousGeneratedAt;
  }
  assert.equal(
    generated.ok,
    true,
    `membership digest fixture failed codegen: ${JSON.stringify(generated.diagnostics)}`,
  );
  const emittedBytes = readFileSync(join(generated.outDir, 'schema.manifest.json'));
  const canonicalBytes = canonicalJson(JSON.parse(emittedBytes.toString('utf8')));
  const actual = createHash('sha256').update(canonicalBytes).digest('hex');
  assert.equal(
    actual,
    CODEGEN_MEMBERSHIP_SCHEMA_MANIFEST_CANONICAL_SHA256,
    'actual codegen schema manifest drifted from the Rust embedded fixture',
  );
}

await codegenEmittedMembershipManifestMatchesRustFixtureDigest();

// Only canonical membership() declarations resolve. A similarly named raw
// permission-backing or ordinary table is deliberately not an authority source.
for (const tableDeclaration of [
  `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  roomMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }),
`,
  `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  roomMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).permissionBacking(),
`,
]) {
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: tableDeclaration,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('roomMembers'),
    subscribe: allow.members('roomMembers'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => (
      d.code === 'EPHEMERAL_MEMBERSHIP_UNKNOWN_DECLARATION'
        && d.declaration === 'roomMembers'
    )),
    JSON.stringify(diagnostics),
  );
}

for (const [scope, policy, expectedReason] of [
  [
    `{ conversationId: v.id('conversations') }`,
    `allow.members('conversation_members', { scopeField: 'missing' })`,
    'unknown-scope-field',
  ],
  [
    `{ conversationId: v.id('conversations'), threadId: v.string() }`,
    `allow.members('conversation_members')`,
    'multi-scope-unbacked',
  ],
  [
    `{ conversationId: v.id('conversations'), threadId: v.string() }`,
    `allow.members('conversation_members', { scopeField: 'conversationId' })`,
    'multi-scope-unbacked',
  ],
]) {
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      collections: `
  typing: ephemeral.collection({
    scope: ${scope},
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: ${policy},
    subscribe: ${policy},
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => (
      d.code === 'EPHEMERAL_MEMBERSHIP_SCOPE_MISMATCH'
        && d.reason === expectedReason
    )),
    JSON.stringify(diagnostics),
  );
}

// A room scope is not merely string-shaped: its mapped field must inhabit the
// membership declaration's exact nominal resource-id domain. This applies to
// both implicit and explicit single-scope mapping, and non-id validators can
// never bind a membership resource in v1.
for (const [scope, policy, actualResourceTable, actualOptional = false] of [
  [
    `{ profileId: v.id('profiles') }`,
    `allow.members('conversation_members')`,
    'profiles',
  ],
  [
    `{ profileId: v.id('profiles') }`,
    `allow.members('conversation_members', { scopeField: 'profileId' })`,
    'profiles',
  ],
  [
    `{ conversationId: v.string() }`,
    `allow.members('conversation_members')`,
    null,
  ],
  [
    `{ conversationId: v.string() }`,
    `allow.members('conversation_members', { scopeField: 'conversationId' })`,
    null,
  ],
  [
    `{ conversationId: v.optional(v.id('conversations')) }`,
    `allow.members('conversation_members')`,
    'conversations',
    true,
  ],
]) {
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      collections: `
  typing: ephemeral.collection({
    scope: ${scope},
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: ${policy},
    subscribe: ${policy},
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((d) => (
      d.code === 'EPHEMERAL_MEMBERSHIP_SCOPE_DOMAIN_MISMATCH'
        && d.reason === 'resource-domain-mismatch'
        && d.scopeField === (actualResourceTable === 'profiles' ? 'profileId' : 'conversationId')
        && d.expectedResourceTable === 'conversations'
        && d.actualResourceTable === actualResourceTable
        && d.actualOptional === actualOptional
        && /must use v\.id\("conversations"\)/u.test(d.message)
    )),
    JSON.stringify(diagnostics),
  );
}

{
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: `
  appMembers: defineTable({
    userId: v.principal(), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'app_members', scope: 'app', principal: 'userId', role: 'role',
    roles: ['member'], transitions: [],
  }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('app_members'),
    subscribe: allow.members('app_members'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_MEMBERSHIP_SCOPE_MISMATCH'
      && d.reason === 'app-scope'
  )), JSON.stringify(diagnostics));
}

{
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  firstMembers: defineTable({ userId: v.principal(), conversationId: v.id('conversations'), role: v.string() })
    .visibility({ kind: 'owner', field: 'userId' })
    .membership({ id: 'first_members', principal: 'userId', resource: 'conversationId', role: 'role', roles: ['member'], transitions: [] }),
  secondMembers: defineTable({ userId: v.principal(), conversationId: v.id('conversations'), role: v.string() })
    .visibility({ kind: 'owner', field: 'userId' })
    .membership({ id: 'second_members', principal: 'userId', resource: 'conversationId', role: 'role', roles: ['member'], transitions: [] }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('first_members'),
    subscribe: allow.members('second_members'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => d.code === 'EPHEMERAL_MEMBERSHIP_MIXED_POLICY'), JSON.stringify(diagnostics));
}

for (const [publish, subscribe] of [
  [`allow.members('conversation_members')`, `allow.all()`],
  [`allow.all()`, `allow.members('conversation_members')`],
  [`allow.members('conversation_members')`, `allow.roomPermission('legacy_room')`],
]) {
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: ${publish},
    subscribe: ${subscribe},
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_MEMBERSHIP_MIXED_POLICY'
      && /runtime derives room authority from the subscribe policy/u.test(d.message)
      && /future runtime capability/u.test(d.message)
  )), JSON.stringify(diagnostics));
}

{
  const generated = await validCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members', principal: 'userId', resource: 'conversationId', role: 'role',
    roles: ['member'], pendingRoles: ['invited'], transitions: [],
  }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members'),
    subscribe: allow.members('conversation_members'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(generated.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.ephemeralCollections[0].permissionBacking, {
    table: 'conversationMembers',
    subjectField: 'userId',
    scopeFields: { conversationId: 'conversationId' },
    roleField: 'role',
    allowedRoles: ['member'],
  });
}

{
  const generated = await validCase({
    schema: ephemeralMembershipSchema({
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members', { roles: ['member'] }),
    subscribe: allow.members('conversation_members'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(generated.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.ephemeralCollections[0].permissionBacking.allowedRoles, ['member']);
}

{
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members', principal: 'userId', resource: 'conversationId', role: 'role',
    roles: ['owner', 'member'], transitions: [],
  }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members', { roles: ['member'] }),
    subscribe: allow.members('conversation_members'),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_MEMBERSHIP_MIXED_POLICY'
      && /same effective membership roles/u.test(d.message)
  )), JSON.stringify(diagnostics));
}

for (const role of ['invited', 'ghost']) {
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members', principal: 'userId', resource: 'conversationId', role: 'role',
    roles: ['owner', 'member'], pendingRoles: ['invited'], transitions: [],
  }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members', { roles: [${JSON.stringify(role)}] }),
    subscribe: allow.members('conversation_members', { roles: [${JSON.stringify(role)}] }),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_MEMBERSHIP_ROLE_UNKNOWN'
      && d.unknownRoles?.includes(role)
  )), JSON.stringify(diagnostics));
}

for (const [prefix, namespace] of [
  ['m_conversation_members', 'generated-membership'],
  ['_snapback_stream_server', 'platform-stream'],
]) {
  const diagnostics = await invalidCase({
    schema: `
import { allow, defineEphemeral, defineSchema, ephemeral, v } from '${defineUrl}';
export default defineSchema({}, { ephemeral: defineEphemeral({
  typing: ephemeral.collection({
    scope: { roomId: v.string() },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.roomPermission(${JSON.stringify(prefix)}),
    subscribe: allow.all(),
  }),
}) });
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_RESERVED_AUTH_PREFIX'
      && d.prefix === prefix
      && d.namespace === namespace
  )), JSON.stringify(diagnostics));
}

{
  const declaration = 'd'.repeat(63);
  const diagnostics = await invalidCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({ userId: v.principal(), conversationId: v.id('conversations'), role: v.string() })
    .visibility({ kind: 'owner', field: 'userId' })
    .membership({ id: ${JSON.stringify(declaration)}, principal: 'userId', resource: 'conversationId', role: 'role', roles: ['member'], transitions: [] }),
`,
      collections: `
  typing: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members(${JSON.stringify(declaration)}),
    subscribe: allow.members(${JSON.stringify(declaration)}),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((d) => (
    d.code === 'EPHEMERAL_INVALID_AUTH'
      && d.prefix === `m_${declaration}`
      && d.maximum === 64
  )), JSON.stringify(diagnostics));
}

// Golden: implicit and explicit single-scope mapping lower to the exact Rust
// serde projection when both operations bind the same membership declaration.
{
  const generated = await validCase({
    schema: ephemeralMembershipSchema({
      tables: `
  conversations: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  conversationMembers: defineTable({
    userId: v.principal(), conversationId: v.id('conversations'), role: v.string(),
  }).visibility({ kind: 'owner', field: 'userId' }).membership({
    id: 'conversation_members', principal: 'userId', resource: 'conversationId', role: 'role',
    roles: ['owner', 'member'], pendingRoles: ['invited'], transitions: [],
  }),
`,
      collections: `
  implicitTyping: ephemeral.collection({
    scope: { conversationId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members'),
    subscribe: allow.members('conversation_members'),
  }),
  explicitTyping: ephemeral.collection({
    scope: { roomId: v.id('conversations') },
    value: v.object({ active: v.boolean() }),
    ttlMs: 1000,
    publish: allow.members('conversation_members', { scopeField: 'roomId', roles: ['member'] }),
    subscribe: allow.members('conversation_members', { scopeField: 'roomId', roles: ['member'] }),
  }),
`,
    }),
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(generated.outDir, 'schema.manifest.json'), 'utf8'));
  const byName = Object.fromEntries(manifest.ephemeralCollections.map((collection) => [collection.name, collection]));
  assert.deepEqual(byName.implicitTyping.permissionBacking, {
    table: 'conversationMembers',
    subjectField: 'userId',
    scopeFields: { conversationId: 'conversationId' },
    roleField: 'role',
    allowedRoles: ['owner', 'member'],
  });
  assert.deepEqual(byName.implicitTyping.publish, {
    RequireRoomPermission: { prefix: 'm_conversation_members' },
  });
  assert.deepEqual(byName.implicitTyping.subscribe, {
    RequireRoomPermission: { prefix: 'm_conversation_members' },
  });
  assert.deepEqual(byName.explicitTyping.permissionBacking, {
    table: 'conversationMembers',
    subjectField: 'userId',
    scopeFields: { roomId: 'conversationId' },
    roleField: 'role',
    allowedRoles: ['member'],
  });
}

// Handler admission is an AST walk, not a token blacklist. Every direct
// dynamic-code/ambient spelling receives a stable code and authored span.
// Reflective aliases and constructor walks are still denied by the runtime;
// this authoring pass deliberately diagnoses only explicit global spellings.
const unsupportedHandlerCases = [
  ["eval('1')", 'BUNDLE_UNSUPPORTED_EVAL', 'eval', 1],
  ["(0, eval)('1')", 'BUNDLE_UNSUPPORTED_EVAL', 'eval', 5],
  ["Function('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 1],
  ["new Function('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 5],
  ["AsyncFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncFunction', 1],
  ["new AsyncFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncFunction', 5],
  ["GeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'GeneratorFunction', 1],
  ["new GeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'GeneratorFunction', 5],
  ["AsyncGeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncGeneratorFunction', 1],
  ["new AsyncGeneratorFunction('return 1')", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'AsyncGeneratorFunction', 5],
  ["Reflect.construct(Function, ['return 1'])", 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR', 'Function', 19],
  ['with ({ allowed: false }) {}', 'BUNDLE_UNSUPPORTED_WITH', 'with', 1],
  ["import './forbidden.mjs'", 'BUNDLE_UNSUPPORTED_IMPORT', 'import', 1],
  ["import('./forbidden.mjs')", 'BUNDLE_UNSUPPORTED_IMPORT', 'import', 1],
  ['export const forbidden = true', 'BUNDLE_UNSUPPORTED_EXPORT', 'export', 1],
  ["require('forbidden')", 'BUNDLE_UNSUPPORTED_REQUIRE', 'require', 1],
  ['process.env.FORBIDDEN', 'BUNDLE_UNSUPPORTED_PROCESS', 'process', 1],
  ["fetch('https://example.com')", 'BUNDLE_UNSUPPORTED_FETCH', 'fetch', 1],
  ['setTimeout(function () {}, 1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['setInterval(function () {}, 1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['clearTimeout(1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['clearInterval(1)', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['requestAnimationFrame(function () {})', 'BUNDLE_UNSUPPORTED_TIMER', 'timer', 1],
  ['Math.random()', 'BUNDLE_UNSUPPORTED_RANDOM', 'Math.random', 1],
  ['Date.now()', 'BUNDLE_UNSUPPORTED_TIME', 'Date', 1],
  ['new Date()', 'BUNDLE_UNSUPPORTED_TIME', 'Date', 5],
  ['WebAssembly.compile(new Uint8Array())', 'BUNDLE_UNSUPPORTED_WEBASSEMBLY', 'WebAssembly', 1],
];

const ambientRepair = new Map([
  ['BUNDLE_UNSUPPORTED_TIMER', [/do not wait on ambient timers/, /guide\/backend\/trusted-runtime-values\.md/]],
  ['BUNDLE_UNSUPPORTED_RANDOM', [/use ctx\.runtime\.id\(\) for a fresh identifier/, /guide\/backend\/trusted-runtime-values\.md/]],
  ['BUNDLE_UNSUPPORTED_TIME', [/use ctx\.runtime\.now\(\) for a trusted integer timestamp/, /guide\/backend\/trusted-runtime-values\.md/]],
  // 0137 a4-f1: the export refusal must name the closed-script registration
  // contract, or the module form dead-ends between this diagnostic and the
  // runtime's SNAPBACK_HANDLER_EXPORT_MISSING.
  ['BUNDLE_UNSUPPORTED_EXPORT', [/globalThis\.__snapbackHandlers/, /guide\/backend\/actions-and-fetch\.md/]],
]);

for (const [statement, code, token, column] of unsupportedHandlerCases) {
  const diagnostics = await invalidCase({
    functions: jsActionFunctions,
    handlers: { 'handler.mjs': handlerWith(statement) },
  });
  const hit = diagnostics.find((diagnostic) => diagnostic.code === code && diagnostic.token === token);
  assert.ok(hit, `${statement}: expected ${code}/${token}, got ${JSON.stringify(diagnostics)}`);
  assert.deepEqual(
    hit.sourceSpan,
    { file: 'handler.mjs', line: 2, column },
    `${statement}: authored source span drifted`,
  );
  for (const pattern of ambientRepair.get(code) ?? []) {
    assert.match(hit.message, pattern, `${statement}: expected an actionable repair with guide routing`);
  }
}

// `.ts`/`.mts` are first-class handler extensions. Type-only syntax is parsed
// structurally, while runtime ambient uses retain exact authored locations.
await validCase({
  functions: tsActionFunctions,
  handlers: {
    'handler.ts': `
type Result = { ok: boolean };
const initial: Result = { ok: true };
globalThis.__snapbackHandlers = {
  async probe(): Promise<Result> { return initial; },
};
`,
  },
});

{
  const diagnostics = await invalidCase({
    functions: tsActionFunctions,
    handlers: {
      'handler.ts': `type Result = { value: string };\nconst value: Result = { value: 'x' };\nFunction('return 1');\nglobalThis.__snapbackHandlers = { async probe(): Promise<Result> { return value; } };\n`,
    },
  });
  const hit = diagnostics.find((diagnostic) => (
    diagnostic.code === 'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR'
    && diagnostic.token === 'Function'
  ));
  assert.deepEqual(hit?.sourceSpan, { file: 'handler.ts', line: 3, column: 1 });
}

// Strings, comments, regex literals, template raw text, object keys, and
// non-global member names are data/member access rather than ambient globals.
await validCase({
  functions: jsActionFunctions,
  handlers: {
    'handler.mjs': `
// eval('x'); new Function(''); process fetch setTimeout Math.random Date.now WebAssembly
const tokens = "eval Function AsyncFunction GeneratorFunction AsyncGeneratorFunction require process fetch timers Math.random Date.now WebAssembly import export with";
const template = \`eval('x') new Function('') process.env fetch() WebAssembly\`;
const pattern = /eval|Function|require|process|fetch|setTimeout|WebAssembly/;
const local = {
  eval() {}, Function() {}, AsyncFunction() {}, GeneratorFunction() {}, AsyncGeneratorFunction() {},
  require() {}, process: { env: {} }, fetch() {}, setTimeout() {},
  Math: { random() {} }, Date: { now() {} }, WebAssembly: { compile() {} },
  import: 'member', export: 'member', with: 'member',
};
local.eval(); local['Function'](); local.AsyncFunction(); local.GeneratorFunction();
local.AsyncGeneratorFunction(); local.require(); local.process.env; local.fetch();
local.setTimeout(); local.Math.random(); local.Date.now(); local.WebAssembly.compile();
globalThis.__snapbackHandlers = { async probe() { return { tokens, template, pattern: String(pattern) }; } };
`,
  },
});

// The outbound-actions switch relaxes only fetch/timer authoring diagnostics.
// It never reopens dynamic evaluation, Wasm, process/module access, entropy,
// or wall-clock reads.
const previousOutboundActions = process.env.SNAPBACK_OUTBOUND_ACTIONS;
process.env.SNAPBACK_OUTBOUND_ACTIONS = '1';
try {
  await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
globalThis.__snapbackHandlers = {
  async probe() {
    var timer = setTimeout(function () {}, 1);
    clearTimeout(timer);
    return { fetchType: typeof fetch };
  }
};
`,
    },
  });

  const streamed = await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
globalThis.__snapbackHandlers = {
  async probe(ctx) {
    const response = await ctx.fetchStream({ url: 'https://example.com' });
    await response.body.getReader().cancel();
    return { status: response.status };
  }
};
`,
    },
  });
  const streamedFunctions = JSON.parse(readFileSync(join(streamed.outDir, 'functions.manifest.json'), 'utf8'));
  const streamedCapabilities = JSON.parse(readFileSync(join(streamed.outDir, 'capability.manifest.json'), 'utf8'));
  assert(
    streamedFunctions.functions[0].requiredCapabilities.includes('bounded_response_stream_v1'),
    'ctx.fetchStream must add the named admission requirement',
  );
  assert.equal(streamedCapabilities.outboundActions, true, 'egress codegen embeds the Rust-owned enabled target variant');
  assert(
    streamedCapabilities.supportedCapabilities.includes('bounded_response_stream_v1'),
    'paired capability artifact must positively support the streamed action requirement',
  );

  // AST-derived inference (LLP 0076): a comment that merely spells the call
  // must not over-require, while a destructuring alias must still require.
  const commentOnly = await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
globalThis.__snapbackHandlers = {
  async probe() {
    // this comment mentions ctx.fetchStream( but the handler never streams
    return { ok: true };
  }
};
`,
    },
  });
  const commentFunctions = JSON.parse(readFileSync(join(commentOnly.outDir, 'functions.manifest.json'), 'utf8'));
  assert(
    !commentFunctions.functions[0].requiredCapabilities.includes('bounded_response_stream_v1'),
    'a comment mention must not add the stream requirement',
  );
  const aliased = await validCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
globalThis.__snapbackHandlers = {
  async probe(ctx) {
    const { fetchStream } = ctx;
    const response = await fetchStream({ url: 'https://example.com' });
    await response.body.getReader().cancel();
    return { status: response.status };
  }
};
`,
    },
  });
  const aliasedFunctions = JSON.parse(readFileSync(join(aliased.outDir, 'functions.manifest.json'), 'utf8'));
  assert(
    aliasedFunctions.functions[0].requiredCapabilities.includes('bounded_response_stream_v1'),
    'a destructuring alias must still add the stream requirement',
  );

  const diagnostics = await invalidCase({
    functions: jsActionFunctions,
    handlers: {
      'handler.mjs': `
eval('1');
Function('return 1');
WebAssembly.compile(new Uint8Array());
process.env.FORBIDDEN;
require('forbidden');
Math.random();
Date.now();
fetch('https://example.com');
setTimeout(function () {}, 1);
globalThis.__snapbackHandlers = { async probe() { return {}; } };
`,
    },
  });
  const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
  for (const code of [
    'BUNDLE_UNSUPPORTED_EVAL',
    'BUNDLE_UNSUPPORTED_FUNCTION_CONSTRUCTOR',
    'BUNDLE_UNSUPPORTED_WEBASSEMBLY',
    'BUNDLE_UNSUPPORTED_PROCESS',
    'BUNDLE_UNSUPPORTED_REQUIRE',
    'BUNDLE_UNSUPPORTED_RANDOM',
    'BUNDLE_UNSUPPORTED_TIME',
  ]) {
    assert(codes.has(code), `egress must retain ${code}: ${JSON.stringify(diagnostics)}`);
  }
  assert.equal(codes.has('BUNDLE_UNSUPPORTED_FETCH'), false, 'egress should allow fetch authoring');
  assert.equal(codes.has('BUNDLE_UNSUPPORTED_TIMER'), false, 'egress should allow timer authoring');

  // 0137 a4-f1: with egress opted in, the INLINE action form admits a global
  // fetch reference exactly like the module-form scanner above.
  await validCase({ functions: inlineFetchActionFunctions });
} finally {
  if (previousOutboundActions === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  else process.env.SNAPBACK_OUTBOUND_ACTIONS = previousOutboundActions;
}

// Default posture pin: without the opt-in, the same inline fetch reference
// still refuses at extraction — the egress seam is opt-in at both forms.
{
  const savedEgress = process.env.SNAPBACK_OUTBOUND_ACTIONS;
  delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
  try {
    const diagnostics = await invalidCase({ functions: inlineFetchActionFunctions });
    assert(
      diagnostics.some((diagnostic) => (
        diagnostic.code === 'SNAPBACK_INLINE_HANDLER_FREE_IDENTIFIER'
        && (diagnostic.identifiers ?? []).includes('fetch')
      )),
      `inline fetch without the egress opt-in must refuse: ${JSON.stringify(diagnostics)}`,
    );
  } finally {
    if (savedEgress === undefined) delete process.env.SNAPBACK_OUTBOUND_ACTIONS;
    else process.env.SNAPBACK_OUTBOUND_ACTIONS = savedEgress;
  }
}

// ---------------------------------------------------------------------------
// publicInline + routes manifest authoring (LLP 0092 §0C, ENG-25448/25454).
// ---------------------------------------------------------------------------

const publicInlineFunctions = `
import { arg, defineLiveQuery, eq, v } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  args: { title: v.string() },
  filter: [eq('title', arg('title'))],
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
export const todosByRank = defineLiveQuery({
  table: 'todos',
  args: { rank: v.integer() },
  auth: 'public',
  authorityIndependent: true,
  publicInline: true,
});
`;

const javascriptRouteFunctions = `
import { defineJsLiveQuery, results, v } from '${defineUrl}';
export const listTodos = defineJsLiveQuery({
  args: { title: v.string() },
  reads: ['todos'],
  result: results.documents('todos'),
  source: 'handlers.mjs',
  exportName: 'listTodos',
});
`;

const structuredRouteSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const boards = defineTable({ title: v.string() }).visibility({ kind: 'public-read' });
export const cells = defineTable({ boardId: v.id('boards'), title: v.string() })
  .visibility({ kind: 'public-read' }).sync();
export default defineSchema({ boards, cells });
`;

const structuredRouteFunctions = `
import { defineLiveQuery, defineQuery, v } from '${defineUrl}';
export const listCells = defineLiveQuery({
  table: 'cells',
  args: {
    context: v.object({
      boardId: v.id('boards'),
      cursor: v.union([v.string(), v.null()]),
      sort: v.union([v.literal('asc'), v.literal('desc')]),
      tags: v.array(v.string(), { maxItems: 4 }),
    }),
  },
});
export const cellsByRank = defineLiveQuery({
  table: 'cells',
  args: { context: v.object({ rank: v.integer() }) },
});
export const cellsByUnion = defineLiveQuery({
  table: 'cells',
  args: { context: v.union([v.object({ boardId: v.id('boards') }), v.null()]) },
});
export const cellsByJson = defineLiveQuery({
  table: 'cells',
  args: { context: v.object({ payload: v.json() }) },
});
export const cellsByIds = defineLiveQuery({
  table: 'cells',
  args: { context: v.object({ ids: v.array(v.id('boards')) }) },
});
export const cellsByLiteral = defineLiveQuery({
  table: 'cells',
  args: { context: v.object({ sort: v.literal('asc') }) },
});
export const snapshotCells = defineQuery({
  table: 'cells',
  args: { context: v.object({ boardId: v.id('boards') }) },
});
`;

{
  // publicInline without a valid authorityIndependent declaration refuses.
  const diagnostics = await invalidCase({
    functions: `
import { defineLiveQuery, v } from '${defineUrl}';
export const listTodos = defineLiveQuery({
  table: 'todos',
  args: {},
  publicInline: true,
});
`,
  });
  assert(
    diagnostics.some((diagnostic) => diagnostic.code === 'FUNCTION_PUBLIC_INLINE_INVALID'),
    `expected FUNCTION_PUBLIC_INLINE_INVALID: ${JSON.stringify(diagnostics)}`,
  );
}

{
  // A valid publicInline declaration compiles into the functions manifest,
  // and defineRoutes compiles into routes.manifest.json with params-v1
  // references validated against the arg schema.
  const result = await validCase({
    functions: publicInlineFunctions,
    handlers: {
      'routes.mjs': `
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([
  { route: '/', queries: [{ function: 'listTodos', args: { title: 'hello' } }] },
  { route: '/t/:title', queries: [{ function: 'listTodos', args: { title: routeParam('title') } }] },
  { route: '/rank/:rank', queries: [{ function: 'todosByRank', args: { rank: routeParam('rank') } }] },
  { route: '/unicode/雪/deep', queries: [{ function: 'listTodos', args: { title: 'café ☃' } }], persist: false },
]);
`,
    },
  });
  const fn = result.functionManifest.functions.find((entry) => entry.name === 'listTodos');
  assert.equal(fn.publicInline, true, 'publicInline compiles into the manifest');
  const routes = JSON.parse(readFileSync(join(result.outDir, 'routes.manifest.json'), 'utf8'));
  assert.equal(routes.formatVersion, 1);
  assert.equal(routes.routes.length, 4);
  assert.deepEqual(routes.routes[1].queries[0].args, { title: { $param: 'title' } });
  assert.equal(routes.routes[1].registerGroupEligible, true);
  assert.equal(
    Object.hasOwn(routes.routes[2], 'registerGroupEligible'),
    false,
    'numeric route params remain valid read-bundle routes but are not register-group eligible',
  );
  const apiModule = await import(`${pathToFileURL(join(result.outDir, 'api.mjs')).href}?groups`);
  assert.equal(apiModule.groups['/t/:title'].artifactKind, 'queryGroupReference');
  assert.equal(apiModule.groups['/t/:title'].id, `${routes.app}:query-group:/t/:title`);
  assert.equal(apiModule.groups['/t/:title'].queries[0].name, 'listTodos');
  const hydratedGroupReference = apiModule.groups['/t/:title'].queries[0].ref;
  assert.equal(hydratedGroupReference.authoringProfile, 'snapback-explicit-v1');
  assert.equal(hydratedGroupReference.delivery, 'live');
  assert.equal(hydratedGroupReference.retention, 'none');
  for (const fact of ['authoringProfile', 'delivery', 'retention']) {
    assert.equal(Object.hasOwn(hydratedGroupReference, fact), true, fact);
  }
  assert.deepEqual(
    apiModule.groups['/t/:title'].queries[0].args,
    { title: { $param: 'title' } },
  );
  const definitionHash = (canonical) => `sha256:${createHash('sha256')
    .update(`snapback:query-group-reference:v1\n${canonical}`)
    .digest('hex')}`;
  assert.equal(
    apiModule.groups['/t/:title'].definitionHash,
    definitionHash('{"queries":[{"args":{"title":{"$param":"title"}},"function":"listTodos"}],"route":"/t/:title"}'),
    'parameterized group identity uses compact recursively key-sorted JSON',
  );
  assert.equal(
    apiModule.groups['/unicode/雪/deep'].definitionHash,
    definitionHash('{"persist":false,"queries":[{"args":{"title":"café ☃"},"function":"listTodos"}],"route":"/unicode/雪/deep"}'),
    'group identity hashes exact UTF-8 Unicode and persistence bytes',
  );
  assert.equal(apiModule.groups['/unicode/雪/deep'].persist, false);
  assert.equal(
    Object.hasOwn(apiModule.groups, '/rank/:rank'),
    false,
    'codegen omits registered groups that would require client-side numeric coercion',
  );
  assert.equal(Object.hasOwn(apiModule.groups['/'], 'persist'), false);
  assert.deepEqual(apiModule.api.groups, apiModule.groups);
  const apiTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  assert(
    apiTypes.includes(
      '"/t/:title": QueryGroupReference<"/t/:title", { "title": string }',
    ),
    'generated route params and group reference stay exact in api.d.ts',
  );
  assert.equal(
    apiTypes.includes('"/rank/:rank": QueryGroupReference<'),
    false,
    'declarations omit routes that cannot preserve pre-I/O string materialization',
  );
  assert(
    apiTypes.includes(
      'args: { readonly "title": { readonly "$param": "title" } }',
    ),
    'generated query tuples preserve the parameter template rather than claiming resolved args',
  );
  assert(
    apiTypes.includes('readonly definitionHash: `sha256:${string}`;')
      && apiTypes.includes('readonly id: `${string}:query-group:${Route}`;'),
    'generated identity declarations retain their exact domains',
  );
  const typesFixture = join(result.outDir, 'query-group-types.fixture.ts');
  writeFileSync(typesFixture, `
import { groups, type QueryGroupEntries, type QueryGroupParams } from './api.js';
const group = groups['/t/:title'];
const params: QueryGroupParams<typeof group> = { title: 'open' };
const template: { readonly title: { readonly $param: 'title' } } = group.queries[0].args;
const resolvedArgs: QueryGroupEntries<typeof group>['listTodos']['args'] = { title: params.title };
const label: 'listTodos' = group.queries[0].name;
const hash: \`sha256:\${string}\` = group.definitionHash;
const id: \`\${string}:query-group:/t/:title\` = group.id;
void [template, resolvedArgs, label, hash, id];
// @ts-expect-error route parameter title is generated as a string
const wrongParams: QueryGroupParams<typeof group> = { title: 1 };
void wrongParams;
`);
  const typecheck = spawnSync(
    fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url)),
    [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      typesFixture,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    typecheck.status,
    0,
    `generated query-group declarations failed exact typecheck\n${typecheck.stdout}\n${typecheck.stderr}`,
  );
  const index = JSON.parse(readFileSync(join(result.outDir, 'artifacts.json'), 'utf8'));
  assert(index.artifacts.includes('routes.manifest.json'), 'artifact index lists the routes manifest');
}

{
  // Depth-one JS route params use the same generated argument contract that
  // served admission consumes, so the route and its registration reference
  // remain eligible together.
  const result = await validCase({
    functions: javascriptRouteFunctions,
    handlers: {
      'handlers.mjs': `
globalThis.__snapbackHandlers = {
  async listTodos() { return []; },
};
`,
      'routes.mjs': `
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([
  { route: '/todos/:title', queries: [{ function: 'listTodos', args: { title: routeParam('title') } }] },
]);
`,
    },
  });
  const routes = JSON.parse(readFileSync(join(result.outDir, 'routes.manifest.json'), 'utf8'));
  assert.equal(routes.routes.length, 1, 'the valid JS route remains in the manifest');
  assert.deepEqual(routes.routes[0].queries[0].args, { title: { $param: 'title' } });
  assert.equal(
    routes.routes[0].registerGroupEligible,
    true,
    'a string-typed depth-one JS route remains register-group eligible',
  );
  const apiModule = await import(`${pathToFileURL(join(result.outDir, 'api.mjs')).href}?js-route`);
  assert.equal(
    apiModule.groups['/todos/:title'].queries[0].name,
    'listTodos',
    'generated group references retain the admitted JS route',
  );
}

{
  // Object-reachable references are typed through the recursive LLP 0131
  // args contract. Null, union-literal, and array members remain
  // literal template data, and group eligibility follows every nested target.
  const result = await validCase({
    schema: structuredRouteSchema,
    functions: structuredRouteFunctions,
    handlers: {
      'routes.mjs': `
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([
  {
    route: '/boards/:boardId',
    queries: [{
      function: 'listCells',
      args: {
        context: {
          boardId: routeParam('boardId'),
          cursor: null,
          sort: 'asc',
          tags: ['open', 'ready'],
        },
      },
    }],
  },
  {
    route: '/ranks/:rank',
    queries: [{ function: 'cellsByRank', args: { context: { rank: routeParam('rank') } } }],
  },
  {
    route: '/mixed-boards/:boardId',
    queries: [
      { function: 'snapshotCells', args: { context: { boardId: routeParam('boardId') } } },
      { function: 'listCells', args: { context: {
        boardId: routeParam('boardId'), cursor: null, sort: 'asc', tags: [],
      } } },
    ],
  },
]);
`,
    },
  });
  const routesPath = join(result.outDir, 'routes.manifest.json');
  const apiPath = join(result.outDir, 'api.mjs');
  const apiTypesPath = join(result.outDir, 'api.d.ts');
  const routes = JSON.parse(readFileSync(routesPath, 'utf8'));
  assert.deepEqual(routes.routes[0].queries[0].args, {
    context: {
      boardId: { $param: 'boardId' },
      cursor: null,
      sort: 'asc',
      tags: ['open', 'ready'],
    },
  });
  assert.equal(
    routes.routes[0].registerGroupEligible,
    true,
    'nested string references preserve register-group eligibility',
  );
  assert.equal(
    Object.hasOwn(routes.routes[1], 'registerGroupEligible'),
    false,
    'a nested integer reference is not register-group eligible',
  );
  assert.equal(
    routes.routes[2].mixedGroupEligible,
    true,
    'nested string references preserve mixed-group eligibility',
  );
  const apiTypes = readFileSync(apiTypesPath, 'utf8');
  assert(
    apiTypes.includes(
      'args: { readonly "context": { readonly "boardId": { readonly "$param": "boardId" }',
    ),
    'api.d.ts preserves the nested route template structurally',
  );
  const firstApi = readFileSync(apiPath, 'utf8');
  const firstTypes = apiTypes;
  const firstRoutes = readFileSync(routesPath, 'utf8');
  const repeated = await generate(dirname(result.outDir));
  assert.equal(repeated.ok, true, `repeat generation failed: ${JSON.stringify(repeated.diagnostics)}`);
  assert.equal(readFileSync(apiPath, 'utf8'), firstApi);
  assert.equal(readFileSync(apiTypesPath, 'utf8'), firstTypes);
  assert.equal(readFileSync(routesPath, 'utf8'), firstRoutes);
}

{
  // Format 1 stays the all-LiveQuery projection; a mixed route receives the
  // distinct format-2 profile. Child labels remain globally unique
  // when a real function name resembles another function's occurrence suffix.
  const maxQueries = Array.from({ length: 32 }, () => "{ function: 'foo', args: {} }").join(',\n');
  const result = await validCase({
    functions: `
import { defineLiveQuery, defineQuery } from '${defineUrl}';
export const foo = defineLiveQuery({ table: 'todos', args: {} });
export const foo2 = defineLiveQuery({ table: 'todos', args: {} });
export const snapshot = defineQuery({ table: 'todos', args: {} });
`,
    handlers: {
      'routes.mjs': `
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([
  { route: '/collision', queries: [
    { function: 'foo', args: {} },
    { function: 'foo2', args: {} },
    { function: 'foo', args: {} },
  ] },
  { route: '/mixed', queries: [
    { function: 'foo', args: {} },
    { function: 'snapshot', args: {} },
  ] },
  { route: '/query-only', queries: [{ function: 'snapshot', args: {} }] },
  { route: '/max', queries: [${maxQueries}] },
]);
`,
    },
  });
  const routes = JSON.parse(readFileSync(join(result.outDir, 'routes.manifest.json'), 'utf8'));
  assert.equal(routes.routes.length, 4, 'ordinary and mixed query routes remain valid preload entries');
  const apiModule = await import(`${pathToFileURL(join(result.outDir, 'api.mjs')).href}?group-admission`);
  assert.deepEqual(Object.keys(apiModule.groups), ['/collision', '/max', '/mixed']);
  assert.deepEqual(
    apiModule.groups['/collision'].queries.map(({ name }) => name),
    ['foo', 'foo2', 'foo3'],
  );
  assert.equal(apiModule.groups['/max'].queries.length, 32);
  assert.equal(apiModule.groups['/max'].queries.at(-1).name, 'foo32');
  const mixed = apiModule.groups['/mixed'];
  assert.equal(mixed.artifactKind, 'queryGroupReference');
  assert.equal(mixed.formatVersion, 2);
  assert.equal(mixed.profile, 'mixed-route.v2');
  assert.match(mixed.planHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(mixed.queries.map(({ ref }) => ref.kind), ['LiveQuery', 'Query']);
  assert.deepEqual(
    mixed.queries[0].nodePlan.normalizedPlan,
    mixed.queries[1].nodePlan.normalizedPlan,
    'byte-identical query plans remain identical before capability binding',
  );
  assert.notEqual(
    mixed.queries[0].nodePlanHash,
    mixed.queries[1].nodePlanHash,
    'Query versus LiveQuery changes NodePlanHash through capability binding',
  );
  assert(
    apiModule.groups['/collision'].queries.every(({ ref }) => ref.kind === 'LiveQuery'),
    'every generated group child is a LiveQuery',
  );
  const apiTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  assert(apiTypes.includes('"/collision": QueryGroupReference<'));
  assert(apiTypes.includes('"/max": QueryGroupReference<'));
  assert(apiTypes.includes('"/mixed": MixedQueryGroupReference<'));
  assert.equal(apiTypes.includes('"/query-only": QueryGroupReference<'), false);
  assert(
    apiTypes.includes('name: "foo3"; ref: FunctionReference<\'foo\', \'LiveQuery\''),
    'runtime collision resolution and declaration labels agree',
  );
  const firstApi = readFileSync(join(result.outDir, 'api.mjs'), 'utf8');
  const firstTypes = readFileSync(join(result.outDir, 'api.d.ts'), 'utf8');
  const repeated = await generate(dirname(result.outDir));
  assert.equal(repeated.ok, true, `repeat generation failed: ${JSON.stringify(repeated.diagnostics)}`);
  assert.equal(readFileSync(join(result.outDir, 'api.mjs'), 'utf8'), firstApi);
  assert.equal(readFileSync(join(result.outDir, 'api.d.ts'), 'utf8'), firstTypes);
}

{
  // Routes refusals are compile errors: unknown function, dangling params,
  // overlapping patterns, uncovered required args, nested references, and
  // bundle-width overflow.
  const routesCase = (routesSource) => invalidCase({
    functions: publicInlineFunctions,
    handlers: { 'routes.mjs': routesSource },
  });
  const structuredRoutesCase = (routesSource) => invalidCase({
    schema: structuredRouteSchema,
    functions: structuredRouteFunctions,
    handlers: { 'routes.mjs': routesSource },
  });
  const expectCode = (diagnostics, code) => assert(
    diagnostics.some((diagnostic) => diagnostic.code === code),
    `expected ${code}: ${JSON.stringify(diagnostics)}`,
  );
  const expectRouteArgs = async (diagnosticsPromise, messagePattern) => {
    const diagnostics = await diagnosticsPromise;
    expectCode(diagnostics, 'ROUTES_ARGS_INVALID');
    assert.match(
      diagnostics.map(({ message }) => message).join('\n'),
      messagePattern,
    );
  };
  expectCode(await routesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{ route: '/', queries: [{ function: 'nope', args: {} }] }]);
`), 'ROUTES_FUNCTION_INVALID');
  expectCode(await routesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{ route: '/', queries: [{ function: 'listTodos', args: { title: routeParam('missing') } }] }]);
`), 'ROUTES_ARGS_INVALID');
  expectCode(await routesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([
  { route: '/t/:title', queries: [{ function: 'listTodos', args: { title: 'a' } }] },
  { route: '/t/fixed', queries: [{ function: 'listTodos', args: { title: 'b' } }] },
]);
`), 'ROUTES_PATTERN_OVERLAP');
  expectCode(await routesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{ route: '/', queries: [{ function: 'listTodos', args: {} }] }]);
`), 'ROUTES_ARGS_INVALID');
expectCode(await routesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{ route: '/t/:title', queries: [{ function: 'listTodos', args: { title: 'x', extra: [routeParam('title')] } }] }]);
`), 'ROUTES_ARGS_INVALID');
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards',
  queries: [{ function: 'listCells', args: { context: {
    boardId: 'board-1', cursor: null, sort: 'sideways', tags: [],
  } } }],
}]);
`), /literal for arg context does not match its arg schema/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards',
  queries: [{ function: 'listCells', args: { context: {
    boardId: 'board-1', cursor: null, sort: 'asc', tags: ['ok', 2],
  } } }],
}]);
`), /literal for arg context does not match its arg schema/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards',
  queries: [{ function: 'listCells', args: { context: {
    boardId: 'board-1', cursor: null, sort: 'asc',
    tags: ['one', 'two', 'three', 'four', 'five'],
  } } }],
}]);
`), /literal for arg context does not match its arg schema/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards/:boardId',
  queries: [{ function: 'cellsByIds', args: { context: { ids: [routeParam('boardId')] } } }],
}]);
`), /a \$param reference at context\.ids\.0 is nested inside an array literal; references are typable only at object positions/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards/:boardId',
  queries: [{ function: 'cellsByUnion', args: { context: { boardId: routeParam('boardId') } } }],
}]);
`), /references param into context\.boardId, whose declared type is not a string\/number\/boolean argument position/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards/:boardId',
  queries: [{ function: 'cellsByJson', args: { context: { payload: routeParam('boardId') } } }],
}]);
`), /references param into context\.payload, whose declared type is not a string\/number\/boolean argument position/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{
  route: '/boards/:boardId',
  queries: [{ function: 'listCells', args: { context: {
    boardId: routeParam('missing'), cursor: null, sort: 'asc', tags: [],
  } } }],
}]);
`), /references :missing, which is not in the route pattern/u);
  await expectRouteArgs(structuredRoutesCase(`
import { defineRoutes, routeParam } from '${defineUrl}';
export default defineRoutes([{
  route: '/sort/:sort',
  queries: [{ function: 'cellsByLiteral', args: { context: { sort: routeParam('sort') } } }],
}]);
`), /references param into context\.sort, whose declared type is not a string\/number\/boolean argument position/u);
  const tooManyQueries = Array.from(
    { length: 33 },
    () => "{ function: 'listTodos', args: { title: 'x' } }",
  ).join(',\n');
  expectCode(await routesCase(`
import { defineRoutes } from '${defineUrl}';
export default defineRoutes([{ route: '/too-many', queries: [${tooManyQueries}] }]);
`), 'ROUTES_QUERY_COUNT_INVALID');
}

{
  // @ref LLP 0073#rust-owned-artifacts-and-operation-carrier — authoring
  // emits the closed index and SearchQuery plan rather than backend syntax.
  const result = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const incidents = defineTable({
  title: v.string(),
  status: v.string(),
  owner: v.principal(),
}).visibility({ kind: 'owner', field: 'owner' }).searchIndex('search_incidents', {
  semanticVersion: 'incidents.v1',
  textFields: { title: { weight: 8, classification: 'private' } },
  fieldClassifications: { owner: 'private', status: 'private' },
  equalityFilters: ['status'],
  storedFields: ['owner', 'status', 'title'],
  highlightFields: ['title'],
  visibility: { kind: 'owner', field: 'owner' },
});
export default defineSchema({ incidents });
`,
    functions: `
import { defineSearchQuery } from '${defineUrl}';
import { incidents } from './schema.mjs';
export const searchIncidents = defineSearchQuery({
  table: incidents,
  index: 'search_incidents',
});
`,
  });
  const schema = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.equal(schema.requiredCapabilities.includes('full_text_search_v1'), true);
  assert.equal(schema.tables[0].searchIndexes[0].analyzer, 'snapback-category-unicode17-v1');
  assert.equal(schema.tables[0].searchIndexes[0].visibility.kind, 'owner');
  assert.deepEqual(schema.tables[0].searchIndexes[0].fieldClassifications, {
    owner: 'private',
    status: 'private',
  });
  const functions = JSON.parse(readFileSync(join(result.outDir, 'functions.manifest.json'), 'utf8'));
  const searchPlan = functions.functions[0].runtime.HostPlan.SearchQuery;
  assert.deepEqual(searchPlan, {
    table: 'incidents',
    index: 'search_incidents',
    parser: 'snapback-search-parser-v1',
    resultProjection: 'search-page-v1',
    requiredCapability: 'full_text_search_v1',
  });
  assert.equal(functions.functions[0].authRequirement, 'authenticated');
}

{
  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  notes: defineTable({ body: v.string() }).searchIndex('search_notes', {
    semanticVersion: 'notes.v1',
    textFields: { body: { weight: 1, classification: 'sensitive' } },
    visibility: { kind: 'public-read' },
  }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(diagnostics.some((diagnostic) => (
    diagnostic.code === 'SNAPBACK_SEARCH_INDEX_DECLARATION_INVALID'
    && diagnostic.field === 'body'
  )));
}

// 0137 A2-f5: an unsupported query-builder verb refuses at generation with a
// named site instead of failing at runtime as "undefined is not a function".
{
  const diagnostics = await invalidCase({
    functions: `
import { defineJsQuery, results, v } from '${defineUrl}';
export const listTodos = defineJsQuery({
  args: {},
  reads: ['todos'],
  result: results.documents('todos'),
  handler: async (ctx) => await ctx.db
    .query('todos')
    .withIndex('by_creation')
    .limit(5)
    .collect(),
});
`,
  });
  assert(
    diagnostics.some((diagnostic) => /limit is not a query-builder verb/.test(
      `${diagnostic.message ?? ''} ${JSON.stringify(diagnostic.details ?? {})}`,
    )),
    `expected a query-builder verb refusal, got ${JSON.stringify(diagnostics)}`,
  );
}

// Round-2 clip-locker F3: validate the finite ctx.db object itself, not only
// verbs chained from ctx.db.query(). The diagnostic names Snapback's `patch`
// spelling so a Convex-shaped `update` typo is repairable at generation.
{
  const diagnostics = await invalidCase({
    functions: `
import { defineJsMutation, results, v } from '${defineUrl}';
export const updateTodo = defineJsMutation({
  args: { id: v.id('todos'), title: v.string() },
  reads: [],
  writes: ['todos'],
  result: results.value(v.null()),
  handler: async (ctx, args) => {
    await ctx.db.update('todos', args.id, { title: args.title });
    return null;
  },
});
`,
  });
  assert(
    diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN'
      && /update is not a ctx\.db member.*use patch/.test(
        `${diagnostic.message ?? ''} ${JSON.stringify(diagnostic.details ?? {})}`,
      )
    )),
    `expected a ctx.db member refusal naming patch, got ${JSON.stringify(diagnostics)}`,
  );
}

// The corresponding Snapback spelling remains admitted.
{
  await validCase({
    functions: `
import { defineJsMutation, results, v } from '${defineUrl}';
export const updateTodo = defineJsMutation({
  args: { id: v.id('todos'), title: v.string() },
  reads: [],
  writes: ['todos'],
  result: results.value(v.null()),
  handler: async (ctx, args) => {
    await ctx.db.patch('todos', args.id, { title: args.title });
    return null;
  },
});
`,
  });
}

// LLP 0231 D7: trusted handler reads select elevated authority explicitly,
// while the finite nested surface admits no elevated write spelling.
{
  await validCase({
    functions: `
import { defineJsQuery, results, v } from '${defineUrl}';
export const inspectTodos = defineJsQuery({
  args: { id: v.id('todos') },
  reads: ['todos'],
  result: results.documents('todos'),
  handler: async (ctx, args) => {
    await ctx.db.elevated.get('todos', args.id);
    return await ctx.db.elevated.query('todos').take(2).collect();
  },
});
`,
  });

  const diagnostics = await invalidCase({
    functions: `
import { defineJsMutation, results, v } from '${defineUrl}';
export const unsafeWrite = defineJsMutation({
  args: { id: v.id('todos'), title: v.string() },
  reads: ['todos'],
  writes: ['todos'],
  result: results.value(v.null()),
  handler: async (ctx, args) => {
    await ctx.db.elevated.patch('todos', args.id, { title: args.title });
    return null;
  },
});
`,
  });
  assert(
    diagnostics.some((diagnostic) => (
      diagnostic.code === 'SNAPBACK_ELEVATED_READ_SITE_UNCLASSIFIABLE'
      && /patch is not a ctx\.db\.elevated member.*writes are never available/.test(
        `${diagnostic.message ?? ''} ${JSON.stringify(diagnostic.details ?? {})}`,
      )
    )),
    `expected an elevated-write refusal, got ${JSON.stringify(diagnostics)}`,
  );
}

// The supported range/keyset chain still generates.
{
  await validCase({
    functions: `
import { defineJsQuery, results, v } from '${defineUrl}';
export const pageTodos = defineJsQuery({
  args: { after: v.string() },
  reads: ['todos'],
  result: results.documents('todos'),
  handler: async (ctx, args) => await ctx.db
    .query('todos')
    .withIndex('by_creation')
    .gt('_id', args.after)
    .order('_id', 'asc')
    .take(20)
    .collect(),
});
`,
  });
}

// A literal relational take beyond the shared ceiling is impossible by
// construction, so the explicit profile refuses it before emitting artifacts.
{
  const diagnostics = await invalidCase({
    functions: `
import { defineJsQuery, results } from '${defineUrl}';
export const impossiblePage = defineJsQuery({
  args: {},
  reads: ['todos'],
  result: results.documents('todos'),
  handler: async (ctx) => await ctx.db.query('todos').take(4096).collect(),
});
`,
  });
  const refusal = diagnostics.find(({ code }) => (
    code === 'SNAPBACK_INLINE_HANDLER_SYNTAX_FORBIDDEN'
  ));
  assert.ok(refusal, `expected a structured take-ceiling refusal: ${JSON.stringify(diagnostics)}`);
  assert.match(refusal.message, /take\(4096\).*relational take ceiling 1024/u);
  assert.equal(refusal.ceiling, 'relationalTake');
  assert.equal(refusal.limit, 1_024);
  assert.equal(refusal.observed, 4_096);
  assert.equal(refusal.sourceSpan.file, 'functions.mjs');
}

// LLP 0162 row 11: history is an exact per-table schema declaration with two
// finite axes. The generated manifest, not a runtime side command, is storage
// policy authority.
{
  const result = await validCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() })
    .visibility({ kind: 'public-read' })
    .history({ retainMs: 60000, maxVersionsPerRecord: 12 }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  const manifest = JSON.parse(readFileSync(join(result.outDir, 'schema.manifest.json'), 'utf8'));
  assert.deepEqual(manifest.tables[0].history, {
    retainMs: 60_000,
    maxVersionsPerRecord: 12,
  });

  const typesFixture = fileURLToPath(
    new URL('./history-authoring-types.fixture.ts', import.meta.url),
  );
  const typecheck = spawnSync(
    fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url)),
    [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      typesFixture,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    typecheck.status,
    0,
    `history declarations failed strict typecheck\n${typecheck.stdout}\n${typecheck.stderr}`,
  );

  const diagnostics = await invalidCase({
    schema: `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  todos: defineTable({ title: v.string() })
    .visibility({ kind: 'public-read' })
    .history({ retainMs: 0, maxVersionsPerRecord: 12 }),
});
`,
    functions: 'export const nothing = 0;\n',
  });
  assert(
    diagnostics.some((diagnostic) => /history\(\) retainMs must be an integer/u.test(diagnostic.message)),
    `expected finite history refusal, got ${JSON.stringify(diagnostics)}`,
  );
}

// @ref LLP 0204#d91--streaming-conversations — `stream` is a
// compiled action fact. Other function kinds reject the spelling at authoring
// time, while the accepted action carries it into the served manifest basis.
{
  const streamed = await validCase({
    functions: `
import { defineAction } from '${defineUrl}';
export const conversation = defineAction({
  stream: true,
  args: {},
  handler: async (ctx) => {
    await ctx.stream.emit('hello');
    await ctx.stream.emit({ kind: 'done' });
    return 'hello';
  },
});
`,
  });
  const manifest = JSON.parse(
    readFileSync(join(streamed.outDir, 'functions.manifest.json'), 'utf8'),
  );
  assert.equal(manifest.functions[0].kind, 'Action');
  assert.equal(manifest.functions[0].stream, true);
  assert.match(manifest.functions[0].implementationHash, /^sha256:/u);

  for (const functions of [
    `
import { defineQuery } from '${defineUrl}';
export const illegalQuery = defineQuery({ table: 'todos', args: {}, stream: true });
`,
    `
import { defineMutation, insert, lit } from '${defineUrl}';
export const illegalMutation = defineMutation({
  stream: true,
  plan: insert('todos', { title: lit('nope') }),
});
`,
  ]) {
    const diagnostics = await invalidCase({ functions });
    assert(
      diagnostics.some((diagnostic) => /stream/u.test(diagnostic.message ?? '')),
      `expected stream kind refusal, got ${JSON.stringify(diagnostics)}`,
    );
  }
}

// @ref LLP 0248#d2-complete-unique-index-batch-reads — codegen closes statically visible unique
// index calls against the schema and emits only unique indexes into handler
// key types; the function also carries the target capability requirement.
{
  const batchSchema = `
import { defineSchema, defineTable, v } from '${defineUrl}';
export default defineSchema({
  docs: defineTable({
    tenant: v.string(),
    slug: v.optional(v.string()),
    count: v.integer(),
  })
    .index('byTenantSlug', ['tenant', 'slug'], { unique: true })
    .index('byCount', ['count'])
    .visibility({ kind: 'public-read' }),
});
`;
  const batchFunctions = (body) => `
import { defineJsQuery, results } from '${defineUrl}';
export const batchDocs = defineJsQuery({
  args: {},
  reads: ['docs'],
  result: results.documents('docs'),
  handler: async (ctx) => { ${body} },
});
`;
  const generated = await validCase({
    schema: batchSchema,
    functions: batchFunctions(`
      await ctx.db.getMany('docs', []);
      return await ctx.db.uniqueMany('docs', 'byTenantSlug', [
        { slug: 'welcome', tenant: 'acme' },
      ]);
    `),
  });
  const functions = JSON.parse(
    readFileSync(join(generated.outDir, 'functions.manifest.json'), 'utf8'),
  );
  assert(
    functions.functions[0].requiredCapabilities.includes('bounded_batch_reads_v1'),
    'getMany/uniqueMany handler source must require bounded_batch_reads_v1',
  );
  const types = readFileSync(join(generated.outDir, 'api.d.ts'), 'utf8');
  const uniqueMap = types.slice(
    types.indexOf('export interface GeneratedUniqueIndexKeys'),
    types.indexOf('export interface GeneratedTableAdmissionMaps'),
  );
  assert.match(uniqueMap, /"byTenantSlug": Readonly<\{ "tenant": NonNullable</u);
  assert.match(uniqueMap, /"slug": NonNullable</u);
  assert.doesNotMatch(uniqueMap, /byCount/u, 'non-unique index names must be unrepresentable');
  const batchTypeFixture = join(generated.outDir, '..', 'batch-read-types.fixture.ts');
  writeFileSync(batchTypeFixture, `
import type { GeneratedQueryDatabase, Id } from './generated/api.js';
declare const db: GeneratedQueryDatabase;
declare const first: Id<'docs'>;
await db.getMany('docs', [first]);
await db.uniqueMany('docs', 'byTenantSlug', [{ tenant: 'acme', slug: 'welcome' }]);
// @ts-expect-error non-unique indexes are absent from the generated key map.
await db.uniqueMany('docs', 'byCount', [{ count: 1 }]);
// @ts-expect-error complete compound keys require every component.
await db.uniqueMany('docs', 'byTenantSlug', [{ tenant: 'acme' }]);
`);
  const batchTypecheck = spawnSync(
    fileURLToPath(new URL('../../node_modules/.bin/tsc', import.meta.url)),
    [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      batchTypeFixture,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(
    batchTypecheck.status,
    0,
    `batch read declarations failed strict typecheck\n${batchTypecheck.stdout}\n${batchTypecheck.stderr}`,
  );

  for (const [body, expectedReason] of [
    ["return await ctx.db.uniqueMany('docs', 'missing', [{ tenant: 'acme', slug: 'welcome' }]);", 'unknown-index'],
    ["return await ctx.db.uniqueMany('docs', 'byCount', [{ count: 1 }]);", 'non-unique-index'],
    ["return await ctx.db.uniqueMany('docs', 'byTenantSlug', [{ tenant: 'acme' }]);", 'component-set-mismatch'],
    ["return await ctx.db.uniqueMany('docs', 'byTenantSlug', [{ tenant: 'acme', slug: null }]);", 'where-applicable-component-null'],
    ["return await ctx.db.uniqueMany('docs', 'byTenantSlug', [{ tenant: 'acme', slug: 42 }]);", 'component-type-mismatch'],
  ]) {
    const diagnostics = await invalidCase({
      schema: batchSchema,
      functions: batchFunctions(body),
    });
    assert(
      diagnostics.some((diagnostic) => (
        diagnostic.code.startsWith('SNAPBACK_BATCH_READ_')
        && diagnostic.reason === expectedReason
      )),
      `expected ${expectedReason}, got ${JSON.stringify(diagnostics)}`,
    );
  }
}

for (const dir of dirs) rmSync(dir, { recursive: true, force: true });

console.log('authoring-validation.test.mjs: all cases passed');
