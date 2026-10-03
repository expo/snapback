import {mkdtempSync,writeFileSync,readFileSync,rmSync,copyFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const root='/home/ccheever/sb4-intent/lane-qf/snapback4',out=root+'/reports/20261002-qf-qualification-flakes/round2/';
const dir=mkdtempSync('/tmp/qf-r2-sync-negative-');
try {
 for(const name of ['run-client-tests.mjs','test-progress-reporter.mjs'])copyFileSync(out+'development-'+name,dir+'/'+name);
 for(const name of ['test-file-owner.mjs','test-processes.mjs'])copyFileSync(root+'/scripts/'+name,dir+'/'+name);
 const file=dir+'/sync.test.mjs';writeFileSync(file,"import test from 'node:test';for(let i=0;i<10;i++)test('sync '+i,{timeout:500},()=>{const end=performance.now()+300;while(performance.now()<end){}})");
 const {runFile}=await import(dir+'/run-client-tests.mjs');let log='';
 const result=await runFile(file,{timeout:1000,onOutput:s=>{log+=s}});
 writeFileSync(out+'sync-progress-negative-control.log',log);
 writeFileSync(out+'sync-progress-negative-control.json',JSON.stringify(result,null,2)+'\n');
 assert.equal(result.passed,false);assert.equal(result.reason,'TEST_FILE_HANG');console.log(result);
}finally{rmSync(dir,{recursive:true,force:true})}
