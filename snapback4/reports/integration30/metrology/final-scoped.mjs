import {planAffected,runPlan} from '/home/ccheever/projects/snapback-sb4loop/snapback4/scripts/affected.mjs';
import {writeFileSync,existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root='/home/ccheever/projects/snapback-sb4loop',out='/home/ccheever/sb4-loop/reports/integration30/final-affected';
const original=planAffected({root,base:'2034c0de728a21250fac5686b88987f64c113a44',worktree:process.argv.includes('--worktree')});
writeFileSync(out+'/affected-original.json',JSON.stringify(original,null,2));
const changed=execFileSync('timeout',['30s','git','diff','--name-only',original.base,'HEAD'],{cwd:root,encoding:'utf8'}).trim().split('\n');
const extras=['proof-contract','proof-accounts','proof-serve-check','dx14-proof','dx15-production','day3-proofs','day4-proofs','day5-proofs','expo-toolchain','sdk-activation','schema-capabilities','device-version','sync-generation','rollback','write-authority','test-platform-audit','packaged-docs','query-observation','client-upload','upload','auth'];
const files=[...new Set([...changed.filter(f=>/^snapback4\/packages\/snapback4\/test\/.*\.test\.mjs$/.test(f)).map(f=>f.replace(/^snapback4\//,'')),...extras.map(f=>`packages/snapback4/test/${f}.test.mjs`)])].filter(f=>existsSync(root+'/snapback4/'+f));
const omitted=[];const steps=original.steps.flatMap(s=>{
 if(['rust:snapback4-device','rust:snapback4-difftest','rust:snapback4-native','rust:snapback4-sim','client-models','lean-build','difftest:run-lean','difftest:run'].includes(s.id)){omitted.push(s);return [];}
 if(s.id==='client-tests')return [{...s,argv:['node','scripts/run-client-tests.mjs','4','files',...files],fileArgOffset:4,fileRequires:Object.fromEntries(files.map(f=>[f,['build-cli','build-wasm','build-client']]))}];
 return [s];
});
const plan={...original,steps,clientFiles:files,canonicalComplete:false,scopeNote:'Integration30 commissioned lean integration, matching Integration29: complete affected CLI/core/language Rust crates; all changed client tests and relevant proof/lifecycle/security/release consumers. The prohibited full reverse-dependency Rust/client/model pool is omitted explicitly. Short Lean and ordinary differential campaigns run separately with their literal results retained. Full original selector plan and every omitted command are retained. This is a scoped affected run, not full canonical selector qualification.',omitted};
writeFileSync(out+'/affected-scoped.json',JSON.stringify(plan,null,2));console.log(JSON.stringify({head:plan.head,steps:steps.map(s=>s.id),clients:files,omitted:omitted.map(s=>s.id)},null,2));
const r=await runPlan(plan,{root});writeFileSync(out+'/affected-result.json',JSON.stringify(r,null,2));if(!r.receipt.ok)process.exitCode=1;
