import {planAffected,runPlan} from '/home/ccheever/projects/sb4-b35-tok3/snapback4/scripts/affected.mjs';
import {writeFileSync} from 'node:fs';
const root='/home/ccheever/projects/sb4-b35-tok3';
const plan=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync('/tmp/tok3-evidence/selector-final-complete-plan.json',JSON.stringify(plan,null,2));
const step=(id,argv,cwd='snapback4',timeoutSeconds=1800)=>({id,argv,cwd,timeoutSeconds,requires:[]});
const keep=['install-client','build-cli','build-client','typecheck:snapback4','packaged-docs','docs-budget','diagnostics','generated','guide','inventories','ref-check'];
const selected=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
const buildEnd=selected.findIndex(s=>s.id==='typecheck:snapback4')+1;
selected.splice(buildEnd,0,
 step('rust:guide-emitter',['cargo','test','-p','snapback4-lang','--test','guide','--test','emit_compatibility','--test','mutation_result_types','--test','maintained_result_types']),
 step('rust:init-unit',['cargo','test','-p','snapback4','--bin','snapback4','verbs::init::','--','--test-threads=4']),
 step('rust:starter-cli',['cargo','test','-p','snapback4','--test','init','--test','tok1','--test','tok3','--test','dx12_output','--test','dx14_output','--','--test-threads=4','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('client:reading',['node','--test','packages/snapback4/test/api-index.test.mjs','packages/snapback4/test/tok1-reading.test.mjs','packages/snapback4/test/tok3-reading.test.mjs']));
// The earlier unchanged W8B calibration passed in 655s; do not repeat it for prose.
// The source-family closure includes the whole runtime/client pool. The brief
// explicitly forbids running that battery; test comments, guides and custody.
const narrowed={...plan,steps:selected,fullSelectorPlanExecuted:false,scope:'TOK3 guide/emitter comments/digest generation/starter custody; no runtime or language semantics',qualification:false};
writeFileSync('/tmp/tok3-evidence/selector-final-scoped-plan.json',JSON.stringify(narrowed,null,2));
const {receiptPath,receipt}=await runPlan(narrowed,{root});
writeFileSync('/tmp/tok3-evidence/selector-final-receipt-path.txt',receiptPath+'\n');
if(!receipt.ok)process.exitCode=1;
