import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '@expo/snapback-contract/auth-coordinator';

import { BROWSER_IR_LOCAL_EFFECT_CLASS } from './ir-evaluator.mjs';
import { SnapbackClient as InspectingSnapbackClient } from './index.mjs';
import { hex, jcsBytes, sha256 } from './rqs.mjs';
import { createFileRqsResumeStore } from './rqs-store-file.mjs';
import { rewriteOptimisticLayerIdsV1 } from './settlement-id-resolution.mjs';

class SnapbackClient extends InspectingSnapbackClient {
  constructor(baseUrl, options = {}) {
    super(baseUrl, {
      __offlineMutationReplayCapability: true,
      // Restart/replay assertions own the settlement cut explicitly. The
      // ordinary lifecycle is qualified elsewhere and must not race them.
      __outboxDrainLifecycle: false,
      ...options,
    });
  }
}

const deferred = () => {
  let resolve;
  const promise = new Promise((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
};

class DelayedRebaseSnapbackClient extends SnapbackClient {
  constructor(baseUrl, options, rebaseControl) {
    super(baseUrl, options);
    this.rebaseControl = rebaseControl;
  }

  async __createGeneratedOptimisticMaterializationView(options) {
    const view = await super.__createGeneratedOptimisticMaterializationView(options);
    if (view === null) return null;
    return Object.freeze({
      ...view,
      rebase: async (input = {}) => {
        const outcome = await view.rebase(input);
        if (
          this.rebaseControl.armed
          && input.cause === 'authoritative-delivery'
        ) {
          this.rebaseControl.armed = false;
          this.rebaseControl.didStart = true;
          try {
            await this.rebaseControl.release.promise;
            if (this.rebaseControl.outcome === 'failure') {
              throw new Error('delayed optimistic rebase failed after quarantine');
            }
          } finally {
            this.rebaseControl.didFinish = true;
          }
        }
        return outcome;
      },
    });
  }
}

const digest = (character) => `sha256:${character.repeat(64)}`;
const encoder = new TextEncoder();
const concat = (...parts) => {
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
};
const hashRecord = (domain, value) => (
  `sha256:${hex(sha256(concat(encoder.encode(domain), jcsBytes(value))))}`
);
const STORE_ID = 'generated-optimistic-default-store';
const GENERATED_ORIGIN = 'https://generated-optimistic-default.test';
const TARGET_PROFILE_ID = 'generated-optimistic-default-profile';
const ACTIVATION = Object.freeze({
  schemaVersion: 'snapback.v1',
  appId: 'generated-optimistic-default-test',
  schemaHash: digest('1'),
  bundleHash: digest('2'),
  inputsHash: digest('3'),
});
const SCHEMA = Object.freeze({
  tables: Object.freeze([
    Object.freeze({
      name: 'cards',
      fields: Object.freeze(['title', 'position', 'archived', 'locked', 'parentId'].map(
        (name) => Object.freeze({ name }),
      )),
    }),
    Object.freeze({
      name: 'labels',
      fields: Object.freeze(['name'].map((name) => Object.freeze({ name }))),
    }),
    Object.freeze({
      name: 'audit',
      fields: Object.freeze(['cardId', 'message'].map((name) => Object.freeze({ name }))),
    }),
  ]),
});
const QUERY_RESULT = Object.freeze({
  kind: 'documents',
  table: 'cards',
  document: Object.freeze({
    fields: Object.freeze(['_id', 'archived', 'locked', 'parentId', 'position', 'title'].map(
      (name) => Object.freeze({ name }),
    )),
  }),
});
const queryReference = ({ filtered = false } = {}) => {
  const nodePlan = Object.freeze({
    format: 'snapback.node-plan.v1',
    classId: 'single_table_v1',
    classVersion: 1,
    normalizedPlan: Object.freeze({
      format: 'snapback.single-table-plan.v1',
      query: Object.freeze({
        table: 'cards',
        filters: Object.freeze(filtered ? [Object.freeze({ field: 'archived' })] : []),
        membershipFilters: Object.freeze([]),
        limit: null,
      }),
    }),
  });
  const normalizedCompositePlan = Object.freeze({
    format: 'snapback.normalized-composite-plan.v1',
    profileId: 'single-node.v1',
    nodes: Object.freeze([Object.freeze({
      position: 0,
      nodePlanHash: hashRecord('snapback:node-plan:v1:', nodePlan),
      nodePlan,
    })]),
    classification: Object.freeze({ retention: 'none' }),
  });
  return Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v1',
  appId: ACTIVATION.appId,
  id: `${ACTIVATION.appId}:${filtered ? 'filteredCards' : 'listCards'}`,
  name: filtered ? 'filteredCards' : 'listCards',
  kind: 'LiveQuery',
  implementationHash: digest('6'),
  argsContractHash: digest('7'),
  resultContractHash: digest('5'),
  expectedGeneration: ACTIVATION,
  argumentSchema: Object.freeze({
    type: 'object', additionalProperties: false, properties: Object.freeze({}),
  }),
  composition: Object.freeze({
    planHash: hashRecord('snapback:plan-hash:v1:', normalizedCompositePlan),
    normalizedCompositePlan,
    resultContract: QUERY_RESULT,
  }),
  artifacts: Object.freeze({
    trustedCompositionActivation: Object.freeze({
      format: 'snapback.trusted-composition-activation.v1',
      activation: Object.freeze({
        format: 'snapback.composition-activation.v1',
        databaseId: 'generated-optimistic-default-db',
        deploymentId: 'generated-optimistic-default-deployment',
        targetProfileId: 'local-dev-sqlite-ibex',
        authMode: 'dev',
        expectedGeneration: ACTIVATION,
        proofKeyManifestDigest: digest('c'),
      }),
      activationHash: digest('d'),
      proofKeys: Object.freeze({
        format: 'snapback.completeness-proof-keys.v1',
        keys: Object.freeze([]),
      }),
    }),
  }),
  });
};
const QUERY = queryReference();
const FILTERED_QUERY = queryReference({ filtered: true });

const ARGUMENT_PROPERTIES = Object.freeze({
  id: Object.freeze({ type: 'string' }),
  title: Object.freeze({ type: 'string' }),
  position: Object.freeze({ type: 'integer' }),
  parentId: Object.freeze({ type: 'string' }),
});
const ARGUMENT_CONTRACT_VALUES = Object.freeze({
  id: Object.freeze({ kind: 'id', table: 'cards' }),
  title: Object.freeze({ kind: 'string', maxBytes: 65_536 }),
  position: Object.freeze({ kind: 'integer', min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER }),
  parentId: Object.freeze({ kind: 'id', table: 'cards' }),
});

const mutationReference = (name, plan, {
  required = [],
  declaredReads = [],
  localReadRequirements = [],
  mintSites = [],
  capabilityClass = 'local-executable',
} = {}) => Object.freeze({
  artifactKind: 'functionReference',
  schemaVersion: 'snapback.v1',
  appId: ACTIVATION.appId,
  id: `${ACTIVATION.appId}:${name}`,
  name,
  kind: 'Mutation',
  implementationHash: digest(name.charCodeAt(0).toString(16).slice(-1)),
  argsContractHash: digest('9'),
  argsContract: Object.freeze({
    fields: Object.freeze(Object.entries(ARGUMENT_CONTRACT_VALUES).map(([fieldName, value]) => (
      Object.freeze({ name: fieldName, required: required.includes(fieldName), value })
    ))),
  }),
  resultContractHash: digest('a'),
  expectedGeneration: ACTIVATION,
  argumentSchema: Object.freeze({
    type: 'object',
    additionalProperties: false,
    properties: ARGUMENT_PROPERTIES,
    required: Object.freeze(required),
  }),
  mutationIr: Object.freeze({
    format: 'snapback.generated-mutation-ir.v1',
    operationHash: digest(name.charCodeAt(name.length - 1).toString(16).slice(-1)),
    sourceIdentity: Object.freeze({
      functionId: `${ACTIVATION.appId}:${name}`,
      implementationHash: digest(name.charCodeAt(0).toString(16).slice(-1)),
      activation: ACTIVATION,
    }),
    schemaIdentity: Object.freeze({
      schemaVersion: ACTIVATION.schemaVersion,
      appId: ACTIVATION.appId,
      schemaHash: ACTIVATION.schemaHash,
    }),
    capabilityClass,
    capabilityCode: capabilityClass === 'local-executable'
      ? 'SNAPBACK_GENERATED_IR_LOCAL_EXECUTABLE'
      : 'SNAPBACK_GENERATED_IR_SERVER_ONLY',
    declaredEffectClass: BROWSER_IR_LOCAL_EFFECT_CLASS,
    declaredReads: Object.freeze(declaredReads),
    localReadRequirements: Object.freeze(localReadRequirements),
    schema: SCHEMA,
    plan: Object.freeze(plan),
    mintSites: Object.freeze(mintSites),
    usesRuntimeNow: false,
    boundedSkew: null,
  }),
});

const pointRead = (requiredFields = ['_id']) => Object.freeze([Object.freeze({
  kind: 'point',
  table: 'cards',
  idArg: 'id',
  binding: 'card',
  requiredFields: Object.freeze(requiredFields),
})]);

const getCard = Object.freeze({ Get: Object.freeze({
  table: 'cards', id: Object.freeze({ Arg: 'id' }),
  bind_as: 'card', else_error: 'CARD_NOT_FOUND',
}) });

