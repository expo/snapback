// The user forbids the whole seven-crate / 451-file expansion. Retain its exact
// plan and run the affected release, bridge, finite-runner and generated proofs.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(resolve(root,'target/affected'),{recursive:true});
writeFileSync(resolve(root,'target/affected/lat4-full-plan.json'),JSON.stringify(plan,null,2)+'\n');
const names=['proof','proof-contract','proof-fixtures','proof-runner','staging','production-starters',
 'day3-proofs','day4-proofs','day5-proofs','dx13-proof','dx14-client-proof','dx15-proof',
 'release-activation','release-transitions','release-capabilities','wave14-release-preview',
 'test-platform-audit','packaged-docs'];
const files=plan.clientFiles.filter(path=>names.some(name=>path.endsWith(`/${name}.test.mjs`))).map(path=>path.slice('snapback4/'.length));
for(const name of names)if(!files.some(path=>path.endsWith(`/${name}.test.mjs`)))throw Error('missing affected consumer '+name);
const allowed=new Set(['install-client','build-cli','build-wasm','build-client','typecheck:snapback4',
 'rust:snapback4','rust:snapback4-lang','client-tests','docs-budget','packaged-docs','ref-check','selector-tests']);
const omittedSteps=plan.steps.filter(s=>!allowed.has(s.id)).map(s=>s.id),fullRustPackages=[...plan.rustPackages];
const replacedSteps=[];
plan.steps=plan.steps.filter(s=>allowed.has(s.id)).flatMap(step=>{
 if(step.id==='rust:snapback4-lang') {
  replacedSteps.push(step.id+' -> language release/bridge/compiler lib + guide targets');
  return [{...step,id:'rust:snapback4-lang:release',argv:['cargo','test','-p','snapback4-lang','--lib','release_','--','--test-threads=4']},
   {...step,id:'rust:snapback4-lang:guide',argv:['cargo','test','-p','snapback4-lang','--test','guide','--','--test-threads=4']}];
 }
 if(step.id==='rust:snapback4') {
  replacedSteps.push(step.id+' -> native release + generated scaffold unit targets');
  return [{...step,id:'rust:snapback4:release',argv:['cargo','test','-p','snapback4','--bin','snapback4','release','--','--test-threads=4']},
   {...step,id:'rust:snapback4:init',argv:['cargo','test','-p','snapback4','--bin','snapback4','verbs::init::','--','--test-threads=4']}];
 }
 if(step.id==='client-tests')return [{...step,argv:['node','scripts/run-client-tests.mjs','3','files',...files],fileRequires:Object.fromEntries(files.map(path=>[path,step.fileRequires[path]??[]]))}];
 return [step];
});
plan.clientFiles=plan.clientFiles.filter(path=>names.some(name=>path.endsWith(`/${name}.test.mjs`)));
plan.rustPackages=['snapback4','snapback4-lang'];
plan.scopeOverride={reason:'User forbids full five-crate/client batteries; shared inputs conservatively select seven crates and every client file.',canonicalComplete:false,qualification:false,selectedClientFiles:files,fullRustPackages,omittedSteps,replacedSteps,legacyRoot:'Snapback 1 guide/diagnostic/generated inventory has unchanged semantic inputs and is outside the Snapback4 fence. Its attempted inventory run independently reports missing generated Contract snippets; no waiver or legacy generator change.'};
const result=await runPlan(plan,{root});
console.log(JSON.stringify({receiptPath:result.receiptPath,ok:result.receipt.ok,scopeOverride:plan.scopeOverride}));
process.exitCode=result.receipt.ok?0:1;
