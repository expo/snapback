// Regression for the acceptance-runner teardown boundary: a passing check run
// is still a failure when asynchronous cleanup rejects. The subprocess is
// deliberate because runAcceptance owns the process exit code and final
// machine-readable report.

import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { createSuite, runAcceptance } from '../harness.mjs';

if (process.argv[2] === '--cleanup-fixture') {
  const suite = createSuite('harness cleanup rejection fixture', { expectedChecks: 1 });
  const cleanups = [
    async function processTreeCleanup() {
      console.log('cleanup:process-tree');
      const error = new Error('leader exited but its descendant remained alive');
      error.code = 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED';
      error.cleanup = {
        term: { ok: true },
        leader: { ok: false, error: 'leader close not attested' },
      };
      throw error;
    },
    async function browserCleanup() {
      console.log('cleanup:browser');
      await Promise.resolve();
      throw new Error('browser cleanup rejected');
    },
    function newestCleanup() {
      console.log('cleanup:newest');
    },
  ];

  await runAcceptance(
    suite,
    async () => {
      await suite.check('the body passes', () => ({ body: 'passed' }));
    },
    {
      cleanups,
      // Extra report fields are extensions, not an escape hatch for masking
      // the runner's final outcome.
      reportExtra: {
        fixture: 'strict-cleanup',
        ok: true,
        cleanupErrorCount: 0,
        cleanupErrors: [],
      },
    },
  );
} else if (process.argv[2] === '--null-setup-fixture') {
  const suite = createSuite('harness null setup failure fixture', { expectedChecks: 1 });
  await runAcceptance(suite, async () => {
    throw null;
  });
} else {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--cleanup-fixture'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 1024 * 1024,
  });

  assert.equal(result.error, undefined, `fixture failed to launch: ${result.error?.stack ?? result.error}`);
  assert.equal(result.signal, null, `fixture was killed by ${result.signal}: ${result.stderr}`);
  assert.equal(result.status, 2, `cleanup rejection must use the setup/teardown failure exit: ${result.stderr}`);

  const newestAt = result.stdout.indexOf('cleanup:newest');
  const browserAt = result.stdout.indexOf('cleanup:browser');
  const processTreeAt = result.stdout.indexOf('cleanup:process-tree');
  assert(newestAt >= 0 && browserAt > newestAt && processTreeAt > browserAt,
    `cleanups did not all run in reverse registration order:\n${result.stdout}`);

  const reportMarkerOffset = result.stdout.lastIndexOf('--- machine-readable report ---');
  assert(reportMarkerOffset > processTreeAt, 'machine report must be emitted after cleanup output');
  const lines = result.stdout.trimEnd().split('\n');
  const reportMarker = lines.lastIndexOf('--- machine-readable report ---');
  assert.equal(reportMarker, lines.length - 2, `machine report is not the final stdout record:\n${result.stdout}`);
  const report = JSON.parse(lines[reportMarker + 1]);

  assert.equal(report.fixture, 'strict-cleanup');
  assert.equal(report.ok, false, 'reportExtra must not mask cleanup failure');
  assert.equal(report.passed, 1);
  assert.equal(report.total, 1);
  assert.equal(report.cleanupErrorCount, 2);
  assert.deepEqual(
    report.cleanupErrors.map(({ registrationIndex, cleanupOrder, name, code }) => ({
      registrationIndex,
      cleanupOrder,
      name,
      code,
    })),
    [
      {
        registrationIndex: 1,
        cleanupOrder: 1,
        name: 'browserCleanup',
        code: 'SNAPBACK_ACCEPTANCE_CLEANUP_FAILED',
      },
      {
        registrationIndex: 0,
        cleanupOrder: 2,
        name: 'processTreeCleanup',
        code: 'SNAPBACK_PROCESS_TREE_CLEANUP_FAILED',
      },
    ],
  );
  assert.match(report.cleanupErrors[0].stack, /browser cleanup rejected/);
  assert.deepEqual(report.cleanupErrors[1].details, {
    term: { ok: true },
    leader: { ok: false, error: 'leader close not attested' },
  });
  assert.match(result.stderr, /CLEANUP FAILURE harness cleanup rejection fixture \[SNAPBACK_ACCEPTANCE_CLEANUP_FAILED\]/);
  assert.match(result.stderr, /CLEANUP FAILURE harness cleanup rejection fixture \[SNAPBACK_PROCESS_TREE_CLEANUP_FAILED\]/);
  assert.match(result.stderr, /FAIL harness cleanup rejection fixture — 2 cleanup failures after 1\/1 checks/);

  const nullResult = spawnSync(
    process.execPath,
    [fileURLToPath(import.meta.url), '--null-setup-fixture'],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.equal(nullResult.error, undefined, `null fixture failed to launch: ${nullResult.error?.stack ?? nullResult.error}`);
  assert.equal(nullResult.signal, null, `null fixture was killed by ${nullResult.signal}: ${nullResult.stderr}`);
  assert.equal(nullResult.status, 2, `throw null must use the setup/teardown failure exit: ${nullResult.stderr}`);
  const nullLines = nullResult.stdout.trimEnd().split('\n');
  const nullReportMarker = nullLines.lastIndexOf('--- machine-readable report ---');
  assert.equal(nullReportMarker, nullLines.length - 2, 'null fixture machine report must be final');
  const nullReport = JSON.parse(nullLines[nullReportMarker + 1]);
  assert.equal(nullReport.ok, false);
  assert.equal(nullReport.setupError, 'null');
  assert.match(nullResult.stderr, /SETUP FAILURE before checks completed: null/);

  console.log('PASS harness cleanup rejection regression');
}
