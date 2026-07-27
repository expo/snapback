// Commerce local transaction-authority acceptance.
//
// @ref LLP 0063#next-application-pressure-tests — this suite covers only
// implemented-local rows in pressure-profile.v1.json and cannot satisfy
// STEP6.COMMERCE or commerce-payments-v1.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SnapbackClient } from '../../../_kit/client.mjs';
import {
  assert,
  assertEqual,
  assertThrows,
  createSuite,
  runAcceptance,
} from '../../../_kit/harness.mjs';
import { startServer } from '../../../_kit/server-process.mjs';
import api from '../../snapback/generated/api.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..', '..', '..');
const backendDir = join(here, '..', '..', 'snapback');
const generated = (name) => JSON.parse(
  readFileSync(join(backendDir, 'generated', name), 'utf8'),
);
const seed = JSON.parse(readFileSync(join(backendDir, 'seed.json'), 'utf8'));
const beginArgs = JSON.parse(
  readFileSync(join(backendDir, 'generated', 'operations', 'beginCheckout.args.schema.json')),
);

const BUYER_A = 'user_buyer_a';
const BUYER_B = 'user_buyer_b';
const OUTSIDER = 'user_outsider';
const FINAL_UNIT = 'seed_product_final_unit';
const BAD_EXPONENT = 'seed_product_bad_exponent';
const OVERFLOW = 'seed_product_overflow';
const suite = createSuite('commerce / local transaction kernel', { expectedChecks: 8 });
const cleanups = [];
let server;
let db;

const mutate = (ref, args, userId) => db.mutate(ref, { args, userId });
const query = (ref, args, userId) => db.query(ref, { args, userId });

