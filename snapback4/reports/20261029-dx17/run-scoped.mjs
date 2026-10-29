// Retain the selector's conservative complete plan; the brief forbids its full
// shared-guide/client expansion. Use its unchanged-source receipt machinery.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
process.env.CARGO_BUILD_JOBS='4';process.env.RUST_TEST_THREADS='4';process.env.SNAPBACK4_INIT_INSTALL='0';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});writeFileSync(join(ROOT,'target/affected/dx17-full-plan.json'),JSON.stringify(full,null,2));
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,timeoutSeconds,requires:[],reason:'DX17 actual release presentation, guide, wrapper and packed-consumer dependencies; complete pool prohibited by workstream brief'});
const cli=['tok2_output','dx16','tok1','dx11','dx11_refusals','day5_previews','cli_friction'];
const clients=['dx17-day2-check','tok2-output','dx16-proof','ver1-loop','dx12-serve','dx10-process-accounts','packaged-docs','qualify-linux','test-platform-audit'];
const plan={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'Shared guide/command-table inputs conservatively select the complete workspace/client pool. The brief prohibits it. Retain full plan and execute affected presentation/guide/CLI/consumer checks with runPlan.',fullStepCount:full.steps.length,fullClientFiles:full.clientFiles.length,rootInventories:'Snapback 4 fence excludes Snapback 1 inventory/generated/bootstrap gates; Snapback 4 guide, shipped paths, API/proof generation and packed consumer checks are included.'},steps:[
 step('cli-build','snapback4',['cargo','build','-p','snapback4']),
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('cli-unit','snapback4',['cargo','test','-p','snapback4','--bin','snapback4']),
 step('cli-consumers','snapback4',['cargo','test','--no-fail-fast','-p','snapback4',...cli.flatMap(x=>['--test',x])],5400),
 step('guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('platform-test-binary','snapback4',['node','--input-type=module','-e',"import{copyFileSync,chmodSync}from'node:fs';copyFileSync('target/debug/snapback4','packages/snapback4-linux-x64/snapback4');chmodSync('packages/snapback4-linux-x64/snapback4',0o755)"]),
 step('client-consumers','snapback4',['node','scripts/run-client-tests.mjs','2','files',...clients.map(x=>`packages/snapback4/test/${x}.test.mjs`)],5400),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import{lintPackagedDocs}from'./scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('api-signature-drift','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('proof-reference-drift','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('announced-cli-help','snapback4',['node','scripts/check-verb-help.mjs','target/debug/snapback4']),
 step('cleanup-platform-test-binary','snapback4',['node','--input-type=module','-e',"import{rmSync}from'node:fs';rmSync('packages/snapback4-linux-x64/snapback4',{force:true})"]),
 step('refs','.', ['./ref-check'])
]};
const {receiptPath,receipt}=await runPlan(plan);console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));if(!receipt.ok)process.exitCode=1;
