import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, mkdirSync, symlinkSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { printProofReport } from '../dist/proof-report.js';
function capture(body) { const lines=[];const old=console.log,error=console.error;console.log=(...a)=>lines.push(a.join(' '));console.error=(...a)=>lines.push(a.join(' '));try{body();return lines.join('\n');}finally{console.log=old;console.error=error;} }
const receipt={ok:true,script:'probe:serve',ready:true,upMs:3034,lockReleased:true,failures:[],commandCode:0};
test('proof summaries retain decisions within budgets and JSON is complete',()=>{
 const dir=mkdtempSync(join(tmpdir(),'tok2-proof-'));const old=process.cwd();process.chdir(dir);
 try {
  const text=capture(()=>printProofReport('probe:check',receipt,[]));assert.ok(text.split('\n').length<=3);assert.match(text,/observed 3034ms.*store lock released/);
  const path=join(dir,'.snapback4/last/probe-check.txt');assert.deepEqual(JSON.parse(readFileSync(path,'utf8')),receipt);
  if(process.platform!=='win32'){assert.equal(statSync(path).mode&0o777,0o600);assert.equal(statSync(join(dir,'.snapback4/last')).mode&0o777,0o700);}
  assert.deepEqual(JSON.parse(capture(()=>printProofReport('probe:check',receipt,['--json']))),receipt);
  const failed={...receipt,ok:false,lockReleased:false,commandCode:17,failures:[{code:'E_SERVE_THEN_TIMEOUT',message:'command refused: "two  spaces"\nretry explicitly'}]};
  const refusal=capture(()=>printProofReport('probe:check',failed,[]));assert.ok(refusal.split('\n').length<=9);assert.match(refusal,/NOT released.*command exit 17/);assert.match(refusal,/"two  spaces"/);assert.match(refusal,/retry explicitly/);
  assert.deepEqual(JSON.parse(capture(()=>printProofReport('probe:check',failed,['--explain']))),failed);
 } finally {process.chdir(old);rmSync(dir,{recursive:true,force:true});}
});
test('lost proof detail custody keeps the full evidence and never follows a directory symlink',t=>{
 if(process.platform==='win32'){t.skip('Unix symlink fixture');return;}
 const dir=mkdtempSync(join(tmpdir(),'tok2-proof-symlink-'));const old=process.cwd();process.chdir(dir);
 try {mkdirSync('elsewhere');symlinkSync('elsewhere','.snapback4');const text=capture(()=>printProofReport('serve-check',receipt,[]));assert.match(text,/details unavailable/);assert.match(text,/"upMs": 3034/);assert.equal(existsSync('elsewhere/last'),false);}
 finally {process.chdir(old);rmSync(dir,{recursive:true,force:true});}
});
