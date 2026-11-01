// DX9's brief explicitly forbids the full pool/all-crate battery selected by a
// manifest edit. Preserve that raw selection and record the scoped override.
import {planAffected,runPlan} from './affected.mjs';
import {execFileSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../..');
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(resolve(root,'target/affected'),{recursive:true});
writeFileSync(resolve(root,'target/affected/dx9-unrestricted-plan.json'),JSON.stringify(plan,null,2)+'\n');
const changed=execFileSync('timeout',['30s','git','diff','--name-only','origin/main...HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const wanted=new Set(changed.filter(p=>p.includes('/test/')&&p.endsWith('.test.mjs')).map(p=>p.slice('snapback4/'.length)));
for(const name of ['dx9-packed','teardown','staging','production-starters','node-transport','transport-http','transport-outcomes','keepalive-retry','keepalive-headers','live-propagation-fallback'])wanted.add(`packages/snapback4/test/${name}.test.mjs`);
const omitted=[];const steps=[];
for(const s of plan.steps){
 if(['fixture-tests','client-models','selector-tests','wasm-measurement'].includes(s.id)||s.id.startsWith('rust:')&&!['rust:snapback4','rust:snapback4-core','rust:snapback4-lang'].includes(s.id)){omitted.push(s.id);continue;}
 if(s.id==='client-tests'){
  const files=s.argv.slice(s.fileArgOffset).filter(f=>wanted.has(f));s.argv=[...s.argv.slice(0,s.fileArgOffset),...files];s.argv[2]='6';s.fileRequires=Object.fromEntries(Object.entries(s.fileRequires??{}).filter(([f])=>files.includes(f)));
 }
 if(s.id==='rust:snapback4-core'){s.argv=['cargo','test','-p','snapback4-core','--lib','dx9_input_tests'];s.reason='Full core crate passed earlier; final run covers the changed validation regression.';}
 if(s.id==='rust:snapback4-lang'){s.argv=['cargo','test','-p','snapback4-lang',...['front_semantics','dx9_ergonomics','frontend_regressions','guide','lowering','security_sec5_output'].flatMap(t=>['--test',t]),'--','--test-threads=4'];s.reason='Final affected language targets; full crate was attempted separately, with scoped repair reruns.';}
 if(s.id==='rust:snapback4'){
  s.argv=['cargo','test','-p','snapback4',...['check','day5_starters','wave26_security','roll_views'].flatMap(t=>['--test',t]),'--','--test-threads=4'];s.reason='Final changed CLI integration targets; full CLI crate was run earlier.';
  steps.push({...s,id:'rust:security-units',argv:['cargo','test','-p','snapback4','--bin','snapback4','security_reviews','--','--test-threads=2']});
  steps.push({...s,id:'rust:starter-override',argv:['cargo','test','-p','snapback4','--test','init','expo_starters_override']});
  steps.push({...s,id:'rust:adoption-timeout-control',argv:['cargo','test','-p','snapback4','--bin','snapback4','serve::tests::adoption_tests::atomic_feed_launch_keeps_queries_reading_and_holds_sync_and_writes','--','--exact']});
 }
 steps.push(s);
}
plan.steps=steps;plan.dx9Override={reason:'User: affected scope only; no full client pool, full five-crate suite, or publication qualification. Raw fail-broad plan retained separately.',omitted,clientFiles:[...wanted].sort(),scope:'DX9 scoped override; not an unmodified selector pass'};
if(process.argv.includes('--run')){const {receipt,receiptPath}=await runPlan(plan,{root});console.log(JSON.stringify({ok:receipt.ok,receiptPath}));if(!receipt.ok)process.exitCode=1;}
else console.log(JSON.stringify(plan,null,2));
