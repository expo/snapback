import {DatabaseSync} from 'node:sqlite';
const path=process.argv[2];
const db=new DatabaseSync(path);
const out={path};
out.tables=db.prepare('select table_name, count(*) n from rows group by table_name order by table_name').all();
out.meta=db.prepare('select key, substr(value,1,120) v from _meta').all();
out.commitCount=db.prepare('select count(*) n, max(seq) mx from _commits').get();
out.principals=db.prepare('select id,kind,name,created_at from _principals order by created_at').all();
out.conversations=db.prepare("select row_id, data from rows where table_name='conversations' order by row_id").all().map(r=>({id:r.row_id,...JSON.parse(r.data)}));
const msgs=db.prepare("select row_id,data from rows where table_name='messages'").all().map(r=>({id:r.row_id,...JSON.parse(r.data)}));
out.messageTotal=msgs.length;
out.messagesByConv={};
for(const m of msgs){const k=m.conversationId;out.messagesByConv[k]=out.messagesByConv[k]||{total:0,visible:0,tombstone:0,byType:{}};const b=out.messagesByConv[k];b.total++;if(m.tombstone)b.tombstone++;else b.visible++;const t=m.type===undefined?'undefined':String(m.type);b.byType[t]=(b.byType[t]||0)+1;}
out.messages=msgs.map(m=>({id:m.id,c:m.conversationId,s:m.senderId,ts:m.serverTimestamp,type:m.type===undefined?'<absent>':m.type,tomb:m.tombstone,edited:m.edited,replyTo:m.replyTo===undefined?'<absent>':m.replyTo,text:m.text})).sort((a,b)=>a.ts-b.ts||a.id.localeCompare(b.id));
for(const t of ['polls','votes','reactions','reads','members']){
  out[t]=db.prepare("select row_id,data from rows where table_name=?").all(t).map(r=>({id:r.row_id,...JSON.parse(r.data)}));
}
out.maintained=db.prepare("select table_name, count(*) n from rows where table_name like '%pollTallies%' or table_name like '%Tall%' group by table_name").all();
out.allRowTables=db.prepare('select distinct table_name from rows').all().map(r=>r.table_name);
out.outbox=db.prepare('select count(*) n from _outbox').get();
out.clientIntents=db.prepare('select count(*) n from _client_intents').get();
db.close();
console.log(JSON.stringify(out,null,1));
