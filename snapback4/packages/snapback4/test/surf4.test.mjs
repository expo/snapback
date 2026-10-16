import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createConnection} from 'node:net';
import {setTimeout as sleep} from 'node:timers/promises';
import {cli,startServe,startDev,waitForFresh} from '../dist/proof.js';
const root=resolve(import.meta.dirname,'../../..');
process.env.SNAPBACK4_BIN ??= join(root,'target/debug/snapback4');
function fixture(t,source='query alive():\n  return true\n') {
 const cwd=mkdtempSync(join(root,'target/surf4-'));mkdirSync(join(cwd,'snapback'));
 writeFileSync(join(cwd,'snapback/schema.q'),source);writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));return cwd;
}
async function ok(args,cwd){const r=await cli(args,{cwd});assert.equal(r.code,0,r.stdout+r.stderr);return r;}
async function until(read,label,diagnostics=()=>''){const end=performance.now()+15000;while(performance.now()<end){const result=read();if(result)return result;await sleep(30);}assert.fail(label+"\n"+diagnostics());}
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
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_FIRST'),'captured server was not started',()=>readFileSync(host.logs.stderr,'utf8'));
  assert.doesNotMatch(readFileSync(host.logs.stderr,'utf8'),/SURF4_SECOND|no supervised handler entry/);
  await ok(['deploy','deployment'],cwd);
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_SECOND'),'hot release did not replace conventional entry/import',()=>readFileSync(host.logs.stderr,'utf8'));
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

test('conventional worker fallback captures its imports before a first check', {timeout:60000},async t=>{
 const cwd=fixture(t);writeFileSync(join(cwd,'worker-helper.mjs'),'export const marker="SURF4_WORKER_CAPTURED";\n');
 writeFileSync(join(cwd,'snapback/worker.mjs'),`import {marker} from '../worker-helper.mjs';console.log(marker);setInterval(()=>{},1000);\n`);
 await ok(['deploy','deployment'],cwd);writeFileSync(join(cwd,'worker-helper.mjs'),'throw Error("mutable working bytes must not run");\n');
 const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_WORKER_CAPTURED'),'worker fallback/import was not captured')}finally{await host.stop();}
});

for(const mode of ['absolute','symlink']) test(`deployment refuses ${mode} source escape before activation`, {timeout:60000},async t=>{
 const cwd=fixture(t),outside=fixture(t);writeFileSync(join(outside,'helper.mjs'),'export const marker="OUTSIDE";\n');
 let imported;
 if(mode==='absolute'){writeFileSync(join(cwd,'helper.mjs'),'export const marker="ABSOLUTE";\n');imported=join(cwd,'helper.mjs');}
 else{symlinkSync(outside,join(cwd,'shared'));imported='../shared/helper.mjs';}
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from ${JSON.stringify(imported)};console.log(marker);setInterval(()=>{},1000);\n`);
 const result=await cli(['deploy','deployment'],{cwd});assert.notEqual(result.code,0);assert.match(result.stderr,/project-relative|inside the project|symlink|No such file|not a directory|Cannot find module/i);
 const status=await cli(['releases','deployment','--json'],{cwd});if(status.code===0)assert.equal(JSON.parse(status.stdout).release,null);
});
test('checked imports under native and target directories stay in release source', {timeout:60000},async t=>{
 const cwd=fixture(t);for(const dir of ['native','target']){mkdirSync(join(cwd,'src',dir),{recursive:true});writeFileSync(join(cwd,'src',dir,'helper.mjs'),`export const ${dir}="${dir}";\n`);}
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {native} from '../src/native/helper.mjs';import {target} from '../src/target/helper.mjs';console.log('SURF4_DIRS',native,target);setInterval(()=>{},1000);\n`);
 await ok(['deploy','deployment'],cwd);const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_DIRS native target'),'ordinary import directory omitted')}finally{await host.stop();}
});
test('schema-local installed dependency keeps its precedence in private checking and serving', {timeout:60000},async t=>{
 const cwd=fixture(t),pkg=join(cwd,'snapback/node_modules/surface-dependency');mkdirSync(pkg,{recursive:true});
 writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'surface-dependency',type:'module',exports:'./index.js',types:'./index.d.ts'}));
 writeFileSync(join(pkg,'index.js'),'export const marker="SURF4_SCHEMA_PACKAGE";\n');writeFileSync(join(pkg,'index.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'snapback/server.ts'),`import {marker} from 'surface-dependency';console.log(marker);setInterval(()=>{},1000);\n`);
 await ok(['check'],cwd);await ok(['deploy','deployment'],cwd);const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_SCHEMA_PACKAGE'),'schema-local dependency lost')}finally{await host.stop();}
});

