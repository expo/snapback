import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createConnection} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {cli,startServe,waitForFresh} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..');
process.env.SNAPBACK4_BIN ??= join(root,'target/debug/snapback4');
function fixture(t,source='query alive():\n  return true\n') {
 const cwd=mkdtempSync(join(root,'target/surf4-'));mkdirSync(join(cwd,'snapback'));
 writeFileSync(join(cwd,'snapback/schema.q'),source);writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;
}
async function ok(args,cwd){const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r;}
async function until(read,label){const end=performance.now()+15000;while(performance.now()<end){const result=read();if(result)return result;await sleep(30);}assert.fail(label);}
const stopped=host=>new Promise(resolve=>{const socket=createConnection(new URL(host.url).port,'127.0.0.1');socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));socket.once('connect',()=>{socket.destroy();resolve(false)});});
test('serve canonical ready wait, active/working hashes and confirmed socket closure', {timeout:60000},async t=>{
 const cwd=fixture(t);await ok(['deploy','deployment'],cwd);
 writeFileSync(join(cwd,'snapback/schema.q'),'query changed():\n  return false\n');
 const host=await startServe('deployment',{cwd,timeoutMs:30000});
 try {
  const log=readFileSync(host.logs.stderr,'utf8');assert.match(log,/SNAPBACK4_READY verb=serve/);
  const hashes=log.match(/active schema ([a-f0-9]+), working schema ([a-f0-9]+)/);assert.ok(hashes,log);assert.notEqual(hashes[1],hashes[2]);
 }finally{await host.stop();}
 assert.match(readFileSync(host.logs.stderr,'utf8'),/SNAPBACK4_SOCKET_CLOSED verb=serve.*socket closed/);
 assert.equal(await stopped(host),true);
});
test('declared actions with no handler warn at serve startup', {timeout:60000},async t=>{
 const cwd=fixture(t,'use server\nuse identity guests\naction ping() returns { ok: bool }\n');await ok(['deploy','deployment'],cwd);
 const host=await startServe('deployment',{cwd});try{assert.match(readFileSync(host.logs.stderr,'utf8'),/WARNING: declared actions\/routes have no supervised handler entry/)}finally{await host.stop();}
});
test('captured server and external project import run automatically and follow hot release', {timeout:120000},async t=>{
 const cwd=fixture(t,'use server\nuse identity guests\naction ping() returns { ok: bool }\n');
 writeFileSync(join(cwd,'handler.ts'),'export const marker = "SURF4_FIRST";\n');
 writeFileSync(join(cwd,'snapback/server.ts'),`import {server} from './generated/server.ts';import {startServer} from 'snapback4/server';import {marker} from '../handler.ts';console.log(marker);export default server(startServer,{actions:{async ping(){return {ok:true}}}});\n`);
 await ok(['deploy','deployment'],cwd);
 writeFileSync(join(cwd,'handler.ts'),'export const marker = "SURF4_SECOND";\n');
 const host=await startServe('deployment',{cwd});
 try {
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_FIRST'),'captured server was not started');
  assert.doesNotMatch(readFileSync(host.logs.stderr,'utf8'),/SURF4_SECOND|no supervised handler entry/);
  await ok(['deploy','deployment'],cwd);
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_SECOND'),'hot release did not replace conventional entry/import');
 } finally{await host.stop();}
});
test('waitForFresh reports its overall deadline without the final 1 ms observation timeout',async()=>{
 const locator={toString:()=>'<status>',count:async()=>1,textContent:()=>new Promise(()=>{})};
 await assert.rejects(waitForFresh(locator,'old',30),error=>{
  assert.match(error.message,/no fresh signal after 30 ms/);assert.doesNotMatch(error.message,/locator text timed out after|timed out after 1 ms/);return true;
 });
});

test('serve ready wait has a finite deadline and cleans up its owned child', {timeout:10000},async t=>{
 const cwd=fixture(t),fake=join(cwd,'stalled.mjs'),saved=process.env.SNAPBACK4_BIN;
 writeFileSync(fake,`#!${process.execPath}\nsetInterval(()=>{},1000);\n`,{mode:0o755});process.env.SNAPBACK4_BIN=fake;
 try{await assert.rejects(startServe('deployment',{cwd,timeoutMs:30}),/ready timed out after 30 ms/)}
 finally{if(saved===undefined)delete process.env.SNAPBACK4_BIN;else process.env.SNAPBACK4_BIN=saved;}
});