const CREATE = mutationReference('createCard', {
  steps: Object.freeze([Object.freeze({ Insert: Object.freeze({
    table: 'cards',
    values: Object.freeze({
      title: Object.freeze({ Arg: 'title' }),
      position: Object.freeze({ Arg: 'position' }),
      archived: Object.freeze({ Literal: false }),
      locked: Object.freeze({ Literal: false }),
    }),
    bind_id_as: 'cardId',
  }) })]),
  return_value: Object.freeze({ Binding: 'cardId' }),
}, {
  required: ['title', 'position'],
  mintSites: ['plan/steps/0/insert/row-id'],
});

const patchMutation = (name, field, expression, required) => mutationReference(name, {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Patch: Object.freeze({
      table: 'cards',
      id: Object.freeze({ Arg: 'id' }),
      values: Object.freeze({ [field]: Object.freeze(expression) }),
    }) }),
  ]),
  return_value: 'ChangedCount',
}, {
  required: ['id', ...required],
  declaredReads: ['cards'],
  localReadRequirements: pointRead(),
});

const EDIT = patchMutation('editCard', 'title', { Arg: 'title' }, ['title']);
const ARCHIVE = patchMutation('archiveCard', 'archived', { Literal: true }, []);
const REORDER = patchMutation('reorderCard', 'position', { Arg: 'position' }, ['position']);
const DELETE = mutationReference('deleteCard', {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Delete: Object.freeze({
      table: 'cards', id: Object.freeze({ Arg: 'id' }),
    }) }),
  ]),
  return_value: 'ChangedCount',
}, {
  required: ['id'],
  declaredReads: ['cards'],
  localReadRequirements: pointRead(),
});

const INCOMPLETE = mutationReference('editSecretCard', {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Patch: Object.freeze({
      table: 'cards', id: Object.freeze({ Arg: 'id' }),
      values: Object.freeze({ title: Object.freeze({ Arg: 'title' }) }),
    }) }),
  ]),
  return_value: 'ChangedCount',
}, {
  required: ['id', 'title'],
  declaredReads: ['cards'],
  localReadRequirements: pointRead(['_id', 'secret']),
});

const SERVER_ONLY = mutationReference('serverOnlyCard', { steps: [], return_value: null }, {
  required: ['id'],
  capabilityClass: 'server-only',
});

const CREATE_LABEL = mutationReference('createLabel', {
  steps: Object.freeze([Object.freeze({ Insert: Object.freeze({
    table: 'labels',
    values: Object.freeze({ name: Object.freeze({ Arg: 'title' }) }),
    bind_id_as: 'labelId',
  }) })]),
  return_value: Object.freeze({ Binding: 'labelId' }),
}, {
  required: ['title'],
  mintSites: ['plan/steps/0/insert/row-id'],
});

const PATCH_AND_AUDIT = mutationReference('patchCardAndAudit', {
  steps: Object.freeze([
    getCard,
    Object.freeze({ Patch: Object.freeze({
      table: 'cards', id: Object.freeze({ Arg: 'id' }),
      values: Object.freeze({ title: Object.freeze({ Arg: 'title' }) }),
    }) }),
    Object.freeze({ Insert: Object.freeze({
      table: 'audit',
      values: Object.freeze({
        cardId: Object.freeze({ Arg: 'id' }),
        message: Object.freeze({ Literal: 'patched' }),
      }),
      bind_id_as: 'auditId',
    }) }),
  ]),
  return_value: 'ChangedCount',
}, {
  required: ['id', 'title'],
  declaredReads: ['cards'],
  localReadRequirements: pointRead(),
  mintSites: ['plan/steps/2/insert/row-id'],
});

const CREATE_CHILD = mutationReference('createChildCard', {
  steps: Object.freeze([Object.freeze({ Insert: Object.freeze({
    table: 'cards',
    values: Object.freeze({
      title: Object.freeze({ Arg: 'title' }),
      position: Object.freeze({ Arg: 'position' }),
      archived: Object.freeze({ Literal: false }),
      locked: Object.freeze({ Literal: false }),
      parentId: Object.freeze({ Arg: 'parentId' }),
    }),
    bind_id_as: 'cardId',
  }) })]),
  return_value: Object.freeze({ Binding: 'cardId' }),
}, {
  required: ['title', 'position', 'parentId'],
  mintSites: ['plan/steps/0/insert/row-id'],
});

const CREATE_SELF_PARENT_AFTER_ABSENT_PATCH = mutationReference(
  'createSelfParentAfterAbsentPatch',
  {
    steps: Object.freeze([
      Object.freeze({ Insert: Object.freeze({
        table: 'cards',
        values: Object.freeze({
          title: Object.freeze({ Arg: 'title' }),
          position: Object.freeze({ Arg: 'position' }),
          archived: Object.freeze({ Literal: false }),
          locked: Object.freeze({ Literal: false }),
          parentId: Object.freeze({ Literal: null }),
        }),
        bind_id_as: 'cardId',
      }) }),
      Object.freeze({ Patch: Object.freeze({
        table: 'cards',
        id: Object.freeze({ Arg: 'parentId' }),
        values: Object.freeze({ parentId: Object.freeze({ Literal: null }) }),
      }) }),
      Object.freeze({ Patch: Object.freeze({
        table: 'cards',
        id: Object.freeze({ Arg: 'id' }),
        values: Object.freeze({ parentId: Object.freeze({ Binding: 'cardId' }) }),
      }) }),
    ]),
    return_value: Object.freeze({ Binding: 'cardId' }),
  },
  {
    required: ['id', 'parentId', 'title', 'position'],
    declaredReads: ['cards'],
    localReadRequirements: [
      Object.freeze({
        kind: 'point', table: 'cards', idArg: 'parentId', binding: null, requiredFields: ['_id'],
      }),
      Object.freeze({
        kind: 'point', table: 'cards', idArg: 'id', binding: null, requiredFields: ['_id'],
      }),
    ],
    mintSites: ['plan/steps/0/insert/row-id'],
  },
);

const CROSS_TABLE_CREATE = mutationReference('createCardFromLabel', {
  steps: Object.freeze([
    Object.freeze({ Get: Object.freeze({
      table: 'labels', id: Object.freeze({ Arg: 'id' }),
      bind_as: 'label', else_error: 'LABEL_NOT_FOUND',
    }) }),
    Object.freeze({ Insert: Object.freeze({
      table: 'cards',
      values: Object.freeze({
        title: Object.freeze({ Field: Object.freeze({ binding: 'label', field: 'name' }) }),
        position: Object.freeze({ Arg: 'position' }),
        archived: Object.freeze({ Literal: false }),
        locked: Object.freeze({ Literal: false }),
      }),
      bind_id_as: 'cardId',
    }) }),
  ]),
  return_value: Object.freeze({ Binding: 'cardId' }),
}, {
  required: ['id', 'position'],
  declaredReads: ['labels'],
  localReadRequirements: [Object.freeze({
    kind: 'point', table: 'labels', idArg: 'id', binding: 'label', requiredFields: ['_id', 'name'],
  })],
  mintSites: ['plan/steps/1/insert/row-id'],
});

const BASE_ROWS = Object.freeze([
  Object.freeze({ _id: 'card-1', title: 'One', position: 0, archived: false, locked: false }),
  Object.freeze({ _id: 'card-2', title: 'Two', position: 1, archived: false, locked: false }),
]);

const waitUntil = async (predicate, label = 'condition') => {
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  assert.fail(`${label} did not become true`);
};

const openStore = (directory) => createFileRqsResumeStore({
  directory,
  clientStoreId: STORE_ID,
});

const installProjectionTarget = async (store, origin = GENERATED_ORIGIN) => {
  const observation = await store.beginOfflineMutationReplayCapabilityObservation();
  await store.commitOfflineMutationReplayCapabilityFact({
    schemaVersion: 'snapback.offline-mutation-replay-capability-fact.v1',
    origin,
    supported: true,
    reason: null,
    targetProfileId: TARGET_PROFILE_ID,
    artifactGeneration: ACTIVATION,
  }, observation);
};

const openHost = async (store, rows = BASE_ROWS, query = QUERY, {
  clientOptions = {},
  installReplayProjectionTarget = true,
  snapshot = null,
  onAuthorizationBoundary = null,
} = {}) => {
  if (installReplayProjectionTarget) await installProjectionTarget(store);
  const client = new SnapbackClient(GENERATED_ORIGIN, {
    rqsStore: store,
    offlineQueue: true,
    ...clientOptions,
  });
  client.authSession = async () => Object.freeze({
    activeMode: 'dev',
    clientProtocols: Object.freeze({}),
    availability: Object.freeze({ retainedReads: Object.freeze({ available: false }) }),
  });
  client.currentAuthorizationScope = async () => Object.freeze({
    principalScope: Object.freeze({
      authMode: 'dev',
      authorizationStreamIncarnation: 'generated-optimistic-default-incarnation',
      userId: null,
    }),
    authorityDescriptor: Object.freeze({
      descriptorVersion: 1,
      authorityInstanceId: 'generated-optimistic-default-authority',
      sessionGeneration: 1,
    }),
  });
  let subscriptionSequence = 0;
  client.subscribeLive = async () => {
    subscriptionSequence += 1;
    return {
      subscription_id: `generated-optimistic-cards-${subscriptionSequence}`,
      snapshot: structuredClone(snapshot?.() ?? { rows, version: 1 }),
    };
  };
  client.unsubscribeLive = async () => ({ disposed: true });
  const updates = [];
  const handle = await client.liveQuery(query, {
    connectionId: 'generated-optimistic-default',
    onAuthorizationBoundary,
    onUpdate: (nextRows, detail) => updates.push({ rows: nextRows, detail }),
  });
  return { client, handle, updates, get subscriptionSequence() { return subscriptionSequence; } };
};

