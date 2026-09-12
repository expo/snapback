import {createClient} from 'snapback3/client';import fs from 'node:fs';import crypto from 'node:crypto';
const out={};
// 1. Documented raw HTTP path on 54900 as alice
const login=await fetch('http://127.0.0.1:54900/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email:'alice@example.com',password:process.env.GP||'Alice!Clique2026'})});
const sess=await login.json();const token=sess.token??sess.session?.token;
const q=async(op,args)=>{const r=await fetch('http://127.0.0.1:54900/api/query',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+token},body:JSON.stringify({op,args})});return {status:r.status,body:await r.json()};};
const inbox=await q('conversations.inbox',{c:null});
out.httpAlice={loginStatus:login.status,hasToken:!!token,inboxStatus:inbox.status,inboxKeys:Object.keys(inbox.body||{}),conversations:(inbox.body?.data??inbox.body?.rows??[]).map?.(c=>c.id)};
let c=null,pages=[],ids=[];
do{const r=await q('messages.page',{conversationId:'d-alice-bob',c});const data=r.body?.data??r.body?.rows??[];pages.push({c,count:data.length,next:r.body?.next??null,complete:r.body?.complete});ids.push(...data.map(m=>m.id));c=r.body?.next??null;}while(c&&pages.length<80);
out.httpAlice.dmPages=pages;out.httpAlice.dmMessageIds=ids.length;out.httpAlice.dmUnique=new Set(ids).size;
out.httpAlice.starterIdsPresent=['sm0001','sm0002','sm0003','sm0004','sm0005','sm0006'].every(i=>ids.includes(i));
// 2. SDK persona path on scale server: full inbox + g0001 history pagination
const cl=createClient({url:'http://127.0.0.1:54901',storage:false,live:false});await cl.ready;await cl.auth.persona('u0500');
let cc=null,convIds=[],inboxPages=[];
do{const s=await cl.watch('conversations.inbox',{c:cc}).refresh();inboxPages.push({c:cc,count:s.data.length,complete:s.complete,next:!!s.next});convIds.push(...s.data.map(x=>x.id));cc=s.next??null;}while(cc);
let mc=null,mids=[],mpages=[];
do{const s=await cl.watch('messages.page',{conversationId:'g0001',c:mc}).refresh();mpages.push({count:s.data.length,complete:s.complete,firstId:s.data[0]?.id,lastId:s.data.at(-1)?.id});mids.push(...s.data.map(m=>m.id));mc=s.next??null;}while(mc);
const expected=new Set(JSON.parse(fs.readFileSync('artifacts/fixture/u0500-ids.json')));
const uniq=new Set(mids);
out.sdkScale={conversationPages:inboxPages.length,conversationCount:convIds.length,uniqueConversations:new Set(convIds).size,
 messagePages:mpages.length,pageSizes:[...new Set(mpages.map(p=>p.count))],messageIds:mids.length,unique:uniq.size,
 duplicates:mids.length-uniq.size,missingFixture:[...expected].filter(i=>!uniq.has(i)).length,extra:[...uniq].filter(i=>!expected.has(i)).length};
// exact ordering check: ascending serverTimestamp,id across pages
cl.close();
fs.writeFileSync('grading/evidence/api-pagination.json',JSON.stringify(out,null,2));
console.log(JSON.stringify(out.sdkScale));console.log(JSON.stringify({...out.httpAlice,dmPages:out.httpAlice.dmPages.length}));
