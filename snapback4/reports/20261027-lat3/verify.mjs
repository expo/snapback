// Affected-scope override: the selector's conservative proof/doc import closure
// selects the entire 449-file client pool, explicitly excluded by this brief.
// Retain the full plan and Snapback 4 build/guide/docs steps; run the actual
// proof, browser, accounts, process, starter and platform consumers below.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(resolve(root,'target/affected'),{recursive:true});
writeFileSync(resolve(root,'target/affected/lat3-full-plan.json'),JSON.stringify(plan,null,2)+'\n');
const names=['proof','proof-contract','proof-fixtures','staging','production-starters',
 'day3-proofs','day4-proofs','day5-proofs','dx13-proof','dx14-client-proof','dx15-proof',
 'tok1-reading','test-platform-audit','wire-first','packaged-docs','wave11-upgrade-history','reg-upgrade'];
// Keep only names which exist in the selector's own selected client inventory.
const files=plan.clientFiles.filter(path=>names.some(name=>path.endsWith(`/${name}.test.mjs`))).map(path=>path.slice('snapback4/'.length));
for(const required of names.slice(0,13))if(!files.some(path=>path.endsWith(`/${required}.test.mjs`)))throw Error('missing scoped file '+required);
// Report/provenance leaves fail broad to seven whole Rust crates as well.
// Only a generated language-guide leaf changes; retain its actual guide target,
// not the prohibited full crate/device/model/fixture batteries. Legacy Snapback
// 1 generated/guide inventories are outside the explicit fence, as in SEC11L.
const allowed=new Set(['install-client','build-cli','build-wasm','build-client',
 'typecheck:snapback4','rust:snapback4-lang','rust:snapback4-lang:guide',
 'client-tests','docs-budget','packaged-docs','ref-check','selector-tests']);
const omittedSteps=plan.steps.filter(step=>!allowed.has(step.id)).map(step=>step.id);
const fullRustPackages=[...plan.rustPackages];
const replacedSteps=[];
plan.steps=plan.steps.filter(step=>allowed.has(step.id)).map(step=>{
 if(step.id!=='rust:snapback4-lang')return step;
 replacedSteps.push('rust:snapback4-lang -> rust:snapback4-lang:guide');
 return {...step,id:'rust:snapback4-lang:guide',argv:['cargo','test','--no-fail-fast','-p','snapback4-lang','--test','guide','--','--test-threads=4']};
});
const step=plan.steps.find(step=>step.id==='client-tests');
step.argv=['node','scripts/run-client-tests.mjs','1','files',...files];
step.fileRequires=Object.fromEntries(files.map(path=>[path,step.fileRequires[path]??[]]));
plan.clientFiles=plan.clientFiles.filter(path=>names.some(name=>path.endsWith(`/${name}.test.mjs`)));
plan.rustPackages=['snapback4-lang'];
plan.scopeOverride={reason:'User forbids whole Rust/client pools; common proof imports and report/provenance leaves fail broad.',fullSelectorPlanExecuted:false,qualification:false,selectedClientFiles:files,fullRustPackages,rustTargets:{'snapback4-lang':['guide']},omittedSteps,replacedSteps,legacyRoot:'Snapback 1 diagnostic/guide/generated inventories have unchanged semantic inputs and are outside the Snapback 4 fence. Snapback 4 guide target, packaged docs, docs budget, builds, selector tests and root ref-check retained.'};
const result=await runPlan(plan,{root});
console.log(JSON.stringify({receiptPath:result.receiptPath,ok:result.receipt.ok,scopeOverride:plan.scopeOverride}));
process.exitCode=result.receipt.ok?0:1;
