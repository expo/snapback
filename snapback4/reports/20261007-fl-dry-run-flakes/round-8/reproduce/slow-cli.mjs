// Every real CLI startup is deliberately slower than the old 10-second bound.
// Both implementations still run their own original verdict/count assertions.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runFile } from '../../../../scripts/run-client-tests.mjs';
const sb4 = fileURLToPath(new URL('../../../../', import.meta.url));
const dir = fs.mkdtempSync(path.join(sb4, 'target/fl-r8-slow-'));
const preload = path.join(dir, 'startup.cjs');
const oldFile = path.join(sb4, `packages/snapback4/test/.fl-r8-old-cli-${process.pid}.test.mjs`);
fs.writeFileSync(preload, `if(process.argv[1]===${JSON.stringify(path.join(sb4, 'scripts/run-client-tests.mjs'))})Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,12000);`);
const options = { nodeArgs: ['--test-name-pattern=real runner CLI'], env: { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--require=' + preload].filter(Boolean).join(' ') } };
try {
  const current = await runFile('packages/snapback4/test/test-processes.test.mjs', options);
  assert.equal(current.passed, true, JSON.stringify(current));
  assert.equal(current.counts.pass, 1);
  fs.writeFileSync(oldFile, execFileSync('git', ['show', '2797247960:snapback4/packages/snapback4/test/test-processes.test.mjs'], { cwd: sb4 }));
  let output = '';
  const old = await runFile(oldFile, { ...options, onOutput: text => { output += text; process.stdout.write(text); } });
  assert.equal(old.passed, false); assert.equal(old.counts.fail, 1);
  assert.match(output, /ETIMEDOUT/);
  assert.equal(old.reason, undefined, 'old bound fails its assertion, not file cleanup');
  assert.equal(old.inspectionFailure, undefined);
  console.log(JSON.stringify({ startupDelayMs: 12000, currentPassed: true, oldFailedAtTimeout: true }));
} finally { fs.rmSync(oldFile, { force: true }); fs.rmSync(dir, { recursive: true, force: true }); }
