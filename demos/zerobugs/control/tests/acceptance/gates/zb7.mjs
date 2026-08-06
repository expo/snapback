import assert from 'node:assert/strict';
import {join} from 'node:path';

import {
  CONTROL_ROOT,
  REPO_ROOT,
  actorIdentityFromLaneReceipts,
  assertLaneCheck,
  buildGateReceiptFields,
  createHeadlessStack,
  gateCheckStatus,
  loadGateContext,
  runLaneHarness,
} from '../gate-support.mjs';
import {
  establishGatewaySession,
  freeLoopbackPort,
  queryGatewayWithCookie,
  startStageCGateway,
} from '../stage-c-live.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb7--production-and-recovery — local control recovery facts
// remain separate from named production/hosted GAPs and cleanup is a hard gate.

export const CHECK_IDS = Object.freeze([
  'gate-definition-and-receipt-assembly',
  'effect-fault-before-send-live-retry',
  'effect-fault-after-send-live-ambiguity-fence',
  'asset-upload-delivery-and-cleanup-inventory-live',
  'gateway-session-established-before-process-fault',
  'gateway-kill-is-observed-mid-session',
  'gateway-restarts-on-same-port-with-same-release',
  'preexisting-session-recovers-after-gateway-restart',
  'missing-asset-route-returns-404',
  'owned-local-cleanup-inventory',
  'route-500-fault-injection-seam',
  'public-tls-edge',
  'real-oauth-provider',
  'production-email-provider',
  'production-webhook-provider',
  'production-asset-provider',
  'backup-create-and-readback',
  'paused-restore-verify-activate-reconnect',
  'immutable-release-and-compatible-roll-forward',
  'hosted-target-support',
]);

const REQUIRED_GAPS = Object.freeze({
  'route-500-fault-injection-seam': Object.freeze({
    owner: 'D7 supported route-composition profile',
    reason: 'The versioned gateway has no declared test-only 500 injection seam. Unknown routes honestly return 404, so a synthetic 500 would not prove route recovery.',
  }),
  'public-tls-edge': Object.freeze({
    owner: 'D8 hosted target qualification',
    reason: 'The Stage 0.5 control binds loopback HTTP only and no public TLS target is frozen.',
  }),
  'real-oauth-provider': Object.freeze({
    owner: 'D7 production identity adapter',
    reason: 'The gateway exercises a deterministic local GitHub-shaped fixture, not a real provider callback over public TLS.',
  }),
  'production-email-provider': Object.freeze({
    owner: 'D7 production effect adapter',
    reason: 'Local authenticated capture proves payload/idempotency/recovery only; it is not a production email-provider receipt.',
  }),
  'production-webhook-provider': Object.freeze({
    owner: 'D7 production effect adapter',
    reason: 'Local authenticated capture proves payload/idempotency/recovery only; it is not a production webhook or Discord-provider receipt.',
  }),
  'production-asset-provider': Object.freeze({
    owner: 'D7 asset profile and D8 hosted target qualification',
    reason: 'The local native asset store plus source-shaped alias is proven; no hosted object provider/origin policy is frozen.',
  }),
  'backup-create-and-readback': Object.freeze({
    owner: 'D8 selected target backup profile',
    reason: 'No complete application backup format/target is frozen for this control; the asset cut alone is explicitly not a whole-app backup.',
  }),
  'paused-restore-verify-activate-reconnect': Object.freeze({
    owner: 'D8 selected target recovery profile',
    reason: 'There is no frozen paused-target restore/activation path for the complete application.',
  }),
  'immutable-release-and-compatible-roll-forward': Object.freeze({
    owner: 'D8 deployment and release qualification',
    reason: 'Generated and component identities are pinned locally, but no clean public immutable deploy or schema/function roll-forward is qualified.',
  }),
  'hosted-target-support': Object.freeze({
    owner: 'D8 target selection and hosted qualification',
    reason: 'acceptance.v1 deliberately leaves the first complete hosted target unfrozen; local evidence cannot stand in for it.',
  }),
});

const LOCAL_LIVE_CHECKS = CHECK_IDS.filter(id => (
  id !== 'gate-definition-and-receipt-assembly' && !(id in REQUIRED_GAPS)
));

