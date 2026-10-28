import {planAffected,runPlan} from '/home/ccheever/projects/sb4-b35-calls1/snapback4/scripts/affected.mjs';
import {writeFileSync} from 'node:fs';
const root='/home/ccheever/projects/sb4-b35-calls1';
const plan=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync('/tmp/ver1-evidence/selector-final-complete-plan.json',JSON.stringify(plan,null,2));
const step=(id,argv,cwd='snapback4',timeoutSeconds=1800)=>({id,argv,cwd,timeoutSeconds,requires:[]});
const keep=['install-client','build-cli','build-client','typecheck:snapback4','packaged-docs','docs-budget','diagnostics','generated','guide','inventories','ref-check'];
const selected=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
const stepIndex=selected.findIndex(s=>s.id==='typecheck:snapback4')+1;
selected.splice(stepIndex,0,
 step('rust:probe-guide',['cargo','test','-p','snapback4-lang','--test','guide','--','--skip','deploy::deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race','--skip','familiar::cards_meet_word_targets_and_preserve_every_original_compiled_block','--skip','wave33_001_022_codex_011_021_muse_every_reference_section_fits_day_two_budget']),
 step('rust:init-unit',['cargo','test','-p','snapback4','--bin','snapback4','verbs::init::','--','--test-threads=4']),
 step('rust:starters',['cargo','test','-p','snapback4','--test','init','--test','init_production','--test','init_ver1','--test','tok1','--','--test-threads=4','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('client:verify',['node','scripts/run-client-tests.mjs','4','files','packages/snapback4/test/ver1-loop.test.mjs','packages/snapback4/test/tok1-reading.test.mjs','packages/snapback4/test/tok2-output.test.mjs','packages/snapback4/test/calls1-proofs.test.mjs','packages/snapback4/test/proof.test.mjs','packages/snapback4/test/proof-contract.test.mjs','packages/snapback4/test/srv1-lifetime.test.mjs']));
// The literal selector expands the proof entry point to every reverse consumer
// and seven crates. The commission forbids that full battery. Retain the plan
// and execute only starter generation, install custody, probe lifetime/output,
// and the mandated guide/generated/inventory/reference checks through runPlan.
const narrowed={...plan,steps:selected,fullSelectorPlanExecuted:false,scope:'VER1 starter check/verify/deferred install and probe idle bound; no language/planner/store semantics',qualification:false};
writeFileSync('/tmp/ver1-evidence/selector-final-scoped-plan.json',JSON.stringify(narrowed,null,2));
const {receiptPath,receipt}=await runPlan(narrowed,{root});
writeFileSync('/tmp/ver1-evidence/selector-final-receipt-path.txt',receiptPath+'\n');
if(!receipt.ok)process.exitCode=1;
