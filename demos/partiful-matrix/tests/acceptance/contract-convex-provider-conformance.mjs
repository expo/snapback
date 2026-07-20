#!/usr/bin/env bun
// Exact-owned Contract DataProvider conformance against the generated,
// browser-direct Convex provider used by the Partitime Contract cell.
//
// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop
//   — the first non-Snapback producer must pass the same Exact-owned suite as
//   Snapback; browser behavior alone is not a substitute for seam conformance.

import { randomUUID } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { importExactContractConformance } from '../../../../packages/snapback-contract/exact-package.mjs';
import { convexDeploymentUrl, createConvexAdapter } from '../../backends/gateway/convex.ts';
import { loadLocalSecrets, requireSecret } from '../../backends/gateway/secrets.mjs';
import { ConvexContractProvider } from '../../surfaces/contract/convex-provider.ts';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};
const exactRoot = resolve(
  option('exact-checkout')
    ?? process.env.EXACT_CHECKOUT
    ?? resolve(repoRoot, '..', 'exact'),
);
const rawUrl = process.env.CONVEX_URL
  ?? requireSecret(loadLocalSecrets(), 'CONVEX_URL', 'CONVEX_DEPLOY_KEY');
const deploymentUrl = convexDeploymentUrl(rawUrl);
const remote = createConvexAdapter(deploymentUrl);
const conformance = await importExactContractConformance({ exactRoot });
const exactRevision = Bun.spawnSync(['git', '-C', exactRoot, 'rev-parse', 'HEAD'])
  .stdout.toString().trim();
const suite = createSuite('partiful matrix / Contract Convex DataProvider conformance', {
  expectedChecks: 1,
});
const cleanupEventIds = [];
let provider = null;

await runAcceptance(suite, async () => {
  await suite.check('generated Convex adapter passes the Exact-owned DataProvider suite', async () => {
    provider = new ConvexContractProvider(deploymentUrl, 'user_matrix_acceptance');
    let createEventCalls = 0;
    const wrapped = {
      manifest: provider.manifest,
      subscribe: provider.subscribe.bind(provider),
      async mutate(name, args = {}, correlation) {
        const beforeUpdates = listEventUpdateCount(provider);
        const result = await provider.mutate(name, args, correlation);
        if (name === 'createEvent' && result.ok && typeof result.value === 'string') {
          cleanupEventIds.push(result.value);
          createEventCalls += 1;
          // The suite's first two createEvent calls exercise an active
          // primary subscription. Await the native WebSocket delivery before
          // returning so its provider-independent settle tick can inspect it.
          // Its third call is the post-dispose negative probe and must not
          // manufacture an update.
          if (createEventCalls <= 2) {
            await waitUntil(
              () => listEventUpdateCount(provider) > beforeUpdates,
              10_000,
              'Convex listEvents subscription did not observe its conformance mutation',
            );
          }
        }
        return result;
      },
    };

    const createArgs = (label) => ({
      title: `[acceptance] provider conformance ${label} ${randomUUID()}`,
      emoji: '🧪',
      description: 'Exact-owned DataProvider conformance fixture',
      location: 'Convex realtime test lab',
      startsAt: 1787000000000 + createEventCalls,
      hostName: 'Matrix Bot',
      accent: 'cobalt',
    });
    const report = await conformance.assertDataProviderConformance({
      name: 'partitime-generated-convex-provider',
      capabilities: wrapped.manifest.capabilities,
      createProvider: async () => wrapped,
      primaryQuery: {
        name: 'listEvents',
        initial: { status: 'pending' },
        afterSubscriptionUpdate: { status: 'ready', empty: false },
        applySubscriptionUpdate: async () => {
          const result = await wrapped.mutate('createEvent', createArgs('subscription'));
          if (!result.ok) throw new Error(result.error.message);
        },
      },
      mutation: {
        name: 'createEvent',
        args: createArgs('mutation'),
        expectedResult: { ok: true },
        afterMutation: { status: 'ready', empty: false },
      },
      failedMutation: {
        name: '__exact_missing_mutation__',
        errorMessageIncludes: 'unknown Convex mutation',
      },
      serverRunnableQuery: {
        name: 'listEvents',
        expected: { status: 'pending' },
      },
    });
    const failures = report.checks.filter((check) => check.status === 'fail');
    if (failures.length > 0 || !report.ok) {
      throw new Error(`Exact conformance failed: ${JSON.stringify(failures)}`);
    }
    return {
      exactRevision,
      provider: 'convex',
      transport: 'convex/browser WebSocket',
      checks: report.checks,
      passed: report.checks.filter((check) => check.status === 'pass').length,
      skipped: report.checks.filter((check) => check.status === 'skip').length,
      failed: failures.length,
    };
  });
}, {
  reportFile: option('receipt'),
  reportExtra: {
    schemaVersion: 'partitime.contract-convex-provider-conformance.v1',
    exactRevision,
    deploymentOrigin: new URL(deploymentUrl).origin,
  },
  cleanups: [
    async () => {
      await provider?.dispose?.();
      for (const eventId of cleanupEventIds.reverse()) {
        const cleaned = await remote.cleanupAcceptanceEvent(eventId);
        if (!cleaned) throw new Error(`Convex refused to clean conformance event ${eventId}`);
      }
      remote.close();
    },
  ],
});

function listEventUpdateCount(subject) {
  return subject.transportEvidence().filter(
    (event) => event.queryName === 'listEvents' && event.event === 'update',
  ).length;
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await Bun.sleep(25);
  }
}
