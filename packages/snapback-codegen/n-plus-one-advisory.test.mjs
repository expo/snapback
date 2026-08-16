import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';
import {
  N_PLUS_ONE_BATCH_READ_THRESHOLD,
  nPlusOneBatchReadAdvisories,
} from './n-plus-one-advisory.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const code = 'SNAPBACK_AUTHORING_N_PLUS_ONE_BATCH_READ';
const tables = {
  users: {
    indexes: [
      { name: 'by_slug', fields: ['slug'], unique: true },
      { name: 'by_tenant_slug', fields: ['tenant', 'slug'], unique: true },
      { name: 'by_optional_slug', fields: ['optionalSlug'], unique: true, whereApplicable: true },
      { name: 'by_name', fields: ['name'], unique: false },
    ],
  },
  profiles: { indexes: [] },
  teams: { indexes: [] },
};

function analyze(source, tableFacts = tables) {
  return nPlusOneBatchReadAdvisories({
    source,
    direct: true,
    sourceSpan: { file: 'functions.mjs', line: 10, column: 5 },
    functionName: 'probe',
    tables: tableFacts,
  });
}

const point = analyze(`async (ctx, args) => {
  const rows = [];
  for (const id of args.ids) rows.push(await ctx.db.get('users', id));
  return rows;
}`);
assert.equal(point.length, 1);
assert.equal(point[0].code, code);
assert.equal(point[0].severity, 'warning');
assert.equal(point[0].details.lookup, 'get');
assert.equal(point[0].details.table, 'users');
assert.equal(point[0].details.threshold, N_PLUS_ONE_BATCH_READ_THRESHOLD);
assert.equal(point[0].details.loopCardinality, 'unknown');
assert.equal(point[0].details.suggestedMethod, 'getMany');
assert.equal(point[0].details.remediations[0].machineApplicable, false);

const unique = analyze(`async (ctx, args) => {
  const rows = [];
  for (const key of args.keys) {
    rows.push(await ctx.db
      .query('users')
      .withIndex('by_tenant_slug')
      .eq('tenant', key.tenant)
      .eq('slug', key.slug)
      .first());
  }
  return rows;
}`);
assert.equal(unique.length, 1);
assert.equal(unique[0].details.lookup, 'unique');
assert.equal(unique[0].details.index, 'by_tenant_slug');
assert.equal(unique[0].details.suggestedMethod, 'uniqueMany');

const conditionalUnique = analyze(`async (ctx, args) => {
  for (const optionalSlug of args.optionalSlugs) {
    await ctx.db.query('users').withIndex('by_optional_slug')
      .eq('optionalSlug', optionalSlug).first();
  }
}`);
assert.deepEqual(
  conditionalUnique,
  [],
  'a unique-where-present lookup cannot suggest uniqueMany',
);

const nonUnique = analyze(`async (ctx, args) => {
  for (const name of args.names) {
    await ctx.db.query('users').withIndex('by_name').eq('name', name).first();
  }
}`);
assert.deepEqual(nonUnique, [], 'a non-unique first() query cannot suggest uniqueMany');

const batches = analyze(`async (ctx, args) => {
  for (const ids of args.idGroups) await ctx.db.getMany('users', ids);
  for (const keys of args.keyGroups) await ctx.db.uniqueMany('users', 'by_slug', keys);
}`);
assert.deepEqual(batches, [], 'already-batched reads stay silent');

const outsideLoop = analyze(`async (ctx, args) => ctx.db.get('users', args.id)`);
assert.deepEqual(outsideLoop, [], 'an exact lookup outside a loop stays silent');

const distinctTables = analyze(`async (ctx) => {
  for (const [table, id] of [['users', 'u1'], ['profiles', 'p1'], ['teams', 't1']]) {
    await ctx.db.get(table, id);
  }
}`);
assert.deepEqual(
  distinctTables,
  [],
  'a loop whose table varies per iteration is not a proved same-table batch',
);

const belowThreshold = analyze(`async (ctx) => {
  for (const id of ['u1', 'u2']) await ctx.db.get('users', id);
}`);
assert.deepEqual(belowThreshold, [], 'a statically bounded two-read loop stays below threshold');

const cStyleBelowThreshold = analyze(`async (ctx, args) => {
  for (let i = 0; i < 2; i++) await ctx.db.get('users', args.ids[i]);
}`);
assert.deepEqual(
  cStyleBelowThreshold,
  [],
  'a literal-bound C-style two-read loop stays below threshold',
);

const cStyleAtThreshold = analyze(`async (ctx, args) => {
  for (let i = 0; i < 3; i++) await ctx.db.get('users', args.ids[i]);
}`);
assert.equal(cStyleAtThreshold.length, 1);
assert.equal(cStyleAtThreshold[0].details.loopCardinality, N_PLUS_ONE_BATCH_READ_THRESHOLD);

