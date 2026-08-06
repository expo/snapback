import assert from 'node:assert/strict';
import {readFile, stat} from 'node:fs/promises';
import {join} from 'node:path';

import {
  CONTROL_ROOT,
  REPO_ROOT,
  actorIdentityFromLaneReceipts,
  buildGateReceiptFields,
  createHeadlessStack,
  gateCheckStatus,
  loadGateContext,
  runLaneHarness,
} from '../gate-support.mjs';
import {
  browserStorageInventory,
  bundleInventory,
  connectCdpPage,
  freeLoopbackPort,
  launchStageCChrome,
  startStageCGateway,
  startStageCVite,
} from '../stage-c-live.mjs';
import {runZBGate} from '../zbgate.mjs';

// @ref LLP 0183#zb5--performance-scale-and-custody — retain raw path timings
// and custody facts independently; this control computes no score or margin.

export const CHECK_IDS = Object.freeze([
  'gate-definition-and-receipt-assembly',
  'full-stack-release-browser-and-network-identity',
  'normal-list-ready-raw-timing',
  'login-round-trip-raw-timing',
  'authenticated-list-ready-and-custody',
  'optimistic-paint-raw-timing',
  'optimistic-paint-to-settlement-raw-timing',
  'cold-reload-to-ready-raw-timing',
  'full-reload-adopts-authenticated-custody',
  'two-tab-shared-custody-and-successor-ownership',
  'custody-counters-account-for-browser-storage',
  'large-fixture-measurements',
  'hot-profile-measurements',
]);

const LIVE_CHECK_IDS = CHECK_IDS.filter(id => (
  id !== 'gate-definition-and-receipt-assembly'
  && id !== 'large-fixture-measurements'
  && id !== 'hot-profile-measurements'
));

function roundedMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function statusFor(checks, id) {
  return gateCheckStatus(checks, id) === 'PASS' ? 'supported-local-control' : 'gap';
}