test('external checked imports retain nested package precedence when serving', {timeout:60000},async t=>{
 const cwd=fixture(t);
 for(const [directory,marker] of [['node_modules','WRONG_ROOT_PACKAGE'],['src/node_modules','SURF4_NESTED_PACKAGE']]){
  const pkg=join(cwd,directory,'surface-dependency');mkdirSync(pkg,{recursive:true});writeFileSync(join(pkg,'package.json'),JSON.stringify({name:'surface-dependency',type:'module',exports:'./index.js'}));writeFileSync(join(pkg,'index.js'),`export const marker="${marker}";\n`);writeFileSync(join(pkg,'index.d.ts'),'export declare const marker: string;\n');
 }
 writeFileSync(join(cwd,'src/helper.mjs'),`export {marker} from 'surface-dependency';\n`);
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from '../src/helper.mjs';console.log(marker);setInterval(()=>{},1000);\n`);
 await ok(['check'],cwd);await ok(['deploy','deployment'],cwd);const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_NESTED_PACKAGE'),'nested package precedence lost',()=>readFileSync(host.logs.stderr,'utf8'));assert.doesNotMatch(readFileSync(host.logs.stderr,'utf8'),/WRONG_ROOT_PACKAGE/)}finally{await host.stop();}
});

test('JavaScript implementations hidden by declarations retain their runtime import closure', {timeout:60000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'src'));mkdirSync(join(cwd,'temporary'));symlinkSync(join(cwd,'temporary'),join(cwd,'temporary-alias'));
 writeFileSync(join(cwd,'src/helper.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'src/helper.js'),`export {marker} from './value.js';\n`);
 writeFileSync(join(cwd,'src/value.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'src/value.js'),'export const marker="SURF4_RUNTIME_GRAPH";\n');
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from '../src/helper.js';console.log(marker);setInterval(()=>{},1000);\n`);
 const deployed=await cli(['deploy','deployment'],{cwd,env:{TMPDIR:join(cwd,'temporary-alias')}});assert.equal(deployed.code,0,deployed.stdout+deployed.stderr);writeFileSync(join(cwd,'src/value.js'),'throw Error("mutable implementation");\n');
 const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_RUNTIME_GRAPH'),'declaration hid runtime graph',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});

test('temporary-root aliases preserve captured outside imports after relocation', {timeout:60000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'temporary'));symlinkSync(join(cwd,'temporary'),join(cwd,'temporary-alias'));
 writeFileSync(join(cwd,'helper.mjs'),'export const marker="SURF4_TEMP_ALIAS";\n');
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from '../helper.mjs';console.log(marker);setInterval(()=>{},1000);\n`);
 const deployed=await cli(['deploy','deployment'],{cwd,env:{TMPDIR:join(cwd,'temporary-alias')}});assert.equal(deployed.code,0,deployed.stdout+deployed.stderr);
 writeFileSync(join(cwd,'helper.mjs'),'throw Error("working source");\n');
 const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_TEMP_ALIAS'),'temporary alias dropped imports',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});

test('relative CommonJS directory imports capture package main behind a separate types entry', {timeout:60000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'src'));writeFileSync(join(cwd,'src/package.json'),JSON.stringify({type:'commonjs',types:'index.d.ts',main:'lib.js'}));
 writeFileSync(join(cwd,'src/index.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'src/lib.js'),'module.exports={marker:"SURF4_CJS_MAIN"};\n');
 writeFileSync(join(cwd,'snapback/server.cjs'),'const {marker}=require("../src");console.log(marker);setInterval(()=>{},1000);\n');
 // The conventional entry supports .mjs; its module-scoped require uses Node resolution.
 writeFileSync(join(cwd,'snapback/server.mjs'),'import {createRequire} from "node:module";const require=createRequire(import.meta.url);const {marker}=require("../src");console.log(marker);setInterval(()=>{},1000);\n');
 await ok(['deploy','deployment'],cwd);writeFileSync(join(cwd,'src/lib.js'),'throw Error("mutable package main");\n');
 const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_CJS_MAIN'),'package main omitted',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});

test('runtime-only imports retain their nested package type', {timeout:60000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'src/dist'),{recursive:true});mkdirSync(join(cwd,'temporary'));symlinkSync(join(cwd,'temporary'),join(cwd,'temporary-alias'));
 writeFileSync(join(cwd,'src/helper.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'src/helper.js'),`import value from './dist/runtime.js';export const marker=value;\n`);
 writeFileSync(join(cwd,'src/dist/package.json'),'{"type":"commonjs"}');writeFileSync(join(cwd,'src/dist/runtime.js'),'module.exports="SURF4_PACKAGE_TYPE";\n');
 writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from '../src/helper.js';console.log(marker);setInterval(()=>{},1000);\n`);
 const deployed=await cli(['deploy','deployment'],{cwd,env:{TMPDIR:join(cwd,'temporary-alias')}});assert.equal(deployed.code,0,deployed.stdout+deployed.stderr);const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_PACKAGE_TYPE'),'runtime package type omitted',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});
