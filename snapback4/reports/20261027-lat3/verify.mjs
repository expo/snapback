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
// The root LLP edit also selects legacy Snapback 1 guide/generated inventories.
// Their inputs are unchanged and they are outside the explicit Snapback 4 fence
// (same scoped policy as reports/sec11-latency/tools/affected-scoped.mjs).
const omitted=new Set(['client-models','diagnostics','guide','inventories']);
const omittedSteps=plan.steps.filter(step=>omitted.has(step.id)).map(step=>step.id);
plan.steps=plan.steps.filter(step=>!omitted.has(step.id));
const step=plan.steps.find(step=>step.id==='client-tests');
step.argv=['node','scripts/run-client-tests.mjs','1','files',...files];
step.fileRequires=Object.fromEntries(files.map(path=>[path,step.fileRequires[path]??[]]));
plan.clientFiles=plan.clientFiles.filter(path=>names.some(name=>path.endsWith(`/${name}.test.mjs`)));
plan.scopeOverride={reason:'User forbids the complete client pool; common proof imports conservatively reach every client file.',fullSelectorPlanExecuted:false,qualification:false,selectedClientFiles:files,omittedSteps,legacyRoot:'Snapback 1 diagnostic/guide/generated inventories have unchanged semantic inputs and are outside the Snapback 4 fence. Snapback 4 guide target, packaged docs, docs budget, builds and root ref-check retained.'};
const result=await runPlan(plan,{root});
console.log(JSON.stringify({receiptPath:result.receiptPath,ok:result.receipt.ok,scopeOverride:plan.scopeOverride}));
process.exitCode=result.receipt.ok?0:1;
