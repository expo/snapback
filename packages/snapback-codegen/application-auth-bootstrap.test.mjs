import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import Ajv2020 from 'ajv/dist/2020.js';

import { validateAppDescriptorV1 } from './app-descriptor.mjs';
import { enumerateAppDescriptorV1 } from './app-inspection.mjs';
import { defineAuth } from './define.mjs';
import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const roots = [];

function fixture(prefix = 'snapback-application-auth-bootstrap-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function writeExplicit(root, {
  program = null,
  functionsAuth = 'authenticated',
  visibility = "{ kind: 'owner', field: 'ownerId' }",
  mutateProgram = '',
  sessions = true,
} = {}) {
  const authProgram = program === null ? '' : `
const authProgram = defineAuth(${program});
${mutateProgram}
`;
  writeFileSync(join(root, 'schema.mjs'), `
import { defineAuth, defineSchema, defineTable, v } from '${defineUrl}';
${authProgram}
export default defineSchema({
  items: defineTable({ ownerId: v.principal(), title: v.string() })
    .visibility(${visibility}),
}, {${sessions ? " auth: { mode: 'sessions' }," : ''}${program === null ? '' : ' authProgram,'} });
`);
  writeFileSync(join(root, 'functions.mjs'), `
import { defineJsQuery, results, v } from '${defineUrl}';
export const readItems = defineJsQuery({
  args: {},
  result: results.records(v.object({ title: v.string() })),
  auth: '${functionsAuth}',
  reads: ['items'],
  handler: async () => [],
});
`);
}

function authProgram({
  custody,
  external = false,
  mechanisms = `password: { kind: 'password', identifier: 'username', provider: 'builtIn', recovery: 'recoveryCodes' }`,
  guestPolicy = '{ enabled: false }',
  recoveryEnabled = true,
} = {}) {
  return `{
  version: 1,
  ${custody === undefined ? '' : `custody: '${custody}',`}
  ${external ? 'externalSessionEntry: true,' : ''}
  mechanisms: { ${mechanisms} },
  assuranceRequirements: {},
  recoveryPolicy: {
    recoveryCodes: {
      enabled: ${recoveryEnabled},
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  },
  guestPolicy: ${guestPolicy},
  secretReferences: {},
}`;
}

function bootstrap(result) {
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  return result.appDescriptor.authBootstrap;
}

