import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir,homedir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {gzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {published} from '../../packages/snapback4/test/helpers/published-capabilities.mjs';

test('published 0.2.33 refuses the integrated app before prediction',async t=>{
  const file=process.env.SNAPBACK4_CLIQUE_BACKEND;
  assert.ok(file,'set SNAPBACK4_CLIQUE_BACKEND to the backend exported by the crate test');
  const backend=JSON.parse(readFileSync(file,'utf8'));
  const capabilities=Object.values(backend.schema.tables).flatMap(t=>t.constraints).filter(c=>c.Capabilities);
  assert.deepEqual(capabilities,[{Capabilities:['maintained-column','recorded-attribution','timeline']}]);
  const dir=mkdtempSync(join(tmpdir(),'sb4-clique-fence-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const legacy=await published(process.env.SNAPBACK4_FENCE_PUBLISHED??join(homedir(),'sb4-03-lanes/fence/published'),dir,s=>t.diagnostic(s));
  const backendFile=join(dir,'backend.json'),store=join(dir,'refused.sqlite');
  writeFileSync(backendFile,JSON.stringify(backend));
  const native=spawnSync(legacy.binary,['device',store,backendFile],{encoding:'utf8',input:JSON.stringify({op:'admit',entry:{id:'must-not-predict',seq:1,op:'post',viewer:'u0005',args:{body:'no prediction'},now:1,predictable:true}})+'\n',timeout:20000});
  assert.notEqual(native.status,0);assert.match(native.stdout+native.stderr,/unknown variant [`'"]?Capabilities/);
  assert.equal(existsSync(store),false,'refusal precedes store creation');
  assert.doesNotMatch(native.stdout,/"predicted"/);
  assert.throws(()=>new legacy.wasm(JSON.stringify(backend),'[]'),/unknown variant [`'"]?Capabilities/);
  const bytes=readFileSync(join(dir,'snapback4/package/dist/wasm/snapback4_device_bg.wasm'));
  t.diagnostic(JSON.stringify({published:'0.2.33',native:'refused before store creation or prediction',wasm:'constructor refused',raw:bytes.length,gzip:gzipSync(bytes,{level:9}).length,sha256:createHash('sha256').update(bytes).digest('hex')}));
});
