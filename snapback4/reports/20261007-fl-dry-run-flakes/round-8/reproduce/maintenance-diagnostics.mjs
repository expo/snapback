import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runFile, fileStallTimeout } from '../../../../scripts/run-client-tests.mjs';
const file = `packages/snapback4/test/.fl-r8-diagnostic-control-${process.pid}.test.mjs`;
let source = fs.readFileSync('packages/snapback4/test/export-background.test.mjs', 'utf8');
assert.ok(source.includes('MAINTENANCE_SNAPSHOT'));
source = source.replace("'coalesced maintenance queue drained',90000)", "'coalesced maintenance queue drained',allowParked ? 90000 : 1)");
source += `
test('maintenance timeout preserves the failure and captured owned state', async()=>{
 const f=fixture();let held;
 try {
  skipMode(f,'off');held=await holdRetention(f);
  const result=f.invoke();assert.equal(result.status,0,result.stdout+result.stderr);
  let failure;
  await assert.rejects(()=>maintenanceIdle(f),error=>{failure=error;return /coalesced maintenance queue drained/.test(error.message)});
  assert.equal(failure.code,'ERR_ASSERTION');assert.equal(failure.actual,false);assert.equal(failure.expected,true);
  const snapshot=JSON.parse(failure.message.split('\\nMAINTENANCE_SNAPSHOT ')[1]);
  assert.equal(snapshot.records.request.state,'pending');
  assert.equal(snapshot.processes.next.verified.pid,snapshot.records.next.process.pid);
  assert.equal(snapshot.processes.next.verified.argv[0],f.env.SNAPBACK4_BIN);
  assert.equal(typeof snapshot.log,'string');
 } finally {if(held){held.child.stdin.end();await held.exited;}await cleanup(f);}
});`;
fs.writeFileSync(file, source);
try {
  const result = await runFile(file, { timeout: fileStallTimeout('export-background.test.mjs'), nodeArgs: ['--test-name-pattern=maintenance timeout preserves'] });
  assert.equal(result.passed, true, JSON.stringify(result)); assert.equal(result.counts.pass, 1);
  console.log(JSON.stringify(result));
} finally { fs.rmSync(file); }
