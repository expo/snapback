// Regression: an undecodable durable item in an acknowledged poll batch must
// force connection-wide recovery without aborting the batch remainder.
//
// The drain response is already past the LLP 0059 ownership cut when
// drainConnection sees it: the malformed update cannot be redelivered and
// cannot be attributed to one subscription. LLP 0095 T-DB-P therefore
// requires the same transition as a socket durable_bytes frame:
// surface the decode diagnostic, deliver the remainder, resubscribe every
// durable handle, and clear retained ephemeral overlays.
//
// This no-server harness stubs only the transport endpoints. It exercises the
// real SnapbackClient live-query state machine, drain decoder, authority-aware
// lane registry, resubscribe path, and EphemeralOverlay poison latch.
//
// @ref LLP 0095#4.3 — T-DB-P requires forced resync plus acknowledged-batch
//   remainder delivery after a post-cut poll decode failure.
//
// Run: node demos/_kit/tests/regression-poll-decode-resync.mjs

import {
  DURABLE_BYTES_RESYNC_REASON,
  EphemeralOverlay,
  LIVE_DURABLE_KINDS,
  SnapbackClient,
} from '../client.mjs';
import { assert, assertEqual, createSuite } from '../harness.mjs';

const CONNECTION = 'poll_decode_resync';
const LOST_TITLE = 'lost behind acknowledged poll decode failure';
const suite = createSuite('_kit regression / poll decode forced resync', {
  expectedChecks: 1,
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (predicate, label, timeoutMs = 1_000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(10);
  }
  throw new Error(`timed out waiting for ${label}`);
};

await suite.check(
  'acknowledged malformed item surfaces a diagnostic, delivers the remainder, and recovers every lane',
  async () => {
    const db = new SnapbackClient('http://stub', { authClientProtocol: null });
    let subscribeCalls = 0;
    db.subscribeLive = async () => {
      subscribeCalls += 1;
      const recovering = subscribeCalls > 2;
      return {
        subscription_id: `sub_poll_decode_${subscribeCalls}`,
        snapshot: {
          version: subscribeCalls,
          rows: recovering ? [{ _id: 'lost-row', title: LOST_TITLE }] : [],
        },
      };
    };
    db.unsubscribeLive = async () => ({ removed: true });

    const eventsA = [];
    const eventsB = [];
    const handleA = await db.liveQuery('listTodos', {
      connectionId: CONNECTION,
      transport: 'poll',
      onSubscriptionEvent: (event) => {
        eventsA.push(`${event.event}${event.reason ? `:${event.reason}` : ''}`);
      },
    });
    const handleB = await db.liveQuery('listTodos', {
      connectionId: CONNECTION,
      transport: 'poll',
      onSubscriptionEvent: (event) => {
        eventsB.push(`${event.event}${event.reason ? `:${event.reason}` : ''}`);
      },
    });
    const originalSubscriptionB = handleB.subscriptionId;
    const overlay = new EphemeralOverlay(db, 'presence', {
      connectionId: CONNECTION,
      scope: { room: 'poll-decode-proof' },
      snapshot: {
        Snapshot: {
          room: { collection: 'presence', routing_key: 'poll-decode-proof' },
          scope_epoch: 1,
          high_water_version: 1,
          entries: [{
            key: 'retained-cursor',
            value: [...new TextEncoder().encode(JSON.stringify({ x: 1, y: 2 }))],
            received_at_ms: 1,
            expires_at_ms: 10_000,
            scope_epoch: 1,
            entry_version: 1,
          }],
        },
      },
    });
    const seenDurable = [];
    const seenEphemeral = [];
    const unregisterDurable = db.registerDurableConsumer(
      CONNECTION,
      (frame) => seenDurable.push(frame),
    );
    const unregisterEphemeral = db.registerEphemeralConsumer(
      CONNECTION,
      (frame) => seenEphemeral.push(frame),
    );

    try {
      assertEqual(handleA.rows, [], 'precondition: handle A lacks the committed row');
      assertEqual(handleB.rows, [], 'precondition: handle B lacks the committed row');
      assertEqual(
        overlay.currentEntries({ prune: false }).map((entry) => entry.key),
        ['retained-cursor'],
        'precondition: the overlay retains predecessor state',
      );

      // drainEnvelopes returns only after the server has acknowledged and
      // removed the batch. The first item stands for handle A's now-lost
      // commit; the following durable and ephemeral items prove that recovery
      // cannot abort processing of the remainder.
      db.drainEnvelopes = async () => [
        { Durable: { payload: [0xff, 0xfe, 0x00] } },
        {
          Durable: {
            payload: JSON.stringify({
              kind: LIVE_DURABLE_KINDS.LIVE_REPLACE,
              subscription_id: originalSubscriptionB,
              version: 2,
              rows: [{ _id: 'remainder-row', title: 'durable batch remainder' }],
            }),
          },
        },
        { Ephemeral: { Upsert: { entry: { key: 'ephemeral-batch-remainder' } } } },
      ];

      const drained = await db.drainConnection(CONNECTION);
      assertEqual(drained.decodeFailures.length, 1, 'one malformed item surfaces one diagnostic');
      assertEqual(
        drained.decodeFailures[0].code,
        'SNAPBACK_ENVELOPE_DECODE_FAILED',
        'the decode diagnostic retains its stable code',
      );
      assertEqual(drained.durable.length, 1, 'the durable remainder stays in the drain result');
      assertEqual(drained.ephemeral.length, 1, 'the ephemeral remainder stays in the drain result');
      assert(
        !drained.durable.some((frame) => frame?.reason === DURABLE_BYTES_RESYNC_REASON),
        'the recovery sentinel remains client-synthesized, not a decoded wire item',
      );

      const poison = seenDurable.find((frame) => (
        frame?.reason === DURABLE_BYTES_RESYNC_REASON
      ));
      assert(poison, 'the decode failure enters the durable recovery choke point');
      assertEqual(poison.kind, LIVE_DURABLE_KINDS.RESYNC_REQUIRED, 'the poison is resync_required');
      assert(poison.clear_retained === true, 'the poison clears retained state');
      assert(
        poison.subscription_id == null && poison.subscriptionId == null,
        'the poison is connection-wide',
      );
      assert(
        seenDurable.some((frame) => frame?.subscription_id === originalSubscriptionB),
        'the durable item behind the malformed item was delivered',
      );
      assert(
        seenEphemeral.some((frame) => frame?.Ephemeral),
        'the ephemeral item behind the malformed item was delivered',
      );
      assert(
        seenEphemeral.includes(poison),
        'the same connection-wide poison object crossed into the ephemeral lane',
      );
      assertEqual(overlay.currentEntries({ prune: false }), [], 'the retained overlay was blanked');
      assert(overlay.needsResync, 'the poisoned overlay generation remains closed');

      await waitFor(
        () => eventsA.some((event) => event.startsWith('resubscribed'))
          && eventsB.some((event) => event.startsWith('resubscribed')),
        'both durable handles to resubscribe',
      );
      await waitFor(
        () => handleA.rows.some((row) => row.title === LOST_TITLE)
          && handleB.rows.some((row) => row.title === LOST_TITLE),
        'both handles to recover the lost commit from fresh snapshots',
      );
      assertEqual(subscribeCalls, 4, 'exactly one fresh resubscribe ran per durable handle');
      return {
        diagnostic: drained.decodeFailures[0].code,
        durableRemainder: drained.durable.length,
        ephemeralRemainder: drained.ephemeral.length,
        resubscribes: subscribeCalls - 2,
        overlayCleared: overlay.needsResync,
      };
    } finally {
      unregisterDurable();
      unregisterEphemeral();
      overlay.dispose();
      handleA.dispose();
      handleB.dispose();
    }
  },
);

const report = suite.finish();
console.log('\n--- machine-readable report ---');
console.log(JSON.stringify(report));
process.exit(report.ok ? 0 : 1);
