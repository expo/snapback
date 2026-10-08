import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { runFile, fileStallTimeout } from '../../../../scripts/run-client-tests.mjs';
const file = `packages/snapback4/test/.fl-r8-final-parity-${process.pid}.test.mjs`;
// During the first frozen load batch, prepare the one missed await in a private
// copy. On the committed tree these replacements are no-ops. The recorded hash
// must match the final real file before this counts as its loaded evidence.
const source = fs.readFileSync('packages/snapback4/test/test-file-runner.test.mjs', 'utf8')
  .replace("test('native buffered synchronous tests are bounded until Node delivers progress', { timeout: 20000 }", "test('native buffered synchronous tests are bounded until Node delivers progress', { timeout: fixtureTestMs(2) }")
  .replace('assert.equal(nativeTest(path).status, 0);', 'assert.equal((await nativeTest(path)).status, 0);')
  .replace("test('group cleanup reaps an unsampled orphan after its sampled parent exits', { timeout: 20000 }", "test('group cleanup reaps an unsampled orphan after its sampled parent exits', { timeout: fixtureTestMs(2) }")
  .replace("test('reaped keeper before its exit callback cannot make the runner send a signal', {timeout:20000}", "test('reaped keeper before its exit callback cannot make the runner send a signal', {timeout:fixtureTestMs(2)}")
  .replace("test('runner death closes the keeper pipe and kills its living group', {timeout:20000}", "test('runner death closes the keeper pipe and kills its living group', {timeout:fixtureTestMs(2)}")
  .replace('], {timeout:5000});', "], {timeout:${fixtureWorkMs},killSignal:'SIGKILL'});")
  .replaceAll('const deadline = performance.now() + 5000;', 'const deadline = performance.now() + fixtureWorkMs;')
  .replace("{ encoding: 'utf8', timeout: 2000 });", "{ encoding: 'utf8', timeout: 60000, killSignal: 'SIGKILL' });")
  .replace('AbortSignal.timeout(5000)', 'AbortSignal.timeout(fixtureWorkMs)')
  .replace('const deadline = performance.now()+5000;', 'let deadline = performance.now()+fixtureWorkMs;')
  .replace("runner.kill('SIGKILL'); await exited;\n  while", "runner.kill('SIGKILL'); await exited;\n  deadline = performance.now()+120000;\n  while");
fs.writeFileSync(file, source);
try {
const result = await runFile(file, {
  timeout: fileStallTimeout('test-file-runner.test.mjs'),
  nodeArgs: ['--test-name-pattern=Node failure semantics|cancelled test cannot pass|native node --test parity|a test killing its own group|stall bounds cover|native buffered synchronous|group cleanup reaps an unsampled|reaped keeper before|runner death closes'],
});
assert.equal(result.passed, true, JSON.stringify(result));
assert.equal(result.counts.pass, 15);
console.log('LOAD_RESULT ' + JSON.stringify({ ...result, candidateSha256: createHash('sha256').update(source).digest('hex') }));
const native = await runFile('packages/snapback4/test/export-native.test.mjs', {
  nodeArgs: ['--test-name-pattern=retention keeps five completed runs'],
});
assert.equal(native.passed, true, JSON.stringify(native));
assert.equal(native.counts.pass, 1);
console.log('LOAD_RESULT ' + JSON.stringify(native));
const publication = await runFile('packages/snapback4/test/export-publication.test.mjs');
assert.equal(publication.passed, true, JSON.stringify(publication));
assert.equal(publication.counts.pass, 6);
console.log('LOAD_RESULT ' + JSON.stringify(publication));
} finally { fs.rmSync(file, { force: true }); }
