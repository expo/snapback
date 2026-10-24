// DX10 scope override: the ordinary selector includes six crates and all 438 client
// files for a diagnostic wording/source export edit. The lane brief forbids that
// full battery. Preserve its plan and run claim-relevant affected consumers.
import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {writeFileSync,mkdirSync,readFileSync,lstatSync,readlinkSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
const directory=resolve(import.meta.dirname,"../../target/affected/dx10"); mkdirSync(directory,{recursive:true});
const reuseRoot=process.argv.includes('--reuse-root-checks');
const root=resolve(import.meta.dirname,'../../..');
const rootDigest=()=>{
 const files=execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8',maxBuffer:64*1024*1024}).split('\0').filter(Boolean)
   .filter(f=>!f.startsWith('snapback4/reports/')&&!f.startsWith('llp/reviews/')&&!f.startsWith('issues/'));
 const hash=createHash('sha256');
 for(const file of files){const path=resolve(root,file),stat=lstatSync(path);if(stat.isDirectory())continue;hash.update(file+'\0');hash.update(stat.isSymbolicLink()?readlinkSync(path):readFileSync(path));}
 return hash.digest('hex');
};
if(reuseRoot){
 const checks=JSON.parse(readFileSync(resolve(import.meta.dirname,'root-checks.json'),'utf8'));
 if(!checks.ok||checks.inputDigest!==rootDigest())throw Error('cannot reuse root checks: missing pass or changed inputs');
}
const raw=planAffected({base:'origin/main',worktree:process.argv.includes('--worktree')});
writeFileSync(resolve(directory,'affected-unrestricted-plan.json'),JSON.stringify(raw,null,2)+'\n');
const names=new Set(['dx10-process-accounts','identity-rate','proof','staging','proof-fixtures','proof-contract','client-recipes','wave12-kit','dx4-dev','day3-proofs','day4-proofs','day5-proofs','wave14-rule-recipes','surf4','periphery']);
const clients=raw.clientFiles.filter(path=>names.has(path.split('/').at(-1).replace('.test.mjs','')));
const reusedIds=new Set(reuseRoot?['diagnostics','generated','guide','inventories']:[]);
const steps=raw.steps.filter(step=>!reusedIds.has(step.id)&&!/^rust:|^client-models$|^fixture-tests$|^wasm-measurement$|^lean-build$|^difftest:/.test(step.id));
const pool=steps.find(step=>step.id==='client-tests');
if(pool){pool.argv=[...pool.argv.slice(0,4),...clients.map(f=>f.replace(/^snapback4\//,''))];pool.fileRequires=Object.fromEntries(Object.entries(pool.fileRequires).filter(([f])=>clients.includes('snapback4/'+f)));}
steps.splice(steps.findIndex(s=>s.id==='client-tests'),0,
 {id:'rust:snapback4:presence',cwd:'snapback4',argv:['cargo','test','-p','snapback4','--bin','snapback4','only_authored_presence_answers_advance_the_first_check_gate'],reason:'nullable presence wording and regression',timeoutSeconds:1800},
 {id:'rust:snapback4-lang:security_sec9',cwd:'snapback4',argv:['cargo','test','-p','snapback4-lang','--test','security_sec9'],reason:'changed diagnostic and regression',timeoutSeconds:1800},
 {id:'rust:snapback4-lang:guide',cwd:'snapback4',argv:['cargo','test','-p','snapback4-lang','--test','guide'],reason:'changed runnable guide cards',timeoutSeconds:1800});
const omitted=raw.steps.filter(step=>!steps.includes(step)).map(step=>({id:step.id,reason:reusedIds.has(step.id)?'unchanged inputs; passing root-checks.json evidence reused':'brief forbids full battery; no language/planner/store semantic change in DX10'}));
writeFileSync(resolve(directory,'affected-scope.json'),JSON.stringify({scopeOverride:true,reusedRootChecks:reuseRoot,clients,omitted},null,2)+'\n');
const result=await runPlan({...raw,steps,clientFiles:clients,rustPackages:[],rustTargets:{'snapback4-lang':['security_sec9','guide']}});
writeFileSync(resolve(directory,'affected-result.json'),JSON.stringify({scopeOverride:true,receiptPath:result.receiptPath,receipt:result.receipt},null,2)+'\n');
process.exitCode=result.receipt.ok?0:1;
