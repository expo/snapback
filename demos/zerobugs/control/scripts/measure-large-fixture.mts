import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

import {
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

const {receipt, receiptDigest, shardsByTable} = await verifyLargeFixtureShards(fixtureRoot);

async function maximumRowsPerIssue(table: 'comment' | 'issueLabel') {
  const counts = new Map<string, number>();
  let rows = 0;
  for await (const row of readCsvTable(shardsByTable[table], table)) {
    rows += 1;
    counts.set(row.issueID, (counts.get(row.issueID) ?? 0) + 1);
  }
  let maximum = 0;
  for (const count of counts.values()) maximum = Math.max(maximum, count);
  const issueIDsAtMaximum = [...counts]
    .filter(([, count]) => count === maximum)
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
  };
}

const [comments, labels] = await Promise.all([
  maximumRowsPerIssue('comment'),
  maximumRowsPerIssue('issueLabel'),
]);
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
  shardDigestVerification: {
    expected: Object.keys(receipt.shards).length,
    exactMatches: Object.keys(receipt.shards).length,
    mismatches: 0,
  },
  maxima: {commentsPerIssue: comments, labelsPerIssue: labels},
}, null, 2)}\n`);