test('headless process-local generated mutations paint without durable replay facts', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-paint-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const { client, handle } = await openHost(store, BASE_ROWS, QUERY, {
    clientOptions: { offlineQueue: false },
    installReplayProjectionTarget: false,
  });

  let releaseResponses;
  const responses = new Promise((resolve) => { releaseResponses = resolve; });
  globalThis.fetch = async () => {
    await responses;
    return Response.json({ result: true, version: 2 });
  };

  const pending = [];
  pending.push(client.mutate(CREATE, { args: { title: 'Created', position: 2 } }));
  await waitUntil(() => handle.rows.length === 3, 'generated create paint');
  const provisional = handle.rows.find((row) => row.title === 'Created');
  assert.match(provisional._id, /^id_/u);

  pending.push(client.mutate(EDIT, { args: { id: 'card-1', title: 'Edited' } }));
  await waitUntil(
    () => handle.rows.find((row) => row._id === 'card-1')?.title === 'Edited',
    'generated edit paint',
  );

  pending.push(client.mutate(ARCHIVE, { args: { id: 'card-2' } }));
  await waitUntil(
    () => handle.rows.find((row) => row._id === 'card-2')?.archived === true,
    'generated archive paint',
  );

  pending.push(client.mutate(REORDER, { args: { id: 'card-1', position: 9 } }));
  await waitUntil(
    () => handle.rows.find((row) => row._id === 'card-1')?.position === 9,
    'generated reorder paint',
  );

  pending.push(client.mutate(DELETE, { args: { id: 'card-2' } }));
  await waitUntil(
    () => !handle.rows.some((row) => row._id === 'card-2'),
    'generated delete paint',
  );
  assert.equal(handle.optimisticPresentation.status, 'predicted');
  assert.equal(handle.freshness, 'current');
  assert.equal(handle.answerClass, 'optimistic');
  assert.deepEqual(handle.authoritativeRows, BASE_ROWS);

  releaseResponses();
  await Promise.all(pending);
  await handle.dispose();
  await store.close();
});

test('headless missing reads and server-only IR stay inspectable pending without prediction', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-pending-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const { client, handle } = await openHost(store);

  let releaseResponses;
  const responses = new Promise((resolve) => { releaseResponses = resolve; });
  globalThis.fetch = async () => {
    await responses;
    return Response.json({ result: true, version: 2 });
  };
  const incompleteId = 'mutation-incomplete-read';
  const incomplete = client.mutate(INCOMPLETE, {
    clientMutationId: incompleteId,
    args: { id: 'card-1', title: 'Must not paint' },
  });
  await waitUntil(
    () => handle.optimisticPresentation.queuedOnly.some(
      (entry) => entry.clientMutationId === incompleteId,
    ),
    'incomplete read pending inspection',
  );
  assert.deepEqual(handle.rows, BASE_ROWS, 'missing projected fields never mean row absence');
  assert.equal(handle.optimisticPresentation.status, 'pending-without-prediction');
  assert.equal(handle.answerClass, 'pending-without-prediction');
  assert.equal(
    (await store.outboxRecords()).find((record) => record.id === incompleteId)?.status,
    'pending',
    'the store retains pending custody while foreground dispatch owns the shared fence',
  );

  const serverOnlyId = 'mutation-server-only';
  const serverOnly = client.mutate(SERVER_ONLY, {
    clientMutationId: serverOnlyId,
    args: { id: 'card-1' },
  });
  await waitUntil(
    () => handle.optimisticPresentation.queuedOnly.some(
      (entry) => entry.clientMutationId === serverOnlyId,
    ),
    'server-only pending inspection',
  );
  assert.deepEqual(handle.rows, BASE_ROWS);
  assert.equal(handle.optimisticPresentation.status, 'pending-without-prediction');
  assert.equal(handle.answerClass, 'pending-without-prediction');

  releaseResponses();
  await Promise.all([incomplete, serverOnly]);
  await handle.dispose();
  await store.close();
});

test('headless unproven query membership keeps generated intent pending without fabricating a row', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-membership-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const { client, handle } = await openHost(store, BASE_ROWS, FILTERED_QUERY);

  let releaseResponse;
  const response = new Promise((resolve) => { releaseResponse = resolve; });
  globalThis.fetch = async () => {
    await response;
    return Response.json({ result: true, version: 2 });
  };
  const mutationId = 'mutation-unproven-membership';
  const pending = client.mutate(CREATE, {
    clientMutationId: mutationId,
    args: { title: 'Membership unknown', position: 2 },
  });
  await waitUntil(
    () => handle.optimisticPresentation.queuedOnly.some(
      (entry) => entry.clientMutationId === mutationId,
    ),
    'unproven membership pending inspection',
  );
  assert.deepEqual(handle.rows, BASE_ROWS);
  assert.equal(handle.optimisticPresentation.status, 'pending-without-prediction');

  releaseResponse();
  await pending;
  await handle.dispose();
  await store.close();
});

test('headless server rejection removes only its generated layer', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-reject-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const { client, handle } = await openHost(store);

  let rejectFirst;
  const rejectedGate = new Promise((resolve) => { rejectFirst = resolve; });
  let settleSecond;
  const siblingGate = new Promise((resolve) => { settleSecond = resolve; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (body.args.id === 'card-1') {
      await rejectedGate;
      return Response.json({
        diagnostic: { code: 'SNAPBACK_APP_REFUSAL', message: 'rejected' },
      }, { status: 409 });
    }
    await siblingGate;
    return Response.json({ result: true, version: 2 });
  };

  const rejected = client.mutate(EDIT, {
    args: { id: 'card-1', title: 'Rejected title' },
  });
  const rejectedObserved = rejected.catch((error) => error);
  const sibling = client.mutate(EDIT, {
    args: { id: 'card-2', title: 'Sibling survives' },
  });
  await waitUntil(() => handle.optimisticPresentation.layers.length === 2, 'two generated layers');
  rejectFirst();
  const refusal = await rejectedObserved;
  assert.equal(refusal.code, 'SNAPBACK_APP_REFUSAL');
  await waitUntil(() => handle.optimisticPresentation.layers.length === 1, 'rejected layer removal');
  assert.equal(handle.rows.find((row) => row._id === 'card-1').title, 'One');
  assert.equal(handle.rows.find((row) => row._id === 'card-2').title, 'Sibling survives');

  settleSecond();
  await sibling;
  await handle.dispose();
  await store.close();
});

test('headless manual-drain restart reconstructs the identical generated provisional layer', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const firstStore = openStore(directory);
  await firstStore.whenLockSettled();
  const first = await openHost(firstStore, []);
  globalThis.fetch = async () => { throw new TypeError('offline for deterministic replay'); };
  const queued = await first.client.mutate(CREATE, {
    args: { title: 'Durable provisional', position: 7 },
  });
  assert.equal(queued.status, 'queued');
  assert.equal(queued.presentation, 'installed');
  await waitUntil(() => first.handle.rows.length === 1, 'first-process provisional paint');
  const beforeRestart = structuredClone(first.handle.rows);
  assert.equal(first.handle.optimisticPresentation.layers[0].clientMutationId, queued.clientMutationId);
  await first.handle.dispose();
  await firstStore.close();

  const relaunchedStore = openStore(directory);
  await relaunchedStore.whenLockSettled();
  const relaunched = await openHost(relaunchedStore, []);
  await waitUntil(() => relaunched.handle.rows.length === 1, 'restart provisional replay');
  assert.deepEqual(relaunched.handle.rows, beforeRestart);
  assert.equal(
    relaunched.handle.optimisticPresentation.layers[0].clientMutationId,
    queued.clientMutationId,
  );
  assert.equal((await relaunched.client.outboxStatus()).drainMode, 'none');
  await relaunched.handle.dispose();
  await relaunchedStore.close();
});

test('headless pause and resume replay a settled generated bridge over the fresh snapshot', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-resume-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const host = await openHost(store);
  globalThis.fetch = async () => Response.json({ result: true, version: 2 });

  await host.client.mutate(CREATE, { args: { title: 'Still pending', position: 3 } });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'settled bridge installation',
  );
  const speculativeId = host.handle.rows.find((row) => row.title === 'Still pending')._id;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(() => host.subscriptionSequence === 2, 'fresh resume subscription');
  await waitUntil(
    () => host.handle.rows.some((row) => row._id === speculativeId),
    'generated bridge replay after resume',
  );
  assert.equal(host.handle.optimisticPresentation.layers[0].layerStatus, 'bridging');
  await host.handle.dispose();
  await store.close();
});

