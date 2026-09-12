import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
const URL='http://127.0.0.1:54900';const out={run:Date.now(),checks:[]};
const B=await chromium.launch({headless:true,args:['--no-sandbox']});const ctxs=[];
const save=()=>fs.writeFileSync('grading/evidence/independent-probe.json',JSON.stringify(out,null,2));
async function check(id,fn){const start=Date.now();try{const evidence=await Promise.race([fn(),new Promise((_,r)=>setTimeout(()=>r(Error('grader 60s timeout')),60000))]);out.checks.push({id,status:'pass',ms:Date.now()-start,evidence});console.log('PASS',id);}catch(e){out.checks.push({id,status:'fail',ms:Date.now()-start,error:String(e).slice(0,600)});console.log('FAIL',id,String(e).slice(0,200));}save();}
const pw=a=>a[0].toUpperCase()+a.slice(1)+'!Clique2026';
async function open(actor,qs=''){const ctx=await B.newContext();ctxs.push(ctx);const page=await ctx.newPage();page.setDefaultTimeout(15000);await page.goto(URL+qs);await page.waitForFunction(()=>window.clique);await page.evaluate(async a=>{await clique.ready;await clique.auth.login(a.e,a.p);},{e:actor+'@example.com',p:pw(actor)});await page.getByTestId('inbox-status').waitFor();return {ctx,page,actor};}
async function chat(p,id){await p.getByTestId('conversation-id').fill(id);await p.getByTestId('conversation-id').press('Enter');await expect(p.getByTestId('selected-chat')).toHaveText(id);}
async function texts(p){return p.locator('[data-testid^="message-"]').allInnerTexts();}
const A1=await open('alice'),A2=await open('alice'),BO=await open('bob');
await chat(A1.page,'d-alice-bob');await chat(A2.page,'d-alice-bob');await chat(BO.page,'d-alice-bob');

await check('IND-auth-restoration',async()=>{const p=A1.page;await p.reload();await p.waitForFunction(()=>window.clique&&clique.getSnapshot().principal,null,{timeout:20000});const principal=await p.evaluate(()=>clique.getSnapshot().principal.id);await p.getByTestId('inbox-status').waitFor();const inboxText=await p.getByTestId('inbox-status').innerText();const rows=await p.locator('[data-testid="sm-chats-item"]').allInnerTexts().catch(()=>[]);await chat(p,'d-alice-bob');await p.getByTestId('message-sm0001').waitFor();const rendered=await p.getByTestId('message-sm0001').innerText();if(!rendered.includes('Coffee after work?'))throw Error('restored history text wrong: '+rendered);return {principal,inboxText,inboxRows:rows.length,rendered:rendered.slice(0,80),reloggedIn:false};});

await check('IND-rapid-nav-and-account-change',async()=>{const p=A1.page;const seq=[];for(let i=0;i<8;i++){const id=i%2?'g-starter':'d-alice-bob';await chat(p,id);seq.push(id);}
await p.getByTestId('message-sm0001').waitFor();const dmTexts=await texts(p);
await chat(p,'g-starter');await p.getByTestId('message-sm0007').waitFor();const grpTexts=await texts(p);
if(grpTexts.some(t=>t.includes('Coffee after work?')))throw Error('DM message leaked into group view');
await p.evaluate(()=>clique.auth.logout());await p.evaluate(a=>clique.auth.login(a.e,a.p),{e:'carol@example.com',p:pw('carol')});
await chat(p,'d-alice-bob');await p.waitForTimeout(1500);const carolCount=await p.locator('[data-testid^="message-"]').count();const carolPrincipal=await p.evaluate(()=>clique.getSnapshot().principal.id);
if(carolCount!==0)throw Error('carol sees '+carolCount+' unauthorized messages');
await p.evaluate(()=>clique.auth.logout());await p.evaluate(a=>clique.auth.login(a.e,a.p),{e:'alice@example.com',p:pw('alice')});
await chat(p,'d-alice-bob');await p.getByTestId('message-sm0001').waitFor();const back=await p.locator('[data-testid^="message-"]').count();
return {switches:seq.length,dmRendered:dmTexts.length,groupRendered:grpTexts.length,carolRenderedCount:carolCount,carolPrincipal,aliceRenderedAfterSwitchBack:back};},);

