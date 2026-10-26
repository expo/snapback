// The brief forbids the full crate/client pool even when the selector fails broad.
// Preserve that plan, then run its affected steps with the explicit lane override.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,copyFileSync,readFileSync,readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out=resolve(process.argv[2]??'/home/ccheever/sb4-loop/sec10-affected');mkdirSync(out,{recursive:true});
const plan=planAffected({base:'origin/main',worktree:true});
writeFileSync(resolve(out,'unadjusted-plan.json'),JSON.stringify(plan,null,2)+'\n');
const crates=['snapback4-core','snapback4-lang','snapback4','snapback4-device'];
const clients=['snapback4/packages/snapback4/test/sec10-packed.test.mjs','snapback4/packages/snapback4/test/security-packed.test.mjs','snapback4/packages/snapback4/test/visible-text.test.mjs','snapback4/packages/snapback4/test/list-lower-bounds.test.mjs','snapback4/packages/snapback4/test/dx9-packed.test.mjs','snapback4/packages/snapback4/test/dx11-picker.test.mjs'];
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
const finalDelta=process.argv.includes('--final-delta');
if(finalDelta){
 const predecessor=resolve(out,'../sec10-w28-final-affected');
 const results=JSON.parse(readFileSync(resolve(predecessor,'rust-results.json'),'utf8'));
 const expected=new Map([['rust:snapback4',0],['rust:snapback4-core',0],['rust:snapback4-lang',101],['rust:snapback4-device',101]]);
 for(const result of results){if(result.status!==expected.get(result.id))throw new Error(`unexpected predecessor result ${result.id}: ${result.status}`);}
 if(results.length!==4)throw new Error('missing full-package predecessor evidence');
 const known=new Set(['generated_column_worlds_decline_changed_recorded_captures','directed_wave22_pickup_and_suspension_refute_spec_intent','census::authoring_census']);
 const actual=results.flatMap(result=>[...readFileSync(result.log,'utf8').matchAll(/^test (.+) \.\.\. FAILED$/gm)].map(match=>match[1]));
 if(actual.length!==3||actual.some(name=>!known.has(name)))throw new Error(`unclassified predecessor failures: ${actual.join(', ')}`);
 const allowed=new Set(['snapback4/crates/snapback4-lang/src/bind/security/derived/stage_columns.rs','snapback4/crates/snapback4/src/verbs/security.rs','snapback4/crates/snapback4/src/verbs/security/derived_tests.rs','snapback4/crates/snapback4-lang/tests/security_wave28.rs','snapback4/crates/snapback4-lang/tests/security_observers.rs','snapback4/crates/snapback4-device/tests/readauth/census.txt','snapback4/crates/snapback4-lang/src/bind/security/challenges.rs','snapback4/crates/snapback4-lang/src/bind/security/challenges/generated.rs']);
 const incoming=execFileSync('timeout',['10s','git','diff','--name-only','45d6a1a56b8850b25ca36189276b2453cc87b349','da64e0ee2df1c772d43d3bc439b1bbdffa8bcb56','--','snapback4/crates'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 for(const path of incoming)allowed.add(path);
 execFileSync('timeout',['10s','git','merge-base','--is-ancestor','da64e0ee2df1c772d43d3bc439b1bbdffa8bcb56','HEAD']);
 const changed=execFileSync('timeout',['10s','git','diff','--name-only','50b7dbd05f','HEAD','--','snapback4/crates'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
 if(changed.some(path=>!allowed.has(path)))throw new Error(`Rust source exceeds reviewed final delta: ${changed.join(', ')}`);
 const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
 plan.scopeAdjustment.contentBoundReuse={authority:'LLP0189D-2/LLP0232 and SEC10 preapproved affected-scope adjustments',precursorInitialCommit:'50b7dbd05f',selectedMain:'da64e0ee2df1c772d43d3bc439b1bbdffa8bcb56',upstreamRustInputs:incoming,upstreamQualification:'snapback4/reports/integration26/ plus the pinned G7-E owner qualification; rerun merged core units and all SEC10/DX11 security consumers',predecessorResults:resolve(predecessor,'rust-results.json'),predecessorResultsSha256:hash(resolve(predecessor,'rust-results.json')),predecessorFailures:actual,changedRustInputs:changed,explanation:'The complete four-package precursor started at50b7dbd05f; core, CLI and device finished before the reviewed delta. Language execution overlaps targeted rebuilds and its aggregate receipt is superseded, never represented as source-frozen or passing. Reuse only unchanged non-security semantic inputs; no language security-target evidence is reused. No failed precursor target is represented as passing; the exact authored suspension regression and spent-workflow continuation are repaired without weakening assertions. Re-run all core units, all language units/security integration targets, all CLI units and its SEC10/DX11 security integration targets, and all device read-authority tests including the corrected census. Retain the six packed/process/Wasm/output clients and all selected root, build, Unicode, Lean and 2k differential checks.'};
 const language=readdirSync(resolve('snapback4/crates/snapback4-lang/tests')).filter(name=>name.endsWith('.rs')&&/security/i.test(name)).map(name=>name.slice(0,-3)).sort();
 for(const step of plan.steps.filter(step=>step.id.startsWith('rust:'))){
  const index=step.argv.indexOf('--');if(index<0)throw new Error('missing Cargo test separator');
  const selected=step.id==='rust:snapback4-core'?['--lib']:step.id==='rust:snapback4-device'?['--test','readauth']:step.id==='rust:snapback4'?['--bin','snapback4','--test','security_reviews','--test','security_wave19','--test','wave26_security','--test','dx11','--test','dx11_refusals']:['--lib',...language.flatMap(name=>['--test',name])];
  step.argv.splice(index,0,...selected);
 }
}
const rust=plan.steps.filter(step=>step.id.startsWith('rust:'));
for(const step of rust){const threads=step.id==='rust:snapback4-lang'?'16':step.id==='rust:snapback4-core'?'8':step.id==='rust:snapback4-device'?'4':'1';step.argv=step.argv.map(arg=>arg.startsWith('--test-threads=')?`--test-threads=${threads}`:arg);}
for(const step of plan.steps){if(step.id==='wasm-measurement')step.argv=['bash','scripts/measure-wasm.sh','--no-record'];}
plan.scopeAdjustment.cheapGuards='Retain the client typecheck and release-feature negative build guards alongside the affected builds; omit only unrelated/broad pool work.';
plan.scopeAdjustment.metrology='Use canonical measure-wasm.sh --no-record; retain the line in the receipt without mutating source metrology. The pinned integrated gzip budget remains enforced; this lane adds no allowance.';
plan.scopeAdjustment.rustExecution=finalDelta?'Four final affected Rust commands with explicit content-bound target selection above; language16/core8/device4/CLI1 threads. Every selected target/feature runs; omitted precursor coverage is identified explicitly.':'Same four complete affected-package Cargo commands, concurrent across packages; language16/core8/device4/CLI1 threads on a96-core host. No target or feature omitted.';
const group={id:'rust:affected-scope',cwd:'snapback4',argv:['node','reports/20261024-sec10/run-rust-scope.mjs',JSON.stringify(rust),out],reason:'Run all four affected packages without serializing independent tests',timeoutSeconds:10800,requires:[...new Set(rust.flatMap(step=>step.requires??[]))]};
const first=plan.steps.findIndex(step=>step.id.startsWith('rust:'));plan.steps=plan.steps.filter(step=>!step.id.startsWith('rust:'));plan.steps.splice(first,0,group);
writeFileSync(resolve(out,'scoped-plan.json'),JSON.stringify(plan,null,2)+'\n');
const {receiptPath,receipt}=await runPlan(plan);copyFileSync(receiptPath,resolve(out,'receipt.json'));
process.exitCode=receipt.ok?0:1;
