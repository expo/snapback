import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';

import api from '../../../snapback/generated/api.mjs';

import {
  GENERATION_EPOCH_MS,
  LARGE_FIXTURE_ID,
  MANIFEST_ID,
  POLICY_ISSUE_ID,
  canonicalJson,
  overlayHash,
  overlayID,
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
  bindLargeActors,
  createAnonymousClient,
  createScaleNamespace,
  databasePath,
  issueIDs,
  listContext,
  queryOne,
  scaleSupportIdentity,
  startScaleServer,
} from './zb5-scale-support.mjs';

// @ref LLP 0183#zb5--performance-scale-and-custody — this is a distinct
// large-profile arm. It retains raw samples without margins and cannot replace
// the normal-control ZB5 receipt or its earlier GAP rows.

export const CHECK_IDS = Object.freeze([
  'gate-definition-and-distinct-receipt-arm',
  'large-source-shards-match-frozen-receipt',
  'large-overlay-rules-1-through-6-and-digest',
  'large-source-and-overlay-counts',
  'working-set-oracle-is-bounded-and-exact',
  'resumable-ingest-and-inverse-remap',
  'loaded-table-counts-equal-large-profile',
  'live-list-window-matches-bounded-working-set-oracle',
  'protected-internal-issue-enters-working-set',
  'ordinary-and-anonymous-count-like-surfaces-do-not-leak-protected-issue',
  'search-epoch-refuses-at-1024-partition-boundary',
  'raw-list-ready-timing',
  'raw-representative-window-walk-timing',
  'large-custody-counters',
]);

const LIVE_CHECK_IDS = Object.freeze(CHECK_IDS.slice(5));
const RECEIPT_PATH = join(
  REPO_ROOT,
  'demos/zerobugs/manifest/large-seed42-v1.receipt.json',
);
const DEFAULT_OVERLAY_PATH = join(
  CONTROL_ROOT,
  '.snapback/large-fixture/large-overlay-v1.json',
);

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareIssueRecency(left, right) {
  const modified = right.modified - left.modified;
  return modified === 0 ? compareText(right.id, left.id) : modified;
}

function expectedStatus(checks, id) {
  return gateCheckStatus(checks, id) === 'PASS' ? 'supported-local-control' : 'gap';
}

