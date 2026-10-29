// The complete selector expands the tracked root report/CLI command table to
// every crate/model. MUSE1's explicit brief forbids that complete battery.
// Retain its plan and execute the affected product surface through runPlan.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'../../..'),out=process.env.MUSE1_EVIDENCE??'/tmp/muse1-evidence';mkdirSync(out,{recursive:true});
const plan=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync(`${out}/selector-complete-plan.json`,JSON.stringify(plan,null,2));
const keep=['install-client','build-cli','build-wasm','build-client','typecheck:snapback4','packaged-docs','docs-budget','diagnostics','generated','guide','inventories','ref-check','selector-tests'];
const selected=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
const step=(id,argv,cwd='snapback4',timeoutSeconds=2400)=>({id,argv,cwd,timeoutSeconds,requires:[]});
const at=selected.findIndex(s=>s.id==='typecheck:snapback4')+1;
selected.splice(at,0,
 step('rust:muse1-cli',['cargo','test','-p','snapback4','--bin','snapback4','--test','scaf1','--test','check','--test','tok1','--test','tok2_output','--test','tok3','--test','init','--test','init_ver1','--test','init_production','--test','dx12_output','--test','dx14_output','--','--test-threads=4','--skip','w8b_residency_measures_the_wired_calibration_shape']),
 step('rust:muse1-guide',['cargo','test','-p','snapback4-lang','--test','guide','--','--test-threads=4']),
 step('client:muse1-proof',['node','--test','--test-concurrency=4','packages/snapback4/test/proof.test.mjs','packages/snapback4/test/proof-contract.test.mjs','packages/snapback4/test/ver1-loop.test.mjs','packages/snapback4/test/calls1-proofs.test.mjs','packages/snapback4/test/tok1-reading.test.mjs']));
const scoped={...plan,steps:selected,fullSelectorPlanExecuted:false,qualification:false,omissions:{explicitBrief:'full multi-crate/client/model/difftest battery excluded; no language/planner/store semantics changed',expensiveUnrelated:'W8B residency calibration'},scope:'MUSE1 CLI scaffold emission/custody, CLI validation/help, start/workflow, inherited verify/probe/account proofs, all mandatory root/guide checks'};
writeFileSync(`${out}/selector-scoped-plan.json`,JSON.stringify(scoped,null,2));
const {receiptPath,receipt}=await runPlan(scoped,{root});writeFileSync(`${out}/affected-receipt-path.txt`,receiptPath+'\n');if(!receipt.ok)process.exitCode=1;
