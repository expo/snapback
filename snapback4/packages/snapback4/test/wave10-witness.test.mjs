import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import vm from 'node:vm';
import { settleMutation } from '../dist/write-settlement.js';
import { sentResult, matchRead, otherwiseAll } from '../dist/contract.js';
const root = fileURLToPath(new URL('../../../', import.meta.url));
const bin = process.env.SNAPBACK4_BIN ?? join(root, 'target/debug/snapback4');
const invoke = (args, cwd, env = {}) => spawnSync(bin, args, { cwd, encoding: 'utf8', env: { ...process.env, SNAPBACK4_BIN: bin, PORT_LO: undefined, PORT_HI: undefined, ...env }, timeout: 120000 });
const success = result => assert.equal(result.status, 0, result.stdout + result.stderr);
const project = (t, name = 'dx10-') => { const dir = mkdtempSync(join(root, 'target', name)); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; };

for (const persona of [undefined, 'alice']) test(`default web starter ${persona ?? 'guest'} proves a visible labelled form and ships a favicon`, { timeout: 120000 }, t => {
  const dir = project(t); success(invoke(['init', '--web'], dir)); symlinkSync(join(root, 'node_modules'), join(dir, 'node_modules')); success(invoke(['check'], dir));
  success(spawnSync(join(root, 'node_modules/.bin/vite'), ['build'], { cwd: dir, encoding: 'utf8', timeout: 120000 }));
  const proof = invoke(['witness', 'web', 'dist', ...(persona ? ['--as', persona, '--port-range', '30100-30109'] : []), '--mutation', 'add', '--args', '{"title":"Visible proof"}', '--field', 'Task', '--value', 'Visible proof', '--button', 'Add'], dir);
  success(proof); assert.equal(JSON.parse(proof.stdout).proof, 'visible-form'); assert.equal(JSON.parse(proof.stdout).state, 'sent');
  const wrong = invoke(['witness', 'web', 'dist', '--mutation', 'add', '--args', '{"title":"Other value"}', '--field', 'Task', '--value', 'Visible proof', '--button', 'Add', '--timeout', '5'], dir);
  assert.equal(wrong.status, 1); assert.match(wrong.stderr, /E_WITNESS_UNCLAIMED/);
  if (persona) { const sdk = invoke(['witness', 'web', 'dist', '--as', 'alice', '--mutation', 'add', '--args', '{"title":"SDK proof"}'], dir); success(sdk); }
});

test('visible-form arming ignores old sent state, isolates the clicked mutation and cleans repeated observers', async t => {
  const { registerWebWitness } = await import('../dist/witness-web.js');
  const old = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const captures = new Set(), button = {};
  const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { addEventListener: (_, listener) => captures.add(listener), removeEventListener: (_, listener) => captures.delete(listener) } });
  t.after(() => { if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document; });
  const window = { location: { search: '?witness=web' }, statusText: 'sent' };
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  t.after(() => { if (old) Object.defineProperty(globalThis, 'window', old); else delete globalThis.window; });
  const listeners = new Set(), mutation = { kind: 'mutation', name: 'add' };
  const original = async (op, args) => { for (const listener of listeners) listener({ state: 'sent', id: 'clicked', seq: 1, result: args }); return { state: 'pending', id: 'clicked' }; };
  const app = { ready: Promise.resolve({ ok: true }), mutate: (...args) => original(...args), client: { viewer: () => 'dev:alice', onWrite: listener => { listeners.add(listener); return () => listeners.delete(listener); }, mutate: original } };
  registerWebWitness(app, { add: mutation });
  window.__snapback4Witness.beginForm('add', { title: 'new' }, button);
  let settled = false; window.__snapback4Witness.formResult().then(() => settled = true);
  await Promise.resolve(); assert.equal(settled, false, 'existing sent text is not a write');
  await app.client.mutate(mutation, { title: 'new' }); await Promise.resolve(); assert.equal(settled, true, 'an armed unclaimed background write fails promptly');
  assert.equal((await window.__snapback4Witness.formResult()).why.code, 'E_WITNESS_UNCLAIMED');
  window.__snapback4Witness.beginForm('add', {title:'new'}, button);
  const click = { isTrusted: true, composedPath: () => [button] }; window.event = click; for (const capture of captures) capture(click);
  const returned = await app.client.mutate(mutation, { title: 'new' }); assert.equal(returned.state, 'pending', 'instrumentation preserves UI custody');
  const receipt = await window.__snapback4Witness.formResult(); assert.equal(receipt.state, 'sent'); assert.equal(receipt.mutation, 'add');
  assert.equal(app.client.mutate, original); assert.equal(listeners.size, 0);
  window.__snapback4Witness.beginForm('add', undefined, button); window.__snapback4Witness.beginForm('add', undefined, button);
  window.event = click; for (const capture of captures) capture(click);
  await app.client.mutate(mutation, {}); assert.equal((await window.__snapback4Witness.formResult()).state, 'sent'); assert.equal(app.client.mutate, original);
});

