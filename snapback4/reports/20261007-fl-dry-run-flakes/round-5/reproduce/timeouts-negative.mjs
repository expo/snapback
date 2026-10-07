// Private source mutations; the regression fixtures have independent, private
// self-release protocols even when the timeout implementation is broken.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const root = process.cwd(), out = 'reports/20261007-fl-dry-run-flakes/round-5/evidence';
const url = name => pathToFileURL(path.join(root, name)).href;
const original = fs.readFileSync('packages/snapback4/test/test-signals.test.mjs', 'utf8');
const results = [];
for (const mode of ['interpreter', 'refused-cleanup', 'compiler-escalation']) {
  const dir = `target/fl-verification/r5-${mode}`;
  fs.mkdirSync(dir, { recursive: true });
  let signals = fs.readFileSync('scripts/test-signals.mjs', 'utf8');
  let owned = fs.readFileSync('scripts/test-owned-command.mjs', 'utf8');
  let processes = fs.readFileSync('scripts/test-processes.mjs', 'utf8');
  let pattern;
  if (mode === 'interpreter') {
    const needle = 'const argv = [child.spawnargs, record.argv];';
    assert.ok(signals.includes(needle)); signals = signals.replace(needle, 'const argv = [child.spawnargs];');
    pattern = 'tracked identity accepts shebang with';
  } else if (mode === 'refused-cleanup') {
    const needle = "error.cause = refused;\n        killOwned(child, 'SIGKILL');";
    assert.ok(processes.includes(needle)); processes = processes.replace(needle, 'error = refused; resolve({ error });');
    pattern = 'owned shebang timeout.*identity refusal=true';
  } else {
    const needle = 'escalation = setTimeout(kill, grace);';
    assert.ok(owned.includes(needle)); owned = owned.replace(needle, '// negative control: escalation removed');
    pattern = 'Darwin inspector compiler escalates';
  }
  // The copied helpers keep their own relative imports; Darwin's C input is
  // never actually compiled by this deliberately SIGTERM-handling fixture.
  fs.writeFileSync(`${dir}/test-signals.mjs`, signals);
  fs.writeFileSync(`${dir}/test-owned-command.mjs`, owned);
  fs.writeFileSync(`${dir}/test-processes.mjs`, processes);
  let source = original.replaceAll("'../../../scripts/test-signals.mjs'", JSON.stringify(url(`${dir}/test-signals.mjs`)))
    .replace("'../../../scripts/test-processes.mjs'", JSON.stringify(url(`${dir}/test-processes.mjs`)))
    .replace("new URL('../../../scripts/test-signals.mjs', import.meta.url).href", JSON.stringify(url(`${dir}/test-signals.mjs`)));
  // The regression's outer command bound and ownership refusal use the real
  // helper, so removing compiler escalation cannot remove its outer guard.
  const file = path.join(root, `packages/snapback4/test/.fl-r5-${mode}.test.mjs`);
  fs.writeFileSync(file, source);
  try {
    let output = '';
    const result = await runFile(file, { nodeArgs: ['--test-name-pattern=' + pattern], onOutput: text => { output += text; process.stdout.write(text); } });
    assert.equal(result.passed, false); assert.equal(result.counts.fail, 1);
    assert.equal(result.reason, undefined); assert.equal(result.inspectionFailure, undefined);
    assert.doesNotMatch(output, /TEST_FILE_LEAK|fixture state deadline/);
    assert.match(output, mode === 'interpreter' ? /TEST_SIGNAL_REFUSED/ : mode === 'refused-cleanup' ? /ETIMEDOUT/ : /compiler must be killed before its emergency self-release/);
    results.push({ mode, result });
  } finally { fs.rmSync(file); }
}
fs.writeFileSync(`${out}/timeouts-negative-summary.json`, JSON.stringify(results, null, 2) + '\n');
console.log('EXPECTED FAILURES: all three regressions reject their defect; private self-release reaps negative-control children');
