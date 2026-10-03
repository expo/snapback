import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const binary=resolve(process.argv[2]);
const project=await mkdtemp(join(tmpdir(),'ct-doctor-'));
await mkdir(join(project,'snapback'));
await writeFile(join(project,'snapback/schema.q'),'use personas alice\nquery read():\n  return true\n');
let startup='passed: default or higher';
const server=createServer((req,res)=>{
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify(req.url==='/dev/status'?{project,storeId:'controlled',temporary:true,generation:1,scheduling:{qosFailures:2,startupReadback:startup,failures:{maintenance:{count:1,lastErrno:22,lastAtMs:123456},background:{count:1,lastErrno:1,lastAtMs:234567}}}}:{}));
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
try {
 for(startup of ['passed: default or higher','not performed']) {
  const result=await promisify(execFile)(binary,['doctor','--url',`http://127.0.0.1:${server.address().port}`],{cwd:project}).then(()=>{throw Error('doctor must report failure')},e=>e);
  assert.equal(result.code,1);
  assert.match(result.stdout,new RegExp('HTTP startup readback '+startup));
  assert.match(result.stdout,/maintenance: 1 failed setters; last errno 22 at Unix ms 123456/);
  assert.match(result.stdout,/background: 1 failed setters; last errno 1 at Unix ms 234567/);
  assert(!result.stdout.includes('HTTP inheritance is'));
  console.log(result.stdout.split('\n').filter(l=>l.includes('scheduling')).join('\n'));
 }
 console.log('doctor scoped failure/readback controls: 2 passed');
} finally { await new Promise(r=>server.close(r));await rm(project,{recursive:true}); }
