import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineRelationalQuery, defineSchema, defineTable, v } from './define.mjs';
import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;

// Authoring validation is fail-closed against the closed LLP 0080 §1 shape.
{
  const books = defineTable({
    title: v.string(),
    authorSlug: v.optional(v.string()),
    ownerId: v.string(),
    score: v.real(),
    payload: v.json(),
  }).index('by_owner_title', ['ownerId', 'title']);
  const authors = defineTable({
    slug: v.string(),
    name: v.string(),
    ownerId: v.string(),
  })
    .index('by_slug', ['slug'], { unique: true })
    .index('by_slug_loose', ['slug']);
  defineSchema({ books, authors });

  const base = {
    root: books,
    joined: authors,
    join: [{ root: 'authorSlug', joined: 'slug' }],
    visibility: {
      root: { kind: 'owner', field: 'ownerId' },
      joined: { kind: 'owner', field: 'ownerId' },
      output: 'owner',
    },
    projection: { title: { root: 'title' }, authorName: { joined: 'name' } },
    take: 25,
    rootIndex: 'by_owner_title',
    joinedIndex: 'by_slug',
  };

  assert.throws(
    () => defineRelationalQuery({ ...base, joined: books }),
    /root and joined tables must differ/,
    'v1 requires two distinct source tables',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, join: [{ root: 'score', joined: 'slug' }] }),
    /non-portable join-key type/,
    'float join keys are not admitted',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, joinedIndex: 'by_slug_loose' }),
    /must be a declared unique index/,
    'the cardinality proof requires the declared unique index',
  );
  // Retention is closed and default-deny (LLP 0080 §4): two values only,
  // and the authenticated lease class needs an owner-visible output.
  assert.throws(
    () => defineRelationalQuery({ ...base, retention: 'forever' }),
    /retention must be 'none', 'opaque-authorized-snapshot-v1', or 'result-transform-snapshot-v1'/,
    'the retention vocabulary is closed',
  );
  assert.throws(
    () => defineRelationalQuery({
      ...base,
      visibility: { root: { kind: 'public-read' }, joined: { kind: 'public-read' }, output: 'public-read' },
      retention: 'opaque-authorized-snapshot-v1',
    }),
    /anonymous results have no admissible v1 retention/,
    'an all-public plan cannot declare the lease class',
  );
  {
    const retained = defineRelationalQuery({ ...base, retention: 'opaque-authorized-snapshot-v1' });
    assert.equal(retained.retainable, true, 'the lease class declares retainable');
    assert.equal(retained.retentionClass, undefined, 'legacy opaque manifests retain their byte shape');
    assert.deepEqual(retained.authorizationDependence, ['userId']);
    const reclassified = defineRelationalQuery({
      ...base,
      retention: 'result-transform-snapshot-v1',
    });
    assert.equal(reclassified.retainable, true, 'the reclassified plan remains retained');
    assert.equal(reclassified.retentionClass, 'result-transform-snapshot-v1');
    const plain = defineRelationalQuery(base);
    assert.equal(plain.retainable, undefined, 'retention defaults to none');
  }
  assert.throws(
    () => defineRelationalQuery({
      ...base,
      visibility: { ...base.visibility, output: 'public-read' },
    }),
    /output visibility is never broader/,
    'owner sources cannot widen to a public output',
  );
  assert.throws(
    () => defineRelationalQuery({
      ...base,
      kind: 'left',
      visibility: {
        root: { kind: 'public-read' },
        joined: { kind: 'owner', field: 'ownerId' },
        output: 'owner',
      },
    }),
    /left join cannot derive owner visibility from the omissible joined side/,
    'the omissible side cannot carry the only owner evidence',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, rootIndex: 'missing' }),
    /must be a declared index/,
    'index-served root access requires a declared index',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, take: 1_025 }),
    /take must be an integer from 0 through 1024/,
  );
  assert.throws(
    () => defineRelationalQuery({
      ...base,
      projection: { payload: { root: 'payload' } },
    }),
    /must be a portable scalar field/,
    'every admitted schema-sourced leaf has a fully derivable scalar contract',
  );
  assert.throws(
    () => defineRelationalQuery({
      ...base,
      projection: { payload: { literal: { nested: true } } },
    }),
    /must be a finite JSON scalar literal/,
    'literal leaves stay inside the result-contract literal vocabulary',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, result: {} }),
    /unknown field result|unexpected field/i,
    'the closed relational profile does not admit a declared result contract',
  );
  assert.throws(
    () => defineRelationalQuery({ ...base, joinKind: 'inner' }),
    /unknown field joinKind|unexpected field/i,
    'the spec vocabulary is closed',
  );

  const defined = defineRelationalQuery(base);
  assert.equal(defined.auth, 'authenticated');
  assert.equal(defined.relationalPlan.joinKind, 'Inner');
  assert.deepEqual(defined.relationalPlan.order.map((o) => o.field), ['title']);
}

