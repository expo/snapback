import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWritePolicyChecks,
  deriveWritePosture,
  scanGenericWriteSites,
  WRITE_POSTURE_MIGRATION_WARNING,
} from './write-policy.mjs';
import {
  compareVisibilityPolicies,
  normalizePolicyBody,
} from './visibility-governance.mjs';

const ownerTable = (extra = {}) => ({
  name: 'todos',
  visibility: { kind: 'owner', field: 'ownerId' },
  fields: [
    { name: 'ownerId', fieldType: { String: {} } },
    { name: 'slug', fieldType: { String: {} } },
    { name: 'title', fieldType: { String: {} } },
  ],
  indexes: [],
  ...extra,
});

function errorSink(code, _subsystem, message, details) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function hostMutation(name, steps, writePolicy = { semanticVersion: 'snapback.owner-write.v1', disclosures: [] }) {
  return {
    name,
    kind: 'Mutation',
    runtime: { HostPlan: { Mutation: { steps, return_value: null } } },
    declaredWrites: ['todos'],
    writePolicy,
  };
}

function jsMutation(name, source, metadata = {}) {
  return {
    name,
    kind: 'Mutation',
    handlerForm: metadata.handlerForm ?? 'inline',
    runtime: { IbexModule: { source, export: name } },
    declaredWrites: ['todos'],
    writePolicy: {
      semanticVersion: 'snapback.owner-write.v1',
      disclosures: metadata.disclosures ?? [],
      ...(metadata.opaqueWritePosture === undefined
        ? {} : { opaqueWritePosture: metadata.opaqueWritePosture }),
      ...(metadata.declaredTableCeiling === undefined
        ? {} : { declaredTableCeiling: metadata.declaredTableCeiling }),
    },
  };
}

test('governance posture stays refused while owner posture remains host-enforced', () => {
  const owner = deriveWritePosture('todos', ownerTable());
  assert.deepEqual(owner.dispositions, {
    insert: 'owner-host-stamped',
    'insert-each': 'owner-host-stamped',
    patch: 'owner-old-row-checked',
    delete: 'owner-old-row-checked',
    'delete-where': 'owner-filtered',
  });
  const publicPosture = deriveWritePosture('todos', {
    ...ownerTable(), visibility: { kind: 'public-read' },
  });
  assert.deepEqual(new Set(Object.values(publicPosture.dispositions)), new Set(['refused']));
});

test('Phase 1a warns and projects migration-pending without applying owner checks', () => {
  for (const visibility of [
    { kind: 'public-read' },
    { kind: 'membership', declaration: 'members', resourceField: 'roomId' },
    { kind: 'any-of', arms: [{ kind: 'public-read' }, { kind: 'owner', field: 'ownerId' }] },
  ]) {
    const warnings = [];
    const fn = hostMutation('legacyWrite', [{ Insert: {
      table: 'todos', values: { ownerId: { Literal: 'caller-preserved' } },
    } }]);
    const result = buildWritePolicyChecks({
      tables: { todos: ownerTable({ visibility }) },
      functions: [fn],
      sourceFunctions: [fn],
      err: errorSink,
      warn: (code, subsystem, message, details) => {
        warnings.push({ code, subsystem, message, details });
      },
    });
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].genericWriteDisposition, 'migration-pending');
    assert.deepEqual(result.rows[0].authoritativeChecks, ['pre-0264-runtime-behavior']);
    assert.equal(warnings.length, 1);
    assert.equal(warnings[0].code, WRITE_POSTURE_MIGRATION_WARNING);
    assert.equal(warnings[0].details.candidateWritePolicyCheck.id, result.rows[0].id);
  }
});

test('Phase 1b synthetic flip refuses declared non-owner generic writes', () => {
  const fn = hostMutation('futureRefusal', [{ Insert: { table: 'todos', values: {} } }]);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable({ visibility: { kind: 'public-read' } }) },
      functions: [fn],
      sourceFunctions: [fn],
      err: errorSink,
      declaredNonOwnerDisposition: 'refused',
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_POLICY_INELIGIBLE'
      && details.candidateWritePolicyCheck.genericWriteDisposition === 'migration-pending',
  );
});

test('opaque migration facts use the declared write set without claiming a site census', () => {
  const warnings = [];
  const fn = jsMutation(
    'legacyOpaque',
    'export async function legacyOpaque(ctx) { return helper(ctx); }',
    { handlerForm: 'module' },
  );
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable({ visibility: { kind: 'public-read' } }) },
    functions: [fn],
    sourceFunctions: [fn],
    err: errorSink,
    warn: (...warning) => warnings.push(warning),
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'migration-pending-declared-write-set');
  assert.equal(result.rows[0].siteId, null);
  assert.equal(result.rows[0].table, 'todos');
  assert.equal(result.rows[0].genericWriteDisposition, 'migration-pending');
  assert.equal(warnings[0][0], WRITE_POSTURE_MIGRATION_WARNING);
});

test('inline census preserves distinct same-table sites and rejects authored owner input', () => {
  const source = `async function write(ctx) {
    await ctx.db.insert('todos', { title: 'first' });
    await ctx.db.insert('todos', { title: 'second' });
  }`;
  const census = scanGenericWriteSites(source, 'write');
  assert.equal(census.opaque, false);
  assert.equal(census.sites.length, 2);
  assert.notEqual(census.sites[0].siteId, census.sites[1].siteId);

  const forged = jsMutation('forged',
    `async function forged(ctx) { return ctx.db.insert('todos', { ownerId: 'alice' }); }`);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable() }, functions: [forged], sourceFunctions: [forged], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_OWNER_INPUT_REFUSED'
      && details.candidateWritePolicyCheck.ownerInputDisposition === 'host-stamped',
  );
});

