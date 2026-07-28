import { join } from 'node:path';

import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';

const suite = createSuite('public-dashboard / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, { appId: 'public-dashboard' });

await runAcceptance(suite, async () => {
  await suite.check('one ensure provisions schema, functions, seed, and routes', async () => {
    assertEqual(app.provisioned.routes, 'provisioned', 'routes provisioned');
    assertEqual(app.provisioned.seed, 'seeded', 'seed provisioned');
  });

  await suite.check('generated function certifies the public disclosure facts', async () => {
    const fn = app.generated('functions.manifest.json').functions
      .find(({ name }) => name === 'dashboardMetrics');
    assertEqual(fn.authRequirement, 'public', 'query auth');
    assertEqual(fn.authorityIndependent, true, 'authority independence');
    assertEqual(fn.publicInline, true, 'public-inline disclosure');
  });

  let bundle;
  await suite.check('anonymous deep link returns one snapshot bundle with resume token', async () => {
    bundle = await app.client.fetchBundle({
      route: '/dashboards/:dashboardId',
      params: { dashboardId: 'ops' },
      mode: 'read',
    });
    assertEqual(bundle.entries.length, 1, 'bundle entry count');
    assertEqual(bundle.entries[0].rows.map(({ label }) => label), ['latency_ms', 'uptime_pct'], 'ops rows');
    assert(typeof bundle.entries[0].resume?.token === 'string', 'resume token missing');
  });

  await suite.check('route params select a different dashboard at one commit cut', async () => {
    const sales = await app.client.fetchBundle({
      route: '/dashboards/:dashboardId',
      params: { dashboardId: 'sales' },
      mode: 'read',
    });
    assertEqual(sales.entries[0].rows.map(({ label }) => label), ['orders'], 'sales rows');
    assert(Number.isSafeInteger(sales.commitVersion), 'bundle commit is not an integer');
  });

  await suite.check('an undeclared route is refused', async () => {
    await assertThrows(
      () => app.client.fetchBundle({ route: '/undeclared', mode: 'read' }),
      'SNAPBACK_BUNDLE_ROUTE_UNKNOWN',
      'undeclared route',
    );
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});
