import fs from 'node:fs';import crypto from 'node:crypto';
const start=Date.now(),events=fs.readFileSync('artifacts/fixture/projected.jsonl','utf8').trim().split('\n').map(JSON.parse);const rows={profiles:[],conversations:[],members:[],messages:[],reads:[],reactions:[],posts:[],follows:[],likes:[],reposts:[]},personas=[],chatOwners={},postAuthors={};const pid=a=>'dev:'+a;const seedEnd=Date.now(),base=seedEnd-100015;let messageIndex=0;
for(const e of events){const a=e.args,u=pid(e.actor),v=e.verb;
if(v==='register')personas.push(e.actor);
if(v==='profile-set'){const [displayName,handle,bio,location,link]=a;rows.profiles.push({id:'profile-'+e.actor,owner:u,displayName,handle,bio,location,link});}
if(v==='dm-create'||v==='group-create'){chatOwners[a[0]]=u;rows.conversations.push({id:a[0],name:a[2]??a[0],kind:v==='dm-create'?'dm':'group',owner:u});for(const userId of [u,pid(a[1])])rows.members.push({id:a[0]+':'+userId,conversationId:a[0],userId,addedBy:u});}
if(v==='member-add')rows.members.push({id:a[0]+':'+pid(a[1]),conversationId:a[0],userId:pid(a[1]),addedBy:chatOwners[a[0]]});
if(v==='send')rows.messages.push({id:a[0],conversationId:a[1],senderId:u,text:a[2],serverTimestamp:base+(++messageIndex),replyTo:a.find(x=>x.startsWith('quote='))?.slice(6)??null,edited:false,tombstone:false});
if(v==='react'){const m=rows.messages.find(m=>m.id===a[0]);rows.reactions.push({id:a[2],messageId:a[0],conversationId:m.conversationId,userId:u,emoji:a[1]});}
if(v==='post'||v==='reply'){const parentId=v==='reply'?a[1]:null;rows.posts.push({id:a[0],authorId:u,text:a[2],parentId,parentAuthor:parentId?postAuthors[parentId]:null,serverTimestamp:seedEnd,day:Math.floor(seedEnd/86400000)});postAuthors[a[0]]=u;}
if(v==='follow')rows.follows.push({id:a[2],userId:u,targetId:pid(a[0])});
if(v==='like'||v==='repost')rows[v==='like'?'likes':'reposts'].push({id:a[2],userId:u,postId:a[0],authorId:postAuthors[a[0]],...(v==='like'?{day:Math.floor(seedEnd/86400000)}:{})});
}
const root='artifacts/scale-app';fs.mkdirSync(root+'/snapback',{recursive:true});for(const file of fs.readdirSync('snapback').filter(f=>f.endsWith('.q')))fs.copyFileSync('snapback/'+file,root+'/snapback/'+file);
fs.writeFileSync(root+'/snapback/seed.ts',`import {seed} from 'snapback3';\nexport default seed(${JSON.stringify({personas,rows})});\n`);
fs.symlinkSync('../../dist',root+'/dist');
fs.writeFileSync('artifacts/fixture/seed-preparation.json',JSON.stringify({start,end:Date.now(),seedTimestampProvenance:'Loader-assigned authoritative seed timestamps, 1 ms spacing ending at preparation clock; NOT fixture documentary times or public mutation throughput',base,seedEnd,counts:Object.fromEntries(Object.entries(rows).map(([k,v])=>[k,v.length])),seedSha256:crypto.createHash('sha256').update(fs.readFileSync(root+'/snapback/seed.ts')).digest('hex')},null,2));console.log('Prepared '+root);
