// Disclosed affected scope: same runPlan receipts as the selector, no full suite.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const transientLogs=['logs','snapback4/logs'];
if(transientLogs.some(path=>existsSync(join(ROOT,path))))throw Error('remove only task-owned logs before binding the final snapshot');
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/dx15-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,reason:'DX15 affected implementation/consumer scope; brief excludes full Rust battery/client pool',timeoutSeconds,requires:[]});
const plan={...full,scopeOverride:{transientProofLogDirectoriesAbsentAtStart:transientLogs,fullSelectorPlanExecuted:false,qualification:false,reason:'Selector closes guide/client/command shared inputs across inherited DX14 and selects complete Rust/client suites forbidden by the brief. Same disclosed override used in DX14; exact full plan retained.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length},steps:[
 step('cli-build','snapback4',['cargo','build','--profile','test','-p','snapback4']),
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('guide-and-reading','snapback4',['cargo','test','-p','snapback4-lang','--test','guide','--test','dx15_guides']),
 step('cli-inspection','snapback4',['cargo','test','-p','snapback4','--test','dx15_inspection','--test','cli_friction']),
 step('cli-flags','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','cli_flags::']),
 step('clients','snapback4',['node','scripts/run-client-tests.mjs','2','files',...['init-typecheck','day5-proofs','dx15-proof','dx10-process-accounts','dx12-serve','dx14-client-proof','proof','proof-contract','staging','production-starters','identity-rate','client-seams','wave10-upgrade','wire-first'].map(name=>`packages/snapback4/test/${name}.test.mjs`)],3600),
 step('doc-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('proof-api','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('root-check-receipt','.', ['node','--input-type=module','-e',"import {readFileSync} from 'node:fs';import {execFileSync} from 'node:child_process';let r;for(let n=0;n<120;n++){try{r=JSON.parse(readFileSync('target/affected/dx15-root-checks.json'));break;}catch{await new Promise(done=>setTimeout(done,1000));}}if(!r)throw Error('root checks receipt pending');if(!r.checks.every(c=>c.ok))throw Error('root checks not passed');const changed=execFileSync('git',['diff','--name-only',r.commit,'HEAD'],{encoding:'utf8'}).trim().split('\\n').filter(Boolean).filter(p=>!p.startsWith('snapback4/')&&!p.startsWith('llp/reviews/')&&p!=='llp/3000.037.000-wave-30-default-verdict-and-password-starters.rfc.md');if(changed.length)throw Error('root check inputs changed: '+changed.join(','));console.log('Root generated/inventory/diagnostic checks already passed; root inputs unchanged. Final ref-check runs below.')"]),
 step('cleanup-owned-test-logs','.', ['node','-e',"const f=require('node:fs');for(const p of ['logs','snapback4/logs'])if(f.existsSync(p)){if(!f.lstatSync(p).isDirectory())throw Error('unexpected log path');f.rmSync(p,{recursive:true})}console.log('removed task logs bound absent at start')"]),
 step('refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(plan);
console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));
if(!receipt.ok)process.exitCode=1;
