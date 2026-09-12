import fs from 'node:fs';
import {createClient} from 'snapback3/client';
const url=process.env.CLIQUE_URL??'http://127.0.0.1:54900';
const personas=JSON.parse(fs.readFileSync('instrument/fixtures/personas.json')).starter;
const clients={},principals={},receipts=[];
const output=process.env.SEED_EVIDENCE??`evidence/starter-seed-${Date.now()}.json`;
const start=Date.now();
try{
for(const p of personas){const c=createClient({url,storage:false,live:false});clients[p.id]=c;await c.ready;let session;try{session=await c.auth.signup(p.email,p.password)}catch{session=await c.auth.login(p.email,p.password)}principals[p.id]=session.principal.id;}
for(const file of ['starter-m1.log','starter-m2.log','starter-m3.log'])for(const line of fs.readFileSync('instrument/fixtures/'+file,'utf8').trim().split('\n')){
const [time,actor,verb,...a]=line.match(/"(?:[^"\\]|\\.)*"|\S+/g).map(x=>x[0]==='"'?JSON.parse(x):x);let op,args;
if(verb==='register')continue;
if(verb==='profile-set'){op='profiles.save';const [displayName,handle,bio,location,link]=a;args={displayName,handle,bio,location,link};}
if(verb==='follow'){op='social.follow';args={targetId:principals[a[0]]};}
if(verb==='post'){op='social.post';args={id:a[0],text:(a[1]==='text'?'':`[Projected ${a[1]}: ${a[3]}] `)+a[2],parentId:null};}
if(verb==='reply'){op='social.post';args={id:a[0],text:a[2],parentId:a[1]};}
if(verb==='like'||verb==='repost'){op='social.'+(verb==='like'?'likes':'reposts');args={postId:a[0],active:a[1]==='set'};}
if(verb==='dm-create'||verb==='group-create'){op='conversations.create';args={id:a[0],other:principals[a[1]],name:a[2]??'Alice / Bob',kind:verb==='dm-create'?'dm':'group'};}
if(verb==='member-add'){op='conversations.add';args={conversationId:a[0],userId:principals[a[1]]};}
if(verb==='send'){op='messages.send';args={id:a[0],conversationId:a[1],text:a[2],replyTo:a[3]?.slice(6)??null};}
if(!op)throw Error('Unhandled '+verb);
const before=Date.now(),result=await clients[actor].mutate(op,args).settled;receipts.push({file,actor,verb,op,args,documentaryTime:time,started:before,settled:Date.now(),result});if(result.state!=='committed')throw Error(JSON.stringify(result));
}
console.log('Starter projected seed committed');
}catch(e){receipts.push({error:String(e)});process.exitCode=1;console.error(e)}finally{for(const c of Object.values(clients))c.close();fs.writeFileSync(output,JSON.stringify({start,end:Date.now(),scope:'starter text projection; public mutations; avatar omitted, six media posts converted',principals,receipts},null,2));}
