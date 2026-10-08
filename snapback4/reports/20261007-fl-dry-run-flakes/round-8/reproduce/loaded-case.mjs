import assert from 'node:assert/strict';
import { runFile } from '../../../../scripts/run-client-tests.mjs';

const groups = {
  background: ['export-background', undefined, 63, 32],
  processes: ['test-processes', 'real runner CLI|a ps taking over two seconds', 3, 0],
  parity: ['test-file-runner', 'Node failure semantics|cancelled test cannot pass|native node --test parity|a test killing its own group|stall bounds cover', 11, 0],
  signals: ['test-signals', 'self-directed cleanup loads synchronously', 1, 0],
  failure: ['export-failure', undefined, 2, 0],
};
for (const key of process.argv.slice(2)) {
  const [file, pattern, passes, skips] = groups[key];
  const result = await runFile(`packages/snapback4/test/${file}.test.mjs`, { nodeArgs: pattern ? ['--test-name-pattern=' + pattern] : [] });
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.equal(result.counts.pass, passes, JSON.stringify(result.counts));
  assert.equal(result.counts.skipped, skips);
  assert.equal(result.counts.fail, 0);
  console.log('LOAD_RESULT ' + JSON.stringify({ key, ...result, file: file + '.test.mjs' }));
}
