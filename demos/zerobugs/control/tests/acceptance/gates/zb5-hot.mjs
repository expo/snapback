import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import api from '../../../snapback/generated/api.mjs';

import {
  GENERATION_EPOCH_MS,
  LARGE_FIXTURE_ID,
  MANIFEST_ID,
  POLICY_ISSUE_ID,
  canonicalJson,
  readCsvTable,
  readAndVerifyOverlay,
  taggedDigest,
  verifyLargeFixtureShards,
} from '../../../scripts/build-large-overlay.mts';
import {
  auditLargeIngestSeam,
  largeBatchMath,
  loadLargeFixture,
} from '../../../scripts/load-large-fixture.mts';
import {
  CONTROL_ROOT,
  REPO_ROOT,
  buildGateReceiptFields,
  gateCheckStatus,
  loadGateContext,
} from '../gate-support.mjs';
import {sha256Bytes} from '../receipt.mjs';
import {runZBGate} from '../zbgate.mjs';
import {
  LARGE_ACTORS,
  bindLargeActors,
  cloneBaselineDatabase,
  createAnonymousClient,
  createScaleNamespace,
  databasePath,
  listContext,
  pauseAndHashBaseline,
  queryOne,
  scaleSupportIdentity,
  startScaleServer,
} from './zb5-scale-support.mjs';

// @ref LLP 0183#zb5--performance-scale-and-custody — hot-recent-v1 keeps
// every raw mutation sample and effect/custody counter; it defines no margin.

const MUTATION_NAMES = Object.freeze([
  'issue.create',
  'issue.update',
  'issue.delete',
  'issue.addLabel',
  'issue.removeLabel',
  'notification.update',
  'emoji.addToIssue',
  'emoji.addToComment',
  'emoji.remove',
  'comment.add',
  'comment.edit',
  'comment.remove',
  'label.create',
  'label.createAndAddToIssue',
  'viewState.set',
  'userPref.set',
]);

const EFFECT_TRIGGERS = new Set([
  'issue.create',
  'issue.update',
  'issue.addLabel',
  'issue.removeLabel',
  'emoji.addToIssue',
  'emoji.addToComment',
  'comment.add',
  'comment.edit',
]);

export const CHECK_IDS = Object.freeze([
  'gate-definition-and-distinct-receipt-arm',
  'hot-profile-derives-from-verified-large-working-set',
  'operation-arguments-emitted-and-content-digested-before-execution',
  'open-loop-arrivals-use-fixed-nonadaptive-offsets',
  'eight-trigger-eight-nontrigger-inventory-partition',
  'fresh-precycle-reset-is-byte-provable',
  'runtime-effect-trigger-and-nontrigger-counters',
  'hot-cycle-custody-counters',
  ...MUTATION_NAMES.map((name, index) => (
    `raw-mutation-${String(index + 1).padStart(2, '0')}-${name}`
  )),
]);

const STATIC_CHECK_IDS = Object.freeze(CHECK_IDS.slice(0, 5));
const LIVE_CHECK_IDS = Object.freeze(CHECK_IDS.slice(5));
const RECEIPT_PATH = join(
  REPO_ROOT,
  'demos/zerobugs/manifest/large-seed42-v1.receipt.json',
);
const DEFAULT_OVERLAY_PATH = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-overlay-v1.json',
);
const ARRIVAL_INTERVAL_MS = 25;

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hotID(kind, cycle, index, natural) {
  const hex = createHash('sha256')
    .update([MANIFEST_ID, 'hot-recent-v1', kind, String(cycle), String(index), natural].join('\0'))
    .digest('hex');
  return `zbhot_${hex.slice(0, 24)}`;
}

function actorNameBySourceID(bindings) {
  return new Map(Object.entries(bindings).map(([name, binding]) => [binding.sourceUserID, name]));
}