after(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

test('sessions bootstrap follows public operation posture independently of guest policy', async () => {
  const root = fixture();
  const program = authProgram();
  writeExplicit(root, { program, functionsAuth: 'public' });
  const publicResult = await generate(root);
  assert.equal(publicResult.schemaManifest.authProgram.custody, 'durable-required');
  assert.deepEqual(publicResult.schemaManifest.authProgram.recoveryPolicy, {
    recoveryCodes: {
      enabled: true,
      requiredWhen: 'no-independent-recovery',
      rotateAfterUse: true,
      plaintextCustody: 'one-time-response',
    },
    lastAuthenticator: 'enforce',
  });
  assert.deepEqual(bootstrap(publicResult), {
    format: 'snapback.application-auth-bootstrap.v1',
    appId: publicResult.appDescriptor.identity.app,
    mode: 'sessions',
    custody: 'durable-required',
    entryMechanisms: ['password-v1'],
    anonymousPublic: 'allowed',
    lifecycleProtocol: 1,
  });

  writeExplicit(root, { program, functionsAuth: 'authenticated' });
  const privateResult = await generate(root);
  assert.equal(bootstrap(privateResult).anonymousPublic, 'refused');
  assert.deepEqual(bootstrap(privateResult).entryMechanisms, ['password-v1']);
});

test('optional-user operations and public-read table visibility independently allow anonymous access', async () => {
  const optionalRoot = fixture();
  writeExplicit(optionalRoot, { program: authProgram(), functionsAuth: 'optional-user' });
  assert.equal(bootstrap(await generate(optionalRoot)).anonymousPublic, 'allowed');

  const publicTableRoot = fixture();
  writeExplicit(publicTableRoot, {
    program: authProgram(),
    functionsAuth: 'authenticated',
    visibility: "{ kind: 'public-read' }",
  });
  assert.equal(bootstrap(await generate(publicTableRoot)).anonymousPublic, 'allowed');
});

test('entry mechanisms are closed, canonical, and exclude guest, passkey, and recovery', async () => {
  const root = fixture();
  const mechanisms = `
    passkey: { kind: 'passkey', provider: 'deviceKeys' },
    guest: { kind: 'guest' },
    emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'transactionalEmail' },
    password: { kind: 'password', identifier: 'username', provider: 'builtIn', recovery: 'recoveryCodes' }
  `;
  writeExplicit(root, {
    program: authProgram({
      external: true,
      mechanisms,
      guestPolicy: `{ enabled: true, claiming: ['emailCode'], reaping: {
        afterMs: 604800000,
        cleanup: { kind: 'declarative', default: 'tombstone', tables: {
          items: { principalField: 'ownerId', onReap: 'tombstone' },
        } },
      } }`,
    }),
  });
  assert.deepEqual(bootstrap(await generate(root)).entryMechanisms, [
    'password-v1',
    'email-code-v1',
    'external-session-explicit-v1',
  ]);

  const guestOnly = fixture();
  writeExplicit(guestOnly, {
    program: authProgram({
      mechanisms: "guest: { kind: 'guest' }",
      guestPolicy: `{ enabled: true, claiming: [], reaping: {
        afterMs: 604800000,
        cleanup: { kind: 'declarative', default: 'tombstone', tables: {
          items: { principalField: 'ownerId', onReap: 'tombstone' },
        } },
      } }`,
    }),
  });
  const guestOnlyBootstrap = bootstrap(await generate(guestOnly));
  assert.deepEqual(guestOnlyBootstrap.entryMechanisms, []);
  assert.equal(guestOnlyBootstrap.anonymousPublic, 'refused');
});

test('external entry is opt-in and custody defaults without target inference', async () => {
  const root = fixture();
  writeExplicit(root, { program: authProgram() });
  const baseline = await generate(root);
  assert.equal(bootstrap(baseline).custody, 'durable-required');
  assert.equal(bootstrap(baseline).entryMechanisms.includes('external-session-explicit-v1'), false);

  writeExplicit(root, { program: authProgram({ external: true }) });
  const external = await generate(root);
  assert.equal(external.schemaManifest.authProgram.externalSessionEntry, true);
  assert(bootstrap(external).entryMechanisms.includes('external-session-explicit-v1'));

  writeExplicit(root, { program: authProgram({ custody: 'volatile-explicit' }) });
  assert.equal(bootstrap(await generate(root)).custody, 'volatile-explicit');

  const noProgram = fixture();
  writeExplicit(noProgram);
  assert.equal(bootstrap(await generate(noProgram)).custody, 'durable-required');

  const dev = fixture();
  writeExplicit(dev, { sessions: false });
  const devResult = await generate(dev);
  assert.equal(devResult.ok, true, JSON.stringify(devResult.diagnostics));
  assert.equal(Object.hasOwn(devResult.appDescriptor, 'authBootstrap'), false);

  assert.throws(
    () => defineAuth({
      version: 1,
      externalSessionEntry: false,
      mechanisms: {},
      assuranceRequirements: {},
      guestPolicy: { enabled: false },
      secretReferences: {},
    }),
    (error) => error?.code === 'SNAPBACK_AUTH_PROGRAM_INVALID',
  );
  assert.throws(
    () => defineAuth({
      version: 1,
      custody: 'memory-if-needed',
      mechanisms: {},
      assuranceRequirements: {},
      guestPolicy: { enabled: false },
      secretReferences: {},
    }),
    (error) => error?.code === 'SNAPBACK_AUTH_PROGRAM_INVALID',
  );
});

test('bootstrap is inspectable and custody or mechanism changes rotate semantic identity', async () => {
  const root = fixture();
  const both = `
    password: { kind: 'password', identifier: 'username', provider: 'builtIn', recovery: 'recoveryCodes' },
    emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'transactionalEmail' }
  `;
  writeExplicit(root, { program: authProgram({ mechanisms: both }) });
  const baseline = await generate(root);
  const identical = await generate(root);
  assert.deepEqual(identical.identities, baseline.identities);
  assert.deepEqual(identical.appDescriptor.authBootstrap, baseline.appDescriptor.authBootstrap);
  assert.deepEqual(
    enumerateAppDescriptorV1(baseline.appDescriptor).authBootstrap,
    baseline.appDescriptor.authBootstrap,
  );
  assert.deepEqual(validateAppDescriptorV1(baseline.appDescriptor), []);
  const descriptorSchema = JSON.parse(readFileSync(
    join(packageRoot, 'app-descriptor.schema.json'),
    'utf8',
  ));
  const validateDescriptorSchema = new Ajv2020({ strict: false }).compile(descriptorSchema);
  assert.equal(
    validateDescriptorSchema(baseline.appDescriptor),
    true,
    JSON.stringify(validateDescriptorSchema.errors),
  );
  const invalidDescriptor = structuredClone(baseline.appDescriptor);
  invalidDescriptor.authBootstrap.entryMechanisms.push('guest-v1');
  assert(validateAppDescriptorV1(invalidDescriptor, { verifyDigest: false }).some(
    ({ code }) => code === 'SNAPBACK_APP_DESCRIPTOR_SHAPE_INVALID',
  ));
  assert.match(
    readFileSync(join(root, 'generated', 'app.d.ts'), 'utf8'),
    /readonly authBootstrap: ApplicationAuthBootstrapV1/u,
  );

  const reordered = `
    emailCode: { kind: 'email-code', identityKind: 'email', provider: 'builtIn', delivery: 'transactionalEmail' },
    password: { kind: 'password', identifier: 'username', provider: 'builtIn', recovery: 'recoveryCodes' }
  `;
  writeExplicit(root, { program: authProgram({ mechanisms: reordered }) });
  const insertionVariant = await generate(root);
  assert.equal(insertionVariant.ok, true, JSON.stringify(insertionVariant.diagnostics));
  assert.equal(insertionVariant.identities.semanticId, baseline.identities.semanticId);
  assert.deepEqual(insertionVariant.appDescriptor.authBootstrap, baseline.appDescriptor.authBootstrap);

  writeExplicit(root, {
    program: authProgram({ mechanisms: reordered, recoveryEnabled: false }),
  });
  const recoveryDisabled = await generate(root);
  assert.equal(recoveryDisabled.ok, true, JSON.stringify(recoveryDisabled.diagnostics));
  assert.notEqual(recoveryDisabled.identities.semanticId, baseline.identities.semanticId);
  assert.deepEqual(recoveryDisabled.appDescriptor.authBootstrap, baseline.appDescriptor.authBootstrap);
  assert.deepEqual(
    recoveryDisabled.clientLifecycleManifest.rows.authRecoveryLifecycle.operations,
    [],
  );

  writeExplicit(root, { program: authProgram({ custody: 'volatile-explicit', mechanisms: reordered }) });
  const volatile = await generate(root);
  assert.notEqual(volatile.identities.semanticId, baseline.identities.semanticId);
  assert.notEqual(
    volatile.appDescriptor.identity.descriptor,
    baseline.appDescriptor.identity.descriptor,
  );

  writeExplicit(root, { program: authProgram() });
  const passwordOnly = await generate(root);
  assert.notEqual(passwordOnly.identities.semanticId, baseline.identities.semanticId);
  assert.notEqual(
    passwordOnly.appDescriptor.identity.descriptor,
    baseline.appDescriptor.identity.descriptor,
  );
});

test('recoveryPolicy is required and keeps the exact LLP 0214 wave-1 shape', () => {
  const base = {
    version: 1,
    mechanisms: {},
    assuranceRequirements: {},
    guestPolicy: { enabled: false },
    secretReferences: {},
  };
  assert.throws(
    () => defineAuth(base),
    (error) => error?.code === 'SNAPBACK_AUTH_PROGRAM_INVALID',
  );
  for (const recoveryPolicy of [
    {
      recoveryCodes: {
        enabled: true,
        requiredWhen: 'optional',
        rotateAfterUse: true,
        plaintextCustody: 'one-time-response',
      },
      lastAuthenticator: 'enforce',
    },
    {
      recoveryCodes: {
        enabled: true,
        requiredWhen: 'no-independent-recovery',
        rotateAfterUse: false,
        plaintextCustody: 'one-time-response',
      },
      lastAuthenticator: 'enforce',
    },
    {
      recoveryCodes: {
        enabled: true,
        requiredWhen: 'no-independent-recovery',
        rotateAfterUse: true,
        plaintextCustody: 'durable-store',
      },
      lastAuthenticator: 'enforce',
    },
    {
      recoveryCodes: {
        enabled: true,
        requiredWhen: 'no-independent-recovery',
        rotateAfterUse: true,
        plaintextCustody: 'one-time-response',
      },
      lastAuthenticator: 'optional',
    },
  ]) {
    assert.throws(
      () => defineAuth({ ...base, recoveryPolicy }),
      (error) => error?.code === 'SNAPBACK_AUTH_PROGRAM_INVALID',
    );
  }
});

test('familiar defaults durable custody and refuses the weaker grade before publication', async () => {
  const root = fixture('snapback-familiar-auth-bootstrap-');
  writeFileSync(join(root, 'codegen.policy.json'), JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }));
  const writeFamiliarSchema = (custody = undefined) => writeFileSync(join(root, 'schema.ts'), `
import { defineAuth } from '${defineUrl}';
import { defineSchema, defineTable, v } from './generated/server';
const authProgram = defineAuth(${authProgram({ custody })});
export default defineSchema({
  items: defineTable({ ownerId: v.principal(), title: v.string() })
    .visibility({ kind: 'owner', field: 'ownerId' }),
}, { auth: { mode: 'sessions' }, authProgram });
`);
  writeFileSync(join(root, 'items.ts'), `
import { query, v } from './generated/server';
export const read = query({
  args: {},
  returns: v.array(v.object({ title: v.string() })),
  auth: 'authenticated',
  reads: ['items'],
  handler: async () => [],
});
`);

  writeFamiliarSchema();
  const durable = await generate(root);
  assert.equal(bootstrap(durable).custody, 'durable-required');

  writeFamiliarSchema('volatile-explicit');
  const refused = await generate(root);
  assert.equal(refused.ok, false);
  assert(refused.diagnostics.some(
    ({ code }) => code === 'SNAPBACK_AUTH_PROGRAM_INVALID',
  ));
});

test('a normalized mechanism outside the policy enum is a typed codegen refusal', async () => {
  const root = fixture();
  writeExplicit(root, {
    program: authProgram(),
    mutateProgram: "authProgram.mechanisms.future = { kind: 'future-proof' };",
  });
  const result = await generate(root);
  assert.equal(result.ok, false);
  assert(result.diagnostics.some(
    ({ code, mechanism }) => code === 'SNAPBACK_AUTH_PROGRAM_INVALID'
      && mechanism === 'future',
  ), JSON.stringify(result.diagnostics));
});
