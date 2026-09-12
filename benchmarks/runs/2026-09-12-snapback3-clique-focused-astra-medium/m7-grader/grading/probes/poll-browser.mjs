import fs from 'node:fs';
import {chromium} from 'playwright';
const URL='http://127.0.0.1:54901';
const steps=[]; const rec=(name,data)=>{steps.push({t:Date.now(),name,...data});console.log(name,JSON.stringify(data).slice(0,300));};
const tid=s=>`[data-testid="${s}"]`;
async function login(page,email,pw){
  await page.goto(URL,{waitUntil:'load'});
  await page.waitForSelector(tid('sm-auth-email'),{timeout:30000});
  await page.fill(tid('sm-auth-email'),email);
  await page.fill(tid('sm-auth-password'),pw);
  await page.click(tid('sm-auth-submit'));
  await page.waitForSelector(tid('conversation-id'),{timeout:30000});
}
async function openConv(page,id){
  await page.fill(tid('conversation-id'),id);
  await page.press(tid('conversation-id'),'Enter');
  await page.waitForSelector(tid('selected-chat'),{timeout:20000});
  await page.waitForFunction(()=>document.querySelector('[data-testid="history-status"]')?.textContent==='History ready',null,{timeout:30000});
}
async function settingsCount(page){
  const open=await page.$(tid('sm-chatsettings'));
  if(!open) await page.getByText('Chat settings',{exact:true}).first().click();
  await page.waitForSelector(tid('sm-chatsettings-messagecount'),{timeout:20000});
  return (await page.textContent(tid('sm-chatsettings-messagecount'))).trim();
}
async function pollState(page){
  return await page.evaluate(()=>{
    const polls=[...document.querySelectorAll('[data-testid="sm-poll"]')];
    return polls.map(p=>({
      question:p.querySelector('*')?.textContent,
      options:[...p.querySelectorAll('[data-testid="sm-poll-option"]')].map(o=>({
        optionId:o.getAttribute('aria-valuetext'),
        selected:o.getAttribute('aria-selected'),
        busy:o.getAttribute('aria-busy'),
        label:o.querySelector('[data-testid="sm-poll-tally"]')?.parentElement?.firstElementChild?.textContent,
        count:Number(o.querySelector('[data-testid="sm-poll-tally"]')?.textContent)})),
      total:p.querySelector('[data-testid="sm-poll-total"]')?.textContent}));
  });
}
const out={url:URL,steps,results:{}};
const browser=await chromium.launch({headless:true});
try{
  const ctxA=await browser.newContext(); const A=await ctxA.newPage();
  A.on('pageerror',e=>steps.push({t:Date.now(),name:'pageerror-A',msg:String(e)}));
  await login(A,'alice@example.com','Alice!Clique2026');
  rec('alice-logged-in',{});
  await openConv(A,'g-starter');
  out.results.groupCountInitialUI=await settingsCount(A);
  rec('group-initial',{count:out.results.groupCountInitialUI});
  await openConv(A,'d-alice-bob');
  out.results.dmCountInitialUI=await settingsCount(A);
  rec('dm-initial',{count:out.results.dmCountInitialUI});
  await openConv(A,'g-starter');
  // create poll through UI
  await A.getByText('Poll',{exact:true}).first().click();
  await A.waitForSelector(tid('sm-poll-compose-question'));
  await A.fill(tid('sm-poll-compose-question'),'Grader canonical poll: where shall we meet?');
  const opts=await A.$$(tid('sm-poll-compose-option'));
  await opts[0].fill('Cafe A'); await opts[1].fill('Park B');
  await A.click(tid('sm-poll-compose-submit'));
  await A.waitForFunction(()=>document.querySelector('[data-testid="sm-chatsettings-messagecount"]')?.textContent==='10',null,{timeout:30000}).catch(e=>rec('wait-10-failed',{err:String(e).slice(0,200)}));
  out.results.groupCountAfterPollUI=await settingsCount(A);
  rec('group-after-poll',{count:out.results.groupCountAfterPollUI});
  // send a text message
  await A.fill(tid('sm-convo-input'),'Grader canonical text after poll');
  await A.click(tid('sm-convo-send'));
  await A.waitForFunction(()=>document.querySelector('[data-testid="sm-chatsettings-messagecount"]')?.textContent==='11',null,{timeout:30000}).catch(e=>rec('wait-11-failed',{err:String(e).slice(0,200)}));
  out.results.groupCountAfterTextUI=await settingsCount(A);
  rec('group-after-text',{count:out.results.groupCountAfterTextUI});
  await A.waitForSelector(tid('sm-poll'),{timeout:20000});
  out.results.pollStateAliceInitial=await pollState(A);
  // poll id from DOM: find message container testid containing sm-poll
  const pollId=await A.evaluate(()=>{const p=document.querySelector('[data-testid="sm-poll"]');let n=p;while(n&&!(n.getAttribute&&(n.getAttribute('data-testid')||'').startsWith('message-')))n=n.parentElement;return n?n.getAttribute('data-testid').slice('message-'.length):null;});
  out.results.pollId=pollId; rec('poll-id',{pollId});
  // Bob context
  const ctxB=await browser.newContext(); const B=await ctxB.newPage();
  B.on('pageerror',e=>steps.push({t:Date.now(),name:'pageerror-B',msg:String(e)}));
  await login(B,'bob@example.com','Bob!Clique2026');
  await openConv(B,'g-starter');
  await B.waitForSelector(tid('sm-poll'),{timeout:20000});
  out.results.pollStateBobInitial=await pollState(B);
  const bobPollId=await B.evaluate(()=>{const p=document.querySelector('[data-testid="sm-poll"]');let n=p;while(n&&!(n.getAttribute&&(n.getAttribute('data-testid')||'').startsWith('message-')))n=n.parentElement;return n?n.getAttribute('data-testid').slice('message-'.length):null;});
  out.results.bobPollId=bobPollId; rec('bob-poll-id',{bobPollId,sameId:bobPollId===pollId});
  // Alice votes A then changes to B (online)
  const clickOpt=async(page,i)=>{const o=await page.$$(tid('sm-poll-option'));await o[i].click();};
  await clickOpt(A,0); await A.waitForTimeout(1500);
  out.results.afterAliceVoteA=await pollState(A);
  rec('alice-voted-a',{state:out.results.afterAliceVoteA});
  await clickOpt(A,1); await A.waitForTimeout(1500);
  out.results.afterAliceChangeB=await pollState(A);
  rec('alice-changed-b',{state:out.results.afterAliceChangeB});
  // live tally in Bob's context (independent browser context)
  await B.waitForTimeout(2500);
  out.results.bobSeesAliceVote=await pollState(B);
  rec('bob-live',{state:out.results.bobSeesAliceVote});
  // Bob votes A online
  await clickOpt(B,0); await B.waitForTimeout(1500);
  out.results.afterBobVoteA=await pollState(B);
  rec('bob-voted-a',{state:out.results.afterBobVoteA});
  // Bob goes actually offline and changes to B
  await ctxB.setOffline(true);
  await B.waitForTimeout(1200);
  await clickOpt(B,1);
  await B.waitForTimeout(1500);
  out.results.bobOfflinePending=await pollState(B);
  out.results.bobPendingOps=await B.evaluate(()=>window.clique.state.pending.map(o=>({id:o.id,op:o.op,args:o.args})));
  rec('bob-offline-vote',{state:out.results.bobOfflinePending,pending:out.results.bobPendingOps});
  // close and reopen page while still offline
  await B.close();
  const B2=await ctxB.newPage();
  B2.on('pageerror',e=>steps.push({t:Date.now(),name:'pageerror-B2',msg:String(e)}));
  let reopened='ok';
  try{await B2.goto(URL,{waitUntil:'load',timeout:30000});}catch(e){reopened='goto-failed:'+String(e).slice(0,120);}
  rec('bob-reopen-offline',{reopened});
  await B2.waitForTimeout(4000);
  out.results.bobPendingAfterReopenOffline=await B2.evaluate(()=>window.clique?window.clique.state.pending.map(o=>({id:o.id,op:o.op,args:o.args})):'no-client').catch(e=>'eval-failed:'+String(e).slice(0,120));
  out.results.offlineShellRestored=await B2.evaluate(()=>!!document.querySelector('[data-testid="conversation-id"]')||!!document.querySelector('[data-testid="sm-auth-email"]')).catch(()=>false);
  rec('bob-pending-after-reopen',{pending:out.results.bobPendingAfterReopenOffline,shell:out.results.offlineShellRestored});
  // reconnect
  await ctxB.setOffline(false);
  await B2.waitForTimeout(6000);
  out.results.bobPendingAfterReconnect=await B2.evaluate(()=>window.clique?window.clique.state.pending.map(o=>({id:o.id,op:o.op,args:o.args})):'no-client').catch(e=>'eval-failed');
  rec('bob-after-reconnect',{pending:out.results.bobPendingAfterReconnect});
  // check final tallies from Alice's still-open context
  await A.waitForTimeout(3000);
  await A.getByText('Refresh history',{exact:true}).first().click().catch(()=>{});
  await A.waitForTimeout(2500);
  out.results.finalTallyAlice=await pollState(A);
  rec('final-tally-alice',{state:out.results.finalTallyAlice});
  // repeat the same option again (idempotence) as Bob from B2
  try{
    await openConv(B2,'g-starter');
    await B2.waitForSelector(tid('sm-poll'),{timeout:20000});
    out.results.bobStateBeforeRepeat=await pollState(B2);
    await clickOpt(B2,1);
    await B2.waitForTimeout(2500);
    out.results.bobStateAfterRepeat=await pollState(B2);
    rec('bob-repeat-same-option',{before:out.results.bobStateBeforeRepeat,after:out.results.bobStateAfterRepeat});
  }catch(e){rec('bob-repeat-failed',{err:String(e).slice(0,200)});}
  await ctxA.close(); await ctxB.close();
}catch(e){ out.fatal=String(e).slice(0,600); console.log('FATAL',out.fatal); }
finally{ await browser.close(); fs.writeFileSync(process.argv[2],JSON.stringify(out,null,1)); }