for (const active of [false, true]) test(`form proof ${active ? 'accepts click-owned app mutation' : 'rejects matching background writes with a broken button'}`, { timeout: 15000 }, t => {
  const dir = project(t); mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/bridge.js'), readFileSync(join(root, 'packages/snapback4/dist/witness-web.js')));
  writeFileSync(join(dir, 'dist/index.html'), `<label>Task<input></label><button>Add</button><p>sent</p><script type="module">
import {registerWebWitness} from './bridge.js';
const api={add:{kind:'mutation',name:'add'}}, listeners=new Set();let n=0;
const client={viewer:()=> 'dev:alice',onWrite:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},mutate:async(op,args)=>({state:'sent',id:String(++n),seq:n,result:args})};
const app={client,ready:Promise.resolve({ok:true}),mutate:async(...args)=>{await Promise.resolve();return client.mutate(...args)}};
registerWebWitness(app,api);
${active ? '' : `setInterval(()=>client.mutate(api.add,{title:'proof'}),20);`}
${active ? "document.querySelector('button').onclick=()=>void app.mutate(api.add,{title:'proof'});" : ''}
</script>`);
  const result = invoke(['witness', 'web', 'dist', '--url', 'http://127.0.0.1:4400', '--as', 'alice', '--mutation', 'add', '--args', '{"title":"proof"}', '--field', 'Task', '--value', 'proof', '--button', 'Add', '--timeout', '2'], dir);
  if (active) success(result);
  else { assert.equal(result.status, 1); assert.match(result.stderr, /E_WITNESS_SENT/); assert.ok(!result.stdout.includes('"state":"sent"')); }
});


test('a later background requestSubmit never inherits a broken button click', { timeout: 15000 }, t => {
  const dir = project(t); mkdirSync(join(dir, 'dist'));
  writeFileSync(join(dir, 'dist/bridge.js'), readFileSync(join(root, 'packages/snapback4/dist/witness-web.js')));
  writeFileSync(join(dir, 'dist/index.html'), `<form><label>Task<input></label><button>Add</button></form><p>sent</p><script type="module">
import {registerWebWitness} from './bridge.js';
const api={add:{kind:'mutation',name:'add'}},client={viewer:()=> 'dev:alice',onWrite:()=>()=>{},mutate:async()=>({state:'sent',id:'background',seq:1,result:null})};
const app={client,ready:Promise.resolve({ok:true}),mutate:(...args)=>client.mutate(...args)};
registerWebWitness(app,api);
const form=document.querySelector('form'),button=document.querySelector('button');
form.onsubmit=e=>{e.preventDefault();void app.mutate(api.add,{title:'proof'})};
button.onclick=e=>{e.preventDefault();setTimeout(()=>form.requestSubmit(button),10)};
</script>`);
  const result = invoke(['witness','web','dist','--url','http://127.0.0.1:4400','--as','alice','--mutation','add','--args','{"title":"proof"}','--field','Task','--value','proof','--button','Add','--timeout','2'], dir);
  assert.equal(result.status,1);assert.match(result.stderr,/E_WITNESS_SENT/);assert.ok(!result.stdout.includes('"state":"sent"'));
});

