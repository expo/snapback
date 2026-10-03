// @ref LLP 3000#contended-read-serving — real web updates retain causal order under scoped CPU pressure.
import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {hangBudget} from './helpers/wait.mjs';
import {binary} from './helpers/app-server.mjs';
import {summarize} from '../../../reports/20261003-lu-live-update-latency/tools/stages.mjs';

// Burners are a Linux-only witness. The deterministic turn/epoch/restart tests
// run on every host; macOS qualification never starts machine-wide burners.
test('Chromium: repost, group message and reaction render under confined contention',
 {skip:process.platform!=='linux',timeout:hangBudget(100)},async t=>{
  const root=resolve(import.meta.dirname,'../../..');
  const dir=mkdtempSync(join(tmpdir(),'sb4-lu-suite-')),out=join(dir,'result.json');
  const allowed=readFileSync('/proc/self/status','utf8').match(/^Cpus_allowed_list:\s*(.*)$/m)[1].split(',').flatMap(range=>{
   const [a,b=a]=range.split('-').map(Number);return Array.from({length:b-a+1},(_,i)=>a+i);
  });
  const cpus=process.env.LU_TEST_CPUS??(allowed.includes(90)&&allowed.includes(91)?[90,91]:allowed.slice(0,2)).join(',');
  const child=spawn('taskset',['-c',cpus,process.execPath,join(root,'reports/20261003-lu-live-update-latency/tools/measure.mjs')],{
   cwd:root,env:{...process.env,SNAPBACK4_BIN:binary,LU_SUITE:'1',LU_RUNS:'2',LU_HISTORY:'80',LU_REFOLLOW:'1',LU_LEVELS:'0,2',LU_OUT:out},stdio:['ignore','pipe','pipe'],
  });
  let output='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>output+=x);
  const closed=new Promise(resolve=>child.once('close',resolve));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGTERM');await closed;}rmSync(dir,{recursive:true,force:true});});
  const status=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>resolve({code,signal}));});
  assert.equal(status.code,0,output);assert.equal(status.signal,null,output);
  const result=JSON.parse(readFileSync(out,'utf8'));
  assert.equal(result.samples.length,12);assert.deepEqual(result.errors,[]);
  for(const sample of result.samples)for(const view of sample.views){
   const {evaluated,published,render}=view.trial;
   assert.ok(Number.isFinite(evaluated)&&Number.isFinite(published)&&Number.isFinite(render),'all stages observed');
   // Server monotonic time is aligned once with the same host's browser wall
   // clock. Two ms covers clock quantization; it cannot hide queue-scale delay.
   assert.ok(sample.commit.at<=evaluated+2,'remote commit precedes matching device evaluation');
   assert.ok(evaluated<=published+2,'matching evaluation precedes observation publication');
   assert.ok(published<=render+2,'observation precedes the matching React commit');
   assert.ok(render-sample.commit.at<120_000,'generous hang bound, not the qualification latency target');
  }
  const summary=summarize(result);
  t.diagnostic(JSON.stringify({affinity:result.metadata.affinity,groups:Object.fromEntries(Object.entries(summary.groups).map(([key,value])=>[key,value.commitToRender]))}));
 });
