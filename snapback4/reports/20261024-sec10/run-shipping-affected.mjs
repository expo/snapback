// SEC10 final precision: retain the conservative plan and verify its actual delta.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,readFileSync,readdirSync,copyFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const out=resolve(process.argv[2]??'/home/ccheever/sb4-loop/sec10-shipping-affected');mkdirSync(out,{recursive:true});
const plan=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync(resolve(out,'unadjusted-plan.json'),JSON.stringify(plan,null,2)+'\n');
const prior='a9fcd81503b7c8156e9480282024e3fef346d20e';
const committed=execFileSync('timeout',['20s','git','diff','--name-only',prior,'HEAD','--','snapback4/crates'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const local=execFileSync('timeout',['20s','git','diff','--name-only','HEAD','--','snapback4/crates'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const newFiles=execFileSync('timeout',['20s','git','ls-files','--others','--exclude-standard','--','snapback4/crates'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const inputs=[...new Set([...committed,...local,...newFiles])].sort();
const allowed=path=>path.startsWith('snapback4/crates/snapback4-lang/src/bind/security/')||path==='snapback4/crates/snapback4-lang/src/bind/security.rs'||path.startsWith('snapback4/crates/snapback4-lang/src/guide/')||path.startsWith('snapback4/crates/snapback4-lang/tests/security')||path.startsWith('snapback4/crates/snapback4-lang/tests/guide/')||path==='snapback4/crates/snapback4/src/verbs.rs'||path==='snapback4/crates/snapback4/src/note_rank.rs'||path==='snapback4/crates/snapback4/src/verbs/security.rs'||path.startsWith('snapback4/crates/snapback4/src/verbs/security/')||path.startsWith('snapback4/crates/snapback4/src/verbs/security_reviews')||['dx11.rs','security_reviews.rs','wave26_security.rs'].some(name=>path==='snapback4/crates/snapback4/tests/'+name);
if(inputs.some(path=>!allowed(path)))throw new Error('unclassified production delta: '+inputs.filter(path=>!allowed(path)).join(', '));
const predecessor='/home/ccheever/sb4-loop/sec10-r43-portable';
const evidence=JSON.parse(readFileSync(resolve(predecessor,'qualification-supplement.json'),'utf8'));
if(evidence.introducedUnresolvedRegressionFailures!==0||evidence.newLeanDisagreements!==0)throw new Error('predecessor evidence has unresolved introduced failures');
const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
const crates=['snapback4-lang','snapback4'];
const clients=['sec10-packed','security-packed','visible-text','list-lower-bounds','dx9-packed','dx11-picker'].map(name=>`snapback4/packages/snapback4/test/${name}.test.mjs`);
const keep=new Set(['install-client','build-cli','build-wasm','build-client','typecheck:snapback4','release-guard','client-tests','docs-budget','packaged-docs','diagnostics','inventories','generated','guide','ref-check','wasm-measurement',...crates.map(name=>'rust:'+name)]);
const omitted=plan.steps.filter(step=>!keep.has(step.id)).map(step=>({id:step.id,reason:step.reason}));
plan.scopeAdjustment={authority:'SEC10 third follow-up: precision and shipping; affected scope; no full suites or client pool; reasonable scope adjustment preapproved under LLP0189D-2/LLP0232',priorQualifiedCommit:prior,selectedMain:'5059edecb3416a993b61604c7c91e5f97efe3130',priorQualification:predecessor,priorSupplementSha256:hash(resolve(predecessor,'qualification-supplement.json')),changedRustInputs:inputs,omitted,reason:'Core/device/store/planner/grammar inputs are unchanged from the source-bound prior qualification. Current changes are security inference, campaign input reach, CLI review/check/deploy semantics, docs and their tests. Re-run all language security/unit targets plus guide, all CLI units plus five security/DX11 integrations, all six selected packed/process/Wasm clients and root/build guards. Reuse unchanged core/device coverage and the original 2k semantic differential evidence, including its explicitly inherited Lean red; do not relabel it PASS. Retain the raw conservative seven-crate/full-client plan.'};
plan.steps=plan.steps.filter(step=>keep.has(step.id));plan.rustPackages=crates;plan.clientFiles=clients;plan.fixtureFiles=[];
const language=readdirSync('snapback4/crates/snapback4-lang/tests').filter(name=>name.endsWith('.rs')&&/security/i.test(name)).map(name=>name.slice(0,-3)).sort();language.push('guide');
let rust=[];
for(const step of plan.steps){
 step.requires=(step.requires??[]).filter(id=>keep.has(id));
 if(step.id==='client-tests'){
  step.argv=[...step.argv.slice(0,step.fileArgOffset),...clients.map(path=>path.slice('snapback4/'.length))];
  step.fileRequires=Object.fromEntries(clients.map(path=>[path.slice('snapback4/'.length),['build-cli','build-client','build-wasm']]));
  if(process.env.SEC10_QUALIFIED_NATIVE){step.argv=['env',`SNAPBACK4_BIN=${resolve(process.env.SEC10_QUALIFIED_NATIVE)}`,...step.argv];step.fileArgOffset+=2;}
 }
 if(step.id==='wasm-measurement')step.argv=['bash','scripts/measure-wasm.sh','--no-record'];
 if(step.id==='rust:snapback4'){
  const i=step.argv.indexOf('--');step.argv.splice(i,0,'--bin','snapback4',...['security_reviews','security_wave19','wave26_security','dx11','dx11_refusals'].flatMap(name=>['--test',name]));step.argv=step.argv.map(arg=>arg.startsWith('--test-threads=')?'--test-threads=1':arg);rust.push(step);
 }
 if(step.id==='rust:snapback4-lang'){
  const i=step.argv.indexOf('--');const prefix=step.argv.slice(0,i);const groups=[[],[],[],[]];const loads=[30,0,0,0];const weights={security_histories:644,security_sec6:307,security_sec10:205,security_sec8:138,security_sec4:113,security_wave27:100,security_wave27_conservation:90,security_wave16:84,security_sec5_refutations:74,security_sec7:71};
  for(const name of [...language].sort((a,b)=>(weights[b]??30)-(weights[a]??30)||a.localeCompare(b))){const n=loads.indexOf(Math.min(...loads));groups[n].push(name);loads[n]+=weights[name]??30;}
  if(JSON.stringify(groups.flat().sort())!==JSON.stringify([...language].sort()))throw new Error('language shard set drift');
  rust.push(...groups.map((names,n)=>({...step,id:`rust:snapback4-lang:${n+1}`,argv:[...prefix,...(n===0?['--lib']:[]),...names.flatMap(name=>['--test',name]),'--','--test-threads=8']})));
  plan.scopeAdjustment.languageShards=groups;
 }
}
const group={id:'rust:affected-scope',cwd:'snapback4',argv:['node','reports/20261024-sec10/run-rust-scope.mjs',JSON.stringify(rust),out],reason:'Execute the exact selected security/unit targets with ordinary Cargo locks',timeoutSeconds:10800,requires:[...new Set(rust.flatMap(step=>step.requires??[]))]};
const first=plan.steps.findIndex(step=>step.id.startsWith('rust:'));plan.steps=plan.steps.filter(step=>!step.id.startsWith('rust:'));plan.steps.splice(first,0,group);
if(process.env.SEC10_QUALIFIED_NATIVE){const native=resolve(process.env.SEC10_QUALIFIED_NATIVE);plan.scopeAdjustment.packedNative={path:native,sha256:hash(native)};}
writeFileSync(resolve(out,'scoped-plan.json'),JSON.stringify(plan,null,2)+'\n');
const {receiptPath,receipt}=await runPlan(plan);copyFileSync(receiptPath,resolve(out,'receipt.json'));process.exitCode=receipt.ok?0:1;