await check('IND-unavailable-count-messages-visible',async()=>{const {page:p,ctx}=await open('alice','/?denyUnread=1');await chat(p,'d-alice-bob');await p.getByTestId('message-sm0001').waitFor();
const unread=await p.getByTestId('unread-state').innerText();const count=await p.locator('[data-testid^="message-"]').count();
if(unread!=='Unknown')throw Error('unread state was '+unread);
if(count<6)throw Error('authorized messages not visible: '+count);
const id=crypto.randomUUID();const r=await p.evaluate(async id=>{const t=performance.now();const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER denied-summary '+id,replyTo:null});await op.durable;const d=performance.now()-t;const receipt=await op.settled;return {durableMs:d,settledMs:performance.now()-t,receipt};},id);
if(r.receipt.state!=='committed')throw Error('send not committed '+JSON.stringify(r.receipt));
await BO.page.getByTestId('message-'+id).waitFor({timeout:20000});
const copies=await BO.page.locator('[data-testid="message-'+id+'"]').count();
out.deniedSendId=id;return {unreadRendered:unread,renderedMessages:count,send:r,recipientCopies:copies};});

await check('IND-durable-send-during-delayed-read',async()=>{const {page:p}=await open('alice');
await p.route('**/api/**',async route=>{const body=route.request().postData()||'';if(body.includes('messages.page')||body.includes('conversations.unread')){await new Promise(r=>setTimeout(r,4000));}await route.continue();});
const nav=p.getByTestId('conversation-id');await nav.fill('d-alice-bob');await nav.press('Enter');
const id=crypto.randomUUID();const t0=Date.now();
const r=await p.evaluate(async id=>{const t=performance.now();const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER delayed-read '+id,replyTo:null});await op.durable;const durable=performance.now()-t;const receipt=await op.settled;return {durable,settled:performance.now()-t,receipt};},id);
const historyStatus=await p.getByTestId('history-status').innerText();
if(r.receipt.state!=='committed')throw Error('not committed');
await BO.page.getByTestId('message-'+id).waitFor({timeout:25000});
out.delayedSendId=id;return {...r,elapsedMs:Date.now()-t0,historyStatusDuringDelay:historyStatus,recipientSaw:true};});

await check('IND-same-account-convergence',async()=>{const id=crypto.randomUUID();
await chat(A2.page,'g-starter');
const r=await A1.page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER same-account '+id,replyTo:null});await op.durable;return (await op.settled).state;},id);
await chat(A2.page,'d-alice-bob');await A2.page.getByTestId('message-'+id).waitFor({timeout:25000});
const rendered=await A2.page.getByTestId('message-'+id).innerText();
// unread convergence: bob sends while alice2 views group
await chat(A2.page,'g-starter');
const bid=crypto.randomUUID();await BO.page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER unread probe '+id,replyTo:null});await op.durable;await op.settled;},bid);
await chat(A2.page,'d-alice-bob');
let before=null;for(let i=0;i<25;i++){before=await A2.page.getByTestId('unread-state').innerText();if(before!=='0'&&before!=='Unknown')break;await A2.page.waitForTimeout(400);}
await chat(A1.page,'d-alice-bob');await A1.page.getByTestId('message-'+bid).waitFor({timeout:20000});
let after=null;for(let i=0;i<30;i++){await A2.page.getByTestId('history-search').fill('');after=await A2.page.getByTestId('unread-state').innerText();if(after==='0')break;await A2.page.waitForTimeout(500);}
if(after!=='0')throw Error('unread did not converge to 0, before='+before+' after='+after);
out.sameAccountIds=[id,bid];return {sendState:r,alice2Rendered:rendered.slice(0,80),unreadBeforeRead:before,unreadAfterRead:after};});

await check('IND-offline-dual-queue-reopen-order',async()=>{const ids=[crypto.randomUUID(),crypto.randomUUID()];
for(const x of [A1,A2])await chat(x.page,'d-alice-bob');
await A1.page.evaluate(()=>window.runAcquisition());
await A1.ctx.setOffline(true);await A2.ctx.setOffline(true);
for(const [i,x] of [A1,A2].entries()){await x.page.evaluate(async a=>{const op=clique.mutate('messages.send',{id:a.id,conversationId:'d-alice-bob',text:'GRADER offline '+a.i+' '+a.id,replyTo:null});await op.durable;},{id:ids[i],i});
  await expect(x.page.locator('[data-testid=sm-convo-receipt][aria-label=pending]')).toHaveCount(1);}
// close and reopen still offline
const reopened={};
for(const [i,x] of [A1,A2].entries()){await x.page.close();x.page=await x.ctx.newPage();x.page.setDefaultTimeout(20000);await x.page.goto(URL);await x.page.waitForFunction(()=>window.clique&&clique.getSnapshot().principal);await chat(x.page,'d-alice-bob');
  await x.page.getByTestId('message-sm0001').waitFor();
  const pending=await x.page.locator('[data-testid=sm-convo-receipt][aria-label=pending]').count();
  const rendered=await x.page.locator('[data-testid^="message-"]').count();
  const online=await x.page.evaluate(()=>navigator.onLine);
  reopened['client'+i]={pending,renderedMessages:rendered,navigatorOnLine:online};
  if(online)throw Error('browser not actually offline');
  if(pending!==1)throw Error('pending send lost after reopen: '+pending);}
// offline search over acquired history
await A1.page.getByTestId('history-search').fill('Coffee after work?');
await A1.page.getByTestId('message-sm0001').waitFor();
const searchHits=await A1.page.locator('[data-testid^="message-"]').count();
await A1.page.getByTestId('history-search').fill('');
await A1.ctx.setOffline(false);await BO.page.getByTestId('message-'+ids[0]).waitFor({timeout:30000});
const t1=Date.now();await A2.ctx.setOffline(false);await BO.page.getByTestId('message-'+ids[1]).waitFor({timeout:30000});
const copies=[];for(const id of ids)copies.push(await BO.page.locator('[data-testid="message-'+id+'"]').count());
const rows=await BO.page.evaluate(async()=>{let c=null,all=[];do{const s=await clique.watch('messages.page',{conversationId:'d-alice-bob',c}).refresh();all.push(...s.data);c=s.next??null;}while(c);return all.map(m=>({id:m.id,ts:m.serverTimestamp}));});
const f=ids.map(id=>rows.filter(r=>r.id===id));
if(f.some(x=>x.length!==1))throw Error('not exactly once: '+JSON.stringify(f));
if(!(f[0][0].ts<=f[1][0].ts))throw Error('server arrival order wrong');
out.offlineIds=ids;return {ids,reopened,searchHits,recipientCopies:copies,arrival:[f[0][0],f[1][0]],reconnectOrder:'client0 then client1'};});

await check('IND-receipt-states-distinct',async()=>{const id=crypto.randomUUID();
await chat(A1.page,'d-alice-bob');
const state=await A1.page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER receipts '+id,replyTo:null});await op.durable;return (await op.settled).state;},id);
const bobId=await BO.page.evaluate(()=>clique.getSnapshot().principal.id);
const receiptsAfterAccept=await A1.page.evaluate(()=>clique.watch('messages.receipts',{conversationId:'d-alice-bob'}).refresh().then(s=>s.data));
await BO.page.evaluate(()=>clique.watch('messages.page',{conversationId:'d-alice-bob',c:null}).refresh());
const rows=await BO.page.evaluate(()=>clique.watch('messages.page',{conversationId:'d-alice-bob',c:null}).refresh().then(s=>s.data));
const target=rows.find(m=>m.id===id);
await BO.page.evaluate(async t=>{await clique.mutate('messages.fetched',{conversationId:'d-alice-bob',through:t}).settled;},target.serverTimestamp);
const afterFetched=await A1.page.evaluate(()=>clique.watch('messages.receipts',{conversationId:'d-alice-bob'}).refresh().then(s=>s.data));
await BO.page.evaluate(async t=>{await clique.mutate('messages.viewed',{conversationId:'d-alice-bob',through:t}).settled;},target.serverTimestamp);
const afterViewed=await A1.page.evaluate(()=>clique.watch('messages.receipts',{conversationId:'d-alice-bob'}).refresh().then(s=>s.data));
const pick=(rs)=>{const r=(rs||[]).find(r=>r.userId===bobId);return r?{fetchedThrough:r.fetchedThrough,viewedThrough:r.viewedThrough}:null;};
const a=pick(receiptsAfterAccept),b=pick(afterFetched),c=pick(afterViewed);
if(a&&a.viewedThrough>=target.serverTimestamp)throw Error('viewed already set at accept');
if(!(b.fetchedThrough>=target.serverTimestamp))throw Error('fetched not advanced');
if(!(c.viewedThrough>=target.serverTimestamp))throw Error('viewed not advanced');
let label=null;for(let i=0;i<20;i++){await A1.page.getByTestId('history-search').fill('');const t=await A1.page.getByTestId('message-'+id).innerText().catch(()=>'');if(/read/i.test(t)){label=t;break}await A1.page.waitForTimeout(500);}
out.receiptId=id;return {accepted:state,atAccept:a,afterFetched:b,afterViewed:c,renderedLabel:(label||'').replace(/\n/g,' ').slice(0,120),targetTs:target.serverTimestamp};});

await check('IND-insights-rendered',async()=>{const p=A1.page;
await p.getByRole('button',{name:'Insights',exact:true}).click();
await p.getByTestId('sm-insights-day-row').first().waitFor();
const rows=await p.locator('[data-testid="sm-insights-day-row"]').allInnerTexts();
const totals=await p.locator('[data-testid="sm-insights-total"]').allInnerTexts().catch(()=>[]);
const raw=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));
await p.screenshot({path:'grading/evidence/insights-grader-before.png',fullPage:true});
// fresh like of a previously-unliked alice post by bob
await BO.page.evaluate(async()=>{await clique.mutate('social.likes',{postId:'sp0003',active:false}).settled;});
const before=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));
await BO.page.evaluate(async()=>{await clique.mutate('social.likes',{postId:'sp0003',active:true}).settled;});
let after=null;for(let i=0;i<25;i++){after=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));if(after.likesReceived===before.likesReceived+1)break;await p.waitForTimeout(400);}
await p.getByRole('button',{name:'Refresh Insights',exact:true}).click().catch(()=>{});
await p.waitForTimeout(1200);
const totalsAfter=await p.locator('[data-testid="sm-insights-total"]').allInnerTexts().catch(()=>[]);
await p.screenshot({path:'grading/evidence/insights-grader-after.png',fullPage:true});
return {dayRowCount:rows.length,dayRows:rows,totalsRendered:totals,raw,before,after,delta:after.likesReceived-before.likesReceived,totalsRenderedAfter:totalsAfter};});

await B.close();save();
console.log(JSON.stringify(out.checks.map(c=>({id:c.id,status:c.status})),null,1));
