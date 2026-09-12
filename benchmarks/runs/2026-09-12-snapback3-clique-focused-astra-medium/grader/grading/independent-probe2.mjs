import {chromium,expect} from '@playwright/test';import fs from 'node:fs';
const URL='http://127.0.0.1:54900';const out={run:Date.now(),checks:[]};
const B=await chromium.launch({headless:true,args:['--no-sandbox']});
const save=()=>fs.writeFileSync('grading/evidence/independent-probe2.json',JSON.stringify(out,null,2));
async function check(id,fn){const start=Date.now();try{const evidence=await fn();out.checks.push({id,status:'pass',ms:Date.now()-start,evidence});console.log('PASS',id);}catch(e){out.checks.push({id,status:'fail',ms:Date.now()-start,error:String(e).slice(0,500)});console.log('FAIL',id,String(e).slice(0,200));}save();}
const pw=a=>a[0].toUpperCase()+a.slice(1)+'!Clique2026';
async function open(actor,qs=''){const ctx=await B.newContext();const page=await ctx.newPage();page.setDefaultTimeout(15000);await page.goto(URL+qs);await page.waitForFunction(()=>window.clique);await page.evaluate(async a=>{await clique.ready;await clique.auth.login(a.e,a.p);},{e:actor+'@example.com',p:pw(actor)});await page.getByTestId('inbox-status').waitFor();return {ctx,page,actor};}
async function chat(p,id){await p.getByTestId('conversation-id').fill(id);await p.getByTestId('conversation-id').press('Enter');await expect(p.getByTestId('selected-chat')).toHaveText(id);}
const A1=await open('alice'),A2=await open('alice'),BO=await open('bob');
await chat(A1.page,'d-alice-bob');await chat(A2.page,'d-alice-bob');await chat(BO.page,'d-alice-bob');

await check('IND2-rapid-nav',async()=>{const p=A1.page;const obs=[];
for(let i=0;i<8;i++){const id=i%2?'g-starter':'d-alice-bob';await chat(p,id);obs.push({id,status:await p.getByTestId('history-status').innerText(),rendered:await p.locator('[data-testid^="message-"]').count()});}
await chat(p,'d-alice-bob');
let ok=false,detail=null;for(let i=0;i<40;i++){const st=await p.getByTestId('history-status').innerText();const n=await p.locator('[data-testid="message-sm0001"]').count();const tot=await p.locator('[data-testid^="message-"]').count();detail={st,sm0001:n,total:tot};if(n===1){ok=true;break}await p.waitForTimeout(500);}
if(!ok)throw Error('after rapid switching DM history did not render sm0001: '+JSON.stringify(detail));
return {switchObservations:obs,finalRecovery:detail};});

await check('IND2-account-change-isolation',async()=>{const p=A1.page;
await p.evaluate(()=>clique.auth.logout());await p.evaluate(a=>clique.auth.login(a.e,a.p),{e:'carol@example.com',p:pw('carol')});
await chat(p,'d-alice-bob');await p.waitForTimeout(2500);
const carol={count:await p.locator('[data-testid^="message-"]').count(),principal:await p.evaluate(()=>clique.getSnapshot().principal.id),history:await p.getByTestId('history-status').innerText()};
if(carol.count!==0)throw Error('unauthorized rows rendered for carol: '+carol.count);
await p.evaluate(()=>clique.auth.logout());await p.evaluate(a=>clique.auth.login(a.e,a.p),{e:'alice@example.com',p:pw('alice')});
await chat(p,'d-alice-bob');await p.getByTestId('message-sm0001').waitFor({timeout:20000});
return {carol,aliceBack:await p.locator('[data-testid^="message-"]').count()};});

