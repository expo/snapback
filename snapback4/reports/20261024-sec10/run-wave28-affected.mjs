// The brief forbids the full crate/client pool even when the selector fails broad.
// Preserve that plan, then run its affected steps with the explicit lane override.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,copyFileSync} from 'node:fs';
import {resolve} from 'node:path';
const out=resolve(process.argv[2]??'/home/ccheever/sb4-loop/sec10-affected');mkdirSync(out,{recursive:true});
const plan=planAffected({base:'origin/main',worktree:true});
writeFileSync(resolve(out,'unadjusted-plan.json'),JSON.stringify(plan,null,2)+'\n');
const crates=['snapback4-core','snapback4-lang','snapback4','snapback4-device'];
const clients=['snapback4/packages/snapback4/test/sec10-packed.test.mjs','snapback4/packages/snapback4/test/security-packed.test.mjs','snapback4/packages/snapback4/test/visible-text.test.mjs','snapback4/packages/snapback4/test/list-lower-bounds.test.mjs'];
const keep=new Set(['install-client','build-cli','build-wasm','build-client','typecheck:snapback4','release-guard','client-tests','docs-budget','packaged-docs','diagnostics','inventories','generated','guide','ref-check','wasm-measurement','lean-build','difftest:run-lean','difftest:run',...crates.map(name=>'rust:'+name)]);
const omitted=plan.steps.filter(step=>!keep.has(step.id)).map(step=>({id:step.id,reason:step.reason}));
plan.scopeAdjustment={authority:'SEC10 brief: affected scope; no full suites, full client pool, difftest 20k or qualify-linux; reasonable scope adjustments preapproved',reason:'The canonical selector conservatively selects seven Rust crates and the complete client pool. The commission forbids full suites/pools and preapproves affected-scope adjustments. Run the four directly affected crates (core, language, CLI, device), both installed security consumers, actual process/Wasm visible-text parity and existing list-bound clients. Retain Lean build plus both required 2,000-case campaigns. Unicode minimum/trim semantics and recursive text-list constraints are new core/language behavior; this scope makes no claim that text semantics are unchanged. Incoming main retains upstream qualification.',omitted};
plan.steps=plan.steps.filter(step=>keep.has(step.id));
plan.rustPackages=crates;plan.clientFiles=clients;plan.fixtureFiles=[];
for(const step of plan.steps){
 if(step.id==='client-tests'){step.argv=[...step.argv.slice(0,step.fileArgOffset),...clients.map(path=>path.slice('snapback4/'.length))];step.fileRequires=Object.fromEntries(clients.map(path=>[path.slice('snapback4/'.length),['build-cli','build-client','build-wasm']]));}
 step.requires=(step.requires??[]).filter(id=>keep.has(id));
}
// This 96-core host can run the four independent packages in parallel. Keep
// CLI's process-global custody tests serial within that package.
const rust=plan.steps.filter(step=>step.id.startsWith('rust:'));
for(const step of rust){const threads=step.id==='rust:snapback4-lang'?'16':step.id==='rust:snapback4-core'?'8':step.id==='rust:snapback4-device'?'4':'1';step.argv=step.argv.map(arg=>arg.startsWith('--test-threads=')?`--test-threads=${threads}`:arg);}
for(const step of plan.steps){if(step.id==='wasm-measurement')step.argv=['bash','scripts/measure-wasm.sh','--no-record'];}
plan.scopeAdjustment.cheapGuards='Retain the client typecheck and release-feature negative build guards alongside the affected builds; omit only unrelated/broad pool work.';
plan.scopeAdjustment.metrology='Use canonical measure-wasm.sh --no-record; retain the line in the receipt without mutating source metrology. The unchanged gzip budget remains enforced.';
plan.scopeAdjustment.rustExecution='Same four complete affected-package Cargo commands, concurrent across packages; language 16/core 8/device 4/CLI 1 test threads on a 96-core host. No target or feature omitted.';
const group={id:'rust:affected-scope',cwd:'snapback4',argv:['node','reports/20261024-sec10/run-rust-scope.mjs',JSON.stringify(rust),out],reason:'Run all four affected packages without serializing independent tests',timeoutSeconds:10800,requires:[...new Set(rust.flatMap(step=>step.requires??[]))]};
const first=plan.steps.findIndex(step=>step.id.startsWith('rust:'));plan.steps=plan.steps.filter(step=>!step.id.startsWith('rust:'));plan.steps.splice(first,0,group);
writeFileSync(resolve(out,'scoped-plan.json'),JSON.stringify(plan,null,2)+'\n');
const {receiptPath,receipt}=await runPlan(plan);copyFileSync(receiptPath,resolve(out,'receipt.json'));
process.exitCode=receipt.ok?0:1;
