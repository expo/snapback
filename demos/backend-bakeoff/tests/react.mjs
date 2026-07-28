// @ref LLP 0102#exact-executable-gate — this named receipt exercises the
// real bakeoff adapter surface: prepared binding, provider-owned query group,
// transition, mutation/live delivery, and exact cleanup.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { SnapbackClient } from '@snapback/client';
import { startServer } from '../../_kit/server-process.mjs';
import { assert, assertEqual, createSuite, runAcceptance } from '../../_kit/harness.mjs';
import {
  createSnapbackReactProvider,
  invokeSnapbackMutation,
  observeSnapbackQueries,
  skip,
} from '@snapback/react';
import { resolveGeneratedArtifact } from '@snapback/codegen/review-surface';

const here = dirname(fileURLToPath(import.meta.url));
const demoRoot = join(here, '..');
const repoRoot = join(demoRoot, '..', '..');
const generatedRoot = join(demoRoot, 'snapback', 'generated');
const generated = (name) =>
  JSON.parse(readFileSync(resolveGeneratedArtifact(generatedRoot, name), 'utf8'));
const { default: api } = await import(
  pathToFileURL(resolveGeneratedArtifact(generatedRoot, 'api.mjs')).href
);
const seed = JSON.parse(readFileSync(join(demoRoot, 'snapback', 'seed.json'), 'utf8'));
const suite = createSuite('backend bakeoff / snapback React', { expectedChecks: 5 });
const cleanups = [];

const until = async (predicate, label, timeoutMs = 5_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`timed out waiting for ${label}`);
};

await runAcceptance(
  suite,
  async () => {
    const server = await startServer({
      port: 0,
      db: ':memory:',
      cwd: repoRoot,
      serverBinary: join(repoRoot, 'target', 'debug', 'snapback'),
      provenance: {
        appId: 'backend-bakeoff',
        artifactsPath: join(generatedRoot, 'artifacts.json'),
      },
    });
    cleanups.push(() => server.stop());
    const client = new SnapbackClient(server.baseUrl, server.clientOptions);
    await client.ensureApp({
      schema: generated('schema.manifest.json'),
      functions: generated('functions.manifest.json'),
      seed,
    });

    let provider;
    await suite.check('prepares an exact deployment binding and provider', async () => {
      const binding = await client.prepareReactBinding({
        generatedManifest: {
          functions: generated('functions.manifest.json'),
          capabilityManifest: generated('capability.manifest.json'),
        },
      });
      assertEqual(binding.appId, 'backend-bakeoff', 'binding app id');
      assert(Object.isFrozen(binding), 'binding must be immutable');
      provider = createSnapbackReactProvider(binding, {
        connectionId: 'backend_bakeoff_react_receipt',
      });
      assertEqual(provider.inspection().serverSubscriptions, 0, 'provider opened demand early');
    });

    let group;
    let latest;
    await suite.check('commits and transitions one real typed query group', async () => {
      group = observeSnapbackQueries(provider, {
        incidents: { ref: api.listIncidents, args: {} },
        tasks: { ref: api.allTasks, args: {} },
        comments: { ref: api.allComments, args: skip },
        activity: { ref: api.allActivity, args: {} },
      }, (snapshot) => { latest = snapshot; });
      await until(() => latest?.status === 'ready', 'initial React group');
      assertEqual(provider.inspection().serverSubscriptions, 3, 'initial group demand');
      group.update({
        incidents: { ref: api.listIncidents, args: {} },
        tasks: { ref: api.allTasks, args: {} },
        comments: { ref: api.allComments, args: {} },
        activity: { ref: api.allActivity, args: {} },
      });
      await until(
        () => latest?.queries.comments.status === 'ready',
        'query group skip-to-live transition',
      );
      assertEqual(provider.inspection().serverSubscriptions, 4, 'transition group demand');
    });

    await suite.check('unwraps a mutation result through the prepared provider', async () => {
      const taskId = await invokeSnapbackMutation(provider, api.addTask, {
        actorId: 'user_ada',
        incidentId: 'incident_api',
        body: 'React receipt mutation',
        now: 1785160300000,
      });
      assert(typeof taskId === 'string' && taskId.length > 0, 'mutation result was not unwrapped');
    });

    await suite.check('publishes the mutation through the live group', async () => {
      await until(
        () => (
          latest?.queries.tasks.status === 'ready'
          && latest.queries.tasks.data.some((row) => row.body === 'React receipt mutation')
        ),
        'React group live mutation update',
      );
    });

    await suite.check('disposes to an exact zero-resource inspection', async () => {
      group.dispose();
      await provider.dispose();
      const inspection = provider.inspection();
      assertEqual(inspection.stores, 0, 'provider stores');
      assertEqual(inspection.consumers, 0, 'provider consumers');
      assertEqual(inspection.serverSubscriptions, 0, 'provider subscriptions');
      assertEqual(inspection.leases, 0, 'provider leases');
      assertEqual(inspection.timers, 0, 'provider timers');
      assertEqual(inspection.listeners, 0, 'provider listeners');
      assertEqual((await client.inspect()).subscriptions.length, 0, 'server subscriptions');
    });
  },
  { cleanups },
);
