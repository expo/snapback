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
  note: v.optional(v.string()),
  metadata: v.optional(v.json()),
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
  const profileSource = `
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
    select: { id: '_id', position: 'position', body: 'body', note: 'note' },
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
  relations: [{
    table: tasks,
    scopeForeignKey: 'incidentId',
    scopeIncarnation: 'incidentIncarnation',
  }],
  primary: mutationPlan(insert('tasks', {
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
`;
  writeFileSync(join(dir, 'functions.mjs'), `
import { defineLiveQuery } from '${defineUrl}';
export const baseline = defineLiveQuery({
  table: 'incidents',
  args: {},
});
`);
  let result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const lastGoodFunctions = readFileSync(
    join(dir, 'generated', 'functions.manifest.json'),
    'utf8',
  );
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

  writeFileSync(join(dir, 'functions.mjs'), profileSource);
  const authored = await import(`${pathToFileURL(join(dir, 'functions.mjs')).href}?valid`);
  const relation = authored.incidentTasks;
  assert.equal(relation.boundedChildrenPlan.take, 25);
  assert.equal(relation.boundedChildrenPlan.childIndex, 'by_incident_position');
  assert.equal(relation.boundedChildrenPlan.requiredCapability, 'bounded_children_v1');
  const resultUnion = relation.resultContract.validator;
  assert.deepEqual(relation.resultContract.rows, { minItems: 1, maxItems: 1 });
  assert.equal(resultUnion.resultKind, 'union');
  assert.equal(resultUnion.variants.length, 2);
  assert.equal(resultUnion.variants[0].fields.kind.literal, 'absent');
  assert.equal(resultUnion.variants[0].fields.parent.resultKind, 'null');
  assert.equal(resultUnion.variants[0].fields.children.resultOptions.maxItems, 0);
  assert.equal(resultUnion.variants[0].fields.continuation.resultKind, 'null');
  assert.equal(resultUnion.variants[1].fields.kind.literal, 'visible');
  assert.equal(resultUnion.variants[1].fields.children.resultOptions.maxItems, 25);
  const optionalStored = resultUnion.variants[1].fields.children.element.fields.note;
  assert.equal(optionalStored.optional, false);
  assert.equal(optionalStored.resultKind, 'union');
  assert(optionalStored.variants.some((variant) => variant.resultKind === 'null'));

  const activityPlan = authored.addTask.writeWithActivityPlan;
  assert.equal(activityPlan.requiredCapability, 'write_activity_v1');
  assert.deepEqual(activityPlan.relations, [{
    table: 'tasks',
    scopeForeignKey: 'incidentId',
    scopeIncarnation: 'incidentIncarnation',
  }]);
  const steps = authored.addTask.plan.steps;
  assert(steps.some((step) => step.AssertSourceChanged?.operation === 'insert'));
  const sourceInsert = steps.find((step) => step.Insert?.table === 'tasks').Insert;
  assert.deepEqual(sourceInsert.values.incidentId, { __expr: true, Arg: 'incidentId' });
  assert.equal(sourceInsert.values.incidentIncarnation, undefined);
  const append = steps.at(-1).Insert;
  assert.equal(append.values.operation.Literal, 'insert');
  assert.equal(append.values.mutationDigest.kind, 'ClientMutationDigest');
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

  const defineApi = await import(`${defineUrl}?relation-guards`);
  const schemaApi = await import(`${pathToFileURL(join(dir, 'schema.mjs')).href}?relation-guards`);
  const activitySpec = {
    table: schemaApi.activity,
    visibility: defineApi.throughScope({
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
    values: { detail: defineApi.literal('guard test') },
  };
  const guardedProfile = (primary) => defineApi.defineWriteWithActivity({
    args: {
      incidentId: defineApi.v.id('incidents'),
      taskId: defineApi.v.id('tasks'),
    },
    scope: defineApi.existingOwner({
      table: schemaApi.incidents,
      id: defineApi.arg('incidentId'),
      visibility: defineApi.owner('ownerId'),
    }),
    relations: [{
      table: schemaApi.tasks,
      scopeForeignKey: 'incidentId',
      scopeIncarnation: 'incidentIncarnation',
    }],
    primary,
    source: { table: schemaApi.tasks, id: defineApi.arg('taskId') },
    activity: activitySpec,
    idempotency: defineApi.clientMutation(),
    result: defineApi.results.value(defineApi.v.id('activity')),
    returns: defineApi.binding('__activityId'),
  });
  const guardedPatch = guardedProfile(defineApi.mutationPlan(
    defineApi.get('tasks', defineApi.arg('taskId'), 'authoredTask'),
    defineApi.patch('tasks', defineApi.arg('taskId'), {
      body: defineApi.literal('patched'),
    }),
  ));
  const guardedDelete = guardedProfile(defineApi.mutationPlan(
    defineApi.del('tasks', defineApi.arg('taskId')),
  ));
  const assertCurrentRelation = (step, id) => {
    assert.deepEqual(step?.AssertCurrentRelation, {
      table: 'tasks',
      id,
      scope_table: 'incidents',
      scope_id: { __expr: true, Arg: 'incidentId' },
      foreign_key_field: 'incidentId',
      incarnation_field: 'incidentIncarnation',
      else_error: 'SNAPBACK_ROW_NOT_FOUND',
    });
  };
  const patchSteps = guardedPatch.plan.steps;
  assert.equal(guardedPatch.writeWithActivityPlan.effectFormula.auxiliaryPointReads, 4);
  for (const [index, step] of patchSteps.entries()) {
    if (step.Get?.table === 'tasks') {
      assert.equal(step.Get.else_error, 'SNAPBACK_ROW_NOT_FOUND');
      assertCurrentRelation(patchSteps[index - 1], step.Get.id);
    }
    if (step.Patch?.table === 'tasks') {
      assertCurrentRelation(patchSteps[index - 1], step.Patch.id);
    }
  }
  const deleteSteps = guardedDelete.plan.steps;
  assert.equal(guardedDelete.writeWithActivityPlan.effectFormula.auxiliaryPointReads, 2);
  const deleteIndex = deleteSteps.findIndex((step) => step.Delete?.table === 'tasks');
  assertCurrentRelation(
    deleteSteps[deleteIndex - 1],
    deleteSteps[deleteIndex].Delete.id,
  );

  result = await generate(dir);
  assert.equal(result.ok, false);
  for (const capability of ['bounded_children_v1', 'write_activity_v1']) {
    assert(result.diagnostics.some(({ code, details, message }) => (
      code === 'SNAPBACK_CAPABILITY_UNSUPPORTED'
      && (details?.capability === capability || message.includes(capability))
    )), `${capability} must remain a dedicated publication GAP while LLP 0104 is Review`);
  }
  assert.equal(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
    lastGoodFunctions,
    'a review-only capability refusal must preserve the last good generation',
  );

  const relationBlock = `  relations: [{
    table: tasks,
    scopeForeignKey: 'incidentId',
    scopeIncarnation: 'incidentIncarnation',
  }],
`;
  for (const [label, invalidSource, expected] of [
    [
      'missing relation declaration',
      profileSource.replace(relationBlock, ''),
      /relations must declare every non-scope primary table/u,
    ],
    [
      'authored cross-scope foreign key',
      profileSource.replace(
        `  primary: mutationPlan(insert('tasks', {
    position: runtimeNow(),`,
        `  primary: mutationPlan(insert('tasks', {
    incidentId: arg('incidentId'),
    position: runtimeNow(),`,
      ),
      /may not author protected relation fields/u,
    ],
    [
      'JSON bounded projection',
      profileSource.replace(
        `select: { id: '_id', position: 'position', body: 'body', note: 'note' }`,
        `select: { id: '_id', position: 'position', body: 'body', metadata: 'metadata' }`,
      ),
      /must be an LLP 0104 portable scalar/u,
    ],
  ]) {
    writeFileSync(join(dir, 'functions.mjs'), invalidSource);
    const invalid = await generate(dir);
    assert.equal(invalid.ok, false, `${label} unexpectedly generated`);
    assert.match(JSON.stringify(invalid.diagnostics), expected);
    assert.equal(
      readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
      lastGoodFunctions,
      `${label} must preserve the last good generation`,
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('relation/activity authoring tests passed');