test('restart orders prior-epoch and epoch-less durable layers before current-process layers', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-sequences-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const firstStore = openStore(directory);
  await firstStore.whenLockSettled();
  const first = await openHost(firstStore, []);
  globalThis.fetch = async () => { throw new TypeError('offline durable sequence fixture'); };
  const durableFirst = await first.client.mutate(CREATE, {
    clientMutationId: 'durable-first', args: { title: 'Durable first', position: 1 },
  });
  const durableSecond = await first.client.mutate(CREATE, {
    clientMutationId: 'durable-second', args: { title: 'Durable second', position: 2 },
  });
  assert.equal(durableFirst.status, 'queued');
  assert.equal(durableSecond.status, 'queued');
  await first.handle.dispose();
  await firstStore.close();

  const blobName = (await readdir(directory)).find((name) => name.endsWith('.v1.json'));
  assert.equal(typeof blobName, 'string');
  const blobPath = join(directory, blobName);
  const persisted = JSON.parse(await readFile(blobPath, 'utf8'));
  persisted.outbox.records['durable-first'].sequence = 9_000_000;
  persisted.outbox.records['durable-first'].optimisticProcessEpoch =
    'explicit-prior-process-epoch';
  persisted.outbox.records['durable-first'].optimisticInvocationSequence = 9_000_000;
  persisted.outbox.records['durable-second'].sequence = 9_000_001;
  delete persisted.outbox.records['durable-second'].optimisticProcessEpoch;
  delete persisted.outbox.records['durable-second'].optimisticInvocationSequence;
  persisted.outbox.sequence = 9_000_001;
  await writeFile(blobPath, JSON.stringify(persisted), 'utf8');

  const secondStore = openStore(directory);
  await secondStore.whenLockSettled();
  const second = await openHost(secondStore, []);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };
  const ephemeral = second.client.mutate(CREATE, {
    queue: false,
    clientMutationId: 'ephemeral-after-restart',
    args: { title: 'Ephemeral after restart', position: 3 },
  });
  await waitUntil(
    () => second.handle.optimisticPresentation.layers.length === 3,
    'mixed durable and ephemeral projection stack',
  );
  assert.deepEqual(
    second.handle.optimisticPresentation.layers.map((layer) => layer.clientMutationId),
    ['durable-first', 'durable-second', 'ephemeral-after-restart'],
  );
  assert.equal(
    second.handle.optimisticPresentation.layers[2].__optimisticSequenceEpoch,
    'current',
  );
  assert.deepEqual(
    second.handle.rows.map((row) => row.title),
    ['Durable first', 'Durable second', 'Ephemeral after restart'],
  );
  release();
  await ephemeral;
  await second.handle.dispose();
  await secondStore.close();
});

test('same-process queue false then durable auto preserves invocation order', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-interleave-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const host = await openHost(store);
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  globalThis.fetch = async () => {
    await gate;
    return Response.json({ result: true, version: 2 });
  };

  const ephemeral = host.client.mutate(EDIT, {
    queue: false,
    clientMutationId: 'same-process-ephemeral-first',
    args: { id: 'card-1', title: 'Ephemeral first' },
  });
  await waitUntil(
    () => host.handle.rows.find((row) => row._id === 'card-1')?.title === 'Ephemeral first',
    'same-process ephemeral first paint',
  );
  const durable = host.client.mutate(EDIT, {
    clientMutationId: 'same-process-durable-second',
    args: { id: 'card-1', title: 'Durable second' },
  });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 2,
    'same-process mixed queue stack',
  );
  assert.deepEqual(
    host.handle.optimisticPresentation.layers.map((layer) => layer.clientMutationId),
    ['same-process-ephemeral-first', 'same-process-durable-second'],
  );
  assert.equal(
    host.handle.rows.find((row) => row._id === 'card-1').title,
    'Durable second',
  );

  release();
  await Promise.all([ephemeral, durable]);
  await host.handle.dispose();
  await store.close();
});

test('real settlement matcher retires only a complete reflected mapping and only once', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-retirement-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  let canonicalRows = [];
  let canonicalVersion = 1;
  const host = await openHost(store, [], QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const mint = requestBody.settlementClaims.mints[0];
    return Response.json({
      result: 'card-authoritative',
      version: 2,
      receipt: {
        kind: 'mutation', mutationId: requestBody.clientMutationId,
        idMap: [{
          speculative: mint.claimed,
          authoritative: 'card-authoritative',
          site: mint.site,
          occurrence: mint.occurrence,
          disposition: 'mapped',
        }],
      },
    });
  };
  await host.client.mutate(CREATE, {
    clientMutationId: 'mapped-create', args: { title: 'Mapped', position: 4 },
  });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'mapped bridge installation',
  );

  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(() => host.subscriptionSequence === 2, 'unrelated authoritative delivery');
  await waitUntil(
    () => host.handle.rows.some((row) => row.title === 'Mapped'),
    'unrelated delivery preserves mapped bridge',
  );
  assert.equal(host.handle.optimisticPresentation.layers.length, 1);
  assert.equal(host.handle.rows.some((row) => row.title === 'Mapped'), true);

  canonicalRows = [{
    _id: 'card-authoritative', title: 'Mapped', position: 4, archived: false, locked: false,
  }];
  canonicalVersion = 4;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 0,
    'complete canonical reflection retirement',
  );
  assert.deepEqual(host.handle.rows, canonicalRows);

  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(() => host.subscriptionSequence === 4, 'duplicate canonical delivery');
  assert.equal(host.handle.optimisticPresentation.layers.length, 0);
  assert.deepEqual(host.handle.rows, canonicalRows);
  await host.handle.dispose();
  await store.close();
});

test('multi-table mutation retires when every observed-table write reflects', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-multitable-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  let canonicalRows = BASE_ROWS;
  let canonicalVersion = 1;
  const host = await openHost(store, BASE_ROWS, QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const mint = body.settlementClaims.mints[0];
    return Response.json({
      result: 2,
      version: 2,
      receipt: {
        kind: 'mutation',
        mutationId: body.clientMutationId,
        idMap: [{
          speculative: mint.claimed,
          authoritative: 'audit-authoritative',
          site: mint.site,
          occurrence: mint.occurrence,
          disposition: 'mapped',
        }],
      },
    });
  };

  await host.client.mutate(PATCH_AND_AUDIT, {
    clientMutationId: 'patch-card-and-audit',
    args: { id: 'card-1', title: 'Observed patch reflected' },
  });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'multi-table bridge',
  );
  canonicalRows = BASE_ROWS.map((row) => (
    row._id === 'card-1' ? { ...row, title: 'Observed patch reflected' } : row
  ));
  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 0,
    'multi-table observed reflection retirement',
  );
  assert.deepEqual(host.handle.rows, canonicalRows);
  await host.handle.dispose();
  await store.close();
});

test('settled parent id remaps a surviving child layer and canonical reflection', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-reference-map-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  let canonicalRows = [];
  let canonicalVersion = 1;
  const host = await openHost(store, [], QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  let releaseParent;
  let releaseChild;
  const parentGate = new Promise((resolve) => { releaseParent = resolve; });
  const childGate = new Promise((resolve) => { releaseChild = resolve; });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const mint = body.settlementClaims.mints[0];
    const parent = body.clientMutationId === 'reference-parent';
    await (parent ? parentGate : childGate);
    const authoritative = parent ? 'card-parent-authoritative' : 'card-child-authoritative';
    return Response.json({
      result: authoritative,
      version: parent ? 2 : 3,
      receipt: {
        kind: 'mutation',
        mutationId: body.clientMutationId,
        idMap: [{
          speculative: mint.claimed,
          authoritative,
          site: mint.site,
          occurrence: mint.occurrence,
          disposition: 'mapped',
        }],
      },
    });
  };

  const parent = host.client.mutate(CREATE, {
    clientMutationId: 'reference-parent',
    args: { title: 'Parent', position: 1 },
  });
  await waitUntil(() => host.handle.rows.length === 1, 'speculative parent paint');
  const speculativeParentId = host.handle.rows[0]._id;
  const child = host.client.mutate(CREATE_CHILD, {
    clientMutationId: 'reference-child',
    args: { title: 'Child', position: 2, parentId: speculativeParentId },
  });
  await waitUntil(() => host.handle.rows.length === 2, 'speculative child paint');
  assert.equal(
    host.handle.rows.find((row) => row.title === 'Child').parentId,
    speculativeParentId,
  );

  releaseParent();
  await parent;
  canonicalRows = [{
    _id: 'card-parent-authoritative',
    title: 'Parent', position: 1, archived: false, locked: false,
  }];
  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 1,
    'parent retirement with surviving child',
  );
  await waitUntil(
    () => host.handle.rows.find((row) => row.title === 'Child')?.parentId
      === 'card-parent-authoritative',
    'surviving child reference remap',
  );

  releaseChild();
  await child;
  canonicalRows = [
    canonicalRows[0],
    {
      _id: 'card-child-authoritative', parentId: 'card-parent-authoritative',
      title: 'Child', position: 2, archived: false, locked: false,
    },
  ];
  canonicalVersion = 4;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 0,
    'child canonical reflection retirement',
  );
  assert.deepEqual(host.handle.rows, canonicalRows);
  await host.handle.dispose();
  await store.close();
});

