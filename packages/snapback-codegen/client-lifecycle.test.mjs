import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS,
} from './app-descriptor.mjs';
import { generate } from './index.mjs';
import {
  APPLICATION_AUTH_LIFECYCLE_SOURCE,
  APPLICATION_AUTH_PLATFORM_KINDS,
  AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE,
  CLIENT_COMPATIBILITY_ALIASES,
  assertApplicationAuthLifecycleCompleteness,
  renderReferenceJSDoc,
} from './client-lifecycle.mjs';
import {
  AUTH_PROGRAM_FIELDS,
  AUTH_PROGRAM_MECHANISM_KINDS,
} from './define.mjs';
import { FAMILIAR_DISPOSITIONS } from './familiar-dispositions.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return ['node_modules', 'generated', '.snapback'].includes(entry.name)
        ? []
        : sourceFiles(path);
    }
    return entry.name.endsWith('.mjs')
      && !entry.name.endsWith('.test.mjs')
      && entry.name !== 'client-lifecycle.mjs'
      ? [path]
      : [];
  });
}

function backend() {
  const root = mkdtempSync(join(tmpdir(), 'snapback-client-lifecycle-'));
  roots.push(root);
  writeFileSync(join(root, 'schema.mjs'), `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
const authProgram = defineAuth({
  version: 1,
  mechanisms: {
    password: { kind: 'password', identifier: 'email', provider: 'builtIn', recovery: 'recoveryCodes' },
  },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: { enabled: false },
  secretReferences: {},
});
export default defineSchema(
  { todos: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }).sync() },
  { auth: { mode: 'sessions' }, authProgram },
);
`);
  writeFileSync(join(root, 'functions.mjs'), `
import { defineAction, defineCommand, defineJsLiveQuery, defineJsMutation, defineJsQuery, v } from '${defineUrl}';
export const readTodos = defineJsQuery({ args: {}, reads: ['todos'], handler: async (ctx) => ctx.db.query('todos').collect() });
export const watchTodos = defineJsLiveQuery({ args: {}, reads: ['todos'], handler: async (ctx) => ctx.db.query('todos').collect() });
export const createTodo = defineJsMutation({ args: { title: v.string() }, writes: ['todos'], handler: async (ctx, args) => ctx.db.insert('todos', { title: args.title }) });
export const rebuildTodos = defineAction({ args: {}, handler: async () => null });
export const createTodoCommand = defineCommand({ mutation: createTodo });
`);
  return root;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('manifest vocabulary, generated types, and JSDoc share one lifecycle projection', async () => {
  const root = backend();
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const manifest = JSON.parse(readFileSync(join(root, 'generated', 'client-lifecycle.v1.json'), 'utf8'));
  const apiTypes = readFileSync(join(root, 'generated', 'api.d.ts'), 'utf8');
  const appTypes = readFileSync(join(root, 'generated', 'app.d.ts'), 'utf8');
  const envelope = JSON.parse(readFileSync(join(root, 'generated', 'api-envelope.members.json'), 'utf8'));
  const lifecycleSchema = JSON.parse(readFileSync(join(packageRoot, 'client-lifecycle.schema.json'), 'utf8'));
  const validateLifecycle = new Ajv2020({ strict: false }).compile(lifecycleSchema);

  assert.equal(manifest.schemaVersion, 'snapback.client-lifecycle.v1');
  assert.equal(validateLifecycle(manifest), true, JSON.stringify(validateLifecycle.errors));
  assert.deepEqual(manifest.surfaceFamilies, ['query', 'liveQuery', 'mutate', 'action', 'commands']);
  assert.deepEqual(
    manifest.mutationSettlement.dispositions,
    ['pending', 'settled', 'failed', 'stranded', 'quarantined', 'resultGone', 'unknown'],
  );
  assert.equal(manifest.custody.consumer, 'developer-tooling');
  assert.equal(manifest.custody.storageClass, 'regenerable-cache');
  assert.equal(manifest.futureClassM.snapshotVersionMeaning, 'authorized principal/query viewRevision');
  assert.deepEqual(manifest.compatibilityAliases, CLIENT_COMPATIBILITY_ALIASES);
  assert.deepEqual(
    manifest.compatibilityAliases.map(({ current, plannedCanonical }) => [current, plannedCanonical]),
    [
      ['useSnapbackQuery', 'useSnapbackLiveQuery'],
      ['useSnapbackMutation', 'useSnapbackMutationDispatch'],
      ['useSnapbackOutbox().mutationStatus', 'useSnapbackMutationStatus'],
      ['useSnapbackCommand', 'useSnapbackTask'],
      ['client.query', 'client.read'],
    ],
  );
  assert.equal(manifest.compatibilityAliases[0].emittedInRollout1, false);
  assert.equal(manifest.compatibilityAliases[0].removalEpoch, 'declared-major-after-stage-2-measurement');
  assert.equal(manifest.commands.length, 1);
  assert.equal(manifest.commands[0].semanticIdentity, `${manifest.appId}:command:createTodoCommand`);

  const authRows = manifest.rows;
  assert.deepEqual(
    authRows.authBootstrapPolicy.fields.map(({ field }) => field),
    [
      'format', 'appId', 'mode', 'custody', 'entryMechanisms', 'providers',
      'anonymousPublic', 'lifecycleProtocol',
    ],
  );
  // `providers` is the one optional policy field: an app that declares no
  // provider keeps the descriptor bytes it already had.
  assert.deepEqual(
    authRows.authBootstrapPolicy.fields.filter(({ optional }) => optional === true)
      .map(({ field }) => field),
    ['providers'],
  );
  assert.equal(
    authRows.authBootstrapPolicy.fields.find(({ field }) => field === 'custody')
      .familiarDisposition.disposition,
    2,
  );
  assert.deepEqual(
    authRows.authBootstrapPolicy.sourceFields.map(({ field }) => field),
    [...AUTH_PROGRAM_FIELDS].sort(),
  );
  assert(authRows.authBootstrapPolicy.sourceFields.every(
    ({ semanticIdentityEffect }) => semanticIdentityEffect === 'included-in-normalized-auth-program',
  ));
  assert.deepEqual(
    authRows.authBootstrapPolicy.profiles.map(({ profile, selected }) => [profile, selected]),
    [['snapback-explicit-v1', true], ['snapback-familiar-ts-v1', false]],
  );
  const password = authRows.authEntryMechanisms.entries.find(
    ({ mechanism }) => mechanism === 'password-v1',
  );
  assert.equal(password.configured, true);
  assert.equal(password.targetCapability, 'auth.passwords');
  assert.equal(password.reactHook, 'useSnapbackAuth');
  assert.equal(password.familiarHook, 'useAuth');
  assert.deepEqual(
    password.operations.map(({ operation, applicationFacadeMethod, resultType }) => (
      [operation, applicationFacadeMethod, resultType]
    )),
    [
      ['signup', 'signUpWithPassword', 'Promise<AuthRecoveryCredentialPublicProjectionV1>'],
      ['signin', 'signInWithPassword', 'Promise<AuthCredentialPublicProjectionV1>'],
      ['change', 'changePassword', 'Promise<AuthCredentialPublicProjectionV1>'],
    ],
  );
  assert.deepEqual(authRows.authRecoveryLifecycle.policy, {
    recoveryCodes: {
      enabled: true,
      plaintextCustody: 'one-time-response',
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
    },
    lastAuthenticator: 'enforce',
  });
  assert.deepEqual(
    authRows.authRecoveryLifecycle.operations.map(({
      operation,
      applicationFacadeMethod,
      clientMethod,
      resultType,
    }) => (
      [operation, clientMethod, applicationFacadeMethod, resultType]
    )),
    [
      ['consume', 'authRecoveryConsume', 'consumeRecoveryCode', 'Promise<AuthRecoveryCredentialPublicProjectionV1>'],
      ['rotate', 'authRecoveryRotate', 'rotateRecoveryCodes', 'Promise<AuthRecoveryCredentialPublicProjectionV1>'],
    ],
  );
  assert.deepEqual(
    authRows.authCustodyPlatforms.platforms.map(({ platform, carriers, grade, disposition }) => (
      [platform, carriers, grade, disposition]
    )),
    [
      ['browser', ['indexeddb-web-locks', 'indexeddb-fenced-lease'], 'durable', 'shipped'],
      ['expo-web', ['indexeddb-web-locks', 'indexeddb-fenced-lease'], 'durable', 'shipped'],
      ['memory', ['memory'], 'volatile', 'shipped-nonclaim'],
      ['expo-native-phase-2-evidence-required', [], 'pending-per-os-evidence', 'refused-pending-evidence'],
    ],
  );
  assert.deepEqual(authRows.authBootstrapState.stages, ['binding', 'custody', 'authority', 'client']);
  assert.deepEqual(
    authRows.authBootstrapState.states.map(({ status }) => status),
    ['starting', 'ready', 'authority-required', 'blocked', 'unsupported', 'error'],
  );
  assert.deepEqual(
    authRows.authBootstrapState.advisories.map(({ diagnosticCode, state }) => [diagnosticCode, state]),
    [['SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT', 'ready']],
  );
  assert(authRows.authBootstrapState.diagnostics.length >= 8);
  assert.deepEqual(
    authRows.authBootstrapState.remediations.map(({ kind }) => kind),
    [
      'retryAuthBootstrap',
      'regenerateAppDescriptor',
      'selectCompatibleBinding',
      'selectSupportedPlatform',
      'installDurableCustody',
      'keepCurrentPrincipal',
      'signOut',
      'useStoragePartition',
      'disposeAndReconstruct',
    ],
  );
  assert(authRows.authBootstrapState.remediations.every(
    ({ publicType, requiresApproval }) => (
      publicType === 'SnapbackAuthRemediation' && requiresApproval === false
    ),
  ));
  assert.equal(authRows.authOwnership.exclusive, true);
  assert.equal(authRows.authOwnership.duplicateRefusalCode, 'SNAPBACK_AUTH_BOOTSTRAP_INPUT_INVALID');
  assert.deepEqual(authRows.authSupervisedPrecedence.events, [
    'binding-remint', 'supervisor-restart', 'refreshAuthority',
  ]);
  assert.equal(
    authRows.authSupervisedPrecedence.conflictDiagnostic,
    'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
  );
  assert(authRows.authAnchors.capabilityIndex.includes('auth.browser-session-custody'));
  assert(authRows.authAnchors.guide.includes('guide/auth/passwords.md#sign-up-then-sign-in'));

  for (const operation of manifest.operations) {
    const declarationSurface = operation.kind === 'Action'
      ? envelope.declarations.appBindings
      : apiTypes;
    const start = declarationSurface.indexOf(`reference \`${operation.semanticIdentity}\``);
    assert.notEqual(start, -1, operation.semanticIdentity);
    const declaration = declarationSurface.slice(start, start + 1_000);
    for (const verb of operation.legalVerbs) {
      assert.ok(declaration.includes(`\`${verb}\``), `${operation.semanticIdentity} omits ${verb}`);
    }
    assert.match(declaration, /required capabilities:/u);
    assert.match(declaration, /headless\.md#generated-reference-kinds/u);
    assert.ok(envelope.declarations.appBindings.includes(operation.semanticIdentity));
  }
  assert.match(apiTypes, /readonly __snapbackReferenceKind: Kind;/u);
  for (const alias of ['QueryRef', 'LiveQueryRef', 'MutationRef', 'ActionRef']) {
    assert.ok(apiTypes.includes(`export type ${alias}<`));
  }
  assert.match(appTypes, /readonly __snapbackReferenceKind: 'Command';/u);
  assert.ok(appTypes.includes(`Command reference \`${manifest.appId}:command:createTodoCommand\``));
  assert.ok(appTypes.includes('`commandClient.start`'));
  assert.ok(appTypes.includes('`useSnapbackCommand`'));
  const readReference = manifest.operations.find(({ name }) => name === 'readTodos');
  assert.match(
    renderReferenceJSDoc(
      { kind: 'Query', id: readReference.semanticIdentity, name: readReference.name },
      manifest,
      'snapback-familiar-ts-v1',
    ),
    /call `client\.query` \(planned `client\.read`\)/u,
  );
  const mutationReference = manifest.operations.find(({ name }) => name === 'createTodo');
  const mutationJSDoc = renderReferenceJSDoc(
    { kind: 'Mutation', id: mutationReference.semanticIdentity, name: mutationReference.name },
    manifest,
    'snapback-familiar-ts-v1',
  );
  assert.match(mutationJSDoc, /settled-only \(`queue:false`\)/u);
  assert.match(mutationJSDoc, /`useSnapbackMutationDispatch` \+ `useSnapbackMutationStatus`/u);
  const record = generated.artifactIndex.files.find(({ path }) => path === 'client-lifecycle.v1.json');
  assert.equal(record.logicalKind, 'client-lifecycle');
  assert.equal(record.consumer, 'developer-tooling');
  assert.equal(record.custody, 'regenerable-cache');

  const identical = await generate(root);
  assert.equal(identical.ok, true, JSON.stringify(identical.diagnostics));
  assert.deepEqual(
    JSON.parse(readFileSync(join(root, 'generated', 'client-lifecycle.v1.json'), 'utf8')),
    manifest,
  );
});

function completenessInput(overrides = {}) {
  return {
    authProgram: {
      recoveryPolicy: {
        recoveryCodes: {
          enabled: true,
          requiredWhen: 'no-independent-recovery',
          rotateAfterUse: true,
          plaintextCustody: 'one-time-response',
        },
        lastAuthenticator: 'enforce',
      },
    },
    authProgramFields: AUTH_PROGRAM_FIELDS,
    mechanismKinds: AUTH_PROGRAM_MECHANISM_KINDS,
    entryMechanisms: APPLICATION_AUTH_BOOTSTRAP_ENTRY_MECHANISMS,
    platformKinds: APPLICATION_AUTH_PLATFORM_KINDS,
    authoringProfiles: ['snapback-explicit-v1', 'snapback-familiar-ts-v1'],
    familiarDispositions: FAMILIAR_DISPOSITIONS.authProgramFields,
    ...overrides,
  };
}

test('application auth completeness fails closed on every source-domain growth', () => {
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      authProgramFields: new Set([...AUTH_PROGRAM_FIELDS, 'futureAuthProgramField']),
    })),
    /auth-program field dispositions are incomplete.*futureAuthProgramField/u,
  );
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      mechanismKinds: [...AUTH_PROGRAM_MECHANISM_KINDS, 'future-mechanism'],
    })),
    /auth mechanism kind dispositions are incomplete.*future-mechanism/u,
  );
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      platformKinds: [...APPLICATION_AUTH_PLATFORM_KINDS, 'future-platform'],
    })),
    /auth custody platform dispositions are incomplete.*future-platform/u,
  );
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      authoringProfiles: ['snapback-explicit-v1', 'snapback-familiar-ts-v1', 'future-profile'],
    })),
    /auth authoring profile dispositions are incomplete.*future-profile/u,
  );
  const missingFamiliar = { ...FAMILIAR_DISPOSITIONS.authProgramFields };
  delete missingFamiliar.recoveryPolicy;
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      familiarDispositions: missingFamiliar,
    })),
    /Familiar auth-program field dispositions are incomplete.*recoveryPolicy/u,
  );
  const missingRecoveryRows = structuredClone(APPLICATION_AUTH_LIFECYCLE_SOURCE);
  delete missingRecoveryRows.recoveryOperations.rotate;
  assert.throws(
    () => assertApplicationAuthLifecycleCompleteness(completenessInput({
      source: missingRecoveryRows,
    })),
    /enabled recovery lifecycle dispositions are incomplete.*rotate/u,
  );
});

