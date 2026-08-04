import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    /retention must be 'none' or 'opaque-authorized-snapshot-v1'/,
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
    assert.deepEqual(retained.authorizationDependence, ['userId']);
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
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const books = defineTable({
  title: v.string(),
  authorSlug: v.optional(v.string()),
  ownerId: v.principal(),
})
  .index('by_owner_title', ['ownerId', 'title'])
  .sync();
export const authors = defineTable({
  slug: v.string(),
  name: v.string(),
  ownerId: v.principal(),
})
  .index('by_slug', ['slug'], { unique: true })
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
    shelf: { literal: 'fiction' },
  },
  take: 50,
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
    ['authorName', 'shelf', 'title'],
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

  const first = readFileSync(join(dir, 'generated', 'functions.manifest.json'));
  const regenerated = await generate(dir);
  assert.equal(regenerated.ok, true, JSON.stringify(regenerated.diagnostics));
  assert.deepEqual(
    readFileSync(join(dir, 'generated', 'functions.manifest.json')),
    first,
    'regeneration must be byte-identical',
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('relational-authoring.test.mjs: all cases passed');
