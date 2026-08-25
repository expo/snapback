import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import { IDBFactory } from 'fake-indexeddb';

import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import { createSnapbackAppClient } from '@expo/snapback-client';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };

// @ref LLP 0010#first-acceptance-app — the generated todo default proves a
// real query and mutation against an owned isolated target. Static artifact
// checks are deliberately separate in acceptance.static.mjs.
// @ref LLP 0275#d9-public-starter-acceptance-runner-author-ruling-2026-08-22
// — product assertions remain visible here while the public runner owns
// lifecycle, readiness, receipt shape, cleanup sequencing, and retry bounds.
export const acceptance = defineStarterAcceptance({
  acceptanceFile: import.meta.url,
  appRoot: import.meta.dirname,
  artifacts,
  paths: {
    listTodos: {
      id: 'list-todos',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.listTodos,
      provenance: 'baseline',
    },
    createTodo: {
      id: 'create-todo',
      kind: 'success',
      targetProfileId: 'local-dev-sqlite-ibex',
      operation: api.createTodo,
      provenance: 'baseline',
    },
  },
  async journey({ bindingFor, defer, paths, step }) {
    let appAuthClient = null;
    defer(async () => {
      await appAuthClient?.dispose();
      appAuthClient = null;
    });

    const binding = bindingFor(app, {
      offeredCapabilities: ['auth.passwords'],
      supervisorGeneration: `todo-contract-acceptance-${app.identity.descriptor}`,
    });
    appAuthClient = await createSnapbackAppClient({
      app,
      binding,
      streamless: true,
      // durable-required custody needs a qualifying adapter; headless Node uses
      // the browser platform shape over fake-indexeddb, like the repo's own
      // application-auth fixtures (memory has no durable custody by design).
      platform: {
        kind: 'browser',
        indexedDB: new IDBFactory(),
        lockManager: { request: (_name, _options, operation) => operation() },
        cryptoObject: webcrypto,
        databaseName: `todo-contract-headless-${process.pid}`,
      },
      storagePartition: `todo-contract-headless-${process.pid}`,
      rqsStore: null,
    });
    const signup = await appAuthClient.auth.signUpWithPassword({
      email: `todo-contract-headless-${process.pid}@example.com`,
      password: 'todo-contract-headless-password',
    });
    assert.equal(signup.session.userId, appAuthClient.auth.currentPrincipal().userId);

    // Sessions mode: data legs run as the signed-up principal through the
    // app-auth client's session-bound inner client.
    const sessionClient = appAuthClient.client;
    await step(paths.listTodos, async () => {
      const before = await sessionClient.query(api.listTodos, {});
      assert(Array.isArray(before.rows));
      return { rowCount: before.rows.length };
    });

    await step(paths.createTodo, async () => {
      const title = `Generated acceptance ${process.pid}`;
      const mutation = await sessionClient.mutate(api.createTodo, {
        args: { title },
        clientMutationId: `generated-acceptance-${process.pid}`,
      });
      assert.equal(mutation.changed_count, 1);
      const after = await sessionClient.query(api.listTodos, {});
      assert(after.rows.some((row) => row.title === title));
      return { observedBy: api.listTodos.id };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