// Generation emits the serialized closed plan, the relational capability
// requirement (stable since the 2026-07-26 LLP 0080/0081 promotion — no
// experimental acknowledgment), and a both-table static effect ceiling —
// byte-identically.
const dir = mkdtempSync(join(tmpdir(), 'snapback-relational-'));
try {
  const snapbackModules = join(dir, 'node_modules', '@expo');
  mkdirSync(snapbackModules, { recursive: true });
  symlinkSync(packageDir, join(snapbackModules, 'snapback-codegen'), 'dir');

  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const books = defineTable({
  title: v.string(),
  authorSlug: v.optional(v.string()),
  ownerId: v.principal(),
  score: v.real(),
  available: v.boolean(),
})
  .index('by_owner_title', ['ownerId', 'title'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export const authors = defineTable({
  slug: v.string(),
  name: v.string(),
  penName: v.optional(v.string()),
  ownerId: v.principal(),
})
  .index('by_slug', ['slug'], { unique: true })
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export default defineSchema({ books, authors }, { auth: { mode: 'sessions' } });
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import schema from './schema.mjs';
import { defineRelationalQuery } from '${defineUrl}';

export const booksWithAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'inner',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'owner', field: 'ownerId' },
    output: 'owner',
  },
  projection: {
    title: { root: 'title' },
    authorName: { joined: 'name' },
    score: { root: 'score' },
    available: { root: 'available' },
    shelf: { literal: 'fiction' },
    featured: { literal: true },
    edition: { literal: 1 },
    note: { literal: null },
  },
  take: 50,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
  retention: 'opaque-authorized-snapshot-v1',
});

