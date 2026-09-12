import {open,rows,dec} from './decode.mjs';
const pre=open(process.argv[2]), fin=open(process.argv[3]);
const pm=rows(pre,'messages'), fm=rows(fin,'messages');
const key=m=>({id:m._id,c:m.conversationId,s:m.senderId,ts:m.serverTimestamp,type:m.type===undefined?'<absent>':m.type,tomb:m.tombstone,ed:m.edited,rep:m.replyTo===undefined?'<absent>':m.replyTo,text:m.text});
const P=pm.map(key).sort((a,b)=>a.ts-b.ts), F=fm.map(key).sort((a,b)=>a.ts-b.ts);
const fbyid=new Map(F.map(m=>[m.id,m]));
const diffs=[];
for(const m of P){const f=fbyid.get(m.id); if(!f){diffs.push({id:m.id,issue:'MISSING_IN_FINAL'});continue;}
  for(const k of Object.keys(m)) if(JSON.stringify(m[k])!==JSON.stringify(f[k])) diffs.push({id:m.id,field:k,pre:m[k],post:f[k]});}
const newOnes=F.filter(m=>!P.find(p=>p.id===m.id));
console.log(JSON.stringify({preCount:P.length,finalCount:F.length,preservedDiffs:diffs,preMessages:P,newInFinal:newOnes},null,1));
