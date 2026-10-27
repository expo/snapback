// Use the selector's snapshot/receipt engine, explicitly disclosing the brief's
// prohibition on its conservative complete client pool/shared-input expansion.
import {planAffected,runPlan,ROOT} from '../../scripts/affected.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
process.env.CARGO_BUILD_JOBS='2';process.env.RUST_TEST_THREADS='4';
process.env.SNAPBACK4_INIT_INSTALL='0';
const full=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
mkdirSync(join(ROOT,'target/affected'),{recursive:true});
writeFileSync(join(ROOT,'target/affected/tok2-full-plan.json'),JSON.stringify(full,null,2)+'\n');
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,timeoutSeconds,requires:[],reason:'TOK2 affected presentation and its actual consumers; full shared-input client pool forbidden by brief'});
const targets=['tok2_output','dx11','dx11_refusals','dx12_output','dx14_output','dx15_inspection','day3','day4','day5_evidence','day5_previews','cli_friction','check','roll_views','security_reviews','tok1'];
const clients=['tok2-output','proof-contract','proof','day3-proofs','day4-proofs','day5-proofs','dx9-packed','dx10-process-accounts','dx14-client-proof','dx15-proof','tok1-reading','release-activation','wave11-narration','wave12-clauses','wave13-previews','wave13-surface','packaged-docs','test-platform-audit'];
const plan={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'The command registry and guide conservatively expand to the complete client pool. The brief forbids that pool and the five-crate suite. Retain the complete selector plan; run affected CLI/guide tests, all named text/machine consumers and doc checks through runPlan.',fullStepCount:full.steps.length,fullClientFiles:full.clientFiles.length,rootInventory:'Attempted in the preliminary receipt; unrelated Snapback 1 guide-manifest preconditions are missing (root dependencies and ignored Exact/Contract generated leaves). Snapback 4 AGENTS.md/NOT-DOING.md fence excludes those gates. Snapback 4 guide, packed docs, API generation and consumers remain selected.'},steps:[
 step('cli-build','snapback4',['cargo','build','-p','snapback4']),
 step('platform-test-binary','snapback4',['node','--input-type=module','-e',"import{copyFileSync,chmodSync}from'node:fs';copyFileSync('target/debug/snapback4','packages/snapback4-linux-x64/snapback4');chmodSync('packages/snapback4-linux-x64/snapback4',0o755)"]),
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('cli-unit','snapback4',['cargo','test','-p','snapback4','--bin','snapback4']),
 step('cli-consumers','snapback4',['cargo','test','--no-fail-fast','-p','snapback4',...targets.flatMap(t=>['--test',t])],5400),
 step('guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('client-consumers','snapback4',['node','scripts/run-client-tests.mjs','2','files',...clients.map(n=>`packages/snapback4/test/${n}.test.mjs`)],5400),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd())"]),
 step('signature-drift','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('proof-reference-drift','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('cleanup-platform-test-binary','snapback4',['node','--input-type=module','-e',"import{rmSync}from'node:fs';rmSync('packages/snapback4-linux-x64/snapback4',{force:true})"]),
 step('refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(plan);
console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));
if(!receipt.ok)process.exitCode=1;
