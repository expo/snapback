import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

// @ref LLP 0053#invalidation-is-an-obligation-not-a-message — a
// declaration-bound membership event must blank the live boundary, transfer a
// terminal-delete proof, and exact-ACK before the scenario can complete.
// @ref LLP 0056#invalidation-the-llp-0053-mapping — both resource and app
// membership delete/downgrade paths exercise the same generic invalidation.
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-require-role-revocation-'));
const backendRoot = join(scratch, 'snapback');
const sessions = [];
let server = null;

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

try {
  await mkdir(backendRoot, { recursive: true });
  await writeFile(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@expo/snapback-codegen/define';
export const workspaceMembers = defineTable({
  workspaceId: v.id('workspaces'),
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'workspaceMembers',
  principal: 'userId',
  resource: 'workspaceId',
  role: 'role',
  roles: ['owner', 'member', 'guest'],
  bootstrapRole: 'owner',
  lastHolder: { protect: 'owner' },
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['owner'], target: 'other', to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['member'], to: ['guest'] },
  ],
});
export const appMembers = defineTable({
  userId: v.principal(),
  role: v.string(),
}).membership({
  id: 'appMembers',
  principal: 'userId',
  role: 'role',
  roles: ['member', 'guest'],
  scope: 'app',
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['member'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['member'] },
    { op: 'setRole', by: ['self'], target: 'self', from: ['member'], to: ['guest'] },
  ],
});
export default defineSchema({
  workspaces: defineTable({ name: v.string(), createdBy: v.principal() }).sync(),
  workspaceMembers,
  appMembers,
  tasks: defineTable({
    workspaceId: v.id('workspaces'),
    title: v.string(),
  }).index('by_workspace', ['workspaceId']).sync(),
  announcements: defineTable({ message: v.string() }).sync(),
  publicNotices: defineTable({ message: v.string() }).sync(),
}, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'functions.mjs'), `
import {
  defineJsLiveQuery,
  defineJsMutation,
  defineLiveQuery,
  v,
} from '@expo/snapback-codegen/define';
export const listPublicNotices = defineLiveQuery({
  table: 'publicNotices',
  args: {},
  auth: 'public',
  authorityIndependent: true,
});
export const listTasks = defineJsLiveQuery({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'listTasks',
  reads: ['workspaceMembers', 'tasks'],
  result: v.object({ workspaceId: v.string(), title: v.string() }),
});
export const listAnnouncements = defineJsLiveQuery({
  auth: 'authenticated',
  args: {},
  source: 'handlers.mjs',
  exportName: 'listAnnouncements',
  reads: ['appMembers', 'announcements'],
  result: v.object({ message: v.string() }),
});
export const bootstrapWorkspace = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'bootstrapWorkspace',
  writes: ['workspaces', 'workspaceMembers', 'tasks'],
});
export const addMember = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces'), userId: v.principal() },
  source: 'handlers.mjs',
  exportName: 'addMember',
  reads: ['workspaceMembers'],
  writes: ['workspaceMembers'],
});
export const leaveWorkspace = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'leaveWorkspace',
  writes: ['workspaceMembers'],
});
export const downgradeWorkspace = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { workspaceId: v.id('workspaces') },
  source: 'handlers.mjs',
  exportName: 'downgradeWorkspace',
  writes: ['workspaceMembers'],
});
export const addTask = defineJsMutation({
  auth: 'authenticated',
  args: { workspaceId: v.id('workspaces'), title: v.string() },
  source: 'handlers.mjs',
  exportName: 'addTask',
  reads: ['workspaceMembers'],
  writes: ['tasks'],
});
export const joinApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'joinApp',
  writes: ['appMembers'],
});
export const leaveApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'leaveApp',
  writes: ['appMembers'],
});
export const downgradeApp = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: {},
  source: 'handlers.mjs',
  exportName: 'downgradeApp',
  writes: ['appMembers'],
});
export const postAnnouncement = defineJsMutation({
  auth: 'authenticated',
  args: { message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postAnnouncement',
  reads: ['appMembers'],
  writes: ['announcements'],
});
export const postPublicNotice = defineJsMutation({
  auth: 'authenticated',
  args: { message: v.string() },
  source: 'handlers.mjs',
  exportName: 'postPublicNotice',
  writes: ['publicNotices'],
});
`);
  await writeFile(join(backendRoot, 'handlers.mjs'), `
async function requireMember(ctx, workspaceId) {
  await ctx.permissions.workspaceMembers.requireRole(workspaceId, 'owner', 'member');
}
globalThis.__snapbackHandlers = {
  async listTasks(ctx, args) {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db.query('tasks').withIndex('by_workspace')
      .eq('workspaceId', args.workspaceId).collect();
  },
  async listAnnouncements(ctx) {
    await ctx.permissions.appMembers.requireRole(null, 'member');
    return await ctx.db.query('announcements').collect();
  },
  async bootstrapWorkspace(ctx, args) {
    const workspaceId = await ctx.membership.workspaceMembers.bootstrap({
      name: args.name,
      createdBy: ctx.auth.userId,
    });
    await ctx.db.insert('tasks', { workspaceId, title: 'protected' });
    return workspaceId;
  },
  async addMember(ctx, args) {
    await ctx.permissions.workspaceMembers.requireRole(args.workspaceId, 'owner');
    await ctx.membership.workspaceMembers.insert({
      workspaceId: args.workspaceId,
      userId: args.userId,
      role: 'member',
    });
    return null;
  },
  async leaveWorkspace(ctx, args) {
    await ctx.membership.workspaceMembers.removeSelf(args.workspaceId);
    return null;
  },
  async downgradeWorkspace(ctx, args) {
    await ctx.membership.workspaceMembers.setSelfRole(args.workspaceId, 'guest');
    return null;
  },
  async addTask(ctx, args) {
    await requireMember(ctx, args.workspaceId);
    return await ctx.db.insert('tasks', args);
  },
  async joinApp(ctx) {
    await ctx.membership.appMembers.insert({
      userId: ctx.auth.userId,
      role: 'member',
    });
    return null;
  },
  async leaveApp(ctx) {
    await ctx.membership.appMembers.removeSelf();
    return null;
  },
  async downgradeApp(ctx) {
    await ctx.membership.appMembers.setSelfRole('guest');
    return null;
  },
  async postAnnouncement(ctx, args) {
    await ctx.permissions.appMembers.requireRole(null, 'member');
    return await ctx.db.insert('announcements', args);
  },
  async postPublicNotice(ctx, args) {
    return await ctx.db.insert('publicNotices', args);
  },
};
`);

  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const outputRoot = join(backendRoot, 'generated');
  const schema = await readJson(join(outputRoot, 'schema.manifest.json'));
  const functions = await readJson(join(outputRoot, 'functions.manifest.json'));
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

  const owner = await mintSession(schema.appId, 'owner@revocation.test', 'revocation-owner');
  const resourceDeleteMember = await mintSession(
    schema.appId,
    'resource-delete@revocation.test',
    'revocation-resource-delete',
  );
  const resourceDowngradeMember = await mintSession(
    schema.appId,
    'resource-downgrade@revocation.test',
    'revocation-resource-downgrade',
  );
  const appDeleteMember = await mintSession(
    schema.appId,
    'app-delete@revocation.test',
    'revocation-app-delete',
  );
  const appDowngradeMember = await mintSession(
    schema.appId,
    'app-downgrade@revocation.test',
    'revocation-app-downgrade',
  );

  const resourceDeleteId = (await owner.client.mutate('bootstrapWorkspace', {
    args: { name: 'Resource delete' },
  })).result;
  const resourceDowngradeId = (await owner.client.mutate('bootstrapWorkspace', {
    args: { name: 'Resource downgrade' },
  })).result;
  await owner.client.mutate('addMember', {
    args: {
      workspaceId: resourceDeleteId,
      userId: resourceDeleteMember.credential.session.userId,
    },
  });
  await owner.client.mutate('addMember', {
    args: {
      workspaceId: resourceDowngradeId,
      userId: resourceDowngradeMember.credential.session.userId,
    },
  });
  for (const session of [owner, appDeleteMember, appDowngradeMember]) {
    await session.client.mutate('joinApp', { args: {} });
  }
  await owner.client.mutate('postAnnouncement', { args: { message: 'protected' } });
  await owner.client.mutate('postPublicNotice', { args: { message: 'before' } });
  const publicUpdates = [];
  const publicHandle = await owner.client.liveQuery('listPublicNotices', {
    args: {},
    connectionId: 'require-role-authority-independent',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(rows, detail) {
      publicUpdates.push({ count: rows.length, kind: detail?.kind ?? null });
    },
  });
  assert.equal(publicHandle.rows.length, 1);
  assert.equal(publicHandle.authorizationState(), null);

  async function verifyTerminalRevocation({
    label,
    session,
    query,
    args,
    connectionId,
    revoke,
    laterWrite,
  }) {
    const updates = [];
    const boundaries = [];
    const authorizationErrors = [];
    const handle = await session.client.liveQuery(query, {
      args,
      connectionId,
      transport: 'stream',
      fallbackToPoll: false,
      onUpdate(rows, detail) {
        updates.push({ count: rows.length, kind: detail?.kind ?? null });
      },
      onAuthorizationBoundary(rows, detail) {
        boundaries.push({ count: rows.length, kind: detail?.kind ?? null });
      },
      onAuthorizationError(error) {
        authorizationErrors.push(
          error?.code ?? error?.diagnostic?.code ?? error?.message,
        );
      },
    });
    assert(handle.rows.length > 0, `${label} did not establish protected rows`);

    await revoke();
    const blankBeforeMutationReturn = handle.rows.length === 0;
    assert.equal(
      blankBeforeMutationReturn,
      true,
      `${label} did not blank before the causing mutation returned`,
    );
    await eventually(
      () => {
        assert.equal(handle.rows.length, 0, `${label} retained protected rows`);
        const authorizationState = handle.authorizationState();
        assert.equal(
          authorizationState?.terminalDeleted,
          true,
          `${label} did not apply terminal delete`,
        );
        assert.deepEqual(authorizationState.pendingByScope, {});
        assert.equal(
          Object.values(authorizationState.scopeState)
            .some(({ lastAckToken }) => typeof lastAckToken === 'string'),
          true,
          `${label} did not exact-acknowledge terminal delete`,
        );
      },
      `${label} did not complete terminal revocation`,
    );
    await assert.rejects(
      () => session.client.query(query, { args }),
      (error) => (
        error?.code ?? error?.diagnostic?.code
      ) === 'SNAPBACK_AUTH_PERMISSION_DENIED',
      `${label} allowed a fresh read`,
    );
    await laterWrite();
    await delay(250);
    assert.equal(handle.rows.length, 0, `${label} delivered later forbidden data`);
    assert.deepEqual(authorizationErrors, [], `${label} surfaced client errors`);
    await handle.dispose();
    return {
      blankBeforeMutationReturn,
      terminalDeleted: true,
      freshReadDenied: true,
      laterDeliveryPrevented: true,
      exactAcknowledgement: true,
      updates,
      boundaries,
    };
  }

  const resourceDelete = await verifyTerminalRevocation({
    label: 'resource membership delete',
    session: resourceDeleteMember,
    query: 'listTasks',
    args: { workspaceId: resourceDeleteId },
    connectionId: 'require-role-resource-delete',
    revoke: () => resourceDeleteMember.client.mutate('leaveWorkspace', {
      args: { workspaceId: resourceDeleteId },
    }),
    laterWrite: () => owner.client.mutate('addTask', {
      args: { workspaceId: resourceDeleteId, title: 'forbidden-later-delete' },
    }),
  });
  const resourceDowngrade = await verifyTerminalRevocation({
    label: 'resource membership downgrade',
    session: resourceDowngradeMember,
    query: 'listTasks',
    args: { workspaceId: resourceDowngradeId },
    connectionId: 'require-role-resource-downgrade',
    revoke: () => resourceDowngradeMember.client.mutate('downgradeWorkspace', {
      args: { workspaceId: resourceDowngradeId },
    }),
    laterWrite: () => owner.client.mutate('addTask', {
      args: { workspaceId: resourceDowngradeId, title: 'forbidden-later-downgrade' },
    }),
  });
  const appDelete = await verifyTerminalRevocation({
    label: 'app membership delete',
    session: appDeleteMember,
    query: 'listAnnouncements',
    args: {},
    connectionId: 'require-role-app-delete',
    revoke: () => appDeleteMember.client.mutate('leaveApp', { args: {} }),
    laterWrite: () => owner.client.mutate('postAnnouncement', {
      args: { message: 'forbidden-later-app-delete' },
    }),
  });
  const appDowngrade = await verifyTerminalRevocation({
    label: 'app membership downgrade',
    session: appDowngradeMember,
    query: 'listAnnouncements',
    args: {},
    connectionId: 'require-role-app-downgrade',
    revoke: () => appDowngradeMember.client.mutate('downgradeApp', { args: {} }),
    laterWrite: () => owner.client.mutate('postAnnouncement', {
      args: { message: 'forbidden-later-app-downgrade' },
    }),
  });
  await owner.client.mutate('postPublicNotice', { args: { message: 'after' } });
  await eventually(
    () => assert.equal(publicHandle.rows.length, 2),
    'authority-independent live query did not survive membership churn',
  );
  assert.equal(
    publicUpdates.some(({ kind }) => kind?.startsWith('authorization_')),
    false,
  );
  await publicHandle.dispose();

  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.require-role-live-revocation.v1',
    resourceDelete,
    resourceDowngrade,
    appDelete,
    appDowngrade,
    authorityIndependent: {
      remainedUnscoped: true,
      survivedMembershipChurn: true,
      receivedLaterPublicWrite: true,
      updates: publicUpdates,
    },
  }, null, 2)}\n`);
} finally {
  for (const session of sessions) {
    try {
      await session.client.closeAuth();
    } catch {
      // Preserve the primary assertion.
    }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