function buildHotOperationPlan(overlay, cycles) {
  const payload = overlay.payload;
  const publicIssues = payload.workingSet.oracleRows
    .filter(row => row.visibility === 'public')
    .sort((left, right) => compareText(left.id, right.id));
  assert(publicIssues.length >= 16, 'W has enough distinct public operation candidates');
  const deletedIssueID = publicIssues[1].id;
  const newest = Object.values(payload.workingSet.newestComments)
    .filter(comment => (
      comment.issueID !== deletedIssueID
      && publicIssues.some(issue => issue.id === comment.issueID)
    ))
    .sort((left, right) => compareText(left.id, right.id));
  assert(newest.length >= 3, 'W has enough comment candidates');
  const edges = [...payload.projections.issueLabelRead]
    .filter(edge => (
      edge.issueID !== deletedIssueID
      && publicIssues.some(issue => issue.id === edge.issueID)
    ))
    .sort((left, right) => compareText(`${left.issueID}\0${left.labelID}`, `${right.issueID}\0${right.labelID}`));
  assert(edges.length >= 2, 'W has enough issue-label candidates');
  const actorsBySource = actorNameBySourceID(payload.actorBindings);
  const commentParents = new Map(
    Object.values(payload.workingSet.newestComments).map(comment => [comment.id, comment.issueID]),
  );
  const publicIssueIDs = new Set(publicIssues.map(issue => issue.id));
  const removableEmoji = [...payload.rows.emoji]
    .filter(row => {
      const subjectIssueID = publicIssueIDs.has(row.subjectID)
        ? row.subjectID
        : commentParents.get(row.subjectID);
      return actorsBySource.has(row.creatorID)
        && !row.id.startsWith('zbav1_internal_')
        && subjectIssueID
        && subjectIssueID !== deletedIssueID;
    })
    .sort((left, right) => compareText(left.id, right.id));
  assert(removableEmoji.length > 0, 'W has an actor-owned emoji candidate');

  const removeEdge = edges[0];
  const existingLabelsForAddIssue = new Set(
    edges.filter(edge => edge.issueID === publicIssues[3].id).map(edge => edge.labelID),
  );
  const addLabelID = edges.map(edge => edge.labelID).find(id => !existingLabelsForAddIssue.has(id));
  assert(addLabelID, 'W has a project label not already attached to the add candidate');

  const plan = [];
  for (let cycle = 0; cycle < cycles; cycle += 1) {
    const time = index => GENERATION_EPOCH_MS + 10_000 + cycle * 1_000 + index;
    const effectIdentity = index => ({
      compositionClientID: `hot-client-${cycle}`,
      compositionMutationID: `hot-${cycle}-${String(index + 1).padStart(2, '0')}`,
    });
    const argumentsByName = {
      'issue.create': {
        id: hotID('issue', cycle, 0, payload.selectedProject.id),
        title: `hot-recent-v1 cycle ${cycle} issue`,
        description: 'deterministic hot-profile issue',
        created: time(0),
        modified: time(0),
        projectID: payload.selectedProject.id,
        ...effectIdentity(0),
      },
      'issue.update': {
        id: publicIssues[0].id,
        title: `hot-recent-v1 cycle ${cycle} update`,
        modified: time(1),
        ...effectIdentity(1),
      },
      'issue.delete': {id: publicIssues[1].id},
      'issue.addLabel': {
        issueID: publicIssues[3].id,
        labelID: addLabelID,
        projectID: payload.selectedProject.id,
        ...effectIdentity(3),
      },
      'issue.removeLabel': {
        issueID: removeEdge.issueID,
        labelID: removeEdge.labelID,
        ...effectIdentity(4),
      },
      'notification.update': {
        issueID: publicIssues[5].id,
        subscribed: 'subscribe',
        created: time(5),
      },
      'emoji.addToIssue': {
        id: hotID('emoji-issue', cycle, 6, publicIssues[6].id),
        // The large overlay mints exactly one emoji value (👍) across its
        // 1,746 rows, so a planned 👍 by a bound actor on a working-set
        // issue collides with the baseline's unique (subject, creator,
        // value) key — observed as three deterministic
        // SNAPBACK_UNIQUE_CONSTRAINT_VIOLATION refusals in the zb5-hot v9
        // receipt. 🎯 is provably absent from the baseline.
        unicode: '🎯',
        annotation: 'direct hit',
        subjectID: publicIssues[6].id,
        created: time(6),
        ...effectIdentity(6),
      },
      'emoji.addToComment': {
        id: hotID('emoji-comment', cycle, 7, newest[0].id),
        unicode: '👍',
        annotation: 'thumbs up',
        subjectID: newest[0].id,
        created: time(7),
        ...effectIdentity(7),
      },
      'emoji.remove': {id: removableEmoji[0].id},
      'comment.add': {
        id: hotID('comment', cycle, 9, publicIssues[9].id),
        issueID: publicIssues[9].id,
        body: `hot-recent-v1 cycle ${cycle} comment`,
        created: time(9),
        ...effectIdentity(9),
      },
      'comment.edit': {
        id: newest[1].id,
        body: `hot-recent-v1 cycle ${cycle} edited comment`,
        ...effectIdentity(10),
      },
      'comment.remove': {id: newest[2].id},
      'label.create': {
        id: hotID('label', cycle, 12, payload.selectedProject.id),
        name: `hot-label-${cycle}-a`,
        projectID: payload.selectedProject.id,
      },
      'label.createAndAddToIssue': {
        issueID: publicIssues[13].id,
        labelID: hotID('label-edge', cycle, 13, publicIssues[13].id),
        labelName: `hot-label-${cycle}-b`,
        projectID: payload.selectedProject.id,
      },
      'viewState.set': {issueID: publicIssues[14].id, viewed: time(14)},
      'userPref.set': {key: MANIFEST_ID, value: `hot-cycle-${cycle}`},
    };
    const actors = {
      'issue.create': 'ordinary-user',
      'issue.update': 'crew-admin',
      'issue.delete': 'crew-admin',
      'issue.addLabel': 'crew-admin',
      'issue.removeLabel': 'crew-admin',
      'notification.update': 'assignee',
      'emoji.addToIssue': 'ordinary-user',
      'emoji.addToComment': 'creator',
      'emoji.remove': actorsBySource.get(removableEmoji[0].creatorID) ?? 'crew-admin',
      'comment.add': 'assignee',
      'comment.edit': 'crew-admin',
      'comment.remove': 'crew-admin',
      'label.create': 'crew-admin',
      'label.createAndAddToIssue': 'crew-admin',
      'viewState.set': 'removed-member',
      'userPref.set': 'ordinary-user',
    };
    const operations = MUTATION_NAMES.map((name, index) => ({
      inventoryIndex: index,
      name,
      actor: actors[name],
      effectClass: EFFECT_TRIGGERS.has(name) ? 'trigger' : 'non-trigger',
      arrivalOffsetMs: index * ARRIVAL_INTERVAL_MS,
      args: argumentsByName[name],
    }));
    plan.push({
      cycle,
      resetGeneration: cycle,
      operations,
      authorityTransitions: [{
        arrivalOffsetMs: MUTATION_NAMES.length * ARRIVAL_INTERVAL_MS,
        actor: 'removed-member',
        transition: 'crew-to-user-role-change',
        invalidatePredecessorAuthority: true,
        negativeReadProbeAfterTransition: true,
      }],
      argumentsDigest: taggedDigest(operations.map(operation => ({
        name: operation.name,
        actor: operation.actor,
        args: operation.args,
      }))),
    });
  }
  return {
    schemaVersion: 'zerobugs-hot-operation-plan.v1',
    fixtureId: 'hot-recent-v1',
    largeFixtureId: LARGE_FIXTURE_ID,
    overlayDigest: overlay.contentDigest,
    workingSetDigest: payload.workingSet.issueIDsDigest,
    cycles,
    arrivalIntervalMs: ARRIVAL_INTERVAL_MS,
    adaptiveArrivals: false,
    observers: [
      'ordinary-user', 'creator', 'assignee', 'crew-admin',
      'removed-member', 'anonymous',
    ],
    attackerPosture: 'negative probes only; no mutation inventory authority',
    plan,
  };
}

