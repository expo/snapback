import assert from 'node:assert/strict';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';

import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { importGeneratedModule } from '../../demos/_kit/generated-artifacts.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';
import {
  SnapbackProvider,
  useQuery,
  useQueryState,
} from '../../packages/snapback-react/familiar.mjs';
import { createSnapbackReactCoreProvider } from '../../packages/snapback-react/implementation.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// @ref LLP 0200#24-the-authorization-lane-splits-in-two--by-declared-classification — the generated role
// transition fences pre-transition frames while the restored handler retains
// its ordinary cutoff result.
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const codegenPackageRoot = join(repositoryRoot, 'packages', 'snapback-codegen');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-familiar-live-cutoff-'));
const backendRoot = join(scratch, 'snapback');
const sessions = [];
let server = null;
let familiarSurface = null;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function mintSession(appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: {} }),
    broadcastChannelFactory: null,
    hintStorage: null,
  });
  const client = new SnapbackClient(server.baseUrl, {
    authCoordinator: coordinator,
    authInvalidationProtocol: 1,
    authorityDescriptorProtocol: 1,
    authorizedLeaseProtocol: 1,
    clientStoreId,
    rqsStore: null,
  });
  const requested = await client.authRequestCode(email);
  const mailboxResponse = await fetch(
    `${server.baseUrl}/_snapback/api/auth/mailbox?challengeId=${encodeURIComponent(requested.challengeId)}`,
    {
      headers: {
        'x-snapback-admin-token': server.adminToken,
        'x-snapback-impersonation-capability': server.impersonationCapability,
      },
    },
  );
  const mailbox = await mailboxResponse.json();
  assert.equal(mailboxResponse.status, 200, JSON.stringify(mailbox));
  const credential = await client.authExchange({
    challengeId: requested.challengeId,
    code: mailbox.code,
  });
  const session = { client, coordinator, credential };
  sessions.push(session);
  return session;
}

async function eventually(assertion, label, timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      return await assertion();
    } catch (error) {
      lastError = error;
      await delay(20);
    }
  }
  throw new Error(`${label}: ${lastError?.message ?? 'timed out'}`);
}

const bodies = (rows) => rows.map(({ body }) => body);

function FamiliarLiveProbe({ reference, args, publish }) {
  const rows = useQuery(reference, args);
  const state = useQueryState(reference, args);
  React.useEffect(() => {
    publish({
      projectedDefined: rows !== undefined,
      bodies: bodies(Array.isArray(rows) ? rows : []),
      stateBodies: bodies(Array.isArray(state.data) ? state.data : []),
      status: state.status,
      connection: state.connection,
      freshness: state.freshness,
      errorCode: state.error?.code ?? state.error?.diagnostic?.code ?? null,
    });
  });
  return null;
}

async function mountFamiliarSurface(client, app, reference, args) {
  const originalStartLiveQuery = client.startLiveQuery;
  client.startLiveQuery = function startLiveQuery(liveReference, options = {}) {
    return originalStartLiveQuery.call(this, liveReference, {
      ...options,
      onUpdate(rows, detail) {
        act(() => { options.onUpdate?.(rows, detail); });
      },
    });
  };
  const binding = await client.prepareReactBinding({ generatedManifest: app });
  const provider = createSnapbackReactCoreProvider(binding, {
    connectionId: 'familiar-live-cutoff-react-removed',
  });
  const surface = {
    provider,
    renderer: null,
    frames: [],
    current: null,
    restoreLiveQuery() { client.startLiveQuery = originalStartLiveQuery; },
  };
  const publish = (frame) => {
    surface.current = frame;
    surface.frames.push(frame);
  };
  await act(async () => {
    surface.renderer = TestRenderer.create(React.createElement(
      SnapbackProvider,
      { provider },
      React.createElement(FamiliarLiveProbe, { reference, args, publish }),
    ));
    await delay(25);
  });
  await eventually(
    () => {
      assert.equal(surface.current?.status, 'ready');
      assert.deepEqual(surface.current?.bodies, ['before-removal']);
    },
    'Familiar hook did not become ready',
  );
  return surface;
}

async function disposeFamiliarSurface(surface) {
  await act(async () => {
    surface.renderer.unmount();
    await delay(25);
  });
  await surface.provider.dispose();
  surface.restoreLiveQuery();
}

async function closeRuntime() {
  for (const session of sessions.splice(0)) {
    try {
      await session.client.closeAuth();
      await session.coordinator.close();
    } catch {
      // Preserve the primary assertion.
    }
  }
  await server?.stop();
  server = null;
}

