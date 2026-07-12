// ENG-24349 / ENG-24361: declared expression indexes are real query-plan
// inputs, and the subscription migration is versioned, atomic at every
// statement boundary, and a no-op once current.
import { startProof } from './harness.mjs';

const proof = await startProof({ app: 'notes', port: 0 });
try {
  const base = await proof.url();
  const post = async (path, body = null) => {
    const response = await fetch(`${base}${path}`, {
      method: 'POST',
      ...(body === null ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
    return response.json();
  };

  const plan = await post('/__test/index-plan', { table: 'notes', index: 'by_board', value: 'board-1' });
  if (!plan.details?.some((detail) => detail.includes('idx_app_notes_by_board'))) {
    throw new Error(`declared index was not selected by EXPLAIN QUERY PLAN: ${JSON.stringify(plan)}`);
  }

  // Populate enough durable subscriptions that an accidental per-wake table
  // rewrite is observable and materially nontrivial.
  const socket = await proof.openLiveSocket();
  const subscriptionCount = 128;
  for (let index = 0; index < subscriptionCount; index += 1) {
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: `layout-${index}` } });
    await socket.waitFor('snapshot');
  }
  const initial = await post('/__test/storage-layout');
  if (initial.subscriptionCount !== subscriptionCount) {
    throw new Error(`expected ${subscriptionCount} subscriptions, got ${JSON.stringify(initial)}`);
  }

  const boundaries = [
    'after-drop-next',
    'after-create-next',
    'after-copy',
    'after-drop-source',
    'after-rename',
    'after-index',
    'after-version',
  ];
  for (const failAt of boundaries) {
    const before = await post('/__test/storage-layout');
    const failed = await post('/__test/subscription-migration', { failAt });
    if (failed.ok !== false || failed.error?.code !== 'SNAPBACK_TEST_SUBSCRIPTION_MIGRATION_FAILURE') {
      throw new Error(`migration fault ${failAt} did not fire: ${JSON.stringify(failed)}`);
    }
    if (
      failed.layout.subscriptionCount !== subscriptionCount ||
      failed.layout.subscriptionRootPage !== before.subscriptionRootPage ||
      failed.layout.temporaryTablePresent
    ) {
      throw new Error(`migration fault ${failAt} was not atomic: ${JSON.stringify({ before, failed })}`);
    }
  }

  const migrated = await post('/__test/subscription-migration', {});
  if (!migrated.ok || migrated.layout.subscriptionSchemaVersion !== 2 || migrated.layout.subscriptionCount !== subscriptionCount) {
    throw new Error(`successful migration lost state: ${JSON.stringify(migrated)}`);
  }
  const currentRootPage = migrated.layout.subscriptionRootPage;
  const current = await post('/__test/subscription-migration', { forceLegacy: false });
  if (!current.ok || current.layout.subscriptionRootPage !== currentRootPage || current.layout.subscriptionCount !== subscriptionCount) {
    throw new Error(`current schema was rewritten: ${JSON.stringify({ migrated, current })}`);
  }
  if (!current.layout.indexes.some((entry) => entry.name === 'idx_snapback_subscriptions_function')) {
    throw new Error('subscription function-selection index disappeared during migration');
  }

  socket.close();
  console.log('cloudflare storage-layout acceptance: expression indexes and atomic one-time subscription migration passed');
} finally {
  await proof.dispose();
}
