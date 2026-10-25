// Task-bounded execution of the affected plan. This is not the complete battery.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/dx11-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv)=>({id,cwd,argv,reason:'DX11 brief: touched-code regression scope; complete battery/client pool explicitly excluded',timeoutSeconds:1800,requires:[]});
const client='snapback4/packages/snapback4/test/';
const scoped={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'The commissioned brief prohibits the full crate battery and full client pool; the conservative selector expands to both on these shared inputs.',fullRustPackages:full.rustPackages,fullClientFiles:full.clientFiles.length,fullStepCount:full.steps.length},steps:[
 step('dx11-cli','snapback4',['cargo','test','-p','snapback4','--test','dx11','--test','dx11_refusals','--test','wave26_security']),
 step('dx11-core-observers','snapback4',['cargo','test','-p','snapback4-core','--features','test-support','--lib','engine::sequences::tests','--','--test-threads=4']),
 step('dx11-guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('dx11-wasm','snapback4',['bash','scripts/build-wasm.sh']),
 step('dx11-client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('dx11-client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('dx11-client-regressions','.', ['node','--test',...['use-page-cursor','upload-retry','react','staging','dx11-picker','dx9-packed'].map(n=>client+n+'.test.mjs')]),
 step('dx11-doc-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('dx11-packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('dx11-diagnostics','.', ['node','scripts/generate-diagnostics-registry.mjs','--check']),
 step('dx11-refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(scoped);
console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false}));
if(!receipt.ok)process.exitCode=1;
