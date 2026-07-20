import { assert, assertEqual, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import { SubscriptionScope } from '../../surfaces/vanilla/src/lifecycle.js';

const suite = createSuite('partiful matrix / vanilla subscription lifecycle', { expectedChecks: 3 });

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
});
