import { join } from 'node:path';
import { openHeadlessApp } from '../../../_kit/headless-app.mjs';
import { assert, assertEqual, assertThrows, createSuite, runAcceptance } from '../../../_kit/harness.mjs';
import api from '../../snapback/generated/api.mjs';

const suite = createSuite('chirp / headless', { expectedChecks: 5 });
const app = await openHeadlessApp(import.meta.url, { appId: 'chirp' });

await runAcceptance(suite, async () => {
  await suite.check('generated app provisions deterministic social data', async () => {
    assertEqual(app.provisioned.seed, 'seeded', 'seed provisioned');
    const feed = await app.client.query(api.timeline, { args: { limit: 20, viewerHandle: 'lin' } });
    assertEqual(feed.rows.length, 3, 'seed post count');
    assertEqual(feed.rows[0].displayName, 'Ada Lovelace', 'profile joined server-side');
  });

  let postId;
  await suite.check('createPost stamps time on the trusted runtime', async () => {
    const created = await app.client.mutate(api.createPost, { args: { authorHandle: 'lin', body: 'Hello from acceptance.' } });
    postId = created.result;
    const feed = await app.client.query(api.timeline, { args: { limit: 20, viewerHandle: 'lin' } });
    const post = feed.rows.find(({ _id }) => _id === postId);
    assert(post, 'created post missing');
    assert(Number.isSafeInteger(post.createdAt), 'createdAt is not trusted integer time');
  });

  await suite.check('toggleLike is idempotent over the unique user/post pair', async () => {
    assertEqual((await app.client.mutate(api.toggleLike, { args: { postId, userHandle: 'ada' } })).result.liked, true, 'first toggle likes');
    assertEqual((await app.client.query(api.timeline, { args: { limit: 20, viewerHandle: 'ada' } })).rows.find(({ _id }) => _id === postId)?.liked, true, 'viewer like projection');
    assertEqual((await app.client.mutate(api.toggleLike, { args: { postId, userHandle: 'ada' } })).result.liked, false, 'second toggle unlikes');
  });

  await suite.check('profile feed stays scoped and ordered', async () => {
    const feed = await app.client.query(api.profilePosts, { args: { handle: 'lin', viewerHandle: 'lin' } });
    assertEqual(feed.rows[0]._id, postId, 'newest post first');
    assert(feed.rows.every(({ authorHandle }) => authorHandle === 'lin'), 'profile leaked another author');
  });

  await suite.check('empty and overlong posts refuse without a write', async () => {
    const before = (await app.client.query(api.timeline, { args: { limit: 100, viewerHandle: 'lin' } })).rows.length;
    await assertThrows(() => app.client.mutate(api.createPost, { args: { authorHandle: 'lin', body: ' '.repeat(2) } }), 'SNAPBACK_HANDLER_FAILED', 'empty post');
    await assertThrows(() => app.client.mutate(api.createPost, { args: { authorHandle: 'lin', body: 'x'.repeat(281) } }), 'SNAPBACK_HANDLER_FAILED', 'long post');
    assertEqual((await app.client.query(api.timeline, { args: { limit: 100, viewerHandle: 'lin' } })).rows.length, before, 'rejected posts wrote rows');
  });
}, { cleanups: [app.close], reportFile: join(app.appDir, 'acceptance-report.json') });
