// SRV1 affected scope: execute the selector engine while respecting the brief's
// ban on the entire client pool. Preserve the full conservative plan alongside it.
import {planAffected, runPlan, ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const full=planAffected({base:'origin/main'});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/srv1-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const names=['srv1-lifetime','tok1-reading','proof','proof-contract','dx12-serve','dx13-proof','dx15-proof','dx10-process-accounts','dx4-dev','native-opening','client-seams','init-recipe','init-typecheck','test-platform-audit','worker-regressions','supervised-workers','wave9-dx'];
const files=names.map(n=>`packages/snapback4/test/${n}.test.mjs`);
const plan={...full,fullSelectorPlanExecuted:false,qualification:false,scopeReason:'SRV1 brief forbids complete client pool; preserve selected CLI crate and guide target, run serve/proof/initializer/worker/TOK1 consumers',clientFiles:files.map(f=>'snapback4/'+f),steps:full.steps.filter(s=>!['fixture-tests','client-models'].includes(s.id)).map(s=>{
 if(s.id==='rust:snapback4')return {...s,argv:s.argv.map(v=>v==='--test-threads=1'?'--test-threads=2':v)};
 if(s.id==='client-tests')return {...s,argv:['node','scripts/run-client-tests.mjs','2','files',...files],fileRequires:Object.fromEntries(files.map(f=>[f,['build-cli','build-wasm','build-client']]))};
 return s;
})};
const {receipt,receiptPath}=await runPlan(plan);
writeFileSync(join(ROOT,'target/affected/srv1-latest.json'),JSON.stringify({receiptPath,head:receipt.head,ok:receipt.ok},null,2)+'\n');
if(!receipt.ok)process.exitCode=1;