const inclusiveCStyleAtThreshold = analyze(`async (ctx, args) => {
  for (let i = 0; i <= 2; i += 1) await ctx.db.get('users', args.ids[i]);
}`);
assert.equal(inclusiveCStyleAtThreshold.length, 1);
assert.equal(
  inclusiveCStyleAtThreshold[0].details.loopCardinality,
  N_PLUS_ONE_BATCH_READ_THRESHOLD,
);

const atThreshold = analyze(`async (ctx) => {
  for (const id of ['u1', 'u2', 'u3']) await ctx.db.get('users', id);
}`);
assert.equal(atThreshold.length, 1);
assert.equal(atThreshold[0].details.loopCardinality, N_PLUS_ONE_BATCH_READ_THRESHOLD);

const nestedThreshold = analyze(`async (ctx) => {
  for (const tenant of ['t1', 't2']) {
    for (const slug of ['s1', 's2']) {
      await ctx.db.query('users').withIndex('by_tenant_slug')
        .eq('tenant', tenant).eq('slug', slug).first();
    }
  }
}`);
assert.equal(nestedThreshold.length, 1);
assert.equal(nestedThreshold[0].details.loopCardinality, 4);

const switchDispatch = analyze(`async (ctx, args) => {
  for (const kind of ['user', 'profile', 'team']) {
    switch (kind) {
      case 'user':
        await ctx.db.get('users', args.userId);
        break;
      case 'profile':
        await ctx.db.get('profiles', args.profileId);
        break;
      default:
        await ctx.db.get('teams', args.teamId);
    }
  }
}`);
assert.deepEqual(
  switchDispatch,
  [],
  'mutually exclusive switch branches do not inherit the loop cardinality',
);

const unconditionalBesideSwitch = analyze(`async (ctx, args) => {
  for (const kind of ['user', 'profile', 'team']) {
    switch (kind) {
      case 'user':
        await ctx.db.get('profiles', args.profileId);
        break;
      default:
        await ctx.db.get('teams', args.teamId);
    }
    await ctx.db.get('users', args.userId);
  }
}`);
assert.equal(
  unconditionalBesideSwitch.length,
  1,
  'an unconditional same-table call beside conditional dispatch still fires',
);
assert.equal(unconditionalBesideSwitch[0].details.table, 'users');

const guardedExpressions = analyze(`async (ctx, args) => {
  for (const id of ['u1', 'u2', 'u3']) {
    if (args.includeIf) await ctx.db.get('users', id);
    args.includeTernary ? await ctx.db.get('profiles', id) : null;
    args.includeLogical && await ctx.db.get('teams', id);
  }
}`);
assert.deepEqual(
  guardedExpressions,
  [],
  'if, ternary, and logical guards make their call sites conditional',
);

const directory = mkdtempSync(join(tmpdir(), 'snapback-n-plus-one-advisory-'));
try {
  const snapbackModules = join(directory, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');
  writeFileSync(join(directory, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const users = defineTable({ name: v.string() }).sync();
export default defineSchema({ users });
`);
  writeFileSync(join(directory, 'functions.mjs'), `
import { defineJsQuery, results, v } from '${defineUrl}';
export const loadUsers = defineJsQuery({
  auth: 'public',
  args: { ids: v.array(v.id('users')) },
  reads: ['users'],
  result: results.documents('users'),
  handler: async (ctx, args) => {
    const rows = [];
    for (const id of args.ids) {
      const row = await ctx.db.get('users', id);
      if (row) rows.push(row);
    }
    return rows;
  },
});
export const loadLegacyUsers = defineJsQuery({
  auth: 'public',
  args: { ids: v.array(v.id('users')) },
  reads: ['users'],
  result: results.documents('users'),
  source: 'legacy-handler.mjs',
  exportName: 'loadById',
});
`);
  writeFileSync(join(directory, 'legacy-handler.mjs'), `
globalThis.__snapbackHandlers = {
  loadById: async (ctx, args) => {
    const rows = [];
    for (const id of args.ids) {
      const row = await ctx.db.get('users', id);
      if (row) rows.push(row);
    }
    return rows;
  },
};
`);
  const generated = await generate(directory);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const advisory = generated.diagnostics.find(
    (diagnostic) => diagnostic.code === code && diagnostic.function === 'loadUsers',
  );
  assert(advisory, JSON.stringify(generated.diagnostics));
  assert.equal(advisory.function, 'loadUsers');
  assert.equal(advisory.sourceSpan.file, 'functions.mjs');
  assert.equal(advisory.details.suggestedMethod, 'getMany');
  const legacyAdvisory = generated.diagnostics.find(
    (diagnostic) => diagnostic.code === code && diagnostic.function === 'loadLegacyUsers',
  );
  assert(legacyAdvisory, JSON.stringify(generated.diagnostics));
  assert.equal(legacyAdvisory.sourceSpan.file, 'legacy-handler.mjs');
  assert.equal(legacyAdvisory.sourceSpan.line, 6);
} finally {
  rmSync(directory, { recursive: true, force: true });
}

console.log(
  'n-plus-one-advisory.test.mjs: proven get/unique findings, conditional-site silence, total-unique proof, and C-style thresholds passed',
);
