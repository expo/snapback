import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,readdirSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
const output=process.argv[2];if(!output)throw Error('output prefix required');
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync(`${output}.original.json`,JSON.stringify(plan,null,2)+'\n');
const retained=new Set(['install-client','build-cli','build-wasm','build-client','rust:snapback4-core','docs-budget','packaged-docs','ref-check','release-guard','selector-tests']);
const original=plan.steps;
plan.steps=original.filter(s=>retained.has(s.id));
const cargo=(id,args,reason)=>({id,cwd:'snapback4',argv:['cargo',...args],timeoutSeconds:3600,requires:[],reason});
const languageTargets=readdirSync(`${root}/snapback4/crates/snapback4-lang/tests`).filter(f=>/^security.*\.rs$/.test(f)).map(f=>f.slice(0,-3));
const lang=cargo('rust:language-security',['test','--no-fail-fast','-p','snapback4-lang','--lib','--test','guide',...languageTargets.flatMap(t=>['--test',t]),'--','--test-threads=8'],'Changed campaign engine: library plus all security integration targets, including generated fixtures and authority boundaries');
const pg=cargo('rust:core-postgres-compile',['test','-p','snapback4-core','--features','postgres','--lib','--no-run'],'Compile all Postgres-gated core tests after private code ownership conversion; no external PG cluster required');
const cli=cargo('rust:cli',['test','--no-fail-fast','-p','snapback4','--bin','snapback4','--test','store_handle_census','--','--test-threads=8'],'All CLI unit tests: releases, compiler scopes, current/pending reports, restoration, gates and evaluated answers; incoming main store-handle census regression');
const packed={id:'client:packed-security',cwd:'snapback4',argv:['node','--test','packages/snapback4/test/security-packed.test.mjs'],timeoutSeconds:1800,requires:['build-cli','build-client'],reason:'Actual packed CLI/security behavior and decision custody'};
if(process.env.LAT1_PUBLICATION_BINARY){
 const binary=resolve(process.env.LAT1_PUBLICATION_BINARY);const sha256=createHash('sha256').update(readFileSync(binary)).digest('hex');
 plan.publicationBinary={path:binary,sha256};
 packed.argv=['env',`SNAPBACK4_BIN=${binary}`,`SNAPBACK4_SECURITY_PACK_EVIDENCE=${output}.packed`,...packed.argv];
 packed.reason+=`; frozen actual production binary SHA256 ${sha256}`;
}
const position=plan.steps.findIndex(s=>s.id==='rust:snapback4-core');plan.steps.splice(position+1,0,pg,lang,cli,packed);
plan.scopeNote='LAT1 explicit brief overrides conservative full closure: do not run seven-crate suite, full client pool, full difftest or qualify-linux. Complete core crate plus changed language campaign/security integrations, all CLI unit tests and packed consumer; supporting builds and applicable docs/ref/selector checks. No language/planner/store semantic change, so no differential/Lean semantic claim. Snapback 1 generated/guide/inventory checks are outside this fence and have unchanged inputs. The compiled Snapback 4 guide integration and packaged-doc budget cover its amended docs. Full original plan is preserved; canonicalComplete:false.';
plan.canonicalComplete=false;plan.omittedSteps=original.filter(s=>!retained.has(s.id)).map(s=>({id:s.id,reason:s.reason}));
for(const step of plan.steps){if(step.argv[0]==='cargo')step.argv.splice(2,0,'-j','16');}
plan.executionPolicy={cargoJobs:16,requiredScopeMemoryMax:'40G',maximumConcurrentHeavyJobs:2,maximumSurveyWorkers:4};
writeFileSync(`${output}.scoped.json`,JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({head:plan.head,steps:plan.steps.map(s=>s.id),scopeNote:plan.scopeNote},null,2));
const result=await runPlan(plan,{root});writeFileSync(`${output}.result.json`,JSON.stringify(result,null,2)+'\n');if(!result.receipt.ok)process.exitCode=1;
