import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';

import { runTinyDataEvaluationBackstop } from './tiny-data-evaluation-backstop.mjs';

const repositoryRoot = new URL('..', import.meta.url).pathname;
const evaluationRoot = 'benchmarks/tiny-data-surface/v1';
const publishedAt = '2026-01-01T00:00:00.000Z';
const stopAt = '2026-04-01T00:00:00.000Z';

const writeJson = (root, path, value) => {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, `${JSON.stringify(value, null, 2)}\n`);
};

function fixture({ receipt = true, rounds = [] } = {}) {
  const root = mkdtempSync(join(os.tmpdir(), 'snapback-data-d10-'));
  for (const path of [
    'packages/snapback-umbrella/package.json',
    'packages/snapback-client/package.json',
    'packages/snapback-react/package.json',
    'packages/snapback-expo/package.json',
    `${evaluationRoot}/preregistration/experimental-doorways.v1.json`,
  ]) {
    const destination = join(root, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(repositoryRoot, path), destination);
  }
  if (receipt) {
    writeJson(root, `${evaluationRoot}/clock/publication-receipt.v1.json`, {
      schemaVersion: 'snapback.tiny-data-publication-clock.v1',
      publicationIdentity: 'npm:@expo/snapback@0.1.0-test',
      closureDigest: 'sha256:phase4-fixture',
      publishedAt,
      stopAt,
      amendments: [],
    });
  }
  if (rounds.length > 0) {
    writeJson(root, `${evaluationRoot}/raw-record-index.v1.json`, {
      schemaVersion: 'snapback.tiny-data-raw-record-index.v1',
      rounds,
    });
  }
  return root;
}

const issues = (root) => {
  const path = join(root, 'issues');
  try {
    return readdirSync(path).filter((name) => name.endsWith('.md')).sort();
  } catch {
    return [];
  }
};

const fileDigest = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const frozenDigests = (root) => [
  'packages/snapback-umbrella/package.json',
  'packages/snapback-client/package.json',
  'packages/snapback-react/package.json',
  'packages/snapback-expo/package.json',
  `${evaluationRoot}/preregistration/experimental-doorways.v1.json`,
].map((path) => [path, fileDigest(join(root, path))]);

test('D10 is silent before the clock exists and before either boundary', () => {
  const unarmed = fixture({ receipt: false });
  assert.equal(runTinyDataEvaluationBackstop({ root: unarmed, now: publishedAt }), 0);
  assert.deepEqual(issues(unarmed), []);

  const active = fixture();
  assert.equal(runTinyDataEvaluationBackstop({ root: active, now: '2026-03-31T23:59:59.999Z' }), 0);
  assert.deepEqual(issues(active), []);
});

test('the two-hour drift backstop path invokes the D10 control', () => {
  const source = readFileSync(join(repositoryRoot, 'scripts/drift-prone-gates.mjs'), 'utf8');
  assert.match(source, /import \{ runTinyDataEvaluationBackstop \} from '\.\/tiny-data-evaluation-backstop\.mjs';/u);
  assert.match(source, /const dataSurfaceResult = runTinyDataEvaluationBackstop\(\{ root, issuesDir, env \}\);/u);
});

test('D10 triggers at the date boundary, changes no doorway, and is idempotent', () => {
  const root = fixture();
  const before = frozenDigests(root);
  const env = { SNAPBACK_DATA_D10_TICKET_DATE: '2026-04-01' };
  assert.equal(runTinyDataEvaluationBackstop({ root, now: stopAt, env }), 1);
  assert.deepEqual(issues(root), ['20260401-tiny-data-surface-d10-disposition.md']);
  assert.deepEqual(frozenDigests(root), before);
  const ticket = readFileSync(join(root, 'issues', issues(root)[0]), 'utf8');
  for (const choice of ['promote', 'continue', 'revise', 'fold', 'withdraw']) {
    assert.ok(ticket.includes(`\`${choice}\``));
  }
  assert.equal(runTinyDataEvaluationBackstop({ root, now: stopAt, env }), 1);
  assert.deepEqual(issues(root), ['20260401-tiny-data-surface-d10-disposition.md']);
});

