
import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{createClient}from'snapback4/client';import{exhaustPages}from'snapback4/proof';import{api}from'./snapback/generated/api.ts';
const users=JSON.parse(readFileSync(process.env.CALLS_USERS));
if(process.env.DX17_FROZEN_EXIT&&process.cwd().endsWith('/v1')){console.log(JSON.stringify({op:'new-rule',role:'member',ok:false,error:'E_RULE: private-observation-sentinel'}));process.exit(7);}
for(const accounts of Object.values(users))for(const account of accounts){
 const client=createClient({url:process.env.BACKEND_URL,session:account});
 try{const rows=await exhaustPages(c=>client.query(api.myNotes,{c}));
 const expected=JSON.parse(readFileSync(process.env.DX17_EXPECTED,'utf8'));
 for(const row of expected.filter(r=>r.owner===account.principal))assert.ok(rows.some(r=>r.id===row.id&&r.body===row.body),'missing v2-native row through frozen caller');
 }finally{client.close();}
}
