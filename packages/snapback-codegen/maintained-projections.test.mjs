import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { defineMaintainedProjection, defineSchema, defineTable, v } from './define.mjs';
import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;

assert.deepEqual(
  defineSchema({}, { requiredCapabilities: ['snapshot_batch_v1'] }).requiredCapabilities,
  ['snapshot_batch_v1'],
  'the closed schema capability vocabulary includes the static snapshot-batch carrier',
);

// Authoring validation mirrors activation (LLP 0080 §5/§3): everything the
// server would refuse at load refuses at generation with the same rules.

function fixtureTables() {
  const books = defineTable({
    title: v.string(),
    slug: v.string(),
    authorSlug: v.optional(v.string()),
    ownerId: v.principal(),
  })
    .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
    .index('by_slug', ['slug'], { unique: true })
    .index('by_author', ['authorSlug']);
  const authors = defineTable({
    slug: v.string(),
    name: v.string(),
    ownerId: v.principal(),
  }).index('authors_by_slug', ['slug'], { unique: true });
  const summaries = defineTable({
    title: v.string(),
    authorName: v.optional(v.string()),
    ownerId: v.principal(),
  });
  defineSchema({ books, authors, bookSummaries: summaries });
  return { books, authors, summaries };
}

function base(tables) {
  return {
    id: 'book-summaries',
    root: tables.books,
    joined: tables.authors,
    output: tables.summaries,
    join: [{ root: 'authorSlug', joined: 'slug' }],
    kind: 'inner',
    visibility: {
      root: { kind: 'owner', field: 'ownerId' },
      joined: { kind: 'public-read' },
      output: { kind: 'owner', field: 'ownerId' },
    },
    projection: {
      title: { root: 'title' },
      authorName: { joined: 'name' },
      ownerId: { root: 'ownerId' },
    },
    rootReverseIndex: 'by_author',
    fanOutLimit: 64,
    sharedFanOutDisclosure: true,
  };
}

const refuses = (spec, pattern, label) => {
  assert.throws(() => defineMaintainedProjection(spec), pattern, label);
};

// Positive: the emitted plan byte-matches the manifest shape the Rust
// runtime deserializes (serde camelCase; visibility 'public-read' |
// {owner:{field}}; outputKey 'RootId' | {RootUniqueIndex:{index,fields}}).
{
  const tables = fixtureTables();
  const def = defineMaintainedProjection(base(tables));
  assert.deepEqual(def.plan, {
    id: 'book-summaries',
    root: 'books',
    rootAlias: 'books',
    joined: 'authors',
    joinedAlias: 'authors',
    joinKind: 'Inner',
    joinOn: [{ rootField: 'authorSlug', joinedField: 'slug' }],
    rootFilters: [],
    rootVisibility: { owner: { field: 'ownerId' } },
    joinedVisibility: 'public-read',
    projection: [
      { name: 'title', source: { RootField: 'title' } },
      { name: 'authorName', source: { JoinedField: 'name' } },
      { name: 'ownerId', source: { RootField: 'ownerId' } },
    ],
    outputTable: 'bookSummaries',
    outputKey: 'RootId',
    outputVisibility: { owner: { field: 'ownerId' } },
    rootReverseIndex: 'by_author',
    fanOutLimit: 64,
    sharedFanOutDisclosure: true,
    rebuildRecipe: 'rebuild-v1',
  });

  const keyed = defineMaintainedProjection({
    ...base(tables),
    outputKey: { index: 'by_slug' },
  });
  assert.deepEqual(keyed.plan.outputKey, {
    RootUniqueIndex: { index: 'by_slug', fields: ['slug'] },
  });
}

// Disclosure: a shared public joined source feeding an owner output
// requires the explicit acknowledgment (SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED).
{
  const tables = fixtureTables();
  refuses(
    { ...base(tables), sharedFanOutDisclosure: undefined },
    /SNAPBACK_RELATIONAL_DISCLOSURE_REQUIRED/,
    'undisclosed shared fan-out must refuse',
  );
}

// Left-join owner derivation: the omissible joined side cannot carry the
// output owner evidence.
{
  const tables = fixtureTables();
  refuses(
    {
      ...base(tables),
      kind: 'left',
      visibility: {
        root: { kind: 'public-read' },
        joined: { kind: 'owner', field: 'ownerId' },
        output: { kind: 'owner', field: 'ownerId' },
      },
      projection: {
        title: { root: 'title' },
        authorName: { joined: 'name' },
        ownerId: { joined: 'ownerId' },
      },
    },
    /guaranteed-present source/,
    'left join cannot derive owner from the joined side',
  );
}

// No widening: an owner source forces an owner output.
{
  const tables = fixtureTables();
  refuses(
    {
      ...base(tables),
      visibility: {
        root: { kind: 'owner', field: 'ownerId' },
        joined: { kind: 'public-read' },
        output: { kind: 'public-read' },
      },
    },
    /no widening/,
    'owner source cannot feed a public output',
  );
}

// Reverse index: the bounded fan-out lookup must lead with the root
// join-field sequence.
{
  const tables = fixtureTables();
  refuses(
    { ...base(tables), rootReverseIndex: 'by_owner_slug' },
    /leading with/,
    'a non-leading reverse index must refuse',
  );
}

// Output key: only a declared unique root index is admissible.
{
  const tables = fixtureTables();
  refuses(
    { ...base(tables), outputKey: { index: 'by_author' } },
    /unique index/,
    'a non-unique output-key index must refuse',
  );
}

