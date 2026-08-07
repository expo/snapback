import assert from 'node:assert/strict';
import {join} from 'node:path';

import {createExternalSessionClient} from '@expo/snapback-client';

import api from '../../../snapback/generated/api.mjs';
import {mintDevSession} from '../../../scripts/load-fixture.mts';
import {
  CONTROL_ROOT,
  LANE_CHECK_IDS,
  actorIdentityFromLaneReceipts,
  assertLaneCheck,
  buildGateReceiptFields,
  createHeadlessStack,
  loadGateContext,
  runLaneHarness,
} from '../gate-support.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb4--authorization-and-information-flow — protected facts are
// checked at query/service delivery boundaries, including non-oracular 516/517.

const LANE3_AUTH_IDS = Object.freeze([
  'permalink-inside-outside-window-and-authoritative-not-found',
  'internal-policy-visibility-list-detail-preload',
  'child-roots-prove-parent-before-release',
  'principal-overlays-never-cross-actor-boundaries',
]);
const LANE5_AUTH_IDS = Object.freeze([
  'route-05-get-queries-alias',
  'route-06-query-alias-auth-malformed-and-oversized',
  'route-04-mutate-alias-and-trigger-identity',
  'route-03-push-alias-session-custody',
  'route-09-machine-markdown-public-parity',
  'route-09-machine-markdown-internal-crew-gate',
  'effect-eight-trigger-classes-exact-capture-and-internal-recipients',
  'route-08-safe-unsubscribe-get-post-expiry-forgery-replay',
  'route-07-upload-five-types-server-policy-delivery-and-cleanup',
]);
const CHECK_IDS = Object.freeze([
  ...LANE_CHECK_IDS.lane2.map(id => `lane2.${id}`),
  ...LANE3_AUTH_IDS.map(id => `lane3.${id}`),
  ...LANE5_AUTH_IDS.map(id => `lane5.${id}`),
  'full-seven-actor-matrix',
  'ordinary-crew-516-517-non-oracle',
  'admin-and-config-surfaces-protect-secrets-from-untrusted-callers',
  'fixture-ingestion-refuses-after-completion',
  'retained-negative-delivery',
  'queued-negative-delivery',
  'removed-member-crew-to-user-transition',
  'out-of-band-policy-change-invalidation',
]);

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb4.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane2-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane3-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane5-live.mts'),
    join(CONTROL_ROOT, 'tests/lane3-oracle.mts'),
    join(CONTROL_ROOT, 'composition/server.mts'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  let lane2 = null;
  let lane3 = null;
  let lane5 = null;
  let actorIdentity = actorIdentityFromLaneReceipts();

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb4',
    attempt,
    title: 'Zerobugs control ZB4 — authorization and information flow',
    expectedCheckIds: CHECK_IDS,
    run: async gate => {
      const lane2Stack = await createHeadlessStack(gate, 'zb4-lane2');
      lane2 = await runLaneHarness('lane2', lane2Stack);
      for (const id of LANE_CHECK_IDS.lane2) {
        await gate.check(`lane2.${id}`, async () => assertLaneCheck(lane2, id));
      }

      const lane3Stack = await createHeadlessStack(gate, 'zb4-lane3');
      lane3 = await runLaneHarness('lane3', lane3Stack);
      actorIdentity = actorIdentityFromLaneReceipts(lane3, lane2);
      for (const id of LANE3_AUTH_IDS) {
        await gate.check(`lane3.${id}`, async () => assertLaneCheck(lane3, id));
      }

      const lane5Stack = await createHeadlessStack(gate, 'zb4-lane5');
      lane5 = await runLaneHarness('lane5', lane5Stack);
      for (const id of LANE5_AUTH_IDS) {
        await gate.check(`lane5.${id}`, async () => assertLaneCheck(lane5, id));
      }

      await gate.check('full-seven-actor-matrix', async () => {
        assertLaneCheck(lane2, 'five-frozen-actors-bind-and-rebinding-refuses');
        assertLaneCheck(lane2, 'anonymous-refused-on-principal-bound-path');
        assertLaneCheck(lane2, 'forged-or-expired-bearer-refused');
        assert.equal(Object.keys(lane2.receipt.actorBindings).length, 5);
        return {
          boundActors: ['ordinary-user', 'creator', 'assignee', 'crew-admin', 'removed-member'],
          additionalActors: ['anonymous', 'forged-bearer-attacker'],
          totalActors: 7,
        };
      });

      await gate.check('ordinary-crew-516-517-non-oracle', async () => {
        assertLaneCheck(lane3, 'list-every-filter-and-combined-parity');
        assertLaneCheck(lane3, 'internal-policy-visibility-list-detail-preload');
        assert.equal(context.fixtureDigests.ordinaryBase.counts.issue, 516);
        assert.equal(context.fixtureDigests.sourceCounts.issue, 517);
        assert.equal(context.fixtureDigests.policyExtensionCounts.issue, 1);
        return {
          ordinaryVisibleIssues: 516,
          crewVisibleIssues: 517,
          protectedIssueContributionToOrdinaryCountLikeFacts: 0,
          missingAndInvisibleShape: 'identical-authoritative-not-found',
        };
      });

      await gate.check('admin-and-config-surfaces-protect-secrets-from-untrusted-callers', async () => {
        // LLP 0036: config READS deliberately exclude secret values and are
        // not admin-refused; writes and secret-bearing reads are gated. The
        // untrusted-caller contract is therefore: inspect refuses outright,
        // config/status discloses no configured secret value, and config/set
        // refuses the write.
        const statuses = [];
        for (const headers of [{}, {authorization: 'Bearer invalid-bearer'}]) {
          const inspect = await fetch(`${lane5Stack.serverUrl}/_snapback/api/inspect`, {headers});
          assert([401, 403].includes(inspect.status), '/_snapback/api/inspect refuses an untrusted caller');
          statuses.push({path: '/_snapback/api/inspect', status: inspect.status});
          const status = await fetch(`${lane5Stack.serverUrl}/_snapback/api/config/status`, {headers});
          const statusBody = await status.text();
          for (const secretValue of lane5Stack.sensitiveValues) {
            assert(!statusBody.includes(secretValue), 'config/status discloses no configured secret value');
          }
          statuses.push({path: '/_snapback/api/config/status', status: status.status, valueFree: true});
          const write = await fetch(`${lane5Stack.serverUrl}/_snapback/api/config/set`, {
            method: 'POST',
            headers: {...headers, 'content-type': 'application/json'},
            body: JSON.stringify({entry: 'loopsApiKey', value: 'zb4-untrusted-write'}),
          });
          assert([401, 403].includes(write.status), '/_snapback/api/config/set refuses an untrusted caller');
          statuses.push({path: '/_snapback/api/config/set', status: write.status});
        }
        return {probes: statuses.length, statuses};
      });

      await gate.check('fixture-ingestion-refuses-after-completion', async () => {
        const session = await mintDevSession(
          lane2Stack.readyFile,
          'zerobugs-zb4-post-fixture@acceptance.invalid',
        );
        const client = createExternalSessionClient(session.baseUrl, {
          bearerToken: session.token,
          clientStoreId: 'zerobugs-zb4-post-fixture',
          rqsStore: null,
        });
        let refusal = null;
        try {
          await client.mutate(api.fixtureIngestBatch, {
            args: {table: 'label', rows: []},
            clientMutationId: 'zerobugs-zb4-post-fixture-ingest',
            queue: false,
          });
        } catch (error) {
          refusal = error;
        } finally {
          await client.closeAuth();
        }
        assert(refusal, 'fixture ingestion unexpectedly reopened after completion');
        const code = refusal?.diagnostic?.code ?? refusal?.code;
        assert.equal(typeof code, 'string');
        assert(code.startsWith('SNAPBACK_'), 'fixture closure returns a stable refusal');
        return {status: 'refused', code};
      });

      gate.gap('retained-negative-delivery', {
        owner: 'D3 retained protected-query admission',
        reason: 'The control admits zero retainable Zerobugs queries, so there is no retained byte boundary to test or widen. ZB2 records all 19 query dispositions.',
      });
      gate.gap('queued-negative-delivery', {
        owner: 'D3/D5 offline-intent integration',
        reason: 'The control adapter passes queue:false for all 16 mutations, so no unauthorized queued write can honestly be constructed. ZB2 records the full matrix.',
      });
      gate.gap('removed-member-crew-to-user-transition', {
        owner: 'control policy-transition surface',
        reason: 'The landed control binds the removed-member fixture as crew but exposes no acceptance operation that changes the source user role out of band.',
      });
      gate.gap('out-of-band-policy-change-invalidation', {
        owner: 'control policy-transition surface',
        reason: 'No out-of-band role/policy mutation is exposed by the control; logout and user-switch predecessor deletion are proved by Lane 2.',
      });
    },
    buildReceipt: async run => buildGateReceiptFields(context, run, {
      actorIdentity,
      capabilityFacts: [
        {id: 'authorization.query-negative-delivery', status: 'supported-local-control'},
        {id: 'authorization.route-negative-delivery', status: 'supported-local-control'},
        {id: 'authorization.effect-negative-delivery', status: 'supported-local-capture-composition'},
        {id: 'authorization.unsubscribe-negative-delivery', status: 'supported-local-control'},
        {id: 'authorization.asset-negative-delivery', status: 'supported-local-control'},
        {id: 'authorization.retained-negative-delivery', status: 'gap', admittedRetainedQueries: 0},
        {id: 'authorization.queued-negative-delivery', status: 'gap', admittedQueuedMutations: 0},
      ],
      refusalFacts: [
        {id: 'protected-child-existence-oracle', status: 'refused', ordinaryCount: 516, crewCount: 517},
        {id: 'caller-selected-principal', status: 'refused'},
        {id: 'forged-bearer', status: 'refused'},
        {id: 'untrusted-admin-surface', status: 'refused'},
        {id: 'post-completion-fixture-ingestion', status: 'refused'},
      ],
      workarounds: [
        {id: 'W-IDENTITY', status: 'server-derived source binding retained'},
        {id: 'W-QGROUP', status: 'parent authorization occurs before every protected child release'},
        {id: 'C-ROUTE', status: 'versioned gateway authority checked by Lane 5'},
        {id: 'C-ASSET', status: 'typed native intent plus bounded gateway policy'},
        {id: 'C-NOTIFY', status: 'recipient snapshot and delivery authorization retained'},
      ],
      sourceAccounting: {
        actorMatrix: {bound: 5, anonymous: 1, forged: 1, total: 7},
        lane2ExpectedChecks: lane2?.receipt.expectedChecks ?? null,
        lane3ExpectedChecks: lane3?.receipt.expectedChecks ?? null,
        lane5ExpectedChecks: lane5?.receipt.expectedChecks ?? null,
        ordinaryIssueCount: 516,
        crewIssueCount: 517,
      },
      custodyAccounting: {
        mode: 'headless online authority and service boundaries',
        browserFactsRetained: 0,
        retainedProtectedPayloads: 0,
        queuedMutationPayloads: 0,
        rawSessionCarriersRetained: 0,
      },
    }),
  });
}

const result = await main();
if (result.exitCode !== 0) process.exitCode = result.exitCode;