test('authority tables refuse before their row-policy kind', () => {
  const fn = hostMutation('insertMember', [{ Insert: { table: 'todos', values: {} } }]);
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: ownerTable({
        visibility: { kind: 'public-read' },
        membership: { id: 'members' },
      }) },
      functions: [fn], sourceFunctions: [fn], err: errorSink,
    }),
    ({ code }) => code === 'SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE',
  );
});

test('generated authority-profile transitions bypass the generic writer classifier', () => {
  const fn = jsMutation(
    'appAccess.join',
    `globalThis.__snapbackHandlers = {
      async ['appAccess.join'](ctx, args) {
        return ctx.authorityProfile.appAccess.transition('join', args);
      },
    };`,
    { handlerForm: 'module' },
  );
  const sourceFn = {
    ...fn,
    authorityProfileOperation: {
      id: 'appAccess', generation: 'sha256:test', operation: 'join',
    },
  };
  const result = buildWritePolicyChecks({
    tables: {
      todos: ownerTable({ membership: { id: 'appAccess' } }),
    },
    functions: [fn],
    sourceFunctions: [sourceFn],
    err: errorSink,
  });
  assert.deepEqual(result.rows, []);
});

test('global uniqueness disclosure is bound to operation identity and widens by operation-set growth', () => {
  const table = ownerTable({ indexes: [{ name: 'by_slug', fields: ['slug'], unique: true }] });
  const disclosure = {
    table: 'todos', writeForm: 'insert', constraint: 'by_slug', operations: ['createA'],
  };
  const createA = hostMutation('createA', [{ Insert: {
    table: 'todos', values: { ownerId: 'AuthUserId', slug: { Arg: 'slug' } },
  } }], { semanticVersion: 'snapback.owner-write.v1', disclosures: [disclosure] });
  const createB = hostMutation('createB', [{ Insert: {
    table: 'todos', values: { ownerId: 'AuthUserId', slug: { Arg: 'slug' } },
  } }]);
  assert.doesNotThrow(() => buildWritePolicyChecks({
    tables: { todos: table }, functions: [createA], sourceFunctions: [createA], err: errorSink,
  }));
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: table }, functions: [createA, createB],
      sourceFunctions: [createA, createB], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_UNIQUE_DISCLOSURE_REQUIRED'
      && details.function === 'createB',
  );

  const before = normalizePolicyBody(
    table.visibility, { todos: table }, deriveWritePosture('todos', table, [disclosure]),
  );
  const afterDisclosure = { ...disclosure, operations: ['createA', 'createB'] };
  const after = normalizePolicyBody(
    table.visibility, { todos: table }, deriveWritePosture('todos', table, [afterDisclosure]),
  );
  assert.equal(compareVisibilityPolicies(before, after), 'growth');
});

test('opaque module needs conservative-v1, a closed ceiling, and all-form conflict disclosures', () => {
  const table = ownerTable({ indexes: [{ name: 'by_slug', fields: ['slug'], unique: true }] });
  const bare = jsMutation('opaque', 'export async function opaque(ctx) { return helper(ctx); }', {
    handlerForm: 'module',
  });
  assert.throws(
    () => buildWritePolicyChecks({
      tables: { todos: table }, functions: [bare], sourceFunctions: [bare], err: errorSink,
    }),
    ({ code, details }) => code === 'SNAPBACK_TABLE_WRITE_UNCOMPOSED_SURFACE'
      && details.candidateWritePolicyCheck.siteResolution === 'opaque-module',
  );

  const disclosures = ['insert', 'patch'].map((writeForm) => ({
    table: 'todos', writeForm, constraint: 'by_slug', operations: ['opaque'],
  }));
  const declared = jsMutation('opaque', bare.runtime.IbexModule.source, {
    handlerForm: 'module',
    opaqueWritePosture: 'conservative-v1',
    declaredTableCeiling: ['todos'],
    disclosures,
  });
  const result = buildWritePolicyChecks({
    tables: { todos: table }, functions: [declared], sourceFunctions: [declared], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].writeForm, 'opaque');
  assert.deepEqual(result.rows[0].writeFormCeiling, ['insert', 'patch', 'delete']);
});

test('classifiable runtime-table sites project one exact ceiling-member row', () => {
  const fn = jsMutation(
    'remove',
    `async function remove(ctx, args) { return ctx.db.delete(args.table, args.id); }`,
    { declaredTableCeiling: ['todos'] },
  );
  const result = buildWritePolicyChecks({
    tables: { todos: ownerTable() }, functions: [fn], sourceFunctions: [fn], err: errorSink,
  });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].siteResolution, 'runtime-ceiling-member');
  assert.equal(result.rows[0].tableResolution, 'runtime-ceiling-member');
  assert.equal(result.rows[0].table, 'todos');
  assert.deepEqual(result.rows[0].declaredTableCeiling, ['todos']);
});

test('generic write elevation is not an admitted authoring field value', async () => {
  const { arg, defineMutation, insert, v } = await import('./define.mjs');
  assert.throws(
    () => defineMutation({
      args: { title: v.string() },
      plan: insert('todos', { title: arg('title') }),
      writeElevation: { tables: ['todos'] },
    }),
    ({ code }) => code === 'SNAPBACK_TABLE_WRITE_ELEVATION_UNAVAILABLE',
  );
});