function validateOverlayRules(envelope) {
  const payload = envelope.payload;
  assert.equal(payload.schemaVersion, 'zerobugs-large-overlay.v1');
  assert.equal(payload.manifestId, MANIFEST_ID);
  assert.equal(payload.fixtureId, LARGE_FIXTURE_ID);
  assert.equal(payload.profileMode, 'authoritative-large');
  assert.equal(payload.workingSet.bound, 1_000);
  assert.equal(payload.workingSet.issueIDs.length, 1_000);
  assert.equal(payload.workingSet.oracleRows.length, 1_000);
  assert.equal(payload.workingSet.issueIDs[0], POLICY_ISSUE_ID);
  assert.deepEqual(
    [...payload.workingSet.oracleRows].sort(compareIssueRecency),
    payload.workingSet.oracleRows,
  );
  assert.deepEqual(
    payload.workingSet.oracleRows.map(row => row.id),
    payload.workingSet.issueIDs,
  );
  assert.equal(
    payload.workingSet.issueIDsDigest,
    taggedDigest(payload.workingSet.issueIDs),
  );
  const policy = payload.rows.issue.find(row => row.id === POLICY_ISSUE_ID);
  assert(policy, 'policy extension issue exists');
  assert.equal(policy.projectID, payload.selectedProject.id);
  assert.equal(policy.visibility, 'internal');
  assert.equal(policy.modified, GENERATION_EPOCH_MS + 1);

  const seen = new Set();
  const checkID = (id, table, fixed = false) => {
    assert.equal(typeof id, 'string');
    if (!fixed) assert.match(id, /^zbav1_[0-9a-f]{24}$/u);
    assert(!seen.has(id), `${table} id collision ${id}`);
    seen.add(id);
  };
  for (const [rank, row] of payload.rows.viewState.entries()) {
    checkID(row._id, 'viewState');
    assert.equal(row.viewed, GENERATION_EPOCH_MS - rank);
    assert.equal(row._id, overlayID('viewState', row.userID, [row.issueID]));
  }
  for (const [rank, row] of payload.rows.issueNotifications.entries()) {
    checkID(row._id, 'issueNotifications');
    assert.equal(row.created, GENERATION_EPOCH_MS - rank);
    assert.equal(row._id, overlayID('issueNotifications', row.userID, [row.issueID]));
    assert.equal(
      row.subscribed,
      overlayHash('issueNotifications', row.userID, [row.issueID])[0] % 2 === 0,
    );
  }
  for (const row of payload.rows.userPref) {
    checkID(row._id, 'userPref');
    assert.equal(row.key, MANIFEST_ID);
    assert.equal(row._id, overlayID('userPref', row.userID, [MANIFEST_ID]));
    assert.equal(
      row.value,
      overlayHash('userPref', row.userID, [MANIFEST_ID]).toString('hex').slice(0, 32),
    );
  }
  for (const row of payload.rows.emoji) {
    const fixed = row.id === 'zbav1_internal_issue_emoji'
      || row.id === 'zbav1_internal_comment_emoji';
    checkID(row.id, 'emoji', fixed);
    assert.equal(row.value, '👍');
    assert.equal(row.annotation, 'thumbs up');
  }
  assert.equal(payload.rows.viewState.length, 5_000);
  assert.equal(payload.rows.issueNotifications.length, 5_000);
  assert.equal(payload.rows.userPref.length, 5);
  assert.equal(payload.projections.issueListRead.length, 1_000);
  assert.equal(payload.projections.issueSearchDocument.length, 1_000);
  assert(payload.gaps.some(row => row.id === 'W-READMODEL-LARGE-FULL-CORPUS'));
}

function roundedMilliseconds(value) {
  return Math.round(value * 1_000) / 1_000;
}

function responseBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
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

async function timedQuery(client, reference, args, label) {
  const started = performance.now();
  const row = await queryOne(client, reference, args, label);
  return {
    row,
    elapsedMs: roundedMilliseconds(performance.now() - started),
    responseBytes: responseBytes(row),
  };
}

async function walkIssueWindows(client, projectName, direction) {
  const rows = [];
  const samplesMs = [];
  const responseByteSamples = [];
  let start = null;
  for (;;) {
    const sample = await timedQuery(client, api.issueListV2, {
      listContext: listContext(projectName),
      limit: 100,
      start,
      dir: direction,
      inclusive: false,
    }, `${direction} W window`);
    const envelope = sample.row;
    rows.push(...issueIDs(envelope));
    samplesMs.push(sample.elapsedMs);
    responseByteSamples.push(sample.responseBytes);
    if (!envelope.hasMore) {
      assert.equal(envelope.status, 'complete');
      assert.equal(envelope.cursor, null);
      break;
    }
    assert.equal(envelope.status, 'incomplete');
    assert.equal(envelope.reason, 'page-limit');
    assert(envelope.cursor, `${direction} nonterminal page has a cursor`);
    start = envelope.cursor;
  }
  assert.equal(new Set(rows).size, rows.length, `${direction} walk has no duplicates`);
  return {rows, samplesMs, responseByteSamples};
}