for (const mode of ['microtask', 'nested-submit', 'script-click', 'nested-script-click']) test(`clicked dispatch provenance: ${mode}`, { timeout: 15000 }, t => {
  const dir=project(t);mkdirSync(join(dir,'dist'));
  writeFileSync(join(dir,'dist/bridge.js'),readFileSync(join(root,'packages/snapback4/dist/witness-web.js')));
  writeFileSync(join(dir,'dist/index.html'),`<form><label>Task<input></label><button>Add</button></form><script type="module">
import {registerWebWitness} from './bridge.js';
const api={add:{kind:'mutation',name:'add'}},client={viewer:()=> 'dev:alice',onWrite:()=>()=>{},mutate:async()=>({state:'sent',id:'proof',seq:1,result:null})};
const app={client,ready:Promise.resolve({ok:true}),mutate:async(...args)=>{await Promise.resolve();return client.mutate(...args)}};
registerWebWitness(app,api);const form=document.querySelector('form'),button=document.querySelector('button');
form.onsubmit=e=>{e.preventDefault();void app.mutate(api.add,{title:'proof'})};
button.onclick=e=>{e.preventDefault();${mode === 'microtask' ? "void(async()=>{await Promise.resolve();await app.mutate(api.add,{title:'proof'})})()" : mode === 'nested-submit' ? 'form.requestSubmit(button)' : mode === 'nested-script-click' ? 'if(e.isTrusted)button.click()' : "if(e.isTrusted)setTimeout(()=>button.click(),10);else void app.mutate(api.add,{title:'proof'})"}};
</script>`);
  const result=invoke(['witness','web','dist','--url','http://127.0.0.1:4400','--as','alice','--mutation','add','--args','{"title":"proof"}','--field','Task','--value','proof','--button','Add','--timeout','2'],dir);
  if(mode==='microtask'||mode==='nested-submit')success(result);else{assert.equal(result.status,1);assert.match(result.stderr,/E_WITNESS_SENT/)}
});

test('unapproved App calls preserve supported options from prototypes, non-enumerable fields and private getters', async t => {
  const {registerWebWitness}=await import('../dist/witness-web.js');
  const oldWindow=Object.getOwnPropertyDescriptor(globalThis,'window'),oldDocument=Object.getOwnPropertyDescriptor(globalThis,'document');
  const window={location:{search:'?witness=web'}};
  Object.defineProperty(globalThis,'window',{configurable:true,value:window});
  Object.defineProperty(globalThis,'document',{configurable:true,value:{addEventListener(){},removeEventListener(){}}});
  t.after(()=>{if(oldWindow)Object.defineProperty(globalThis,'window',oldWindow);else delete globalThis.window;if(oldDocument)Object.defineProperty(globalThis,'document',oldDocument);else delete globalThis.document});
  class Options { #id='saved-id'; get id(){return this.#id} get waitSeconds(){return 0} }
  let idReads=0,waitReads=0;
  const enumerable=Object.freeze({get id(){idReads++;return idReads===1?'saved-id':'changed-id'},get waitSeconds(){return waitReads++}});
  const values=[enumerable,Object.freeze(new Options()),Object.freeze(Object.create({id:'saved-id',waitSeconds:0})),Object.freeze(Object.defineProperties({},{id:{value:'saved-id'},waitSeconds:{value:0}}))];
  for(const options of values){
    let forwarded,forwardedOp,forwardedArgs;
    const operation={kind:'mutation',name:'add'},client={viewer:()=> 'dev:alice',onWrite:()=>()=>{},mutate:async(op,args,opts)=>{forwarded=opts;forwardedOp=op;forwardedArgs=args;return{state:'pending',id:opts.id}}};
    const app={client,ready:Promise.resolve({ok:true}),mutate:async(...args)=>{await Promise.resolve();return client.mutate(...args)}};
    registerWebWitness(app,{add:operation});window.__snapback4Witness.beginForm('add',undefined,{});
    const before=Object.getOwnPropertyDescriptors(options);
    const args={title:'proof'},result=await app.mutate(operation,args,options);
    assert.equal(forwardedOp,operation);assert.equal(forwardedArgs,args);
    assert.deepEqual(result,{state:'pending',id:'saved-id'});assert.equal(forwarded.id,'saved-id');assert.equal(forwarded.waitSeconds,0);
    assert.deepEqual(Object.getOwnPropertyDescriptors(options),before);assert.equal(Object.getOwnPropertySymbols(options).length,0);
    assert.ok(!JSON.stringify(forwarded).includes('witness'));
  }
  assert.equal(idReads,1);assert.equal(waitReads,1);
});
