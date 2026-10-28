import {planAffected,runPlan} from '/home/ccheever/projects/sb4-b33-tok1/snapback4/scripts/affected.mjs';
import {writeFileSync} from 'node:fs';
const root='/home/ccheever/projects/sb4-b33-tok1';
const plan=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync('/tmp/scaf1-evidence/selector-complete-plan.json',JSON.stringify(plan,null,2));
const step=(id,argv,cwd='snapback4',timeoutSeconds=2400)=>({id,argv,cwd,timeoutSeconds,requires:[]});
const keep=['build-cli','build-client','typecheck:snapback4','packaged-docs','docs-budget','diagnostics','generated','guide','inventories','ref-check'];
const selected=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
const at=selected.findIndex(s=>s.id==='typecheck:snapback4')+1;
selected.splice(at,0,
 step('rust:scaf1-cli',['cargo','test','-p','snapback4','--test','scaf1','--test','check','--test','tok1','--test','tok2_output','--test','tok3','--test','dx12_output','--test','dx14_output','--','--test-threads=4','--skip','a_long_card_prints_its_opening_and_index_and_full_prints_it_all','--skip','guide_lists_aliases_and_resolves_them_on_stdout']),
 step('rust:init',['cargo','test','-p','snapback4','--test','init','--','--test-threads=4','--skip','w8b_residency_measures_the_wired_calibration_shape','--skip','web_and_expo_starters_are_one_small_screen_with_product_comments','--skip','init_beside_a_projects_own_schema_leaves_its_tests_green']),
 step('rust:guide',['cargo','test','-p','snapback4-lang','--test','guide','--','--test-threads=4','--skip','deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race','--skip','cards_meet_word_targets_and_preserve_every_original_compiled_block','--skip','wave33_001_022_codex_011_021_muse_every_reference_section_fits_day_two_budget']),
 step('client:proof',['node','--test','packages/snapback4/test/proof.test.mjs','packages/snapback4/test/proof-contract.test.mjs']));
const scoped={...plan,steps:selected,fullSelectorPlanExecuted:false,omissions:{inherited:'issues/20261028-snapback4-inherited-check-guide-assertion-drift.md (seven baseline-proven failures)',expensiveUnrelated:'w8b residency calibration',install:'lockfiles unchanged; frozen installs and SDK build already completed'},qualification:false,scope:'SCAF1 CLI-only codegen/green-check side effects, generated proof kit consumers, guide/changelog, custody/output/init, inventories and references; explicit brief excludes full multi-crate/client/model/difftest battery'};
writeFileSync('/tmp/scaf1-evidence/selector-scoped-plan.json',JSON.stringify(scoped,null,2));
const {receiptPath,receipt}=await runPlan(scoped,{root});
writeFileSync('/tmp/scaf1-evidence/selector-receipt-path.txt',receiptPath+'\n');
if(!receipt.ok)process.exitCode=1;
