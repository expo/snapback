// Compare the unrelated client refusal with the pre-round-9 fixture helper.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fixtureCommand } from '../../../../packages/snapback4/test/helpers/fixture-command.mjs';
const old = file => execFileSync('git', ['show', `dcd5d06707:snapback4/${file}`], { encoding: 'utf8' });
const signal = `scripts/.fl-r9-avatar-signals-${process.pid}.mjs`;
const helper = `packages/snapback4/test/helpers/.fl-r9-avatar-${process.pid}.mjs`;
const file = `packages/snapback4/test/.fl-r9-avatar-${process.pid}.test.mjs`;
fs.writeFileSync(signal, old('scripts/test-signals.mjs'));
fs.writeFileSync(helper, old('packages/snapback4/test/helpers/avatar-fixture.mjs').replace('../../../../scripts/test-signals.mjs', `../../../../${signal}`));
fs.writeFileSync(file, fs.readFileSync('packages/snapback4/test/asset-avatars.test.mjs', 'utf8').replace('./helpers/avatar-fixture.mjs', `./helpers/${helper.split('/').at(-1)}`));
try {
  const result = await fixtureCommand(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=^Expo conversion refusal keeps the local client online', file], {
    label: 'round-8 avatar fixture baseline', timeout: 120000,
  });
  console.log(result.stdout + result.stderr);
  assert.equal(result.status, 1); assert.equal(result.signal, null);
  assert.match(result.stdout, /# fail 6\n/);
  assert.equal((result.stdout.match(/actual: 'E_OFFLINE'/g) ?? []).length, 6);
  assert.equal((result.stdout.match(/expected: 'E_CLIENT'/g) ?? []).length, 6);
  assert.equal(result.cleanupError, undefined);
  console.log(JSON.stringify({ baseline: 'dcd5d06707', reproduced: 6, groupDrained: true }));
} finally { for (const name of [file, helper, signal]) fs.rmSync(name); }
