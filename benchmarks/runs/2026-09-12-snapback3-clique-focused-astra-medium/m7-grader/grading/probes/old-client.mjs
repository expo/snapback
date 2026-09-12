import fs from 'node:fs';
import {chromium} from 'playwright';
const ORIGIN='http://127.0.0.1:54910';
const PROFILE='grading/private/oldclient/old-client-profile';
const EXPECT_OP='731cbc48-b0ea-4e0a-819d-a74e5bc59a19';
const EXPECT_MSG='m7-old-client-53b5260a-4163-4f90-bc91-5e937ce2d100';
const out={origin:ORIGIN,phases:[]};const rec=(n,d)=>{out.phases.push({t:Date.now(),name:n,...d});console.log(n,JSON.stringify(d).slice(0,400));};
const pend=p=>p.evaluate(()=>window.clique?(window.clique.getSnapshot().pending||[]).map(o=>({id:o.id,op:o.op,args:o.args,state:o.state??null})):'no-window-clique');
const phase=process.argv[2];
const ctx=await chromium.launchPersistentContext(PROFILE,{headless:true,offline:phase==='offline'});
try{
  const page=await ctx.newPage();
  page.on('pageerror',e=>out.phases.push({name:'pageerror',msg:String(e).slice(0,200)}));
  let nav='ok';
  try{await page.goto(ORIGIN,{waitUntil:'load',timeout:30000});}catch(e){nav='goto-failed:'+String(e).slice(0,150);}
  rec('navigated',{phase,nav});
  await page.waitForTimeout(6000);
  const shell=await page.evaluate(()=>({hasClient:!!window.clique,title:document.title,authForm:!!document.querySelector('[data-testid="sm-auth-email"]'),convInput:!!document.querySelector('[data-testid="conversation-id"]')})).catch(e=>({err:String(e).slice(0,120)}));
  rec('shell',shell);
  let pending=await pend(page).catch(e=>'eval-failed:'+String(e).slice(0,120));
  rec('pending-initial',{pending,hasOriginal:Array.isArray(pending)&&pending.some(o=>o.id===EXPECT_OP)});
  if(phase==='reconnect'){
    for(let i=0;i<8;i++){
      await page.waitForTimeout(4000);
      pending=await pend(page).catch(e=>'eval-failed');
      const st=await page.evaluate(()=>window.clique?window.clique.getSnapshot().status:'n/a').catch(()=>'n/a');
      rec('poll-'+i,{status:st,pending});
    }
    // reload once to force a fresh session/flush attempt
    try{await page.reload({waitUntil:'load',timeout:30000});}catch(e){rec('reload-failed',{e:String(e).slice(0,150)});}
    await page.waitForTimeout(8000);
    pending=await pend(page).catch(()=>'eval-failed');
    const st=await page.evaluate(()=>window.clique?window.clique.getSnapshot().status:'n/a').catch(()=>'n/a');
    rec('after-reload',{status:st,pending});
  }
  out.finalPending=pending;
  out.expected={operationId:EXPECT_OP,messageId:EXPECT_MSG};
}catch(e){out.fatal=String(e).slice(0,400);console.log('FATAL',out.fatal);}
finally{await ctx.close();fs.writeFileSync(process.argv[3],JSON.stringify(out,null,1));}
