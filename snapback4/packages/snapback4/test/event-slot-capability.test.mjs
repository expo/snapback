// The old wasm artifact must reject the new semantics before any row is read.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,rmSync} from 'node:fs';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const fixture=new URL('./fixtures/event-slots-pre-slot/',import.meta.url);
const oldBytes=gunzipSync(readFileSync(new URL('device.wasm.gz',fixture)));
const oldBackend=JSON.parse(readFileSync(new URL('backend.json',fixture),'utf8'));
const traces=JSON.parse(readFileSync(join(root,'target/event-slots-traces.json'),'utf8'));
const candidate=structuredClone(traces.find(t=>t.name.startsWith('ordinary event reads with sync public last')).backend);
candidate.generation=oldBackend.generation+1;
const unsupported=/E_SCHEMA_CAPABILITY.*unsupported engine capability timeline-event-slots/;
const ok=text=>{const reply=JSON.parse(text);assert.ok(Object.hasOwn(reply,'ok'),JSON.stringify(reply));return reply.ok;};
async function moduleAt(t,bytes){
 const dir=mkdtempSync(join(tmpdir(),'sb4-pre-slot-wasm-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
 const file=join(dir,'device.mjs');writeFileSync(file,readFileSync(join(root,'packages/snapback4/src/wasm/snapback4_device.js')));
 const module=await import(pathToFileURL(file));module.initSync({module:bytes});return module.WebDevice;
}

test('pre-slot wasm refuses slot installation, adoption and persisted reopen without writes',async t=>{
 assert.equal(oldBytes.length,1776336);
 assert.equal(createHash('sha256').update(oldBytes).digest('hex'),'157158ee62a2442cfbc9fedb9848f0b6939cd3da58b493d2d55bc7374401e02c');
 const Old=await moduleAt(t,oldBytes);
 // This is the behavioral assertion: deleting capability derivation admits
 // the candidate and fails here, before checking its declared marker.
 assert.throws(()=>new Old(JSON.stringify(candidate),'[]'),unsupported);
 const old=new Old(JSON.stringify(oldBackend),'[]');t.after(()=>old.free());
 const before=ok(old.call('{"op":"state"}'));const persisted=old.drain();
 const adoption=old.call(JSON.stringify({op:'adopt',backend:candidate}));assert.match(adoption,unsupported);
 assert.deepEqual(ok(old.call('{"op":"state"}')),before);
 assert.equal(old.drain(),'[]','failed adoption must not persist anything');
 const reopened=new Old(undefined,persisted);assert.deepEqual(ok(reopened.call('{"op":"state"}')),before);reopened.free();
 const Current=await moduleAt(t,readFileSync(join(root,'packages/snapback4/src/wasm/snapback4_device_bg.wasm')));
 const current=new Current(JSON.stringify(candidate),'[]');const next=current.drain();current.free();
 assert.throws(()=>new Old(undefined,next),unsupported,'downgrade must reject the persisted slot schema');
});

test('pre-slot wasm still accepts and adopts the genuine timeline-v2 backend',async t=>{
 const Old=await moduleAt(t,oldBytes);const old=new Old(JSON.stringify(oldBackend),'[]');t.after(()=>old.free());
 const next=structuredClone(oldBackend);next.generation++;
 ok(old.call(JSON.stringify({op:'adopt',backend:next})));
 assert.equal(ok(old.call('{"op":"state"}')).generation,next.generation);
 const declarations=Object.values(candidate.schema.tables).flatMap(t=>t.constraints).filter(c=>c.Capabilities).flatMap(c=>c.Capabilities);
 assert.deepEqual(declarations,['timeline-event-slots','timeline-v2']);
});
