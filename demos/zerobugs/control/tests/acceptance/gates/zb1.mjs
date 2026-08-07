import {join} from 'node:path';

import {
  CONTROL_ROOT,
  FROZEN_QUERY_NAMES,
  LANE_CHECK_IDS,
  actorIdentityFromLaneReceipts,
  assertLaneCheck,
  buildGateReceiptFields,
  createHeadlessStack,
  gateCheckStatus,
  loadGateContext,
  runLaneHarness,
} from '../gate-support.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb1--relational-and-window-correctness — the independent
// raw-fixture oracle remains the expected-value authority for every query.

const LANE3_IDS = LANE_CHECK_IDS.lane3.map(id => `lane3.${id}`);
const CHECK_IDS = Object.freeze([
  ...LANE3_IDS,
  'lane6a.adapter-initial-window-and-outside-permalink',
  'lane6a.controller-bidirectional-walk-matches-lane3-oracle',
  'query-group-cut-current-surface',
]);

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb1.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane3-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6a-live.mts'),
    join(CONTROL_ROOT, 'tests/lane3-oracle.mts'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  let lane3 = null;
  let lane6a = null;
  let actorIdentity = actorIdentityFromLaneReceipts();

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb1',
    attempt,
    title: 'Zerobugs control ZB1 — relational and window correctness',
    expectedCheckIds: CHECK_IDS,
    run: async gate => {
      const lane3Stack = await createHeadlessStack(gate, 'zb1-lane3');
      lane3 = await runLaneHarness('lane3', lane3Stack);
      actorIdentity = actorIdentityFromLaneReceipts(lane3);
      for (const id of LANE_CHECK_IDS.lane3) {
        await gate.check(`lane3.${id}`, async () => assertLaneCheck(lane3, id));
      }

      const lane6aStack = await createHeadlessStack(gate, 'zb1-lane6a');
      lane6a = await runLaneHarness('lane6a', lane6aStack);
      for (const id of [
        'adapter-initial-window-and-outside-permalink',
        'controller-bidirectional-walk-matches-lane3-oracle',
      ]) {
        await gate.check(`lane6a.${id}`, async () => assertLaneCheck(lane6a, id));
      }

      gate.gap('query-group-cut-current-surface', {
        owner: 'D2 relational graph workstream',
        reason: 'W-QGROUP: the 19 opaque JavaScript live queries have no schema-derived route bindings, so the landed route-group attempt was removed rather than simulated.',
        substitute: 'parent-authorized individually generated query calls; all are exercised above',
      });
    },
    buildReceipt: async run => buildGateReceiptFields(context, run, {
      actorIdentity,
      capabilityFacts: [
        {
          id: 'relational-graph.issue-list',
          status: gateCheckStatus(run.checks, 'lane3.list-every-filter-and-combined-parity') === 'PASS'
            ? 'supported-local-control'
            : 'refused',
          queryCount: FROZEN_QUERY_NAMES.length,
          carrier: 'bounded typed JavaScript live-query handlers plus maintained read models',
        },
        {
          id: 'relational-graph.issue-detail',
          status: gateCheckStatus(run.checks, 'lane3.issue-detail-and-public-comment-graph-parity') === 'PASS'
            ? 'supported-local-control'
            : 'refused',
          carrier: 'parent-authorized bounded graph loader',
        },
        {
          id: 'windowed-query.issue-list',
          status: gateCheckStatus(run.checks, 'lane6a.controller-bidirectional-walk-matches-lane3-oracle') === 'PASS'
            ? 'supported-local-control'
            : 'refused',
          carrier: 'application-owned server-backed WindowController',
        },
        {
          id: 'query-group-cut',
          status: 'gap',
          owner: 'D2',
        },
      ],
      refusalFacts: [{
        id: 'implicit-limit-as-complete',
        status: 'refused',
        evidence: 'lane3.small-window-declares-incompleteness',
      }],
      workarounds: [
        {id: 'W-QGROUP', status: 'retained; explicit GAP above'},
        {id: 'W-READMODEL', status: 'retained and exercised against independent raw-source oracle'},
        {id: 'W-MANUALSET', status: 'retained with exact bounds/cursors/completeness'},
        {id: 'W-SEARCH-EPOCH', status: 'retained with role-partitioned bound/refusal'},
        {id: 'W-WINDOW', status: 'retained application-owned headless controller'},
      ],
      sourceAccounting: {
        frozenQueries: FROZEN_QUERY_NAMES.length,
        exercisedQueries: gateCheckStatus(run.checks, 'lane3.all-frozen-query-names-exercised') === 'PASS'
          ? FROZEN_QUERY_NAMES.length
          : 0,
        lane3ExpectedChecks: lane3?.receipt.expectedChecks ?? null,
        lane6aExpectedChecks: lane6a?.receipt.expectedChecks ?? null,
        oracle: 'tests/lane3-oracle.mts over raw normal+policy fixture rows',
      },
      custodyAccounting: {
        mode: 'headless-online-server-backed',
        browserFactsRetained: 0,
        localProjectedFactsClaimed: 0,
        queryNames: FROZEN_QUERY_NAMES,
      },
    }),
  });
}

const result = await main();
if (result.exitCode !== 0) process.exitCode = result.exitCode;
