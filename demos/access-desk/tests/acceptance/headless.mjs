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

const ADA = 'user_access_ada';
const GRACE = 'user_access_grace';
const LINUS = 'user_access_linus';
const suite = createSuite('access-desk / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, { appId: 'access-desk' });

await runAcceptance(suite, async () => {
  await suite.check('generated app provisions with private membership metadata', async () => {
    assertEqual(app.provisioned.functions, 'provisioned', 'functions provisioned');
    const schema = app.generated('schema.manifest.json');
    const membership = schema.tables.find(({ name }) => name === 'workspaceMembers');
    assert(membership.membership, 'membership declaration missing');
  });

  let workspaceId;
  await suite.check('bootstrap creates a workspace and its owner atomically', async () => {
    const created = await app.client.mutate(api.createWorkspace, {
      userId: ADA,
      args: { name: 'Operations' },
    });
    workspaceId = created.result;
    assert(typeof workspaceId === 'string' && workspaceId.length > 0, 'workspace id missing');
    const notes = await app.client.query(api.workspaceNotes, {
      userId: ADA,
      args: { workspaceId },
    });
    assertEqual(notes.rows, [], 'new workspace notes');
  });

  await suite.check('outsider sees an empty membership-filtered result', async () => {
    const hidden = await app.client.query(api.workspaceNotes, {
      userId: GRACE,
      args: { workspaceId },
    });
    assertEqual(hidden.rows, [], 'outsider workspace query');
  });

  await suite.check('owner admission grants the member read and write access', async () => {
    await app.client.mutate(api.addMember, {
      userId: ADA,
      args: { workspaceId, userId: GRACE },
    });
    await app.client.mutate(api.addNote, {
      userId: GRACE,
      args: { workspaceId, body: 'Handoff complete' },
    });
    const notes = await app.client.query(api.workspaceNotes, {
      userId: GRACE,
      args: { workspaceId },
    });
    assertEqual(notes.rows.map(({ body }) => body), ['Handoff complete'], 'member notes');
  });

  await suite.check('permission helper blocks an unrelated writer', async () => {
    await assertThrows(
      () => app.client.mutate(api.addNote, {
        userId: LINUS,
        args: { workspaceId, body: 'Unauthorized' },
      }),
      'SNAPBACK_AUTH_PERMISSION_DENIED',
      'outsider workspace mutation',
    );
    const notes = await app.client.query(api.workspaceNotes, {
      userId: ADA,
      args: { workspaceId },
    });
    assert(!notes.rows.some(({ body }) => body === 'Unauthorized'), 'denied write committed');
  });
}, {
  cleanups: [app.close],
  reportFile: join(app.appDir, 'acceptance-report.json'),
});
