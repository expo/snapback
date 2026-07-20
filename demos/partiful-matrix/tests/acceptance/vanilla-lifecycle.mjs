import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { SubscriptionScope } from '../../surfaces/vanilla/src/lifecycle.js';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..', '..', '..', '..');
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const identity = (path) => ({ path, sha256: sha256(readFileSync(resolve(repoRoot, path))) });
const suite = createSuite('partiful matrix / vanilla subscription lifecycle', { expectedChecks: 5 });
const option = (name) => {
  const at = process.argv.indexOf(`--${name}`);
  return at < 0 ? null : process.argv[at + 1];
};

await runAcceptance(suite, async () => {
  await suite.check('renew disposes every active handle', async () => {
    const scope = new SubscriptionScope();
    let disposed = 0;
    scope.renew();
    await scope.watch(
      async (observer) => {
        observer(['current'], 'live');
        return { dispose: () => { disposed += 1; } };
      },
      () => {},
    );
    assertEqual(scope.snapshot().activeSubscriptions, 1, 'active subscription count');
    scope.renew();
    assertEqual(disposed, 1, 'disposed handle count');
    assertEqual(scope.snapshot().activeSubscriptions, 0, 'renewed subscription count');
  });

  await suite.check('late handle resolution and stale updates are fenced', async () => {
    const scope = new SubscriptionScope();
    let delayedObserver;
    let resolveHandle;
    let applied = 0;
    let disposed = 0;
    scope.renew();
    const pending = scope.watch(
      (observer) => {
        delayedObserver = observer;
        return new Promise((resolve) => { resolveHandle = resolve; });
      },
      () => { applied += 1; },
    );
    scope.renew();
    delayedObserver(['stale'], 'live');
    resolveHandle({ dispose: () => { disposed += 1; } });
    await pending;
    assertEqual(applied, 0, 'stale observer applications');
    assertEqual(disposed, 1, 'late resolved handle disposal');
    assertEqual(scope.snapshot().ignoredStaleUpdates, 1, 'ignored stale update count');
  });

  await suite.check('close is terminal and idempotently disposes the current scope', async () => {
    const scope = new SubscriptionScope();
    let disposed = 0;
    scope.renew();
    await scope.watch(
      async () => ({ dispose: () => { disposed += 1; } }),
      () => {},
    );
    scope.close();
    scope.close();
    assertEqual(disposed, 1, 'close disposal count');
    assert(scope.snapshot().closed, 'scope should report closed');
    assertEqual(scope.snapshot().activeSubscriptions, 0, 'closed active subscription count');
  });

  await suite.check('connection-only delivery retains the last authoritative rows', async () => {
    const scope = new SubscriptionScope();
    const seen = [];
    scope.renew();
    await scope.watch(
      async (observer) => {
        observer(['authoritative'], 'live', { kind: 'authoritative' });
        observer(['cached-must-not-win'], 'stale', { kind: 'connection' });
        return { dispose() {} };
      },
      (rows, connection, delivery) => seen.push({ rows, connection, delivery }),
    );
    assertEqual(seen.length, 2, 'delivery count');
    assertEqual(seen[1].delivery.kind, 'connection', 'second delivery kind');
    assertEqual(seen[1].rows[0], 'authoritative', 'retained row');
    scope.close();
  });

  await suite.check('startup rejection is observable and leaves no active binding', async () => {
    const scope = new SubscriptionScope();
    scope.renew();
    let error;
    try {
      await scope.watch(async () => { throw new Error('subscribe failed'); }, () => {});
    } catch (caught) {
      error = caught;
    }
    assertEqual(error?.message, 'subscribe failed', 'startup error');
    assertEqual(scope.snapshot().activeSubscriptions, 0, 'failed active subscription count');
    scope.close();
  });

}, {
  reportFile: option('receipt'),
  reportExtra: {
    testInventory: [
      'demos/partiful-matrix/tests/acceptance/vanilla-lifecycle.mjs',
      'demos/partiful-matrix/surfaces/vanilla/src/lifecycle.js',
      'demos/_kit/harness.mjs',
    ].map(identity),
  },
});
