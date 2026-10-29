import{readFileSync,writeFileSync,existsSync}from'node:fs';import{createHash}from'node:crypto';import{join}from'node:path';
const evidence=process.argv[2]??'/tmp/dx17/evidence',phases=['before','after-final','after-route','after-observe'],ns=[2,5,9,11,18],rows=[];
const read=p=>JSON.parse(readFileSync(p));
for(const phase of phases)for(const n of ns){
 const lp=join(evidence,`${phase}-${n}-launch.json`),rp=join(evidence,`${phase}-${n}-result.json`),vp=join(evidence,`${phase}-${n}-verification.json`);
 if(![lp,rp,vp].every(existsSync)){rows.push({phase,n,pending:true});continue;}
 const launch=read(lp),result=read(rp),v=read(vp),p=v.priced,d=v.drill;
 const rowsUnderV1=d.v2RecordsUnderV1?.returned;
 const measured=read(join(launch.dir,'.harness/model-metrics.json'));
 let lastProof=v.lastProof??v.results.filter(r=>r.cmd==='npm run day2:proof').at(-1)?.result;
 rows.push({phase,n,lane:launch.a.id,model:launch.a.model,source:launch.a.sourceLane,registry:launch.registry,exit:result.code,wallMinutes:result.wallMs/60000,
  initialCompletionSensitivityMinutes:result.initialCompletionWallMs?result.initialCompletionWallMs/60000:null,postTerminalCleanup:result.postTerminalCleanup===true,
  costUsd:p.costUsd,costUsdMuseStandard:p.costUsdMuseStandard,costBasis:p.costBasis,priceVersion:p.costPricing.priceVersion,priceSha256:p.costPricing.priceSha256,costComplete:p.costPricing.costComplete,calls:measured.modelCalls,
  ...p.costPricing.usageTotals,toolMinutes:measured.toolMinutes,modelMinutes:measured.modelMinutes,releaseCommandMinutes:measured.builderReleaseCommandMinutes,
  sourceArchiveComplete:!v.archive.missing.length,perCall:p.costPricing.units.map(({call,model,inputTokens,cachedInputTokens,outputTokens,reasoningTokens,costUsd,kind,basis,longContext})=>({call,model,inputTokens,cachedInputTokens,outputTokens,reasoningTokens,costUsd,kind,basis,longContext})),
  proofRuns:v.results.map(r=>({command:r.cmd,exit:r.code,seconds:r.ms/1000,proof:r.result})),proofsGreen:v.results.every(r=>r.code===0),lastProof,
  probeServe:v.probeServe,supplementalProbe:v.supplementalProbe??null,drill:{status:d.status,stagesOk:d.stagesOk,dataPreserved:d.dataPreserved,v2ClientExit:d.v2Client?.status,
   v1AfterV2:d.v1?.afterV2?.corrected,v1AfterRollback:d.v1?.afterRollback?.corrected,
   dayOneBaselineFailed:d.v1?.dayOneBaselineFailed,productionBaselineFailed:d.v1?.productionBaselineFailed,baselineStatus:d.v1?.baselineStatus,replayExit:Object.fromEntries(Object.entries(d.replays??{}).map(([k,r])=>[k,r.status])),
   v2WrittenReturns:rowsUnderV1?.byV2Client,allReturns:rowsUnderV1?.all,missingV1Fields:d.rowShapeAfterRollback?.rowsMissingV1Fields},
  binarySha256:existsSync(join(launch.dir,'node_modules/snapback4-linux-x64/snapback4'))?createHash('sha256').update(readFileSync(join(launch.dir,'node_modules/snapback4-linux-x64/snapback4'))).digest('hex'):existsSync(join(launch.dir,'.harness/installed-package.json'))?read(join(launch.dir,'.harness/installed-package.json')).binarySha256:null,
 });
}
const mean=(xs,k)=>xs.reduce((n,x)=>n+x[k],0)/xs.length;
const groups={};for(const phase of phases)for(const model of ['muse','codex']){const xs=rows.filter(x=>!x.pending&&x.phase===phase&&x.model===model);groups[phase+'/'+model]={n:xs.length,costUsd:xs.length?mean(xs,'costUsd'):null,calls:xs.length?mean(xs,'calls'):null,wallMinutes:xs.length?mean(xs,'wallMinutes'):null,allProofsGreen:xs.length>0&&xs.every(x=>x.proofsGreen),allProbesGreen:xs.length>0&&xs.every(x=>x.probeServe?.status===0),allStagesGreen:xs.length>0&&xs.every(x=>x.drill.stagesOk),allDataPreserved:xs.length>0&&xs.every(x=>x.drill.dataPreserved===true),frozenAfterV2Works:xs.filter(x=>x.drill.v1AfterV2==='works').length,frozenAfterRollbackWorks:xs.filter(x=>x.drill.v1AfterRollback==='works').length,allV2RowsReturned:xs.filter(x=>{const r=x.drill.v2WrittenReturns;return r?.considered>0&&r.returned===r.considered}).length};}
const report={schema:'dx17-whole-day2-v1',generatedAt:new Date().toISOString(),target:{museCostUsd:0.0561,museCalls:99.47,comparison:'Supabase wave35 all-15-lane means, a threshold not a paired causal control'},groups,rows};
writeFileSync(join(import.meta.dirname,'replays.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(groups,null,2));
