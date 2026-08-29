import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const milestones = ['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm8'];
const end = Math.floor(Date.now() / 1000);
const assertions = JSON.parse(readFileSync('instrument/schema/social-messenger/assertions.json', 'utf8'));
const sha256 = (path) => `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const jsonLines = (path) => readFileSync(path, 'utf8').trim().split('\n').map((line) => JSON.parse(line));

const milestoneEvidence = [];
const assertionCoverage = [];

for (const milestone of milestones) {
  const suitePath = `receipts/suite-${milestone}.json`;
  const choreographyPath = `receipts/choreography-${milestone}.jsonl`;
  const observationsPath = `receipts/choreography-${milestone}.observations.jsonl`;
  const suite = json(suitePath);
  const summary = jsonLines(choreographyPath).findLast((row) => row.type === 'segment-summary');
  const directory = `receipts/${milestone}`;
  mkdirSync(directory, { recursive: true });
  copyFileSync(suitePath, `${directory}/suite.json`);
  copyFileSync(choreographyPath, `${directory}/choreography.jsonl`);
  copyFileSync(observationsPath, `${directory}/choreography.observations.jsonl`);
  const index = {
    schemaVersion: 'clique.milestone-evidence.v1',
    milestone: milestone.toUpperCase(),
    green: suite.pass === true && summary?.green === true,
    suite: { path: 'suite.json', sha256: sha256(`${directory}/suite.json`), assertions: suite.checks.length, pass: suite.pass },
    choreography: {
      path: 'choreography.jsonl', sha256: sha256(`${directory}/choreography.jsonl`),
      observations: 'choreography.observations.jsonl', observationsSha256: sha256(`${directory}/choreography.observations.jsonl`),
      assertions: summary.assertions, pass: summary.green,
    },
    end,
  };
  writeFileSync(`${directory}/index.json`, `${JSON.stringify(index, null, 2)}\n`);
  milestoneEvidence.push({
    milestone: milestone.toUpperCase(), green: index.green,
    suiteReceipt: `${directory}/suite.json`, suiteSha256: index.suite.sha256,
    choreographyReceipt: `${directory}/choreography.jsonl`, choreographySha256: index.choreography.sha256,
    observationReceipt: `${directory}/choreography.observations.jsonl`, observationSha256: index.choreography.observationsSha256,
  });
  const checks = new Map(suite.checks.map((row) => [row.id, row]));
  for (const assertion of assertions.milestones[milestone.toUpperCase()].assertions) {
    if (assertion.executor !== 'suite-required') continue;
    const check = checks.get(assertion.id);
    assertionCoverage.push({
      id: assertion.id,
      milestone: milestone.toUpperCase(),
      executor: assertion.executor,
      mappedTest: 'scripts/acceptance.mjs',
      receipt: `${directory}/suite.json`,
      status: check?.pass === true ? 'passed' : 'missing-or-failed',
      startedAtMs: check?.startedAt ?? null,
      completedAtMs: check?.completedAt ?? null,
    });
  }
}

const manifest = {
  schemaVersion: 'clique.coverage-manifest.v1',
  laneId: 'sol-explicit-0129-036-admitted2',
  instrument: { pin: 'social-messenger@0.3.6-m8', revision: 'eff33c5882fce03edfcd572fb1e0284344a3827d' },
  scope: { milestones: milestones.map((row) => row.toUpperCase()), m7: 'environment-null', platform: 'web-only' },
  summary: {
    suiteRequired: assertionCoverage.length,
    suitePassed: assertionCoverage.filter((row) => row.status === 'passed').length,
    milestoneGreen: milestoneEvidence.filter((row) => row.green).length,
    milestoneTotal: milestoneEvidence.length,
  },
  milestoneEvidence,
  assertionCoverage,
  replays: [
    { path: 'receipts/replay.json', sha256: sha256('receipts/replay.json'), actions: json('receipts/replay.json').actionCount, pass: json('receipts/replay.json').ok },
    { path: 'receipts/replay-sample-50.json', sha256: sha256('receipts/replay-sample-50.json'), actions: json('receipts/replay-sample-50.json').actionCount, pass: json('receipts/replay-sample-50.json').ok },
  ],
  verifyReceipt: { path: '.snapback/verify-receipt.json', sha256: sha256('.snapback/verify-receipt.json'), status: json('.snapback/verify-receipt.json').status },
  end,
};

writeFileSync('coverage-manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(manifest.summary)} end=${end}\n`);
