import { join } from 'node:path';

import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const ADA = 'user_dispatch_ada';
const GRACE = 'user_dispatch_grace';
const suite = createSuite('dispatch-board / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, { appId: 'dispatch-board' });

await runAcceptance(suite, async () => {
  await suite.check('generated app provisions and closes trusted fields out of args', async () => {
    assertEqual(app.provisioned.functions, 'provisioned', 'functions provisioned');
    const schema = app.generated('operations/reportIncident.args.schema.json');
    assertEqual(Object.keys(schema.properties), ['title'], 'public argument fields');
    assertEqual(schema.additionalProperties, false, 'operation schema must be closed');
  });

  let reported;
  await suite.check('one mutation authors incident and audit identities at one time', async () => {
    reported = await app.client.mutate(api.reportIncident, {
      userId: ADA,
      args: { title: 'Database latency' },
    });
    assert(reported.result.incidentId, 'incident id missing');
    assert(reported.result.eventId, 'event id missing');
    const incidents = (await app.client.query(api.listIncidents, { userId: ADA })).rows;
    const audit = (await app.client.query(api.listAuditEntries, {
      userId: ADA,
      args: { incidentId: reported.result.incidentId },
    })).rows;
    assertEqual(incidents[0].reportedAt, audit[0].occurredAt, 'invocation time drifted');
    assert(incidents[0].eventId !== audit[0].eventId, 'fresh logical ids were reused');
  });

  await suite.check('a live owner query observes a second-client report', async () => {
    const live = await app.client.liveQuery(api.listIncidents, {
      userId: ADA,
      connectionId: 'dispatch-live',
    });
    await app.client.mutate(api.reportIncident, {
      userId: ADA,
      args: { title: 'Queue saturation' },
    });
    const rows = await live.poll();
    assertEqual(rows.length, 2, 'live incident count');
    await app.client.unsubscribeLive(api.listIncidents, {
      connectionId: 'dispatch-live',
      subscriptionId: live.subscriptionId,
      userId: ADA,
    });
  });

  await suite.check('owner-scoped live query hides other dispatchers', async () => {
    await app.client.mutate(api.reportIncident, {
      userId: GRACE,
      args: { title: 'Grace-only incident' },
    });
    const ada = await app.client.query(api.listIncidents, { userId: ADA });
    assert(!ada.rows.some(({ title }) => title.includes('Grace')), 'cross-owner incident leaked');
  });

  await suite.check('callers cannot inject a trusted timestamp', async () => {
    await assertThrows(
      () => app.client.mutate(api.reportIncident, {
        userId: ADA,
        args: { title: 'Forged', reportedAt: 1 },
      }),
      'SNAPBACK_ARGUMENT_VALIDATION_FAILED',
      'trusted field injection',
    );
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});