try {
  await mkdir(join(backendRoot, 'generated'), { recursive: true });
  await mkdir(join(backendRoot, 'node_modules', '@expo'), { recursive: true });
  await symlink(
    codegenPackageRoot,
    join(backendRoot, 'node_modules', '@expo', 'snapback-codegen'),
    'dir',
  );
  await writeFile(join(backendRoot, 'codegen.policy.json'), `${JSON.stringify({
    schemaVersion: 'snapback.codegen-policy.v1',
    committedProjections: [],
    authoringProfile: 'snapback-familiar-ts-v1',
  }, null, 2)}\n`);
  await writeFile(join(backendRoot, 'schema.ts'), `
import { defineSchema, defineTable, v } from './generated/server';

export default defineSchema({
  rooms: defineTable({
    ownerId: v.principal(),
    title: v.string(),
  }).visibility({ kind: 'public-read' }),
  roomMemberships: defineTable({
    roomId: v.id('rooms'),
    userId: v.principal(),
    active: v.boolean(),
    removedAt: v.optional(v.integer()),
  })
    .visibility({ kind: 'public-read' })
    .index('by_member', ['roomId', 'userId'], { unique: true })
    .sync(),
  messages: defineTable({
    roomId: v.id('rooms'),
    body: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_room_time', ['roomId', 'createdAt'])
    .sync(),
}, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'rooms.ts'), `
import { mutation, query, v } from './generated/server';

export const listMessages = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['roomMemberships', 'messages'],
  handler: async (ctx, args) => {
    const membership = await ctx.db.query('roomMemberships').withIndex(
      'by_member',
      (q) => q.eq('roomId', args.roomId).eq('userId', ctx.auth.userId),
    ).first();
    const rows = await ctx.db.query('messages').withIndex(
      'by_room_time',
      (q) => q.eq('roomId', args.roomId),
    ).order('createdAt', 'asc').collect();
    if (!membership) return [];
    if (membership.active) return rows;
    return rows.filter((row) => row.createdAt <= membership.removedAt);
  },
});

// This pair reproduces the capstone's split client graph: the message stream
// declares no roster dependence, while membership arrives independently.
export const listPublicMessages = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['messages'],
  handler: async (ctx, args) => ctx.db.query('messages').withIndex(
    'by_room_time',
    (q) => q.eq('roomId', args.roomId),
  ).order('createdAt', 'asc').collect(),
});

export const myMembership = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('roomMemberships')),
  auth: 'authenticated',
  reads: ['roomMemberships'],
  handler: async (ctx, args) => ctx.db.query('roomMemberships').withIndex(
    'by_member',
    (q) => q.eq('roomId', args.roomId).eq('userId', ctx.auth.userId),
  ).collect(),
});

export const createRoom = mutation({
  args: { title: v.string(), memberId: v.principal() },
  returns: v.id('rooms'),
  auth: 'authenticated',
  reads: [],
  writes: ['rooms', 'roomMemberships'],
  handler: async (ctx, args) => {
    const roomId = await ctx.db.insert('rooms', {
      ownerId: ctx.auth.userId,
      title: args.title,
    });
    await ctx.db.insert('roomMemberships', {
      roomId,
      userId: ctx.auth.userId,
      active: true,
    });
    await ctx.db.insert('roomMemberships', {
      roomId,
      userId: args.memberId,
      active: true,
    });
    return roomId;
  },
});

export const removeMember = mutation({
  args: { roomId: v.id('rooms'), memberId: v.principal() },
  returns: v.integer(),
  auth: 'authenticated',
  reads: ['rooms', 'roomMemberships'],
  writes: ['roomMemberships'],
  handler: async (ctx, args) => {
    const room = await ctx.db.get('rooms', args.roomId);
    if (!room || room.ownerId !== ctx.auth.userId) ctx.refuse('ROOM_OWNER_REQUIRED');
    const membership = await ctx.db.query('roomMemberships').withIndex(
      'by_member',
      (q) => q.eq('roomId', args.roomId).eq('userId', args.memberId),
    ).first();
    if (!membership) ctx.refuse('MEMBERSHIP_REQUIRED');
    const removedAt = ctx.runtime.now();
    await ctx.db.patch('roomMemberships', membership._id, {
      active: false,
      removedAt,
    });
    return removedAt;
  },
});

