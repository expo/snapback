// Scoped execution through the repository's affected runner. The unmodified
// full plan is retained; no complete-battery/publication claim is made.
import {writeFileSync} from 'node:fs';
import {planAffected,runPlan} from '../../scripts/affected.mjs';
const plan=planAffected({base:'origin/main'});
writeFileSync('/tmp/calls1/final-full-plan.json',JSON.stringify(plan,null,2));
const step=(id,cwd,argv,timeoutSeconds=1800)=>({id,cwd,argv,timeoutSeconds,requires:[],reason:'CALLS1 explicit affected scope; brief prohibits complete Rust/client closure'});
const clients=['calls1-proofs','calls1-uploads','tok1-reading','asset-files','upload-retry','proof','proof-contract','node-transport','dx14-client-proof','dx15-proof','test-platform-audit'];
const selected={...plan,fullSelectorPlanExecuted:false,qualification:false,
 scopeRationale:'No runtime language/planner/store semantics changed. Full selector expands diagnostic and transport support to six Rust packages/451 clients, prohibited by the brief. Scope retains changed CLI/fixer/initializer/diagnostics, proof/transport/upload clients and generated checks. Earlier unchanged expensive init calibration and full snapback4-lang results remain separate evidence.',
 steps:[
 step('client-build','snapback4',['bun','run','--cwd','packages/snapback4','build']),
 step('client-types','snapback4',['bun','run','--cwd','packages/snapback4','typecheck']),
 step('lang-diagnostics','snapback4',['cargo','test','-p','snapback4-lang','--lib','--test','repairs','--test','familiar_verified_repairs','--test','familiar_source_repairs','--test','guide','--test','ergonomics','--','--test-threads=4']),
 step('cli-fixer-init','snapback4',['cargo','test','-p','snapback4','--test','fix','--test','init','--','--test-threads=2','--skip','w7a_residency_measures_the_wired_500_follow_reader','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('client-affected','snapback4',['node','scripts/run-client-tests.mjs','2','files',...clients.map(name=>`packages/snapback4/test/${name}.test.mjs`)]),
 step('proof-api','snapback4',['node','scripts/generate-proof-api.mjs','--check']),
 step('api-digests','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('packaged-docs','snapback4',['node','--input-type=module','-e',"import {lintPackagedDocs} from './scripts/packaged-docs.mjs';lintPackagedDocs(process.cwd());"]),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('diagnostics','.', ['node','scripts/generate-diagnostics-registry.mjs','--check']),
 step('generated','.', ['bash','scripts/check-generated-artifacts']),
 step('guide','.', ['node','scripts/check-guide.mjs']),
 step('inventories','.', ['node','scripts/check-inventories.mjs']),
 step('refs','.', ['./ref-check']),
 ]};
const result=await runPlan(selected);
writeFileSync('/tmp/calls1/final-affected-receipt.json',JSON.stringify(result,null,2));
if(!result.receipt.ok)process.exitCode=1;
