import fs from 'node:fs';
import {chromium} from 'playwright';
const URL='http://127.0.0.1:54901';
const steps=[];const rec=(n,d)=>{steps.push({t:Date.now(),name:n,...d});console.log(n,JSON.stringify(d).slice(0,400));};
const tid=s=>`[data-testid="${s}"]`;
const pollState=p=>p.evaluate(()=>[...document.querySelectorAll('[data-testid="sm-poll"]')].map(x=>({
  options:[...x.querySelectorAll('[data-testid="sm-poll-option"]')].map(o=>({id:o.getAttribute('aria-valuetext'),selected:o.getAttribute('aria-selected'),busy:o.getAttribute('aria-busy'),count:Number(o.querySelector('[data-testid="sm-poll-tally"]').textContent)})),
  total:x.querySelector('[data-testid="sm-poll-total"]').textContent})));
const pending=p=>p.evaluate(()=>window.clique?(window.clique.getSnapshot().pending||[]).map(o=>({id:o.id,op:o.op,args:o.args})):'no-client');
async function login(page,email,pw){await page.goto(URL,{waitUntil:'load'});await page.waitForSelector(tid('sm-auth-email'),{timeout:30000});await page.fill(tid('sm-auth-email'),email);await page.fill(tid('sm-auth-password'),pw);await page.click(tid('sm-auth-submit'));await page.waitForSelector(tid('conversation-id'),{timeout:30000});}
async function openConv(page,id){await page.fill(tid('conversation-id'),id);await page.press(tid('conversation-id'),'Enter');await page.waitForSelector(tid('sm-poll'),{timeout:30000});}
const out={url:URL,steps,results:{}};
const browser=await chromium.launch({headless:true});
try{
  const ctx=await browser.newContext();const B=await ctx.newPage();
  B.on('pageerror',e=>steps.push({name:'pageerror',msg:String(e)}));
  await login(B,'bob@example.com','Bob!Clique2026');
  await openConv(B,'g-starter');
  out.results.beforeOffline=await pollState(B); rec('bob-before-offline',{s:out.results.beforeOffline});
  await B.waitForTimeout(2000); // let shell/sw cache
  await ctx.setOffline(true); await B.waitForTimeout(1500);
  out.results.offlineStatus=await B.textContent(tid('connection')).catch(()=>null);
  const opts=await B.$$(tid('sm-poll-option')); await opts[1].click();
  await B.waitForTimeout(2000);
  out.results.offlinePending=await pending(B);
  out.results.offlinePollState=await pollState(B);
  rec('bob-offline-vote-b',{pending:out.results.offlinePending,state:out.results.offlinePollState,status:out.results.offlineStatus});
  const opId=Array.isArray(out.results.offlinePending)&&out.results.offlinePending[0]?out.results.offlinePending[0].id:null;
  await B.close();
  const B2=await ctx.newPage();
  B2.on('pageerror',e=>steps.push({name:'pageerror2',msg:String(e)}));
  let reopen='ok'; try{await B2.goto(URL,{waitUntil:'load',timeout:30000});}catch(e){reopen='goto-failed:'+String(e).slice(0,150);}
  await B2.waitForTimeout(5000);
  out.results.reopenOffline=reopen;
  out.results.shellRestoredOffline=await B2.evaluate(()=>!!document.querySelector('[data-testid="conversation-id"]')).catch(()=>false);
  out.results.pendingAfterReopenOffline=await pending(B2).catch(e=>'eval-failed:'+String(e).slice(0,100));
  out.results.sameOperationId=Array.isArray(out.results.pendingAfterReopenOffline)&&out.results.pendingAfterReopenOffline.some(o=>o.id===opId);
  rec('reopen-offline',{reopen,shell:out.results.shellRestoredOffline,pending:out.results.pendingAfterReopenOffline,sameOperationId:out.results.sameOperationId,originalOpId:opId});
  await ctx.setOffline(false);
  await B2.waitForTimeout(8000);
  out.results.pendingAfterReconnect=await pending(B2).catch(()=>'eval-failed');
  rec('after-reconnect',{pending:out.results.pendingAfterReconnect});
  try{await openConv(B2,'g-starter');}catch(e){rec('reopen-conv-failed',{e:String(e).slice(0,150)});}
  await B2.waitForTimeout(3000);
  out.results.tallyAfterReconnect=await pollState(B2);
  rec('tally-after-reconnect',{s:out.results.tallyAfterReconnect});
  // idempotent repeat of same option
  const o2=await B2.$$(tid('sm-poll-option')); await o2[1].click();
  await B2.waitForTimeout(3000);
  out.results.tallyAfterRepeat=await pollState(B2);
  out.results.pendingAfterRepeat=await pending(B2);
  rec('repeat-same-option',{s:out.results.tallyAfterRepeat,pending:out.results.pendingAfterRepeat});
  await ctx.close();
}catch(e){out.fatal=String(e).slice(0,600);console.log('FATAL',out.fatal);}
finally{await browser.close();fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1));}