export const sendMessage = mutation({
  args: { roomId: v.id('rooms'), body: v.string() },
  returns: v.id('messages'),
  auth: 'authenticated',
  reads: ['rooms', 'roomMemberships'],
  writes: ['rooms', 'messages'],
  handler: async (ctx, args) => {
    const membership = await ctx.db.query('roomMemberships').withIndex(
      'by_member',
      (q) => q.eq('roomId', args.roomId).eq('userId', ctx.auth.userId),
    ).first();
    if (!membership?.active) ctx.refuse('MEMBERSHIP_REQUIRED');
    return ctx.db.insert('messages', {
      roomId: args.roomId,
      body: args.body,
      createdAt: ctx.runtime.now(),
    });
  },
});
`);
  const undeclaredGeneration = await generate(backendRoot);
  assert.equal(undeclaredGeneration.ok, true, JSON.stringify(undeclaredGeneration.diagnostics));
  const ordinaryRosterSteering = undeclaredGeneration.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_ORDINARY_ROSTER_AUTHORITY_UNDECLARED',
  );
  assert(ordinaryRosterSteering, JSON.stringify(undeclaredGeneration.diagnostics));
  assert.equal(
    ordinaryRosterSteering.repairClass,
    'use-generated-membership-authority-operation',
  );
  assert.equal(
    ordinaryRosterSteering.guideAnchor,
    '/_snapback/guide/auth/scoped-roles.md#keep-pre-removal-history-without-live-delivery',
  );
  assert.deepEqual(ordinaryRosterSteering.heuristicEvidence.lifecycleFields, [
    'active', 'removedAt',
  ]);
  assert.deepEqual(ordinaryRosterSteering.heuristicEvidence.writeOperations, [
    'rooms.removeMember',
  ]);
  assert.deepEqual(ordinaryRosterSteering.heuristicEvidence.gatingOperations, [
    'rooms.listMessages',
  ]);
  assert.match(ordinaryRosterSteering.detectionScope, /same-handler/u);
  assert.match(ordinaryRosterSteering.detectionScope, /not statically linked/u);
  assert.deepEqual(ordinaryRosterSteering.heuristicEvidence.resultGateFacts, [
    {
      sourceTable: 'roomMemberships',
      field: 'active',
      resultTable: 'messages',
      form: 'conditional-return',
    },
    {
      sourceTable: 'roomMemberships',
      field: 'removedAt',
      resultTable: 'messages',
      form: 'filter-return',
    },
  ]);

  const undeclaredOutputRoot = join(backendRoot, 'generated');
  const undeclaredSchema = await readJson(join(undeclaredOutputRoot, 'schema.manifest.json'));
  const undeclaredFunctions = await readJson(join(undeclaredOutputRoot, 'functions.manifest.json'));
  const undeclaredListMessages = undeclaredFunctions.functions.find(
    ({ name }) => name === 'rooms.listMessages',
  );
  const undeclaredPublicMessages = undeclaredFunctions.functions.find(
    ({ name }) => name === 'rooms.listPublicMessages',
  );
  const undeclaredMyMembership = undeclaredFunctions.functions.find(
    ({ name }) => name === 'rooms.myMembership',
  );
  assert.deepEqual(undeclaredListMessages.readSetSummary.tables, [
    'roomMemberships', 'messages',
  ]);
  assert.deepEqual(undeclaredPublicMessages.readSetSummary.tables, ['messages']);
  assert.deepEqual(undeclaredMyMembership.readSetSummary.tables, ['roomMemberships']);
  const { api: undeclaredApi } = await importGeneratedModule(undeclaredOutputRoot, 'api.mjs');
  const undeclaredCarrier = join(scratch, 'undeclared-startup-artifacts.json');
  await writeFile(
    undeclaredCarrier,
    `${JSON.stringify({
      formatVersion: 1,
      schema: undeclaredSchema,
      functions: undeclaredFunctions,
    })}\n`,
    { mode: 0o600 },
  );
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: undeclaredCarrier,
    captureImpersonationCapability: true,
  });
  const undeclaredOwner = await mintSession(
    undeclaredSchema.appId,
    'ordinary-owner@familiar-live-cutoff.test',
    'familiar-live-cutoff-ordinary-owner',
  );
  const undeclaredRemoved = await mintSession(
    undeclaredSchema.appId,
    'ordinary-removed@familiar-live-cutoff.test',
    'familiar-live-cutoff-ordinary-removed',
  );
  const undeclaredRoomId = (await undeclaredOwner.client.mutate(
    undeclaredApi.rooms.createRoom,
    {
      args: {
        title: 'Undeclared public roster characterization',
        memberId: undeclaredRemoved.credential.session.userId,
      },
    },
  )).result;
  await undeclaredOwner.client.mutate(undeclaredApi.rooms.sendMessage, {
    args: { roomId: undeclaredRoomId, body: 'before-removal' },
  });
  const undeclaredRemovedUpdates = [];
  const undeclaredRemovedBoundaries = [];
  const undeclaredRemovedHandle = await undeclaredRemoved.client.liveQuery(
    undeclaredApi.rooms.listMessages,
    {
      args: { roomId: undeclaredRoomId },
      connectionId: 'familiar-live-cutoff-ordinary-removed',
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate(rows, detail) {
        undeclaredRemovedUpdates.push({ bodies: bodies(rows), kind: detail?.kind ?? null });
      },
      onAuthorizationBoundary(rows, detail) {
        undeclaredRemovedBoundaries.push({
          bodies: bodies(rows), kind: detail?.kind ?? null,
        });
      },
    },
  );
  const splitComposition = {
    browserCutoffAt: null,
    membershipRows: [],
    messageRows: [],
    frames: [],
  };
  const composeSplitClientState = (source) => {
    const membership = splitComposition.membershipRows[0] ?? null;
    if (membership?.active === false && splitComposition.browserCutoffAt === null) {
      splitComposition.browserCutoffAt = Date.now();
    }
    const visibleRows = membership?.active === false
      ? splitComposition.messageRows.filter(({ createdAt }) => (
          createdAt <= splitComposition.browserCutoffAt
        ))
      : splitComposition.messageRows;
    splitComposition.frames.push({
      source,
      membershipActive: membership?.active ?? null,
      browserCutoffAt: splitComposition.browserCutoffAt,
      rawMessageBodies: bodies(splitComposition.messageRows),
      composedBodies: bodies(visibleRows),
    });
  };
  const splitMembershipUpdates = [];
  const splitMembershipHandle = await undeclaredRemoved.client.liveQuery(
    undeclaredApi.rooms.myMembership,
    {
      args: { roomId: undeclaredRoomId },
      connectionId: 'familiar-live-cutoff-split-membership',
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate(rows, detail) {
        splitComposition.membershipRows = rows;
        splitMembershipUpdates.push({
          active: rows[0]?.active ?? null,
          removedAt: rows[0]?.removedAt ?? null,
          kind: detail?.kind ?? null,
        });
        composeSplitClientState('membership');
      },
    },
  );
  splitComposition.membershipRows = splitMembershipHandle.rows;
  composeSplitClientState('membership-initial');
  const splitMessageUpdates = [];
  const splitMessageHandle = await undeclaredRemoved.client.liveQuery(
    undeclaredApi.rooms.listPublicMessages,
    {
      args: { roomId: undeclaredRoomId },
      connectionId: 'familiar-live-cutoff-split-messages',
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate(rows, detail) {
        splitComposition.messageRows = rows;
        splitMessageUpdates.push({ bodies: bodies(rows), kind: detail?.kind ?? null });
        composeSplitClientState('messages');
      },
    },
  );
  splitComposition.messageRows = splitMessageHandle.rows;
  composeSplitClientState('messages-initial');
  const undeclaredOwnerHandle = await undeclaredOwner.client.liveQuery(
    undeclaredApi.rooms.listMessages,
    {
      args: { roomId: undeclaredRoomId },
      connectionId: 'familiar-live-cutoff-ordinary-owner',
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate() {},
    },
  );
  assert.deepEqual(bodies(undeclaredRemovedHandle.rows), ['before-removal']);
  assert.equal(splitMembershipHandle.rows[0]?.active, true);
  assert.deepEqual(bodies(splitMessageHandle.rows), ['before-removal']);
  const undeclaredRemovedPreRemovalFrame = undeclaredRemovedUpdates.length;
  const undeclaredBeforeInspect = await undeclaredOwner.client.inspect();
  const undeclaredRemoval = await undeclaredOwner.client.mutate(
    undeclaredApi.rooms.removeMember,
    {
      args: {
        roomId: undeclaredRoomId,
        memberId: undeclaredRemoved.credential.session.userId,
      },
    },
  );
  await eventually(
    () => {
      const removalUpdates = undeclaredRemovedUpdates.slice(
        undeclaredRemovedPreRemovalFrame,
      );
      assert(removalUpdates.length > 0, 'removed client did not reevaluate the removal');
      assert.deepEqual(removalUpdates.at(-1).bodies, ['before-removal']);
    },
    'ordinary-roster removed client did not observe the removal reevaluation',
  );
  // Separate the persisted server timestamps; this characterizes the app
  // predicate only. The delivery-fence proof below uses the no-cutoff query
  // and the forced predecessor-epoch integration test instead of this delay.
  await delay(2);
  const undeclaredSentinel = 'ordinary-after-removal-sentinel';
  const undeclaredRemovedPreSendFrame = undeclaredRemovedUpdates.length;
  await undeclaredOwner.client.mutate(undeclaredApi.rooms.sendMessage, {
    args: { roomId: undeclaredRoomId, body: undeclaredSentinel },
  });
  await eventually(
    () => assert.deepEqual(
      bodies(undeclaredOwnerHandle.rows),
      ['before-removal', undeclaredSentinel],
    ),
    'ordinary-roster owner subscription did not prove data-lane progress',
  );
  await eventually(
    () => {
      const postSendUpdates = undeclaredRemovedUpdates.slice(undeclaredRemovedPreSendFrame);
      assert(postSendUpdates.length > 0, 'removed client received no post-send reevaluation');
      assert.deepEqual(postSendUpdates.at(-1).bodies, ['before-removal']);
      assert.deepEqual(bodies(undeclaredRemovedHandle.rows), ['before-removal']);
    },
    'ordinary-roster read-set reevaluation did not enforce its server cutoff',
  );
  await eventually(
    () => {
      assert.equal(splitMembershipHandle.rows[0]?.active, false);
      assert(
        splitMembershipUpdates.some(({ active }) => active === false),
        'independent membership stream never showed removal',
      );
    },
    'split membership stream did not show the ordinary removal',
  );
  await eventually(
    () => {
      assert(
        bodies(splitMessageHandle.rows).includes(undeclaredSentinel),
        'messages-only public-read stream did not retain the sentinel',
      );
      assert(
        splitMessageUpdates.some(({ bodies: frameBodies }) => (
          frameBodies.includes(undeclaredSentinel)
        )),
        'messages-only stream callback never observed the sentinel',
      );
    },
    'split messages stream did not expose the undeclared data lane',
  );
  const undeclaredFresh = await undeclaredRemoved.client.query(
    undeclaredApi.rooms.listMessages,
    { args: { roomId: undeclaredRoomId } },
  );
  const undeclaredAfterInspect = await undeclaredOwner.client.inspect();
  assert.deepEqual(undeclaredRemoval.authorityTransitions ?? [], []);
  assert.equal(
    undeclaredAfterInspect.liveAuthority.fencesApplied,
    undeclaredBeforeInspect.liveAuthority.fencesApplied,
  );
  assert.equal(
    undeclaredRemovedBoundaries.some(({ kind }) => kind === 'authorization_quarantine'),
    false,
    'ordinary roster commits must not be misreported as an authorization-epoch quarantine',
  );
  assert(
    undeclaredRemovedBoundaries.every(({ kind }) => kind === 'authorization_snapshot'),
    `unexpected ordinary-roster boundary: ${JSON.stringify(undeclaredRemovedBoundaries)}`,
  );
  assert.equal(
    undeclaredRemovedUpdates.some(({ bodies: frameBodies }) => (
      frameBodies.includes(undeclaredSentinel)
    )),
    false,
  );
  assert.deepEqual(bodies(undeclaredFresh.rows), ['before-removal']);
  const undeclaredCharacterization = {
    authoringPosture: 'ordinary-public-sync-roster-without-authority-declaration',
    generatedReadSet: undeclaredListMessages.readSetSummary,
    steering: {
      code: ordinaryRosterSteering.code,
      repairClass: ordinaryRosterSteering.repairClass,
      guideAnchor: ordinaryRosterSteering.guideAnchor,
      heuristicEvidence: ordinaryRosterSteering.heuristicEvidence,
    },
    removalAuthorityTransitions: undeclaredRemoval.authorityTransitions ?? [],
    liveEvaluationDelta: undeclaredAfterInspect.liveEvaluation.evaluationsStarted
      - undeclaredBeforeInspect.liveEvaluation.evaluationsStarted,
    fenceDelta: undeclaredAfterInspect.liveAuthority.fencesApplied
      - undeclaredBeforeInspect.liveAuthority.fencesApplied,
    freshReadAfterSend: bodies(undeclaredFresh.rows),
    removedFinalRows: bodies(undeclaredRemovedHandle.rows),
    ownerProgress: bodies(undeclaredOwnerHandle.rows),
    authorizationBoundaries: undeclaredRemovedBoundaries.map((boundary) => ({ ...boundary })),
    observedForbiddenDelivery: undeclaredRemovedUpdates.some(
      ({ bodies: frameBodies }) => frameBodies.includes(undeclaredSentinel),
    ),
    splitComposition: {
      membershipReadSet: undeclaredMyMembership.readSetSummary,
      messagesReadSet: undeclaredPublicMessages.readSetSummary,
      membershipUpdates: splitMembershipUpdates.map((update) => ({ ...update })),
      messageUpdates: splitMessageUpdates.map((update) => ({
        ...update,
        bodies: [...update.bodies],
      })),
      rawMessagesFinal: bodies(splitMessageHandle.rows),
      membershipActiveFinal: splitMembershipHandle.rows[0]?.active ?? null,
      frames: splitComposition.frames.map((frame) => ({
        ...frame,
        rawMessageBodies: [...frame.rawMessageBodies],
        composedBodies: [...frame.composedBodies],
      })),
      transientBubbleObserved: splitComposition.frames.some(({ composedBodies }) => (
        composedBodies.includes(undeclaredSentinel)
      )),
      guarantee: 'membership-removal-and-raw-message-delivery-only; cross-stream-composition-order-is-app-owned',
    },
  };
  await undeclaredRemovedHandle.dispose();
  await undeclaredOwnerHandle.dispose();
  await splitMembershipHandle.dispose();
  await splitMessageHandle.dispose();
  await closeRuntime();

  await writeFile(join(backendRoot, 'schema.ts'), `
