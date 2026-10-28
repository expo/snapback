import {planAffected,runPlan} from '../../scripts/affected.mjs';
const full=planAffected({base:'origin/main',worktree:false});
const step=(id,cwd,argv)=>({id,cwd,argv,reason:'Final day-two guide correction and affected packed consumer; unchanged implementation verified separately',requires:[],timeoutSeconds:1800});
const plan={...full,scopeOverride:{fullSelectorPlanExecuted:false,qualification:false,reason:'Reuse the passed 19-step implementation receipt; since then only the bounded day-two card, its native/packed witnesses and corpus/evidence changed. Preserve the original full selector plan and actual implementation receipt in affected-*.json.gz. Rerun every changed semantic input below; current Expo starter audit remains blocking.'},steps:[
 step('implementation-evidence','.', ['node','snapback4/reports/20261027-dx16/verify-final-evidence.mjs']),
 step('guide','snapback4',['cargo','test','-p','snapback4-lang','--test','guide']),
 step('dx16','snapback4',['cargo','test','-p','snapback4','--test','dx16']),
 step('latest-packed-dx16','.', ['node','snapback4/reports/20261027-dx16/run-final-packed.mjs']),
 step('docs-budget','snapback4',['node','scripts/docs-budget.mjs']),
 step('api-digest','snapback4',['node','packages/snapback4/scripts/guide-api.mjs','--check']),
 step('refs','.', ['./ref-check']),
]};
const {receiptPath,receipt}=await runPlan(plan);console.log(JSON.stringify({receiptPath,ok:receipt.ok,fullSelectorPlanExecuted:false,qualification:false}));if(!receipt.ok)process.exitCode=1;
