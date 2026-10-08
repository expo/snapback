import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fixtureCommand } from '../../../../packages/snapback4/test/helpers/fixture-command.mjs';

assert.equal(process.platform, 'linux', 'these controls inject Linux /proc observations');
const current = fs.readFileSync('scripts/test-signals.mjs', 'utf8');
const tests = fs.readFileSync('packages/snapback4/test/test-signals.test.mjs', 'utf8');
const old = execFileSync('git', ['show', '2797247960:snapback4/scripts/test-signals.mjs'], { encoding: 'utf8' });
const unbound = current.replace('      if (start !== undefined) sameBirth(record.start, start);\n', '');
assert.notEqual(current, unbound);
for (const [label, helper, name, diagnostic] of [
  ['old', old, 'none', /no captured child birth: .*incomplete process command/],
  ['unbound', unbound, 'different birth', /did not match the regular expression/],
]) {
  const helperName = `.fl-r8-${label}-${process.pid}.mjs`, file = `packages/snapback4/test/.fl-r8-${label}-${process.pid}.test.mjs`;
  fs.writeFileSync(`scripts/${helperName}`, helper);
  fs.writeFileSync(file, tests.replaceAll('../../../scripts/test-signals.mjs', `../../../scripts/${helperName}`));
  try {
    const result = await fixtureCommand(process.execPath, ['--test', '--test-reporter=tap', `--test-name-pattern=newborn command capture after empty exec state: ${name}`, file], { label: `exec capture ${label} mutation` });
    assert.equal(result.status, 1); assert.equal(result.signal, null);
    assert.match(result.stdout + result.stderr, diagnostic);
    console.log(result.stdout + result.stderr);
    console.log(JSON.stringify({ label, expectedFailure: true, groupDrained: result.cleanupError === undefined }));
  } finally { fs.rmSync(file); fs.rmSync(`scripts/${helperName}`); }
}
