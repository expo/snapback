// Final affected receipt; preserve the conservative selector plan and disclose narrowing.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
process.env.SNAPBACK4_INIT_INSTALL='0';
const logs=['logs','snapback4/logs'];
if(logs.some(p=>existsSync(join(ROOT,p))))throw Error('clean task-owned logs before binding the final snapshot');
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/tok1-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,reason:'TOK1 affected behavior plus inherited DX14/DX15 consumer surfaces; complete Rust/client suites forbidden by brief',timeoutSeconds,requires:[]});
const clientFiles=['tok1-reading','proof-contract','dx13-proof','dx14-client-proof','dx15-proof','http-bounds','overload','proof','day4-proofs','test-platform-audit','packaged-docs'];
const plan={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'Shared manifest/guide inputs and inherited DX14/DX15 close the conservative selector across seven Rust packages and the entire client pool. Brief explicitly forbids those complete suites; use the same disclosed runPlan narrowing as DX14/DX15.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length,priorScopedEvidence:'All 80 proof/day3/day4/day5/platform tests passed; integrated Day3 passed (517s) in the preliminary receipt. The final run verifies only ref-comment/verification changes since then before reusing that expensive file. Initial init calibration passed and is omitted from repeats.'},steps:[
 step('cli-build','snapback4',['cargo','build','-p','snapback4']),
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('guide-and-types','snapback4',['cargo','test','-p','snapback4-lang','--test','guide','--test','mutation_result_types','--test','maintained_result_types','--test','emit_compatibility']),
 step('init-and-reading','snapback4',['cargo','test','-p','snapback4','--test','init','--test','tok1','--','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('cli-output','snapback4',['cargo','test','-p','snapback4','--test','dx14_output','--test','dx15_inspection']),
 step('cli-flags','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','cli_flags::']),
 step('reading-history','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','guide_seen::']),
 step('prior-expensive-day3','.', ['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';const log=readFileSync('target/affected/tok1-preliminary.log','utf8');if(!log.includes('-- client file ok: packages/snapback4/test/day3-proofs.test.mjs'))throw Error('prior Day3 did not pass');const changed=execFileSync('git',['diff','--name-only','55d2e53da6','HEAD'],{encoding:'utf8'}).trim().split(String.fromCharCode(10)).filter(Boolean);const refs=['snapback4/crates/snapback4-lang/src/guide/start.rs','snapback4/crates/snapback4-lang/src/guide/discovery.rs'];const allowed=p=>p.startsWith('snapback4/reports/20261027-tok1/')||refs.includes(p);if(changed.some(p=>!allowed(p)))throw Error('Day3 semantic inputs changed: '+changed.filter(p=>!allowed(p)));const patch=execFileSync('git',['diff','--unified=0','55d2e53da6','HEAD','--',...refs],{encoding:'utf8'});for(const line of patch.split(String.fromCharCode(10)))if((line.startsWith('+')||line.startsWith('-'))&&!line.startsWith('+++')&&!line.startsWith('---')&&!line.slice(1).trim().startsWith('// @ref LLP 3000.037.000#8'))throw Error('Rust behavior changed; rerun Day3');console.log('Reuse passed Day3 (517s): subsequent changes are reference comments and verification records only');"]),
 step('clients','snapback4',['node','scripts/run-client-tests.mjs','2','files',...clientFiles.map(n=>`packages/snapback4/test/${n}.test.mjs`)],3600),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('signature-drift','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('proof-reference-drift','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('root-check-receipt','.', ['node','--input-type=module','-e',"import{readFileSync}from'node:fs';import{execFileSync}from'node:child_process';const r=JSON.parse(readFileSync('target/affected/tok1-root-checks.json'));if(!r.checks.every(c=>c.ok))throw Error('root checks not passed');const changed=execFileSync('git',['diff','--name-only',r.commit,'HEAD'],{encoding:'utf8'}).trim().split('\\n').filter(Boolean).filter(p=>!p.startsWith('snapback4/')&&!p.startsWith('llp/reviews/')&&p!=='llp/3000.037.000-wave-30-default-verdict-and-password-starters.rfc.md');if(changed.length)throw Error('root inputs changed: '+changed);console.log('Root generated, inventory and guide checks passed on unchanged root inputs')"]),
 step('cleanup-owned-logs','.', ['node','-e',"const f=require('node:fs');for(const p of ['logs','snapback4/logs'])if(f.existsSync(p))f.rmSync(p,{recursive:true});console.log('task proof logs removed')"]),
 step('refs','.', ['./ref-check']),
]};
const{receiptPath,receipt}=await runPlan(plan);
console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));
if(!receipt.ok)process.exitCode=1;
