// Final commit: rerun repaired inputs; retain passed checks on unchanged semantic inputs.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const root=process.cwd();
const previous=JSON.parse(readFileSync('snapback4/reports/20261028-tok5/initial-affected.json','utf8'));
if(!previous.complete)throw Error('Original affected run must finish before final verification');
const repaired=new Set(['rust:snapback4-device:docs','client-tests','selector-tests']);
if(previous.results.some(r=>r.status!==0&&!repaired.has(r.id)))throw Error('Additional affected failure needs disposition');
const changed=execFileSync('git',['diff','--name-only',previous.head,'HEAD'],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
const issue=p=>/^issues\/(?:closed\/|shelved\/)?[^/]+\.md$/.test(p);
const allowed=p=>issue(p)||p==='snapback4/scripts/affected.mjs'||p==='snapback4/scripts/affected.test.mjs'||p==='snapback4/packages/snapback4/test/periphery.test.mjs'||p==='snapback4/crates/snapback4-device/tests/readauth/census.txt'||p==='snapback4/JOURNAL.md'||/^snapback4\/reports\/20261028-tok5\//.test(p)||/^llp\/reviews\/3000\.037\.000-tok5-/.test(p)||/^llp\/3000\.037\.000-/.test(p);
if(changed.some(p=>!allowed(p)))throw Error('Semantic inputs changed beyond reviewed fixture/evidence corrections: '+changed.filter(p=>!allowed(p)));
const plan=planAffected({root,base:'origin/main'});
const upstream=execFileSync('git',['diff','--name-only',previous.base,plan.base],{encoding:'utf8'}).trim().split('\n').filter(Boolean);
if(upstream.some(p=>!issue(p)))throw Error('origin/main changed semantic inputs: '+upstream.filter(p=>!issue(p)));
const consumer=JSON.parse(readFileSync('snapback4/reports/20261028-tok5/consumer.json','utf8'));
if(consumer.source!==previous.head||consumer.publicationQualified!==false||consumer.mode!=='consumer-only')throw Error('Packed consumer provenance differs');
const steps=[
 {id:'rust:snapback4-device:docs',cwd:'snapback4',argv:['cargo','test','--locked','-j','4','-p','snapback4-device','--test','readauth']},
 {id:'client-tests:repaired-and-contract',cwd:'snapback4',argv:['node','scripts/run-client-tests.mjs','2','files',...['periphery','tok5-write','readme-examples','package-typecheck'].map(n=>`packages/snapback4/test/${n}.test.mjs`)]},
 {id:'typecheck:snapback4',cwd:'snapback4',argv:['bun','run','--cwd','packages/snapback4','typecheck']},
 {id:'guide-api-drift',cwd:'snapback4',argv:['node','packages/snapback4/scripts/guide-api.mjs','--check']},
 ...['selector-tests','docs-budget','packaged-docs','ref-check'].map(id=>({...plan.steps.find(s=>s.id===id),requires:[]})),
].map(s=>({...s,timeoutSeconds:10800,requires:[],reason:'TOK5 final affected verification; prior passed semantic inputs unchanged'}));
if(steps.some(s=>!s.id))throw Error('Expected final check omitted by selector');
const scoped={...plan,steps,fullSelectorPlanExecuted:false,qualification:false,reusedFrom:{head:previous.head,receipt:'snapback4/reports/20261028-tok5/initial-affected.json',results:previous.results.filter(r=>r.status===0&&!steps.some(s=>s.id===r.id))},changedSincePrior:changed,upstreamIssueOnlyChanges:upstream,scopeReason:'Only package-reference documentation selection, frozen census membership, stale test fixtures and evidence changed since the full TOK5 affected-scope run; all product and packed-consumer inputs unchanged.'};
const {receipt,receiptPath}=await runPlan(scoped,{root});
console.log(JSON.stringify({receiptPath,ok:receipt.ok,reusedPassedSteps:scoped.reusedFrom.results.length}));
process.exitCode=receipt.ok?0:1;
