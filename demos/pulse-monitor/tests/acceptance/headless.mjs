import { join } from 'node:path';

import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import {
  assert,
  assertEqual,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const suite = createSuite('pulse-monitor / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, {
  appId: 'pulse-monitor',
  cronDisabled: true,
});
const inspectJob = async () => {
  const state = await app.admin.inspect();
  return (state.cron?.jobs ?? []).find(({ name }) => name === 'monitorWhileViewed');
};
const activation = (job) => String(job?.activationState ?? '').toLowerCase();

await runAcceptance(suite, async () => {
  await suite.check('generated app provisions with one cron job', async () => {
    assertEqual(app.provisioned.functions, 'provisioned', 'functions provisioned');
    const jobs = app.generated('functions.manifest.json').cronJobs;
    assertEqual(jobs.map(({ name }) => name), ['monitorWhileViewed'], 'cron inventory');
  });

  await suite.check('demand-gated job is inactive without a subscriber', async () => {
    await app.client.cronTick();
    const job = await inspectJob();
    assert(activation(job).includes('inactive'), `idle activation state: ${activation(job)}`);
  });

  const live = await app.client.liveQuery(api.liveServices, {
    connectionId: 'pulse-viewer',
  });
  const beforeVersion = live.version;

  await suite.check('live demand arms the scheduler job', async () => {
    await app.client.cronTick();
    const job = await inspectJob();
    assertEqual(activation(job), 'armed', 'subscribed activation state');
  });

  await suite.check('forced tick runs action, mutation, and live delivery', async () => {
    const rows = await live.poll();
    assert(live.version > beforeVersion, 'live version did not advance');
    assertEqual(rows[0].tickCount, 1, 'mutation tick count');
    assert(rows[0].lastCheckedAt > 0, 'runtime timestamp missing');
  });

  await suite.check('unsubscribe makes the demand-gated job inactive again', async () => {
    await app.client.unsubscribeLive(api.liveServices, {
      connectionId: 'pulse-viewer',
      subscriptionId: live.subscriptionId,
    });
    await app.client.cronTick();
    const job = await inspectJob();
    assert(activation(job).includes('inactive'), `post-unsubscribe activation: ${activation(job)}`);
    assert(
      (job.recentRuns ?? []).some(({ outcome }) => String(outcome).toLowerCase() === 'succeeded'),
      'success ledger missing',
    );
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});