test('D10 triggers at the earlier third-complete-round boundary', () => {
  const rounds = [1, 2, 3].map((sequence) => ({
    roundId: `round-${sequence}`,
    configurationVersion: 'v1',
    complete: true,
    qualified: true,
    completedAt: `2026-02-0${sequence}T00:00:00.000Z`,
  }));
  const root = fixture({ rounds });
  assert.equal(runTinyDataEvaluationBackstop({
    root,
    now: '2026-02-03T00:00:00.000Z',
    env: { SNAPBACK_DATA_D10_TICKET_DATE: '2026-02-03' },
  }), 1);
  assert.equal(issues(root).length, 1);
});

test('a timely disposition suppresses the boundary ticket', () => {
  const root = fixture();
  writeJson(root, `${evaluationRoot}/rulings/d10-disposition.v1.json`, {
    schemaVersion: 'snapback.tiny-data-d10-disposition.v1',
    author: 'Charlie Cheever',
    ruling: 'continue',
    commit: '0123456789abcdef',
    recordedAt: '2026-03-31T00:00:00.000Z',
  });
  assert.equal(runTinyDataEvaluationBackstop({ root, now: stopAt }), 0);
  assert.deepEqual(issues(root), []);
});

test('a ruling recorded at rather than before the stop is not timely', () => {
  const root = fixture();
  writeJson(root, `${evaluationRoot}/rulings/d10-disposition.v1.json`, {
    schemaVersion: 'snapback.tiny-data-d10-disposition.v1',
    author: 'Charlie Cheever',
    ruling: 'continue',
    commit: '0123456789abcdef',
    recordedAt: stopAt,
  });
  assert.equal(runTinyDataEvaluationBackstop({
    root,
    now: stopAt,
    env: { SNAPBACK_DATA_D10_TICKET_DATE: '2026-04-01' },
  }), 1);
  assert.equal(issues(root).length, 1);
});

test('only a prospective Charlie Cheever amendment extends the active stop', () => {
  const root = fixture();
  const receiptPath = join(root, evaluationRoot, 'clock/publication-receipt.v1.json');
  const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
  receipt.amendments.push({
    author: 'Charlie Cheever',
    commit: 'fedcba9876543210',
    reason: 'Named current-version evidence remains incomplete.',
    eligibleConfigurationVersions: ['v1'],
    recordedAt: '2026-03-15T00:00:00.000Z',
    newStopAt: '2026-04-15T00:00:00.000Z',
  });
  writeJson(root, relative(root, receiptPath), receipt);
  assert.equal(runTinyDataEvaluationBackstop({ root, now: stopAt }), 0);
  assert.equal(runTinyDataEvaluationBackstop({
    root,
    now: '2026-04-15T00:00:00.000Z',
    env: { SNAPBACK_DATA_D10_TICKET_DATE: '2026-04-15' },
  }), 1);
});

test('malformed receipts fail closed without staging an issue', () => {
  const root = fixture();
  const path = `${evaluationRoot}/clock/publication-receipt.v1.json`;
  const receipt = JSON.parse(readFileSync(join(root, path), 'utf8'));
  receipt.unfrozenField = true;
  writeJson(root, path, receipt);
  assert.equal(runTinyDataEvaluationBackstop({ root, now: stopAt }), 2);
  assert.deepEqual(issues(root), []);
});

test('freeze violations fail closed while staging only the disposition issue', () => {
  const root = fixture();
  const umbrellaPath = join(root, 'packages/snapback-umbrella/package.json');
  const umbrella = JSON.parse(readFileSync(umbrellaPath, 'utf8'));
  umbrella.snapback.maturity = 'GeneralAvailability';
  writeJson(root, 'packages/snapback-umbrella/package.json', umbrella);
  const before = frozenDigests(root);
  assert.equal(runTinyDataEvaluationBackstop({
    root,
    now: stopAt,
    env: { SNAPBACK_DATA_D10_TICKET_DATE: '2026-04-01' },
  }), 2);
  assert.equal(issues(root).length, 1);
  assert.deepEqual(frozenDigests(root), before);
});
