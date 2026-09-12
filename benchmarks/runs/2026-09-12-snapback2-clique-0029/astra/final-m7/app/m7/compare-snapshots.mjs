import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {log} from './log.mjs';
const pre='m7/pre-snapshot',post=process.argv[2]??'m7/post-snapshot',results=[];
const manifest=JSON.parse(readFileSync(pre+'/manifest.json'));
for(const [file,hash]of Object.entries(manifest.hashes)){
 const raw=readFileSync(pre+'/'+file);assert.equal(createHash('sha256').update(raw).digest('hex'),hash);
 const before=JSON.parse(raw),after=JSON.parse(readFileSync(post+'/'+file));assert.equal(after.viewer,before.viewer);
 for(const c of before.conversations){const next=after.conversations.find(n=>n.conversationId===c.conversationId);assert.ok(next);
 const {messageCount,...oldShape}=next.conversation;assert.deepEqual(oldShape,c.conversation);
 for(const message of c.messages)assert.deepEqual(next.messages.find(m=>m.id===message.id),message,`${file}/${message.id}`);
 results.push({persona:before.persona,conversation:c.conversationId,messages:c.messages.length,pass:true});}
}
writeFileSync('m7/evidence/snapshot-comparison.json',JSON.stringify({pass:true,pre,post,at:Date.now(),results},null,2));
log('pre/post snapshot exact original fields comparison passed evidence=m7/evidence/snapshot-comparison.json');
