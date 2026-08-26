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
      return assertion();
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
      bodies: bodies(Array.isArray(rows) ? rows : []),
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
  roomMemberships: defineTable({
    userId: v.principal(),
    active: v.boolean(),
  })
    .visibility({ kind: 'public-read' })
    .permissionBacking(['active']),
}, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'rooms.ts'), `
import { mutation, v } from './generated/server';

export const removeMember = mutation({
  args: { membershipId: v.id('roomMemberships') },
  returns: v.null(),
  auth: 'authenticated',
  reads: [],
  writes: ['roomMemberships'],
  handler: async (ctx, args) => {
    await ctx.db.patch('roomMemberships', args.membershipId, { active: false });
    return null;
  },
});
`);
  const trappedGeneration = await generate(backendRoot);
  assert.equal(trappedGeneration.ok, false);
  const trappedWriter = trappedGeneration.diagnostics.find(
    ({ code }) => code === 'SNAPBACK_TABLE_WRITE_AUTHORITY_TABLE_INELIGIBLE',
  );
  assert(trappedWriter, JSON.stringify(trappedGeneration.diagnostics));
  assert.equal(
    trappedWriter.repairClass,
    'use-generated-membership-authority-operation',
  );
  assert.equal(
    trappedWriter.guideAnchor,
    '/_snapback/guide/auth/scoped-roles.md#keep-pre-removal-history-without-live-delivery',
  );

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
  assert(listMessages, 'Familiar listMessages operation was not generated');
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
  // Keep the later message strictly beyond the persisted cutoff without
  // giving the not-yet-issued authorization transition any head start.
  await delay(2);
  const removal = await owner.client.mutate(api.roomMemberships.changeRole, {
    args: {
      scopeId: roomId,
      principal: removedMember.credential.session.userId,
      role: 'former',
    },
  });
  assert.equal(listMessages.authorityProfileDependence?.length, 1);
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
  const sentinel = 'after-removal-sentinel';
  await owner.client.mutate(api.rooms.sendMessage, {
    args: { roomId, body: sentinel },
  });
  await eventually(
    () => assert.deepEqual(bodies(ownerHandle.rows), ['before-removal', sentinel]),
    'owner control subscription did not prove post-removal delivery progress',
  );
  await eventually(
    () => assert(
      removedUpdates.some(({ kind }) => kind === 'authorization_quarantine'),
      'removed member never crossed a fail-closed authorization boundary',
    ),
    'membership role transition did not quarantine the open subscription',
  );
  await eventually(
    () => assert.deepEqual(bodies(removedHandle.rows), ['before-removal']),
    'removed member did not retain the pre-removal history',
  );
  await delay(250);

  const postRemovalFreshRead = await removedMember.client.query(
    api.rooms.listMessages,
    { args: { roomId } },
  );
  const observedForbiddenDelivery = removedUpdates.some(
    ({ bodies: updateBodies }) => updateBodies.includes(sentinel),
  );
  const reactObservedForbiddenDelivery = familiarSurface.frames.some(
    ({ bodies: frameBodies }) => frameBodies.includes(sentinel),
  );
  const transcript = {
    schemaVersion: 'snapback.familiar-removed-member-live-cutoff.v1',
    authoringProfile: 'snapback-familiar-ts-v1',
    authoringPosture: 'profiled-membership-former-role-cutoff',
    generatedAuthorityDependence: listMessages.authorityProfileDependence ?? [],
    trappedWriterRepair: {
      code: trappedWriter.code,
      repairClass: trappedWriter.repairClass,
      guideAnchor: trappedWriter.guideAnchor,
    },
    generatedReadSet: listMessages.readSetSummary,
    removalAuthorityTransitions: removal.authorityTransitions ?? [],
    cutoffAt: cutoff.result,
    freshReadAfterSend: bodies(postRemovalFreshRead.rows),
    ownerProgress: bodies(ownerHandle.rows),
    removedFinalRows: bodies(removedHandle.rows),
    removedAuthorizationState: removedHandle.authorizationState(),
    removedUpdates,
    removedBoundaries,
    familiarReactFrames: familiarSurface.frames,
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
    bodies(removedHandle.rows).includes(sentinel),
    false,
    'removed member retained the post-removal message',
  );

  await removedHandle.dispose();
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
  for (const session of sessions) {
    try {
      await session.client.closeAuth();
      await session.coordinator.close();
    } catch {
      // Preserve the primary assertion.
    }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