async function searchBoundaryComments(verified, overlay, count) {
  const workingSet = new Set(overlay.payload.workingSet.issueIDs);
  const candidateIssues = new Set();
  for await (const row of readCsvTable(verified.shardsByTable.issue, 'issue')) {
    if (
      row.projectID === overlay.payload.selectedProject.id
      && row.visibility === 'public'
      && !workingSet.has(row.id)
    ) {
      candidateIssues.add(row.id);
      if (candidateIssues.size === Math.max(count * 8, 1_024)) break;
    }
  }
  assert(candidateIssues.size >= count, 'large source has enough public non-W issues');

  const comments = [];
  const seenIssues = new Set();
  for await (const row of readCsvTable(verified.shardsByTable.comment, 'comment')) {
    if (candidateIssues.has(row.issueID) && !seenIssues.has(row.issueID)) {
      seenIssues.add(row.issueID);
      comments.push({id: row.id, issueID: row.issueID});
      if (comments.length === count) break;
    }
  }
  assert.equal(comments.length, count, 'large source has one comment for each search-boundary issue');
  return comments;
}

async function main() {
  const fixtureRoot = process.env.ZBUGS_LARGE_FIXTURE_ROOT;
  const seamAuditOnly = process.env.ZBUGS_SEAM_AUDIT_ONLY === '1';
  if (!fixtureRoot && !seamAuditOnly) {
    throw new Error('ZBUGS_LARGE_FIXTURE_ROOT is required');
  }
  const overlayPath = resolve(
    process.env.ZBUGS_LARGE_OVERLAY_PATH ?? DEFAULT_OVERLAY_PATH,
  );
  const evidenceDir = process.env.ZBUGS_EVIDENCE_DIR;
  if (seamAuditOnly && !evidenceDir) {
    throw new Error('ZBUGS_SEAM_AUDIT_ONLY requires ZBUGS_EVIDENCE_DIR outside immutable evidence');
  }
  const attempt = process.env.ZBUGS_ATTEMPT ?? 'v1';
  const context = await loadGateContext([
    join(import.meta.dirname, 'zb5-large.mjs'),
    join(CONTROL_ROOT, 'scripts/build-large-overlay.mts'),
    join(CONTROL_ROOT, 'scripts/load-large-fixture.mts'),
    scaleSupportIdentity.source,
    RECEIPT_PATH,
    join(REPO_ROOT, 'guide/testing/acceptance.md'),
  ]);
  const sourceReceipt = JSON.parse(await readFile(RECEIPT_PATH, 'utf8'));
  let verified = null;
  let overlay = null;
  let math = null;
  let seam = null;
  let ingest = null;
  let sourceProject = null;
  let bound = null;
  let anonymous = null;
  let namespace = null;
  let stack = null;
  let fullListSample = null;
  let walkSamples = null;
  let searchBoundary = null;
  let custody = null;

  return await runZBGate({
    arm: 'snapback-control-large',
    gate: 'zb5',
    attempt,
    title: 'Zerobugs control ZB5 — large profile qualification',
    expectedCheckIds: CHECK_IDS,
    evidenceDir,
    run: async gate => {
      await gate.check('gate-definition-and-distinct-receipt-arm', async () => {
        assert.equal(new Set(CHECK_IDS).size, CHECK_IDS.length);
        assert.equal(CHECK_IDS.length, 14);
        assert.equal(LIVE_CHECK_IDS.length, 9);
        return {
          arm: 'snapback-control-large',
          receipt: 'snapback-control-large.zb5.v1.json',
          overwritesLane7: false,
          expectedChecks: CHECK_IDS.length,
          performancePolicy: 'single raw sample per named path; no margins or score',
        };
      });

      if (seamAuditOnly) {
        seam = await auditLargeIngestSeam();
        const details = seam.compatible
          ? {
              owner: 'supervising socket-capable large-profile run',
              reason: 'Socket-free seam-audit dry run stopped after proving the current generated ingest protocol compatible.',
              protocol: seam.requiredProtocol,
              blockers: [],
            }
          : {
              owner: 'control acceptance-ingest seam',
              reason: 'Large ingest preflight found a genuinely incompatible generated seam; no session or mutation was attempted.',
              protocol: seam.requiredProtocol,
              blockers: seam.blockers,
            };
        for (const id of CHECK_IDS.slice(1)) gate.gap(id, details);
        return;
      }

      await gate.check('large-source-shards-match-frozen-receipt', async () => {
        verified = await verifyLargeFixtureShards(resolve(fixtureRoot), RECEIPT_PATH);
        assert.equal(verified.receipt.fixtureId, LARGE_FIXTURE_ID);
        assert.equal(verified.receipt.counts.total, 5_533_266);
        assert.equal(verified.receipt.overallDigest, sourceReceipt.overallDigest);
        return {
          fixtureId: LARGE_FIXTURE_ID,
          overallDigest: verified.receipt.overallDigest,
          receiptDigest: verified.receiptDigest,
          shardsVerified: Object.keys(verified.receipt.shards).length,
          bytesUsedOnlyAfterAllShardDigestsMatched: true,
        };
      });

      await gate.check('large-overlay-rules-1-through-6-and-digest', async () => {
        overlay = await readAndVerifyOverlay(overlayPath);
        validateOverlayRules(overlay);
        assert.equal(overlay.payload.sourceReceiptDigest, verified.receiptDigest);
        assert.equal(overlay.payload.sourceOverallDigest, verified.receipt.overallDigest);
        return {
          overlayId: overlay.payload.overlayId,
          contentDigest: overlay.contentDigest,
          selectedProject: overlay.payload.selectedProject,
          workingSetDigest: overlay.payload.workingSet.issueIDsDigest,
          policyIssueFirst: true,
          collisionAndReferenceChecks: 'builder refused before artifact publication on mismatch',
        };
      });

      await gate.check('large-source-and-overlay-counts', async () => {
        assert.deepEqual(verified.receipt.counts, {
          user: 100,
          project: 100,
          label: 4_810,
          issue: 1_000_000,
          comment: 2_527_886,
          issueLabel: 2_000_370,
          total: 5_533_266,
        });
        math = largeBatchMath(overlay, verified.receipt.counts);
        assert.equal(math.rowsByTable.issue, 1_000_001);
        assert.equal(math.rowsByTable.comment, 2_527_887);
        assert.equal(math.rowsByTable.viewState, 5_000);
        assert.equal(math.rowsByTable.issueNotifications, 5_000);
        assert.equal(math.rowsByTable.userPref, 5);
        return {sourceCounts: verified.receipt.counts, loadPlan: math};
      });

      await gate.check('working-set-oracle-is-bounded-and-exact', async () => {
        const rows = overlay.payload.workingSet.oracleRows;
        assert.equal(rows.length, 1_000);
        assert(rows.every(row => row.projectID === overlay.payload.selectedProject.id));
        assert.deepEqual([...rows].sort(compareIssueRecency), rows);
        return {
          oracleBound: 'exactly W; no full 5.5M-row replay claimed',
          rows: rows.length,
          order: '(modified desc, id desc)',
          digest: taggedDigest(rows),
        };
      });

      seam = await auditLargeIngestSeam();
      if (!seam.compatible) {
        const details = {
          owner: 'control acceptance-ingest seam',
          reason: 'Large ingest preflight refused before session mint or mutation.',
          protocol: seam.requiredProtocol,
          blockers: seam.blockers,
          batches: math.totalBatches,
        };
        for (const id of LIVE_CHECK_IDS) gate.gap(id, details);
        return;
      }

      await gate.check('resumable-ingest-and-inverse-remap', async () => {
        namespace = await createScaleNamespace(gate, 'zb5-large');
        stack = await startScaleServer(gate, namespace, {
          databasePath: databasePath(namespace, 'large-baseline'),
          instance: 'large-baseline',
          configure: true,
        });
        ingest = await loadLargeFixture({
          fixtureRoot: resolve(fixtureRoot),
          overlayPath,
          readyFile: stack.readyFile,
          progressEvery: Number(process.env.ZBUGS_LARGE_PROGRESS_EVERY ?? 50),
        });
        assert.equal(ingest.status, 'ok');
        assert.equal(ingest.fixtureId, LARGE_FIXTURE_ID);
        assert.equal(ingest.overlayDigest, overlay.contentDigest);
        assert.equal(ingest.baseDigest, verified.receipt.overallDigest);
        assert.equal(ingest.rows, math.totalRows);
        assert.equal(ingest.batches, math.totalBatches);
        assert.equal(ingest.insertedBatches + ingest.replayedBatches, math.totalBatches);
        assert.deepEqual(ingest.rowsByTable, math.rowsByTable);
        return {
          protocol: seam.requiredProtocol,
          rows: ingest.rows,
          batches: ingest.batches,
          insertedBatches: ingest.insertedBatches,
          replayedBatches: ingest.replayedBatches,
          inverseRemap: 'every committed or replayed row matched its source-shaped canonical row before progress advanced',
          checkpoint: ingest.checkpoint,
          elapsedMs: ingest.elapsedMs,
        };
      });

      await gate.check('loaded-table-counts-equal-large-profile', async () => {
        assert(ingest && stack, 'resumable ingest completed');
        sourceProject = await sourceProjectForSelection(
          verified,
          overlay.payload.selectedProject.id,
        );
        bound = await bindLargeActors({
          api,
          overlay,
          readyFile: stack.readyFile,
          instance: 'zb5-large',
        });
        gate.registerCleanup({
          label: 'ZB5 large actor sessions',
          run: () => bound.close(),
        });
        anonymous = createAnonymousClient(stack.serverUrl, 'zb5-large');
        let anonymousClose = null;
        gate.registerCleanup({
          label: 'ZB5 large anonymous client',
          run: () => {
            anonymousClose ??= anonymous.closeAuth();
            return anonymousClose;
          },
        });
        assert.deepEqual(ingest.rowsByTable, math.rowsByTable);
        assert.equal(ingest.rowsByTable.issue, 1_000_001);
        assert.equal(ingest.rowsByTable.comment, 2_527_887);
        assert.equal(ingest.rowsByTable.issueListRead, 1_000);
        assert.equal(ingest.rowsByTable.issueSearchDocument, 1_000);
        assert.equal(ingest.rowsByTable.searchEpoch, 2);
        return {
          rows: ingest.rows,
          batches: ingest.batches,
          rowsByTable: ingest.rowsByTable,
          selectedProject: sourceProject,
          actorsBoundAfterIngest: Object.keys(bound.actors).length,
        };
      });

      await gate.check('live-list-window-matches-bounded-working-set-oracle', async () => {
        const crew = bound.sessions.get('crew-admin').client;
        fullListSample = await timedQuery(crew, api.issueListV2, {
          listContext: listContext(sourceProject.lowerCaseName),
          limit: 1_000,
          start: null,
          dir: 'forward',
          inclusive: false,
        }, 'crew W list');
        const envelope = fullListSample.row;
        assert.equal(envelope.status, 'complete');
        assert.equal(envelope.reason, null);
        assert.equal(envelope.hasMore, false);
        assert.equal(envelope.examined, 1_000);
        assert.equal(envelope.total, 1_000);
        assert.deepEqual(
          envelope.items.map(item => item.issue),
          overlay.payload.workingSet.oracleRows,
        );
        return {
          rows: envelope.items.length,
          examined: envelope.examined,
          total: envelope.total,
          order: '(modified desc, id desc)',
          oracleDigest: taggedDigest(overlay.payload.workingSet.oracleRows),
          observedDigest: taggedDigest(envelope.items.map(item => item.issue)),
        };
      });

      await gate.check('protected-internal-issue-enters-working-set', async () => {
        const envelope = fullListSample.row;
        assert.equal(envelope.items[0].issue.id, POLICY_ISSUE_ID);
        assert.equal(envelope.items[0].issue.visibility, 'internal');
        assert.equal(envelope.items[0].issue.modified, GENERATION_EPOCH_MS + 1);
        return {
          actor: 'crew-admin',
          issueID: POLICY_ISSUE_ID,
          rank: 0,
          visibility: 'internal',
        };
      });

      await gate.check('ordinary-and-anonymous-count-like-surfaces-do-not-leak-protected-issue', async () => {
        const ordinary = bound.sessions.get('ordinary-user').client;
        const args = {
          listContext: listContext(sourceProject.lowerCaseName),
          limit: 1_000,
          start: null,
          dir: 'forward',
          inclusive: false,
        };
        const [ordinaryEnvelope, anonymousEnvelope] = await Promise.all([
          queryOne(ordinary, api.issueListV2, args, 'ordinary W list'),
          queryOne(anonymous, api.issueListV2, args, 'anonymous W list'),
        ]);
        const publicOracle = overlay.payload.workingSet.oracleRows
          .filter(row => row.visibility === 'public');
        assert.equal(publicOracle.length, 900);
        for (const [actor, envelope] of [
          ['ordinary-user', ordinaryEnvelope],
          ['anonymous', anonymousEnvelope],
        ]) {
          assert.equal(envelope.status, 'complete', `${actor} completeness`);
          assert.equal(envelope.examined, publicOracle.length, `${actor} examined`);
          assert.equal(envelope.total, publicOracle.length, `${actor} total`);
          assert.deepEqual(
            envelope.items.map(item => item.issue),
            publicOracle,
            `${actor} exact public W`,
          );
          assert(!issueIDs(envelope).includes(POLICY_ISSUE_ID), `${actor} hides policy issue`);
        }
        return {
          publicRows: publicOracle.length,
          protectedRowsExcluded: 100,
          ordinary: {examined: ordinaryEnvelope.examined, total: ordinaryEnvelope.total},
          anonymous: {examined: anonymousEnvelope.examined, total: anonymousEnvelope.total},
          policyIssueContribution: 0,
        };
      });

      await gate.check('raw-list-ready-timing', async () => ({
        samplesMs: [fullListSample.elapsedMs],
        responseByteSamples: [fullListSample.responseBytes],
        start: 'authenticated generated issueListV2 request issued',
        end: 'complete exact 1,000-row W envelope received and validated',
        profile: 'local loopback; file-backed SQLite; no margin',
      }));

      await gate.check('raw-representative-window-walk-timing', async () => {
        const crew = bound.sessions.get('crew-admin').client;
        const forward = await walkIssueWindows(
          crew,
          sourceProject.lowerCaseName,
          'forward',
        );
        const backward = await walkIssueWindows(
          crew,
          sourceProject.lowerCaseName,
          'backward',
        );
        const oracle = overlay.payload.workingSet.issueIDs;
        assert.deepEqual(forward.rows, oracle);
        assert.deepEqual(backward.rows, [...oracle].reverse());
        walkSamples = {forward, backward};
        return {
          pageSize: 100,
          forwardSamplesMs: forward.samplesMs,
          backwardSamplesMs: backward.samplesMs,
          forwardResponseByteSamples: forward.responseByteSamples,
          backwardResponseByteSamples: backward.responseByteSamples,
          forwardRows: forward.rows.length,
          backwardRows: backward.rows.length,
          duplicateOrSkippedRows: 0,
        };
      });

      await gate.check('search-epoch-refuses-at-1024-partition-boundary', async () => {
        const publicDocuments = overlay.payload.projections.issueSearchDocument
          .filter(row => row.visibility === 'public').length;
        const required = 1_024 - publicDocuments;
        assert.equal(publicDocuments, 900);
        assert.equal(required, 124);
        const comments = await searchBoundaryComments(verified, overlay, required);
        const crew = bound.sessions.get('crew-admin').client;
        const intentIDs = [];
        for (const [index, comment] of comments.entries()) {
          const response = await crew.mutate(api.commentEdit, {
            args: {
              id: comment.id,
              body: `ZB5 search boundary marker ${String(index).padStart(3, '0')}`,
              compositionClientID: 'zb5-large-search-boundary',
              compositionMutationID: `edit-${String(index).padStart(3, '0')}`,
            },
            clientMutationId: `zb5-large-search-boundary-${String(index).padStart(3, '0')}`,
            queue: false,
          });
          assert.equal(response.result.mutator, 'comment.edit');
          assert.equal(response.result.outcome, 'applied');
          assert.equal(response.result.issueID, comment.issueID);
          assert.equal(typeof response.result.intentID, 'string');
          intentIDs.push(response.result.intentID);
        }
        assert.equal(new Set(intentIDs).size, required);
        const refused = await queryOne(crew, api.issueListV2, {
          listContext: listContext(sourceProject.lowerCaseName, {
            textFilter: 'ZB5 search boundary marker',
          }),
          limit: 100,
          start: null,
          dir: 'forward',
          inclusive: false,
        }, 'search boundary query');
        assert.equal(refused.status, 'refreshing');
        assert.equal(refused.reason, 'search-document-bound-or-epoch-missing');
        assert.equal(refused.hasMore, true);
        assert.equal(refused.items.length, 0);
        assert.equal(refused.total, 0);
        const publicEpoch = refused.searchEpoch.find(row => row.visibility === 'public');
        assert(publicEpoch, 'refusal retains the public search epoch fact');
        assert.equal(publicEpoch.epoch, required);
        searchBoundary = {
          initialPublicDocuments: publicDocuments,
          addedPublicDocuments: required,
          boundary: publicDocuments + required,
          publicEpoch: publicEpoch.epoch,
          durableTriggerIntents: intentIDs.length,
          refusal: {status: refused.status, reason: refused.reason},
        };
        return searchBoundary;
      });

      await gate.check('large-custody-counters', async () => {
        const clientInspections = Object.fromEntries([
          ...[...bound.sessions.entries()].map(([actor, session]) => [
            actor,
            JSON.parse(JSON.stringify(session.client.localResourceInspection())),
          ]),
          ['anonymous', JSON.parse(JSON.stringify(anonymous.localResourceInspection()))],
        ]);
        custody = {
          serverRows: ingest.rows,
          serverRowsByTable: ingest.rowsByTable,
          ledgerBatches: ingest.batches,
          boundedReadModelRows: overlay.payload.counts.boundedProjectionRows,
          W: overlay.payload.workingSet.bound,
          crewVisibleW: 1_000,
          ordinaryAndAnonymousVisibleW: 900,
          browserFacts: 0,
          retainedQueryPayloadsClaimed: 0,
          snapshotResponseBytes: fullListSample.responseBytes,
          walkResponseBytes: [
            ...walkSamples.forward.responseByteSamples,
            ...walkSamples.backward.responseByteSamples,
          ].reduce((sum, value) => sum + value, 0),
          searchBoundary,
          clientInspections,
        };
        assert.equal(custody.serverRows, math.totalRows);
        assert.equal(custody.W, 1_000);
        assert.equal(custody.browserFacts, 0);
        return custody;
      });
    },
    buildReceipt: async run => {
      const actorIdentity = bound ? {
        mode: 'fresh large-fixture bindings; raw session carriers excluded',
        actors: Object.fromEntries(Object.entries(bound.actors).map(([actor, binding]) => [
          actor,
          {
            sourceUserID: binding.sourceUserID,
            role: binding.role,
            principalSha256: sha256Bytes(binding.principal),
          },
        ])),
      } : overlay ? {
        mode: 'manifest source-user bindings; no live session carriers retained',
        actors: overlay.payload.actorBindings,
      } : {mode: seamAuditOnly ? 'socket-free seam audit' : 'overlay unavailable'};
      const rawSampleCount = fullListSample
        ? 1
          + (walkSamples?.forward.samplesMs.length ?? 0)
          + (walkSamples?.backward.samplesMs.length ?? 0)
        : 0;
      const fields = await buildGateReceiptFields(context, run, {
        actorIdentity,
        capabilityFacts: [
          {id: 'performance.large-fixture', status: expectedStatus(run.checks, 'raw-list-ready-timing')},
          {id: 'relational-graph.issue-list.large-W', status: expectedStatus(run.checks, 'live-list-window-matches-bounded-working-set-oracle'), bound: 'W=1,000'},
          {id: 'derived-search.large-refusal', status: expectedStatus(run.checks, 'search-epoch-refuses-at-1024-partition-boundary')},
        ],
        refusalFacts: [
          {id: 'large-ingest-without-idempotent-batch-ledger', status: 'refused', blockers: seam?.blockers ?? []},
          {id: 'large-full-corpus-readmodel-projection', status: 'gap', owner: 'control server/read-model ingestion lane'},
          {id: 'performance-unfrozen-margin', status: 'refused'},
        ],
        workarounds: [{
          id: 'W-READMODEL-LARGE-FULL-CORPUS',
          status: 'gap',
          admittedBound: 'working set W only',
          owner: 'control server/read-model ingestion lane',
        }],
        sourceAccounting: {
          expectedChecks: CHECK_IDS.length,
          sourceCounts: verified?.receipt.counts ?? sourceReceipt.counts,
          overlayCounts: overlay?.payload.counts ?? null,
          batchMath: math,
          oracleBound: 'W only',
          ingest,
          fullListSample: fullListSample ? {
            elapsedMs: fullListSample.elapsedMs,
            responseBytes: fullListSample.responseBytes,
          } : null,
          windowWalk: walkSamples ? {
            forward: {
              rows: walkSamples.forward.rows.length,
              digest: taggedDigest(walkSamples.forward.rows),
              samplesMs: walkSamples.forward.samplesMs,
              responseByteSamples: walkSamples.forward.responseByteSamples,
            },
            backward: {
              rows: walkSamples.backward.rows.length,
              digest: taggedDigest(walkSamples.backward.rows),
              samplesMs: walkSamples.backward.samplesMs,
              responseByteSamples: walkSamples.backward.responseByteSamples,
            },
          } : null,
          searchBoundary,
          rawSamples: rawSampleCount,
        },
        custodyAccounting: custody ?? {
          status: gateCheckStatus(run.checks, 'large-custody-counters'),
          serverRows: null,
          browserFacts: null,
          reason: seamAuditOnly
            ? 'socket-free seam audit stopped before fixture access'
            : seam?.compatible === false
              ? 'incompatible seam refused before server mutation'
              : 'live custody check did not complete',
        },
      });
      return {
        ...fields,
        fixtureIdentity: {
          id: LARGE_FIXTURE_ID,
          extensionIds: ['large-overlay-v1', 'policy-extension-v1'],
          digest: sourceReceipt.overallDigest,
          overlayDigest: overlay?.contentDigest ?? null,
          rowCount: ingest?.rows ?? sourceReceipt.counts.total,
          baseRowCount: sourceReceipt.counts.total,
          mode: 'canonical CSV shards verified before use; W projection bound recorded separately',
        },
        browserIdentity: {
          mode: seamAuditOnly
            ? 'socket-free seam-audit dry run'
            : 'headless generated-client scale driver; no browser launched',
        },
        network: seamAuditOnly
          ? 'socket-free seam audit; no timing sample claimed'
          : 'owned local loopback server; generated client HTTP/live-query operation paths; no injected delay',
      };
    },
  });
}

if (import.meta.main) {
  const result = await main();
  if (result.exitCode !== 0) process.exitCode = result.exitCode;
}
