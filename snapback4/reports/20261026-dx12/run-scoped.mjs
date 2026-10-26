// Task-bounded affected verification. Never claims full client-pool qualification.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/dx12-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,reason:'DX12 touched-code verification; brief excludes complete client pool',timeoutSeconds,requires:[]});
const prefix='snapback4/packages/snapback4/test/';
const scoped={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'The conservative selector expands shared await-support and CLI imports to seven Rust crates and the complete client pool. The brief explicitly excludes both complete runs; this retained plan is executed only for the disclosed touched CLI/language and proof/packed-consumer steps.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length},steps:[
 step('build-cli','snapback4',['cargo','build','-p','snapback4']),
 step('build-client','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('cli','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','--','--test-threads=1'],1800),
 step('cli-output','snapback4',['cargo','test','-p','snapback4','--test','dx12_output','--test','dx11','--test','day5_previews','--test','day5_starters','--test','security_reviews','--test','wave26_security','--test','security_wave19','--test','roll_views','--test','surf4','--test','day3','--test','check'],3600),
 step('guides','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('clients','.', ['node','--test',...['proof-contract','proof','proof-fixtures','wave10-witness','dx10-process-accounts','dx12-serve','staging','day3-proofs','day4-proofs','day5-proofs','production-starters','dx9-packed','delivery-integrated'].map(n=>prefix+n+'.test.mjs')],3600),
 step('doc-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('proof-api','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('diagnostics','.', ['node','scripts/generate-diagnostics-registry.mjs','--check']),
 step('refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(scoped);console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false}));if(!receipt.ok)process.exitCode=1;
