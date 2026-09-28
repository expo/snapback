// Instrument only a private copy of calibration #24's application.
// node witness/clique-scale-instrument.mjs COPIED_APP [SDK_DIST]
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,cpSync,rmSync,existsSync,realpathSync} from 'node:fs';
import {resolve,join} from 'node:path';
const [arg,source=resolve('packages/snapback4/dist')]=process.argv.slice(2);
assert.ok(arg, 'pass a private writable app copy, never the evidence directory');
const app=realpathSync(arg), dist=join(app,'node_modules/snapback4/dist');
assert.ok(!app.includes('/rg-evidence/'), 'the evidence tree is read-only');
assert.notEqual(resolve(source),dist);
assert.ok(existsSync(join(source,'web-idb.js')), 'build the SDK before instrumenting a copy');
rmSync(dist,{recursive:true,force:true});cpSync(resolve(source),dist,{recursive:true});
const edit=(file,change)=>{const path=join(dist,file);writeFileSync(path,change(readFileSync(path,'utf8')));};
edit('wasm/snapback4_device.js',s=>s+`
const ss = globalThis.__ss ??= {wasm: [], saves: [], timeOrigin:performance.timeOrigin};
for (const method of ['call','drain']) {
 const original = WebDevice.prototype[method];
 WebDevice.prototype[method] = function(...args) {
  const req = method === 'call' ? JSON.parse(args[0]) : {}, at = performance.now();
  try { return original.apply(this,args); }
  finally { ss.wasm.push({op:req.op ?? method, at, ms:performance.now()-at, rows:req.page?.events?.length, snapshot:req.page?.snapshot, more:req.page?.more}); }
 };
}
`);
if(process.env.SS_IDB_PROFILE) edit('wasm/snapback4_device.js',s=>s+`
ss.transactions=[]; ss.json={};
const tracked = new WeakMap(), encode=new TextEncoder();
const transaction = IDBDatabase.prototype.transaction;
IDBDatabase.prototype.transaction = function(...args) {
 const tx=transaction.apply(this,args), item={at:performance.now(),mode:tx.mode,ms:0,puts:0,gets:0,deletes:0,ranges:0,bytes:0,issueMs:0,stores:{}};
 tracked.set(tx,item);
 for(const event of ['complete','abort']) tx.addEventListener(event,()=>{item.ms=performance.now()-item.at;item.event=event;ss.transactions.push(item);});
 return tx;
};
const originalStringify=JSON.stringify;
for(const method of ['put','get','getAll','getAllKeys','delete']) {
 const original=IDBObjectStore.prototype[method];
 IDBObjectStore.prototype[method]=function(...args) {
  const item=tracked.get(this.transaction);
  if(item){
   if(method==='put') {
    const value=args[0], size=encode.encode(originalStringify(value)).byteLength;
    const name=value.s==='$bucket'?value.k.slice(0,1):value.s;
    const store=item.stores[name]??={puts:0,bytes:0};store.puts++;store.bytes+=size;item.puts++;item.bytes+=size;
   } else if(method==='delete'){item.deletes++;if(args[0] instanceof IDBKeyRange)item.ranges++;}
   else item.gets++;
  }
  const at=performance.now();try{return original.apply(this,args);}finally{if(item)item.issueMs+=performance.now()-at;}
 };
}
for(const method of ['parse','stringify']) {
 const original=JSON[method];JSON[method]=function(...args){const at=performance.now();try{return original.apply(this,args);}finally{const item=ss.json[method]??={count:0,ms:0};item.count++;item.ms+=performance.now()-at;}};
}
`);
edit('web-idb.js',s=>{
 const old = !s.includes('const save = async');
 const from=old ? 'async save(name, changes) {' : 'const save = async (name, changes, current) => {';
 assert.ok(s.includes(from));
 s=s.replace(from,from+`
        const ss = globalThis.__ss ??= {wasm:[],saves:[],timeOrigin:performance.timeOrigin};
        const sample = { at:performance.now(), changes:changes.length, name, ms:0 };
 `);
 const start=s.indexOf(from), end=old ? s.indexOf('async others',start) : s.indexOf('\n    };',start);
 assert.ok(end>start);
 const body=s.slice(start,end);assert.ok(body.includes('db.close();'));
 return s.slice(0,start)+body.replace('db.close();','db.close(); sample.ms=performance.now()-sample.at; ss.saves.push(sample);')+s.slice(end);
});
if(existsSync(join(dist,'web-worker-entry.js'))) edit('web-worker-entry.js',s=>s.replace('serveWorker(globalThis);',`
globalThis.addEventListener('message', e=>{if(e.data?.ssProfile){e.stopImmediatePropagation();postMessage({ssProfile:globalThis.__ss});}});
serveWorker(globalThis);`));
const client=join(app,'src/client.ts'), text=readFileSync(client,'utf8');
assert.ok(text.includes('webDevice('));
writeFileSync(client,text.replace('webDevice():','webDevice({worker:globalThis.location?.search.includes("worker=1")}):'));
console.log('Instrumented private SDK copy:',dist);
