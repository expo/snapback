import assert from 'node:assert/strict';
import {join} from 'node:path';

import {deriveAdapterResult} from '../../../src/data/queries.ts';
import {
  CONTROL_ROOT,
  FROZEN_MUTATION_NAMES,
  FROZEN_QUERY_NAMES,
  actorIdentityFromLaneReceipts,
  assertLaneCheck,
  buildGateReceiptFields,
  createHeadlessStack,
  loadGateContext,
  runLaneHarness,
} from '../gate-support.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb2--retained-and-local-data — unsupported local classes are
// named GAPs; no live-query bytes are relabeled as retained facts.

const QUERY_GAPS = FROZEN_QUERY_NAMES.map(name => `retained-query.${name}`);
const QUEUE_GAPS = FROZEN_MUTATION_NAMES.map(name => `queued-intent.${name}`);
const CHECK_IDS = Object.freeze([
  'adapter-current-label',
  'adapter-retained-label',
  'auth-transition-invalidates-predecessor',
  'no-widened-retention',
  ...QUERY_GAPS,
  ...QUEUE_GAPS,
  'browser-restart-retained-render',
  'two-tab-writer-handoff',
  'authorized-lease-expiry-retirement',
]);

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb2.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6a-live.mts'),
    join(CONTROL_ROOT, 'tests/lane6a-adapter.test.mts'),
    join(CONTROL_ROOT, 'src/data/queries.ts'),
    join(CONTROL_ROOT, 'src/data/mutations.ts'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  let lane6a = null;
  let actorIdentity = actorIdentityFromLaneReceipts();

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb2',
    attempt,
    title: 'Zerobugs control ZB2 — retained and local data',
    expectedCheckIds: CHECK_IDS,
    run: async gate => {
      const stack = await createHeadlessStack(gate, 'zb2');
      lane6a = await runLaneHarness('lane6a', stack);
      actorIdentity = actorIdentityFromLaneReceipts(lane6a);

      await gate.check('adapter-current-label', async () => {
        const row = {id: 'source-user', login: 'reader', avatar: 'https://example.invalid/a', role: 'user'};
        const frame = [{
          status: 'complete', reason: null, hasMore: false, cursor: null,
          examined: 1, total: 1, items: [row],
        }];
        const current = deriveAdapterResult('allUsers', {
          status: 'ready', data: frame, error: null,
          connection: 'live', freshness: 'current',
        });
        assert.equal(current.freshness, 'current');
        assert.equal(current.status, 'complete');
        assertLaneCheck(lane6a, 'adapter-initial-window-and-outside-permalink');
        return {label: 'current', carrier: 'online server-backed adapter'};
      });

      gate.gap('adapter-retained-label', {
        owner: 'D3 projected-facts/local-evaluation workstream',
        reason: 'The adapter can preserve a retained freshness label, but no Zerobugs query has an admitted retention carrier; ZB2 therefore does not synthesize retained bytes to make that path pass.',
        behavior: 'retained data remains unavailable rather than being relabeled current',
      });

      await gate.check('auth-transition-invalidates-predecessor', async () => ({
        ...assertLaneCheck(lane6a, 'session-switch-blanks-predecessor-before-successor'),
        disposition: 'predecessor blanked synchronously before successor publication',
      }));

      await gate.check('no-widened-retention', async () => {
        const frozen = new Set(FROZEN_QUERY_NAMES);
        const rows = context.functionsManifest.functions.filter(row => frozen.has(row.name));
        assert.equal(rows.length, FROZEN_QUERY_NAMES.length);
        assert(rows.every(row => row.kind === 'LiveQuery'));
        const serialized = JSON.stringify(rows);
        assert(!serialized.includes('rqsEligible'));
        assert(!serialized.includes('retentionRequest'));
        assert(!serialized.includes('snapshot-batch.v1'));
        return {
          inventoriedQueries: rows.length,
          admittedRetainableQueries: 0,
          widenedQueries: 0,
        };
      });

      for (const name of FROZEN_QUERY_NAMES) {
        gate.gap(`retained-query.${name}`, {
          query: name,
          reason: 'The current control declares no rqsEligible, relational-retainable, or snapshot-batch carrier for this opaque JavaScript query.',
          behavior: 'online server-backed only; stored bytes are never presented as an offline answer',
          owner: 'D3 projected-facts/local-evaluation workstream',
        });
      }
      for (const name of FROZEN_MUTATION_NAMES) {
        gate.gap(`queued-intent.${name}`, {
          mutation: name,
          reason: 'The control mutation adapter deliberately calls client.mutate with queue:false and exposes no disconnected-write surface.',
          behavior: 'honest unavailable offline; no queued success is fabricated',
          owner: 'D3/D5 offline-intent integration',
        });
      }
      gate.gap('browser-restart-retained-render', {
        owner: 'ZB5 real-browser custody arm',
        reason: 'A browser restart and IndexedDB custody cannot be proved by a headless no-Chrome ZB2 process, and this control has no retainable Zerobugs query.',
      });
      gate.gap('two-tab-writer-handoff', {
        owner: 'ZB5 real-browser custody arm',
        reason: 'Web Locks/two-tab ownership is browser-only and must not be simulated in Node.',
      });
      gate.gap('authorized-lease-expiry-retirement', {
        owner: 'D3 retained protected-query admission',
        reason: 'No protected Zerobugs query is admitted for retention, so no AuthorizedLease is acquired or claimed by the control.',
      });
    },
    buildReceipt: async run => buildGateReceiptFields(context, run, {
      actorIdentity,
      capabilityFacts: [
        {
          id: 'retained-read',
          status: 'gap',
          admittedQueries: 0,
          inventoriedQueries: FROZEN_QUERY_NAMES.length,
          owner: 'D3',
        },
        {
          id: 'durable-queued-intent',
          status: 'gap',
          admittedMutations: 0,
          inventoriedMutations: FROZEN_MUTATION_NAMES.length,
          owner: 'D3/D5',
        },
        {
          id: 'auth-transition-client-barrier',
          status: run.checks.rows.find(row => row.id === 'auth-transition-invalidates-predecessor')?.status === 'PASS'
            ? 'supported-local-control'
            : 'refused',
        },
      ],
      refusalFacts: [{
        id: 'widened-retention',
        status: 'refused',
        admittedRetainableQueries: 0,
      }],
      workarounds: [
        {id: 'W-WINDOW', status: 'online server-backed only'},
        {id: 'W-PENDING', status: 'offline mutation controls remain unavailable rather than falsely settled'},
      ],
      sourceAccounting: {
        queryMatrixRows: FROZEN_QUERY_NAMES.length,
        queuedIntentMatrixRows: FROZEN_MUTATION_NAMES.length,
        lane6aExpectedChecks: lane6a?.receipt.expectedChecks ?? null,
        admittedRetainableQueries: 0,
        admittedQueuedMutations: 0,
      },
      custodyAccounting: {
        mode: 'headless classification; no retained browser store',
        retainedQueryPayloads: 0,
        durableQueuedIntents: 0,
        browserFactsRetained: 0,
        authorityTransitionsChecked: 1,
      },
    }),
  });
}

const result = await main();
if (result.exitCode !== 0) process.exitCode = result.exitCode;