async function main() {
  const sourceInventoryPath = join(CONTROL_ROOT, 'source-inventory.v1.json');
  const sourceInventory = JSON.parse(await readFile(sourceInventoryPath, 'utf8'));
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb5.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/stage-c-live.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6b-live.mts'),
    join(CONTROL_ROOT, 'src/data/snapback.ts'),
    join(CONTROL_ROOT, 'src/data/mutations.ts'),
    sourceInventoryPath,
    join(REPO_ROOT, 'guide/testing/acceptance.md'),
    join(REPO_ROOT, 'guide/auth/sessions-and-principals.md'),
    join(REPO_ROOT, 'guide/operating/network-profiles.md'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const staticDryRun = process.env.ZBUGS_STATIC_DRY_RUN === '1';
  const evidenceDir = process.env.ZBUGS_EVIDENCE_DIR;
  if (staticDryRun && !evidenceDir) {
    throw new Error('ZBUGS_STATIC_DRY_RUN requires ZBUGS_EVIDENCE_DIR outside immutable evidence');
  }

  let actorIdentity = actorIdentityFromLaneReceipts();
  let browserIdentity = {
    mode: staticDryRun ? 'static-dry-run-no-browser' : 'real-headless-chrome',
  };
  let networkIdentity = staticDryRun
    ? 'socket-free static dry run; no network observations'
    : 'loopback-only; normal identity profile except declared 900ms CDP mutation latency; cold reload disables HTTP cache';
  let bundle = null;
  let lane2 = null;
  let measurements = {};
  let custodyAfterLogin = null;
  let custodyAfterHandoff = null;
  let authNetworkFacts = null;

  return await runZBGate({
    arm: 'snapback-control',
    gate: 'zb5',
    attempt,
    title: 'Zerobugs control ZB5 — browser measurements and custody',
    expectedCheckIds: CHECK_IDS,
    evidenceDir,
    run: async gate => {
      await gate.check('gate-definition-and-receipt-assembly', async () => {
        assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
        assert.equal(LIVE_CHECK_IDS.length, 10);
        return {
          expectedChecks: CHECK_IDS.length,
          rawMeasurementPolicy: 'one raw sample per named path; no aggregate, score, margin, or cross-arm claim',
          receiptMode: staticDryRun ? 'temporary static dry run' : 'immutable live attempt',
        };
      });

      if (staticDryRun) {
        for (const id of LIVE_CHECK_IDS) {
          gate.gap(id, {
            owner: 'supervising real-Chrome run',
            reason: 'Socket-free static receipt assembly cannot launch the owned server, gateway, Vite relay, or Chrome.',
          });
        }
        gate.gap('large-fixture-measurements', {
          owner: 'deferred Lane 8 large/hot qualification job',
          reason: 'acceptance.v1 has no canonical generated large fixture artifact for this control attempt',
        });
        gate.gap('hot-profile-measurements', {
          owner: 'deferred Lane 8 large/hot qualification job',
          reason: 'the hot-recent profile is not generated or frozen for the Stage 0.5 control',
        });
        return;
      }

      const stack = await createHeadlessStack(gate, 'zb5');
      lane2 = await runLaneHarness('lane2', stack);
      actorIdentity = actorIdentityFromLaneReceipts(lane2);

      const vitePort = await freeLoopbackPort();
      const viteOrigin = `http://127.0.0.1:${vitePort}`;
      const gateway = await startStageCGateway(gate, stack, {
        gateName: 'zb5',
        actor: 'crew-admin',
        redirectOrigins: [viteOrigin],
      });
      const vite = await startStageCVite(gate, stack, gateway, 'zb5', {port: vitePort});
      bundle = await bundleInventory();
      const zbugsPin = process.env.ZBUGS_PIN ?? sourceInventory.pinnedRoot;
      assert.equal(typeof zbugsPin, 'string', 'ZBUGS_PIN or the frozen source inventory supplies the pinned app');
      assert((await stat(zbugsPin)).isDirectory(), 'the injected ZBUGS_PIN names the pinned app directory');
      const chrome = await launchStageCChrome(gate, 'zerobugs-zb5', {
        env: {
          ...process.env,
          ZBUGS_PIN: zbugsPin,
          SNAPBACK_OUTBOUND_ACTIONS: '1',
          ZERBUGS_TEST_DEFAULTS: '1',
        },
      });
      const first = await connectCdpPage(gate, chrome.ws, 'ZB5 primary');
      browserIdentity = {
        mode: 'real-headless-chrome',
        product: chrome.version.Browser,
        protocolVersion: chrome.version['Protocol-Version'],
        userAgent: chrome.version['User-Agent'],
        v8Version: chrome.version['V8-Version'],
        profileRoot: '/tmp',
        profileOwnedAndRemovedAfterProcessExit: true,
        chromePidRecordedInCleanup: true,
      };

      await gate.check('full-stack-release-browser-and-network-identity', async () => {
        const health = await (await fetch(`${gateway.origin}/health`)).json();
        assert.equal(health.schemaVersion, 'zerobugs-control-gateway-health.v1');
        assert.equal(health.snapback.release.appId, context.artifacts.appId);
        assert.equal(health.snapback.release.bundleHash, context.artifacts.bundleHash);
        assert.match(String(browserIdentity.product), /Chrome/u);
        return {
          stack: ['Snapback local Ibex/SQLite', 'zerobugs-control-composition.v1', 'Vite relay', 'headless Chrome/CDP'],
          targetProfile: health.snapback.release.targetProfileId,
          browser: browserIdentity,
          network: networkIdentity,
          browserEnvironment: {
            chromeBinary: process.env.CHROME_BIN ? 'CHROME_BIN' : 'default macOS Chrome path',
            zbugsPin: process.env.ZBUGS_PIN ? 'ZBUGS_PIN supplied by supervisor' : 'ZBUGS_PIN injected from frozen source inventory',
            snapbackOutboundActions: 'enabled',
            zerobugsTestDefaults: 'enabled',
          },
          pinnedSourceCommit: context.acceptance.pin.commit,
          fixtureIssues: context.fixtureDigests.sourceCounts.issue,
          bundle,
          viteBuildDurationMs: roundedMilliseconds(vite.buildDurationMs),
        };
      });

      const normalStarted = performance.now();
      await first.navigate(`${vite.origin}/p/zero`);
      await first.wait(
        `document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
        'normal list ready',
      );
      const normalListReadyMs = roundedMilliseconds(performance.now() - normalStarted);
      measurements.normalListReadyMs = normalListReadyMs;
      await gate.check('normal-list-ready-raw-timing', async () => {
        const rows = await first.rows();
        assert(rows.length > 0, 'normal route paints useful issue rows');
        return {
          samplesMs: [normalListReadyMs],
          start: 'Page.navigate issued in a fresh owned Chrome profile',
          end: 'list window phase ready with useful rows painted',
          profile: 'local loopback; normal; browser cache default',
          visibleRows: rows.length,
        };
      });

      const loginNetworkStart = first.networkEvents().length;
      const loginStarted = performance.now();
      await first.clickText('Login');
      await first.wait(
        `document.querySelector('[data-session-phase="authenticated"]')&&document.querySelector('.logged-in-user-name')`,
        'crew login round trip',
      );
      await first.wait(
        `document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
        'authenticated list ready',
      );
      const loginRoundTripMs = roundedMilliseconds(performance.now() - loginStarted);
      measurements.loginRoundTripMs = loginRoundTripMs;
      const actorName = await first.eval(`document.querySelector('.logged-in-user-name')?.textContent.trim()`);
      await gate.check('login-round-trip-raw-timing', async () => {
        assert.equal(typeof actorName, 'string');
        assert(actorName.length > 0);
        return {
          samplesMs: [loginRoundTripMs],
          start: 'primary mousedown/up/click Login activation',
          end: 'authenticated session phase, actor name, and list-ready state painted',
          profile: 'local deterministic OAuth fixture and one-use email-code bootstrap',
        };
      });

      custodyAfterLogin = await browserStorageInventory(first);
      await gate.check('authenticated-list-ready-and-custody', async () => {
        assert(custodyAfterLogin.databaseCount > 0, 'browser has durable IndexedDB custody');
        assert(custodyAfterLogin.recordCount > 0, 'custody store contains at least one record');
        return {
          actorPublished: true,
          listWindowReady: true,
          storage: custodyAfterLogin,
          retainedQueryPayloadsClaimed: 0,
          distinction: 'IndexedDB rows are auth custody only; no Zerobugs query is admitted for offline retention.',
        };
      });

      await first.eval(`Object.defineProperty(globalThis.crypto,'getRandomValues',{configurable:true,value(array){array.fill(11);return array}})`);
      await first.click('.primary-cta');
      await first.setValue('.new-issue-title', 'ZB5 raw optimistic measurement');
      await first.setValue('.new-issue-description', 'One representative control mutation; not a comparative score.');
      await first.emulateLatency(900);
      const mutationStarted = performance.now();
      await first.clickText('Save Issue');
      await first.wait(`document.querySelector('[data-optimistic-status="pending"]')`, 'optimistic paint', 5_000);
      const paintAtMs = roundedMilliseconds(performance.now() - mutationStarted);
      await first.emulateLatency(0);
      await first.wait(
        `location.pathname.includes('/issue/')&&document.querySelector('[data-issue-detail]')`,
        'authoritative mutation settlement',
      );
      const settlementAtMs = roundedMilliseconds(performance.now() - mutationStarted);
      const paintToSettlementMs = roundedMilliseconds(settlementAtMs - paintAtMs);
      measurements.optimisticMutation = {submitToPaintMs: paintAtMs, submitToSettlementMs: settlementAtMs, paintToSettlementMs};
      await gate.check('optimistic-paint-raw-timing', async () => ({
        samplesMs: [paintAtMs],
        start: 'primary Save Issue activation',
        end: 'pending optimistic issue overlay painted',
        profile: 'CDP loopback latency 900ms, matching the Lane 6b representative mutation seam',
      }));
      await gate.check('optimistic-paint-to-settlement-raw-timing', async () => {
        assert(settlementAtMs >= paintAtMs);
        return {
          paintToSettlementSamplesMs: [paintToSettlementMs],
          submitToSettlementSamplesMs: [settlementAtMs],
          start: 'pending optimistic overlay painted',
          end: 'authoritative issue detail settlement painted',
          independentObserverTiming: 'not measured in this browser sample; Lane 4/ZB3 owns observer convergence',
        };
      });

      const reloadNetworkStart = first.networkEvents().length;
      await first.setCacheDisabled(true);
      const coldReloadStarted = performance.now();
      await first.navigate(`${vite.origin}/p/zero`);
      await first.wait(
        `document.querySelector('[data-session-phase="authenticated"]')&&document.querySelector('.logout-button')`,
        'authenticated cold reload custody',
      );
      await first.wait(
        `document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
        'cold reload list ready',
      );
      const coldReloadToReadyMs = roundedMilliseconds(performance.now() - coldReloadStarted);
      await first.setCacheDisabled(false);
      measurements.coldReloadToReadyMs = coldReloadToReadyMs;
      await gate.check('cold-reload-to-ready-raw-timing', async () => ({
        samplesMs: [coldReloadToReadyMs],
        start: 'full Page.navigate with Chrome HTTP cache disabled',
        end: 'authenticated session and current list window ready',
        profile: 'local loopback cold-online; same owned Chrome profile; IndexedDB retained',
      }));

      const reloadEvents = first.networkEvents().slice(reloadNetworkStart);
      const reloadExchanges = reloadEvents.filter(event => (
        event.direction === 'request' && event.path === '/__snapback/auth/exchange'
      ));
      const loginEvents = first.networkEvents().slice(loginNetworkStart, reloadNetworkStart);
      authNetworkFacts = {
        initialLoginExchangeRequests: loginEvents.filter(event => (
          event.direction === 'request' && event.path === '/__snapback/auth/exchange'
        )).length,
        initialLoginAuthRequests: loginEvents.filter(event => event.direction === 'request' && (
          event.path.startsWith('/__snapback/auth/')
          || event.path.startsWith('/api/login/github')
          || event.path === '/api/auth/bootstrap'
        )).length,
        reloadAuthRequests: reloadEvents.filter(event => event.direction === 'request' && (
          event.path.startsWith('/__snapback/auth/')
          || event.path.startsWith('/api/login/github')
          || event.path === '/api/auth/bootstrap'
        )).length,
        reloadExchangeRequests: reloadExchanges.length,
      };
      await gate.check('full-reload-adopts-authenticated-custody', async () => {
        assert.equal(authNetworkFacts.initialLoginExchangeRequests, 1, 'login consumes exactly one exchange');
        assert.equal(reloadExchanges.length, 0, 'reload performs no second auth exchange');
        assert.equal(await first.eval(`document.querySelector('.logged-in-user-name')?.textContent.trim()`), actorName);
        return {
          phase: 'authenticated',
          actorStable: true,
          secondExchangeRequests: 0,
          networkFacts: authNetworkFacts,
          carrier: 'shipped IndexedDB AuthCoordinator custody with Web Locks/fenced fallback',
        };
      });

      const second = await connectCdpPage(gate, chrome.ws, 'ZB5 second tab');
      await second.navigate(`${vite.origin}/p/zero`);
      await second.wait(
        `document.querySelector('[data-session-phase="authenticated"]')&&document.querySelector('.logged-in-user-name')&&document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
        'second tab adopts authenticated custody',
      );
      const secondActorName = await second.eval(`document.querySelector('.logged-in-user-name')?.textContent.trim()`);
      assert.equal(secondActorName, actorName);
      const secondExchangeRequests = second.networkEvents().filter(event => (
        event.direction === 'request' && event.path === '/__snapback/auth/exchange'
      ));
      assert.equal(secondExchangeRequests.length, 0, 'second tab adopts custody without an exchange');
      await first.closeTarget();
      const successorStarted = performance.now();
      await second.navigate(`${vite.origin}/p/zero`);
      await second.wait(
        `document.querySelector('[data-session-phase="authenticated"]')&&document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
        'second tab remains owner after first target closes',
      );
      const successorReloadMs = roundedMilliseconds(performance.now() - successorStarted);
      measurements.twoTabSuccessorReloadMs = successorReloadMs;
      await gate.check('two-tab-shared-custody-and-successor-ownership', async () => ({
        tabsAuthenticatedFromOneExchange: 2,
        totalInitialLoginExchangeRequests: authNetworkFacts.initialLoginExchangeRequests,
        secondTabExchangeRequests: secondExchangeRequests.length,
        actorsEqual: true,
        firstTargetClosedBeforeSuccessorReload: true,
        successorReloadSamplesMs: [successorReloadMs],
        successorState: 'authenticated list ready',
      }));

      custodyAfterHandoff = await browserStorageInventory(second);
      await gate.check('custody-counters-account-for-browser-storage', async () => {
        assert(custodyAfterHandoff.databaseCount > 0);
        assert(custodyAfterHandoff.recordCount > 0);
        return {
          afterLogin: custodyAfterLogin,
          afterFullReloadAndTwoTabHandoff: custodyAfterHandoff,
          queryRetention: {admittedQueries: 0, retainedPayloadsClaimed: 0},
          rawBearerValuesReadOrRetained: 0,
        };
      });

      gate.gap('large-fixture-measurements', {
        owner: 'deferred Lane 8 large/hot qualification job',
        reason: 'The large fixture generator is inventoried but no canonical large control artifact is generated; normal data cannot stand in for it.',
      });
      gate.gap('hot-profile-measurements', {
        owner: 'deferred Lane 8 large/hot qualification job',
        reason: 'The hot-recent mutation/fanout profile is deferred with the frozen large fixture and has no runnable Stage 0.5 control workload.',
      });
    },
    buildReceipt: async run => {
      const fields = await buildGateReceiptFields(context, run, {
        actorIdentity,
        capabilityFacts: [
          {id: 'browser.chrome-control', status: statusFor(run.checks, 'full-stack-release-browser-and-network-identity')},
          {id: 'browser.auth-custody.reload', status: statusFor(run.checks, 'full-reload-adopts-authenticated-custody')},
          {id: 'browser.auth-custody.two-tab', status: statusFor(run.checks, 'two-tab-shared-custody-and-successor-ownership')},
          {id: 'performance.raw-local-control', status: statusFor(run.checks, 'normal-list-ready-raw-timing'), samplePolicy: 'single raw Stage 0.5 observation'},
          {id: 'performance.large-fixture', status: 'gap', owner: 'Lane 8'},
          {id: 'performance.hot-profile', status: 'gap', owner: 'Lane 8'},
        ],
        refusalFacts: [
          {id: 'performance-composite-score', status: 'refused'},
          {id: 'performance-unfrozen-margin', status: 'refused', owner: 'acceptance.v2 variability trials'},
          {id: 'auth-custody-as-query-retention', status: 'refused', admittedRetainableQueries: 0},
        ],
        workarounds: [
          {id: 'W-WINDOW', status: 'measured in its source-faithful browser projection'},
          {id: 'W-REDUCER', status: 'one representative optimistic paint/settlement sample'},
          {id: 'W-IDENTITY', status: 'browser login resolves the server-bound crew fixture actor'},
        ],
        sourceAccounting: {
          lane2ExpectedChecks: lane2?.receipt.expectedChecks ?? null,
          browserGateExpectedChecks: CHECK_IDS.length,
          bundle,
          measurementSamples: staticDryRun ? 0 : 6,
          rawMeasurements: measurements,
        },
        custodyAccounting: {
          mode: staticDryRun ? 'static classification only' : 'real Chrome IndexedDB/Web Locks custody',
          afterLogin: custodyAfterLogin,
          afterFullReloadAndTwoTabHandoff: custodyAfterHandoff,
          authNetworkFacts,
          admittedRetainableQueries: 0,
          retainedQueryPayloadsClaimed: 0,
          rawSessionCarriersRetained: 0,
        },
      });
      return {...fields, browserIdentity, network: networkIdentity};
    },
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