test('omitted same-table patch preserves settlement descriptor identity and retires', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-omitted-patch-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  const existingRows = [{
    _id: 'card-present',
    parentId: null,
    title: 'Present',
    position: 0,
    archived: false,
    locked: false,
  }];
  let canonicalRows = existingRows;
  let canonicalVersion = 1;
  const host = await openHost(store, existingRows, QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  let requestBody;
  globalThis.fetch = async (_url, init) => {
    requestBody = JSON.parse(init.body);
    const mint = requestBody.settlementClaims.mints[0];
    return Response.json({
      result: 'card-self-parent-authoritative',
      version: 2,
      receipt: {
        kind: 'mutation',
        mutationId: requestBody.clientMutationId,
        idMap: [{
          speculative: mint.claimed,
          authoritative: 'card-self-parent-authoritative',
          site: mint.site,
          occurrence: mint.occurrence,
          disposition: 'mapped',
        }],
      },
    });
  };

  await host.client.mutate(CREATE_SELF_PARENT_AFTER_ABSENT_PATCH, {
    clientMutationId: 'omitted-patch-create',
    args: {
      id: 'card-present',
      parentId: 'card-absent',
      title: 'New parent',
      position: 1,
    },
  });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'omitted-patch bridge installation',
  );
  const speculativeId = requestBody.settlementClaims.mints[0].claimed;
  const layer = host.handle.optimisticPresentation.layers[0].prediction.layer;
  assert.deepEqual(
    layer.writes.map((write) => write.planStepIndex),
    [0, 2],
    'the absent patch emits no write without shifting the later write identity',
  );
  const remapped = rewriteOptimisticLayerIdsV1(layer, {
    operation: { plan: CREATE_SELF_PARENT_AFTER_ABSENT_PATCH.mutationIr.plan },
    argsContract: CREATE_SELF_PARENT_AFTER_ABSENT_PATCH.argsContract,
    replacements: new Map([[speculativeId, 'card-self-parent-authoritative']]),
  });
  assert.equal(remapped.writes[0].row._id, 'card-self-parent-authoritative');
  assert.equal(remapped.writes[1].id, 'card-present');
  assert.equal(remapped.writes[1].values.parentId, 'card-self-parent-authoritative');
  assert.equal(remapped.writes[1].row.parentId, 'card-self-parent-authoritative');

  canonicalRows = [
    {
      ...existingRows[0],
      parentId: 'card-self-parent-authoritative',
    },
    {
      _id: 'card-self-parent-authoritative',
      parentId: null,
      title: 'New parent',
      position: 1,
      archived: false,
      locked: false,
    },
  ];
  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 0,
    'omitted-patch canonical reflection retirement',
  );
  assert.deepEqual(host.handle.rows, canonicalRows);
  await host.handle.dispose();
  await store.close();
});

test('settlement preserves an ordinary string equal to a sibling speculative id and retires', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-string-map-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  let canonicalRows = [];
  let canonicalVersion = 1;
  const host = await openHost(store, [], QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  let releaseFirst;
  let releaseSibling;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const siblingGate = new Promise((resolve) => { releaseSibling = resolve; });
  const requests = new Map();
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    requests.set(body.clientMutationId, body);
    const first = body.clientMutationId === 'string-source';
    await (first ? firstGate : siblingGate);
    const mint = body.settlementClaims.mints[0];
    const authoritative = first ? 'card-string-source-authoritative' : 'card-string-sibling-authoritative';
    return Response.json({
      result: authoritative,
      version: first ? 2 : 3,
      receipt: {
        kind: 'mutation', mutationId: body.clientMutationId,
        idMap: [{
          speculative: mint.claimed, authoritative,
          site: mint.site, occurrence: mint.occurrence, disposition: 'mapped',
        }],
      },
    });
  };

  const first = host.client.mutate(CREATE, {
    clientMutationId: 'string-source', args: { title: 'Source', position: 1 },
  });
  await waitUntil(() => host.handle.rows.length === 1, 'string source speculative paint');
  const speculativeId = host.handle.rows[0]._id;
  const sibling = host.client.mutate(CREATE, {
    clientMutationId: 'string-sibling', args: { title: speculativeId, position: 2 },
  });
  await waitUntil(() => host.handle.rows.length === 2, 'string sibling speculative paint');
  assert.equal(
    requests.has('string-sibling'),
    false,
    'the sibling paints while its predecessor retains ordered dispatch custody',
  );

  releaseFirst();
  await first;
  await waitUntil(() => requests.has('string-sibling'), 'string sibling dispatch');
  assert.equal(requests.get('string-sibling').args.title, speculativeId);
  canonicalRows = [{
    _id: 'card-string-source-authoritative',
    title: 'Source', position: 1, archived: false, locked: false,
  }];
  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 1,
    'string source retirement with sibling surviving',
  );
  const predictedSibling = host.handle.rows.find((row) => (
    row._id !== 'card-string-source-authoritative'
  ));
  assert.equal(predictedSibling.title, speculativeId);
  assert.equal(predictedSibling.title, requests.get('string-sibling').args.title);

  releaseSibling();
  await sibling;
  canonicalRows = [
    canonicalRows[0],
    {
      _id: 'card-string-sibling-authoritative',
      title: speculativeId, position: 2, archived: false, locked: false,
    },
  ];
  canonicalVersion = 4;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(
    () => host.handle.optimisticPresentation.layers.length === 0,
    'string sibling canonical reflection retirement',
  );
  assert.deepEqual(host.handle.rows, canonicalRows);
  await host.handle.dispose();
  await store.close();
});

test('real settlement matcher rejects wrong-site mappings even when the row is present', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-map-refusal-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = openStore(directory);
  await store.whenLockSettled();
  let canonicalRows = [];
  let canonicalVersion = 1;
  const host = await openHost(store, [], QUERY, {
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const mint = body.settlementClaims.mints[0];
    canonicalRows = [{
      _id: 'card-wrong-map', title: 'Wrong map', position: 8, archived: false, locked: false,
    }];
    return Response.json({
      result: 'card-wrong-map', version: 2,
      receipt: {
        kind: 'mutation', mutationId: body.clientMutationId,
        idMap: [{
          speculative: mint.claimed, authoritative: 'card-wrong-map',
          site: 'wrong/site', occurrence: mint.occurrence, disposition: 'mapped',
        }],
      },
    });
  };
  await host.client.mutate(CREATE, {
    clientMutationId: 'wrong-site-create', args: { title: 'Wrong map', position: 8 },
  });
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'wrong-site bridge installation',
  );
  canonicalVersion = 3;
  await host.handle.pause();
  await host.handle.resume();
  await waitUntil(() => host.subscriptionSequence === 2, 'wrong-map authoritative delivery');
  await waitUntil(
    () => host.handle.optimisticPresentation.layers[0]?.layerStatus === 'bridging',
    'wrong-site mapping stays bridged',
  );
  assert.equal(host.handle.optimisticPresentation.layers.length, 1);
  assert.equal(host.handle.optimisticPresentation.layers[0].layerStatus, 'bridging');
  await host.handle.dispose();
  await store.close();
});

test('automatic restart drain preserves and retires layers across settlement and ACK removal races', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-default-auto-drain-'));
  t.after(() => rm(directory, { recursive: true, force: true }));

  const firstStore = openStore(directory);
  await firstStore.whenLockSettled();
  const first = await openHost(firstStore, []);
  globalThis.fetch = async () => { throw new TypeError('offline automatic-drain fixture'); };
  const firstQueued = await first.client.mutate(CREATE, {
    clientMutationId: 'auto-drain-first', args: { title: 'Drain first', position: 1 },
  });
  assert.equal(firstQueued.status, 'queued');
  await first.handle.dispose();
  await first.client.close();
  await firstStore.close();

  let canonicalRows = [];
  let canonicalVersion = 1;
  let releaseFirst;
  let releaseSecond;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const secondGate = new Promise((resolve) => { releaseSecond = resolve; });
  const requests = [];
  const acknowledgementRequests = [];
  const mappings = new Map();
  const drainAuthorityDescriptor = Object.freeze({
    descriptorVersion: 1,
    authorityInstanceId: '018f0d90-7b24-7a22-8c33-445566778899',
    sessionGeneration: 1,
  });
  globalThis.fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (new URL(url).pathname === '/client-mutations/acknowledge') {
      acknowledgementRequests.push(body);
      await secondGate;
      return Response.json({ acknowledged: body.clientMutationIds });
    }
    requests.push(body);
    const mint = body.settlementClaims.mints[0];
    const authoritative = `${body.clientMutationId}-authoritative`;
    mappings.set(body.clientMutationId, { speculative: mint.claimed, authoritative });
    await firstGate;
    return Response.json({
      result: authoritative,
      version: body.clientMutationId === firstQueued.clientMutationId ? 2 : 3,
      authorityDescriptor: drainAuthorityDescriptor,
      receipt: {
        kind: 'mutation', mutationId: body.clientMutationId,
        idMap: [{
          speculative: mint.claimed, authoritative,
          site: mint.site, occurrence: mint.occurrence, disposition: 'mapped',
        }],
      },
    });
  };

  const secondStore = openStore(directory);
  await secondStore.whenLockSettled();
  const second = await openHost(secondStore, [], QUERY, {
    clientOptions: { __outboxDrainLifecycle: true },
    snapshot: () => ({ rows: canonicalRows, version: canonicalVersion }),
  });
  await waitUntil(
    () => requests.length === 1,
    `automatic drain first replay ${JSON.stringify(await second.client.outboxStatus())}`,
  );
  await waitUntil(
    () => second.handle.optimisticPresentation.layers.length === 1,
    'restart layer before first settlement',
  );
  releaseFirst();
  await waitUntil(
    () => second.handle.optimisticPresentation.layers.find(
      (layer) => layer.clientMutationId === firstQueued.clientMutationId,
    )?.layerStatus === 'bridging',
    'first drain bridge before ACK',
  );
  await waitUntil(
    async () => (await secondStore.outboxRecords()).find(
      (record) => record.id === firstQueued.clientMutationId,
    )?.status === 'settled',
    'automatic drain durable settlement',
  );
  assert.equal(
    await second.client.markMutationSettlementsConsumed([firstQueued.clientMutationId]),
    1,
  );
  const acknowledgementTarget = (await secondStore.outboxRecords())
    .find((record) => record.id === firstQueued.clientMutationId).enqueueTarget;
  await waitUntil(
    async () => (await secondStore.outboxPendingAcknowledgements(
      null,
      64,
      drainAuthorityDescriptor,
      acknowledgementTarget,
    )).includes(
      firstQueued.clientMutationId,
    ),
    'automatic drain ACK obligation',
  );
  const acknowledgement = second.client.acknowledgeMutations({
    clientMutationIds: [firstQueued.clientMutationId],
  });
  await waitUntil(() => acknowledgementRequests.length === 1, 'settlement ACK request');
  assert.deepEqual(
    acknowledgementRequests[0].clientMutationIds,
    [firstQueued.clientMutationId],
    'ordinary acknowledgement carries the drained settlement identity',
  );
  releaseSecond();
  await acknowledgement;
  await waitUntil(
    async () => !(await secondStore.outboxRecords()).some(
      (record) => record.id === firstQueued.clientMutationId,
    ),
    'first settlement ACK removal',
  );
  assert.equal(
    second.handle.optimisticPresentation.layers.some(
      (layer) => layer.clientMutationId === firstQueued.clientMutationId,
    ),
    true,
    'ACK deletion cannot erase an unreflected generated bridge',
  );
  assert.deepEqual(second.handle.rows.map((row) => row.title), ['Drain first']);

  canonicalRows = [
    { _id: mappings.get(firstQueued.clientMutationId).authoritative,
      title: 'Drain first', position: 1, archived: false, locked: false },
  ];
  canonicalVersion = 4;
  await second.handle.pause();
  await second.handle.resume();
  await waitUntil(
    () => second.handle.optimisticPresentation.layers.length === 0,
    'automatic-drain bridges retire on complete canonical reflection',
  );
  assert.deepEqual(second.handle.rows, canonicalRows);
  await second.handle.dispose();
  await second.client.close();
  await secondStore.close();
});

