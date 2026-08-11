import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { generate } from '../../packages/snapback-codegen/index.mjs';
import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import { asUser } from '../../demos/_kit/as-user.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

// @ref LLP 0231#open-questions — bounded owner OR
// relationship visibility is enforced for real sessions and remains live when
// the dedicated Following projection changes in either direction.
const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const scratch = await mkdtemp(join(tmpdir(), 'snapback-table-visibility-any-of-'));
const backendRoot = join(scratch, 'snapback');
const identities = [];
let server = null;

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));
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
import { anyOf, defineSchema, defineTable, owner, v } from '@expo/snapback-codegen/define';
export const followings = defineTable({
  followerId: v.principal(),
  profileId: v.id('profiles'),
  role: v.string(),
}).membership({
  id: 'followings',
  principal: 'followerId',
  resource: 'profileId',
  role: 'role',
  roles: ['following'],
  provenance: 'full',
  transitions: [
    { op: 'insert', by: ['none'], target: 'self', to: ['following'] },
    { op: 'remove', by: ['self'], target: 'self', from: ['following'] },
  ],
}).visibility({ kind: 'public-read' });
export default defineSchema({
  profiles: defineTable({ principalId: v.principal(), name: v.string() })
    .visibility(owner('principalId')),
  followings,
  followingFeedEntries: defineTable({
    authorPrincipalId: v.principal(),
    authorProfileId: v.id('profiles'),
    body: v.string(),
  }).visibility(anyOf([
    owner('authorPrincipalId'),
    {
      kind: 'membership',
      declaration: followings,
      resourceField: 'authorProfileId',
      roles: ['following'],
    },
  ])).sync(),
}, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'functions.mjs'), `
import { defineJsMutation, defineLiveQuery, v } from '@expo/snapback-codegen/define';
export const followingFeed = defineLiveQuery({
  table: 'followingFeedEntries',
  args: {},
  auth: 'optional-user',
});
export const createProfile = defineJsMutation({
  auth: 'authenticated',
  args: { name: v.string() },
  source: 'handlers.mjs',
  exportName: 'createProfile',
  writes: ['profiles'],
});
export const publish = defineJsMutation({
  auth: 'authenticated',
  args: { profileId: v.id('profiles'), body: v.string() },
  source: 'handlers.mjs',
  exportName: 'publish',
  writes: ['followingFeedEntries'],
});
export const follow = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { profileId: v.id('profiles') },
  source: 'handlers.mjs',
  exportName: 'follow',
  writes: ['followings'],
});
export const unfollow = defineJsMutation({
  auth: 'authenticated',
  authorityCreating: true,
  args: { profileId: v.id('profiles') },
  source: 'handlers.mjs',
  exportName: 'unfollow',
  writes: ['followings'],
});
`);
  await writeFile(join(backendRoot, 'handlers.mjs'), `
globalThis.__snapbackHandlers = {
  async createProfile(ctx, args) {
    return await ctx.db.insert('profiles', { principalId: ctx.auth.userId, name: args.name });
  },
  async publish(ctx, args) {
    return await ctx.db.insert('followingFeedEntries', {
      authorPrincipalId: ctx.auth.userId,
      authorProfileId: args.profileId,
      body: args.body,
    });
  },
  async follow(ctx, args) {
    await ctx.membership.followings.insert({
      followerId: ctx.auth.userId,
      profileId: args.profileId,
      role: 'following',
    });
    return null;
  },
  async unfollow(ctx, args) {
    await ctx.membership.followings.removeSelf(args.profileId);
    return null;
  },
};
`);

  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const schema = await readJson(join(generated.outDir, 'schema.manifest.json'));
  const functions = await readJson(join(generated.outDir, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, {
    mode: 0o600,
  });
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });

  const alice = await asUser(server, schema.appId, 'alice@any-of.test', {
    clientStoreId: 'any-of-alice',
  });
  const bob = await asUser(server, schema.appId, 'bob@any-of.test', {
    clientStoreId: 'any-of-bob',
  });
  const mallory = await asUser(server, schema.appId, 'mallory@any-of.test', {
    clientStoreId: 'any-of-mallory',
  });
  identities.push(alice, bob, mallory);
  const aliceProfileId = (await alice.client.mutate('createProfile', {
    args: { name: 'Alice' },
  })).result;
  const bobProfileId = (await bob.client.mutate('createProfile', {
    args: { name: 'Bob' },
  })).result;
  await alice.client.mutate('publish', {
    args: { profileId: aliceProfileId, body: 'alice-own' },
  });
  await bob.client.mutate('publish', {
    args: { profileId: bobProfileId, body: 'bob-own' },
  });
  const malloryProfileId = (await mallory.client.mutate('createProfile', {
    args: { name: 'Mallory' },
  })).result;
  await mallory.client.mutate('publish', {
    args: { profileId: malloryProfileId, body: 'mallory-own' },
  });
  const followEdgesIssued = [];
  const bodies = (rows) => rows.map(({ body }) => body).sort();

  followEdgesIssued.push({ followerId: alice.userId, profileId: bobProfileId });
  await alice.client.mutate('follow', { args: { profileId: bobProfileId } });
  const aliceUpdates = [];
  const aliceHandle = await alice.client.liveQuery('followingFeed', {
    args: {},
    connectionId: 'table-visibility-any-of-alice',
    transport: 'stream',
    fallbackToPoll: false,
    onUpdate(rows, detail) {
      aliceUpdates.push({ count: rows.length, kind: detail?.kind ?? null });
    },
  });
  assert.deepEqual(bodies(aliceHandle.rows), ['alice-own', 'bob-own']);
  assert.deepEqual(
    bodies((await bob.client.query('followingFeed', { args: {} })).rows),
    ['bob-own'],
    'Bob sees only his owner arm',
  );
  assert.deepEqual(
    bodies((await mallory.client.query('followingFeed', { args: {} })).rows),
    ['mallory-own'],
    'Mallory sees only her owner arm before Alice follows her',
  );

  followEdgesIssued.push({ followerId: alice.userId, profileId: malloryProfileId });
  await alice.client.mutate('follow', { args: { profileId: malloryProfileId } });
  await eventually(
    () => assert.deepEqual(bodies(aliceHandle.rows), ['alice-own', 'bob-own', 'mallory-own']),
    'following Mallory did not reveal the third row in Alice’s combined live result',
  );
  await alice.client.mutate('unfollow', { args: { profileId: bobProfileId } });
  await eventually(
    () => assert.deepEqual(bodies(aliceHandle.rows), ['alice-own', 'mallory-own']),
    'unfollowing Bob did not revoke only Bob while preserving Alice and Mallory',
  );
  await bob.client.mutate('publish', {
    args: { profileId: bobProfileId, body: 'bob-after-revoke' },
  });
  await delay(250);
  assert.deepEqual(
    bodies(aliceHandle.rows),
    ['alice-own', 'mallory-own'],
    'Bob’s later write must not deliver after Alice revoked the relationship',
  );
  assert.deepEqual(
    bodies((await alice.client.query('followingFeed', { args: {} })).rows),
    ['alice-own', 'mallory-own'],
    'a fresh authoritative read must also exclude Bob after revocation',
  );
  assert.deepEqual(
    bodies((await bob.client.query('followingFeed', { args: {} })).rows),
    ['bob-after-revoke', 'bob-own'],
    'Bob still sees both of his own rows',
  );
  assert.deepEqual(
    bodies((await mallory.client.query('followingFeed', { args: {} })).rows),
    ['mallory-own'],
    'Mallory remains unable to read Alice or Bob',
  );
  assert.equal(
    followEdgesIssued.some((edge) => (
      edge.followerId === alice.userId && edge.profileId === aliceProfileId
    )),
    false,
    'the scenario must not issue a persisted self-follow mutation',
  );
  const anonymousClient = new SnapbackClient(server.baseUrl, {
    authClientProtocol: 1,
    custody: 'anonymous-public',
  });
  const anonymous = await anonymousClient.query('followingFeed', { args: {} });
  assert.deepEqual(anonymous.rows, []);

  await aliceHandle.dispose();
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 'snapback.table-visibility-any-of-live.v1',
    realSessions: true,
    ownerWithoutSelfEdge: true,
    selfFollowMutationsIssued: 0,
    authenticatedStrangersSeeOnlyOwn: true,
    relationshipInsertVisible: true,
    relationshipDeleteHidden: true,
    anonymousRowsEmpty: true,
    postRevokeDeliveryPrevented: true,
    updates: aliceUpdates,
  }, null, 2)}\n`);
} finally {
  for (const identity of identities.reverse()) {
    try { await identity.dispose(); } catch { /* preserve primary assertion */ }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
