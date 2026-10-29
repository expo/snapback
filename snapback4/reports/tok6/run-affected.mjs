// Keep the real selector plan and its source-binding receipt. The workstream
// explicitly forbids its conservative all-crate/client/semantic fallback.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,mkdirSync} from 'node:fs';
import {gzipSync} from 'node:zlib';
import {resolve,join} from 'node:path';
const root=resolve(import.meta.dirname,'../../..');
process.env.CARGO_BUILD_JOBS='4';
const plan=planAffected({root,base:'origin/main',worktree:process.argv.includes('--worktree')});
const evidence=join(root,'target/affected/tok6');mkdirSync(evidence,{recursive:true});
writeFileSync(join(evidence,'selector-complete-plan.json.gz'),gzipSync(JSON.stringify(plan)));
const step=(id,argv,cwd='snapback4',timeoutSeconds=1800)=>({id,argv,cwd,timeoutSeconds,requires:[]});
const keep=['build-cli','build-client','typecheck:snapback4','docs-budget','diagnostics','guide','inventories','packaged-docs','ref-check','selector-tests','generated'];
const steps=plan.steps.filter(s=>keep.includes(s.id)).map(s=>({...s,requires:[],fileRequires:undefined}));
steps.push(
 step('rust:guide-reference',['cargo','test','-p','snapback4-lang','--test','guide','--test','residency_notes','--test','aggregate_copies','--test','maintains','--test','server_opt_in','--','--test-threads=4']),
 step('rust:cli-flags',['cargo','test','-p','snapback4','--bin','snapback4','cli_flags::','--','--test-threads=4']),
 step('rust:guide-command',['cargo','test','-p','snapback4','--test','check','guide','--','--test-threads=4']),
 step('rust:scale-docs',['cargo','test','-p','snapback4','--test','scale','the_guide_and_readme_describe_three_classes','--','--exact']),
 step('rust:tok3-command',['cargo','test','-p','snapback4','--test','tok3','--','--test-threads=4']),
 step('client:reading-contracts',['node','scripts/run-client-tests.mjs','4','files',...['tok6-reading','generated-usage','tok1-reading','tok3-reading','readme-examples','packaged-docs','api-index','wave10-upgrade','wave11-upgrade-history','dx5-react','front-data-react','periphery','wave11-guide-types','publish-linux','publish-signing','qualify-linux','publication-roundtrip'].map(n=>`packages/snapback4/test/${n}.test.mjs`)]),
 step('client:api-digests',['node','scripts/guide-api.mjs','--check'],'snapback4/packages/snapback4')
);
const scoped={...plan,steps,fullSelectorPlanExecuted:false,qualification:false,scope:'TOK6 package reference layout and guide routing; no language, planner, store, client runtime or security semantic changes',exclusions:[
 'Explicit brief forbids complete crate/client/difftest closure. The unmodified selector plan is retained; its runPlan executes this named affected set with source binding.',
 'Setup already rebuilt unchanged wasm and installed locked dependencies. No device/wasm semantic inputs changed.',
 'qualify-linux --consumer-only is separate packed installed-consumer evidence, not publication qualification.'
]};
writeFileSync(join(evidence,'scoped-plan.json.gz'),gzipSync(JSON.stringify(scoped)));
const {receiptPath,receipt}=await runPlan(scoped,{root});
writeFileSync(join(evidence,'receipt.json.gz'),gzipSync(JSON.stringify(receipt)));
writeFileSync(join(evidence,'summary.json'),JSON.stringify({head:receipt.head,ok:receipt.ok,complete:receipt.complete,unchanged:receipt.unchanged,fullSelectorPlanExecuted:false,qualification:false,receiptPath,results:receipt.results},null,2)+'\n');
if(!receipt.ok)process.exitCode=1;
