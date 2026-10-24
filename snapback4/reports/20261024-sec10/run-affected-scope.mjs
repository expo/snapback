// The brief forbids the full crate/client pool even when the selector fails broad.
// Preserve that plan, then run its affected steps with the explicit lane override.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve(process.argv[2]??'/home/ccheever/sb4-loop/sec10-affected');mkdirSync(out,{recursive:true});
const plan=planAffected({base:'origin/main',worktree:true});
writeFileSync(resolve(out,'unadjusted-plan.json'),JSON.stringify(plan,null,2)+'\n');
const crates=['snapback4-core','snapback4-lang','snapback4'];
const clients=['snapback4/packages/snapback4/test/sec10-packed.test.mjs','snapback4/packages/snapback4/test/security-packed.test.mjs'];
const keep=new Set(['install-client','build-cli','build-wasm','build-client','client-tests','docs-budget','packaged-docs','diagnostics','inventories','generated','guide','ref-check','wasm-measurement',...crates.map(name=>'rust:'+name)]);
const omitted=plan.steps.filter(step=>!keep.has(step.id)).map(step=>({id:step.id,reason:step.reason}));
plan.scopeAdjustment={authority:'SEC10 brief: affected scope; no full suites, full client pool, difftest 20k or qualify-linux; reasonable scope adjustments preapproved',reason:'The closed ticket is an unowned root path and publication-security is shared support. Both force the broad seven-crate/438-client plan. Only core private fixture observation, language security analysis, CLI check/deploy and two installed security consumers changed. No parser, planner or store semantics changed in this lane; existing text minima remain unchanged. Incoming origin/main runtime changes retain their upstream qualification and are exercised by the three affected crates here.',omitted};
plan.steps=plan.steps.filter(step=>keep.has(step.id));
plan.rustPackages=crates;plan.clientFiles=clients;plan.fixtureFiles=[];
for(const step of plan.steps){
 if(step.id==='client-tests'){step.argv=[...step.argv.slice(0,step.fileArgOffset),...clients.map(path=>path.slice('snapback4/'.length))];step.fileRequires=Object.fromEntries(clients.map(path=>[path.slice('snapback4/'.length),['build-cli','build-client','build-wasm']]));}
 step.requires=(step.requires??[]).filter(id=>keep.has(id));
}
writeFileSync(resolve(out,'scoped-plan.json'),JSON.stringify(plan,null,2)+'\n');
const {receiptPath,receipt}=await runPlan(plan);copyFileSync(receiptPath,resolve(out,'receipt.json'));
process.exitCode=receipt.ok?0:1;
