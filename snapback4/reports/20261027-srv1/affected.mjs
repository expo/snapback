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
const plan={...full,fullSelectorPlanExecuted:false,qualification:false,excludedChecks:[{test:'w8b_residency_measures_the_wired_calibration_shape',reason:'Unrelated bulk residency/performance fixture; no engine/language/residency change in SRV1'}],scopeReason:'SRV1 brief forbids complete client pool; preserve selected CLI crate and guide target, run serve/proof/initializer/worker/TOK1 consumers',clientFiles:files.map(f=>'snapback4/'+f),steps:full.steps.filter(s=>!['fixture-tests','client-models'].includes(s.id)).map(s=>{
 if(s.id==='rust:snapback4')return {...s,argv:['cargo','test','-p','snapback4','--bin','snapback4',...['init','init_dx3','init_production','lifecycle','token_live','cli_friction','store_handle_census'].flatMap(n=>['--test',n]),'--','--test-threads=2','--skip','w8b_residency_measures_the_wired_calibration_shape'],reason:'SRV1 CLI unit/serve/store-owner tests and initializer, lifecycle, live token, CLI and imported store-handle census integration targets'};
 if(s.id==='client-tests')return {...s,argv:['node','scripts/run-client-tests.mjs','2','files',...files],fileRequires:Object.fromEntries(files.map(f=>[f,['build-cli','build-wasm','build-client']]))};
 return s;
})};
const {receipt,receiptPath}=await runPlan(plan);
writeFileSync(join(ROOT,'target/affected/srv1-latest.json'),JSON.stringify({receiptPath,head:receipt.head,ok:receipt.ok},null,2)+'\n');
if(!receipt.ok)process.exitCode=1;
