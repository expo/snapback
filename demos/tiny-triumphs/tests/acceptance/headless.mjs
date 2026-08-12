import { join } from 'node:path';
import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const suite = createSuite('tiny-triumphs / headless', { expectedChecks: 4 });
const app = await openHeadlessApp(import.meta.url, { appId: 'tiny-triumphs' });

await runAcceptance(suite, async () => {
  await suite.check('seeded triumphs arrive newest first', async () => {
    const result = await app.client.query(api.recentTriumphs, { args: { limit: 10 } });
    assertEqual(result.rows.length, 3, 'seed count');
    assertEqual(result.rows[0]._id, 'triumph_ship', 'newest seed');
  });
  let createdId;
  await suite.check('celebrate validates and stamps server time', async () => {
    createdId = (await app.client.mutate(api.celebrate, { args: { text: '  Fixed the squeaky door  ', vibe: 'leaf' } })).result;
    const result = await app.client.query(api.recentTriumphs, { args: { limit: 10 } });
    const created = result.rows.find(({ _id }) => _id === createdId);
    assert(created, 'created triumph missing');
    assertEqual(created.text, 'Fixed the squeaky door', 'server-trimmed text');
    assert(Number.isSafeInteger(created.createdAt), 'server timestamp');
  });
  await suite.check('live query observes the mutation', async () => {
    const live = await app.client.liveQuery(api.recentTriumphs, { args: { limit: 10 }, connectionId: 'tiny-triumphs-live', transport: 'stream' });
    const streamedId = (await app.client.mutate(api.celebrate, { args: { text: 'Caught the bus with ten seconds to spare', vibe: 'spark' } })).result;
    const deadline = Date.now() + 5_000;
    while (!live.rows.some(({ _id }) => _id === streamedId) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 50));
    assert(live.rows.some(({ _id }) => _id === streamedId), 'stream did not observe created row');
    await live.dispose();
  });
  await suite.check('invalid text and vibe refuse without writes', async () => {
    const before = (await app.client.query(api.recentTriumphs, { args: { limit: 50 } })).rows.length;
    await assertThrows(() => app.client.mutate(api.celebrate, { args: { text: ' ', vibe: 'spark' } }), 'SNAPBACK_HANDLER_FAILED', 'empty triumph');
    await assertThrows(() => app.client.mutate(api.celebrate, { args: { text: 'A valid thought', vibe: 'lava' } }), 'SNAPBACK_HANDLER_FAILED', 'bad vibe');
    assertEqual((await app.client.query(api.recentTriumphs, { args: { limit: 50 } })).rows.length, before, 'refused writes');
  });
}, { cleanups: [app.close], reportFile: join(app.appDir, 'acceptance-report.json') });