function status(checks, id) {
  return gateCheckStatus(checks, id) === 'PASS' ? 'supported-local-control' : 'gap';
}

const API_BY_MUTATION = Object.freeze({
  'issue.create': api.issueCreate,
  'issue.update': api.issueUpdate,
  'issue.delete': api.issueDelete,
  'issue.addLabel': api.issueAddLabel,
  'issue.removeLabel': api.issueRemoveLabel,
  'notification.update': api.notificationUpdate,
  'emoji.addToIssue': api.emojiAddToIssue,
  'emoji.addToComment': api.emojiAddToComment,
  'emoji.remove': api.emojiRemove,
  'comment.add': api.commentAdd,
  'comment.edit': api.commentEdit,
  'comment.remove': api.commentRemove,
  'label.create': api.labelCreate,
  'label.createAndAddToIssue': api.labelCreateAndAddToIssue,
  'viewState.set': api.viewStateSet,
  'userPref.set': api.userPrefSet,
});

function roundedMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function retainedError(error) {
  const value = error && typeof error === 'object' ? error : {};
  const diagnostic = value.diagnostic && typeof value.diagnostic === 'object'
    ? value.diagnostic
    : {};
  const details = diagnostic.details && typeof diagnostic.details === 'object'
    ? diagnostic.details
    : {};
  return {
    name: typeof value.name === 'string' ? value.name : 'Error',
    code: typeof value.code === 'string' ? value.code : null,
    // Declared application refusals carry their typed code beside the
    // platform code; retain it so refusal-shaped checks can match the
    // exact claim instead of message prose.
    appCode: typeof details.appCode === 'string'
      ? details.appCode
      : (typeof diagnostic.appCode === 'string' ? diagnostic.appCode : null),
    message: String(value.message ?? error).slice(0, 800),
  };
}

async function sourceProjectForSelection(verified, sourceProjectID) {
  for await (const row of readCsvTable(verified.shardsByTable.project, 'project')) {
    if (row.id === sourceProjectID) {
      assert(row.lowerCaseName, 'selected project has a lower-case query identity');
      return {
        id: row.id,
        name: row.name,
        lowerCaseName: row.lowerCaseName,
      };
    }
  }
  throw new Error(`selected source project ${sourceProjectID} is absent`);
}

function observerClient(bound, anonymous, actor) {
  if (actor === 'anonymous') return anonymous;
  const session = bound.sessions.get(actor);
  assert(session, `hot observer ${actor} has a bound session`);
  return session.client;
}

