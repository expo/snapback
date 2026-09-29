// Run from snapback4: node reports/20260929-wd-wasm-headroom/differential.mjs CAPTURE
// Private captured payloads stay under target; only hashes/counts leave this run.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const sha = s => createHash('sha256').update(s).digest('hex');
const captureBytes = readFileSync(process.argv[2]);
const capture = JSON.parse(captureBytes);
const backend = JSON.stringify(capture.backend);
const modules = [];
for (const name of ['baseline','final']) {
  const dir = resolve(`target/wd/${name}-sdk/wasm`);
  const m = await import(pathToFileURL(`${dir}/snapback4_device.js`));
  m.initSync({module:readFileSync(`${dir}/snapback4_device_bg.wasm`)});
  modules.push(m);
}
const results=[];
for (const m of modules) {
  let device = new m.WebDevice(backend,'[]');
  const kept = new Map(), trace=[], operations={};
  const record = (kind,text) => { trace.push([kind,text]); };
  const drain = () => {
    const text=device.drain();record('drain',text);
    for(const c of JSON.parse(text)) {
      const key=JSON.stringify([c.s,c.k]);
      if(c.v===null)kept.delete(key);else kept.set(key,c);
    }
  };
  drain();
  for(const text of capture.commands) {
    const request=JSON.parse(text);operations[request.op]=(operations[request.op]??0)+1;
    record('call',device.call(text));drain();
  }
  const persisted=JSON.stringify([...kept.values()]);
  device.free();
  device=new m.WebDevice(undefined,persisted);
  record('reopened',device.call('{"op":"sync_state"}'));drain();
  const malformed=['', '{', 'null', '[]', '{}', '{"op":"missing"}', '{"op":"query"}', '{"op":"query","name":"missing","args":{}}',
    '{"op":"apply","first":true,"page":{}}', '{"op":"apply","first":true,"page":{"snapshot":true,"events":[],"watermark":0,"watermark":1,"more":false}}'];
  for(const text of malformed){record('malformed',device.call(text));drain();}
  device.free();
  for(const bad of ['{','{}','[]','{"generation":1,"schema":{"tables":{}},"programs":false}']){
    try { const d=new m.WebDevice(bad,'[]');d.free();record('bad-backend','accepted'); }
    catch(e){record('bad-backend',e.message);}
  }
  for(const bad of ['{','{}','[{}]','[{"s":"r","k":"bad","v":"bad"}]']){
    try { const d=new m.WebDevice(backend,bad);d.free();record('bad-kept','accepted'); }
    catch(e){record('bad-kept',e.message);}
  }
  results.push({trace,persisted,operations,records:kept.size});
}
assert.deepEqual(results[1],results[0], 'exact call, error and persisted bytes');
const r=results[0];
writeFileSync('reports/20260929-wd-wasm-headroom/differential.json',JSON.stringify({captureSha256:sha(captureBytes),commands:capture.commands.length,operations:r.operations,comparisons:r.trace.length,persistedRecords:r.records,persistedBytes:Buffer.byteLength(r.persisted),persistedSha256:sha(r.persisted),traceSha256:sha(JSON.stringify(r.trace)),equal:true},null,2)+'\n');
console.log(`Exact wasm differential: ${r.trace.length} replies/drains/errors; ${r.records} persisted records; ${Buffer.byteLength(r.persisted)} persisted bytes; offline reopen; all identical.`);