import { defineSchema, defineTable, v } from './generated/server';

export const roomMemberships = defineTable({
    roomId: v.id('rooms'),
    userId: v.principal(),
    role: v.string(),
  })
    .visibility({ kind: 'owner', field: 'userId' })
    .membership({
      id: 'roomMemberships',
      principal: 'userId',
      resource: 'roomId',
      role: 'role',
      roles: ['owner', 'member', 'former'],
      bootstrapRole: 'owner',
      lastHolder: { protect: 'owner' },
      provenance: 'full',
      transitions: [
        { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
        { op: 'setRole', by: ['owner'], target: 'other', from: ['member'], to: ['former'] },
        { op: 'setRole', by: ['owner'], target: 'other', from: ['former'], to: ['member'] },
      ],
    })
    .authorityProfile({
      name: 'roomMemberships',
      hierarchy: { owner: ['member', 'former'], member: [], former: [] },
      roster: { visible: ['userId', 'role'] },
    });

export default defineSchema({
  rooms: defineTable({ title: v.string() }).visibility({ kind: 'public-read' }),
  roomMemberships,
  accessWindows: defineTable({
    roomId: v.id('rooms'),
    userId: v.principal(),
    accessKey: v.string(),
    cutoffAt: v.optional(v.integer()),
  })
    .visibility({ kind: 'public-read' })
    .index('by_access', ['accessKey'], { unique: true }),
  messages: defineTable({
    roomId: v.id('rooms'),
    body: v.string(),
    createdAt: v.integer(),
  })
    .visibility({ kind: 'public-read' })
    .index('by_room_time', ['roomId', 'createdAt']),
}, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'rooms.ts'), `
import { mutation, query, v } from './generated/server';
import { membershipResource } from './generated/server';
import { roomMemberships } from './schema';

export const listMessages = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['messages', 'accessWindows'],
  membership: [roomMemberships.memberOf(membershipResource.arg('roomId'))],
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('messages')
      .withIndex('by_room_time', (q) => q.eq('roomId', args.roomId))
      .order('createdAt', 'asc')
      .collect();
    const access = await ctx.db
      .query('accessWindows')
      .withIndex('by_access', (q) => q.eq(
        'accessKey',
        args.roomId + ':' + ctx.auth.userId,
      ))
      .first();
    if (!access) return [];
    if (!access.cutoffAt) return rows;
    return rows.filter((row) => row.createdAt <= access.cutoffAt);
  },
});

// No cutoff or application-level visibility filter: after the role change,
// only the declared authority transition and delivery-time epoch gate can
// reject a frame evaluated under the predecessor role.
export const listCurrentMessages = query({
  args: { roomId: v.id('rooms') },
  returns: v.array(v.doc('messages')),
  auth: 'authenticated',
  reads: ['messages'],
  membership: [roomMemberships.hasRole(membershipResource.arg('roomId'), 'member')],
  handler: async (ctx, args) => ctx.db
    .query('messages')
    .withIndex('by_room_time', (q) => q.eq('roomId', args.roomId))
    .order('createdAt', 'asc')
    .collect(),
});

export const createRoom = mutation({
  args: { title: v.string(), memberId: v.principal() },
  returns: v.id('rooms'),
  auth: 'authenticated',
  reads: [],
  writes: ['roomMemberships', 'accessWindows'],
  handler: async (ctx, args) => {
    const roomId = await ctx.membership.roomMemberships.bootstrap(
      { title: args.title },
      [{ userId: args.memberId, role: 'member' }],
    );
    await ctx.db.insert('accessWindows', {
      roomId,
      userId: ctx.auth.userId,
      accessKey: roomId + ':' + ctx.auth.userId,
    });
    await ctx.db.insert('accessWindows', {
      roomId,
      userId: args.memberId,
      accessKey: roomId + ':' + args.memberId,
    });
    return roomId;
  },
});

export const closeAccessWindow = mutation({
  args: { roomId: v.id('rooms'), memberId: v.principal() },
  returns: v.integer(),
  auth: 'authenticated',
  reads: ['accessWindows'],
  writes: ['accessWindows'],
  membership: [roomMemberships.hasRole(membershipResource.arg('roomId'), 'owner')],
  handler: async (ctx, args) => {
    const access = await ctx.db.query('accessWindows').withIndex(
      'by_access',
      (q) => q.eq('accessKey', args.roomId + ':' + args.memberId),
    ).first();
    if (!access) ctx.refuse('MEMBERSHIP_REQUIRED');
    const cutoffAt = ctx.runtime.now();
    await ctx.db.patch('accessWindows', access._id, { cutoffAt });
    return cutoffAt;
  },
});

export const sendMessage = mutation({
  args: { roomId: v.id('rooms'), body: v.string() },
  returns: v.id('messages'),
  auth: 'authenticated',
  reads: [],
  writes: ['messages'],
  membership: [roomMemberships.hasRole(membershipResource.arg('roomId'), 'member')],
  handler: async (ctx, args) => ctx.db.insert('messages', {
      ...args,
      createdAt: ctx.runtime.now(),
    }),
});
`);

  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const outputRoot = join(backendRoot, 'generated');
  const schema = await readJson(join(outputRoot, 'schema.manifest.json'));
  const functions = await readJson(join(outputRoot, 'functions.manifest.json'));
  const listMessages = functions.functions.find(({ name }) => name === 'rooms.listMessages');
  const listCurrentMessages = functions.functions.find(
    ({ name }) => name === 'rooms.listCurrentMessages',
  );
  assert(listMessages, 'Familiar listMessages operation was not generated');
  assert(listCurrentMessages, 'Familiar epoch-gate control operation was not generated');
  assert.deepEqual(listCurrentMessages.readSetSummary.tables, [
    'messages', 'roomMemberships',
  ]);
  assert.equal(listCurrentMessages.readSetSummary.primaryTable, 'messages');
  assert.equal(
    listCurrentMessages.readSetSummary.tables.includes('accessWindows'),
    false,
    'epoch-gate control must not depend on the application cutoff table',
  );
  const { api, app } = await importGeneratedModule(outputRoot, 'api.mjs');
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(
    carrier,
    `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`,
    { mode: 0o600 },
  );
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });

  const owner = await mintSession(
    schema.appId,
    'owner@familiar-live-cutoff.test',
    'familiar-live-cutoff-owner',
  );
  const removedMember = await mintSession(
    schema.appId,
    'removed@familiar-live-cutoff.test',
    'familiar-live-cutoff-removed',
  );
  const roomId = (await owner.client.mutate(api.rooms.createRoom, {
    args: {
      title: 'Familiar live cutoff',
      memberId: removedMember.credential.session.userId,
    },
  })).result;
  await owner.client.mutate(api.rooms.sendMessage, {
    args: { roomId, body: 'before-removal' },
  });

  const removedUpdates = [];
  const removedBoundaries = [];
  const removedHandle = await removedMember.client.liveQuery(api.rooms.listMessages, {
    args: { roomId },
    connectionId: 'familiar-live-cutoff-removed',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(rows, detail) {
      removedUpdates.push({ bodies: bodies(rows), kind: detail?.kind ?? null });
    },
    onAuthorizationBoundary(rows, detail) {
      removedBoundaries.push({ bodies: bodies(rows), kind: detail?.kind ?? null });
    },
  });
  assert.deepEqual(bodies(removedHandle.rows), ['before-removal']);
  familiarSurface = await mountFamiliarSurface(
    removedMember.client,
    app,
    api.rooms.listMessages,
    { roomId },
  );

  let transitionSettled = false;
  const epochUpdates = [];
  const epochBoundaries = [];
  const epochHandle = await removedMember.client.liveQuery(
    api.rooms.listCurrentMessages,
    {
      args: { roomId },
      connectionId: 'familiar-live-cutoff-epoch-gate',
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate(rows, detail) {
        epochUpdates.push({
          bodies: bodies(rows),
          kind: detail?.kind ?? null,
          afterTransitionSettlement: transitionSettled,
        });
      },
      onAuthorizationBoundary(rows, detail) {
        epochBoundaries.push({
          bodies: bodies(rows),
          kind: detail?.kind ?? null,
          afterTransitionSettlement: transitionSettled,
        });
      },
    },
  );
  assert.deepEqual(bodies(epochHandle.rows), ['before-removal']);

  const ownerUpdates = [];
  const ownerHandle = await owner.client.liveQuery(api.rooms.listMessages, {
    args: { roomId },
    connectionId: 'familiar-live-cutoff-owner',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(rows, detail) {
      ownerUpdates.push({ bodies: bodies(rows), kind: detail?.kind ?? null });
    },
  });
  assert.deepEqual(bodies(ownerHandle.rows), ['before-removal']);

  const cutoff = await owner.client.mutate(api.rooms.closeAccessWindow, {
    args: {
      roomId,
      memberId: removedMember.credential.session.userId,
    },
  });
  // This message commits under the predecessor role and after the persisted
  // history cutoff. The no-cutoff listCurrentMessages control is the only
  // removed-member query for which a predecessor-epoch frame can include it.
  await delay(2);
  const preEpochSentinel = 'pre-epoch-only-sentinel';
  const authorityBefore = await owner.client.inspect();
  await owner.client.mutate(api.rooms.sendMessage, {
    args: { roomId, body: preEpochSentinel },
  });
  const familiarTransitionFrame = familiarSurface.frames.length;
  const removedTransitionUpdateFrame = removedUpdates.length;
  const removedTransitionBoundaryFrame = removedBoundaries.length;
  const epochTransitionUpdateFrame = epochUpdates.length;
  const epochTransitionBoundaryFrame = epochBoundaries.length;
  const removal = await owner.client.mutate(api.roomMemberships.changeRole, {
    args: {
      scopeId: roomId,
      principal: removedMember.credential.session.userId,
      role: 'former',
    },
  });
  transitionSettled = true;
  assert.equal(listMessages.authorityProfileDependence?.length, 1);
  assert.equal(listCurrentMessages.authorityProfileDependence?.length, 1);
  assert.equal(removal.authorityTransitions?.length, 1);
  assert.deepEqual(removal.authorityTransitions[0].predecessor, {
    role: 'member',
    status: 'active',
  });
  assert.deepEqual(removal.authorityTransitions[0].successor, {
    role: 'former',
    status: 'active',
  });
  assert.equal(
    removal.authorityTransitions[0].invalidationDisposition,
    'global-authorization-epoch-advanced',
  );
  const sentinel = 'post-transition-sentinel';
  await owner.client.mutate(api.rooms.sendMessage, {
    args: { roomId, body: sentinel },
  });
  await eventually(
    () => assert.deepEqual(
      bodies(ownerHandle.rows),
      ['before-removal', preEpochSentinel, sentinel],
    ),
    'owner control subscription did not prove post-removal delivery progress',
  );
  await eventually(
    () => assert(
      removedUpdates
        .slice(removedTransitionUpdateFrame)
        .some(({ kind }) => kind === 'authorization_quarantine'),
      'removed member never crossed a fail-closed authorization boundary',
    ),
    'membership role transition did not quarantine the open subscription',
  );
  await eventually(
    () => assert(
      removedBoundaries
        .slice(removedTransitionBoundaryFrame)
        .some(({ kind }) => kind === 'authorization_snapshot'),
      'removed member never received a restored authorization snapshot',
    ),
    'membership role transition did not restore the retained-history subscription',
  );
  await eventually(
    () => assert.deepEqual(bodies(removedHandle.rows), ['before-removal']),
    'removed member did not retain the pre-removal history',
  );
  await eventually(
    () => assert.deepEqual(bodies(epochHandle.rows), []),
    'the no-cutoff role-gated subscription did not blank after removal',
  );
  await eventually(
    () => assert(
      epochBoundaries
        .slice(epochTransitionBoundaryFrame)
        .some(({ kind }) => kind === 'authorization_quarantine'),
      'the no-cutoff role-gated subscription never crossed quarantine',
    ),
    'the epoch-gate control did not observe its authorization boundary',
  );
  await eventually(
    () => assert(
      familiarSurface.frames
        .slice(familiarTransitionFrame)
        .some(({ projectedDefined }) => projectedDefined === false),
      'Familiar useQuery never blanked during quarantine',
    ),
    'Familiar projection did not expose the quarantine blank',
  );
  await eventually(
    () => {
      assert.equal(familiarSurface.current?.projectedDefined, true);
      assert.equal(familiarSurface.current?.status, 'ready');
      assert.equal(familiarSurface.current?.freshness, 'current');
      assert.equal(familiarSurface.current?.connection, 'live');
      assert.deepEqual(familiarSurface.current?.bodies, ['before-removal']);
      assert.deepEqual(familiarSurface.current?.stateBodies, ['before-removal']);
    },
    'Familiar retained-history subscription did not restore current data',
  );

  const authorityAfter = await eventually(
    async () => {
      const inspection = await owner.client.inspect();
      assert(
        inspection.liveAuthority.fencesApplied
          > authorityBefore.liveAuthority.fencesApplied,
        'declared transition did not apply an authority fence',
      );
      assert(
        inspection.liveAuthority.restorationsCompleted
          > authorityBefore.liveAuthority.restorationsCompleted,
        'declared transition did not complete restoration',
      );
      return inspection;
    },
    'authority fence/restoration counters did not advance',
  );

  const postRemovalFreshRead = await removedMember.client.query(
    api.rooms.listMessages,
    { args: { roomId } },
  );
  const postRemovalFreshEpochRead = await removedMember.client.query(
    api.rooms.listCurrentMessages,
    { args: { roomId } },
  );
  assert.deepEqual(
    bodies(postRemovalFreshEpochRead.rows),
    [],
    'fresh no-cutoff role-gated read retained predecessor-role rows',
  );
  assert.deepEqual(bodies(postRemovalFreshRead.rows), ['before-removal']);
  const removedAuthorizationState = removedHandle.authorizationState();
  assert(removedAuthorizationState, 'retained-history handle lacks authorization state');
  assert.equal(removedAuthorizationState.terminalDeleted, false);
  assert.deepEqual(removedAuthorizationState.pendingByScope, {});
  assert.equal(
    Object.values(removedAuthorizationState.scopeState)
      .some(({ lastAckToken }) => typeof lastAckToken === 'string'),
    true,
    'restored history did not exact-acknowledge its authorization snapshot',
  );
  const transitionLifecycleEpochUpdates = epochUpdates.slice(epochTransitionUpdateFrame);
  const transitionLifecycleEpochBoundaries = epochBoundaries.slice(epochTransitionBoundaryFrame);
  assert(
    transitionLifecycleEpochUpdates.length > 0
      || transitionLifecycleEpochBoundaries.length > 0,
    'the epoch-gate subscription published no post-transition lifecycle frame',
  );
  const postTransitionEpochUpdates = epochUpdates.filter(
    ({ afterTransitionSettlement }) => afterTransitionSettlement,
  );
  assert.equal(
    postTransitionEpochUpdates.some(({ bodies: frameBodies }) => (
      frameBodies.includes(preEpochSentinel) || frameBodies.includes(sentinel)
    )),
    false,
    'a predecessor/post-transition sentinel reached the role-gated stream after transition',
  );
  const observedForbiddenDelivery = removedUpdates.some(
    ({ bodies: updateBodies }) => (
      updateBodies.includes(preEpochSentinel) || updateBodies.includes(sentinel)
    ),
  );
  const reactObservedForbiddenDelivery = familiarSurface.frames.some(
    ({ bodies: frameBodies }) => (
      frameBodies.includes(preEpochSentinel) || frameBodies.includes(sentinel)
    ),
  );
  const transcript = {
    schemaVersion: 'snapback.familiar-removed-member-live-cutoff.v2',
    authoringProfile: 'snapback-familiar-ts-v1',
    authoringPosture: 'profiled-membership-former-role-cutoff',
    undeclaredRosterCharacterization: undeclaredCharacterization,
    generatedAuthorityDependence: listMessages.authorityProfileDependence ?? [],
    generatedReadSet: listMessages.readSetSummary,
    epochGateReadSet: listCurrentMessages.readSetSummary,
    removalAuthorityTransitions: removal.authorityTransitions ?? [],
    cutoffAt: cutoff.result,
    freshReadAfterSend: bodies(postRemovalFreshRead.rows),
    epochGateFreshReadAfterSend: bodies(postRemovalFreshEpochRead.rows),
    ownerProgress: bodies(ownerHandle.rows),
    removedFinalRows: bodies(removedHandle.rows),
    epochGateFinalRows: bodies(epochHandle.rows),
    removedAuthorizationState,
    removedUpdates,
    removedBoundaries,
    epochUpdates,
    epochBoundaries,
    authorityFenceDelta: authorityAfter.liveAuthority.fencesApplied
      - authorityBefore.liveAuthority.fencesApplied,
    authorityRestorationDelta: authorityAfter.liveAuthority.restorationsCompleted
      - authorityBefore.liveAuthority.restorationsCompleted,
    staleAuthorityFrameDiscardDelta:
      authorityAfter.liveAuthority.staleAuthorityFramesDiscarded
        - authorityBefore.liveAuthority.staleAuthorityFramesDiscarded,
    familiarReactFrames: familiarSurface.frames,
    familiarPostTransitionFrames: familiarSurface.frames.slice(familiarTransitionFrame),
    ownerUpdates,
    observedForbiddenDelivery,
    reactObservedForbiddenDelivery,
  };
  process.stdout.write(`${JSON.stringify(transcript, null, 2)}\n`);

  assert.equal(
    observedForbiddenDelivery,
    false,
    `removed member observed post-removal message: ${JSON.stringify(transcript)}`,
  );
  assert.equal(
    reactObservedForbiddenDelivery,
    false,
    `Familiar hook observed post-removal message: ${JSON.stringify(transcript)}`,
  );
  assert.equal(
    bodies(removedHandle.rows).some((body) => (
      body === preEpochSentinel || body === sentinel
    )),
    false,
    'removed member retained a post-cutoff message',
  );

  await removedHandle.dispose();
  await epochHandle.dispose();
  await ownerHandle.dispose();
  await disposeFamiliarSurface(familiarSurface);
  familiarSurface = null;
} finally {
  if (familiarSurface !== null) {
    try {
      await disposeFamiliarSurface(familiarSurface);
    } catch {
      // Preserve the primary assertion.
    }
  }
  await closeRuntime();
  await rm(scratch, { recursive: true, force: true });
}
