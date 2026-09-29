import fs from 'node:fs';
import {idFrom} from '../../../packages/snapback4/dist/client.js';
const root='target/sq';
for(const stage of ['10pct','50pct','full']){
 const state=JSON.parse(fs.readFileSync(`${root}/${stage==='full'?'original-state.private.json':stage+'/state.private.json'}`));
 const probes=[['u0001','chat.history',{conversation:idFrom('g0001'),c:null}],['u0500','home',{c:null}],['u0005','home',{c:null}],['u0901','home',{c:null}],['u0500','chat.searchMessages',{q:'coffee',conversation:null,c:null}],['u0500','insights.summary',{}],['u0500','insights.trending',{c:null}]].map(([u,op,args])=>({op,args,viewer:state.users[u].principal}));
 fs.writeFileSync(`${root}/${stage}-probes.json`,JSON.stringify(probes),{mode:0o600});
}
