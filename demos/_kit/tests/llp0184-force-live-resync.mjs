// Acceptance for LLP 0184 §B: debug.live.forceResync.
//
// This exercises the real, unmocked client recovery path: a genuine
// SnapbackClient live-query handle (packages/snapback-client), polling a
// real running snapback server, must blank/resnapshot through its own
// ordinary resubscribe machinery when the server-side host operation fires
// — not an injected sentinel (contrast demos/_kit/tests/
// regression-midflight-resync.mjs, which deliberately synthesizes the wire
// frame for a different, timing-focused regression).
//
// Proves, against a real server:
//   1. targeting one subscription by connection id + subscription id fires
//      resync_required for exactly that subscription, not a sibling
//      subscription on the same connection;
//   2. a stale startup nonce is refused before anything is touched;
//   3. the client-observable effect is a real resubscribe/resnapshot
//      through the client SDK's normal recovery state machine;
//   4. the operation is target-refused on a simulated hosted/production
//      instance;
//   5. no application data changes as a result (the underlying rows are
//      byte-for-byte the same before and after, only the client's view is
//      refreshed through a fresh snapshot).
//
// @ref LLP 0184#b-forced-live-resync--add-now — the required contract this
//   suite proves.
//
// Run: node demos/_kit/tests/llp0184-force-live-resync.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { startServer } from '../server-process.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..');
const backendDir = join(repoRoot, 'demos', 'todo', 'snapback');
const gen = (f) => JSON.parse(readFileSync(join(backendDir, 'generated', f), 'utf8'));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, timeoutMs = 6_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(25);
  }
  throw new Error(`timed out waiting for ${label}`);
};

// transport:'poll' handles never auto-poll (packages/snapback-client's
// fallback timer only arms for transport:'stream'); the caller drains them.
// Drive both handles on a short interval so the real client SDK's own
// drain/resubscribe machinery discovers the server-enqueued resync_required
// frame exactly the way a polling app would.
const drivePolling = (handles, intervalMs = 150) => {
  const timer = setInterval(() => {
    for (const handle of handles) {
      handle.poll().catch(() => {});
    }
  }, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
};

const { SnapbackClient } = await import(join(repoRoot, 'demos/_kit/client.mjs'));

async function postHostOp(baseUrl, adminToken, body) {
  const response = await fetch(`${baseUrl}/_snapback/api/host-ops`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(adminToken ? { 'x-snapback-admin-token': adminToken } : {}),
    },
    body: JSON.stringify({
      schemaVersion: '1',
      requestId: `req_llp0184_force_resync_${Math.random().toString(36).slice(2)}`,
      ...body,
    }),
  });
  return response.json();
}

const suite = createSuite('LLP 0184 §B / debug.live.forceResync acceptance', { expectedChecks: 5 });
const ADA = 'user_ada';
const GRACE = 'user_grace';
const CONN = 'llp0184_force_resync_conn';

