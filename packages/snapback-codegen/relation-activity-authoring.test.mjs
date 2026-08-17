import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  generate,
  generateInProcess,
  serializeMutationPlan,
  validateTrustedCompositionActivationV1,
} from './index.mjs';
import { canonicalJson } from './result-contracts.mjs';

const compositionHash = (domain, value) => `sha256:${createHash('sha256')
  .update(domain)
  .update(canonicalJson(value))
  .digest('hex')}`;

const packageDir = dirname(fileURLToPath(import.meta.url));
const toolchainProbeDir = mkdtempSync(join(packageDir, '.toolchain-identity-probe-'));
const toolchainProbePath = join(toolchainProbeDir, 'define-probe.mjs');
const toolchainProbeSource = `export * from '../define.mjs';\n`;
writeFileSync(toolchainProbePath, toolchainProbeSource);
const defineUrl = pathToFileURL(toolchainProbePath).href;
const dir = mkdtempSync(join(tmpdir(), 'snapback-relation-activity-'));

try {
  writeFileSync(join(dir, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '${defineUrl}';
export const incidents = defineTable({
  ownerId: v.string(),
  title: v.string(),
}).visibility({ kind: 'public-read' }).sync();
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
]).visibility({ kind: 'public-read' }).sync();
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
}).visibility({ kind: 'public-read' }).sync();
export default defineSchema({ incidents, tasks, activity });
`);
  const profileSource = `
