// Mutate private copies, never the running suite's source. Each copy runs only
// the fake-ps regression; it neither inspects nor signals another host process.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureCommand } from '../../../../packages/snapback4/test/helpers/fixture-command.mjs';

const sourcePath = fileURLToPath(new URL('../../../../packages/snapback4/test/export-background.test.mjs', import.meta.url));
const source = fs.readFileSync(sourcePath, 'utf8');
const evidence = fileURLToPath(new URL('../evidence/', import.meta.url));
const capacity = 'maxBuffer: 128 * 1024 * 1024,';
const status = '  assert.equal(result.status, 0, `complete process listing required: ${result.stderr}`);';
for (const needle of [capacity, status]) assert.equal(source.split(needle).length, 2, `unique mutation target: ${needle}`);
const controls = [
  ['default-buffer', source.replace(capacity, ''), /TEST_FIXTURE_COMMAND_FAILED: ps.*ENOBUFS/],
  ['silent-truncation', "import { spawnSync as uncheckedSpawnSync } from 'node:child_process';\n" + source
    .replace(capacity, '').replace(status, '')
    .replace("const result = spawnSync('ps', ['-axww'", "const result = uncheckedSpawnSync('ps', ['-axww'"), /Expected values to be strictly deep-equal/],
  ['failed-status-ignored', source.replace(status, ''), /Missing expected exception/],
];
fs.mkdirSync(evidence, { recursive: true });
for (const [name, mutated, expected] of controls) {
  const file = path.join(path.dirname(sourcePath), `export-background.fl-r10-${process.pid}-${name}.test.mjs`);
  try {
    fs.writeFileSync(file, mutated, { flag: 'wx' });
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = await fixtureCommand(process.execPath, ['--test', '--test-name-pattern=retention process listing', file], { env });
    const output = result.stdout + result.stderr;
    // Strip reporter padding on blank/diff lines, preserving diagnostic text.
    fs.writeFileSync(path.join(evidence, name + '.log'), output.replace(/[ \t]+$/gm, ''));
    assert.equal(result.status, 1, output);
    assert.equal(result.signal, null, output);
    assert.equal(result.cleanupError, undefined);
    assert.match(output, expected);
    console.log(JSON.stringify({ control: name, status: result.status, expectedFailure: true, groupDrained: true }));
  } finally { fs.rmSync(file, { force: true }); }
}