await runAcceptance(suite, async () => {
  server = await startServer({
    port: 0,
    db: ':memory:',
    cwd: repoRoot,
    provenance: {
      appId: 'commerce',
      artifactsPath: join(backendDir, 'generated', 'artifacts.json'),
    },
  });
  cleanups.push(() => server.stop());
  db = new SnapbackClient(server.baseUrl, server.clientOptions);

  await suite.check('isolated server loads the committed commerce artifacts and seed', async () => {
    const schemaLoad = await db.loadSchema(generated('schema.manifest.json'));
    assertEqual(
      schemaLoad.diagnostics.filter(({ severity }) => severity === 'Error' || severity === 'Fatal'),
      [],
      'schema diagnostics',
    );
    await db.loadFunctions(generated('functions.manifest.json'));
    await db.reset();
    await db.seed(seed);
    assert((await db.health()).ok, 'server health is not ok');
    assertEqual(server.identity.mismatches, [], 'server/check-out identity mismatch');
    assertEqual(
      server.identity.binary.gitCommit,
      server.identity.expected.gitCommit,
      'server/check-out base commit',
    );
    assertEqual((await query(api.catalog, {}, BUYER_A)).rows.length, 3, 'seeded catalog');
    return {
      launchRung: server.launch.rung,
      identityVerdict: server.identity.verdict,
    };
  });

  await suite.check('beginCheckout has a closed order-only public argument schema', async () => {
    assertEqual(Object.keys(beginArgs.properties), ['orderId'], 'beginCheckout public properties');
    assertEqual(beginArgs.required, ['orderId'], 'beginCheckout required properties');
    assertEqual(beginArgs.additionalProperties, false, 'beginCheckout schema closure');
  });

  await suite.check('order creation snapshots trusted price/version facts and is idempotent', async () => {
    const created = await mutate(api.createOrder, {
      productId: FINAL_UNIT,
      quantity: 1,
      clientOrderKey: 'buyer-a-final-unit',
    }, BUYER_A);
    assertEqual(created.result.totalMinorUnits, 2500, 'trusted line total');
    const replay = await mutate(api.createOrder, {
      productId: FINAL_UNIT,
      quantity: 1,
      clientOrderKey: 'buyer-a-final-unit',
    }, BUYER_A);
    assertEqual(replay.result.orderId, created.result.orderId, 'idempotent order id');
    assertEqual(replay.result.replayed, true, 'order replay marker');
    const lines = await query(api.myOrderLines, { orderId: created.result.orderId }, BUYER_A);
    assertEqual(
      lines.rows.map((line) => [
        line.productSlug,
        line.priceVersion,
        line.currency,
        line.exponent,
        line.unitMinorUnits,
        line.quantity,
        line.lineMinorUnits,
      ]),
      [['last-seat', 1, 'USD', 2, 2500, 1, 2500]],
      'immutable order line money',
    );
  });

  let orderA;
  let orderB;
  await suite.check('a second buyer can prepare an independently priced draft order', async () => {
    orderA = (await query(api.myOrders, {}, BUYER_A)).rows[0]._id;
    orderB = (await mutate(api.createOrder, {
      productId: FINAL_UNIT,
      quantity: 1,
      clientOrderKey: 'buyer-b-final-unit',
    }, BUYER_B)).result.orderId;
    assert(orderA !== orderB, 'buyers unexpectedly share an order');
  });

  await suite.check('final-unit contention commits exactly one reservation and attempt', async () => {
    const outcomes = await Promise.allSettled([
      mutate(api.beginCheckout, { orderId: orderA }, BUYER_A),
      mutate(api.beginCheckout, { orderId: orderB }, BUYER_B),
    ]);
    const fulfilled = outcomes.filter(({ status }) => status === 'fulfilled');
    const rejected = outcomes.filter(({ status }) => status === 'rejected');
    assertEqual(fulfilled.length, 1, 'checkout winner count');
    assertEqual(rejected.length, 1, 'checkout loser count');
    const rejectionCode = rejected[0].reason?.diagnostic?.code
      ?? rejected[0].reason?.code
      ?? rejected[0].reason?.message;
    assert(
      rejectionCode === 'SNAPBACK_MUTATION_CONFLICT'
        || rejectionCode === 'SNAPBACK_AUTH_RESERVATION_STALE'
        || rejectionCode === 'SNAPBACK_HANDLER_FAILED',
      `unexpected contention loser: ${String(rejectionCode)}`,
    );

    const attemptsA = (await query(api.myPaymentAttempts, {}, BUYER_A)).rows;
    const attemptsB = (await query(api.myPaymentAttempts, {}, BUYER_B)).rows;
    const reservationsA = (await query(api.myReservations, { orderId: orderA }, BUYER_A)).rows;
    const reservationsB = (await query(api.myReservations, { orderId: orderB }, BUYER_B)).rows;
    const attempts = [...attemptsA, ...attemptsB];
    const reservations = [...reservationsA, ...reservationsB];
    assertEqual(attempts.length, 1, 'durable attempt count');
    assertEqual(reservations.length, 1, 'durable reservation count');
    assertEqual(attempts[0].minorUnits, 2500, 'attempt amount');
    assertEqual(attempts[0].providerCallAdmitted, false, 'provider call admission');
    assertEqual(reservations[0].providerRequestMayHaveArrived, false, 'provider request ambiguity');
    assertEqual(
      (await query(api.catalog, {}, BUYER_A)).rows.find(({ _id }) => _id === FINAL_UNIT).availableUnits,
      0,
      'remaining inventory',
    );
    const orders = [
      ...(await query(api.myOrders, {}, BUYER_A)).rows,
      ...(await query(api.myOrders, {}, BUYER_B)).rows,
    ];
    assertEqual(
      orders.map(({ state }) => state).sort(),
      ['draft', 'reserved'],
      'winner/loser order states',
    );
    assertEqual(
      orders.filter(({ state, attemptId }) => state === 'draft' && attemptId == null).length,
      1,
      'loser retained a partial attempt link',
    );
    return { winner: attempts[0].ownerId, loserCode: rejectionCode };
  });

  await suite.check('replaying the winning checkout returns the immutable attempt', async () => {
    const attemptsA = (await query(api.myPaymentAttempts, {}, BUYER_A)).rows;
    const winner = attemptsA.length === 1
      ? { userId: BUYER_A, orderId: orderA, attempt: attemptsA[0] }
      : {
          userId: BUYER_B,
          orderId: orderB,
          attempt: (await query(api.myPaymentAttempts, {}, BUYER_B)).rows[0],
        };
    const replay = await mutate(api.beginCheckout, { orderId: winner.orderId }, winner.userId);
    assertEqual(replay.result.attemptId, winner.attempt._id, 'checkout replay attempt id');
    assertEqual(replay.result.replayed, true, 'checkout replay marker');
    assertEqual(replay.result.providerCallAdmitted, false, 'checkout replay provider state');
  });

  await suite.check('cross-user order reads and checkout fail without an existence oracle', async () => {
    assertEqual(
      (await query(api.myOrderLines, { orderId: orderA }, OUTSIDER)).rows,
      [],
      'outsider order lines',
    );
    await assertThrows(
      () => mutate(api.beginCheckout, { orderId: orderA }, OUTSIDER),
      'SNAPBACK_HANDLER_FAILED',
      'outsider checkout denial',
    );
  });

  await suite.check('invalid exponent and overflowing totals fail before order creation', async () => {
    await assertThrows(
      () => mutate(api.createOrder, {
        productId: BAD_EXPONENT,
        quantity: 1,
        clientOrderKey: 'bad-exponent',
      }, BUYER_A),
      'SNAPBACK_HANDLER_FAILED',
      'invalid exponent',
    );
    await assertThrows(
      () => mutate(api.createOrder, {
        productId: OVERFLOW,
        quantity: 2,
        clientOrderKey: 'overflow',
      }, BUYER_A),
      'SNAPBACK_HANDLER_FAILED',
      'overflowing total',
    );
    const orders = (await query(api.myOrders, {}, BUYER_A)).rows;
    assertEqual(
      orders.filter(({ clientOrderKey }) => clientOrderKey === 'bad-exponent' || clientOrderKey === 'overflow'),
      [],
      'invalid money committed an order',
    );
  });
}, {
  cleanups,
  reportExtra: {
    demo: 'commerce',
    profileId: 'commerce/local-transaction-kernel-v0',
    claimEligible: false,
    roadmapClaim: 'STEP6.COMMERCE',
  },
});
