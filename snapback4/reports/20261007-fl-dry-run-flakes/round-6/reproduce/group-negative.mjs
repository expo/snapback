// Restore round 5's leaf-only compiler cleanup. The regression must observe
// its live frontend before invoking the fixture's private release protocol.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const dir = path.resolve('target/fl-verification/r6-leaf-compiler');
fs.mkdirSync(dir, { recursive: true });
const leaf = path.join(dir, 'test-owned-command.mjs');
fs.writeFileSync(leaf, execFileSync('git', ['show', 'c8c6d49420:snapback4/scripts/test-owned-command.mjs'], { timeout: 10000, killSignal: 'SIGKILL' }));
const source = fs.readFileSync('packages/snapback4/test/test-command-group.test.mjs', 'utf8')
  .replace("new URL('../../../scripts/test-owned-command.mjs', import.meta.url).href", JSON.stringify(pathToFileURL(leaf).href));
const file = path.resolve('packages/snapback4/test/.fl-r6-leaf-compiler.test.mjs');
fs.writeFileSync(file, source);
let output = '';
try {
  const result = await runFile(file, { nodeArgs: ['--test-name-pattern=compiler timeout drains'], onOutput: text => { output += text; process.stdout.write(text); } });
  assert.equal(result.passed, false); assert.equal(result.counts.fail, 2);
  assert.equal(result.reason, undefined); assert.equal(result.inspectionFailure, undefined);
  assert.equal((output.match(/frontend must be gone before the runner returns/g) ?? []).length, 2);
  assert.doesNotMatch(output, /private release must drain|TEST_FILE_LEAK/);
  fs.writeFileSync('reports/20261007-fl-dry-run-flakes/round-6/evidence/group-negative-summary.json', JSON.stringify(result, null, 2) + '\n');
  console.log('EXPECTED FAILURES: both surviving frontends rejected before private release; no runner leaks');
} finally { fs.rmSync(file); }