let server = null;
let hostedProdServer = null;
try {
  server = await startServer({ port: 4442, db: ':memory:', cwd: repoRoot });
  const db = new SnapbackClient(server.baseUrl, server.clientOptions);
  await db.loadSchema(gen('schema.manifest.json'));
  await db.loadFunctions(gen('functions.manifest.json'));
  await db.reset();
  const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
  await db.seed(seed);

  const eventsA = [];
  const eventsB = [];
  // Two distinct subscriptions on the SAME connection: different users
  // scope `listTodos` to different rows (authScopeField: 'userId'), so the
  // client SDK cannot dedupe/share these into one subscription — exactly
  // the "one subscription, not the whole connection" shape §B requires.
  const handleA = await db.liveQuery('listTodos', {
    connectionId: CONN,
    userId: ADA,
    transport: 'poll',
    onSubscriptionEvent: (e) => eventsA.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });
  const handleB = await db.liveQuery('listTodos', {
    connectionId: CONN,
    userId: GRACE,
    transport: 'poll',
    onSubscriptionEvent: (e) => eventsB.push(`${e.event}${e.reason ? `:${e.reason}` : ''}`),
  });

  const stopPolling = drivePolling([handleA, handleB]);
  try {
    await waitFor(
      () => typeof handleA.subscriptionId === 'string' && typeof handleB.subscriptionId === 'string',
      'both handles to receive their initial subscription id',
    );
    assert(
      handleA.subscriptionId !== handleB.subscriptionId,
      'precondition: the two live queries hold distinct subscription ids on one connection',
    );
    const rowsABefore = JSON.stringify(handleA.rows);
    const rowsBBefore = JSON.stringify(handleB.rows);

    await suite.check(
      'targeting one subscription by connection+subscription id fires resync_required for exactly that subscription',
      async () => {
        const subscriptionIdA = handleA.subscriptionId;
        const previousSubscriptionIdB = handleB.subscriptionId;
        const eventsACountBefore = eventsA.length;
        const eventsBCountBefore = eventsB.length;

        const result = await postHostOp(server.baseUrl, server.adminToken, {
          operation: 'debug.live.forceResync',
          input: {
            connectionId: CONN,
            subscriptionId: subscriptionIdA,
            reason: 'llp0184-acceptance-targeted-resync',
            clearRetained: true,
            startupNonce: server.startupNonce,
          },
        });
        assert(result.ok === true, `expected ok:true, got ${JSON.stringify(result)}`);
        assertEqual(result.data.connectionId, CONN, 'receipt names the connection id');
        assertEqual(result.data.subscriptionId, subscriptionIdA, 'receipt names the exact subscription id');
        assertEqual(result.data.reason, 'llp0184-acceptance-targeted-resync', 'receipt echoes the closed reason');
        assertEqual(result.data.clearRetained, true, 'receipt echoes the selected disposition');

        // The client-observable effect: handleA's OWN resubscribe machinery
        // (no injected frame) discovers the resync and re-establishes.
        await waitFor(
          () => eventsA.length > eventsACountBefore && eventsA.some((e) => e.startsWith('resubscribed')),
          'handle A to resubscribe through its normal recovery path',
        );
        await waitFor(
          () => handleA.subscriptionId !== null && handleA.subscriptionId !== subscriptionIdA,
          'handle A to mint a fresh subscription id from the forced resnapshot',
        );

        // handle B, on the same connection but a different subscription,
        // must NOT have been perturbed — proving single-subscription
        // targeting, not connection-wide (LLP 0184 OQ4: connection-wide
        // targeting is out of v1 scope, not silently reachable).
        await sleep(300);
        assertEqual(eventsB.length, eventsBCountBefore, 'the sibling subscription received no resubscribe event');
        assertEqual(handleB.subscriptionId, previousSubscriptionIdB, 'the sibling subscription id is unchanged');

        return {
          receipt: result.data,
          handleAResubscribed: true,
          handleBUntouched: eventsB.length === eventsBCountBefore,
        };
      },
    );

    await suite.check('a stale startup nonce is refused', async () => {
      const subscriptionIdB = handleB.subscriptionId;
      const eventsBCountBefore = eventsB.length;
      const result = await postHostOp(server.baseUrl, server.adminToken, {
        operation: 'debug.live.forceResync',
        input: {
          connectionId: CONN,
          subscriptionId: subscriptionIdB,
          reason: 'llp0184-acceptance-stale-nonce',
          clearRetained: false,
          startupNonce: 'not-the-real-startup-nonce',
        },
      });
      assertEqual(result.ok, false, 'a stale startup nonce must refuse, not succeed');
      const code = result.diagnostics?.[0]?.code;
      assertEqual(
        code,
        'SNAPBACK_LIVE_FORCE_RESYNC_STARTUP_NONCE_MISMATCH',
        `expected the startup-nonce-mismatch diagnostic, got ${code}`,
      );
      // The refusal must not have perturbed anything either.
      await sleep(200);
      assertEqual(eventsB.length, eventsBCountBefore, 'a refused call fires no resync event');
      assertEqual(handleB.subscriptionId, subscriptionIdB, 'a refused call leaves the subscription id unchanged');
      return { diagnosticCode: code };
    });

    await suite.check(
      'the operation is target-refused on a simulated hosted/production instance',
      async () => {
        hostedProdServer = await startServer({
          port: 4443,
          db: ':memory:',
          cwd: repoRoot,
          env: { SNAPBACK_PROFILE: 'prod' },
        });
        const result = await postHostOp(hostedProdServer.baseUrl, hostedProdServer.adminToken, {
          operation: 'debug.live.forceResync',
          input: {
            connectionId: 'irrelevant-connection',
            subscriptionId: 'irrelevant-subscription',
            reason: 'llp0184-acceptance-hosted-refusal',
            clearRetained: false,
            startupNonce: hostedProdServer.startupNonce,
          },
        });
        // Target refusal happens at the admin-op authority gate, before a
        // hostOpsResult envelope is even constructed (the same shape every
        // other pre-dispatch host-ops refusal uses, e.g. an unknown
        // operation or a missing admin credential) — a bare
        // `{ diagnostic }` body, not `{ ok:false, diagnostics:[...] }`.
        assert(result.ok !== true, 'a prod-profile target must refuse the perturbation');
        const code = result.diagnostic?.code ?? result.diagnostics?.[0]?.code;
        assertEqual(
          code,
          'SNAPBACK_DEBUG_PERTURBATION_TARGET_REFUSED',
          `expected the target-refusal diagnostic, got ${code} (full body: ${JSON.stringify(result)})`,
        );
        return { diagnosticCode: code };
      },
    );

    await suite.check('no application data changes as a result', async () => {
      // handleA/handleB's rows reflect the exact same seeded content before
      // and after every call above — the forced resync changed the client's
      // *subscription* identity, never the underlying committed rows.
      await waitFor(() => handleA.rows.length > 0 && handleB.rows.length > 0, 'both handles hold rows again');
      assertEqual(JSON.stringify(handleA.rows), rowsABefore, 'user A rows are byte-identical before/after');
      assertEqual(JSON.stringify(handleB.rows), rowsBBefore, 'user B rows are byte-identical before/after');
      return { rowsAUnchanged: true, rowsBUnchanged: true };
    });

    await suite.check('the receipt is auditable and the diagnostics are structured, never a raw 500', async () => {
      const result = await postHostOp(server.baseUrl, server.adminToken, {
        operation: 'debug.live.forceResync',
        input: {
          connectionId: CONN,
          subscriptionId: 'sub_does_not_exist',
          reason: 'llp0184-acceptance-unknown-subscription',
          clearRetained: false,
          startupNonce: server.startupNonce,
        },
      });
      assertEqual(result.ok, false, 'an unknown subscription id must refuse');
      const code = result.diagnostics?.[0]?.code;
      assertEqual(
        code,
        'SNAPBACK_LIVE_FORCE_RESYNC_SUBSCRIPTION_NOT_FOUND',
        `expected the subscription-not-found diagnostic, got ${code}`,
      );
      return { diagnosticCode: code };
    });
  } finally {
    stopPolling();
    handleA.dispose();
    handleB.dispose();
  }

  const report = suite.finish();
  console.log('\n--- machine-readable report ---');
  console.log(JSON.stringify(report));
  await server.stop();
  if (hostedProdServer) await hostedProdServer.stop();
  process.exit(report.ok ? 0 : 1);
} catch (error) {
  console.error('LLP 0184 §B force-live-resync acceptance harness crashed:', error);
  if (server) await server.stop();
  if (hostedProdServer) await hostedProdServer.stop();
  process.exit(2);
}
