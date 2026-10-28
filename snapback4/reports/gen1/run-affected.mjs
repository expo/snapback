// GEN1 has no language/planner/store/runtime delta. Preserve the selector's
// conservative closure while obeying the explicit affected-only workstream brief.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
process.env.CARGO_BUILD_JOBS='4';
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
const evidence=join(root,'snapback4/reports/gen1');mkdirSync(evidence,{recursive:true});
writeFileSync(join(evidence,'affected-complete-plan.json.gz'),gzipSync(JSON.stringify(plan)));
const step=(id,argv,cwd='snapback4',timeoutSeconds=1800)=>({id,argv,cwd,timeoutSeconds,requires:[]});
// Dependencies and wasm were prepared once, with byte-identical unchanged wasm.
// The SDK build here still checks and rebuilds declaration digests from source.
const keep=['build-cli','build-client','typecheck:snapback4','docs-budget','diagnostics','guide','inventories','packaged-docs','ref-check'];
const steps=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
steps.splice(steps.findIndex(s=>s.id==='typecheck:snapback4')+1,0,
 step('rust:codegen',['cargo','test','-p','snapback4-lang','--test','emit_compatibility','--test','ephemeral_compat','--test','list_lower_bounds','--test','guide','--test','mutation_result_types','--test','maintained_result_types','--test','actions','--test','ephemeral','--test','following_history']),
 step('rust:check-output',['cargo','test','-p','snapback4','--test','check','--test','tok3','--test','dx12_output','--test','dx14_output','--test','tok2_output','--','--test-threads=4']),
 step('client:generated-usage',['node','scripts/run-client-tests.mjs','4','files','packages/snapback4/test/generated-usage.test.mjs','packages/snapback4/test/generated-modules.test.mjs','packages/snapback4/test/tok1-reading.test.mjs','packages/snapback4/test/tok3-reading.test.mjs']));
const scoped={...plan,steps,fullSelectorPlanExecuted:false,qualification:false,scope:'GEN1 client codegen comments, existing verdict and API pointer lines; no runtime/language/store changes',exclusions:[
 'Full seven-crate/459-client closure and difftest forbidden by brief; relevant emitter, classification, output and packed-module targets run instead.',
 'api-index.test.mjs is an extra attempted inherited red: unchanged src-only export resolver cannot resolve proof-runner.js; tracked in issues/20261028-snapback4-api-index-proof-runner-export.md.',
 'Root generated-artifact bootstrap/generators ran separately; no generated source/registry bytes changed.',
 'Setup wasm was byte-identical: 2416601 raw / 738640 gzip bytes, budget 739140; no engine/device change.'
]};
writeFileSync(join(evidence,'affected-scoped-plan.json.gz'),gzipSync(JSON.stringify(scoped)));
const {receiptPath,receipt}=await runPlan(scoped,{root});
writeFileSync(join(evidence,'affected-receipt.json.gz'),gzipSync(JSON.stringify(receipt)));
writeFileSync(join(evidence,'affected-summary.json'),JSON.stringify({head:receipt.head,ok:receipt.ok,complete:receipt.complete,fullSelectorPlanExecuted:false,qualification:false,receiptPath,results:receipt.results},null,2)+'\n');
if(!receipt.ok)process.exitCode=1;