const AUTH_INCARNATION = '018f0d90-7b11-7a22-8c33-445566778899';
const authIssuer = Object.freeze({
  authorizationIncarnation: AUTH_INCARNATION,
  bootSequence: 7,
  bootNonce: 'ABCDEFGHIJKLMNOPQRSTUV',
});
const authHandshake = Object.freeze({
  protocolVersion: 1,
  serverStartupNonce: 'startup-generated-optimistic-authority',
  authorizationStreamIncarnation: AUTH_INCARNATION,
  transitionGeneration: 1,
  activeMode: 'sessions', desiredMode: 'sessions', modeState: 'settled',
  appDataAvailability: 'available', quarantineCode: null,
  clientProtocols: {
    authClient: 1, authInvalidation: 1, authorityDescriptor: null, authorizedLease: null,
  },
  availability: {
    onlineRequestResponse: { available: true, reason: null },
    authScopedLive: { available: true, minimumAuthInvalidationProtocol: 1, reason: null },
    retainedReads: {
      available: false, minimumAuthInvalidationProtocol: 1,
      minimumAuthorizedLeaseProtocol: 1, reason: null,
    },
    queuedReplay: { available: false, minimumAuthorityDescriptorProtocol: 1, reason: null },
  },
  provider: { key: 'email-code', available: true },
  transports: ['bearer'],
  authority: {
    userId: 'user_generated_optimistic', sessionId: 'session_generated_optimistic',
    isAuthenticated: true,
  },
  authorityDescriptor: {
    descriptorVersion: 1, authorityInstanceId: AUTH_INCARNATION, sessionGeneration: 1,
  },
  authorizedLease: null,
});

const coordinatorAuthHandshake = Object.freeze({
  ...authHandshake,
  transitionGeneration: 0,
  clientProtocols: Object.freeze({
    ...authHandshake.clientProtocols,
    authorityDescriptor: 1,
  }),
  availability: Object.freeze({
    ...authHandshake.availability,
    queuedReplay: Object.freeze({
      available: true,
      minimumAuthorityDescriptorProtocol: 1,
      reason: null,
    }),
  }),
  authority: Object.freeze({
    kind: 'humanSession',
    userId: '018f0d90-7b12-7a22-8c33-445566778899',
    sessionId: '018f0d90-7b13-7a22-8c33-445566778899',
    isAuthenticated: true,
  }),
  deploymentIdentity: Object.freeze({
    schemaVersion: 'snapback.v1',
    authMode: 'sessions',
    appId: ACTIVATION.appId,
    schemaHash: `snapback.v1:sessions:schema:sha256:${'1'.repeat(64)}`,
    bundleHash: `snapback.v1:sessions:function:sha256:${'2'.repeat(64)}`,
    inputsHash: `snapback.v1:sessions:inputs:sha256:${'3'.repeat(64)}`,
  }),
});

const coordinatorAuthCredential = () => ({
  tokenType: 'Bearer',
  token: 'sbs_generated_optimistic_coordinator',
  refreshAfter: Date.now() + 60_000,
  session: {
    id: '018f0d90-7b13-7a22-8c33-445566778899',
    userId: '018f0d90-7b12-7a22-8c33-445566778899',
    provider: 'email-code',
    createdAt: Date.now(),
    expiresAt: Date.now() + 120_000,
    absoluteExpiresAt: Date.now() + 240_000,
  },
  authorityDescriptor: coordinatorAuthHandshake.authorityDescriptor,
});

const authQuery = (() => {
  const trusted = QUERY.artifacts.trustedCompositionActivation;
  return Object.freeze({
    ...QUERY,
    artifacts: Object.freeze({
      trustedCompositionActivation: Object.freeze({
        ...trusted,
        activation: Object.freeze({ ...trusted.activation, authMode: 'sessions' }),
      }),
    }),
  });
})();

const authObligation = (scopeId, revision = 1, minCommitVersion = 2) => ({
  protocolVersion: 1,
  scopeId,
  revision,
  maxDisposition: 'quarantine',
  witness: {
    authorization: { incarnation: AUTH_INCARNATION, epoch: 4 },
    data: { versionStream: 'generated-optimistic-auth-stream', minCommitVersion },
  },
  retryEpisodeId: null,
  ownerContinuityId: 'generated-optimistic-owner',
});

const authResolution = (pending, ackToken) => ({
  protocolVersion: 1,
  kind: 'snapshot',
  scopeId: pending.scopeId,
  revision: pending.revision,
  witness: pending.witness,
  maxDisposition: pending.maxDisposition,
  ackToken,
  ownerContinuityId: pending.ownerContinuityId,
});

const authProjectionEnvelope = ({ pending, resolution = null, snapshot = null }) => ({
  Durable: {
    payload: JSON.stringify({
      kind: 'authorization_invalidation',
      obligation: pending,
      ...(resolution === null ? {} : { resolution }),
      ...(snapshot === null ? {} : { snapshot }),
    }),
  },
});

const authBoundaryEnvelope = (scopeId) => authProjectionEnvelope({
  pending: authObligation(scopeId),
});

const exerciseAuthorityBoundary = async ({ boundaryCallbackThrows }) => {
  const directory = await mkdtemp(join(tmpdir(), 'snapback-generated-auth-boundary-'));
  const store = createFileRqsResumeStore({
    directory,
    clientStoreId: `generated-auth-${boundaryCallbackThrows ? 'error' : 'quarantine'}`,
  });
  await store.whenLockSettled();
  await installProjectionTarget(store, 'http://generated-optimistic-authority.test');
  const outbox = [];
  const boundaries = [];
  const updates = [];
  const errors = [];
  let scopeId = null;
  let releaseMutation;
  const mutationGate = new Promise((resolve) => { releaseMutation = resolve; });
  let releaseTransportAdmission;
  const transportAdmissionGate = new Promise((resolve) => { releaseTransportAdmission = resolve; });
  let signalTransportAdmissionStarted;
  const transportAdmissionStarted = new Promise(
    (resolve) => { signalTransportAdmissionStarted = resolve; },
  );
  const client = new SnapbackClient('http://generated-optimistic-authority.test', {
    bearerToken: 'generated-optimistic-session',
    authInvalidationProtocol: 1,
    clientStoreId: `generated-auth-${boundaryCallbackThrows ? 'error' : 'quarantine'}`,
    rqsStore: store,
    offlineQueue: true,
  });
  client.currentAuthorizationScope = async () => Object.freeze({
    principalScope: Object.freeze({
      authMode: 'sessions', authorizationStreamIncarnation: AUTH_INCARNATION,
      userId: 'user_generated_optimistic',
    }),
    authorityDescriptor: Object.freeze({
      descriptorVersion: 1, authorityInstanceId: AUTH_INCARNATION, sessionGeneration: 1,
    }),
  });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/auth/session') return Response.json(authHandshake);
    if (path === '/connection/open') {
      return Response.json({
        connectionId: 'generated-auth-connection',
        connectionToken: 'sct_generated_auth',
        ephemeralExpiryProtocol: 1,
        wireVersion: 'snapback.v1',
        authorizationInvalidation: {
          protocolVersion: 1,
          issuerId: authIssuer,
          connectionGeneration: 2,
          authorization: { incarnation: AUTH_INCARNATION, epoch: 4 },
          versionStream: 'generated-optimistic-auth-stream',
        },
      });
    }
    if (path === '/live/listCards/subscribe') {
      const body = JSON.parse(init.body);
      scopeId = {
        kind: 'subscription', issuerId: authIssuer,
        namespace: body.authorizationNamespace,
        scopeSequence: 1, connectionGeneration: 2,
        subscriptionId: 'generated-auth-subscription',
      };
      return Response.json({
        subscription_id: 'generated-auth-subscription',
        snapshot: { rows: [], version: 1 },
        permission_epochs: {}, authorizationScope: scopeId,
      });
    }
    if (path === '/mutation/createCard') {
      if (boundaryCallbackThrows) throw new TypeError('queue before authorization adapter error');
      await mutationGate;
      return Response.json({ result: true, version: 2 });
    }
    if (path === '/outbox/generated-auth-connection') return Response.json(outbox.shift() ?? []);
    if (path === '/live/listCards/unsubscribe') return Response.json({ disposed: true });
    throw new Error(`unexpected generated authority request: ${path}`);
  };
  try {
    const handle = await client.liveQuery(authQuery, {
      connectionId: 'generated-auth-connection',
      onAuthorizationBoundary(rows, detail) {
        boundaries.push({ rows: structuredClone(rows), kind: detail.kind });
        if (boundaryCallbackThrows && detail.kind === 'authorization_quarantine') {
          throw new Error('boundary adapter failed');
        }
      },
      onAuthorizationError(error) { errors.push(error); },
      onUpdate(rows, detail) { updates.push({ rows: structuredClone(rows), kind: detail.kind }); },
    });
    const pending = client.mutate(CREATE, {
      clientMutationId: `authority-${boundaryCallbackThrows ? 'error' : 'quarantine'}-create`,
      args: { title: 'Protected prediction', position: 1 },
      ...(boundaryCallbackThrows ? {} : { __beforeTransportDispatch: async () => {
        signalTransportAdmissionStarted();
        await transportAdmissionGate;
      } }),
    });
    if (!boundaryCallbackThrows) await transportAdmissionStarted;
    await waitUntil(() => handle.rows.length === 1, 'protected generated insert paint');
    if (boundaryCallbackThrows) assert.equal((await pending).status, 'queued');
    outbox.push([authBoundaryEnvelope(scopeId)]);
    await handle.poll();
    await waitUntil(
      () => updates.some((entry) => entry.kind === (
        boundaryCallbackThrows ? 'authorization_error' : 'authorization_quarantine'
      )),
      `generated ${boundaryCallbackThrows ? 'authorization error' : 'authorization quarantine'}`,
    );
    assert.deepEqual(handle.rows, []);
    assert.equal(handle.optimisticPresentation.status, 'none');
    assert.equal(handle.optimisticPresentation.layers.length, 0);
    assert.equal(
      boundaries.some((entry) => entry.kind === 'authorization_quarantine'),
      true,
    );
    assert.equal(errors.length, boundaryCallbackThrows ? 1 : 0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(handle.rows, [], 'pending read-free insert cannot repaint after authority loss');
    releaseTransportAdmission();
    releaseMutation();
    if (boundaryCallbackThrows) {
      // The adapter fault closes the live scope and retires its queue root;
      // the closed handle still cannot repaint from the later settlement.
    } else {
      const deferred = await pending;
      assert.equal(deferred.status, 'queued');
      assert.equal(deferred.authorizationDisposition, 'authorization-suspended');
    }
    await handle.dispose();
  } finally {
    releaseTransportAdmission();
    releaseMutation();
    globalThis.fetch = originalFetch;
    await store.close();
    await rm(directory, { recursive: true, force: true });
  }
};