test('shipped codegen, declarations, hooks, platforms, and diagnostics conform to D9 rows', async () => {
  const root = backend();
  const generated = await generate(root);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const rows = JSON.parse(
    readFileSync(join(root, 'generated', 'client-lifecycle.v1.json'), 'utf8'),
  ).rows;
  const clientTypes = readFileSync(join(packageRoot, '..', 'snapback-client', 'index.d.mts'), 'utf8');
  const appClientTypes = readFileSync(join(packageRoot, '..', 'snapback-client', 'app-client.d.mts'), 'utf8');
  const appClientRuntime = readFileSync(join(packageRoot, '..', 'snapback-client', 'app-client.mjs'), 'utf8');
  const authorityRuntime = readFileSync(join(packageRoot, '..', 'snapback-client', 'agent-authority.mjs'), 'utf8');
  const reactTypes = readFileSync(join(packageRoot, '..', 'snapback-react', 'index.d.mts'), 'utf8');
  const reactRuntime = readFileSync(join(packageRoot, '..', 'snapback-react', 'implementation.mjs'), 'utf8');
  const familiarTypes = readFileSync(join(packageRoot, '..', 'snapback-react', 'familiar.d.mts'), 'utf8');
  const expoTypes = readFileSync(join(packageRoot, '..', 'snapback-expo', 'index.d.mts'), 'utf8');
  const expoRuntime = readFileSync(join(packageRoot, '..', 'snapback-expo', 'provider.mjs'), 'utf8');
  const generatedAppTypes = readFileSync(join(root, 'generated', 'app.d.ts'), 'utf8');

  for (const { field, optional } of rows.authBootstrapPolicy.fields) {
    const spelling = optional === true ? `readonly ${field}?:` : `readonly ${field}:`;
    assert(generatedAppTypes.includes(spelling), `generated policy types omit ${field}`);
  }
  for (const entry of rows.authEntryMechanisms.entries) {
    for (const operation of entry.operations) {
      assert(clientTypes.includes(operation.clientMethod), operation.clientMethod);
      assert(clientTypes.includes(operation.resultType), operation.resultType);
      if (operation.clientNamespaceMethod !== null) {
        assert(clientTypes.includes(operation.clientNamespaceMethod), operation.clientNamespaceMethod);
      }
      if (operation.applicationFacadeMethod !== null) {
        assert(appClientTypes.includes(operation.applicationFacadeMethod), operation.applicationFacadeMethod);
      }
      if (operation.facadeOwner === 'SnapbackAppClient.auth') {
        assert(appClientTypes.includes(operation.facadeMethod), operation.facadeMethod);
      } else if (operation.facadeOwner === 'SnapbackClient.auth') {
        assert(clientTypes.includes(operation.facadeMethod), operation.facadeMethod);
      } else {
        assert.equal(operation.facadeMethod, null);
      }
    }
    if (entry.reactHook !== null) assert(reactTypes.includes(entry.reactHook), entry.reactHook);
    if (entry.familiarHook !== null) assert(familiarTypes.includes(entry.familiarHook), entry.familiarHook);
  }
  for (const operation of rows.authRecoveryLifecycle.operations) {
    assert(clientTypes.includes(operation.clientMethod), operation.clientMethod);
    assert.equal(operation.facadeOwner, 'SnapbackAppClient.auth');
    assert(clientTypes.includes(operation.clientNamespaceMethod), operation.clientNamespaceMethod);
    assert(appClientTypes.includes(operation.applicationFacadeMethod), operation.applicationFacadeMethod);
    assert(appClientRuntime.includes(`${operation.facadeMethod}:`), operation.facadeMethod);
    assert.match(operation.facadeDisposition, /ordinary-app-facade-exact-client-contract/u);
  }
  assert(appClientRuntime.includes('createIndexedDbAuthCustodyStorage'));
  assert(appClientRuntime.includes('createMemoryAuthCustodyStorage'));
  assert(expoRuntime.includes('expo-native-phase-2-evidence-required'));
  assert(appClientTypes.includes("'browser' | 'expo-web' | 'memory'"));
  const shippedPlatformType = appClientTypes.match(
    /export type SnapbackAppClientPlatform =([\s\S]*?);\n\n/u,
  )?.[1] ?? '';
  const publicPlatforms = [...new Set(
    [...shippedPlatformType.matchAll(/'([^']+)'/gu)].map((match) => match[1])
      .filter((value) => ['browser', 'expo-web', 'memory'].includes(value)),
  )];
  const providerSentinel = expoRuntime.match(
    /kind: '(expo-native-phase-2-evidence-required)'/u,
  )?.[1];
  assert(providerSentinel, 'Expo provider must expose the Phase-2 native refusal sentinel');
  assert.deepEqual(
    [...APPLICATION_AUTH_PLATFORM_KINDS],
    [...publicPlatforms, providerSentinel],
    'D9 expected platforms must mirror the shipped app-client type plus Expo provider sentinel',
  );
  assert.deepEqual(
    rows.authCustodyPlatforms.platforms.map(({ platform }) => platform),
    [...APPLICATION_AUTH_PLATFORM_KINDS],
    'every authoritative shipped platform has exactly one D9 row',
  );
  const codegenRuntime = readFileSync(join(packageRoot, 'index.mjs'), 'utf8');
  assert.match(
    codegenRuntime,
    /applicationAuth:\s*\{[\s\S]*?platformKinds:\s*APPLICATION_AUTH_PLATFORM_KINDS/u,
    'generate() must pass the independently maintained expected platform set',
  );
  assert(expoTypes.includes('FirstPartyExpoBootState'));
  for (const { status } of rows.authBootstrapState.states) {
    assert(appClientTypes.includes(`status: '${status}'`) || appClientTypes.includes(`status: 'blocked' | 'unsupported' | 'error'`), status);
  }
  const repoRoot = join(packageRoot, '..', '..');
  const diagnosticRegistry = JSON.parse(readFileSync(
    join(repoRoot, 'guide/reference/diagnostics-registry.json'),
    'utf8',
  ));
  const diagnosticRowFor = (code) => rows.authBootstrapState.diagnostics.find(
    (row) => row.codes.includes(code),
  );
  assert.equal(diagnosticRowFor('SNAPBACK_AUTH_POLICY_UNAVAILABLE')?.state, 'authority-required');
  for (const row of rows.authBootstrapState.diagnostics) {
    assert.equal(typeof row.state, 'string', `${row.class} lacks a D7 state projection`);
    assert(Array.isArray(row.remediations), `${row.class} lacks typed remediations`);
    for (const code of row.codes) {
      assert(diagnosticRegistry.diagnostics[code], `diagnostics registry omits ${code}`);
    }
  }
  const bootstrapEmissionSources = [appClientRuntime, codegenRuntime].join('\n');
  const emittedBootstrapCodes = new Set(
    [...bootstrapEmissionSources.matchAll(/SNAPBACK_AUTH_BOOTSTRAP_[A-Z0-9_]+/gu)]
      .map((match) => match[0]),
  );
  const bootstrapAdjacentCodes = [
    'SNAPBACK_APP_BINDING_EXPIRED',
    'SNAPBACK_APP_BINDING_TARGET_INVALID',
    'SNAPBACK_APP_BINDING_INTEGRITY_INVALID',
    'SNAPBACK_AUTH_CUSTODY_DURABLE_UNAVAILABLE',
    'SNAPBACK_AUTH_CUSTODY_OWNER_KEY_UNSUPPORTED',
    'SNAPBACK_AUTH_POLICY_UNAVAILABLE',
    'SNAPBACK_AUTH_SUPERVISED_PRINCIPAL_CONFLICT',
  ];
  for (const code of bootstrapAdjacentCodes) emittedBootstrapCodes.add(code);
  const classifiedCodes = new Set(
    rows.authBootstrapState.diagnostics.flatMap(({ codes }) => codes),
  );
  for (const code of emittedBootstrapCodes) {
    assert(classifiedCodes.has(code), `bootstrap-emitted code ${code} has no D9 diagnostic row`);
  }
  const packageSource = [
    ...sourceFiles(join(repoRoot, 'packages/snapback-client')),
    ...sourceFiles(join(repoRoot, 'packages/snapback-contract')),
    ...sourceFiles(join(repoRoot, 'packages/snapback-expo')),
    ...sourceFiles(join(repoRoot, 'packages/snapback-codegen')),
  ].map((path) => readFileSync(path, 'utf8')).join('\n');
  for (const code of classifiedCodes) {
    assert(packageSource.includes(code), `classified bootstrap code ${code} is not emitted`);
  }
  assert(
    diagnosticRegistry.diagnostics[AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE],
    `diagnostics registry omits ${AUTH_BOOTSTRAP_COMPLETENESS_UNCLASSIFIED_CODE}`,
  );
  assert(clientTypes.includes('export type SnapbackAuthRemediation = Readonly<{'));
  for (const field of ['riskClass', 'machineApplicable', 'requiresApproval', 'authorityEffect']) {
    assert(clientTypes.includes(`${field}:`), field);
  }
  assert(familiarTypes.includes('useSnapbackAuth as useAuth'));
  assert(familiarTypes.includes('useSnapbackCurrentPrincipal as useCurrentPrincipal'));
  assert(reactTypes.includes('useSnapbackAuth(): SnapbackAuthFacade'));
  assert(reactTypes.includes('useSnapbackCurrentPrincipal(): CurrentPrincipalSnapshot'));
});
