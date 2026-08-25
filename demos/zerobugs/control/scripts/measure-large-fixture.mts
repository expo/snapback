import {createHash} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
  readAndVerifyOverlay,
  readCsvTable,
  verifyLargeFixtureShards,
} from './build-large-overlay.mts';

if (process.versions.node !== '24.18.0') {
  throw new Error(`measure-large-fixture requires Node 24.18.0, observed ${process.versions.node}`);
}

const fixtureRoot = resolve(
  process.env.ZBUGS_LARGE_FIXTURE_ROOT
    ?? fileURLToPath(new URL('../../fixtures-local/large-seed42-v1/', import.meta.url)),
);
const overlayPath = resolve(
  process.env.ZBUGS_LARGE_OVERLAY_PATH
    ?? fileURLToPath(new URL('../.snapback/large-fixture/large-overlay-v1.json', import.meta.url)),
);

const {receipt, receiptDigest, shardsByTable} = await verifyLargeFixtureShards(fixtureRoot);
const overlay = await readAndVerifyOverlay(overlayPath);
if (overlay.payload.fixtureId !== receipt.fixtureId
    || overlay.payload.sourceReceiptDigest !== receiptDigest
    || overlay.payload.sourceOverallDigest !== receipt.overallDigest) {
  throw new Error('large overlay identity does not bind the verified fixture receipt');
}
const expectedShards = Object.keys(receipt.shards).sort();
const actualShards = (await readdir(fixtureRoot))
  .filter(name => name.endsWith('.csv'))
  .sort();
if (JSON.stringify(actualShards) !== JSON.stringify(expectedShards)) {
  throw new Error(`CSV shard inventory mismatch: expected ${JSON.stringify(expectedShards)}, observed ${JSON.stringify(actualShards)}`);
}

async function maximumRowsPerIssue(table: 'comment' | 'issueLabel', selectedIssueIDs: Set<string>) {
  const counts = new Map<string, number>();
  const selectedCounts = new Map([...selectedIssueIDs].map(issueID => [issueID, 0]));
  let rows = 0;
  for await (const row of readCsvTable(shardsByTable[table], table)) {
    rows += 1;
    counts.set(row.issueID, (counts.get(row.issueID) ?? 0) + 1);
    if (selectedCounts.has(row.issueID)) {
      selectedCounts.set(row.issueID, (selectedCounts.get(row.issueID) ?? 0) + 1);
    }
  }
  let maximum = 0;
  for (const count of counts.values()) maximum = Math.max(maximum, count);
  const issueIDsAtMaximum = [...counts]
    .filter(([, count]) => count === maximum)
    .map(([issueID]) => issueID)
    .sort();
  let selectedMaximum = 0;
  for (const count of selectedCounts.values()) selectedMaximum = Math.max(selectedMaximum, count);
  const selectedIssueIDsAtMaximum = [...selectedCounts]
    .filter(([, count]) => count === selectedMaximum)
    .map(([issueID]) => issueID)
    .sort();
  return {
    rows,
    issueGroups: counts.size,
    maximum,
    issuesAtMaximum: issueIDsAtMaximum.length,
    issueIDsAtMaximumDigest: `sha256:${createHash('sha256').update(issueIDsAtMaximum.join('\n')).digest('hex')}`,
    issueIDsAtMaximumSample: issueIDsAtMaximum.slice(0, 16),
    ...(issueIDsAtMaximum.length <= 100 ? {issueIDsAtMaximum} : {}),
    selectedWorkingSet: {
      issues: selectedCounts.size,
      maximum: selectedMaximum,
      issuesAtMaximum: selectedIssueIDsAtMaximum.length,
      issueIDsAtMaximumSample: selectedIssueIDsAtMaximum.slice(0, 16),
      ...(selectedIssueIDsAtMaximum.length <= 100 ? {issueIDsAtMaximum: selectedIssueIDsAtMaximum} : {}),
      issueIDsAtMaximumDigest: `sha256:${createHash('sha256').update(selectedIssueIDsAtMaximum.join('\n')).digest('hex')}`,
    },
  };
}

async function characterizeIssueRows(commentMaximumIDs: string[]) {
  const wanted = new Set(commentMaximumIDs);
  const commentMaximumIssues: Array<{
    id: string;
    projectID: string;
    visibility: string;
  }> = [];
  const projectCounts = new Map<string, number>();
  for await (const row of readCsvTable(shardsByTable.issue, 'issue')) {
    projectCounts.set(row.projectID, (projectCounts.get(row.projectID) ?? 0) + 1);
    if (wanted.has(row.id)) {
      commentMaximumIssues.push({
        id: row.id,
        projectID: row.projectID,
        visibility: row.visibility,
      });
    }
  }
  commentMaximumIssues.sort((left, right) => left.id.localeCompare(right.id));
  let maximumIssues = 0;
  for (const count of projectCounts.values()) maximumIssues = Math.max(maximumIssues, count);
  const projectsAtMaximum = [...projectCounts]
    .filter(([, count]) => count === maximumIssues)
    .map(([projectID]) => projectID)
    .sort();
  return {
    commentMaximumIssues,
    largestProject: {
      maximumIssues,
      projectsAtMaximum,
      projectIDsAtMaximumDigest: `sha256:${createHash('sha256').update(projectsAtMaximum.join('\n')).digest('hex')}`,
    },
  };
}

const workingSetIssueIDs = new Set(overlay.payload.workingSet.issueIDs);
const [comments, labels] = await Promise.all([
  maximumRowsPerIssue('comment', workingSetIssueIDs),
  maximumRowsPerIssue('issueLabel', workingSetIssueIDs),
]);
const issueShape = await characterizeIssueRows(comments.issueIDsAtMaximum ?? []);
if (comments.rows !== receipt.counts.comment) {
  throw new Error(`comment count mismatch: ${comments.rows} != ${receipt.counts.comment}`);
}
if (labels.rows !== receipt.counts.issueLabel) {
  throw new Error(`issueLabel count mismatch: ${labels.rows} != ${receipt.counts.issueLabel}`);
}

process.stdout.write(`${JSON.stringify({
  format: 'zerobugs-large-fixture-measurement.v1',
  fixtureId: receipt.fixtureId,
  fixtureRoot,
  generator: {
    repository: 'https://github.com/rocicorp/mono',
    path: 'apps/zbugs/scripts/generate-synthetic.ts',
    pinCommit: '25c2c7308d3eb674d2d895022c9da11ef0c742fb',
    sha256: '770b93d43545d64edd5e855075caed31580244fd960eed209229ba2463e685e7',
  },
  receiptDigest,
  overallDigest: receipt.overallDigest,
  overlay: {
    path: overlayPath,
    contentDigest: overlay.contentDigest,
    workingSetIssueIDsDigest: overlay.payload.workingSet.issueIDsDigest,
  },
  shardDigestVerification: {
    expected: expectedShards.length,
    present: actualShards.length,
    exactMatches: expectedShards.length,
    missing: 0,
    unexpected: 0,
    mismatches: 0,
  },
  maxima: {commentsPerIssue: comments, labelsPerIssue: labels},
  issueShape,
}, null, 2)}\n`);
