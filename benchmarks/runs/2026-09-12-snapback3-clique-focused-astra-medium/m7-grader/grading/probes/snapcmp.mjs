import fs from 'node:fs';
const fields='id conversationId senderId serverTimestamp type text caption mediaReference edited tombstone replyTo reactions ownMessageReceiptState'.split(' ');
const canon=v=>Array.isArray(v)?[...v.map(canon)].sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:1):(v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canon(v[k])])):v);
const out={personas:[],coverageFailures:[],differences:[]};
for(const actor of ['alice','bob','carol']){
  const pre=JSON.parse(fs.readFileSync(`grading-input/pre-m7-snapshots/pre-m7-${actor}.json`,'utf8'));
  const post=JSON.parse(fs.readFileSync(`m7/post-m7-${actor}.json`,'utf8'));
  const A=Object.fromEntries(pre.conversations.flatMap(c=>c.messages.map(m=>[m.id,m])));
  const B=Object.fromEntries(post.conversations.flatMap(c=>c.messages.map(m=>[m.id,m])));
  if(pre.principal!==post.principal) out.differences.push({actor,principal:[pre.principal,post.principal]});
  const missing=Object.keys(A).filter(id=>!B[id]); const added=Object.keys(B).filter(id=>!A[id]);
  const c={rows:0,visible:0,edited:0,tombstone:0,reactions:0,mine:0,ownReceipts:0,fetchedPopulated:0,viewedPopulated:0,replies:0,typed:{}};
  for(const [id,m] of Object.entries(A)){
    const p=B[id];
    for(const side of [['pre',m],['post',p||{}]]) for(const f of fields) if(!(f in side[1])) out.coverageFailures.push({actor,id,side:side[0],field:f});
    if(p) for(const f of fields) if(JSON.stringify(canon(m[f]))!==JSON.stringify(canon(p[f]))) out.differences.push({actor,id,field:f,pre:m[f],post:p[f]});
    c.rows++; if(m.tombstone)c.tombstone++; else c.visible++; if(m.edited)c.edited++;
    c.reactions+=m.reactions.length; c.mine+=m.reactions.filter(r=>r.mine===true).length;
    if(m.replyTo)c.replies++;
    const t=String(m.type); c.typed[t]=(c.typed[t]||0)+1;
    const r=m.ownMessageReceiptState;
    if(r){c.ownReceipts++; if(r.recipientFetched&&r.recipientFetched.length)c.fetchedPopulated++; if(r.recipientViewed&&r.recipientViewed.length)c.viewedPopulated++;}
  }
  out.personas.push({actor,preIds:Object.keys(A).sort(),missingInPost:missing,addedInPost:added,controls:c,
    controlsNonEmpty:{edited:c.edited>0,tombstone:c.tombstone>0,reply:c.replies>0,reaction:c.reactions>0,mine:c.mine>0,receiptFetched:c.fetchedPopulated>0,receiptViewed:c.viewedPopulated>0}});
}
out.pass=out.coverageFailures.length===0&&out.differences.length===0&&out.personas.every(p=>p.missingInPost.length===0&&Object.values(p.controlsNonEmpty).every(Boolean));
fs.writeFileSync('grading/results/snapshot-comparison-independent.json',JSON.stringify(out,null,1));
console.log(JSON.stringify(out,null,1).slice(0,3000));
