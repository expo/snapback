import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const root=resolve(import.meta.dirname,'../../..');
const binary=process.env.SNAPBACK4_BIN??join(root,'target/debug/snapback4');
const installed=process.env.SNAPBACK4_PROOF_PACKAGE??join(root,'packages/snapback4');
const source=join(root,'crates/snapback4-lang/src/guide/wire.md');
const block=(text,name,language)=>text.match(new RegExp(`<!-- WIRE FIRST ${name} BEGIN -->\\n\x60\x60\x60${language}\\n([\\s\\S]*?)\\n\x60\x60\x60\\n<!-- WIRE FIRST ${name} END -->`))?.[1];
test('KIT4 literal first wire page runs unchanged and its trace is generated from real requests',{timeout:60000},t=>{
  let guide;
  if(process.env.KIT4_UPDATE_WIRE==='1') guide=readFileSync(source,'utf8');
  else {const result=spawnSync(binary,['guide','wire','--full'],{encoding:'utf8',timeout:10000});assert.equal(result.status,0,result.stderr);guide=result.stdout;}
  const cwd=mkdtempSync(join(root,'target/kit4-wire-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
  mkdirSync(join(cwd,'snapback'));mkdirSync(join(cwd,'node_modules'));
  symlinkSync(installed,join(cwd,'node_modules/snapback4'),'dir');
  writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
  writeFileSync(join(cwd,'snapback/schema.q'),block(guide,'SCHEMA','quarry'));
  writeFileSync(join(cwd,'wire-proof.mjs'),block(guide,'SCRIPT','js'));
  const result=spawnSync(process.execPath,['wire-proof.mjs'],{cwd,env:{...process.env,SNAPBACK4_BIN:binary},encoding:'utf8',timeout:45000});
  assert.equal(result.status,0,result.stdout+result.stderr);
  const trace=JSON.parse(result.stdout);
  assert.equal(trace.length,7);assert.equal(trace[6].response.status,200);
  if(process.env.KIT4_UPDATE_WIRE==='1') {
    guide=guide.replace(/<!-- WIRE FIRST TRACE BEGIN -->[\s\S]*?<!-- WIRE FIRST TRACE END -->/,
      '<!-- WIRE FIRST TRACE BEGIN -->\n```json\n'+trace.map(row=>JSON.stringify(row)).join(',\n').replace(/^/,'[\n')+'\n]\n```\n<!-- WIRE FIRST TRACE END -->');
    writeFileSync(source,guide);
  }
  assert.deepEqual(trace,JSON.parse(block(guide,'TRACE','json')));
});