test('declarations cannot conceal a missing runtime module; explicit type-only imports stay legal', {timeout:60000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'src'));writeFileSync(join(cwd,'src/types.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'snapback/server.ts'),`import {marker} from '../src/types.js';console.log(marker);setInterval(()=>{},1000);\n`);
 const absent=await cli(['deploy','deployment'],{cwd});assert.notEqual(absent.code,0);assert.match(absent.stderr,/local runtime module is missing/);
 writeFileSync(join(cwd,'snapback/server.ts'),`import type {marker} from '../src/types.js';console.log('SURF4_TYPE_ONLY');setInterval(()=>{},1000);\n`);
 await ok(['deploy','deployment'],cwd);const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_TYPE_ONLY'),'type-only import wrongly refused',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});

test('dev recovers when a missing declaration-hidden runtime file is created', {timeout:120000},async t=>{
 const cwd=fixture(t);mkdirSync(join(cwd,'src'));writeFileSync(join(cwd,'src/types.d.ts'),'export declare const marker: string;\n');
 writeFileSync(join(cwd,'snapback/server.mjs'),`console.log('SURF4_WATCH_FIRST');setInterval(()=>{},1000);\n`);
 const host=await startDev({cwd});try{
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_WATCH_FIRST'),'initial dev worker not ready',()=>readFileSync(host.logs.stderr,'utf8'));
  writeFileSync(join(cwd,'snapback/server.mjs'),`import {marker} from '../src/types.js';console.log(marker);setInterval(()=>{},1000);\n`);
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('local runtime module is missing'),'missing runtime was not refused',()=>readFileSync(host.logs.stderr,'utf8'));
  writeFileSync(join(cwd,'src/types.js'),'export const marker="SURF4_WATCH_RECOVERED";\n');
  await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_WATCH_RECOVERED'),'new runtime file did not wake dev',()=>readFileSync(host.logs.stderr,'utf8'));
 }finally{await host.stop();}
});
test('inline type specifiers retain Node 24 runtime imports, unlike import type declarations',()=>{
 // This is the actual loader's stripping primitive, not tsc emit semantics.
 const {stripTypeScriptTypes}=process.getBuiltinModule('node:module');
 assert.match(stripTypeScriptTypes(`import { type Marker } from './types.js';`),/import/);
 assert.match(stripTypeScriptTypes(`export { type Marker } from './types.js';`),/export/);
 assert.equal(stripTypeScriptTypes(`import type { Marker } from './types.js';`).trim(),'');
});

test('a Node-only low-level worker captures outside imports without requiring TypeScript', {timeout:60000},async t=>{
 const cwd=mkdtempSync(join(tmpdir(),'surf4-node-worker-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));mkdirSync(join(cwd,'snapback'));mkdirSync(join(cwd,'src'));
 writeFileSync(join(cwd,'package.json'),'{"type":"module"}');writeFileSync(join(cwd,'snapback/schema.q'),'query alive():\n  return true\n');
 writeFileSync(join(cwd,'src/helper.mjs'),'export const marker="SURF4_NODE_ONLY";\n');
 writeFileSync(join(cwd,'snapback/worker.mjs'),`import {marker} from '../src/helper.mjs';console.log(marker);setInterval(()=>{},1000);\n`);
 await ok(['deploy','deployment'],cwd);writeFileSync(join(cwd,'src/helper.mjs'),'throw Error("mutable source");\n');
 const host=await startServe('deployment',{cwd});try{await until(()=>readFileSync(host.logs.stderr,'utf8').includes('SURF4_NODE_ONLY'),'Node-only worker gained a compiler dependency',()=>readFileSync(host.logs.stderr,'utf8'))}finally{await host.stop();}
});