test('generated read-free insert cannot repaint after authorization quarantine or error', async () => {
  await exerciseAuthorityBoundary({ boundaryCallbackThrows: false });
  await exerciseAuthorityBoundary({ boundaryCallbackThrows: true });
});

test('resync publication cut fences an awaited optimistic rebase before successor proof', async (t) => {
  for (const delayedOutcome of ['success', 'failure']) {
    await t.test(`stale ${delayedOutcome} publication cannot cross the resync cut`, async () => {
      const originalFetch = globalThis.fetch;
      const outbox = [];
      const acknowledgements = [];
      const updates = [];
      const connectionErrors = [];
      const rebaseControl = {
        armed: false,
        didStart: false,
        didFinish: false,
        outcome: delayedOutcome,
        release: deferred(),
      };
      let scopeId = null;
      let subscribeAttempts = 0;
      let successorSubscribeControl = null;
      const directory = await mkdtemp(join(
        tmpdir(),
        `snapback-generated-coordinator-${delayedOutcome}-`,
      ));
      const store = createFileRqsResumeStore({
        directory,
        clientStoreId: `generated-coordinator-${delayedOutcome}`,
      });
      await store.whenLockSettled();
      await installProjectionTarget(
        store,
        'http://generated-optimistic-coordinator.test',
      );
      const coordinator = new AuthCoordinator({
        appId: ACTIVATION.appId,
        storage: createMemoryAuthCustodyStorage(),
        broadcastChannelFactory: null,
        hintStorage: null,
      });
      const client = new DelayedRebaseSnapbackClient(
        'http://generated-optimistic-coordinator.test',
        {
          authCoordinator: coordinator,
          authClientProtocol: 1,
          authInvalidationProtocol: 1,
          authorityDescriptorProtocol: 1,
          clientStoreId: `generated-coordinator-${delayedOutcome}`,
          rqsStore: store,
          offlineQueue: true,
        },
        rebaseControl,
      );
      let handle = null;

      globalThis.fetch = async (url, init = {}) => {
        const path = new URL(url).pathname;
        if (path === '/auth/exchange') return Response.json(coordinatorAuthCredential());
        if (path === '/auth/session') {
          const authenticated = new Headers(init.headers).get('authorization')
            === 'Bearer sbs_generated_optimistic_coordinator';
          return Response.json(authenticated
            ? coordinatorAuthHandshake
            : {
                ...coordinatorAuthHandshake,
                authority: {
                  kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false,
                },
                authorityDescriptor: {
                  ...coordinatorAuthHandshake.authorityDescriptor,
                  sessionGeneration: 0,
                },
              });
        }
        if (path === '/connection/open') {
          return Response.json({
            connectionId: `generated-coordinator-${delayedOutcome}`,
            connectionToken: `sct_generated_coordinator_${delayedOutcome}`,
            ephemeralExpiryProtocol: 1,
            wireVersion: 'snapback.v1',
            authorizationInvalidation: {
              protocolVersion: 1,
              issuerId: authIssuer,
              connectionGeneration: 2,
              authorization: { incarnation: AUTH_INCARNATION, epoch: 4 },
              versionStream: 'generated-optimistic-auth-stream',
            },
          });
        }
        if (path === '/live/listCards/subscribe') {
          subscribeAttempts += 1;
          const body = JSON.parse(init.body);
          const predecessorScope = scopeId;
          scopeId = {
            kind: 'subscription',
            issuerId: authIssuer,
            namespace: body.authorizationNamespace,
            scopeSequence: subscribeAttempts,
            connectionGeneration: 2,
            subscriptionId: `generated-coordinator-subscription-${delayedOutcome}-${subscribeAttempts}`,
          };
          if (successorSubscribeControl !== null) {
            successorSubscribeControl.entered.resolve();
            await successorSubscribeControl.release.promise;
            successorSubscribeControl = null;
          }
          return Response.json({
            subscription_id: scopeId.subscriptionId,
            snapshot: { rows: BASE_ROWS, version: 1 },
            permission_epochs: {},
            authorizationScope: scopeId,
            ...(predecessorScope === null ? {} : {
              superseded: predecessorScope.subscriptionId,
              scopeRetirements: [{
                issuerId: authIssuer,
                namespace: predecessorScope.namespace,
                retireThroughScopeSequence: predecessorScope.scopeSequence,
                authorizationExpectation: {
                  incarnation: AUTH_INCARNATION,
                  epoch: 4,
                },
                mac: 'A'.repeat(43),
              }],
            }),
          });
        }
        if (path === '/mutation/createCard') {
          throw new TypeError('offline generated mutation remains queued for proof-resume coverage');
        }
        if (path === `/outbox/generated-coordinator-${delayedOutcome}`) {
          return Response.json(outbox.shift() ?? []);
        }
        if (path === '/live/authorization-invalidation/acknowledge') {
          acknowledgements.push(JSON.parse(init.body).ackToken);
          return Response.json({ outcome: 'discharged' });
        }
        if (path === '/live/listCards/unsubscribe') {
          return Response.json({ subscription_id: scopeId?.subscriptionId, disposed: true });
        }
        throw new Error(`unexpected generated coordinator request: ${path}`);
      };

      try {
        await client.authExchange({
          challengeId: `generated-coordinator-${delayedOutcome}`,
          code: '123456',
        });
        handle = await client.liveQuery(authQuery, {
          connectionId: `generated-coordinator-${delayedOutcome}`,
          onUpdate(rows, detail) {
            updates.push({ rows: structuredClone(rows), kind: detail.kind });
          },
          onConnectionChange(_connection, detail) {
            if (detail?.error) connectionErrors.push(detail.error);
          },
        });
        const queuedMutation = await client.mutate(CREATE, {
          clientMutationId: `generated-coordinator-mutation-${delayedOutcome}`,
          args: { title: 'Protected prediction', position: 2 },
        });
        assert.equal(queuedMutation.status, 'queued');
        await waitUntil(
          () => handle.rows.some((row) => row.title === 'Protected prediction'),
          `${delayedOutcome} protected prediction paint`,
        );

        rebaseControl.armed = true;
        const firstPending = authObligation(scopeId, 1, 2);
        outbox.push([authProjectionEnvelope({
          pending: firstPending,
          resolution: authResolution(
            firstPending,
            `ack_generated_coordinator_initial_${delayedOutcome}`,
          ),
          snapshot: {
            subscriptionId: scopeId.subscriptionId,
            function: 'listCards',
            version: 2,
            rows: BASE_ROWS,
          },
        })]);
        await handle.poll();
        await waitUntil(
          () => rebaseControl.didStart,
          `${delayedOutcome} authorization snapshot rebase start`,
        );

        const predecessorScope = scopeId;
        const updatesAtResyncCut = updates.length;
        successorSubscribeControl = {
          entered: deferred(),
          release: deferred(),
        };
        outbox.push([{
          Durable: {
            payload: JSON.stringify({
              kind: 'resync_required',
              function: 'listCards',
              subscription_id: predecessorScope.subscriptionId,
              reason: 'watch_reload',
            }),
          },
        }]);
        await handle.poll();
        await successorSubscribeControl.entered.promise;
        assert.equal(handle.connection, 'stale');

        // The optimistic tail captured its publication fence before the
        // server reload cut and remains held across it. Its success and
        // fallback arms must both refuse app publication while the successor
        // response is still unavailable.
        rebaseControl.release.resolve();
        await waitUntil(
          () => rebaseControl.didFinish,
          `${delayedOutcome} resync-fenced optimistic rebase finish`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(
          updates.length,
          updatesAtResyncCut,
          `${delayedOutcome} predecessor optimistic tail published after resync`,
        );

        successorSubscribeControl.release.resolve();
        await waitUntil(
          () => handle.subscriptionId
            === `generated-coordinator-subscription-${delayedOutcome}-2`
            && handle.connection === 'polling',
          `${delayedOutcome} held resync successor installation: ${JSON.stringify(
            connectionErrors.map((error) => ({ code: error?.code, message: error?.message })),
          )}`,
        );
        assert.equal(subscribeAttempts, 2);
      } finally {
        rebaseControl.release.resolve();
        successorSubscribeControl?.release.resolve();
        try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
        try { await client.close(); } catch { /* cleanup cannot mask assertions */ }
        try { await coordinator.close(); } catch { /* cleanup cannot mask assertions */ }
        try { await store.close(); } catch { /* cleanup cannot mask assertions */ }
        await rm(directory, { recursive: true, force: true });
        globalThis.fetch = originalFetch;
      }
    });
  }
});

test('AuthCoordinator quarantine fences an awaited optimistic rebase until proof resumes it', async (t) => {
  for (const delayedOutcome of ['success', 'failure']) {
    await t.test(`stale ${delayedOutcome} publication stays behind the blank`, async () => {
      const originalFetch = globalThis.fetch;
      const outbox = [];
      const acknowledgements = [];
      const updates = [];
      const rebaseControl = {
        armed: false,
        didStart: false,
        didFinish: false,
        outcome: delayedOutcome,
        release: deferred(),
      };
      let scopeId = null;
      const directory = await mkdtemp(join(
        tmpdir(),
        `snapback-generated-coordinator-${delayedOutcome}-`,
      ));
      const store = createFileRqsResumeStore({
        directory,
        clientStoreId: `generated-coordinator-${delayedOutcome}`,
      });
      await store.whenLockSettled();
      await installProjectionTarget(
        store,
        'http://generated-optimistic-coordinator.test',
      );
      const coordinator = new AuthCoordinator({
        appId: ACTIVATION.appId,
        storage: createMemoryAuthCustodyStorage(),
        broadcastChannelFactory: null,
        hintStorage: null,
      });
      const client = new DelayedRebaseSnapbackClient(
        'http://generated-optimistic-coordinator.test',
        {
          authCoordinator: coordinator,
          authClientProtocol: 1,
          authInvalidationProtocol: 1,
          authorityDescriptorProtocol: 1,
          clientStoreId: `generated-coordinator-${delayedOutcome}`,
          rqsStore: store,
          offlineQueue: true,
        },
        rebaseControl,
      );
      let handle = null;

      globalThis.fetch = async (url, init = {}) => {
        const path = new URL(url).pathname;
        if (path === '/auth/exchange') return Response.json(coordinatorAuthCredential());
        if (path === '/auth/session') {
          const authenticated = new Headers(init.headers).get('authorization')
            === 'Bearer sbs_generated_optimistic_coordinator';
          return Response.json(authenticated
            ? coordinatorAuthHandshake
            : {
                ...coordinatorAuthHandshake,
                authority: {
                  kind: 'anonymous', userId: null, sessionId: null, isAuthenticated: false,
                },
                authorityDescriptor: {
                  ...coordinatorAuthHandshake.authorityDescriptor,
                  sessionGeneration: 0,
                },
              });
        }
        if (path === '/connection/open') {
          return Response.json({
            connectionId: `generated-coordinator-${delayedOutcome}`,
            connectionToken: `sct_generated_coordinator_${delayedOutcome}`,
            ephemeralExpiryProtocol: 1,
            wireVersion: 'snapback.v1',
            authorizationInvalidation: {
              protocolVersion: 1,
              issuerId: authIssuer,
              connectionGeneration: 2,
              authorization: { incarnation: AUTH_INCARNATION, epoch: 4 },
              versionStream: 'generated-optimistic-auth-stream',
            },
          });
        }
        if (path === '/live/listCards/subscribe') {
          const body = JSON.parse(init.body);
          scopeId = {
            kind: 'subscription',
            issuerId: authIssuer,
            namespace: body.authorizationNamespace,
            scopeSequence: 1,
            connectionGeneration: 2,
            subscriptionId: `generated-coordinator-subscription-${delayedOutcome}`,
          };
          return Response.json({
            subscription_id: scopeId.subscriptionId,
            snapshot: { rows: BASE_ROWS, version: 1 },
            permission_epochs: {},
            authorizationScope: scopeId,
          });
        }
        if (path === '/mutation/createCard') {
          throw new TypeError('offline generated mutation remains queued for proof-resume coverage');
        }
        if (path === `/outbox/generated-coordinator-${delayedOutcome}`) {
          return Response.json(outbox.shift() ?? []);
        }
        if (path === '/live/authorization-invalidation/acknowledge') {
          acknowledgements.push(JSON.parse(init.body).ackToken);
          return Response.json({ outcome: 'discharged' });
        }
        if (path === '/live/listCards/unsubscribe') {
          return Response.json({ subscription_id: scopeId?.subscriptionId, disposed: true });
        }
        throw new Error(`unexpected generated coordinator request: ${path}`);
      };

      try {
        await client.authExchange({
          challengeId: `generated-coordinator-${delayedOutcome}`,
          code: '123456',
        });
        handle = await client.liveQuery(authQuery, {
          connectionId: `generated-coordinator-${delayedOutcome}`,
          onUpdate(rows, detail) {
            updates.push({ rows: structuredClone(rows), kind: detail.kind });
          },
        });
        const queuedMutation = await client.mutate(CREATE, {
          clientMutationId: `generated-coordinator-mutation-${delayedOutcome}`,
          args: { title: 'Protected prediction', position: 2 },
        });
        assert.equal(queuedMutation.status, 'queued');
        await waitUntil(
          () => handle.rows.some((row) => row.title === 'Protected prediction'),
          `${delayedOutcome} protected prediction paint`,
        );

        rebaseControl.armed = true;
        const firstPending = authObligation(scopeId, 1, 2);
        outbox.push([authProjectionEnvelope({
          pending: firstPending,
          resolution: authResolution(
            firstPending,
            `ack_generated_coordinator_initial_${delayedOutcome}`,
          ),
          snapshot: {
            subscriptionId: scopeId.subscriptionId,
            function: 'listCards',
            version: 2,
            rows: BASE_ROWS,
          },
        })]);
        await handle.poll();
        await waitUntil(
          () => rebaseControl.didStart,
          `${delayedOutcome} authorization snapshot rebase start`,
        );

        const quarantinePending = authObligation(scopeId, 2, 3);
        outbox.push([authProjectionEnvelope({ pending: quarantinePending })]);
        await handle.poll();
        await waitUntil(
          () => updates.at(-1)?.kind === 'authorization_quarantine',
          `${delayedOutcome} quarantine blank`,
        );
        assert.deepEqual(handle.rows, []);
        assert.equal(handle.optimisticPresentation.status, 'none');
        const publicationsAtBlank = updates.length;

        rebaseControl.release.resolve();
        await waitUntil(
          () => rebaseControl.didFinish,
          `${delayedOutcome} authorization snapshot rebase finish`,
        );
        await new Promise((resolve) => setTimeout(resolve, 10));
        assert.equal(
          updates.length,
          publicationsAtBlank,
          `${delayedOutcome} stale rebase published over quarantine`,
        );
        assert.deepEqual(handle.rows, []);

        outbox.push([authProjectionEnvelope({
          pending: quarantinePending,
          resolution: authResolution(
            quarantinePending,
            `ack_generated_coordinator_resume_${delayedOutcome}`,
          ),
          snapshot: {
            subscriptionId: scopeId.subscriptionId,
            function: 'listCards',
            version: 3,
            rows: BASE_ROWS,
          },
        })]);
        await handle.poll();
        await waitUntil(
          () => acknowledgements.includes(`ack_generated_coordinator_resume_${delayedOutcome}`),
          `${delayedOutcome} continued-authority acknowledgement`,
        );
        await waitUntil(
          () => handle.rows.some((row) => row.title === 'Protected prediction'),
          `${delayedOutcome} optimistic proof resume`,
        );
        assert.equal(handle.authorizationDisposition, 'retain');
        assert.equal(handle.optimisticPresentation.status, 'predicted');
      } finally {
        rebaseControl.release.resolve();
        try { await handle?.dispose?.(); } catch { /* cleanup cannot mask assertions */ }
        try { await client.close(); } catch { /* cleanup cannot mask assertions */ }
        try { await coordinator.close(); } catch { /* cleanup cannot mask assertions */ }
        try { await store.close(); } catch { /* cleanup cannot mask assertions */ }
        await rm(directory, { recursive: true, force: true });
        globalThis.fetch = originalFetch;
      }
    });
  }
});
