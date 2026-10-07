// Safe controls: the regression intercepts numeric signals and releases each
// native stand-in through its retained stdin pipe, including on assertion failure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runOwnedCommand } from '../../../../scripts/test-owned-command.mjs';

const sb4 = fileURLToPath(new URL('../../../../', import.meta.url));
const tests = path.join(sb4, 'packages/snapback4/test');
const output = fileURLToPath(new URL('../evidence/', import.meta.url));
const dir = fs.mkdtempSync(path.join(sb4, 'target/fl-r7-control-'));
const helper = path.join(dir, 'fixture-signals.mjs');
const testFile = path.join(tests, `.fl-r7-${process.pid}.test.mjs`);
const source = fs.readFileSync(path.join(tests, 'helpers/fixture-signals.mjs'), 'utf8')
  .replace("'../../../../scripts/test-signals.mjs'", JSON.stringify(pathToFileURL(path.join(sb4, 'scripts/test-signals.mjs')).href));
const testSource = fs.readFileSync(path.join(tests, 'test-signals.test.mjs'), 'utf8')
  .replace("'./helpers/fixture-signals.mjs'", JSON.stringify(pathToFileURL(helper).href));
const summary = [];
try {
  fs.writeFileSync(testFile, testSource);
  for (const [name, mutated] of [
    ['original-binary', source.replace('fixtureCommands(f.env.SNAPBACK4_BIN, f.root)', `fixtureCommands(${JSON.stringify(fs.realpathSync(path.join(sb4, 'target/debug/snapback4')))}, f.root)`) ],
    ['normalize-expectations', "import fs from 'node:fs';\n" + source.replace('export function fixtureCommands(binary, project) {', 'export function fixtureCommands(binary, project) {\n  binary = fs.realpathSync(binary); project = fs.realpathSync(project);')],
  ]) {
    assert.notEqual(mutated, source, 'mutation applied');
    fs.writeFileSync(helper, mutated);
    const result = await runOwnedCommand(process.execPath, ['--test', '--test-name-pattern=fixture signals bind', testFile], { timeout: 60000 });
    const log = result.stdout.toString() + result.stderr.toString();
    fs.writeFileSync(path.join(output, name + '-negative.log'), log);
    assert.equal(result.error, undefined); assert.equal(result.cleanupError, undefined);
    assert.equal(result.status, 1, log);
    assert.match(log, name === 'original-binary' ? /expected fixture command required/ : /Missing expected exception/);
    assert.match(log, /fail 1/);
    summary.push({ name, status: result.status, expectedFailure: true, groupDrained: true });
  }
} finally {
  fs.rmSync(testFile, { force: true });
  fs.rmSync(dir, { recursive: true, force: true });
}
fs.writeFileSync(path.join(output, 'fixture-negative-summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify(summary));
