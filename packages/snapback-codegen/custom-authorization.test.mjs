import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageRoot = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const directories = [];

const schema = `
import { defineSchema, defineTable, v } from ${JSON.stringify(defineUrl)};

export default defineSchema({
  documents: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  documentAccess: defineTable({
    documentId: v.id('documents'),
    userId: v.principal(),
  }).visibility({ kind: 'owner', field: 'userId' }),
}, { auth: { mode: 'sessions' } });
`;

const functions = (sync = 'coarse-global', evaluator = `canReadDocument`) => `
import {
  authorization,
  defineJsLiveQuery,
  defineJsMutation,
  policyInput,
  v,
} from ${JSON.stringify(defineUrl)};

async function canReadDocument(ctx, args) {
  const row = await ctx.db.elevated.query('documentAccess')
    .eq('documentId', args.documentId)
    .eq('userId', ctx.auth.userId)
    .first();
  return row !== null;
}

async function canEditDocument(ctx, args) {
  const row = await ctx.db.elevated.query('documentAccess')
    .eq('documentId', args.documentId)
    .eq('userId', ctx.auth.userId)
    .first();
  return row !== null;
}

export const readDocument = defineJsLiveQuery({
  auth: 'authenticated',
  args: { documentId: v.id('documents') },
  reads: ['documents'],
  authorization: authorization.custom({
    inputs: [policyInput.table('documentAccess', {
      subject: 'ctx.auth.userId',
      key: ['documentId', 'userId'],
    })],
    evaluate: ${evaluator},
    offline: 'none',
    sync: ${JSON.stringify(sync)},
  }),
  handler: async (ctx, args) => ctx.db.query('documents')
    .eq('_id', args.documentId)
    .collect(),
});

export const editDocument = defineJsMutation({
  auth: 'authenticated',
  args: {
    documentId: v.id('documents'),
    title: v.string(),
  },
  reads: ['documentAccess'],
  writes: ['documents'],
  authorization: authorization.custom({
    inputs: [policyInput.table('documentAccess', {
      subject: 'ctx.auth.userId',
      key: ['documentId', 'userId'],
    })],
    evaluate: canEditDocument,
    offline: 'none',
    sync: 'coarse-global',
  }),
  handler: async (ctx, args) => ctx.db.patch('documents', args.documentId, {
    title: args.title,
  }),
});
`;

async function run(source, options = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'snapback-custom-authorization-'));
  directories.push(directory);
  writeFileSync(join(directory, 'schema.mjs'), schema);
  writeFileSync(join(directory, 'functions.mjs'), source);
  return { directory, result: await generate(directory, options) };
}

const hasCode = (result, code) => result.diagnostics.some((diagnostic) => diagnostic.code === code);

