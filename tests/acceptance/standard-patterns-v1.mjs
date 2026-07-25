import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../packages/snapback-client/index.mjs';
import {
  AuthCoordinator,
  createMemoryAuthCustodyStorage,
} from '../../packages/snapback-contract/index.mjs';
import { generate } from '../../packages/snapback-codegen/index.mjs';
import { startServer } from '../../demos/_kit/server-process.mjs';

// @ref LLP 0065#6-acceptance — standard patterns prove their explicit
// visibility floor against a real server and two unrelated session principals;
// generated metadata alone is not an authorization witness.

const here = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(here, '..', '..');
const cliArgs = process.argv.slice(2);
const receiptFlag = cliArgs.indexOf('--receipt');
const receiptPath = receiptFlag === -1 ? null : cliArgs[receiptFlag + 1];
const scratch = await mkdtemp(join(tmpdir(), 'snapback-standard-patterns-server-'));
const appRoot = join(scratch, 'standard-patterns-app');
const backendRoot = join(appRoot, 'snapback');
let server = null;
const sessions = [];

const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

async function mintSession(appId, email, clientStoreId) {
  const coordinator = new AuthCoordinator({
    appId,
    storage: createMemoryAuthCustodyStorage({ state: { custody: {} } }),
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

async function mutate(session, name, args, id) {
  const authorityCapture = session.coordinator.capture();
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await session.client.mutate(name, {
        args,
        clientMutationId: id,
        authorityCapture,
      });
    } catch (error) {
      if ((error?.code ?? error?.diagnostic?.code) !== 'SNAPBACK_AUTH_RESERVATION_STALE' || attempt >= 2) {
        throw error;
      }
      await session.client.currentAuthorizationScope();
      assert(session.coordinator.isCurrent(authorityCapture));
    }
  }
}

try {
  await mkdir(backendRoot, { recursive: true });
  await writeFile(join(backendRoot, 'schema.mjs'), `
import { defineSchema, defineTable, v } from '@snapback/codegen/define';
export const todos = defineTable({
  ownerId: v.principal(), slug: v.string(), title: v.string(),
  pageKey: v.string(), createdAt: v.integer(), updatedAt: v.integer(),
})
  .index('by_owner_slug', ['ownerId', 'slug'], { unique: true })
  .index('by_owner_page_key', ['ownerId', 'pageKey'], { unique: true })
  .index('by_owner_created', ['ownerId', 'createdAt'])
  .sync();
export default defineSchema({ todos }, { auth: { mode: 'sessions' } });
`);
  await writeFile(join(backendRoot, 'functions.mjs'), `
import schema from './schema.mjs';
import { defineOwnedCrud, defineOwnedKeysetPages, defineOwnedUniqueLookup } from '@snapback/codegen/standard-patterns';
const visibility = { kind: 'owner', field: 'ownerId' };
export const { listTodos, getTodo, createTodo, updateTodo, deleteTodo } = defineOwnedCrud({
  table: schema.tables.todos,
  names: { list: 'listTodos', get: 'getTodo', create: 'createTodo', update: 'updateTodo', delete: 'deleteTodo' },
  visibility,
  createDefaults: { pageKey: 'id', createdAt: 'now', updatedAt: 'now' },
  updateDefaults: { updatedAt: 'now' },
  immutable: ['slug', 'pageKey', 'createdAt'],
  listIndex: 'by_owner_created',
});
export const { todoBySlug } = defineOwnedUniqueLookup({
  table: schema.tables.todos, name: 'todoBySlug', index: 'by_owner_slug', visibility,
});
export const { firstTodoPage, nextTodoPage } = defineOwnedKeysetPages({
  table: schema.tables.todos,
  names: { first: 'firstTodoPage', next: 'nextTodoPage' },
  index: 'by_owner_page_key', cursorField: 'pageKey', visibility,
});
`);

  const generated = await generate(backendRoot);
  assert.equal(generated.ok, true, JSON.stringify(generated.diagnostics));
  const outputRoot = join(backendRoot, 'generated');
  const schema = await readJson(join(outputRoot, 'schema.manifest.json'));
  const functions = await readJson(join(outputRoot, 'functions.manifest.json'));
  const carrier = join(scratch, 'startup-artifacts.json');
  await writeFile(carrier, `${JSON.stringify({ formatVersion: 1, schema, functions })}\n`, { mode: 0o600 });
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repositoryRoot,
    startupArtifacts: carrier,
    captureImpersonationCapability: true,
  });

  const ada = await mintSession(schema.appId, 'ada@patterns.test', 'patterns-ada');
  const grace = await mintSession(schema.appId, 'grace@patterns.test', 'patterns-grace');
  assert.notEqual(ada.credential.session.userId, grace.credential.session.userId);

  const beforeCreate = Date.now();
  const adaCreate = await mutate(ada, 'createTodo', { slug: 'ada', title: 'Ada task' }, 'cm_patterns_ada');
  const afterCreate = Date.now();
  const graceCreate = await mutate(grace, 'createTodo', { slug: 'grace', title: 'Grace task' }, 'cm_patterns_grace');
  const adaRow = adaCreate.result;
  const graceRow = graceCreate.result;
  assert.equal(adaRow.ownerId, ada.credential.session.userId);
  assert.equal(graceRow.ownerId, grace.credential.session.userId);
  assert.match(adaRow.pageKey, /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/);
  assert(adaRow.createdAt >= beforeCreate && adaRow.createdAt <= afterCreate);
  assert.equal(adaRow.updatedAt, adaRow.createdAt);

  assert.deepEqual((await ada.client.query('listTodos', { args: {} })).rows.map((row) => row.slug), ['ada']);
  assert.deepEqual((await grace.client.query('listTodos', { args: {} })).rows.map((row) => row.slug), ['grace']);
  assert.deepEqual((await ada.client.query('getTodo', { args: { id: graceRow._id } })).rows, []);
  assert.deepEqual((await ada.client.query('todoBySlug', { args: { slug: 'grace' } })).rows, []);
  assert.deepEqual((await ada.client.query('firstTodoPage', { args: {} })).rows.map((row) => row.slug), ['ada']);

  // @ref LLP 0065#6-acceptance — the public outcome for a missing row is
  //   byte-indistinguishable from the outcome for another owner's row: the
  //   invisible and absent legs both refuse SNAPBACK_ROW_NOT_FOUND with one
  //   shape, so a probing caller learns nothing about existence.
  const refusalShape = async (attempt) => {
    try {
      await attempt();
      assert.fail('cross-owner or missing-row mutation must refuse');
    } catch (error) {
      return {
        code: error?.code ?? error?.diagnostic?.code,
        keys: Object.keys(error?.diagnostic ?? error ?? {}).sort(),
      };
    }
  };
  const missingId = graceRow._id.slice(0, -1) + (graceRow._id.endsWith('0') ? '1' : '0');
  const crossUpdate = await refusalShape(
    () => mutate(ada, 'updateTodo', { id: graceRow._id, title: 'stolen' }, 'cm_patterns_cross_update'),
  );
  const missingUpdate = await refusalShape(
    () => mutate(ada, 'updateTodo', { id: missingId, title: 'ghost' }, 'cm_patterns_missing_update'),
  );
  assert.equal(crossUpdate.code, 'SNAPBACK_ROW_NOT_FOUND');
  assert.deepEqual(crossUpdate, missingUpdate, 'missing and invisible must be indistinguishable');
  const crossDelete = await refusalShape(
    () => mutate(ada, 'deleteTodo', { id: graceRow._id }, 'cm_patterns_cross_delete'),
  );
  const missingDelete = await refusalShape(
    () => mutate(ada, 'deleteTodo', { id: missingId }, 'cm_patterns_missing_delete'),
  );
  assert.equal(crossDelete.code, 'SNAPBACK_ROW_NOT_FOUND');
  assert.deepEqual(crossDelete, missingDelete, 'missing and invisible must be indistinguishable');
  assert.deepEqual((await grace.client.query('getTodo', { args: { id: graceRow._id } })).rows.map((row) => row.title), ['Grace task']);

  await mutate(ada, 'deleteTodo', { id: adaRow._id }, 'cm_patterns_own_delete');
  await assert.rejects(
    () => mutate(ada, 'updateTodo', { id: adaRow._id, title: 'missing' }, 'cm_patterns_missing_update'),
    (error) => (error?.code ?? error?.diagnostic?.code) === 'SNAPBACK_ROW_NOT_VISIBLE',
  );
  await assert.rejects(
    () => mutate(ada, 'deleteTodo', { id: adaRow._id }, 'cm_patterns_missing_delete'),
    (error) => (error?.code ?? error?.diagnostic?.code) === 'SNAPBACK_ROW_NOT_VISIBLE',
  );

  // A raw protocol caller can include unknown object members in v0. The plan
  // never reads them: the server derives all three values from its prepared
  // runtime, so the attempted values cannot acquire semantic authority.
  const attemptedForgery = await mutate(ada, 'createTodo', {
    slug: 'forged', title: 'forged', pageKey: 'client-picked', createdAt: 1, updatedAt: 1,
  }, 'cm_patterns_forged');
  assert.notEqual(attemptedForgery.result.pageKey, 'client-picked');
  assert.notEqual(attemptedForgery.result.createdAt, 1);
  assert.notEqual(attemptedForgery.result.updatedAt, 1);

  const receipt = {
    schemaVersion: 'snapback.standard-patterns-real-server.v1',
    ok: true,
    appId: schema.appId,
    users: 2,
    patterns: ['owned-crud', 'owned-unique-lookup', 'owned-keyset-pagination'],
    checks: {
      serverDerivedOwner: true,
      trustedNow: true,
      trustedId: true,
      clientForgeryCannotOverrideTrustedValues: true,
      crossUserListRejected: true,
      crossUserGetRejected: true,
      crossUserUniqueLookupRejected: true,
      crossUserPaginationRejected: true,
      crossUserUpdateRejected: true,
      crossUserDeleteRejected: true,
      missingAndInvisibleMutationRowsCollapsed: true,
    },
  };
  const renderedReceipt = `${JSON.stringify(receipt, null, 2)}\n`;
  if (receiptPath) await writeFile(receiptPath, renderedReceipt);
  process.stdout.write(renderedReceipt);
} finally {
  for (const session of sessions) {
    try { await session.client.closeAuth(); } catch { /* preserve primary failure */ }
  }
  await server?.stop();
  await rm(scratch, { recursive: true, force: true });
}
