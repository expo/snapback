import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {planAffected,runPlan} from '/home/ccheever/sb4-pub-0441/snapback4/scripts/affected.mjs';
const r='/home/ccheever/sb4-pub-0452-records',k='/home/ccheever/sb4-pub-0452-kit',w='/home/ccheever/sb4-pub-0441';
const base=readFileSync(k+'/guide-owner-scope-base.sha','utf8').trim();
const previous=JSON.parse(readFileSync(r+'/archive-corrected-full-rerun-red/release-affected-plan.json'));
const doc='snapback4/packages/snapback4/reference/CHANGELOG.md';
const git=(...a)=>execFileSync('git',a,{cwd:w,encoding:'utf8'}).trim();
assert.equal(git('diff','--name-only',base,'HEAD'),doc);
const before=git('show',base+':'+doc),after=readFileSync(w+'/'+doc,'utf8').trim();
assert.equal(after,before.replace('`--full` prints the complete card','`guide --full` prints the complete card'));
// Overselect the entire original client check, in addition to every documentation-dependent check.
const plan=planAffected({root:w,base,files:[doc,...previous.clientFiles]});
for(const id of ['client-tests','client-models']){
 assert.deepEqual(plan.steps.find(s=>s.id===id).argv,previous.steps.find(s=>s.id===id).argv);
}
assert.equal(plan.rustPackages.length,0);
writeFileSync(r+'/release-final-scope-plan.json',JSON.stringify(plan,null,2)+'\n');
const result=await runPlan(plan,{root:w});
writeFileSync(r+'/release-final-scope-result.json',JSON.stringify(result,null,2)+'\n');
process.exitCode=result.receipt.ok?0:1;