export const booksWithMaybeAuthors = defineRelationalQuery({
  root: schema.tables.books,
  joined: schema.tables.authors,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'owner', field: 'ownerId' },
    output: 'owner',
  },
  projection: {
    title: { root: 'title' },
    authorName: { joined: 'name' },
    penName: { joined: 'penName' },
    shelf: { literal: 'fiction' },
  },
  take: 25,
  rootIndex: 'by_owner_title',
  joinedIndex: 'by_slug',
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'));
  const fn = manifest.functions.find((candidate) => candidate.name === 'booksWithAuthors');
  assert(fn, 'relational function must be emitted');
  assert.equal(fn.authRequirement, 'authenticated');
  assert.equal(fn.retainable, true);
  assert.equal(fn.retentionClass, undefined, 'opaque compatibility encoding stays unchanged');
  const plan = fn.runtime.HostPlan.RelationalQuery;
  assert.equal(plan.root, 'books');
  assert.equal(plan.joined, 'authors');
  assert.equal(plan.joinKind, 'Inner');
  assert.deepEqual(plan.joinOn, [{ rootField: 'authorSlug', joinedField: 'slug' }]);
  assert.deepEqual(plan.rootVisibility, [
    { field: 'ownerId', op: 'Eq', value: 'AuthUserId' },
  ]);
  assert.deepEqual(plan.joinedVisibility, [
    { field: 'ownerId', op: 'Eq', value: 'AuthUserId' },
  ]);
  assert.deepEqual(
    plan.projection.map((leaf) => leaf.name).sort(),
    ['authorName', 'available', 'edition', 'featured', 'note', 'score', 'shelf', 'title'],
  );
  assert.equal(plan.take, 50);
  assert.equal(plan.rootIndex, 'by_owner_title');
  assert.equal(plan.joinedIndex, 'by_slug');
  assert.deepEqual(
    [...fn.requiredCapabilities].sort(),
    ['args_contract_v1', 'host_plan_runtime', 'live_subscriptions', 'relational_query_v1', 'result_contract_v1'],
    'the relational capability is required, so unsupported targets refuse at generation',
  );
  assert.deepEqual(fn.effectCeiling, {
    version: 'EffectCeilingV1',
    basis: 'static',
    reads: [
      { table: 'authors', access: 'query', index: 'by_slug' },
      { table: 'books', access: 'query', index: 'by_owner_title' },
    ],
    writes: [],
    hostOperations: [],
    authorizationInputs: ['authUserId'],
  });

  assert.equal(fn.resultContract.kind, 'records');
  assert.deepEqual(fn.resultContract.rows, { minItems: 0, maxItems: 50 });
  const resultFields = Object.fromEntries(
    fn.resultContract.record.fields.map((field) => [field.name, field]),
  );
  assert.equal(resultFields.title.value.kind, 'string', 'root strings derive from schema');
  assert.equal(resultFields.score.value.kind, 'finiteReal', 'root reals derive from schema');
  assert.equal(resultFields.available.value.kind, 'boolean', 'root booleans derive from schema');
  assert.deepEqual(resultFields.shelf.value, { kind: 'literal', value: 'fiction' });
  assert.deepEqual(resultFields.featured.value, { kind: 'literal', value: true });
  assert.deepEqual(resultFields.edition.value, { kind: 'literal', value: 1 });
  assert.deepEqual(resultFields.note.value, { kind: 'literal', value: null });

  const leftFn = manifest.functions.find((candidate) => candidate.name === 'booksWithMaybeAuthors');
  assert(leftFn, 'left relational function must be emitted');
  const leftFields = Object.fromEntries(
    leftFn.resultContract.record.fields.map((field) => [field.name, field]),
  );
  assert.deepEqual(leftFields.authorName, {
    name: 'authorName',
    required: true,
    value: {
      kind: 'union',
      variants: [
        { kind: 'null' },
        { kind: 'string', maxBytes: 1_048_576 },
      ],
    },
  }, 'a required joined scalar becomes a present nullable field under a left join');
  assert.deepEqual(leftFields.penName.value, {
    kind: 'union',
    variants: [
      { kind: 'null' },
      { kind: 'string', maxBytes: 1_048_576 },
    ],
  }, 'schema optionality and left-join absence collapse to one null union');

  const leftProvider = result.providerIntrospection.operations.queries
    .find((candidate) => candidate.name === 'booksWithMaybeAuthors');
  assert.deepEqual(leftProvider.result.row.fields.authorName, {
    shape: 'union',
    variants: [
      { shape: 'literal', value: null },
      { shape: 'primitive', name: 'string' },
    ],
  });
  assert.deepEqual(leftProvider.result.row.fields.shelf, {
    shape: 'literal',
    value: 'fiction',
  });
  assert(
    !result.diagnostics.some(
      ({ code, path }) => code === 'PROVIDER_INTROSPECTION_RESULT_TYPE_DEGRADED'
        && path?.startsWith('queries.booksWith'),
    ),
    'fully derived relational results must not emit the degraded provider diagnostic',
  );

  writeFileSync(join(dir, 'relational-types.fixture.ts'), `
import api, { type FunctionResult } from './generated/api';

declare const inner: FunctionResult<typeof api.booksWithAuthors>[number];
inner.title.toUpperCase();
inner.score.toFixed();
inner.available.valueOf();
const shelf: 'fiction' = inner.shelf;
const featured: true = inner.featured;
const edition: 1 = inner.edition;
const note: null = inner.note;

declare const left: FunctionResult<typeof api.booksWithMaybeAuthors>[number];
left.authorName?.toUpperCase();
left.penName?.toUpperCase();
// @ts-expect-error left-join-sourced fields must be checked for null
left.authorName.toUpperCase();
void [shelf, featured, edition, note];
`);
  execFileSync(join(packageDir, '../../node_modules/.bin/tsc'), [
    '--noEmit',
    '--strict',
    '--target', 'es2022',
    '--module', 'esnext',
    '--moduleResolution', 'bundler',
    'relational-types.fixture.ts',
  ], { cwd: dir, stdio: 'pipe' });

  const first = readFileSync(join(dir, 'generated', 'functions.manifest.json'));
  const regenerated = await generate(dir);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.deepEqual(
    readFileSync(join(dir, 'generated', 'functions.manifest.json')),
    first,
    'regeneration must be byte-identical',
  );

  const opaqueApi = await import(`${pathToFileURL(join(dir, 'generated', 'api.mjs')).href}?opaque`);
  const opaqueComposition = opaqueApi.api.booksWithAuthors.composition;
  assert.equal(
    opaqueComposition.normalizedCompositePlan.classification.retention,
    'opaque-authorized-snapshot-v1',
  );
  const functionsPath = join(dir, 'functions.mjs');
  const reclassifiedSource = readFileSync(functionsPath, 'utf8').replace(
    "retention: 'opaque-authorized-snapshot-v1'",
    "retention: 'result-transform-snapshot-v1'",
  );
  writeFileSync(functionsPath, reclassifiedSource);
  const reclassified = await generate(dir);
  assert.equal(reclassified.ok, true, JSON.stringify(reclassified.diagnostics));
  const reclassifiedManifest = JSON.parse(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const reclassifiedFunction = reclassifiedManifest.functions
    .find((candidate) => candidate.name === 'booksWithAuthors');
  assert.equal(reclassifiedFunction.retentionClass, 'result-transform-snapshot-v1');
  const reclassifiedApi = await import(
    `${pathToFileURL(join(dir, 'generated', 'api.mjs')).href}?result-transform`,
  );
  const reclassifiedComposition = reclassifiedApi.api.booksWithAuthors.composition;
  assert.equal(
    reclassifiedComposition.normalizedCompositePlan.classification.retention,
    'result-transform-snapshot-v1',
  );
  assert.notEqual(
    reclassifiedComposition.planHash,
    opaqueComposition.planHash,
    'owner reclassification rotates plan identity so records re-derive under a new QMK',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('relational-authoring.test.mjs: all cases passed');
