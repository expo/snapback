import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { runFile, fileStallTimeout } from '../../../../scripts/run-client-tests.mjs';
const file = `packages/snapback4/test/.fl-r8-signals-${process.pid}.test.mjs`;
const source = fs.readFileSync('packages/snapback4/test/test-signals.test.mjs', 'utf8')
  .replace('test(`tracked identity accepts ${mode} with its exact interpreter argv`, { timeout: 20000 }', 'test(`tracked identity accepts ${mode} with its exact interpreter argv`, { timeout: fixtureTestMs() }')
  .replace("test('fixture signals bind every native command to the selected binary and exact root', { timeout: 120000 }", "test('fixture signals bind every native command to the selected binary and exact root', { timeout: fixtureTestMs() }")
  .replace("const built = await runOwnedCommand('cc', [original + '.c', '-o', original], { timeout: 30000 });", "const built = await fixtureCommand('cc', [original + '.c', '-o', original], { label: 'native copied-binary identity fixture' });");
fs.writeFileSync(file, source);
try {
  for (let round = 1; round <= 20; round++) {
    const result = await runFile(file, { timeout: fileStallTimeout('test-signals.test.mjs'), nodeArgs: ['--test-name-pattern=tracked identity accepts|fixture signals bind every'] });
    assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(result.counts.pass, 4);
    console.log('LOAD_RESULT ' + JSON.stringify({ round, ...result, candidateSha256: createHash('sha256').update(source).digest('hex') }));
  }
} finally { fs.rmSync(file, { force: true }); }
