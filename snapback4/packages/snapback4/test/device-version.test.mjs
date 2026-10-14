import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalClient, DeviceVersionError } from '../dist/local.js';
import { webDevice, memoryPersistence } from '../dist/web.js';
const packageVersion = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).version;
assert.equal(packageVersion, '0.4.28', 'release fixture pin follows the package bump');

test('startup compatibility refusal is typed before a backend reaches the device', async () => {
  const engine = {format:1,version:'0.4.23',capabilities:[]};
  const why = {code:'E_DEVICE_VERSION',family:'device-version',message:'device engine 0.4.23 lacks branch-merge-v1 (server 0.4.24); rebuild the device: bun exact.mjs snapback'};
  let opened = false; const statuses = [];
  await assert.rejects(createLocalClient({url:'http://localhost:1',persona:'alice',onDeviceVersion:s=>statuses.push(s),
    device:{engineInfo:async()=>engine,open:async()=>{opened=true;throw new Error('must not decode backend');}},
    fetch:async (url,init)=>{assert.ok(String(url).endsWith('/schema'));assert.deepEqual(JSON.parse(new Headers(init.headers).get('x-snapback-device')),engine);return new Response(JSON.stringify({denied:why}),{status:409});}}),
    error => error instanceof DeviceVersionError && error.status.state === 'incompatible' && error.why.code === 'E_DEVICE_VERSION');
  assert.equal(opened,false); assert.deepEqual(statuses,[{state:'incompatible',why}]);
});

test('wasm opener reads its embedded engine stamp before opening a store', async () => {
  const bytes = readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
  const module = await WebAssembly.compile(bytes);
  const stamps = WebAssembly.Module.customSections(module,'snapback4.engine');
  assert.equal(stamps.length,1);
  const stamp = JSON.parse(new TextDecoder().decode(stamps[0]));
  for(const worker of [false,true]) {
    const opener = webDevice(worker ? {wasm:bytes,worker:true} : {wasm:bytes,persist:memoryPersistence()});
    // The worker mode reports from the bytes without starting a worker or instantiating a page VM.
    assert.deepEqual(await opener.engineInfo(),stamp);
  }
  assert.equal(stamp.version,packageVersion);
  assert.ok(stamp.capabilities.includes('sync-generation-v1'));
});

for(const worker of [false,true]) for(const promised of [false,true]) test(`${worker?'worker':'direct'} preflight reuses ${promised?'Promise<Response>':'Response'} bytes`, async()=>{
  const bytes=readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
  const response=new Response(bytes);
  const wasm=promised?Promise.resolve(response):response;
  const opener=webDevice(worker?{wasm,worker:true}:{wasm,persist:memoryPersistence()});
  const info=await opener.engineInfo();
  assert.deepEqual(await opener.engineInfo(),info);
  if(!worker){const core=await opener.open('response-preflight',{initial_backend:{generation:1,schema:{tables:{},maintains:[]},programs:[]}});assert.deepEqual((await core.call({op:'engine_info'})).ok,info);await core.close();}
});

test('malformed stamps explicitly report unknown rather than becoming bare schema callers', async()=>{
  const { normalizeEngine }=await import('../dist/device-version.js');
  for(const stamp of [null,{},[],{format:1,version:'0.4.24',capabilities:null},{format:1,version:'0.4.24',capabilities:[1]}]){
    const engine=normalizeEngine(stamp);assert.equal(engine.format,0);
    let header;
    await assert.rejects(createLocalClient({url:'http://localhost:1',persona:'alice',device:{engineInfo:async()=>stamp,open:async()=>{throw new Error('do not open');}},fetch:async(_,init)=>{header=new Headers(init.headers).get('x-snapback-device');return new Response(JSON.stringify({denied:{code:'E_DEVICE_VERSION',family:'device-version',message:'unknown device; rebuild'}}),{status:409});}}),DeviceVersionError);
    assert.equal(JSON.parse(header).format,0);
  }
});

test('a corrupt process engine-info response becomes an explicit unknown engine', async t=>{
  const { processDevice }=await import('../dist/native.js');
  const { mkdtempSync,writeFileSync,chmodSync,rmSync }=await import('node:fs');
  const { tmpdir }=await import('node:os'); const {join}=await import('node:path');
  const dir=mkdtempSync(join(tmpdir(),'hand-malformed-engine-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const binary=join(dir,'cli');writeFileSync(binary,'#!/bin/sh\nprintf "not-json\\n"\n');chmodSync(binary,0o700);
  const engine=await processDevice({dir,binary}).engineInfo();assert.equal(engine.format,0);assert.equal(engine.version,'unknown (unstamped)');
});

for(const worker of [false,true]) test(`${worker?'worker':'direct'} opener pins the preflight artifact when its URL changes`,async t=>{
  const bytes=readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
  const bad=Buffer.from(bytes);const at=bad.indexOf(Buffer.from('"version":' + JSON.stringify(packageVersion)));assert.ok(at>=0);bad[at+'"version":"0.4.2'.length]=0x33;
  const prior=globalThis.fetch;let requests=0;globalThis.fetch=async()=>new Response(++requests===1?bytes:bad);
  t.after(()=>{globalThis.fetch=prior;});
  const opener=webDevice(worker?{worker:true,wasm:'https://hand.invalid/device.wasm'}:{wasm:'https://hand.invalid/device.wasm',persist:memoryPersistence()});
  // Worker URL preflight needs the browser wasm cache. Probe the same pinned
  // primitive with an injected store, then the worker's bytes path below.
  if(worker){
    const {prepareWasm}=await import('../dist/web-wasm.js');const pinned=await prepareWasm('https://hand.invalid/device.wasm',memoryPersistence());
    const workerOpener=webDevice({worker:true,wasm:pinned.source});assert.equal((await workerOpener.engineInfo()).version,packageVersion);assert.equal(requests,1);return;
  }
  assert.equal((await opener.engineInfo()).version,packageVersion);
  const core=await opener.open('pinned-url',{initial_backend:{generation:1,schema:{tables:{},maintains:[]},programs:[]}});
  t.after(()=>core.close());assert.equal((await core.call({op:'engine_info'})).ok.version,packageVersion);assert.equal(requests,1);
});

test('another initialized artifact cannot skip identity admission through a global ready shortcut',async()=>{
  const bytes=readFileSync(new URL('../dist/wasm/snapback4_device_bg.wasm',import.meta.url));
  const altered=Buffer.from(bytes);const needle=Buffer.from('"version":' + JSON.stringify(packageVersion));const at=altered.lastIndexOf(needle);assert.ok(at>=0);altered[at+'"version":"0.4.2'.length]=0x33;
  const persist=memoryPersistence();let claims=0;const claim=persist.claim;
  const opener=webDevice({wasm:altered,persist:{...persist,claim:async(...args)=>{claims++;return claim(...args);}}});
  assert.equal((await opener.engineInfo()).version,'0.4.23');
  await assert.rejects(opener.open('must-not-decode',{initial_backend:{not:'a backend'}}),DeviceVersionError);
  assert.equal(claims,0,'identity is checked before store opening or backend decoding');
});
