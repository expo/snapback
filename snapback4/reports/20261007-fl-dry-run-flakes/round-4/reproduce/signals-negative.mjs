// Deliberately remove dispatch validation in a private helper copy. Both
// regressions intercept process.kill before exercising it: no stale PID or
// process group can be signalled even if the mutation escapes every guard.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const root = process.cwd(), evidence = 'reports/20261007-fl-dry-run-flakes/round-4/evidence';
const original = fs.readFileSync('scripts/test-signals.mjs', 'utf8');
const needle = '  checkSignalRecord(record, argv);';
assert.equal(original.split(needle).length, 2);
const mutant = path.join(root, 'target/fl-verification/r4-unguarded-signals.mjs');
fs.writeFileSync(mutant, original.replace(needle, '').replace("new URL('./test-process-identity.c', import.meta.url).pathname", JSON.stringify(path.join(root, 'scripts/test-process-identity.c'))));
const results = [];
for (const [name, pattern, failure] of [
  ['test-processes.test.mjs', 'every external test signal', /Missing expected exception/],
  ['export-background.test.mjs', 'expired checkpoint refuses signal after 22-second dispatch delay', /UNSAFE_STALE_DISPATCH/],
]) {
  const source = fs.readFileSync('packages/snapback4/test/' + name, 'utf8').replace("'../../../scripts/test-signals.mjs'", JSON.stringify(pathToFileURL(mutant).href));
  const file = path.join(root, 'packages/snapback4/test/.fl-r4-negative-' + name);
  fs.writeFileSync(file, source);
  let output = '';
  try {
    const result = await runFile(file, { nodeArgs: ['--test-name-pattern=' + pattern], onOutput: text => { output += text; process.stdout.write(text); } });
    assert.equal(result.passed, false); assert.equal(result.counts.fail, 1);
    assert.equal(result.reason, undefined); assert.equal(result.inspectionFailure, undefined);
    assert.match(output, failure);
    results.push({ name, result });
  } finally { fs.rmSync(file); }
}
fs.writeFileSync(path.join(evidence, 'signals-negative-summary.json'), JSON.stringify(results, null, 2) + '\n');
console.log('EXPECTED FAILURES: stale/invalid dispatch rejected by regressions; intercepted kernel dispatch; no runner leaks');