await check('IND2-offline-reality',async()=>{const {ctx,page}=await open('alice');await chat(page,'d-alice-bob');await page.evaluate(()=>window.runAcquisition());
await ctx.setOffline(true);
const before={onLine:await page.evaluate(()=>navigator.onLine)};
before.apiFails=await page.evaluate(async()=>{try{const r=await fetch('/api/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'messages.latest',args:{conversationId:'d-alice-bob'}})});return 'status '+r.status;}catch(e){return 'threw '+String(e).slice(0,80);}});
const id=crypto.randomUUID();
await page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER offline-reality '+id,replyTo:null});await op.durable;},id);
const pendingBefore=await page.locator('[data-testid=sm-convo-receipt][aria-label=pending]').count();
await page.close();
const p2=await ctx.newPage();p2.setDefaultTimeout(20000);
const reopen={};
reopen.onLineAtNewPage=await (async()=>{const tmp=await p2.goto(URL).then(r=>r&&r.status()).catch(e=>'goto-failed '+String(e).slice(0,80));return tmp;})();
reopen.navigatorOnLine=await p2.evaluate(()=>navigator.onLine).catch(e=>'err');
reopen.apiFetch=await p2.evaluate(async()=>{try{const r=await fetch('/api/query',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({op:'messages.latest',args:{conversationId:'d-alice-bob'}})});return 'status '+r.status;}catch(e){return 'threw '+String(e).slice(0,80);}});
await p2.waitForFunction(()=>window.clique&&clique.getSnapshot().principal,null,{timeout:20000});
await chat(p2,'d-alice-bob');
await p2.getByTestId('message-sm0001').waitFor({timeout:20000});
reopen.rendered=await p2.locator('[data-testid^="message-"]').count();
reopen.pending=await p2.locator('[data-testid=sm-convo-receipt][aria-label=pending]').count();
await p2.getByTestId('history-search').fill('Coffee after work?');
await p2.getByTestId('message-sm0001').waitFor();
reopen.searchHits=await p2.locator('[data-testid^="message-"]').count();
await p2.getByTestId('history-search').fill('');
await ctx.setOffline(false);
await BO.page.getByTestId('message-'+id).waitFor({timeout:30000});
const copies=await BO.page.locator('[data-testid="message-'+id+'"]').count();
await ctx.close();
return {id,before,pendingBefore,reopen,recipientCopies:copies};});

await check('IND2-two-offline-queues-order',async()=>{const ids=[crypto.randomUUID(),crypto.randomUUID()];
for(const x of [A1,A2])await chat(x.page,'d-alice-bob');
await A1.ctx.setOffline(true);await A2.ctx.setOffline(true);
for(const [i,x] of [A1,A2].entries())await x.page.evaluate(async a=>{const op=clique.mutate('messages.send',{id:a.id,conversationId:'d-alice-bob',text:'GRADER queue'+a.i+' '+a.id,replyTo:null});await op.durable;},{id:ids[i],i});
const pend=[await A1.page.locator('[data-testid=sm-convo-receipt][aria-label=pending]').count(),await A2.page.locator('[data-testid=sm-convo-receipt][aria-label=pending]').count()];
await A1.ctx.setOffline(false);await BO.page.getByTestId('message-'+ids[0]).waitFor({timeout:30000});
await A2.ctx.setOffline(false);await BO.page.getByTestId('message-'+ids[1]).waitFor({timeout:30000});
const rows=await BO.page.evaluate(async()=>{let c=null,all=[];do{const s=await clique.watch('messages.page',{conversationId:'d-alice-bob',c}).refresh();all.push(...s.data);c=s.next??null;}while(c);return all.map(m=>({id:m.id,ts:m.serverTimestamp}));});
const f=ids.map(i=>rows.filter(r=>r.id===i));
if(f.some(x=>x.length!==1))throw Error('exactly-once violated '+JSON.stringify(f));
if(!(f[0][0].ts<=f[1][0].ts))throw Error('arrival order wrong');
return {ids,pendingRendered:pend,arrival:[f[0][0],f[1][0]]};});

await check('IND2-unread-converges',async()=>{await chat(A2.page,'g-starter');
const bid=crypto.randomUUID();await BO.page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER unread '+id,replyTo:null});await op.durable;await op.settled;},bid);
await chat(A2.page,'d-alice-bob');
let before='0';for(let i=0;i<30;i++){before=await A2.page.getByTestId('unread-state').innerText();if(before!=='0'&&before!=='Unknown')break;await A2.page.waitForTimeout(400);}
if(!(Number(before)>0))throw Error('unread never rose above 0 (rendered '+before+')');
await chat(A1.page,'d-alice-bob');await A1.page.getByTestId('message-'+bid).waitFor({timeout:20000});
let after=before;for(let i=0;i<30;i++){after=await A2.page.getByTestId('unread-state').innerText();if(after==='0')break;await A2.page.waitForTimeout(500);}
if(after!=='0')throw Error('unread did not clear: '+after);
return {bid,before,after};});

await check('IND2-receipts-distinct',async()=>{const id=crypto.randomUUID();
await chat(A1.page,'d-alice-bob');
const state=await A1.page.evaluate(async id=>{const op=clique.mutate('messages.send',{id,conversationId:'d-alice-bob',text:'GRADER receipts '+id,replyTo:null});await op.durable;return (await op.settled).state;},id);
const bobId=await BO.page.evaluate(()=>clique.getSnapshot().principal.id);
const rd=async p=>p.evaluate(()=>clique.watch('messages.receipts',{conversationId:'d-alice-bob'}).refresh().then(s=>s.data));
const rows=await BO.page.evaluate(()=>clique.watch('messages.page',{conversationId:'d-alice-bob',c:null}).refresh().then(s=>s.data));
const target=rows.find(m=>m.id===id);if(!target)throw Error('recipient page missing message');
const pick=rs=>{const r=(rs||[]).find(r=>r.userId===bobId);return r?{fetchedThrough:r.fetchedThrough,viewedThrough:r.viewedThrough}:null};
const atAccept=pick(await rd(A1.page));
await BO.page.evaluate(async t=>{await clique.mutate('messages.fetched',{conversationId:'d-alice-bob',through:t}).settled;},target.serverTimestamp);
const afterFetched=pick(await rd(A1.page));
await BO.page.evaluate(async t=>{await clique.mutate('messages.viewed',{conversationId:'d-alice-bob',through:t}).settled;},target.serverTimestamp);
const afterViewed=pick(await rd(A1.page));
if(atAccept&&atAccept.viewedThrough>=target.serverTimestamp)throw Error('viewed set merely by acceptance');
if(!(afterFetched.fetchedThrough>=target.serverTimestamp))throw Error('fetched watermark not advanced');
if(!(afterViewed.viewedThrough>=target.serverTimestamp))throw Error('viewed watermark not advanced');
return {accepted:state,ts:target.serverTimestamp,atAccept,afterFetched,afterViewed};});

await check('IND2-insights-rendered',async()=>{const {page:p}=await open('alice');
await p.getByRole('button',{name:'Insights',exact:true}).click();
await p.getByTestId('sm-insights-day-row').first().waitFor({timeout:25000});
const dayRows=await p.locator('[data-testid="sm-insights-day-row"]').allInnerTexts();
const screen=await p.locator('body').innerText();
const raw=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));
await p.screenshot({path:'grading/evidence/insights-grader-before.png',fullPage:true});
await BO.page.evaluate(async()=>{await clique.mutate('social.likes',{postId:'sp0003',active:false}).settled;});
const before=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));
await p.getByRole('button',{name:'Refresh Insights',exact:true}).click();await p.waitForTimeout(800);
const screenBefore=await p.locator('body').innerText();
await BO.page.evaluate(async()=>{await clique.mutate('social.likes',{postId:'sp0003',active:true}).settled;});
let after=before;for(let i=0;i<25;i++){await p.getByRole('button',{name:'Refresh Insights',exact:true}).click();await p.waitForTimeout(400);after=await p.evaluate(()=>clique.watch('social.insights',{today:Math.floor(Date.now()/86400000)}).refresh().then(s=>s.data));if(after.likesReceived===before.likesReceived+1)break;}
await p.waitForTimeout(600);
const screenAfter=await p.locator('body').innerText();
await p.screenshot({path:'grading/evidence/insights-grader-after.png',fullPage:true});
if(after.likesReceived-before.likesReceived!==1)throw Error('like delta '+(after.likesReceived-before.likesReceived));
return {dayRowCount:dayRows.length,dayRows,raw,before,after,screenBefore:screenBefore.slice(0,900),screenAfter:screenAfter.slice(0,900)};});

await B.close();save();console.log(JSON.stringify(out.checks.map(c=>({id:c.id,status:c.status}))));
