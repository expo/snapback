// ENG-24349 / ENG-24360 / ENG-24361 / ENG-24367: declared expression indexes
// are definition-reconciled, startup refusal remains recoverable, reset
// rebuilds exactly the current owned schema, and subscription migration is
// versioned and atomic at every statement boundary.
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

  const plan = await post('/_snapback/test/index-plan', { table: 'notes', index: 'by_board', value: 'board-1' });
  if (!plan.details?.some((detail) => detail.includes('idx_app_notes_by_board'))) {
    throw new Error(`declared index was not selected by EXPLAIN QUERY PLAN: ${JSON.stringify(plan)}`);
  }

  // Populate enough durable subscriptions that an accidental per-wake table
  // rewrite is observable and materially nontrivial.
  const sockets = [await proof.openLiveSocket(), await proof.openLiveSocket()];
  const subscriptionCount = 128;
  for (let index = 0; index < subscriptionCount; index += 1) {
    const socket = sockets[index % sockets.length];
    socket.send({ type: 'subscribe', name: 'listNotes', args: { boardId: `layout-${index}` } });
    await socket.waitFor('snapshot');
  }
  const initial = await post('/_snapback/test/storage-layout');
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
    const before = await post('/_snapback/test/storage-layout');
    const failed = await post('/_snapback/test/subscription-migration', { failAt });
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

  await post('/_snapback/test/schema-hardening', { operation: 'create-socketless-kit-orphan' });
  const withOrphan = await post('/_snapback/test/storage-layout');
  if (withOrphan.subscriptionCount !== subscriptionCount + 1) {
    throw new Error(`socketless kit orphan fixture was not installed: ${JSON.stringify(withOrphan)}`);
  }
  const migrated = await post('/_snapback/test/subscription-migration', {});
  const orphanAfterMigration = await post('/_snapback/test/schema-hardening', {});
  if (
    !migrated.ok ||
    migrated.layout.subscriptionSchemaVersion !== 3 ||
    migrated.layout.subscriptionCount !== subscriptionCount ||
    orphanAfterMigration.orphanPresent
  ) {
    throw new Error(`successful migration lost state: ${JSON.stringify(migrated)}`);
  }
  const currentRootPage = migrated.layout.subscriptionRootPage;
  const current = await post('/_snapback/test/subscription-migration', { forceLegacy: false });
  if (!current.ok || current.layout.subscriptionRootPage !== currentRootPage || current.layout.subscriptionCount !== subscriptionCount) {
    throw new Error(`current schema was rewritten: ${JSON.stringify({ migrated, current })}`);
  }
  if (!current.layout.indexes.some((entry) => entry.name === 'idx_snapback_subscriptions_function')) {
    throw new Error('subscription function-selection index disappeared during migration');
  }

  for (const socket of sockets) socket.close();

  const corrupt = await post('/_snapback/test/schema-hardening', { operation: 'corrupt-index' });
  if (!/CREATE UNIQUE INDEX/i.test(corrupt.indexSql) || !/\(id,/.test(corrupt.indexSql)) {
    throw new Error(`index corruption fixture did not change uniqueness/field order: ${JSON.stringify(corrupt)}`);
  }
  const reconciled = await post('/_snapback/test/schema-hardening', { operation: 'reconcile-index' });
  if (/CREATE UNIQUE INDEX/i.test(reconciled.indexSql) || !/json_extract\(row_json/i.test(reconciled.indexSql) || /\(id,/.test(reconciled.indexSql)) {
    throw new Error(`same-name changed index definition survived reconciliation: ${JSON.stringify(reconciled)}`);
  }

  await post('/_snapback/test/schema-hardening', { operation: 'create-retired-table' });
  await post('/_snapback/test/schema-hardening', { operation: 'corrupt-index' });
  await proof.corruptMeta({ schemaHash: 'stale-before-ddl' });
  const refused = await post('/_snapback/test/schema-hardening', { operation: 'reinitialize' });
  if (refused.startupError?.code !== 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH' || !/CREATE UNIQUE INDEX/i.test(refused.indexSql)) {
    throw new Error(`startup performed app DDL before identity refusal: ${JSON.stringify(refused)}`);
  }
  const refusedHealth = await fetch(`${base}/health`);
  if (refusedHealth.status !== 409 || (await refusedHealth.json()).code !== 'SNAPBACK_STALE_CLOUDFLARE_SCHEMA_HASH') {
    throw new Error('stale startup did not remain diagnosable through /health');
  }
  const recovered = await proof.reset();
  if (!recovered.reset) throw new Error(`stale startup was not recoverable through reset: ${JSON.stringify(recovered)}`);
  const rebuilt = await post('/_snapback/test/schema-hardening', {});
  if (rebuilt.ownedTables.includes('app_retired_fixture') || /CREATE UNIQUE INDEX/i.test(rebuilt.indexSql)) {
    throw new Error(`reset retained retired data or a stale index: ${JSON.stringify(rebuilt)}`);
  }

  await post('/_snapback/test/schema-hardening', { operation: 'future-subscriptions' });
  const futureHealth = await fetch(`${base}/health`);
  const futureBody = await futureHealth.json();
  if (futureHealth.status !== 409 || futureBody.code !== 'SNAPBACK_SUBSCRIPTION_SCHEMA_UNSUPPORTED') {
    throw new Error(`future subscription schema was interpreted instead of refused: ${JSON.stringify(futureBody)}`);
  }
  const futureReset = await proof.reset();
  const postFuture = await post('/_snapback/test/storage-layout');
  if (!futureReset.reset || postFuture.subscriptionSchemaVersion !== 3) {
    throw new Error(`reset did not rebuild a future subscription schema: ${JSON.stringify({ futureReset, postFuture })}`);
  }

  for (const operation of ['corrupt-foundation-meta', 'corrupt-foundation-version']) {
    const corrupted = await post('/_snapback/test/schema-hardening', { operation });
    if (corrupted.startupError?.code !== 'SNAPBACK_CLOUDFLARE_FOUNDATION_SCHEMA_INVALID') {
      throw new Error(`${operation} did not become a recoverable startup refusal: ${JSON.stringify(corrupted)}`);
    }
    const healthResponse = await fetch(`${base}/health`);
    const healthBody = await healthResponse.json();
    if (healthResponse.status !== 409 || healthBody.code !== 'SNAPBACK_CLOUDFLARE_FOUNDATION_SCHEMA_INVALID') {
      throw new Error(`${operation} made /health unavailable: ${JSON.stringify(healthBody)}`);
    }
    if (operation === 'corrupt-foundation-version' && healthBody.version !== null) {
      throw new Error(`corrupt version table must report an honest null version: ${JSON.stringify(healthBody)}`);
    }
    const reset = await proof.reset();
    const healthy = await proof.health();
    if (!reset.reset || healthy.ok !== true || !Number.isFinite(healthy.version)) {
      throw new Error(`${operation} was not recoverable through authenticated reset: ${JSON.stringify({ reset, healthy })}`);
    }
  }
  for (let index = 0; index < 3; index += 1) {
    const repeated = await proof.reset();
    if (!repeated.reset) throw new Error(`repeated schema reset ${index} failed: ${JSON.stringify(repeated)}`);
  }

  console.log('cloudflare storage-layout acceptance: index reconciliation, startup/reset recovery, and atomic subscription migration passed');
} finally {
  await proof.dispose();
}
