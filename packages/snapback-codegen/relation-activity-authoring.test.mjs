import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { generate, serializeMutationPlan } from './index.mjs';

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
  defineWriteWithActivity, existingOwner, insert, literal, mutationPlan, patch,
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
  const serializedGuardedPatch = serializeMutationPlan(guardedPatch.plan);
  const serializedRelationAssertion = serializedGuardedPatch.steps.find(
    (step) => step.AssertCurrentRelation,
  );
  assert.deepEqual(serializedRelationAssertion.AssertCurrentRelation, {
    table: 'tasks',
    id: { Arg: 'taskId' },
    scope_table: 'incidents',
    scope_id: { Arg: 'incidentId' },
    foreign_key_field: 'incidentId',
    incarnation_field: 'incidentIncarnation',
    else_error: 'SNAPBACK_ROW_NOT_FOUND',
  });
  const deleteSteps = guardedDelete.plan.steps;
  assert.equal(guardedDelete.writeWithActivityPlan.effectFormula.auxiliaryPointReads, 2);
  const deleteIndex = deleteSteps.findIndex((step) => step.Delete?.table === 'tasks');
  assertCurrentRelation(
    deleteSteps[deleteIndex - 1],
    deleteSteps[deleteIndex].Delete.id,
  );

  result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const publishedFunctionsText = readFileSync(
    join(dir, 'generated', 'functions.manifest.json'),
    'utf8',
  );
  const publishedFunctions = JSON.parse(publishedFunctionsText);
  const byName = new Map(publishedFunctions.functions.map((fn) => [fn.name, fn]));
  assert.deepEqual(
    byName.get('incidentTasks').requiredCapabilities,
    [
      'live_subscriptions',
      'host_plan_runtime',
      'bounded_children_v1',
      'result_contract_v1',
      'args_contract_v1',
    ],
  );
  assert.deepEqual(
    byName.get('addTask').requiredCapabilities,
    [
      'host_plan_runtime',
      'mutation_read_set_validation',
      'write_activity_v1',
      'result_contract_v1',
      'args_contract_v1',
    ],
  );
  assert.deepEqual(
    publishedFunctions.acknowledgedExperimentalCapabilities,
    ['args_contract_v1', 'bounded_children_v1', 'result_contract_v1', 'write_activity_v1'],
  );
  const guardedManifest = byName.get('addTask').runtime.HostPlan.WriteWithActivity.mutation;
  assert(
    guardedManifest.steps.some((step) => step.AssertSourceChanged),
    'the published write/activity manifest retains its host-owned source-effect assertion',
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
      'authored extra runtime id',
      profileSource.replace(
        `    position: runtimeNow(),`,
        `    position: runtimeId(),`,
      ).replace(
        `runtimeNow, throughParent`,
        `runtimeId, runtimeNow, throughParent`,
      ),
      /authored runtimeId\(\) expressions are outside the closed effect formula/u,
    ],
    [
      'authored runtime id scope',
      profileSource.replace(
        `id: arg('incidentId'),`,
        `id: runtimeId(),`,
      ).replace(
        `runtimeNow, throughParent`,
        `runtimeId, runtimeNow, throughParent`,
      ),
      /authored runtimeId\(\) expressions are outside the closed effect formula/u,
    ],
    [
      'empty source patch',
      profileSource
        .replace(
          `primary: mutationPlan(insert('tasks', {
    position: runtimeNow(),
    body: arg('body'),
  }, { bindIdAs: 'taskId' }))`,
          `primary: mutationPlan(patch('tasks', arg('taskId'), {}))`,
        )
        .replace(
          `args: { incidentId: v.id('incidents'), body: v.string() }`,
          `args: { incidentId: v.id('incidents'), taskId: v.id('tasks'), body: v.string() }`,
        )
        .replace(
          `source: { table: tasks, id: binding('taskId') }`,
          `source: { table: tasks, id: arg('taskId') }`,
        ),
      /source Patch values must be nonempty/u,
    ],
    [
      'protected incarnation provenance alias',
      profileSource.replace(
        `actualActor: 'actualActor',`,
        `actualActor: 'incidentIncarnation',`,
      ),
      /scope incarnation field is protected and may not alias a provenance mapping/u,
    ],
    [
      'missing scope owner field',
      profileSource.replace(
        `scope: existingOwner({
    table: incidents,
    id: arg('incidentId'),
    visibility: owner('ownerId'),
  }),`,
        `scope: existingOwner({
    table: incidents,
    id: arg('incidentId'),
    visibility: owner('missingOwner'),
  }),`,
      ),
      /visibility field must be a required string or principal/u,
    ],
    [
      'JSON bounded projection',
      profileSource.replace(
        `select: { id: '_id', position: 'position', body: 'body', note: 'note' }`,
        `select: { id: '_id', position: 'position', body: 'body', metadata: 'metadata' }`,
      ),
      /must be an LLP 0110 portable scalar/u,
    ],
    [
      'duplicate bounded order',
      profileSource.replace(
        `order: [asc('position')],`,
        `order: [asc('position'), asc('position')],`,
      ),
      /children\.order fields must not contain duplicates/u,
    ],
    [
      'empty bounded output name',
      profileSource.replace(
        `select: { id: '_id', position: 'position', body: 'body', note: 'note' }`,
        `select: { id: '_id', '': 'position', body: 'body', note: 'note' }`,
      ),
      /select output names must be non-empty/u,
    ],
  ]) {
    writeFileSync(join(dir, 'functions.mjs'), invalidSource);
    const invalid = await generate(dir);
    assert.equal(invalid.ok, false, `${label} unexpectedly generated`);
    assert.match(JSON.stringify(invalid.diagnostics), expected);
    assert.equal(
      readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
      publishedFunctionsText,
      `${label} must preserve the last good generation`,
    );
  }

  const ordinarySchema = readFileSync(join(dir, 'schema.mjs'), 'utf8');
  writeFileSync(
    join(dir, 'schema.mjs'),
    ordinarySchema.replace(
      `}).sync();
export default defineSchema({ incidents, tasks, activity });`,
      `}).permissionBacking().sync();
export default defineSchema({ incidents, tasks, activity });`,
    ),
  );
  writeFileSync(join(dir, 'functions.mjs'), profileSource);
  const permissionBackingActivity = await generate(dir);
  assert.equal(permissionBackingActivity.ok, false);
  assert.match(
    JSON.stringify(permissionBackingActivity.diagnostics),
    /write-with-activity requires ordinary non-permission-backing/u,
  );
  assert.equal(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
    publishedFunctionsText,
    'permission-backing profile refusal preserves the last good generation',
  );

  writeFileSync(
    join(dir, 'schema.mjs'),
    ordinarySchema.replace(`occurredAt: v.integer(),`, `occurredAt: v.boolean(),`),
  );
  const incompatibleProvenance = await generate(dir);
  assert.equal(incompatibleProvenance.ok, false);
  assert.match(
    JSON.stringify(incompatibleProvenance.diagnostics),
    /provenance occurredAt must be a required integer/u,
  );
  assert.equal(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
    publishedFunctionsText,
    'incompatible provenance refusal preserves the last good generation',
  );

  writeFileSync(
    join(dir, 'schema.mjs'),
    ordinarySchema.replace(`sourceId: v.string(),`, `sourceId: v.id('incidents'),`),
  );
  const wrongSourceIdDomain = await generate(dir);
  assert.equal(wrongSourceIdDomain.ok, false);
  assert.match(
    JSON.stringify(wrongSourceIdDomain.diagnostics),
    /provenance sourceId must be a required string or id of tasks/u,
  );

  writeFileSync(
    join(dir, 'schema.mjs'),
    ordinarySchema.replace(`grantId: v.optional(v.string()),`, `grantId: v.string(),`),
  );
  const requiredGrant = await generate(dir);
  assert.equal(requiredGrant.ok, false);
  assert.match(
    JSON.stringify(requiredGrant.diagnostics),
    /provenance grant must be an optional string/u,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log('relation/activity authoring tests passed');