// Cardinality: the joined side must carry the exact unique index.
{
  const books = defineTable({
    title: v.string(),
    authorSlug: v.optional(v.string()),
    ownerId: v.principal(),
  }).index('by_author', ['authorSlug']);
  const authors = defineTable({
    slug: v.string(),
    name: v.string(),
  }).index('by_slug_loose', ['slug']);
  const summaries = defineTable({ title: v.string(), ownerId: v.principal() });
  defineSchema({ books, authors, cards: summaries });
  refuses(
    {
      id: 'cards',
      root: books,
      joined: authors,
      output: summaries,
      join: [{ root: 'authorSlug', joined: 'slug' }],
      visibility: {
        root: { kind: 'owner', field: 'ownerId' },
        joined: { kind: 'public-read' },
        output: { kind: 'owner', field: 'ownerId' },
      },
      projection: { title: { root: 'title' }, ownerId: { root: 'ownerId' } },
      rootReverseIndex: 'by_author',
      fanOutLimit: 8,
      sharedFanOutDisclosure: true,
    },
    /unique index/,
    'a merely conventionally unique joined key must refuse',
  );
}

// Projection leaves must exist on the output table, and fanOutLimit is
// bounded 1..=1023.
{
  const tables = fixtureTables();
  refuses(
    {
      ...base(tables),
      projection: { ...base(tables).projection, extra: { root: 'title' } },
    },
    /must exist on output table/,
    'a leaf without an output field must refuse',
  );
  refuses({ ...base(tables), fanOutLimit: 0 }, /1 through 1023/, 'fanOutLimit 0');
  refuses({ ...base(tables), fanOutLimit: 1024 }, /1 through 1023/, 'fanOutLimit 1024');
}

// A projection has no function carrier, so the generated bundle surfaces
// its relational-engine dependence as a schema-level requirement
// (LLP 0080 §7): emitted exactly once, not duplicated over an authored
// entry, and never emitted for a projection-free bundle.
{
  const schemaSource = (requiredCapabilities) => `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const books = defineTable({
  title: v.string(),
  authorSlug: v.optional(v.string()),
  ownerId: v.principal(),
})
  .index('by_owner_title', ['ownerId', 'title'], { unique: true })
  .index('by_author', ['authorSlug'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export const authors = defineTable({
  slug: v.string(),
  name: v.string(),
})
  .index('by_slug', ['slug'], { unique: true })
  .visibility({ kind: 'public-read' })
  .sync();
export const bookCards = defineTable({
  ownerId: v.principal(),
  title: v.string(),
  authorName: v.optional(v.string()),
})
  .index('cards_by_owner', ['ownerId'])
  .visibility({ kind: 'owner', field: 'ownerId' })
  .sync();
export default defineSchema(
  { books, authors, bookCards },
  { auth: { mode: 'dev' }${requiredCapabilities} },
);
`;
  const projectionFunctions = `
import schema from './schema.mjs';
import { defineMaintainedProjection } from '${defineUrl}';

export const bookCardsProjection = defineMaintainedProjection({
  id: 'book-cards',
  root: schema.tables.books,
  joined: schema.tables.authors,
  output: schema.tables.bookCards,
  join: [{ root: 'authorSlug', joined: 'slug' }],
  kind: 'left',
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: { kind: 'owner', field: 'ownerId' },
  },
  projection: {
    ownerId: { root: 'ownerId' },
    title: { root: 'title' },
    authorName: { joined: 'name' },
  },
  rootReverseIndex: 'by_author',
  fanOutLimit: 8,
  sharedFanOutDisclosure: true,
});
`;
  const generateCase = async (schemaExtra, functionsSource, { expectOk = true } = {}) => {
    const dir = mkdtempSync(join(tmpdir(), 'snapback-projfacts-'));
    try {
      writeFileSync(join(dir, 'schema.mjs'), schemaSource(schemaExtra));
      writeFileSync(join(dir, 'functions.mjs'), functionsSource);
      const result = await generate(dir);
      assert.equal(result.ok, expectOk, JSON.stringify(result.diagnostics));
      if (!expectOk) return result;
      return {
        schema: JSON.parse(readFileSync(join(dir, 'generated', 'schema.manifest.json'))),
        functions: JSON.parse(readFileSync(join(dir, 'generated', 'functions.manifest.json'))),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  };

  const carried = await generateCase('', projectionFunctions);
  assert.deepEqual(
    carried.schema.requiredCapabilities,
    ['relational_query_v1'],
    'a projection-carrying bundle requires the relational engine at schema level',
  );
  assert.equal(carried.functions.projections.length, 1);

  // The id is derived from the projection's presence, never authored:
  // defineSchema's closed authorable set refuses it at define time, so the
  // emitted entry can only come from the derivation above (no duplication
  // channel exists).
  const authored = await generateCase(
    ", requiredCapabilities: ['relational_query_v1']",
    projectionFunctions,
    { expectOk: false },
  );
  assert.match(
    JSON.stringify(authored.diagnostics),
    /unknown required target capability relational_query_v1/,
    'hand-authoring the derived id refuses at define time',
  );

  const plain = await generateCase('', `
import schema from './schema.mjs';
export {};
`);
  assert.equal(
    Object.hasOwn(plain.schema, 'requiredCapabilities'),
    false,
    'a projection-free bundle emits no schema-level relational requirement',
  );
}

console.log('maintained-projections.test.mjs: all cases passed');
