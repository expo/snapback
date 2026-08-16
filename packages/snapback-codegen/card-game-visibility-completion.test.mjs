import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

// @ref LLP 0234#phase-g2--d2-enforcing-closure — the accepted completion
//   proof mutates the real hidden-hand schema without leaving the demo broken.
const packageRoot = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(packageRoot, '../..');
const defineUrl = pathToFileURL(join(packageRoot, 'define.mjs')).href;
const cardSchemaPath = join(repositoryRoot, 'demos/card-game/snapback/schema.mjs');
const cardSchemaSource = readFileSync(cardSchemaPath, 'utf8').replace(
  "'../../_kit/define.mjs'",
  `'${defineUrl}'`,
);
const handPolicy = ".visibility({ kind: 'owner', field: 'ownerId' })";
assert.equal(cardSchemaSource.split(handPolicy).length - 1, 1,
  'the fixture mutation targets the real card-game hand policy exactly once');

const helperTable = `
  cardNotes: defineTable({
    handId: v.id('hands'),
    handIncarnation: v.relationIncarnationOf({
      foreignKeyField: 'handId', parentTable: 'hands',
    }),
    position: v.integer(),
    body: v.string(),
  })
    .index('by_hand_position', ['handId', 'handIncarnation', 'position'])
    .visibility({ kind: 'public-read' }),
`;

function schemaFixture({ policy = true, withHelper = false, relational = false } = {}) {
  let source = cardSchemaSource;
  if (withHelper) {
    source = source.replace(
      "}, { auth: { mode: 'sessions' } });",
      `${helperTable}}, { auth: { mode: 'sessions' } });`,
    );
  }
  if (relational) {
    source = source.replace(
      ".index('by_game', ['gameId'])",
      ".index('by_game', ['gameId'], { unique: true })",
    );
  }
  if (!policy) source = source.replace(`    ${handPolicy}\n`, '');
  return source;
}

async function generateFixture(name, functions, options = {}) {
  const root = mkdtempSync(join(tmpdir(), `snapback-card-visibility-${name}-`));
  const backend = join(root, 'snapback');
  mkdirSync(backend, { recursive: true });
  writeFileSync(join(root, 'demo.snapback.json'), JSON.stringify({ id: `card-visibility-${name}` }));
  writeFileSync(join(backend, 'schema.mjs'), schemaFixture(options));
  writeFileSync(join(backend, 'functions.mjs'), functions);
  try {
    return await generate(backend);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

async function provesFailClosed(name, functions, options = {}) {
  const control = await generateFixture(`${name}-control`, functions, { ...options, policy: true });
  assert.equal(control.ok, true, `control ${name}: ${JSON.stringify(control.diagnostics)}`);
  assert.equal(
    control.diagnostics.some(({ code }) => code === 'SNAPBACK_TABLE_VISIBILITY_UNCOMPOSED_READ_SURFACE'),
    false,
    `${name} composes the declared hidden-hand policy`,
  );

  const omitted = await generateFixture(`${name}-omitted`, functions, { ...options, policy: false });
  assert.equal(omitted.ok, false, `omitted ${name}: ${JSON.stringify(omitted.diagnostics)}`);
  const errors = omitted.diagnostics.filter(
    ({ code, table }) => code === 'SNAPBACK_AUTH_TABLE_VISIBILITY_IMPLICIT' && table === 'hands',
  );
  assert.equal(errors.length, 1, JSON.stringify(omitted.diagnostics));
  assert.equal(errors[0].severity, 'error');
}

test('card-game direct hand reads fail generation when the table policy is deleted', async () => {
  await provesFailClosed('direct', `
import { arg, authUserId, defineLiveQuery, eq, v } from '${defineUrl}';
export const myHand = defineLiveQuery({
  auth: 'authenticated', table: 'hands', args: { gameId: v.string() },
  filter: [eq('ownerId', authUserId()), eq('gameId', arg('gameId'))],
  index: 'by_owner_game',
});
`);
});

test('card-game relational hand reads fail generation when the table policy is deleted', async () => {
  await provesFailClosed('relational', `
import schema from './schema.mjs';
import { defineRelationalQuery, owner } from '${defineUrl}';
export const handReadyState = defineRelationalQuery({
  root: schema.tables.hands,
  joined: schema.tables.readySignals,
  join: [{ root: 'gameId', joined: 'gameId' }],
  visibility: { root: owner('ownerId'), joined: owner('userId'), output: 'owner' },
  projection: { card: { root: 'card' }, ready: { joined: 'ready' } },
  take: 10,
  rootIndex: 'by_owner_game',
  joinedIndex: 'by_game',
});
`, { relational: true });
});

const boundedFunctions = `
import schema from './schema.mjs';
import { asc, defineBoundedChildrenQuery, owner, throughParent } from '${defineUrl}';
export const handNotes = defineBoundedChildrenQuery({
  parent: {
    table: schema.tables.hands, idArg: 'handId', visibility: owner('ownerId'),
    select: { id: '_id', card: 'card' },
  },
  children: {
    table: schema.tables.cardNotes, foreignKey: 'handId', parentIncarnation: 'handIncarnation',
    visibility: throughParent(), index: 'by_hand_position', order: [asc('position')],
    select: { id: '_id', position: 'position', body: 'body' },
  },
  take: 10,
  parentDeletion: 'hide-orphans.v1',
});
`;

test('card-game bounded hand reads fail generation when the table policy is deleted', async () => {
  await provesFailClosed('bounded', boundedFunctions, { withHelper: true });
});

test('card-game snapshot hand reads fail generation when the table policy is deleted', async () => {
  await provesFailClosed('snapshot', `${boundedFunctions}
import { defineSnapshotBatchQuery } from '${defineUrl}';
export const handSnapshot = defineSnapshotBatchQuery({ nodes: [handNotes, handNotes] });
`, { withHelper: true });
});

test('card-game declares no search index, so the completion matrix has no search arm', () => {
  assert.equal(/\.searchIndex\s*\(/u.test(cardSchemaSource), false);
});
