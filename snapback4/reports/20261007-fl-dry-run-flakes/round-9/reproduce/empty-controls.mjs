import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fixtureCommand } from '../../../../packages/snapback4/test/helpers/fixture-command.mjs';

assert.equal(process.platform, 'linux');
const original = fs.readFileSync('scripts/test-signals.mjs', 'utf8');
const processes = fs.readFileSync('scripts/test-processes.mjs', 'utf8');
const tests = fs.readFileSync('packages/snapback4/test/test-signals.test.mjs', 'utf8');
const wait = '      await sleep(10, undefined, { signal });';
assert.equal(original.split(wait).length, 2);
const mutations = [
  ['blocking', original.replace(wait, '      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);').replace('performance.now() + 120000', 'performance.now() + 5500'),
    'persistent empty cmdline', /sibling timers ran during capture/],
  ['no-wait', original.replace(wait, '      throw error;'),
    'newborn command capture after empty exec state: none', /no captured child birth: .*incomplete process command/],
  ['no-birth', original.replaceAll('if (start !== undefined) sameBirth(record.start, start);', '').replace('if (start !== undefined) sameBirth(error.record.start, start);\n      else start = error.record.start;', 'start = error.record.start;'),
    'newborn command capture after empty exec state: different birth', /did not match the regular expression/],
  ['no-parent', original.replaceAll(/      if \((?:error\.)?record\.parent !== process\.pid\) throw refusal\([^\n]+\);\n/g, ''),
    'newborn command capture after empty exec state: different parent', /Missing expected rejection/],
];
for (const [label, source, pattern, diagnostic] of mutations) {
  assert.notEqual(source, original);
  const helper = `.fl-r9-${label}-${process.pid}.mjs`, transport = `.fl-r9-processes-${label}-${process.pid}.mjs`;
  const file = `packages/snapback4/test/.fl-r9-${label}-${process.pid}.test.mjs`;
  fs.writeFileSync(`scripts/${helper}`, source);
  fs.writeFileSync(`scripts/${transport}`, processes.replace('./test-signals.mjs', `./${helper}`));
  fs.writeFileSync(file, tests.replaceAll('../../../scripts/test-signals.mjs', `../../../scripts/${helper}`)
    .replaceAll('../../../scripts/test-processes.mjs', `../../../scripts/${transport}`));
  try {
    const result = await fixtureCommand(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=${pattern}`, file], {
      timeout: 30000, label: `empty-capture ${label} control`,
    });
    assert.equal(result.status, 1); assert.equal(result.signal, null);
    assert.match(result.stdout + result.stderr, diagnostic);
    assert.match(result.stdout, /# fail 1\n/);
    assert.equal(result.cleanupError, undefined);
    console.log(result.stdout + result.stderr);
    console.log(JSON.stringify({ label, expectedFailure: true, groupDrained: true }));
  } finally {
    for (const name of [file, `scripts/${helper}`, `scripts/${transport}`]) fs.rmSync(name);
  }
}
