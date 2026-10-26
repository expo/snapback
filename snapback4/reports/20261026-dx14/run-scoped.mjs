// Disclosed task scope using the existing selector's execution/receipt machinery.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/dx14-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,reason:'DX14 affected source/consumer verification; brief excludes complete crate battery and client pool',timeoutSeconds,requires:[]});
const scoped={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'Same disclosed override as DX11/DX12: the selector treats embedded init assets as broad inputs and client sources select the entire client package. The brief explicitly forbids the complete crate battery and client pool. This receipt covers only the listed affected tests/checks.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length},steps:[
 step('build-cli-test-profile','snapback4',['cargo','build','--profile','test','-p','snapback4']),
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('language-regressions','snapback4',['cargo','test','-p','snapback4-lang','--test','wave31_dx14_language','--test','wave10_guard_notes','--test','wave11_docs','--test','wave12_rule_composition','--test','wave12_rule_recipes','--test','wave14_lang3','--test','wave9_rule_diagnostic_rewrites']),
 step('guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('cli-output','snapback4',['cargo','test','-p','snapback4','--test','dx14_output','--test','cli_friction'],3600),
 step('starter-units','snapback4',['cargo','test','-p','snapback4','--bin','snapback4','verbs::init::']),
 step('starter-integration','snapback4',['cargo','test','-p','snapback4','--test','init','--','--skip','w8b'],3600),
 step('clients','snapback4',['node','scripts/run-client-tests.mjs','2','files',...['api-index','dx14-client-proof','proof-contract','proof','proof-fixtures','dx13-proof','client-seams','client-lifecycle','app-handles','app-online-arm','staging','production-starters','first-account','readme-examples','upload-retry'].map(name=>`packages/snapback4/test/${name}.test.mjs`)],3600),
 step('doc-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('proof-api','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('generated','.', ['bash','scripts/check-generated-artifacts']),
 step('diagnostics','.', ['node','scripts/generate-diagnostics-registry.mjs','--check']),
 step('inventories','.', ['node','scripts/check-inventories.mjs']),
 step('refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(scoped);
console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));
if(!receipt.ok)process.exitCode=1;
