import {registerHooks} from 'node:module';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
for(const path of ['packages/snapback4/src/delivery.ts','packages/snapback4/src/delivery-state.ts','packages/snapback4/test/delivery.test.mjs']) {
 assert.deepEqual(readFileSync(path),execFileSync('git',['show',`HEAD:snapback4/${path}`]),`${path} is unchanged from round 11`);
}
registerHooks({load(url,context,next){
 const result=next(url,context);
 if(!url.endsWith('/test/delivery.test.mjs'))return result;
 const source=String(result.source),before='replay=true;await h.q.reconnect();await h.flush();\n const g=groups(await h.state())[0];assert.deepEqual(g.owed,[[1,1],[3,3]]);';
 assert.equal(source.split(before).length,2);
 return {...result,source:source.replace(before,before.replace("\n const g=", "await h.flush();console.log('scheduled reports',h.calls.map(c=>({id:c.id,args:c.args})));\n const g="))};
}});
