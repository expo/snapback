import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

import {
  defineStarterAcceptance,
  runStarterAcceptanceIfMain,
} from '@expo/snapback-acceptance';
import { createSnapbackAppClient } from '@expo/snapback-client';
import { IDBFactory } from 'fake-indexeddb';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
} from '@expo/snapback-react';
import api, { app } from './snapback/generated/api.mjs';
import artifacts from './snapback/generated/artifacts.json' with { type: 'json' };
import functions from './snapback/generated/functions.manifest.json' with { type: 'json' };
import capabilityManifest from './snapback/generated/capability.manifest.json' with { type: 'json' };

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
  async journey({ adminClient, bindingFor, defer, paths, step, until }) {
    let observer = null;
    let provider = null;
    let appClient = null;
    defer(async () => {
      observer?.dispose();
      observer = null;
      await provider?.dispose();
      if (provider) {
        assert.deepEqual(
          {
            stores: provider.inspection().stores,
            consumers: provider.inspection().consumers,
            subscriptions: provider.inspection().serverSubscriptions,
            leases: provider.inspection().leases,
            timers: provider.inspection().timers,
            listeners: provider.inspection().listeners,
          },
          { stores: 0, consumers: 0, subscriptions: 0, leases: 0, timers: 0, listeners: 0 },
        );
      }
      await appClient?.dispose();
      appClient = null;
    });

    const binding = bindingFor(app, {
      offeredCapabilities: ['auth.passwords'],
      supervisorGeneration: `react-starter-acceptance-${process.pid}`,
    });
    const platform = Object.freeze({
      kind: 'browser',
      indexedDB: new IDBFactory(),
      cryptoObject: webcrypto,
      databaseName: `snapback-react-starter-acceptance-${process.pid}`,
    });
    appClient = await createSnapbackAppClient({ app, binding, platform });

    await step('anonymous-ready', async () => {
      assert.equal(appClient.bootstrapState().status, 'ready');
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      return { custody: appClient.bootstrapState().custody.carrier };
    });

    const identity = `react-starter-${process.pid}@example.com`;
    const password = 'react-starter-password';
    let signedUpUserId;
    await step('password-signup-recovery', async () => {
      const signup = await appClient.auth.signUpWithPassword({ email: identity, password });
      assert.equal(signup.recoveryCodes.length, 8);
      assert.equal(Object.hasOwn(signup, 'token'), false);
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
      signedUpUserId = appClient.auth.currentPrincipal().userId;
      return { recoveryCodeCount: signup.recoveryCodes.length, bearerProjected: false };
    });

    await step('reload-restores-principal', async () => {
      await appClient.dispose();
      appClient = await createSnapbackAppClient({ app, binding, platform });
      assert.equal(appClient.auth.currentPrincipal().status, 'authenticated');
      assert.equal(appClient.auth.currentPrincipal().userId, signedUpUserId);
      return { userId: signedUpUserId };
    });

    await step('authenticated-entry-refusal', async () => {
      await assert.rejects(
        appClient.auth.signInWithPassword({ email: identity, password }),
        (error) => error?.code === 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED',
      );
      return { code: 'SNAPBACK_AUTH_ENTRY_AUTHENTICATED' };
    });

    await step('sign-out', async () => {
      await appClient.auth.signOut();
      assert.equal(appClient.auth.currentPrincipal().status, 'anonymous');
      return { principal: 'anonymous' };
    });

    let latest = null;
    await step(paths.listTodos, async () => {
      const initial = await adminClient.query(api.listTodos, { args: {} });
      assert(Array.isArray(initial.rows));
      const preparedBinding = await adminClient.prepareReactBinding({
        generatedManifest: { functions, capabilityManifest },
      });
      provider = createSnapbackReactProvider(preparedBinding, {
        connectionId: 'react_starter_acceptance',
      });
      observer = observeSnapbackQueries(provider, {
        todos: { ref: api.listTodos, args: {} },
      }, (snapshot) => { latest = snapshot; });
      await until(() => latest?.queries.todos.status === 'ready', 'initial React starter query');
      return { rowCount: latest.queries.todos.data.length };
    });

    await step(paths.createTodo, async () => {
      const title = `Generated acceptance ${process.pid}`;
      const created = await invokeSnapbackMutation(provider, api.createTodo, { title });
      assert.equal(created.status, 'settled');
      assert.equal(typeof created.result, 'string');
      await until(
        () => latest?.queries.todos.status === 'ready'
          && latest.queries.todos.data.some((row) => row.title === title),
        'React starter mutation observation',
      );
      return { observedBy: api.listTodos.id };
    });
  },
});

await runStarterAcceptanceIfMain(import.meta, acceptance);
