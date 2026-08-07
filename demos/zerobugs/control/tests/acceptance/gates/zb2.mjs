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
import {
  authNetworkRequestFacts,
  browserCustodyOwnershipFacts,
  browserStorageInventory,
  connectCdpPage,
  createStageCChromeProfile,
  freeLoopbackPort,
  launchStageCChrome,
  startStageCGateway,
  startStageCVite,
} from '../stage-c-live.mjs';
import {runZBGate} from '../zbgate.mjs';
import {
  defaultListContext,
  loadOracleFixture,
  oracleIssueList,
  sourceID,
} from '../../lane3-oracle.mts';

// @ref LLP 0183#zb2--retained-and-local-data — unsupported local classes are
// named GAPs; no live-query bytes are relabeled as retained facts.

const QUERY_GAPS = FROZEN_QUERY_NAMES.map(name => `retained-query.${name}`);
const QUEUE_GAPS = FROZEN_MUTATION_NAMES.map(name => `queued-intent.${name}`);
const RESTART_RENDER_CARRIER = 'online server-backed after restart; no Zerobugs query admits a retention carrier';
const RQS_WRITER_LOCK = 'snapback:rqs-store:snapback-rqs-store.v1';
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

async function authenticatedListRender(page, expectedIssueIds, label) {
  await page.wait(
    `document.querySelector('[data-session-phase="authenticated"]')`
      + `&&document.querySelector('.logged-in-user-name')`
      + `&&document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
    label,
  );
  const rows = await page.rows();
  assert.equal(rows.length, Math.min(40, expectedIssueIds.length), `${label} paints the complete first window`);
  assert.equal(new Set(rows).size, rows.length, `${label} has no duplicate issue rows`);
  assert.deepEqual(rows, expectedIssueIds.slice(0, rows.length), `${label} matches the independent oracle order`);
  const projectIssueCount = await page.eval(
    `document.querySelector('[data-project-issue-count]')?.getAttribute('data-project-issue-count')`,
  );
  assert.equal(projectIssueCount, '516', `${label} excludes the internal issue from count-like UI`);
  const actor = await page.eval(`document.querySelector('.logged-in-user-name')?.textContent.trim()`);
  assert.equal(typeof actor, 'string');
  assert(actor.length > 0, `${label} publishes the authenticated actor`);
  return Object.freeze({actor, rows: Object.freeze(rows), projectIssueCount});
}

function holdsRqsWriterLock(facts) {
  return facts.heldLocks.some(lock => lock.name === RQS_WRITER_LOCK && lock.mode === 'exclusive');
}

async function main() {
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb2.mjs'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6a-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/lane6b-live.mts'),
    join(CONTROL_ROOT, 'tests/acceptance/stage-c-live.mjs'),
    join(CONTROL_ROOT, 'tests/lane3-oracle.mts'),
    join(CONTROL_ROOT, 'tests/lane6a-adapter.test.mts'),
    join(CONTROL_ROOT, 'tests/stage-c-live.test.mts'),
    join(CONTROL_ROOT, 'src/data/snapback.ts'),
    join(CONTROL_ROOT, 'src/data/queries.ts'),
    join(CONTROL_ROOT, 'src/data/mutations.ts'),
  ]);
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  let lane6a = null;
  let actorIdentity = actorIdentityFromLaneReceipts();
  let browserIdentity = null;
  let browserAuthFacts = null;
  let browserStorageFacts = null;

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
      if (!process.env.CHROME_BIN) {
        gate.gap('browser-restart-retained-render', {
          owner: 'ZB5 real-browser custody arm',
          reason: 'A browser restart and IndexedDB custody cannot be proved by a headless no-Chrome ZB2 process, and this control has no retainable Zerobugs query.',
        });
        gate.gap('two-tab-writer-handoff', {
          owner: 'ZB5 real-browser custody arm',
          reason: 'Web Locks/two-tab ownership is browser-only and must not be simulated in Node.',
        });
      } else {
        const fixture = await loadOracleFixture();
        const expectedOpenIssueIds = oracleIssueList(
          fixture,
          defaultListContext({open: true}),
          'ordinary-user',
        ).map(sourceID);
        const vitePort = await freeLoopbackPort();
        const viteOrigin = `http://127.0.0.1:${vitePort}`;
        const gateway = await startStageCGateway(gate, stack, {
          gateName: 'zb2',
          actor: 'ordinary-user',
          redirectOrigins: [viteOrigin],
        });
        const vite = await startStageCVite(gate, stack, gateway, 'zb2', {port: vitePort});
        const profilePath = await createStageCChromeProfile(gate, 'zerobugs-zb2');
        const chromeEnv = {
          ...process.env,
          SNAPBACK_OUTBOUND_ACTIONS: '1',
          ZERBUGS_TEST_DEFAULTS: '1',
        };
        let restartedChrome = null;
        let restartedPage = null;
        let loginRender = null;
        let restartRender = null;

        await gate.check('browser-restart-retained-render', async () => {
          const firstChrome = await launchStageCChrome(gate, 'zerobugs-zb2-before-restart', {
            env: chromeEnv,
            userDataDir: profilePath,
            stopSignal: 'SIGKILL',
          });
          browserIdentity = {
            mode: 'real-headless-chrome-restart-attempt',
            product: firstChrome.version.Browser,
            protocolVersion: firstChrome.version['Protocol-Version'],
            userAgent: firstChrome.version['User-Agent'],
            v8Version: firstChrome.version['V8-Version'],
            profileRoot: '/tmp',
            profileReusedAcrossProcessDeath: false,
            profileCleanupRegistered: true,
          };
          const first = await connectCdpPage(gate, firstChrome.ws, 'ZB2 pre-restart tab');
          await first.navigate(`${vite.origin}/p/zero`);
          await first.wait(
            `document.querySelector('.issue-list-scroll')?.dataset.windowPhase==='ready'`,
            'ZB2 anonymous list boot',
          );
          const loginNetworkStart = first.networkEvents().length;
          await first.clickText('Login');
          loginRender = await authenticatedListRender(
            first,
            expectedOpenIssueIds,
            'ZB2 authenticated list before restart',
          );
          const loginNetwork = authNetworkRequestFacts(
            first.networkEvents().slice(loginNetworkStart),
          );
          assert.equal(loginNetwork.exchangeRequests, 1, 'initial UI login consumes exactly one exchange');
          const afterLogin = await browserStorageInventory(first);
          assert(afterLogin.databases.some(row => row.name === 'snapback-auth-custody'));
          assert(afterLogin.databases.some(row => row.name === 'snapback-rqs-store.v1'));

          // The launcher owns and attests the entire detached Chrome process
          // tree. SIGKILL is intentional here: no target/page close is allowed
          // to turn this into a graceful reload before process death.
          await firstChrome.stop();

          restartedChrome = await launchStageCChrome(gate, 'zerobugs-zb2-after-restart', {
            env: chromeEnv,
            userDataDir: profilePath,
            stopSignal: 'SIGTERM',
          });
          restartedPage = await connectCdpPage(gate, restartedChrome.ws, 'ZB2 restarted tab');
          await restartedPage.navigate(`${vite.origin}/p/zero`);
          restartRender = await authenticatedListRender(
            restartedPage,
            expectedOpenIssueIds,
            'ZB2 authenticated list after full browser restart',
          );
          const restartNetwork = authNetworkRequestFacts(restartedPage.networkEvents());
          assert.equal(restartNetwork.exchangeRequests, 0, 'restart adopts custody without another exchange');
          assert.equal(restartRender.actor, loginRender.actor, 'restart preserves the server-derived actor');
          assert.deepEqual(restartRender.rows, loginRender.rows, 'restart paints the same correct list window');
          const afterRestart = await browserStorageInventory(restartedPage);
          assert(afterRestart.databases.some(row => row.name === 'snapback-auth-custody'));
          assert(afterRestart.databases.some(row => row.name === 'snapback-rqs-store.v1'));
          browserIdentity.mode = 'real-headless-chrome-full-process-restart';
          browserIdentity.profileReusedAcrossProcessDeath = true;
          browserAuthFacts = {login: loginNetwork, restart: restartNetwork};
          browserStorageFacts = {afterLogin, afterRestart};
          return {
            firstBrowserTermination: {
              scope: 'entire owned detached Chrome process tree',
              requestedSignal: 'SIGKILL',
              processTreeExitAttested: true,
            },
            sameOwnedProfile: true,
            sessionPhase: 'authenticated',
            actorStable: true,
            authenticatedList: restartRender,
            authExchanges: {
              initialLogin: loginNetwork.exchangeRequests,
              afterRestart: restartNetwork.exchangeRequests,
              additionalAfterRestart: 0,
            },
            storage: {afterLogin, afterRestart},
            renderCarrier: RESTART_RENDER_CARRIER,
            retainedQueryPayloads: 0,
          };
        });

        await gate.check('two-tab-writer-handoff', async () => {
          assert(restartedChrome && restartedPage && restartRender, 'restart leg supplies the surviving Chrome instance');
          const second = await connectCdpPage(gate, restartedChrome.ws, 'ZB2 second tab');
          await second.navigate(`${vite.origin}/p/zero`);
          const secondRender = await authenticatedListRender(
            second,
            expectedOpenIssueIds,
            'ZB2 authenticated second tab',
          );
          assert.equal(secondRender.actor, restartRender.actor, 'both tabs publish the same actor');
          const secondTabNetwork = authNetworkRequestFacts(second.networkEvents());
          assert.equal(secondTabNetwork.exchangeRequests, 0, 'second tab adopts custody without an exchange');

          const [firstOwnership, secondOwnership] = await Promise.all([
            browserCustodyOwnershipFacts(restartedPage),
            browserCustodyOwnershipFacts(second),
          ]);
          for (const facts of [firstOwnership, secondOwnership]) {
            assert.equal(facts.indexedDb, true);
            assert.equal(facts.webLocks, true);
            assert.equal(facts.authCoordinatorPhase, 'settled');
            assert.equal(facts.authCustodyDatabasePresent, true);
            assert.equal(facts.rqsStore.implementation, 'indexeddb');
            assert.equal(facts.rqsStore.durable, true);
          }
          assert.equal(
            Number(firstOwnership.rqsWriter === true) + Number(secondOwnership.rqsWriter === true),
            1,
            'exactly one tab reports shipped RQS writer custody',
          );
          const firstOwns = firstOwnership.rqsWriter === true;
          const owner = firstOwns ? restartedPage : second;
          const survivor = firstOwns ? second : restartedPage;
          const ownerFacts = firstOwns ? firstOwnership : secondOwnership;
          const readerFacts = firstOwns ? secondOwnership : firstOwnership;
          assert(holdsRqsWriterLock(ownerFacts), 'the in-page lock inventory contains the exclusive RQS writer lock');
          assert.equal(readerFacts.rqsWriter, false, 'the peer reports reader custody before handoff');

          await owner.close();
          await survivor.wait(
            `(async()=>{const app=await import('/src/data/snapback.ts');const locks=await navigator.locks.query();return app.client.rqsStore?.isWriter?.()===true&&locks.held.some(lock=>lock.name===${JSON.stringify(RQS_WRITER_LOCK)}&&lock.mode==='exclusive')})()`,
            'surviving tab acquires the released writer lock',
          );
          const survivorOwnership = await browserCustodyOwnershipFacts(survivor);
          assert.equal(survivorOwnership.rqsWriter, true);
          assert(holdsRqsWriterLock(survivorOwnership));

          const issueHref = await survivor.eval(
            `document.querySelector('[data-issue-id] .issue-title')?.href`,
          );
          assert.equal(typeof issueHref, 'string');
          assert(issueHref.startsWith(vite.origin));
          await survivor.navigate(issueHref);
          await survivor.wait(
            `document.querySelector('[data-session-phase="authenticated"]')`
              + `&&document.querySelector('[data-issue-detail]')`
              + `&&document.querySelector('.comments-container')?.dataset.windowPhase==='ready'`
              + `&&document.querySelector('.comment-input')`,
            'surviving owner renders the mutation target',
          );
          await survivor.eval(`(async()=>{
            const app=await import('/src/data/snapback.ts');
            globalThis.__zb2MutationTrace=[];
            globalThis.__zb2MutationTraceUnsubscribe?.();
            const capture=()=>globalThis.__zb2MutationTrace.push(app.mutationPresentation.snapshot().attempts.map(attempt=>({
              id:attempt.id,
              name:attempt.name,
              status:attempt.status,
              args:{id:attempt.args.id,body:attempt.args.body},
              result:attempt.result===null?null:{outcome:attempt.result.outcome,authoritativeTime:attempt.result.authoritativeTime}
            })));
            globalThis.__zb2MutationTraceUnsubscribe=app.mutationPresentation.subscribe(capture);
            capture();
            return true;
          })()`);
          const body = `ZB2 ${attempt} surviving-tab authoritative comment`;
          const mutationNetworkStart = survivor.networkEvents().length;
          await survivor.setValue('.comment-input', body);
          await survivor.clickText('Add comment');
          const mutationId = await survivor.wait(
            `globalThis.__zb2MutationTrace.flat().find(attempt=>attempt.name==='comment.add'&&attempt.args.body===${JSON.stringify(body)})?.args.id??null`,
            'comment mutation enters the in-page presentation ledger',
          );
          // The presentation ledger drops a confirmed attempt once the
          // authoritative graph is adopted, so settlement is read from the
          // installed trace history, never polled from the live snapshot.
          await survivor.wait(
            `globalThis.__zb2MutationTrace.flat().some(attempt=>attempt.args.id===${JSON.stringify(mutationId)}&&attempt.status==='confirmed'&&attempt.result?.outcome==='applied'&&typeof attempt.result.authoritativeTime==='number')`,
            'authoritative comment settlement reaches the in-page presentation ledger',
          );
          const mutationFact = await survivor.eval(
            `(()=>{const attempts=globalThis.__zb2MutationTrace.flat().filter(attempt=>attempt.args.id===${JSON.stringify(mutationId)}&&attempt.status==='confirmed'&&attempt.result?.outcome==='applied');const attempt=attempts[attempts.length-1];return {id:attempt.id,name:attempt.name,status:attempt.status,result:{outcome:attempt.result.outcome,authoritativeTime:attempt.result.authoritativeTime}}})()`,
          );
          const mutationNetwork = authNetworkRequestFacts(
            survivor.networkEvents().slice(mutationNetworkStart),
          );
          assert.equal(mutationNetwork.exchangeRequests, 0, 'handoff mutation consumes no auth exchange');
          // The comments window is virtualized, so the settled row is proved
          // painted through the same permalink hydration Lane 6b qualified
          // rather than assuming the submit position keeps it in view.
          const permalinkNetworkStart = survivor.networkEvents().length;
          await survivor.navigate(`${issueHref}#comment-${mutationId}`);
          await survivor.wait(
            `(()=>{if(!document.querySelector('[data-session-phase="authenticated"]'))return false;const row=document.querySelector('[data-vrow-key="'+CSS.escape(${JSON.stringify(mutationId)})+'"]');if(!row)return false;if(!row.textContent.includes(${JSON.stringify(body)}))return false;const rect=row.getBoundingClientRect();return rect.bottom>0&&rect.top<innerHeight})()`,
            'authoritative comment settlement paints in the surviving tab',
          );
          const permalinkNetwork = authNetworkRequestFacts(
            survivor.networkEvents().slice(permalinkNetworkStart),
          );
          assert.equal(permalinkNetwork.exchangeRequests, 0, 'permalink paint proof consumes no auth exchange');
          mutationFact.painted = true;
          const afterHandoff = await browserStorageInventory(survivor);
          browserAuthFacts = {
            ...browserAuthFacts,
            secondTab: secondTabNetwork,
            postHandoffMutation: mutationNetwork,
            permalinkPaintProof: permalinkNetwork,
          };
          browserStorageFacts = {...browserStorageFacts, afterHandoff};
          return {
            tabsAuthenticatedFromOneExchange: 2,
            authExchanges: {
              initialLogin: browserAuthFacts.login.exchangeRequests,
              afterRestart: browserAuthFacts.restart.exchangeRequests,
              secondTab: secondTabNetwork.exchangeRequests,
              postHandoffMutation: mutationNetwork.exchangeRequests,
              total: 1,
            },
            ownership: {
              probe: 'in-page AuthCoordinator phase plus shipped IndexedDB RQS store and navigator.locks facts',
              authCoordinatorLockScope: 'operation-scoped; no persistent auth-lock holder is claimed',
              persistentWriterCarrier: RQS_WRITER_LOCK,
              before: {first: firstOwnership, second: secondOwnership},
              ownerClosed: firstOwns ? 'restarted tab' : 'second tab',
              after: survivorOwnership,
            },
            mutation: {
              interaction: 'pinned UI mousedown + click + mouseup',
              carrier: 'online server-backed comment mutation and commentsPage settlement paint',
              paintProof: 'comment-permalink window hydration with visible-rect check (virtualized window)',
              fact: mutationFact,
            },
            storageAfterHandoff: afterHandoff,
            retainedQueryPayloads: 0,
            durableQueuedIntents: 0,
          };
        });
      }
      gate.gap('authorized-lease-expiry-retirement', {
        owner: 'D3 retained protected-query admission',
        reason: 'No protected Zerobugs query is admitted for retention, so no AuthorizedLease is acquired or claimed by the control.',
      });
    },
    buildReceipt: async run => {
      const restartPassed = run.checks.rows.find(
        row => row.id === 'browser-restart-retained-render',
      )?.status === 'PASS';
      const handoffPassed = run.checks.rows.find(
        row => row.id === 'two-tab-writer-handoff',
      )?.status === 'PASS';
      const capabilityFacts = [
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
      ];
      if (restartPassed && handoffPassed) {
        capabilityFacts.push({
          id: 'browser.auth-custody.restart-and-two-tab',
          status: 'supported-local-control',
          renderCarrier: RESTART_RENDER_CARRIER,
          retainedQueryPayloads: 0,
        });
      }
      const fields = await buildGateReceiptFields(context, run, {
        actorIdentity,
        capabilityFacts,
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
          ...(process.env.CHROME_BIN ? {
            browserChecks: 2,
            browserAuthFacts,
          } : {}),
        },
        custodyAccounting: {
          mode: process.env.CHROME_BIN
            ? 'headless classification + real-Chrome restart/two-tab custody legs'
            : 'headless classification; no retained browser store',
          retainedQueryPayloads: 0,
          durableQueuedIntents: 0,
          browserFactsRetained: 0,
          authorityTransitionsChecked: 1,
          ...(process.env.CHROME_BIN ? {
            browserAuthFacts,
            browserStorageFacts,
          } : {}),
        },
      });
      return browserIdentity === null ? fields : {
        ...fields,
        browserIdentity: {
          ...browserIdentity,
          profileCleanupAttested: run.cleanup.status === 'PASS',
        },
        network: 'loopback-only; one UI login exchange, then zero on full Chrome restart, second-tab adoption, and post-handoff mutation',
      };
    },
  });
}

const result = await main();
if (result.exitCode !== 0) process.exitCode = result.exitCode;