import {
  arg, asc, binding, clientMutation, defineBoundedChildrenQuery,
  defineSnapshotBatchQuery, defineWriteWithActivity, existingOwner, insert, literal, mutationPlan, patch,
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

export const boardView = defineSnapshotBatchQuery({
  nodes: [incidentTasks, incidentTasks, incidentTasks],
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

  const snapshot = authored.boardView;
  assert.equal(snapshot.snapshotBatchPlan.profile, 'snapshot-batch.v1');
  assert.equal(snapshot.snapshotBatchPlan.nodes.length, 3);
  assert.equal(snapshot.args.cursor.resultOptions.maxBytes, 8_192);
  const snapshotVisible = snapshot.resultContract.validator.variants[1];
  assert.equal(snapshotVisible.fields.nodes.resultKind, 'tuple');
  assert.equal(snapshotVisible.fields.nodes.elements.length, 3);
  result = await generate(dir);
  assert.equal(result.ok, true, JSON.stringify(result.diagnostics));
  const generatedFunctions = JSON.parse(
    readFileSync(join(dir, 'generated', 'functions.manifest.json'), 'utf8'),
  );
  const generatedSnapshot = generatedFunctions.functions.find((fn) => fn.name === 'boardView');
  assert.equal(generatedSnapshot.runtime.HostPlan.SnapshotBatch.profile, 'snapshot-batch.v1');
  assert.equal(generatedSnapshot.runtime.HostPlan.SnapshotBatch.normalizedCompositePlan.format,
    'snapback.normalized-composite-plan.v1');
  assert.match(generatedSnapshot.runtime.HostPlan.SnapshotBatch.planHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(
    generatedSnapshot.runtime.HostPlan.SnapshotBatch.planHash,
    'sha256:46f823237e192428ce488c6f7a993c4569097a3f036bfd8f7325437e38ed2c0e',
    'PlanHashV1 stays byte-identical to the Rust reconstruction vector',
  );
  assert.equal(
    generatedSnapshot.runtime.HostPlan.SnapshotBatch.normalizedCompositePlan
      .parentAuthorizationGroups[0].keyJcsBase64url,
    'eyJmb3JtYXQiOiJzbmFwYmFjay5wYXJlbnQtYXV0aG9yaXphdGlvbi1rZXkudjEiLCJwYXJlbnRJZEFyZ3VtZW50IjoiaW5jaWRlbnRJZCIsInBhcmVudElkVHlwZSI6eyJraW5kIjoiaWQiLCJ0YWJsZSI6ImluY2lkZW50cyJ9LCJwYXJlbnRUYWJsZSI6ImluY2lkZW50cyIsInZpc2liaWxpdHkiOnsiZmllbGQiOiJvd25lcklkIiwia2luZCI6Im93bmVyLnYxIn19',
    'ParentAuthorizationKeyV1 JCS bytes are pinned cross-language',
  );
  assert.equal(generatedSnapshot.resultContract.record.variants[1].fields[1].value.kind, 'tuple');
  assert(generatedSnapshot.requiredCapabilities.includes('snapshot_batch_v1'));
  assert(generatedFunctions.acknowledgedExperimentalCapabilities.includes('snapshot_batch_v1'));
  const firstApi = await import(`${pathToFileURL(join(dir, 'generated', 'api.mjs')).href}?composition`);
  assert.equal(firstApi.api.incidentTasks.composition.normalizedCompositePlan.profileId, 'single-node.v1');
  assert.match(firstApi.api.incidentTasks.composition.planHash, /^sha256:[0-9a-f]{64}$/u);
  assert.equal(firstApi.api.boardView.composition.planHash, generatedSnapshot.runtime.HostPlan.SnapshotBatch.planHash);

  const proofKeys = {
    format: 'snapback.completeness-proof-keys.v1',
    keys: [{
      proofKeyId: 'fixture-key',
      algorithm: 'Ed25519',
      publicKeyBase64url: '6kpsY-KcUgq-9VB7Ey7F-ZVHdq6-vnuSQh7qaRRG0iw',
    }],
  };
  const activation = {
    format: 'snapback.composition-activation.v1',
    databaseId: 'database-fixture',
    deploymentId: 'deployment-fixture',
    targetProfileId: 'local-dev-sqlite-ibex',
    authMode: 'dev',
    expectedGeneration: {
      schemaVersion: result.schemaManifest.schemaVersion,
      appId: result.schemaManifest.appId,
      schemaHash: result.schemaManifest.schemaHash,
      bundleHash: result.functionManifest.bundleHash,
      inputsHash: result.functionManifest.inputsHash,
    },
    proofKeyManifestDigest: compositionHash('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedActivation = {
    format: 'snapback.trusted-composition-activation.v1',
    activation,
    activationHash: compositionHash('snapback:composition-activation:v1:', activation),
    proofKeys,
  };
  writeFileSync(
    join(dir, 'trusted-composition-activation.json'),
    `${JSON.stringify(trustedActivation, null, 2)}\n`,
  );
  const activated = await generate(dir);
  assert.equal(activated.ok, true, JSON.stringify(activated.diagnostics));
  assert.equal(activated.inputsHash, result.inputsHash, 'activation source must not create a recursive generation hash');
  assert.deepEqual(
    JSON.parse(readFileSync(join(dir, 'generated', 'trusted-composition-activation.json'), 'utf8')),
    trustedActivation,
  );
  assert(activated.artifactIndex.artifacts.includes('trusted-composition-activation.json'));
  const generatedPackage = JSON.parse(readFileSync(join(dir, 'generated', 'package.json'), 'utf8'));
  assert.equal(
    generatedPackage.exports['./trusted-composition-activation'],
    './trusted-composition-activation.json',
  );
  const activatedApi = await import(
    `${pathToFileURL(join(dir, 'generated', 'api.mjs')).href}?trusted-activation`,
  );
  assert.deepEqual(activatedApi.artifacts.trustedCompositionActivation, trustedActivation);
  assert.equal(
    activatedApi.api.incidentTasks.artifacts,
    activatedApi.artifacts,
    'direct generated references ride the same immutable application artifact graph',
  );
  assert.equal(
    Object.keys(activatedApi.api.incidentTasks).includes('artifacts'),
    false,
    'the trust root does not enter structured registration DTOs',
  );
  assert.deepEqual(
    activatedApi.api.incidentTasks.composition.resultContract,
    generatedFunctions.functions.find((fn) => fn.name === 'incidentTasks').resultContract,
  );
  assert.equal(Object.isFrozen(activatedApi.artifacts.trustedCompositionActivation), true);
  assert.equal(Object.isFrozen(activatedApi.api.incidentTasks.composition), true);

  // @ref LLP 0157#amendment--2026-08-10-toolchain-stable-activation-identity-ruled
  // — a toolchain-only isolated-evaluation rotation advances provenance
  // without invalidating a v2 authored-byte ceremony; authored edits still
  // refuse, and all closed-root/proof-key checks remain in force.
  const v2Identity = {
    format: 'snapback.composition-activation.v2',
    databaseId: 'database-fixture',
    deploymentId: 'deployment-fixture-v2',
    targetProfileId: 'local-dev-sqlite-ibex',
    authMode: 'dev',
    authoredSourceHash: result.authoredSourceHash,
    mintedGeneration: activation.expectedGeneration,
    proofKeyManifestDigest: compositionHash('snapback:completeness-proof-keys:v1:', proofKeys),
  };
  const trustedV2 = {
    format: 'snapback.trusted-composition-activation.v1',
    activation: v2Identity,
    activationHash: compositionHash('snapback:composition-activation:v2:', v2Identity),
    proofKeys,
  };
  const v2Context = {
    expectedGeneration: activation.expectedGeneration,
    authoredSourceHash: result.authoredSourceHash,
    targetProfileId: 'local-dev-sqlite-ibex',
    authMode: 'dev',
  };
  assert.equal(validateTrustedCompositionActivationV1(trustedV2, v2Context), trustedV2);
  assert.throws(
    () => validateTrustedCompositionActivationV1({ ...trustedV2, unexpected: true }, v2Context),
    /invalid closed root record/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      activation: { ...v2Identity, unexpected: true },
    }, v2Context),
    /does not bind this generated deployment/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      proofKeys: {
        ...proofKeys,
        keys: [{ ...proofKeys.keys[0], publicKeyBase64url: 'not-canonical' }],
      },
    }, v2Context),
    /public key is not canonical/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      proofKeys: { ...proofKeys, keys: [] },
    }, v2Context),
    /invalid proof-key manifest/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      proofKeys: {
        ...proofKeys,
        keys: [{ ...proofKeys.keys[0], unexpected: true }],
      },
    }, v2Context),
    /proof keys are not closed/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      proofKeys: {
        ...proofKeys,
        keys: [proofKeys.keys[0], proofKeys.keys[0]],
      },
    }, v2Context),
    /proof keys are not closed/u,
  );
  const wrongProofDigestIdentity = {
    ...v2Identity,
    proofKeyManifestDigest: `sha256:${'0'.repeat(64)}`,
  };
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      activation: wrongProofDigestIdentity,
      activationHash: compositionHash(
        'snapback:composition-activation:v2:',
        wrongProofDigestIdentity,
      ),
    }, v2Context),
    /proof-key manifest digest does not reproduce/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      activationHash: `sha256:${'0'.repeat(64)}`,
    }, v2Context),
    /activation hash does not reproduce/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      activation: {
        ...v2Identity,
        mintedGeneration: { ...v2Identity.mintedGeneration, unexpected: true },
      },
    }, v2Context),
    /does not bind this generated deployment/u,
  );
  assert.throws(
    () => validateTrustedCompositionActivationV1({
      ...trustedV2,
      activation: { ...v2Identity, format: 'snapback.composition-activation.v3' },
    }, v2Context),
    /does not bind this generated deployment/u,
  );

  writeFileSync(
    join(dir, 'trusted-composition-activation.json'),
    `${JSON.stringify(trustedV2, null, 2)}\n`,
  );
  const v2Current = await generate(dir);
  assert.equal(v2Current.ok, true, JSON.stringify(v2Current.diagnostics));
  assert.equal(v2Current.artifactIndex.activationGenerationAdvanced, undefined);
  assert.equal(v2Current.schemaManifest.authoredSourceHash, result.authoredSourceHash);
  assert.equal(v2Current.functionManifest.authoredSourceHash, result.authoredSourceHash);
  assert.equal(v2Current.contractManifest.authoredSourceHash, result.authoredSourceHash);
  assert.equal(
    v2Current.providerIntrospection.source.authoredSourceHash,
    result.authoredSourceHash,
  );
  const rotated = await generateInProcess(dir, {}, {
    identity: { isolatedEvaluationSuffix: '\ntoolchain-rotation-fixture' },
  });
  assert.equal(rotated.ok, true, JSON.stringify(rotated.diagnostics));
  assert.equal(rotated.authoredSourceHash, result.authoredSourceHash);
  assert.notDeepEqual(
    rotated.artifactIndex.activationGenerationAdvanced.current,
    activation.expectedGeneration,
  );
  assert.deepEqual(rotated.artifactIndex.activationGenerationAdvanced, {
    minted: activation.expectedGeneration,
    current: {
      schemaVersion: rotated.schemaManifest.schemaVersion,
      appId: rotated.schemaManifest.appId,
      schemaHash: rotated.schemaManifest.schemaHash,
      bundleHash: rotated.functionManifest.bundleHash,
      inputsHash: rotated.functionManifest.inputsHash,
    },
    at: rotated.schemaManifest.generatedAt,
  });
  assert.equal(
    rotated.appDescriptor.api.queries.incidentTasks.authoredSourceHash,
    result.authoredSourceHash,
  );

  writeFileSync(toolchainProbePath, `${toolchainProbeSource}// toolchain-byte-edit\n`);
  const sourceRotated = await generateInProcess(dir);
  assert.equal(sourceRotated.ok, true, JSON.stringify(sourceRotated.diagnostics));
  assert.equal(sourceRotated.authoredSourceHash, result.authoredSourceHash);
  assert.notEqual(
    sourceRotated.functionManifest.inputsHash,
    v2Current.functionManifest.inputsHash,
    'toolchain source bytes remain part of the generated-artifact staleness identity',
  );
  writeFileSync(toolchainProbePath, toolchainProbeSource);

  writeFileSync(join(dir, 'functions.mjs'), `${profileSource}\n// authored-byte-edit\n`);
  const edited = await generate(dir);
  assert.equal(edited.ok, false);
  assert(edited.diagnostics.some(({ code }) => code === 'TRUSTED_COMPOSITION_ACTIVATION_INVALID'));
  writeFileSync(join(dir, 'functions.mjs'), profileSource);

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
      sequenceAllocations: 0,
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
  const guardedSequence = guardedProfile(defineApi.mutationPlan(
    defineApi.patch('tasks', defineApi.arg('taskId'), {
      position: defineApi.binding('position'),
    }),
    defineApi.allocateSequence(
      'taskPositions',
      defineApi.arg('incidentId'),
      'position',
    ),
  ));
  assert.equal(
    guardedSequence.plan.steps[0].Get.else_error,
    'SNAPBACK_RELATION_PARENT_UNAVAILABLE',
  );
  assert.equal(
    guardedSequence.plan.steps[1].Guard.else_error,
    'SNAPBACK_RELATION_PARENT_UNAVAILABLE',
  );
  assert.deepEqual(guardedSequence.plan.steps[2], {
    AllocateSequence: {
      counter: 'taskPositions',
      scope: { __expr: true, Arg: 'incidentId' },
      into: 'position',
    },
  });
  assert.deepEqual(guardedSequence.sequences, [{
    name: 'taskPositions',
    scopeTable: 'incidents',
    scopeAccess: { kind: 'existing-owner.v1', ownerField: 'ownerId' },
  }]);
  assert.equal(guardedSequence.writeWithActivityPlan.effectFormula.sequenceAllocations, 1);
  assert.deepEqual(
    serializeMutationPlan(guardedSequence.plan).steps[2],
    {
      AllocateSequence: {
        counter: 'taskPositions',
        scope: { Arg: 'incidentId' },
        into: 'position',
      },
    },
  );
  assert.throws(
    () => guardedProfile(defineApi.mutationPlan(
      defineApi.letBind('position', defineApi.literal(1)),
      defineApi.patch('tasks', defineApi.arg('taskId'), {
        body: defineApi.literal('collision'),
      }),
      defineApi.allocateSequence(
        'taskPositions',
        defineApi.arg('incidentId'),
        'position',
      ),
    )),
    /primary binding position is declared more than once/u,
  );
  const legacyShadowing = guardedProfile(defineApi.mutationPlan(
    defineApi.letBind('legacy-shadow', defineApi.literal(1)),
    defineApi.letBind('legacy-shadow', defineApi.literal(2)),
    defineApi.patch('tasks', defineApi.arg('taskId'), {
      body: defineApi.literal('shadow-compatible'),
    }),
  ));
  assert.equal(
    legacyShadowing.plan.steps.filter((step) => step.Let?.bind_as === 'legacy-shadow').length,
    2,
    'non-sequence WWA preserves legacy binding shadowing',
  );
  const sequenceWithLegacyShadowing = guardedProfile(defineApi.mutationPlan(
    defineApi.letBind('legacy-shadow', defineApi.literal(1)),
    defineApi.letBind('legacy-shadow', defineApi.literal(2)),
    defineApi.patch('tasks', defineApi.arg('taskId'), {
      position: defineApi.binding('position'),
    }),
    defineApi.allocateSequence(
      'taskPositions',
      defineApi.arg('incidentId'),
      'position',
    ),
  ));
  assert.equal(
    sequenceWithLegacyShadowing.plan.steps
      .filter((step) => step.Let?.bind_as === 'legacy-shadow').length,
    2,
    'sequence WWA rejects only collisions involving the allocation binding',
  );
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
    byName.get('boardView').requiredCapabilities,
    [
      'live_subscriptions',
      'host_plan_runtime',
      'snapshot_batch_v1',
      'bounded_children_v1',
      'result_contract_v1',
      'args_contract_v1',
    ],
  );
  assert.deepEqual(
    publishedFunctions.acknowledgedExperimentalCapabilities,
    ['args_contract_v1', 'bounded_children_v1', 'result_contract_v1', 'snapshot_batch_v1', 'write_activity_v1'],
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
  rmSync(toolchainProbeDir, { recursive: true, force: true });
}

console.log('relation/activity authoring tests passed');