function supported(checks, id) {
  return gateCheckStatus(checks, id) === 'PASS' ? 'supported-local-control' : 'gap';
}

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb7.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/stage-c-live.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane5-live.mts'),
    join(CONTROL_ROOT, 'composition/server.mts'),
    join(CONTROL_ROOT, 'composition/effects/deliver.mts'),
    join(REPO_ROOT, 'guide/testing/acceptance.md'),
    join(REPO_ROOT, 'guide/backend/actions-and-fetch.md'),
    join(REPO_ROOT, 'guide/backend/assets.md'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const staticDryRun = process.env.ZBUGS_STATIC_DRY_RUN === '1';
  const evidenceDir = process.env.ZBUGS_EVIDENCE_DIR;
  if (staticDryRun && !evidenceDir) {
    throw new Error('ZBUGS_STATIC_DRY_RUN requires ZBUGS_EVIDENCE_DIR outside immutable evidence');
  }

  let lane5 = null;
  let actorIdentity = actorIdentityFromLaneReceipts();
  let gatewayRecovery = null;

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb7',
    attempt,
    title: 'Zerobugs control ZB7 — faults and recovery',
    expectedCheckIds: CHECK_IDS,
    evidenceDir,
    run: async gate => {
      await gate.check('gate-definition-and-receipt-assembly', async () => {
        assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
        assert.equal(Object.keys(REQUIRED_GAPS).length, 10);
        assert.equal(LOCAL_LIVE_CHECKS.length, 9);
        return {
          expectedChecks: CHECK_IDS.length,
          localLiveChecks: LOCAL_LIVE_CHECKS.length,
          requiredProductionGaps: Object.keys(REQUIRED_GAPS).length,
          receiptMode: staticDryRun ? 'temporary static dry run' : 'immutable live attempt',
        };
      });

      if (staticDryRun) {
        for (const id of LOCAL_LIVE_CHECKS) {
          gate.gap(id, {
            owner: 'supervising socket-enabled live run',
            reason: 'Socket-free static receipt assembly cannot run the owned server/gateway fault slices.',
          });
        }
        for (const [id, details] of Object.entries(REQUIRED_GAPS)) gate.gap(id, details);
        return;
      }

      const stack = await createHeadlessStack(gate, 'zb7');
      lane5 = await runLaneHarness('lane5', stack);
      actorIdentity = actorIdentityFromLaneReceipts(lane5);

      await gate.check('effect-fault-before-send-live-retry', async () => ({
        ...assertLaneCheck(lane5, 'effect-fault-before-send-retries-from-durable-intent-once'),
        exercise: 'fresh live Lane 5 composition run inside ZB7; not receipt citation alone',
      }));
      await gate.check('effect-fault-after-send-live-ambiguity-fence', async () => ({
        ...assertLaneCheck(lane5, 'effect-fault-after-send-is-explicitly-ambiguous-and-fenced'),
        exercise: 'fresh live Lane 5 composition run inside ZB7; not receipt citation alone',
      }));
      await gate.check('asset-upload-delivery-and-cleanup-inventory-live', async () => ({
        ...assertLaneCheck(lane5, 'route-07-upload-five-types-server-policy-delivery-and-cleanup'),
        exercise: 'fresh five-MIME upload/delivery/cleanup inventory in this ZB7 server namespace',
      }));

      const port = await freeLoopbackPort();
      const captureDir = join(stack.scratch, 'zb7-restart-captures');
      const firstGateway = await startStageCGateway(gate, stack, {
        gateName: 'zb7-first',
        port,
        actor: 'ordinary-user',
        captureDir,
      });
      const firstHealth = await (await fetch(`${firstGateway.origin}/health`)).json();
      const sessionCookie = await establishGatewaySession(firstGateway.origin);
      const beforeFault = await queryGatewayWithCookie(firstGateway.origin, sessionCookie);
      await gate.check('gateway-session-established-before-process-fault', async () => {
        assert.equal(beforeFault.status, 200);
        return {
          authenticatedQueryStatus: beforeFault.status,
          carrier: 'HttpOnly gateway cookie backed by a server-minted Snapback session',
          rawCookieRetained: false,
        };
      });

      await firstGateway.stop();
      await gate.check('gateway-kill-is-observed-mid-session', async () => {
        await assert.rejects(fetch(`${firstGateway.origin}/health`, {signal: AbortSignal.timeout(1_000)}));
        return {
          signal: 'owned process-tree stop',
          sameSnapbackServerStayedRunning: (await fetch(`${stack.serverUrl}/health`)).ok,
          gatewayUnavailableObserved: true,
        };
      });

      const secondGateway = await startStageCGateway(gate, stack, {
        gateName: 'zb7-second',
        port,
        actor: 'ordinary-user',
        captureDir,
      });
      const secondHealth = await (await fetch(`${secondGateway.origin}/health`)).json();
      await gate.check('gateway-restarts-on-same-port-with-same-release', async () => {
        assert.equal(secondGateway.port, firstGateway.port);
        assert.notEqual(secondHealth.component.startupNonce, firstHealth.component.startupNonce);
        assert.deepEqual(secondHealth.snapback.release, firstHealth.snapback.release);
        return {
          samePort: true,
          startupNonceRotated: true,
          releaseIdentityStable: true,
          targetProfile: secondHealth.snapback.release.targetProfileId,
        };
      });

      const afterRestart = await queryGatewayWithCookie(secondGateway.origin, sessionCookie);
      await gate.check('preexisting-session-recovers-after-gateway-restart', async () => {
        assert.equal(afterRestart.status, 200);
        gatewayRecovery = {
          preFaultStatus: beforeFault.status,
          postRestartStatus: afterRestart.status,
          rawCookieRetained: false,
          sessionReminted: false,
          gatewayPortStable: true,
          gatewayStartupIdentityRotated: true,
        };
        return gatewayRecovery;
      });

      await gate.check('missing-asset-route-returns-404', async () => {
        const missingKey = `zba_${'m'.repeat(32)}`;
        const response = await fetch(`${secondGateway.origin}/assets/${missingKey}`);
        assert.equal(response.status, 404);
        return {
          status: response.status,
          pathClass: '/assets/<well-formed-missing-key>',
          publishedMetadataRows: 0,
          cleanupRequiredForMissingProbe: false,
        };
      });

      await gate.check('owned-local-cleanup-inventory', async () => ({
        gateRunnerHardFailureOnCleanupError: true,
        ownedResourceClasses: [
          'Snapback process/database/readiness namespace',
          'Lane 5 child gateway/capture namespace',
          'first stopped gateway readiness carrier',
          'second live gateway process/readiness carrier',
          'shared local capture directory',
        ],
        cleanupOrder: 'reverse ownership; processes before scratch deletion',
        finalResultLocation: 'receipt.cleanup',
      }));

      for (const [id, details] of Object.entries(REQUIRED_GAPS)) gate.gap(id, details);
    },
    buildReceipt: async run => buildGateReceiptFields(context, run, {
      actorIdentity,
      capabilityFacts: [
        {id: 'recovery.gateway-process-restart', status: supported(run.checks, 'preexisting-session-recovers-after-gateway-restart')},
        {id: 'effect.fail-before-send-retry', status: supported(run.checks, 'effect-fault-before-send-live-retry')},
        {id: 'effect.fail-after-send-ambiguity', status: supported(run.checks, 'effect-fault-after-send-live-ambiguity-fence')},
        {id: 'asset.missing-delivery-404', status: supported(run.checks, 'missing-asset-route-returns-404')},
        {id: 'route.injected-500', status: 'gap', owner: 'D7'},
        {id: 'deployment.public-tls', status: 'gap', owner: 'D8'},
        {id: 'identity.real-oauth', status: 'gap', owner: 'D7'},
        {id: 'effect.production-providers', status: 'gap', owner: 'D7'},
        {id: 'asset.production-provider', status: 'gap', owner: 'D7/D8'},
        {id: 'recovery.backup-restore-release', status: 'gap', owner: 'D8'},
        {id: 'deployment.hosted-target', status: 'gap', owner: 'D8'},
      ],
      refusalFacts: [
        {id: 'unknown-route-as-success', status: 'refused'},
        {id: 'missing-asset-as-present', status: 'refused'},
        {id: 'ambiguous-effect-automatic-replay', status: 'refused'},
        {id: 'local-capture-as-production-provider', status: 'refused'},
        {id: 'local-loopback-as-hosted-qualification', status: 'refused'},
      ],
      workarounds: [
        {id: 'C-GATEWAY', status: 'killed and restarted live with coherent release identity'},
        {id: 'C-NOTIFY', status: 'fail-before/after-send pair re-exercised live'},
        {id: 'C-ASSET', status: 'missing 404 plus five-type delivery/cleanup re-exercised live'},
      ],
      sourceAccounting: {
        lane5ExpectedChecks: lane5?.receipt.expectedChecks ?? null,
        zb7ExpectedChecks: CHECK_IDS.length,
        localLiveChecks: LOCAL_LIVE_CHECKS.length,
        namedProductionGaps: Object.keys(REQUIRED_GAPS).length,
        gatewayRecovery,
      },
      custodyAccounting: {
        mode: staticDryRun ? 'static classification only' : 'headless server session through a restarted gateway',
        gatewaySessionReminted: gatewayRecovery?.sessionReminted ?? null,
        rawSessionCarriersRetained: 0,
        browserFactsRetained: 0,
      },
    }),
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
