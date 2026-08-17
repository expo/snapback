import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-snapshot-batch-v2-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const boards = defineTable({ ownerId: v.principal(), title: v.string() })
  .visibility({ kind: 'owner', field: 'ownerId' }).sync();
export const cards = defineTable({
  boardId: v.id('boards'),
  boardIncarnation: v.relationIncarnationOf({ foreignKeyField: 'boardId', parentTable: 'boards' }),
  position: v.integer(),
  label: v.string(),
}).index('by_board_position', ['boardId', 'boardIncarnation', 'position'])
  .visibility({ kind: 'public-read' }).sync();
export const events = defineTable({
  ownerId: v.principal(), actorSlug: v.string(), sequence: v.integer(), title: v.string(),
}).index('by_owner_sequence', ['ownerId', 'sequence'])
  .visibility({ kind: 'owner', field: 'ownerId' }).sync();
export const actors = defineTable({ slug: v.string(), name: v.string() })
  .index('by_slug', ['slug'], { unique: true }).visibility({ kind: 'public-read' }).sync();
export default defineSchema({ boards, cards, events, actors }, { auth: { mode: 'sessions' } });
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import {
  asc, defineBoundedChildrenQuery, defineRelationalQuery, defineSnapshotBatchQuery, owner,
  throughParent,
} from '${defineUrl}';
import { actors, boards, cards, events } from './schema.mjs';

export const boardCards = defineBoundedChildrenQuery({
  parent: { table: boards, idArg: 'boardId', visibility: owner('ownerId'), select: { id: '_id', title: 'title' } },
  children: {
    table: cards, foreignKey: 'boardId', parentIncarnation: 'boardIncarnation',
    visibility: throughParent(), index: 'by_board_position', order: [asc('position')],
    select: { id: '_id', position: 'position', label: 'label' },
  },
  take: 4,
  parentDeletion: 'hide-orphans.v1',
});
export const eventActors = defineRelationalQuery({
  root: events,
  joined: actors,
  join: [{ root: 'actorSlug', joined: 'slug' }],
  visibility: {
    root: { kind: 'owner', field: 'ownerId' },
    joined: { kind: 'public-read' },
    output: 'owner',
  },
  projection: { title: { root: 'title' }, actorName: { joined: 'name' } },
  take: 3,
  rootIndex: 'by_owner_sequence',
  joinedIndex: 'by_slug',
});
export const mixedView = defineSnapshotBatchQuery({ nodes: [boardCards, eventActors, boardCards] });
export const allRelational = defineSnapshotBatchQuery({ nodes: [eventActors, eventActors] });
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const manifest = JSON.parse(readFileSync(join(dir, 'generated/functions.manifest.json'), 'utf8'));
  const mixed = manifest.functions.find((fn) => fn.name === 'mixedView');
  const allRelational = manifest.functions.find((fn) => fn.name === 'allRelational');
  const mixedPlan = mixed.runtime.HostPlan.SnapshotBatchV2;
  assert.equal(mixedPlan.profile, 'snapshot-batch.v2');
  assert.deepEqual(mixedPlan.nodes.map((node) => node.classId), [
    'bounded_children_v1', 'relational_query_v1', 'bounded_children_v1',
  ]);
  assert.deepEqual(
    mixedPlan.normalizedCompositePlan.parentAuthorizationGroups.map((group) => group.members),
    [[0, 2]],
  );
  assert.equal(mixedPlan.normalizedCompositePlan.profileId, 'snapshot-batch.v2');
  assert.match(mixedPlan.planHash, /^sha256:[0-9a-f]{64}$/u);
  assert.deepEqual(allRelational.runtime.HostPlan.SnapshotBatchV2
    .normalizedCompositePlan.parentAuthorizationGroups, []);
  assert(mixed.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(mixed.requiredCapabilities.includes('relational_query_v1'));
  assert(mixed.requiredCapabilities.includes('bounded_children_v1'));
  assert(allRelational.requiredCapabilities.includes('snapshot_batch_v2'));
  assert(!allRelational.requiredCapabilities.includes('bounded_children_v1'));
  assert(manifest.acknowledgedExperimentalCapabilities.includes('snapshot_batch_v2'));

  const variants = mixed.resultContract.record.variants;
  assert.equal(variants.length, 2, 'v2 always carries the unnarrowed two-arm envelope');
  assert.equal(variants[0].fields[0].value.value, 'absent');
  assert.equal(variants[1].fields[1].value.kind, 'tuple');
  assert.deepEqual(
    mixed.effectCeiling.reads.map(({ table, access }) => [table, access]),
    [
      ['actors', 'query'],
      ['boards', 'point'],
      ['cards', 'query'],
      ['events', 'query'],
    ],
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
