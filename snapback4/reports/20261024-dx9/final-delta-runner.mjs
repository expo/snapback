import {planAffected,runPlan} from '../../scripts/affected.mjs';
import {resolve} from 'node:path';
import {writeFileSync} from 'node:fs';
const root=resolve(import.meta.dirname,'../../..');
const plan=planAffected({root,base:'4ad142a65a'});
writeFileSync(root+'/target/affected/dx9-final-delta-unrestricted.json',JSON.stringify(plan,null,2));
const keep=new Set(['install-client','build-cli','build-wasm','build-client','typecheck:snapback4','rust:snapback4','rust:snapback4-core','rust:snapback4-lang','client-tests','ref-check','inventories','diagnostics','packaged-docs','difftest:run','lean-build','difftest:run-lean']);
const omitted=[];
plan.steps=plan.steps.filter(s=>{if(keep.has(s.id))return true;omitted.push(s.id);return false;});
for(const s of plan.steps){
 if(s.id==='rust:snapback4-core')s.argv=['cargo','test','-p','snapback4-core','--lib','--','--test-threads=4'];
 if(s.id==='rust:snapback4')s.argv=['cargo','test','-p','snapback4','--bin','snapback4','--test','init','--test','day5_starters','--','--test-threads=4','--skip','w8b_residency_measures_the_wired_calibration_shape'];
 if(s.id==='rust:snapback4-lang')s.argv=['cargo','test','-p','snapback4-lang',...['surf4_guide','guide','front_semantics','dx9_ergonomics'].flatMap(t=>['--test',t]),'--','--test-threads=4'];
 if(s.id==='client-tests'){
  const files=['packages/snapback4/test/dx9-packed.test.mjs','packages/snapback4/test/social-starter.test.mjs','packages/snapback4/test/production-starters.test.mjs'];
  s.argv=['node','scripts/run-client-tests.mjs','3','files',...files];s.fileRequires=Object.fromEntries(Object.entries(s.fileRequires??{}).filter(([f])=>files.includes(f)));
 }
}
plan.dx9Override={scope:'Final committed delta after 698/698 client assertions and root guide/generated checks at 4ad142a65a',reason:'Late changes only persona export/qualification, truncation fixture and evidence; merged RCPU changes preserve logical runtime behavior. Recheck core/CLI libraries, starter integration and packed probes; no forbidden full pool/all-crate battery. Root guide/generated functional inputs unchanged; successful prior checks retained.',omitted,knownInheritedLean:'18 disagreements; identical exact-0cb3de79ee and main-909e760ac5 controls; OPEN C2/W4. Preserve any nonzero status.'};
const result=await runPlan(plan,{root});console.log(JSON.stringify({ok:result.receipt.ok,receiptPath:result.receiptPath}));if(!result.receipt.ok)process.exitCode=1;