async function openHotObservers({bound, anonymous, projectName, cycle}) {
  const observers = [...LARGE_ACTORS, 'anonymous'];
  const handles = new Map();
  const counters = {};
  let closePromise = null;
  try {
    for (const actor of observers) {
      let resolveLive;
      let rejectLive;
      const liveReady = new Promise((resolve, reject) => {
        resolveLive = resolve;
        rejectLive = reject;
      });
      const liveDeadline = setTimeout(() => {
        rejectLive(new Error(`${actor} live observer did not establish within 10 seconds`));
      }, 10_000);
      const counter = {
        deliveries: 0,
        initialRows: null,
        finalRows: null,
        finalVersion: null,
        finalConnection: null,
        staleAtSettle: false,
        staleRecoveryMs: null,
      };
      counters[actor] = counter;
      const handlePromise = observerClient(bound, anonymous, actor).liveQuery(api.issueListV2, {
        connectionId: `zb5-hot-${cycle}-${actor}`,
        args: {
          listContext: listContext(projectName),
          limit: 1_000,
          start: null,
          dir: 'forward',
          inclusive: false,
        },
        transport: 'stream',
        fallbackToPoll: false,
        onConnectionChange: connection => {
          if (connection === 'live') resolveLive();
        },
        onUpdate: rows => {
          counter.deliveries += 1;
          if (rows.length === 1 && Array.isArray(rows[0]?.items)) {
            counter.finalRows = rows[0].items.length;
          }
        },
      }).then(handle => {
        if (handle.connection === 'live') resolveLive();
        return handle;
      });
      let handle;
      try {
        [handle] = await Promise.all([handlePromise, liveReady]);
      } finally {
        clearTimeout(liveDeadline);
      }
      assert.equal(handle.rows.length, 1, `${actor} live observer has one typed envelope`);
      assert.equal(handle.connection, 'live', `${actor} live observer established its stream`);
      const expectedRows = actor === 'crew-admin' || actor === 'removed-member' ? 1_000 : 900;
      assert.equal(handle.rows[0].items.length, expectedRows, `${actor} initial visible W count`);
      assert.equal(handle.rows[0].total, expectedRows, `${actor} initial count-like W total`);
      const seesProtected = handle.rows[0].items.some(item => item.issue.id === POLICY_ISSUE_ID);
      assert.equal(
        seesProtected,
        actor === 'crew-admin' || actor === 'removed-member',
        `${actor} initial protected-issue visibility follows current authority`,
      );
      counter.initialRows = expectedRows;
      counter.initialProtectedRows = seesProtected ? 1 : 0;
      counter.finalRows = expectedRows;
      handles.set(actor, handle);
    }
  } catch (error) {
    for (const handle of handles.values()) handle.dispose();
    throw error;
  }

  const settle = async () => {
    for (const [actor, handle] of handles) {
      const rows = await handle.poll();
      assert.equal(rows.length, 1, `${actor} settled observer has one typed envelope`);
      const counter = counters[actor];
      counter.finalRows = rows[0].items.length;
      counter.finalProtectedRows = rows[0].items.some(
        item => item.issue.id === POLICY_ISSUE_ID,
      ) ? 1 : 0;
      counter.finalVersion = handle.version;
      // Convergence is proved by the authoritative poll above. The delta
      // stream may lapse transiently under machine load and recover on its
      // own; the live-at-settle claim therefore allows a bounded recovery
      // window with the lapse and its recovery time disclosed in the
      // receipt, instead of asserting one instantaneous flag read
      // (zb5-hot v7: 'stale' at settle with fully converged rows).
      if (handle.connection !== 'live') {
        counter.staleAtSettle = true;
        const staleStart = performance.now();
        const deadline = staleStart + 30_000;
        while (handle.connection !== 'live' && performance.now() < deadline) {
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        counter.staleRecoveryMs = handle.connection === 'live'
          ? Math.round(performance.now() - staleStart)
          : null;
      }
      counter.finalConnection = handle.connection;
    }
  };
  const close = () => {
    closePromise ??= Promise.resolve().then(() => {
      for (const handle of handles.values()) handle.dispose();
    });
    return closePromise;
  };
  return Object.freeze({handles, counters, settle, close});
}

async function runAttackerProbes(anonymous, cycle) {
  await assert.rejects(
    () => anonymous.mutate(api.issueUpdate, {
      args: {id: POLICY_ISSUE_ID, title: 'attacker write must refuse', modified: GENERATION_EPOCH_MS},
      clientMutationId: `zb5-hot-${cycle}-attacker-write`,
      queue: false,
    }),
    'anonymous attacker mutation is refused',
  );
  const hidden = await queryOne(anonymous, api.issueDetail, {
    idField: 'id',
    id: POLICY_ISSUE_ID,
  }, 'anonymous protected issue probe');
  assert.equal(hidden.value, null, 'anonymous attacker receives no protected issue value');
  assert.equal(
    hidden.status,
    'not-found-authoritative',
    'protected issue is an authoritative nonexistence-shaped result',
  );
  assert.equal(hidden.reason, 'missing-or-invisible-issue');
  return {negativeMutationRefused: 1, protectedReadsRefused: 1};
}

function scheduleMutation({cycle, operation, bound, cycleStart}) {
  const targetTime = cycleStart + operation.arrivalOffsetMs;
  const session = bound.sessions.get(operation.actor);
  assert(session, `${operation.name} actor ${operation.actor} is bound`);
  assert(API_BY_MUTATION[operation.name], `${operation.name} has a generated API reference`);
  return new Promise(resolveSample => {
    const delay = Math.max(0, targetTime - performance.now());
    setTimeout(async () => {
      const dispatchedAt = performance.now();
      try {
        const response = await session.client.mutate(API_BY_MUTATION[operation.name], {
          args: operation.args,
          clientMutationId: `zb5-hot-${cycle}-${String(operation.inventoryIndex + 1).padStart(2, '0')}`,
          queue: false,
        });
        const result = response.result;
        resolveSample({
          name: operation.name,
          actor: operation.actor,
          effectClass: operation.effectClass,
          targetOffsetMs: operation.arrivalOffsetMs,
          dispatchDriftMs: roundedMilliseconds(dispatchedAt - targetTime),
          latencyMs: roundedMilliseconds(performance.now() - dispatchedAt),
          outcome: 'applied',
          result: {
            mutator: result.mutator,
            outcome: result.outcome,
            sourceID: result.sourceID,
            issueID: result.issueID,
            intentID: result.intentID,
          },
          error: null,
        });
      } catch (error) {
        resolveSample({
          name: operation.name,
          actor: operation.actor,
          effectClass: operation.effectClass,
          targetOffsetMs: operation.arrivalOffsetMs,
          dispatchDriftMs: roundedMilliseconds(dispatchedAt - targetTime),
          latencyMs: roundedMilliseconds(performance.now() - dispatchedAt),
          outcome: 'refused',
          result: null,
          error: retainedError(error),
        });
      }
    }, delay);
  });
}

function rawCheckID(name) {
  const index = MUTATION_NAMES.indexOf(name);
  assert(index >= 0, `known mutation ${name}`);
  return `raw-mutation-${String(index + 1).padStart(2, '0')}-${name}`;
}

function samplesFor(cycleRuns, name) {
  return cycleRuns.map(cycle => {
    const sample = cycle.samples.find(candidate => candidate.name === name);
    assert(sample, `cycle ${cycle.cycle} recorded ${name}`);
    return sample;
  });
}

async function main() {
  const seamAuditOnly = process.env.ZBUGS_SEAM_AUDIT_ONLY === '1';
  const fixtureRoot = process.env.ZBUGS_LARGE_FIXTURE_ROOT;
  if (!fixtureRoot && !seamAuditOnly) {
    throw new Error('ZBUGS_LARGE_FIXTURE_ROOT is required');
  }
  const overlayPath = resolve(
    process.env.ZBUGS_LARGE_OVERLAY_PATH ?? DEFAULT_OVERLAY_PATH,
  );
  const cycles = Number(process.env.ZBUGS_HOT_CYCLES ?? 3);
  if (!Number.isSafeInteger(cycles) || cycles < 2) {
    throw new Error('ZBUGS_HOT_CYCLES must be an integer of at least 2');
  }
  const evidenceDir = process.env.ZBUGS_EVIDENCE_DIR;
  if (seamAuditOnly && !evidenceDir) {
    throw new Error('ZBUGS_SEAM_AUDIT_ONLY requires ZBUGS_EVIDENCE_DIR outside immutable evidence');
  }
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb5-hot.mjs'),
    scaleSupportIdentity.source,
    join(CONTROL_ROOT, 'scripts/build-large-overlay.mts'),
    join(CONTROL_ROOT, 'scripts/load-large-fixture.mts'),
    RECEIPT_PATH,
    join(REPO_ROOT, 'guide/testing/acceptance.md'),
  ]);
  const inventoryMutations = context.inventory.mutationDemand.mutators.map(row => row.name);
  const sourceReceipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  let verified = null;
  let overlay = null;
  let operationPlan = null;
  let operationPlanDigest = null;
  let seam = null;
  let baselineIngest = null;
  let loadMath = null;
  let baselineDigest = null;
  let sourceProject = null;
  let cycleRuns = [];
  let resetProofs = [];
  let liveActors = null;

  return await runZBGate({
    arm: 'snapback-control-hot',
    gate: 'zb5',
    attempt,
    title: 'Zerobugs control ZB5 — hot-recent profile qualification',
    expectedCheckIds: CHECK_IDS,
    evidenceDir,
    run: async gate => {
      await gate.check('gate-definition-and-distinct-receipt-arm', async () => {
        assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
        assert.equal(CHECK_IDS.length, 24);
        assert.equal(STATIC_CHECK_IDS.length, 5);
        assert.equal(LIVE_CHECK_IDS.length, 19);
        return {
          arm: 'snapback-control-hot',
          receipt: 'snapback-control-hot.zb5.v1.json',
          expectedChecks: CHECK_IDS.length,
          cycleCount: cycles,
          samplesPerMutation: cycles,
          rawSamplesTotal: cycles * 16,
          margins: 'none',
        };
      });

      if (seamAuditOnly) {
        seam = await auditLargeIngestSeam();
        const details = seam.compatible
          ? {
              owner: 'supervising socket-capable hot-profile run',
              reason: 'Socket-free seam-audit dry run stopped after proving the current generated ingest protocol compatible.',
              protocol: seam.requiredProtocol,
              blockers: [],
            }
          : {
              owner: 'control acceptance-ingest seam',
              reason: 'Hot baseline preflight found a genuinely incompatible generated seam; no session or mutation was attempted.',
              protocol: seam.requiredProtocol,
              blockers: seam.blockers,
            };
        for (const id of CHECK_IDS.slice(1)) gate.gap(id, details);
        return;
      }

      await gate.check('hot-profile-derives-from-verified-large-working-set', async () => {
        verified = await verifyLargeFixtureShards(resolve(fixtureRoot), RECEIPT_PATH);
        overlay = await readAndVerifyOverlay(overlayPath);
        assert.equal(overlay.payload.fixtureId, LARGE_FIXTURE_ID);
        assert.equal(overlay.payload.profileMode, 'authoritative-large');
        assert.equal(overlay.payload.sourceReceiptDigest, verified.receiptDigest);
        assert.equal(overlay.payload.workingSet.bound, 1_000);
        loadMath = largeBatchMath(overlay, verified.receipt.counts);
        return {
          fixtureId: 'hot-recent-v1',
          baseFixtureId: LARGE_FIXTURE_ID,
          baseDigest: verified.receipt.overallDigest,
          overlayDigest: overlay.contentDigest,
          workingSetDigest: overlay.payload.workingSet.issueIDsDigest,
          workingSetRows: 1_000,
          loadRows: loadMath.totalRows,
          loadBatches: loadMath.totalBatches,
        };
      });

      await gate.check('operation-arguments-emitted-and-content-digested-before-execution', async () => {
        operationPlan = buildHotOperationPlan(overlay, cycles);
        operationPlanDigest = taggedDigest(operationPlan);
        process.stdout.write(`ZBUGS_HOT_ARGUMENTS ${canonicalJson({
          digest: operationPlanDigest,
          plan: operationPlan,
        })}\n`);
        assert.equal(operationPlan.plan.length, cycles);
        assert(operationPlan.plan.every(cycle => cycle.operations.length === 16));
        return {
          emittedBeforeExecution: true,
          schemaVersion: operationPlan.schemaVersion,
          digest: operationPlanDigest,
          cycles,
          operations: cycles * 16,
          selectedRowsBound: 'W only',
        };
      });

      await gate.check('open-loop-arrivals-use-fixed-nonadaptive-offsets', async () => {
        const expected = MUTATION_NAMES.map((_, index) => index * ARRIVAL_INTERVAL_MS);
        for (const cycle of operationPlan.plan) {
          assert.deepEqual(cycle.operations.map(row => row.arrivalOffsetMs), expected);
        }
        return {
          arrivalOffsetsMs: expected,
          adaptiveArrivals: false,
          schedulingRule: 'dispatch deadline is cycleStart + inventoryIndex*25ms; no prior response is awaited to choose an arrival',
        };
      });

      await gate.check('eight-trigger-eight-nontrigger-inventory-partition', async () => {
        assert.deepEqual(inventoryMutations, MUTATION_NAMES);
        const trigger = MUTATION_NAMES.filter(name => EFFECT_TRIGGERS.has(name));
        const nonTrigger = MUTATION_NAMES.filter(name => !EFFECT_TRIGGERS.has(name));
        assert.equal(trigger.length, 8);
        assert.equal(nonTrigger.length, 8);
        return {trigger, nonTrigger, distinguishability: 'separate per-operation custody counters required live'};
      });

      seam = await auditLargeIngestSeam();
      if (!seam.compatible) {
        const gapDetails = {
          owner: 'control acceptance-ingest seam',
          reason: 'Hot baseline ingest preflight found a genuinely incompatible generated seam, so no server, session, reset clone, or mutation was attempted.',
          protocol: seam.requiredProtocol,
          ingestBlockers: seam.blockers,
          resetContract: {
            mode: 'paused-baseline SQLite clone per cycle',
            proof: 'stop baseline server; hash baseline database; clone into a fresh owned path; hash equality before each cycle start; start a fresh server on only that clone',
            full55MReloadPerCycle: false,
            mutatedRowRollbackClaimed: false,
          },
        };
        for (const id of LIVE_CHECK_IDS) gate.gap(id, gapDetails);
        return;
      }

      await gate.check('fresh-precycle-reset-is-byte-provable', async () => {
        const namespace = await createScaleNamespace(gate, 'zb5-hot');
        const baselinePath = databasePath(namespace, 'hot-baseline');
        const baseline = await startScaleServer(gate, namespace, {
          databasePath: baselinePath,
          instance: 'hot-baseline',
          configure: true,
        });
        baselineIngest = await loadLargeFixture({
          fixtureRoot: resolve(fixtureRoot),
          overlayPath,
          readyFile: baseline.readyFile,
          progressEvery: Number(process.env.ZBUGS_LARGE_PROGRESS_EVERY ?? 50),
        });
        assert.equal(baselineIngest.status, 'ok');
        assert.equal(baselineIngest.rows, loadMath.totalRows);
        assert.equal(baselineIngest.batches, loadMath.totalBatches);
        assert.equal(
          baselineIngest.insertedBatches + baselineIngest.replayedBatches,
          loadMath.totalBatches,
        );
        assert.deepEqual(baselineIngest.rowsByTable, loadMath.rowsByTable);
        sourceProject = await sourceProjectForSelection(
          verified,
          overlay.payload.selectedProject.id,
        );
        const paused = await pauseAndHashBaseline(baseline);
        baselineDigest = paused.digest;

        for (const cyclePlan of operationPlan.plan) {
          const cyclePath = databasePath(namespace, `hot-cycle-${cyclePlan.cycle}`);
          const clone = await cloneBaselineDatabase(
            baselinePath,
            cyclePath,
            baselineDigest,
          );
          resetProofs.push({
            cycle: cyclePlan.cycle,
            generation: cyclePlan.resetGeneration,
            baselineDigest,
            cloneDigest: clone.digest,
            cloneMethod: clone.method,
          });

          const cycleStack = await startScaleServer(gate, namespace, {
            databasePath: cyclePath,
            instance: `hot-cycle-${cyclePlan.cycle}`,
          });
          const bound = await bindLargeActors({
            api,
            overlay,
            readyFile: cycleStack.readyFile,
            instance: `zb5-hot-${cyclePlan.cycle}`,
          });
          liveActors ??= bound.actors;
          gate.registerCleanup({
            label: `ZB5 hot cycle ${cyclePlan.cycle} actor sessions`,
            run: () => bound.close(),
          });
          const anonymous = createAnonymousClient(
            cycleStack.serverUrl,
            `zb5-hot-${cyclePlan.cycle}`,
          );
          let anonymousClose = null;
          const closeAnonymous = () => {
            anonymousClose ??= anonymous.closeAuth();
            return anonymousClose;
          };
          gate.registerCleanup({
            label: `ZB5 hot cycle ${cyclePlan.cycle} anonymous client`,
            run: closeAnonymous,
          });
          const observers = await openHotObservers({
            bound,
            anonymous,
            projectName: sourceProject.lowerCaseName,
            cycle: cyclePlan.cycle,
          });
          gate.registerCleanup({
            label: `ZB5 hot cycle ${cyclePlan.cycle} live observers`,
            run: observers.close,
          });

          const attacker = await runAttackerProbes(anonymous, cyclePlan.cycle);
          const cycleStart = performance.now() + 50;
          const samples = await Promise.all(cyclePlan.operations.map(operation => (
            scheduleMutation({
              cycle: cyclePlan.cycle,
              operation,
              bound,
              cycleStart,
            })
          )));
          await observers.settle();

          const issueCreate = samples.find(sample => sample.name === 'issue.create');
          assert(issueCreate, 'hot cycle records issue.create');
          const created = issueCreate.outcome === 'applied' ? 1 : 0;
          for (const actor of [...LARGE_ACTORS, 'anonymous']) {
            const counter = observers.counters[actor];
            const crewVisible = actor === 'crew-admin' || actor === 'removed-member';
            assert.equal(
              counter.finalRows,
              (crewVisible ? 1_000 : 900) - 1 + created,
              `${actor} converges after delete and admitted/refused create`,
            );
            assert.equal(counter.finalConnection, 'live', `${actor} remains live at settle`);
            assert.equal(
              counter.finalProtectedRows,
              crewVisible ? 1 : 0,
              `${actor} settled protected-issue visibility follows current authority`,
            );
          }

          const localCustody = Object.fromEntries([
            ...[...bound.sessions].map(([actor, session]) => [
              actor,
              JSON.parse(JSON.stringify(session.client.localResourceInspection())),
            ]),
            ['anonymous', JSON.parse(JSON.stringify(anonymous.localResourceInspection()))],
          ]);
          cycleRuns.push({
            cycle: cyclePlan.cycle,
            argumentsDigest: cyclePlan.argumentsDigest,
            samples,
            attacker,
            observers: observers.counters,
            custody: {
              clients: Object.keys(localCustody).length,
              inspectionBytes: Buffer.byteLength(canonicalJson(localCustody), 'utf8'),
              inspectionDigest: sha256Bytes(canonicalJson(localCustody)),
              roleTransitionsApplied: 0,
              roleTransitionRefusals: 1,
            },
          });

          await observers.close();
          await closeAnonymous();
          await bound.close();
          await cycleStack.server.stop();
        }

        assert.equal(resetProofs.length, cycles);
        assert(resetProofs.every(row => row.cloneDigest === row.baselineDigest));
        return {
          baseline: {
            digest: baselineDigest,
            rows: baselineIngest.rows,
            batches: baselineIngest.batches,
            insertedBatches: baselineIngest.insertedBatches,
            replayedBatches: baselineIngest.replayedBatches,
            // Disclosed platform finding, not silently absorbed: the server's
            // SIGTERM shutdown stranded this WAL at multi-GiB scale and the
            // gate folded it with an explicit exclusive TRUNCATE checkpoint
            // before hashing (issues/20260807-server-sigterm-strands-large-
            // sqlite-wal.md).
            shutdownWal: paused.shutdownWal,
          },
          resetMode: 'paused-baseline SQLite clone into a fresh owned path per cycle',
          full55MReloadPerCycle: false,
          resetProofs,
          cycleServersStarted: cycleRuns.length,
          rawSamplesRecorded: cycleRuns.reduce((sum, cycle) => sum + cycle.samples.length, 0),
        };
      });

      const allSamples = cycleRuns.flatMap(cycle => cycle.samples);
      const triggerSamples = allSamples.filter(sample => sample.effectClass === 'trigger');
      const nonTriggerSamples = allSamples.filter(sample => sample.effectClass === 'non-trigger');
      const refusedTriggers = triggerSamples.filter(sample => sample.outcome === 'refused');
      const appliedTriggers = triggerSamples.filter(sample => sample.outcome === 'applied');
      const appliedNonTriggers = nonTriggerSamples.filter(sample => sample.outcome === 'applied');
      const onlyScaleCreateRefused = refusedTriggers.length === cycles
        && refusedTriggers.every(sample => (
          sample.name === 'issue.create'
          && sample.error?.appCode === 'ZBUGS_SHORT_ID_BOUNDARY'
        ))
        && appliedTriggers.length === cycles * 7
        && appliedNonTriggers.length === cycles * 8;

      if (onlyScaleCreateRefused) {
        gate.gap('runtime-effect-trigger-and-nontrigger-counters', {
          namedGap: 'W-SHORTID-LARGE',
          owner: 'control server/query lane',
          reason: 'All live cycles ran, but the scale-safe issue.create uniqueness contract is absent. Seven effect triggers committed per cycle and the eighth refused before write; all eight non-triggers committed without intent.',
          cycles,
          trigger: {
            plannedPerCycle: 8,
            appliedPerCycle: 7,
            refusedPerCycle: 1,
            durableIntentReceipts: appliedTriggers.filter(sample => sample.result?.intentID).length,
          },
          nonTrigger: {
            plannedPerCycle: 8,
            appliedPerCycle: 8,
            nonNullIntentReceipts: appliedNonTriggers.filter(sample => sample.result?.intentID).length,
          },
        });
      } else {
        await gate.check('runtime-effect-trigger-and-nontrigger-counters', async () => {
          assert.equal(refusedTriggers.length, 0, 'all eight effect triggers commit in every cycle');
          assert.equal(appliedTriggers.length, cycles * 8);
          assert(appliedTriggers.every(sample => sample.result?.intentID));
          assert.equal(appliedNonTriggers.length, cycles * 8);
          assert(appliedNonTriggers.every(sample => sample.result?.intentID === null));
          return {
            cycles,
            triggerReceipts: appliedTriggers.length,
            triggerIntentReceipts: appliedTriggers.filter(sample => sample.result.intentID).length,
            nonTriggerReceipts: appliedNonTriggers.length,
            nonTriggerIntentReceipts: 0,
          };
        });
      }

      gate.gap('hot-cycle-custody-counters', {
        owner: 'control acceptance authority-transition seam',
        reason: 'The live open-loop cycles, six observers, attacker probes, and retained-client inspections ran. The generated API still has no acceptance operation that performs the required crew-to-user role change and invalidates predecessor authority, so post-transition negative delivery cannot be claimed.',
        missingTransition: 'removed-member crew-to-user plus predecessor-authority invalidation',
        cycles,
        perCycle: cycleRuns.map(cycle => ({
          cycle: cycle.cycle,
          observers: cycle.observers,
          attacker: cycle.attacker,
          custody: cycle.custody,
        })),
      });

      for (const name of MUTATION_NAMES) {
        const id = rawCheckID(name);
        const samples = samplesFor(cycleRuns, name);
        // An aborted cycle stage leaves samples empty, and every() over an
        // empty array is vacuously true — these rows must fail, not pass,
        // when the cycles never ran.
        const allApplied = samples.length === cycles
          && samples.every(sample => sample.outcome === 'applied');
        const scaleCreateRefusal = name === 'issue.create'
          && samples.length === cycles
          && samples.every(sample => (
            sample.outcome === 'refused'
            && sample.error?.appCode === 'ZBUGS_SHORT_ID_BOUNDARY'
          ));
        if (scaleCreateRefusal) {
          gate.gap(id, {
            namedGap: 'W-SHORTID-LARGE',
            owner: 'control server/query lane',
            reason: 'The real live issue.create calls reached the million-issue baseline and honestly refused because the current allocator cannot prove short-id uniqueness beyond its 1,024-row portable bound.',
            samples: samples.map(sample => ({
              targetOffsetMs: sample.targetOffsetMs,
              dispatchDriftMs: sample.dispatchDriftMs,
              latencyMs: sample.latencyMs,
              outcome: sample.outcome,
              error: sample.error,
            })),
          });
          continue;
        }
        await gate.check(id, async () => {
          assert(allApplied, `${name} applied in every live cycle`);
          for (const sample of samples) {
            assert.equal(sample.result.mutator, name);
            assert.equal(sample.result.outcome, 'applied');
            if (EFFECT_TRIGGERS.has(name)) assert(sample.result.intentID);
            else assert.equal(sample.result.intentID, null);
          }
          return {
            samples: samples.map((sample, index) => ({
              cycle: cycleRuns[index]?.cycle ?? null,
              targetOffsetMs: sample.targetOffsetMs,
              dispatchDriftMs: sample.dispatchDriftMs,
              latencyMs: sample.latencyMs,
              outcome: sample.outcome,
              intent: sample.result.intentID === null ? 'none' : 'durable',
            })),
            margin: null,
          };
        });
      }
    },
    buildReceipt: async run => {
      const rawLatencyDistributions = Object.fromEntries(MUTATION_NAMES.map((name, index) => [
        name,
        {
          check: `raw-mutation-${String(index + 1).padStart(2, '0')}-${name}`,
          samplesMs: cycleRuns.map(cycle => (
            cycle.samples.find(sample => sample.name === name)?.latencyMs ?? null
          )).filter(value => value !== null),
          dispatchDriftMs: cycleRuns.map(cycle => (
            cycle.samples.find(sample => sample.name === name)?.dispatchDriftMs ?? null
          )).filter(value => value !== null),
          outcomes: cycleRuns.map(cycle => {
            const sample = cycle.samples.find(candidate => candidate.name === name);
            return sample ? {
              cycle: cycle.cycle,
              outcome: sample.outcome,
              error: sample.error,
            } : null;
          }).filter(Boolean),
          expectedSamples: cycles,
          status: gateCheckStatus(run.checks, `raw-mutation-${String(index + 1).padStart(2, '0')}-${name}`),
        },
      ]));
      const actorReceipt = liveActors
        ? Object.fromEntries(Object.entries(liveActors).map(([actor, identity]) => [actor, {
            sourceUserID: identity.sourceUserID,
            role: identity.role,
            principalDigest: sha256Bytes(identity.principal),
          }]))
        : overlay?.payload.actorBindings ?? null;
      const flatSamples = cycleRuns.flatMap(cycle => cycle.samples);
      const appliedTriggers = flatSamples.filter(sample => (
        sample.effectClass === 'trigger' && sample.outcome === 'applied'
      ));
      const appliedNonTriggers = flatSamples.filter(sample => (
        sample.effectClass === 'non-trigger' && sample.outcome === 'applied'
      ));
      const fields = await buildGateReceiptFields(context, run, {
        actorIdentity: actorReceipt ? {
          mode: liveActors
            ? 'fresh per-cycle external sessions; principal carriers withheld and content-digested'
            : 'manifest source-user bindings; no live session carriers retained',
          actors: actorReceipt,
        } : {mode: 'overlay unavailable'},
        capabilityFacts: [
          {id: 'performance.hot-profile', status: status(run.checks, 'hot-cycle-custody-counters')},
          {id: 'effects.hot-trigger-distinguishability', status: status(run.checks, 'runtime-effect-trigger-and-nontrigger-counters')},
          {id: 'hot.open-loop-fixed-arrivals', status: status(run.checks, 'fresh-precycle-reset-is-byte-provable')},
        ],
        refusalFacts: [
          {id: 'hot-cycle-without-provable-reset', status: 'refused'},
          {id: 'adaptive-arrival-rate', status: 'refused'},
          {id: 'performance-unfrozen-margin', status: 'refused'},
          {
            id: 'removed-member-role-transition-without-authority-invalidation',
            status: gateCheckStatus(run.checks, 'hot-cycle-custody-counters') === 'GAP'
              ? 'refused'
              : 'not-observed',
          },
          {
            id: 'issue-create-beyond-portable-short-id-bound',
            status: gateCheckStatus(run.checks, 'raw-mutation-01-issue.create') === 'GAP'
              ? 'refused'
              : 'not-observed',
          },
        ],
        workarounds: [{
          id: 'HOT-RESET-BASELINE-CLONE',
          status: status(run.checks, 'fresh-precycle-reset-is-byte-provable'),
          mode: 'byte-identical paused SQLite baseline clone per cycle',
          baselineDigest,
          resetProofs,
        }],
        sourceAccounting: {
          expectedChecks: CHECK_IDS.length,
          inventoryOrder: MUTATION_NAMES,
          cycles,
          operationArgumentsDigest: operationPlanDigest,
          operationPlan,
          rawLatencyDistributions,
          rawSamplesRecorded: flatSamples.length,
        },
        custodyAccounting: {
          status: gateCheckStatus(run.checks, 'hot-cycle-custody-counters'),
          perCycle: cycleRuns.map(cycle => ({
            cycle: cycle.cycle,
            observers: cycle.observers,
            attacker: cycle.attacker,
            localInspection: cycle.custody,
          })),
          effectTriggerCounters: {
            planned: cycles * 8,
            applied: appliedTriggers.length,
            refused: flatSamples.filter(sample => (
              sample.effectClass === 'trigger' && sample.outcome === 'refused'
            )).length,
            durableIntentReceipts: appliedTriggers.filter(sample => sample.result?.intentID).length,
          },
          effectNonTriggerCounters: {
            planned: cycles * 8,
            applied: appliedNonTriggers.length,
            refused: flatSamples.filter(sample => (
              sample.effectClass === 'non-trigger' && sample.outcome === 'refused'
            )).length,
            nonNullIntentReceipts: appliedNonTriggers.filter(sample => sample.result?.intentID).length,
          },
          roleTransition: gateCheckStatus(run.checks, 'hot-cycle-custody-counters') === 'GAP'
            ? 'missing generated crew-to-user transition and predecessor-authority invalidation operation'
            : 'qualified',
        },
      });
      return {
        ...fields,
        fixtureIdentity: {
          id: 'hot-recent-v1',
          baseFixtureId: LARGE_FIXTURE_ID,
          digest: sourceReceipt.overallDigest,
          overlayDigest: overlay?.contentDigest ?? null,
          workingSetDigest: overlay?.payload.workingSet.issueIDsDigest ?? null,
          rowCount: baselineIngest?.rows ?? sourceReceipt.counts.total,
          baseRowCount: sourceReceipt.counts.total,
          batches: baselineIngest?.batches ?? null,
          mode: 'deterministic derivation; no separate generated database',
        },
        browserIdentity: {
          mode: cycleRuns.length > 0
            ? 'headless SnapbackClient streaming live-query observers'
            : 'not-launched during socket-free seam audit or incompatible-seam refusal',
          observerCountPerCycle: cycleRuns.length > 0 ? 6 : 0,
        },
        network: cycleRuns.length > 0
          ? 'owned local loopback servers; stream transport with poll fallback disabled; fixed open-loop arrivals'
          : 'socket-free seam audit or incompatible-seam refusal',
      };
    },
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