try {
  {
    const { directory, result } = await run(functions());
    assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
    assert.equal(
      hasCode(result, 'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_COMPLETENESS_UNPROVEN'),
      true,
      'coarse-global generation must keep its incompleteness warning visible',
    );
    const manifest = JSON.parse(readFileSync(
      join(directory, 'generated', 'functions.manifest.json'),
      'utf8',
    ));
    const operation = manifest.functions.find(({ name }) => name === 'readDocument');
    assert.deepEqual(operation.customAuthorization, {
      offline: 'none',
      sync: 'coarse-global',
      inputs: [{
        kind: 'table',
        table: 'documentAccess',
        subject: 'ctx.auth.userId',
        key: ['documentId', 'userId'],
      }],
      inputCompleteness: 'unproven',
      pushdown: 'none',
      retention: 'none',
      preciseInvalidation: false,
      coarseGlobalWakeUniverse: [
        'membership-relation-insert-update-delete',
        'protected-resource-row-insert-update-delete',
        'effective-principal-or-auth-context-change',
        'authority-profile-generation-activation',
      ],
      evaluatorIdentity: operation.customAuthorization.evaluatorIdentity,
    });
    assert.match(operation.customAuthorization.evaluatorIdentity, /^sha256:[0-9a-f]{64}$/u);
    assert.deepEqual(operation.readSetSummary.tables, ['documents', 'documentAccess']);
    assert.deepEqual(operation.authorizationDependence, ['opaque', 'userId']);
    const mutation = manifest.functions.find(({ name }) => name === 'editDocument');
    assert.deepEqual(
      mutation.authorizationDependence,
      ['opaque', 'userId'],
      'custom mutation facts must disclose both opaque evaluation and the subject id',
    );
    assert.equal(mutation.customAuthorization.sync, 'coarse-global');
    assert.match(
      operation.runtime.IbexModule.source,
      /ctx\.permissions\.__snapbackCustomAuthorization\.deny\(\)/u,
      'false evaluation must use the trusted terminal-denial host seam',
    );
    const review = JSON.parse(readFileSync(
      join(directory, 'generated', 'authorization-review.json'),
      'utf8',
    ));
    assert.deepEqual(
      review.operations.find(({ name }) => name === 'readDocument').customAuthorization,
      operation.customAuthorization,
      'the review projection exposes the complete custom-authorization fact',
    );
    const reviewOperation = review.operations.find(({ name }) => name === 'readDocument');
    assert.deepEqual(
      reviewOperation.elevatedDatabase.uses.map(({ member, table, capture }) => ({
        member,
        table,
        capture,
      })),
      [{
        member: 'query',
        table: 'documentAccess',
        capture: 'custom-authorization-evaluator',
      }],
      'the complete elevated-access inventory includes the custom evaluator policy read',
    );
    assert.equal(
      review.elevatedReadSites.some((site) => (
        site.operation === 'readDocument'
        && site.readForm === 'query'
        && site.tables?.includes('documentAccess')
      )),
      true,
      'the top-level authorization-review census includes the evaluator policy read',
    );
    const typeDirectory = mkdtempSync(join(packageRoot, '.custom-authorization-types-'));
    directories.push(typeDirectory);
    writeFileSync(join(typeDirectory, 'custom-authorization-consumer.ts'), `
import {
  authorization,
  policyInput,
  type CustomAuthorizationDeclarationV1,
} from '@expo/snapback-codegen/define';

const declaration: CustomAuthorizationDeclarationV1 = authorization.custom({
  inputs: [policyInput.table('documentAccess', {
    subject: 'ctx.auth.userId',
    key: ['documentId', 'userId'],
  })],
  evaluate: async () => true,
  offline: 'none',
  sync: 'coarse-global',
});
void declaration;

// @ts-expect-error The sync vocabulary is closed.
const badSync: Parameters<typeof authorization.custom>[0]['sync'] = 'global';
void badSync;
// @ts-expect-error A plain object cannot forge the factory-branded declaration.
const forged: CustomAuthorizationDeclarationV1 = {};
void forged;
`);
    execFileSync(join(packageRoot, '../../node_modules/.bin/tsc'), [
      '--noEmit',
      '--strict',
      '--target', 'es2022',
      '--module', 'esnext',
      '--moduleResolution', 'bundler',
      'custom-authorization-consumer.ts',
    ], { cwd: typeDirectory, stdio: 'pipe' });
  }

  {
    const { result } = await run(functions('reauthorize-on-change'));
    assert.equal(result.ok, false, 'precise custom authorization unexpectedly generated');
    assert.equal(
      hasCode(result, 'SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE'),
      true,
      JSON.stringify(result.diagnostics),
    );
    assert.match(
      result.diagnostics.map(({ message }) => message).join('\n'),
      /LLP 0146 enforceable strict input completeness/u,
    );
  }

  {
    const compilerBypass = `${functions()}
readDocument.customAuthorization = Object.freeze({
  ...readDocument.customAuthorization,
  sync: 'reauthorize-on-change',
});
`;
    const { result } = await run(compilerBypass);
    assert.equal(result.ok, false, 'compiler boundary admitted a factory-bypassing precise lane');
    assert.equal(
      hasCode(result, 'SNAPBACK_CUSTOM_AUTHORIZATION_PRECISE_COMPLETENESS_UNAVAILABLE'),
      true,
      JSON.stringify(result.diagnostics),
    );
  }

  {
    const { result } = await run(functions(), {
      targetProfile: 'remote-service-sqlite-ibex',
    });
    assert.equal(result.ok, false, 'target without conservative wake unexpectedly generated');
    assert.equal(
      hasCode(result, 'SNAPBACK_CUSTOM_AUTHORIZATION_COARSE_WAKE_UNAVAILABLE'),
      true,
      JSON.stringify(result.diagnostics),
    );
  }

  {
    const { result } = await run(functions('coarse-global', 'async () => true'));
    assert.equal(result.ok, false, 'unwitnessed custom policy input unexpectedly generated');
    assert.equal(
      hasCode(result, 'SNAPBACK_CUSTOM_AUTHORIZATION_INPUT_SITE_UNPROVEN'),
      true,
      JSON.stringify(result.diagnostics),
    );
  }

  console.log('custom-authorization.test.mjs: coarse facts, refusals, and review projection pass');
} finally {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true });
}
