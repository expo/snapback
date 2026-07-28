import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate } from './index.mjs';

const packageDir = dirname(fileURLToPath(import.meta.url));
const defineUrl = pathToFileURL(join(packageDir, 'define.mjs')).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-relation-activity-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const incidents = defineTable({
  ownerId: v.string(),
  title: v.string(),
}).sync();
export const tasks = defineTable({
  incidentId: v.id('incidents'),
  incidentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'incidentId',
    parentTable: 'incidents',
  }),
  position: v.integer(),
  body: v.string(),
}).index('by_incident_position', [
  'incidentId', 'incidentIncarnation', 'position',
]).sync();
export const activity = defineTable({
  incidentId: v.id('incidents'),
  incidentIncarnation: v.relationIncarnationOf({
    foreignKeyField: 'incidentId',
    parentTable: 'incidents',
  }),
  sourceTable: v.string(),
  sourceId: v.string(),
  operation: v.string(),
  effectiveSubject: v.string(),
  actualActor: v.string(),
  actorKind: v.string(),
  grantId: v.optional(v.string()),
  occurredAt: v.integer(),
  mutationDigest: v.string(),
  detail: v.string(),
}).sync();
export default defineSchema({ incidents, tasks, activity });
`);
  writeFileSync(join(dir, 'functions.mjs'), `
import {
  arg, asc, binding, clientMutation, defineBoundedChildrenQuery,
  defineWriteWithActivity, existingOwner, insert, literal, mutationPlan,
  owner, record, results, runtimeNow, throughParent, throughScope, v,
} from '${defineUrl}';
import { activity, incidents, tasks } from './schema.mjs';

export const incidentTasks = defineBoundedChildrenQuery({
  parent: {
    table: incidents,
    idArg: 'incidentId',
    visibility: owner('ownerId'),
    select: { id: '_id', title: 'title' },
  },
  children: {
    table: tasks,
    foreignKey: 'incidentId',
    parentIncarnation: 'incidentIncarnation',
    visibility: throughParent(),
    index: 'by_incident_position',
    order: [asc('position')],
    select: { id: '_id', position: 'position', body: 'body' },
  },
  take: 25,
  parentDeletion: 'hide-orphans.v1',
});

export const addTask = defineWriteWithActivity({
  args: { incidentId: v.id('incidents'), body: v.string() },
  scope: existingOwner({
    table: incidents,
    id: arg('incidentId'),
    visibility: owner('ownerId'),
  }),
  primary: mutationPlan(insert('tasks', {
    incidentId: arg('incidentId'),
    position: runtimeNow(),
    body: arg('body'),
  }, { bindIdAs: 'taskId' })),
  source: { table: tasks, id: binding('taskId') },
  activity: {
    table: activity,
    visibility: throughScope({
      scopeField: 'incidentId',
      scopeIncarnationField: 'incidentIncarnation',
    }),
    provenance: {
      scopeId: 'incidentId',
      sourceTable: 'sourceTable',
      sourceId: 'sourceId',
      operation: 'operation',
      effectiveSubject: 'effectiveSubject',
      actualActor: 'actualActor',
      actorKind: 'actorKind',
      grant: 'grantId',
      occurredAt: 'occurredAt',
      mutation: 'mutationDigest',
    },
    values: { detail: arg('body') },
  },
  idempotency: clientMutation(),
  result: results.value(v.object({
    taskId: v.id('tasks'),
    activityId: v.id('activity'),
  })),
  returns: record({
    taskId: binding('taskId'),
    activityId: binding('__activityId'),
  }),
});
`);

  const result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const schema = JSON.parse(
    readFileSync(join(dir, 'generated', 'schema.manifest.json'), 'utf8'),
  );
  const childMarker = schema.tables
    .find((table) => table.name === 'tasks').fields
    .find((field) => field.name === 'incidentIncarnation');
  assert.deepEqual(childMarker.field_type, {
    RelationIncarnation: {
      foreignKeyField: 'incidentId',
      parentTable: 'incidents',
    },
  });

  const manifest = JSON.parse(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const relation = manifest.functions.find((fn) => fn.name === 'incidentTasks');
  assert.equal(relation.runtime.HostPlan.BoundedChildrenQuery.take, 25);
  assert.equal(
    relation.runtime.HostPlan.BoundedChildrenQuery.childIndex,
    'by_incident_position',
  );
  const activityPlan = manifest.functions.find((fn) => fn.name === 'addTask')
    .runtime.HostPlan.WriteWithActivity;
  const steps = activityPlan.mutation.steps;
  assert(steps.some((step) => step.AssertSourceChanged?.operation === 'insert'));
  const append = steps.at(-1).Insert;
  assert.equal(append.values.operation.Literal, 'insert');
  assert.equal(append.values.mutationDigest, 'ClientMutationDigest');
  assert.deepEqual(
    activityPlan.effectFormula,
    {
      activityInserts: 1,
      auxiliaryPointReads: 0,
      maximumApplicationWrites: 2,
      runtimeIds: 2,
      runtimeNow: 1,
      scopePatches: 0,
      scopeReads: 1,
      settlementLookups: 1,
      settlementWrites: 1,
      sourceWrites: 1,
    },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('relation/activity authoring tests passed');
