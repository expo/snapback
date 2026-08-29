import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../', import.meta.url);
const milestones = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8'];
const assertions = JSON.parse(readFileSync(new URL('../instrument/schema/social-messenger/assertions.json', import.meta.url), 'utf8'));

const readJson = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const readJsonLines = (path) => readFileSync(new URL(path, root), 'utf8').trim().split('\n').map((line) => JSON.parse(line));

test('every in-scope suite-required assertion has passing typed evidence', () => {
  for (const milestone of milestones) {
    const receipt = readJson(`receipts/suite-${milestone}.json`);
    const expected = assertions.milestones[milestone.toUpperCase()].assertions
      .filter((row) => row.executor === 'suite-required')
      .map((row) => row.id)
      .sort();
    assert.equal(receipt.schemaVersion, 'clique.suite-receipt.v2');
    assert.equal(receipt.pass, true, milestone);
    assert.equal(receipt.coverage.complete, true, milestone);
    assert.deepEqual([...receipt.coverage.observedAssertionIds].sort(), expected, milestone);
    assert(receipt.checks.every((check) => check.pass), milestone);
  }
});

test('every in-scope frozen choreography has a final green summary', () => {
  for (const milestone of milestones) {
    const rows = readJsonLines(`receipts/choreography-${milestone}.jsonl`);
    const summary = rows.findLast((row) => row.type === 'segment-summary');
    assert(summary, `${milestone} summary`);
    assert.equal(summary.green, true, milestone);
    assert.equal(summary.suite.pass, true, milestone);
    assert.equal(summary.choreography.pass, true, milestone);
    assert.equal(summary.nonGreenCause, null, milestone);
  }
});

test('starter and sample replay receipts are complete', () => {
  const starter = readJson('receipts/replay.json');
  const sample = readJson('receipts/replay-sample-50.json');
  assert.equal(starter.ok, true);
  assert.equal(starter.actionCount, 87);
  assert.equal(sample.ok, true);
  assert.equal(sample.actionCount, 50);
  assert.equal(new Set(sample.actions.map((row) => row.action)).size, 13);
});
